#!/usr/bin/env node
/**
 * Spec 149 §9 SC-21 — 用**仓库里的语义模板**在临时 SQLite 上执行真实语义查询。
 *
 * 覆盖：UTC 日过滤、四个指标、按表过滤后的生成 SQL 明细，以及「Manifest 不含
 * `call_day`」。
 *
 * 必须用镜像 `ARG KTX_VERSION` 钉住的 KTX 版本执行：版本不同则**不执行**并说明
 * 原因（T0 的要求）。本机其它版本的 CLI 结果作废。
 *
 * 用法：
 *   node scripts/smoke/ops-evidence-semantic-query.mjs
 *   LUCY_KTX_BIN=/path/to/ktx node scripts/smoke/ops-evidence-semantic-query.mjs
 *
 * 退出码：0 通过 / 1 失败 / 2 未执行（缺少钉住的 KTX CLI）。
 */

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const webuiRoot = path.join(repoRoot, "webui");
const opsEvidenceCli = path.join(webuiRoot, "server", "ops-evidence", "cli.ts");
const tsxBin = path.join(webuiRoot, "node_modules", ".bin", "tsx");
const templateRoot = path.join(webuiRoot, "config", "ops-evidence");

/** 镜像钉住的 KTX 版本（T0 的唯一依据）。 */
async function pinnedKtxVersion() {
  const dockerfile = await readFile(path.join(repoRoot, "Dockerfile"), "utf8");
  const match = dockerfile.match(/^ARG KTX_VERSION=(\S+)$/m);
  if (!match) throw new Error("Dockerfile has no ARG KTX_VERSION");
  return match[1];
}

function resolveKtxBin() {
  if (process.env.LUCY_KTX_BIN) return process.env.LUCY_KTX_BIN;
  const local = path.join(webuiRoot, "node_modules", ".bin", "ktx");
  if (existsSync(local)) return local;
  return "ktx";
}

function ktxVersion(bin) {
  const result = spawnSync(bin, ["--version"], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const match = result.stdout.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function runKtx(bin, args, cwd) {
  const result = spawnSync(bin, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `ktx ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`
    );
  }
  return result.stdout;
}

const FIXTURE_ROWS = [
  {
    ts: "2026-10-20T08:00:00.000Z",
    user: "agent_a",
    token: "desktop",
    outcome: "denied",
    reason: "row_policy_denied",
    sql: "SELECT * FROM superstore_orders",
    duration: 120,
    requestId: "req-e1",
    source: { connection: "demo-mysql", schema: "dataforai", name: "superstore_orders", table: "dataforai.superstore_orders" }
  },
  {
    ts: "2026-10-21T09:00:00.000Z",
    user: "agent_b",
    token: "laptop",
    outcome: "error",
    reason: "upstream_error",
    sql: "SELECT * FROM superstore_returns",
    duration: 900,
    requestId: "req-e2",
    source: { connection: "demo-mysql", schema: "dataforai", name: "superstore_returns", table: "dataforai.superstore_returns" }
  },
  {
    ts: "2026-10-23T11:00:00.000Z",
    user: "agent_d",
    token: "desktop",
    outcome: "ok",
    reason: null,
    sql: "SELECT * FROM superstore_orders",
    duration: 200,
    requestId: "req-e5",
    source: { connection: "demo-mysql", schema: "dataforai", name: "superstore_orders", table: "dataforai.superstore_orders" }
  }
];

function seed(db) {
  const insert = db.prepare(
    `INSERT INTO access_log
       (ts, user_id, token_label, tool, tables, args_summary, outcome, error_detail,
        duration_ms, request_id, decision_reason, generated_sql, eval_mark)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const insertSource = db.prepare(
    `INSERT INTO access_log_sources
       (access_log_id, ts, user_id, tool, connection_id, schema_name, source_name,
        physical_table, extraction_method, confidence, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  for (const row of FIXTURE_ROWS) {
    const id = insert.run(
      row.ts, row.user, row.token, "lucy_query", JSON.stringify([row.source.name]),
      JSON.stringify({ connection: row.source.connection }), row.outcome,
      row.outcome === "error" ? "timeout" : null, row.duration, row.requestId,
      row.reason, row.sql, null
    ).lastInsertRowid;
    insertSource.run(
      id, row.ts, row.user, "lucy_query", row.source.connection, row.source.schema,
      row.source.name, row.source.table, "explicit", "high", row.ts
    );
  }
}

function assertRows(rows, expected, label) {
  const actual = JSON.stringify(rows);
  const want = JSON.stringify(expected);
  if (actual !== want) {
    throw new Error(`${label}: expected ${want}, got ${actual}`);
  }
  console.log(`[ops-evidence-semantic] ${label}: ${actual}`);
}

async function main() {
  const pinned = await pinnedKtxVersion();
  const ktxBin = resolveKtxBin();
  const version = ktxVersion(ktxBin);
  if (!version) {
    console.log(
      `[ops-evidence-semantic] NOT RUN: no usable ktx CLI (${ktxBin}); ` +
        `install @kaelio/ktx@${pinned} or set LUCY_KTX_BIN`
    );
    return 2;
  }
  if (version !== pinned) {
    console.log(
      `[ops-evidence-semantic] NOT RUN: ktx ${version} is not the pinned ${pinned}; ` +
        "T0 results from another version do not count"
    );
    return 2;
  }
  if (!existsSync(tsxBin)) {
    console.log("[ops-evidence-semantic] NOT RUN: tsx is not installed in webui/node_modules");
    return 2;
  }

  const root = await mkdtemp(path.join(tmpdir(), "lucy-ops-evidence-semantic-"));
  const projectRoot = path.join(root, "project");
  const auditDbPath = path.join(root, "audit.sqlite");
  try {
    await mkdir(path.join(projectRoot), { recursive: true });
    await writeFile(
      path.join(projectRoot, "ktx.yaml"),
      `connections:
  demo-mysql:
    driver: mysql
    enabled_tables:
      - dataforai.superstore_orders
      - dataforai.superstore_returns
    schemas:
      - dataforai
`,
      "utf8"
    );

    // 1) 用**实现的确保路径**建库、建视图、写连接块、复制语义资产并镜像。
    const ensure = spawnSync(tsxBin, [opsEvidenceCli, "ensure"], {
      cwd: webuiRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        KTX_PROJECT_ROOT: projectRoot,
        LUCY_CONTENT_ROOT: path.join(projectRoot, "config"),
        LUCY_AUDIT_DB: auditDbPath
      }
    });
    if (ensure.status !== 0) {
      throw new Error(`ensure failed (${ensure.status}): ${ensure.stderr || ensure.stdout}`);
    }
    console.log(`[ops-evidence-semantic] ${ensure.stdout.trim().split("\n").pop()}`);

    // 2) 夹具行（写死 UTC 时间戳）。
    const db = new Database(auditDbPath);
    try {
      seed(db);
    } finally {
      db.close();
    }

    // 3) 连接块：只读、sqlite、启用表用冻结的 physicalTable。
    const ktxYaml = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    if (!/driver: sqlite/.test(ktxYaml)) throw new Error("connection block is not sqlite");
    if (!/readonly: true/.test(ktxYaml)) throw new Error("connection block is not read-only");
    if (!/- ops_calls/.test(ktxYaml)) throw new Error("enabled_tables misses ops_calls");

    // 4) 语义模板在内容根与项目根两侧都在。
    for (const rel of [
      path.join("semantic-layer", "lucy-ops", "_schema", "main.yaml"),
      path.join("semantic-layer", "lucy-ops", "ops_calls.yaml"),
      path.join("semantic-layer", "lucy-ops", "ops_call_tables.yaml")
    ]) {
      if (!existsSync(path.join(projectRoot, "config", rel))) {
        throw new Error(`content root misses ${rel}`);
      }
      if (!existsSync(path.join(projectRoot, rel))) {
        throw new Error(`project root mirror misses ${rel}`);
      }
    }

    // 5) Manifest 不含 call_day（派生列只写在 overlay）。
    const manifest = await readFile(
      path.join(projectRoot, "semantic-layer", "lucy-ops", "_schema", "main.yaml"),
      "utf8"
    );
    if (/^\s*-\s*name:\s*call_day\s*$/m.test(manifest)) {
      throw new Error("the manifest must not declare call_day");
    }

    // 6) 语义查询：四个指标 + UTC 日历日。
    const measures = runKtx(
      ktxBin,
      [
        "--project-dir", projectRoot,
        "sl", "--connection-id", "lucy-ops", "query",
        "--measure", "ops_calls.call_count",
        "--measure", "ops_calls.denied_count",
        "--measure", "ops_calls.error_count",
        "--measure", "ops_calls.total_duration_ms",
        "--dimension", "ops_calls.call_day",
        "--execute", "--yes"
      ],
      repoRoot
    );
    const parsed = JSON.parse(measures);
    assertRows(
      parsed.rows,
      [
        ["2026-10-20", 1, 1, 0, 120],
        ["2026-10-21", 1, 0, 1, 900],
        ["2026-10-23", 1, 0, 0, 200]
      ],
      "four measures grouped by the UTC calendar day"
    );

    // 7) UTC 日过滤。
    const filtered = runKtx(
      ktxBin,
      [
        "--project-dir", projectRoot,
        "sl", "--connection-id", "lucy-ops", "query",
        "--measure", "ops_calls.call_count",
        "--dimension", "ops_calls.call_day",
        "--filter", "ops_calls.call_day >= '2026-10-21'",
        "--execute", "--yes"
      ],
      repoRoot
    );
    assertRows(
      JSON.parse(filtered).rows,
      [["2026-10-21", 1], ["2026-10-23", 1]],
      "UTC day filter"
    );

    // 8) 按表过滤后的生成 SQL 明细。
    const detail = runKtx(
      ktxBin,
      [
        "--project-dir", projectRoot,
        "sl", "--connection-id", "lucy-ops", "query",
        "--measure", "ops_call_tables.call_count",
        "--dimension", "ops_call_tables.generated_sql",
        "--dimension", "ops_call_tables.agent_id",
        "--dimension", "ops_call_tables.physical_table",
        "--filter", "ops_call_tables.physical_table = 'dataforai.superstore_orders'",
        "--execute", "--yes"
      ],
      repoRoot
    );
    assertRows(
      JSON.parse(detail).rows,
      [
        ["SELECT * FROM superstore_orders", "agent_a", "dataforai.superstore_orders", 1],
        ["SELECT * FROM superstore_orders", "agent_d", "dataforai.superstore_orders", 1]
      ],
      "filtered generated SQL detail"
    );

    const entries = await readdir(path.join(projectRoot, "skills", "lucy-ops"));
    if (!entries.includes("ops-questioning.md")) {
      throw new Error("the project root mirror misses the ops-questioning skill");
    }

    console.log(`\n[ops-evidence-semantic] PASS (ktx ${version})`);
    return 0;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`\n[ops-evidence-semantic] FAIL: ${error.message}`);
    process.exitCode = 1;
  });
