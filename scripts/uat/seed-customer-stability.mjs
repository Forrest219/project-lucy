#!/usr/bin/env node
/**
 * seed-customer-stability.mjs — `customer-stability` 基线档幂等造数脚本。
 *
 * SOT：docs/qa/uat/scale-baseline.md §1.2（高于已知客户 8 连接 / 25 Schema / 2691 表）：
 *   - 数据连接数：>= 10（按真实 ktx.yaml 契约 driver/username/password/host/port/database/schemas/enabled_tables 补齐）
 *   - Schema 数：>= 30（按真实 semantic-layer/<conn>/_schema/<schema>.yaml 契约写入 `{ tables: ... }`）
 *   - 跨源表数：>= 3500（在 demo-db `uat_scale_mysql` 补齐 t_00001..t_03500 + w_1000）
 *
 * 特点：
 *   - 幂等：已达标维度跳过，已存在的 `_schema/<schema>.yaml` 不覆盖（N4）；
 *     `--force` 仅强制重跑 MySQL 补表与授权检查，不覆盖既有 ktx.yaml 连接或自定义 Schema。
 *   - 安全：修改 ktx.yaml 前自动备份到 `/data/lucy/ktx.yaml.bak.customer-stability`；
 *     仅使用本机实验凭据（与 docker-compose.demo.yml 一致），不含客户密钥。
 *
 * 用法：
 *   node scripts/uat/seed-customer-stability.mjs
 *   node scripts/uat/seed-customer-stability.mjs --dry-run
 *   node scripts/uat/seed-customer-stability.mjs --skip-restart
 *
 * 测试：scripts/uat/__tests__/seed-customer-stability.test.mjs
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import YAML from "yaml";

export const DEFAULT_TARGETS = Object.freeze({
  minConnections: 10,
  minSchemas: 30,
  minTables: 3500,
  mysqlDb: "uat_scale_mysql",
  mysqlCols: 10,
  wideCols: 1000,
  connPrefix: "uat_cs_conn_",
  schemaPrefix: "cs_schema_",
});

export function parseArgs(argv) {
  const opts = { dryRun: false, force: false, skipRestart: false };
  for (const a of argv) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--skip-restart") opts.skipRestart = true;
    else return { error: `未知参数：${a}（支持 --dry-run、--force、--skip-restart）` };
  }
  return opts;
}

/** 根据当前连接、已有 Schema 文件集合与表数量，规划需补齐的合成连接与 Schema（纯函数，N4 防重名覆盖）。 */
export function planCustomerStabilitySeed({
  existingConnections = [],
  existingSchemaKeys = [],
  existingSchemas = null,
  existingTables = 0,
  targets = DEFAULT_TARGETS,
}) {
  const existingSet = new Set(existingConnections);
  const connectionsToAdd = [];
  let idx = 1;
  while (existingSet.size + connectionsToAdd.length < targets.minConnections) {
    const id = `${targets.connPrefix}${String(idx).padStart(2, "0")}`;
    idx += 1;
    if (!existingSet.has(id)) connectionsToAdd.push(id);
  }

  const allSyntheticConns = [
    ...existingConnections.filter((c) => c.startsWith(targets.connPrefix)),
    ...connectionsToAdd,
  ];
  const hostConns = allSyntheticConns.length > 0 ? allSyntheticConns : [...existingConnections];

  const existingSchemaSet = new Set(existingSchemaKeys);
  const currentSchemaCount = existingSchemas !== null ? existingSchemas : existingSchemaSet.size;
  const schemasNeeded = Math.max(0, targets.minSchemas - currentSchemaCount);
  const schemasToCreate = [];
  let sIdx = 1;
  while (schemasToCreate.length < schemasNeeded && hostConns.length > 0) {
    const conn = hostConns[(sIdx - 1) % hostConns.length];
    const schema = `${targets.schemaPrefix}${String(sIdx).padStart(2, "0")}`;
    sIdx += 1;
    const key = `${conn}/${schema}`;
    if (existingSchemaSet.has(key)) continue;
    existingSchemaSet.add(key);
    schemasToCreate.push({ conn, schema });
  }

  const tablesNeeded = Math.max(0, targets.minTables - existingTables);
  return {
    connectionsToAdd,
    schemasToCreate,
    tablesNeeded,
    targetTables: targets.minTables,
  };
}

/**
 * B2: 按 Lucy / KTX 真实契约（project-template/ktx.yaml）合并合成连接：
 * driver / host / port / database / username / password / schemas / enabled_tables。
 */
export function mergeKtxConnections(rawYamlText, connectionsToAdd, {
  host = "demo-db",
  port = 3306,
  database = DEFAULT_TARGETS.mysqlDb,
  username = "lucy",
  password = "lucy_demo",
  schemasByConn = {},
  sampleTable = "t_00001",
} = {}) {
  const doc = YAML.parse(rawYamlText || "{}") || {};
  if (!doc.connections || typeof doc.connections !== "object") doc.connections = {};
  let added = 0;
  for (const id of connectionsToAdd) {
    if (doc.connections[id]) continue;
    const schemas = Array.isArray(schemasByConn[id]) && schemasByConn[id].length > 0
      ? schemasByConn[id]
      : [database];
    doc.connections[id] = {
      driver: "mysql",
      host,
      port,
      database,
      username,
      password,
      schemas,
      enabled_tables: [`${database}.${sampleTable}`],
    };
    added += 1;
  }
  return { text: YAML.stringify(doc), added };
}

/**
 * B3: 按 Lucy 真实 semantic-layer/<conn>/_schema/<schema>.yaml 契约生成顶层 `{ tables: ... }`。
 */
export function buildSchemaManifestYaml(sampleTable = "t_00001", database = DEFAULT_TARGETS.mysqlDb) {
  return YAML.stringify({
    tables: {
      [sampleTable]: {
        table: `${database}.${sampleTable}`,
        columns: [
          { name: "c0", type: "number", pk: true, nullable: false },
          { name: "c1", type: "number" },
        ],
      },
    },
  });
}

function createRealDeps(env = process.env) {
  const LUCY = env.UAT_LUCY_CONTAINER || "compose-lucy-1";
  const DB = env.UAT_DEMO_DB_CONTAINER || "compose-demo-db-1";
  const MYSQL_ROOT_PW = env.UAT_DEMO_DB_ROOT_PASSWORD || "lucy_demo_root";
  const APP_USER = env.UAT_SCALE_MYSQL_APP_USER || "lucy";

  const dockerOut = (args, input) =>
    execFileSync("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
      input,
      maxBuffer: 512 * 1024 * 1024,
    }).toString().trim();

  const lucyNode = (js, input) => dockerOut(["exec", "-i", LUCY, "node", "-e", js], input);

  return {
    env,
    lucyContainer: LUCY,
    dbContainer: DB,
    running(container) {
      try {
        return dockerOut(["inspect", "-f", "{{.State.Running}}", container]) === "true";
      } catch {
        return false;
      }
    },
    readKtxYaml() {
      return dockerOut(["exec", LUCY, "cat", "/data/lucy/ktx.yaml"]);
    },
    writeKtxYaml(text) {
      const script = [
        'const fs=require("fs");',
        'let buf="";process.stdin.on("data",c=>buf+=c).on("end",()=>{',
        'if(fs.existsSync("/data/lucy/ktx.yaml")&&!fs.existsSync("/data/lucy/ktx.yaml.bak.customer-stability")){',
        'fs.copyFileSync("/data/lucy/ktx.yaml","/data/lucy/ktx.yaml.bak.customer-stability");}',
        'fs.writeFileSync("/data/lucy/ktx.yaml",buf,"utf8");',
        "});",
      ].join("");
      lucyNode(script, text);
    },
    detectSemanticLayerRoot() {
      return dockerOut([
        "exec", LUCY, "sh", "-c",
        'if [ -d /data/lucy/config/semantic-layer ]; then echo /data/lucy/config/semantic-layer; else echo /data/lucy/semantic-layer; fi',
      ]);
    },
    /** B3: 列出真实 `_schema/*.yaml` 文件键（`<conn>/<schema>`）。 */
    listSchemaKeys(root) {
      const js = [
        'const fs=require("fs"),path=require("path");',
        `const root=${JSON.stringify(root)};`,
        "const keys=[];",
        "try{",
        "for(const c of fs.readdirSync(root,{withFileTypes:true})){",
        "if(!c.isDirectory()||c.name.startsWith('.'))continue;",
        'const sdir=path.join(root,c.name,"_schema");',
        "if(!fs.existsSync(sdir))continue;",
        "for(const f of fs.readdirSync(sdir,{withFileTypes:true})){",
        "if(f.isFile()&&/\\.ya?ml$/i.test(f.name)&&!f.name.startsWith('.')){",
        'keys.push(`${c.name}/${f.name.replace(/\\.ya?ml$/i,"")}`);',
        "}}}}",
        "catch{}",
        "console.log(JSON.stringify(keys));",
      ].join("");
      return JSON.parse(lucyNode(js));
    },
    /** B3/N4: 写入 `<root>/<conn>/_schema/<schema>.yaml`，已存在时跳过不覆盖。 */
    writeSchemaManifests(root, entries) {
      const script = [
        'const fs=require("fs"),path=require("path");',
        'let buf="";process.stdin.on("data",c=>buf+=c).on("end",()=>{',
        "const {root,entries}=JSON.parse(buf);",
        "let written=0,skipped=0;",
        "for(const e of entries){",
        'const dir=path.join(root,e.conn,"_schema");',
        "fs.mkdirSync(dir,{recursive:true});",
        'const file=path.join(dir,`${e.schema}.yaml`);',
        "if(fs.existsSync(file)){skipped++;continue;}",
        'fs.writeFileSync(file,e.yaml,"utf8");written++;',
        "}",
        "console.log(JSON.stringify({written,skipped}));",
        "});",
      ].join("");
      return JSON.parse(lucyNode(script, JSON.stringify({ root, entries })));
    },
    countMysqlTables(db) {
      const out = dockerOut([
        "exec", DB, "mysql", "-uroot", `-p${MYSQL_ROOT_PW}`, "-N", "-B", "-e",
        `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${db}';`,
      ]);
      return Number(out) || 0;
    },
    seedMysqlTables(db, targetTables, cols, wideCols) {
      const lines = [
        `CREATE DATABASE IF NOT EXISTS \`${db}\`;`,
        `USE \`${db}\`;`,
      ];
      const colDefs = Array.from({ length: cols }, (_, j) => `c${j} INT`).join(", ");
      for (let i = 1; i <= targetTables; i += 1) {
        lines.push(`CREATE TABLE IF NOT EXISTS t_${String(i).padStart(5, "0")} (${colDefs});`);
      }
      if (wideCols > 0) {
        const wideDefs = Array.from({ length: wideCols }, (_, j) => `c${j} INT`).join(", ");
        lines.push(`CREATE TABLE IF NOT EXISTS w_${wideCols} (${wideDefs});`);
      }
      lines.push(`GRANT SELECT ON \`${db}\`.* TO '${APP_USER}'@'%';`);
      lines.push("FLUSH PRIVILEGES;");
      dockerOut(["exec", "-i", DB, "mysql", "-uroot", `-p${MYSQL_ROOT_PW}`], `${lines.join("\n")}\n`);
    },
    restartLucy() {
      dockerOut(["restart", LUCY]);
    },
    /** B2: 校验 ktx.yaml 写入后连接块均含有效 driver/username/schemas。 */
    verifyKtxConnectionsLoaded() {
      const raw = dockerOut(["exec", LUCY, "cat", "/data/lucy/ktx.yaml"]);
      const parsed = YAML.parse(raw || "{}") || {};
      const conns = parsed.connections || {};
      const invalid = Object.entries(conns)
        .filter(([id, cfg]) => id.startsWith(DEFAULT_TARGETS.connPrefix) && (!cfg?.driver || !cfg?.username || !Array.isArray(cfg?.schemas)))
        .map(([id]) => id);
      return { total: Object.keys(conns).length, invalid };
    },
  };
}

export async function runSeed(argv, deps, io = { log: console.log, error: console.error }) {
  const opts = parseArgs(argv);
  if (opts.error) {
    io.error(`[seed-customer-stability] ${opts.error}`);
    return 2;
  }
  if (!deps.running(deps.lucyContainer) || !deps.running(deps.dbContainer)) {
    io.error(`[seed-customer-stability] 容器未运行：lucy=${deps.lucyContainer} db=${deps.dbContainer}`);
    return 2;
  }

  const rawKtx = deps.readKtxYaml();
  const parsedKtx = YAML.parse(rawKtx || "{}") || {};
  const existingConnections = Object.keys(parsedKtx.connections || {});
  const semRoot = deps.detectSemanticLayerRoot();
  const existingSchemaKeys = deps.listSchemaKeys ? deps.listSchemaKeys(semRoot) : [];
  const existingTables = deps.countMysqlTables(DEFAULT_TARGETS.mysqlDb);

  const plan = planCustomerStabilitySeed({
    existingConnections,
    existingSchemaKeys,
    existingTables,
    targets: DEFAULT_TARGETS,
  });

  io.log(
    `[seed-customer-stability] 现状：connections=${existingConnections.length} schemas=${existingSchemaKeys.length} tables=${existingTables}` +
    ` | 计划新增：connections=+${plan.connectionsToAdd.length} schemas=+${plan.schemasToCreate.length} tables=+${plan.tablesNeeded}`,
  );

  if (opts.dryRun) {
    io.log("[seed-customer-stability] --dry-run 仅预览，未写入任何变更");
    return 0;
  }

  const schemasByConn = {};
  for (const { conn, schema } of plan.schemasToCreate) {
    if (!schemasByConn[conn]) schemasByConn[conn] = [];
    schemasByConn[conn].push(schema);
  }

  let ktxChanged = false;
  if (plan.connectionsToAdd.length > 0) {
    const merged = mergeKtxConnections(rawKtx, plan.connectionsToAdd, { schemasByConn });
    if (merged.added > 0) {
      deps.writeKtxYaml(merged.text);
      ktxChanged = true;
      io.log(`[seed-customer-stability] 已写入 ${merged.added} 个合成连接到 ktx.yaml（原文件已备份）`);
    }
  }

  if (plan.schemasToCreate.length > 0) {
    const entries = plan.schemasToCreate.map(({ conn, schema }) => ({
      conn,
      schema,
      yaml: buildSchemaManifestYaml(),
    }));
    const res = deps.writeSchemaManifests(semRoot, entries);
    io.log(`[seed-customer-stability] 已写入 ${res?.written ?? entries.length} 个 _schema/*.yaml（跳过 ${res?.skipped ?? 0}）到 ${semRoot}`);
  }

  if (plan.tablesNeeded > 0 || opts.force) {
    deps.seedMysqlTables(
      DEFAULT_TARGETS.mysqlDb,
      plan.targetTables,
      DEFAULT_TARGETS.mysqlCols,
      DEFAULT_TARGETS.wideCols,
    );
    const afterTables = deps.countMysqlTables(DEFAULT_TARGETS.mysqlDb);
    io.log(`[seed-customer-stability] MySQL ${DEFAULT_TARGETS.mysqlDb} 现表数：${afterTables}`);
    if (afterTables < DEFAULT_TARGETS.minTables) {
      io.error(`[seed-customer-stability] 补表后仍不足 ${DEFAULT_TARGETS.minTables}：实际 ${afterTables}`);
      return 1;
    }
  }

  if (deps.verifyKtxConnectionsLoaded) {
    const check = deps.verifyKtxConnectionsLoaded();
    if (check.invalid.length > 0) {
      io.error(`[seed-customer-stability] 合成连接字段不合法：${check.invalid.join(",")}`);
      return 1;
    }
  }

  if (ktxChanged && !opts.skipRestart) {
    io.log(`[seed-customer-stability] 重启 ${deps.lucyContainer} 使新连接生效…`);
    deps.restartLucy();
  }

  io.log("[seed-customer-stability] 完成：已满足 customer-stability 造数水位");
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runSeed(process.argv.slice(2), createRealDeps(process.env))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`[seed-customer-stability] 执行异常：${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
