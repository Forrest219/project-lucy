/**
 * Lucy v0.25 P1-3 — SC-02：流带宽度守恒。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md`
 *   §1.3 SC-02「流带宽度严格满足守恒：对任一非凭证节点，入流授权路径数 = 出流授权路径数（误差 0）」
 *   §4.3  每条授权路径在它经过的每一跳上贡献恰好 1 —— 这是流守恒的来源
 *   §10   SC-02 验收方式＝**单元测试：守恒自检**；断言要点＝「对随机权限配置，遍历
 *         所有非凭证节点，断言入流 `grantPaths` == 出流 `grantPaths`（误差 0）」
 *
 * ★ 本文件**不**用实现自带的 `assertFlowConservation` 判定通过。
 *   那是被测代码自己的判据，拿它证明自己通过等于没证明。守恒在这里**独立**地从
 *   公开响应（`response.nodes` / `response.edges`）重算，判据与实现分居两侧。
 *
 * ─── 豁免口径（构造性豁免，不是「测不过就放过」） ──────────────────────────
 *
 * Spec 的字面表述是「对任一**非凭证**节点，入流 == 出流」。但图里三类节点按构造
 * 就不满足「入流 == 出流」，它们是守恒的**端点**而不是断点：
 *
 *   - **源点（Agent）**：入流恒为 0，出流 = 它的授权路径数。Agent 是授权路径的起点。
 *   - **汇点（Table）**：出流恒为 0，入流 = 它的授权路径数。表是授权路径的终点。
 *   - **凭证节点（Token）**：Token 不承载授权（Spec §1.2 G-03），不在流主干上，
 *     入流与出流都是 0。
 *
 * 所以本文件对这三类节点断言的是**它们各自该满足的构造性约束**（源点出流 ==
 * 路径数、汇点入流 == 路径数、凭证点零流），对真正的中间节点（Role / Connection /
 * Schema）断言**入流 == 出流，误差 0**。三类端点一个都没有被跳过断言。
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  buildAccessMap,
  createAdminAccessMapProvider,
  type AccessMapResponse
} from "../admin/access-map.js";
import { commitEffectivePolicy, resetEffectivePolicyForTests } from "../proxy/acl.js";
import { invalidateAccessConfigCache } from "../proxy/identity.js";
import { invalidateContentPathsCache } from "../paths.js";

// ─── 伪随机（确定性种子，保证 CI 可复现） ────────────────────────────────────

type Random = {
  next: () => number;
  int: (min: number, max: number) => number;
  pick: <T>(items: readonly T[]) => T;
  subset: <T>(items: readonly T[], min: number, max: number) => T[];
};

function makeRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
  const subset = <T,>(items: readonly T[], min: number, max: number): T[] => {
    const wanted = int(min, max);
    const pool = [...items];
    const out: T[] = [];
    for (let index = 0; index < wanted && pool.length > 0; index += 1) {
      out.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
    }
    return out;
  };
  return { next, int, pick, subset };
}

// ─── 随机权限配置 ─────────────────────────────────────────────────────────────

type TableRef = { connectionId: string; schema: string; sourceName: string };

type GeneratedProject = {
  accessYaml: string;
  ktxYaml: string;
  manifests: Array<{ file: string; body: string }>;
  tables: TableRef[];
  /** 期望的授权路径数（去重 (Agent, Role, Connection, Schema, Table)）。 */
  expectedPaths: number;
};

function manifestYaml(schema: string, tables: readonly string[]): string {
  return `tables:\n${tables
    .map(
      (table) =>
        `  ${table}:\n    table: ${schema}.${table}\n    columns:\n      - name: id\n        type: number\n      - name: region\n        type: string\n`
    )
    .join("")}`;
}

/**
 * 生成一份随机但**合法**的权限配置。
 *
 * 刻意制造重叠：不同 Role 可能授权同一张表，同一个 Agent 可能挂多个 Role ——
 * 这样「去重表数」与「授权路径数」才会真的不相等，守恒才有意义。
 */
function generateProject(seed: number): GeneratedProject {
  const random = makeRandom(seed);
  const connectionCount = random.int(2, 3);
  const connections: Array<{ id: string; schemas: Array<{ id: string; tables: string[] }> }> = [];

  for (let c = 0; c < connectionCount; c += 1) {
    const schemas: Array<{ id: string; tables: string[] }> = [];
    const schemaCount = random.int(1, 2);
    for (let s = 0; s < schemaCount; s += 1) {
      const tableCount = random.int(1, 3);
      const tables = Array.from({ length: tableCount }, (_, t) => `t${c}_${s}_${t}`);
      schemas.push({ id: `s${c}_${s}`, tables });
    }
    connections.push({ id: `c${c}`, schemas });
  }

  const allTables: TableRef[] = [];
  for (const connection of connections) {
    for (const schema of connection.schemas) {
      for (const sourceName of schema.tables) {
        allTables.push({ connectionId: connection.id, schema: schema.id, sourceName });
      }
    }
  }

  const roleCount = random.int(2, 5);
  const roles: string[] = Array.from({ length: roleCount }, (_, r) => `r${r}`);

  const roleBlocks: string[] = [];
  for (const roleId of roles) {
    const selectors: string[] = [];
    // 一个 Role 可以授权多张表（分属不同 Schema），也可以只授权一张。
    const picked = random.subset(allTables, 1, Math.min(3, allTables.length));
    for (const table of picked) {
      const scoped = random.next() < 0.5;
      const rowAccess = scoped ? "scoped" : "all";
      const rowPolicy = scoped
        ? `\n          row_policy:\n            predicates:\n              - { field: region, op: eq, value: ${random.pick(["East", "West", "North"])} }`
        : "";
      selectors.push(
        `        - connection: ${table.connectionId}\n          schema: ${table.schema}\n          names: [${table.sourceName}]\n          row_access: ${rowAccess}${rowPolicy}`
      );
    }
    roleBlocks.push(
      `  ${roleId}:\n    permission_model_version: 2\n    allow:\n      connections: [${[
        ...new Set(picked.map((t) => t.connectionId))
      ].join(", ")}]\n      tableSelectors:\n${selectors.join("\n")}\n      tools: [lucy_query]`
    );
  }

  const agentCount = random.int(1, 4);
  const userBlocks: string[] = [];
  const agentRoleSets: string[][] = [];
  for (let a = 0; a < agentCount; a += 1) {
    const agentRoles = random.subset(roles, 1, roles.length);
    agentRoleSets.push(agentRoles);
    userBlocks.push(
      `  - { id: a${a}, name: A ${a}, enabled: true, roles: [${agentRoles.join(", ")}], tokens: [] }`
    );
  }

  const accessYaml = `roles:\n${roleBlocks.join("\n")}\nusers:\n${userBlocks.join("\n")}\ndefaults:\n  known_tools: [lucy_query, lucy_catalog, wiki_search, wiki_read]\n  table_touching_tools: [lucy_query]\n`;

  const enabledTables = connections.map((connection) => {
    const entries = connection.schemas.flatMap((schema) =>
      schema.tables.map((table) => `      - ${schema.id}.${table}`)
    );
    return `  ${connection.id}:\n    driver: mysql\n    enabled_tables:\n${entries.join("\n")}`;
  });
  const ktxYaml = `connections:\n${enabledTables.join("\n")}\n`;

  const manifests: Array<{ file: string; body: string }> = [];
  for (const connection of connections) {
    for (const schema of connection.schemas) {
      manifests.push({
        file: path.join("semantic-layer", connection.id, "_schema", `${schema.id}.yaml`),
        body: manifestYaml(schema.id, schema.tables)
      });
    }
  }

  // 期望的授权路径数：去重 (Agent, Role, Connection, Schema, Table)。
  const pathKeys = new Set<string>();
  for (let a = 0; a < agentRoleSets.length; a += 1) {
    for (const roleId of agentRoleSets[a]) {
      const roleBlock = roleBlocks.find((block) => block.startsWith(`  ${roleId}:`));
      if (!roleBlock) continue;
      const names = [...roleBlock.matchAll(/names: \[([^\]]+)\]/g)].map((m) => m[1].trim());
      const connections = [...roleBlock.matchAll(/connection: ([^\s]+)/g)].map((m) => m[1]);
      const schemas = [...roleBlock.matchAll(/schema: ([^\s]+)/g)].map((m) => m[1]);
      for (let i = 0; i < names.length; i += 1) {
        pathKeys.add(
          `a${a}|${roleId}|${connections[i]}|${schemas[i]}|${names[i]}`
        );
      }
    }
  }

  return {
    accessYaml,
    ktxYaml,
    manifests,
    tables: allTables,
    expectedPaths: pathKeys.size
  };
}

// ─── 守恒判定（独立于实现） ──────────────────────────────────────────────────

type ConservationReport = {
  violations: string[];
  checkedIntermediate: number;
  checkedSource: number;
  checkedSink: number;
  checkedCredential: number;
  agentOut: number;
  tableIn: number;
};

function checkConservation(response: AccessMapResponse): ConservationReport {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const edge of response.edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + edge.grantPaths);
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + edge.grantPaths);
  }

  const violations: string[] = [];
  let checkedIntermediate = 0;
  let checkedSource = 0;
  let checkedSink = 0;
  let checkedCredential = 0;

  for (const node of response.nodes) {
    const inSum = incoming.get(node.id) ?? 0;
    const outSum = outgoing.get(node.id) ?? 0;
    const paths = node.meta.grantPaths ?? 0;

    if (node.kind === "token") {
      checkedCredential += 1;
      // 凭证节点不承载授权，不在流主干上：既无入流也无出流。
      if (inSum !== 0 || outSum !== 0) {
        violations.push(`${node.id}: 凭证节点带流（入 ${inSum} / 出 ${outSum}）`);
      }
      continue;
    }

    if (inSum === 0 && outSum === 0) continue;

    if (inSum === 0) {
      // 源点：出流必须恰好等于该节点的授权路径数。
      checkedSource += 1;
      if (outSum !== paths) {
        violations.push(`${node.id}: 源点出流 ${outSum} != 路径数 ${paths}`);
      }
      continue;
    }

    if (outSum === 0) {
      // 汇点：入流必须恰好等于该节点的授权路径数。
      checkedSink += 1;
      if (inSum !== paths) {
        violations.push(`${node.id}: 汇点入流 ${inSum} != 路径数 ${paths}`);
      }
      continue;
    }

    // 中间节点：入流 == 出流，误差 0。
    checkedIntermediate += 1;
    if (inSum !== outSum) {
      violations.push(`${node.id}: 入流 ${inSum} != 出流 ${outSum}`);
    }
  }

  const agentOut = response.edges
    .filter((edge) => edge.source.startsWith("agent:"))
    .reduce((sum, edge) => sum + edge.grantPaths, 0);
  const tableIn = response.edges
    .filter((edge) => edge.target.startsWith("table:"))
    .reduce((sum, edge) => sum + edge.grantPaths, 0);
  if (agentOut !== tableIn) {
    violations.push(`Agent 出流合计 ${agentOut} != Table 入流合计 ${tableIn}`);
  }

  return {
    violations,
    checkedIntermediate,
    checkedSource,
    checkedSink,
    checkedCredential,
    agentOut,
    tableIn
  };
}

// ─── 夹具 ────────────────────────────────────────────────────────────────────

/** 访问面用不到（SC-02 只看授权骨架），但 provider 需要一个能打开的审计库。 */
function openEmptyAuditDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      user_id TEXT NOT NULL,
      matched_role_id TEXT,
      role_ids TEXT,
      token_label TEXT,
      outcome TEXT NOT NULL,
      permission_snapshot_hash TEXT,
      capability_digest TEXT,
      association_status TEXT
    );
    CREATE TABLE access_log_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      access_log_id INTEGER NOT NULL,
      connection_id TEXT,
      schema_name TEXT,
      source_name TEXT
    );
    CREATE TABLE permission_snapshots (
      hash TEXT PRIMARY KEY,
      roles_json TEXT,
      resolved_json TEXT,
      capability_digest TEXT
    );
  `);
  return db;
}

const SEEDS = [1, 7, 42, 1337, 20261025];

let projectRoot: string;
const savedEnv = {
  root: process.env.KTX_PROJECT_ROOT,
  content: process.env.LUCY_CONTENT_ROOT,
  access: process.env.LUCY_ACCESS_CONFIG_PATH
};

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-access-map-conservation-"));
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  delete process.env.LUCY_ACCESS_CONFIG_PATH;
  invalidateContentPathsCache();
  invalidateAccessConfigCache();
  resetEffectivePolicyForTests();
});

afterEach(async () => {
  for (const [key, value] of [
    ["KTX_PROJECT_ROOT", savedEnv.root],
    ["LUCY_CONTENT_ROOT", savedEnv.content],
    ["LUCY_ACCESS_CONFIG_PATH", savedEnv.access]
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  invalidateContentPathsCache();
  invalidateAccessConfigCache();
  resetEffectivePolicyForTests();
  await rm(projectRoot, { recursive: true, force: true });
});

async function materialize(project: GeneratedProject): Promise<void> {
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), project.ktxYaml, "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), project.accessYaml, "utf8");
  for (const manifest of project.manifests) {
    const target = path.join(projectRoot, manifest.file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, manifest.body, "utf8");
  }
}

describe("P1-3 §10 — SC-02 流带宽度守恒", () => {
  it("SC-02 — 随机权限配置下，非凭证节点的入流授权路径数 == 出流授权路径数（误差 0）", async () => {
    const db = openEmptyAuditDb();
    const provider = createAdminAccessMapProvider({ projectRoot, openAuditDb: async () => db });

    let totalIntermediate = 0;
    let totalSource = 0;
    let totalSink = 0;
    let overlappingSeedSeen = false;

    for (const seed of SEEDS) {
      const project = generateProject(seed);
      await materialize(project);
      invalidateContentPathsCache();
      invalidateAccessConfigCache();
      resetEffectivePolicyForTests();
      await commitEffectivePolicy();

      for (const layer of ["flat", "schema"] as const) {
        const response = await buildAccessMap(provider, {
          agent: null,
          role: null,
          token: null,
          table: null,
          connection: null,
          window: "168h",
          layer,
          trust: "confirmed",
          view: "map",
          focus: null
        });

        expect(response.meta.grant.state, `seed=${seed} layer=${layer}`).toBe("ok");

        const report = checkConservation(response);
        expect(report.violations, `seed=${seed} layer=${layer} → ${report.violations.join("; ")}`).toEqual(
          []
        );

        // 守恒不是空断言：每个种子都必须真的走到中间节点、源点、汇点三类。
        expect(report.checkedIntermediate).toBeGreaterThan(0);
        expect(report.checkedSource).toBeGreaterThan(0);
        expect(report.checkedSink).toBeGreaterThan(0);

        // 全局守恒：Agent 出流合计 == Table 入流合计 == 去重授权路径数。
        expect(report.agentOut).toBe(response.meta.counts.grantPaths);
        expect(report.tableIn).toBe(response.meta.counts.grantPaths);
        expect(response.meta.counts.grantPaths).toBe(project.expectedPaths);

        if (layer === "flat") {
          totalIntermediate += report.checkedIntermediate;
          totalSource += report.checkedSource;
          totalSink += report.checkedSink;
          // 至少要有一个种子出现「授权路径数 != 去重表数」：那说明真的生成了
          // 重叠授权（同一个 Agent 挂多个 Role 授权同一张表），守恒是在**有分叉**
          // 的图上成立的，不是在一条直链上成立的。
          if (response.meta.counts.grantPaths !== response.meta.counts.tables) {
            overlappingSeedSeen = true;
          }
        }
      }
    }

    // 跨种子合计：三类节点都被真的断言过，不是「一次都没触发」的假绿。
    expect(totalIntermediate).toBeGreaterThan(0);
    expect(totalSource).toBeGreaterThan(0);
    expect(totalSink).toBeGreaterThan(0);
    expect(overlappingSeedSeen).toBe(true);

    db.close();
  });

  it("SC-02 反向验证 — 篡改一条边的宽度后守恒判定必须变红", async () => {
    // 这条不是验收项，是**自检**：证明上面的守恒判定真的有牙齿，
    // 而不是「怎么算都通过」。把一条边的 grantPaths 改大 1，入流/出流立刻失衡。
    const project = generateProject(42);
    await materialize(project);
    invalidateContentPathsCache();
    invalidateAccessConfigCache();
    resetEffectivePolicyForTests();
    await commitEffectivePolicy();

    const db = openEmptyAuditDb();
    const provider = createAdminAccessMapProvider({ projectRoot, openAuditDb: async () => db });
    const response = await buildAccessMap(provider, {
      agent: null,
      role: null,
      token: null,
      table: null,
      connection: null,
      window: "168h",
      layer: "flat",
      trust: "confirmed",
      view: "map",
      focus: null
    });

    expect(checkConservation(response).violations).toEqual([]);

    const tampered = {
      ...response,
      edges: response.edges.map((edge, index) =>
        index === 0 ? { ...edge, grantPaths: edge.grantPaths + 1 } : edge
      )
    };
    const broken = checkConservation(tampered);
    expect(broken.violations.length).toBeGreaterThan(0);
    expect(broken.violations.join(" ")).toMatch(/入流|出流|合计/);

    db.close();
  });
});
