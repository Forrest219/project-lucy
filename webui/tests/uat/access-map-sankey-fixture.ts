/**
 * UAT-SUITE-ACCESS-MAP-SANKEY fixture — deterministic grant + audit data for
 * reproducing the Access Map (访问关系图) Sankey visually.
 *
 * Pure data + writers. No server import: callers pass an already-migrated audit
 * database. Safe to run against both old and current server code (only columns
 * that exist in both are written). Throwaway lab data; no customer content.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";

export const SANKEY_PROFILES = ["grants-only", "sparse", "rich", "candidate-only", "dense"] as const;
export type SankeyProfile = (typeof SANKEY_PROFILES)[number];

interface Conn { id: string; driver: string; schema: string; tables: string[] }
interface RoleDef { id: string; grants: Array<{ conn: string; tables: string[] }> }
interface AgentDef { id: string; name: string; roles: string[] }
interface Call { agent: string; role: string; conn: string; table: string; count: number; outcome?: "ok" | "denied" }
export interface SankeyDataset { conns: Conn[]; roles: RoleDef[]; agents: AgentDef[]; calls: Call[] }

const names = (prefix: string, n: number, pad = 3) =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(pad, "0")}`);

const CONNS: Conn[] = [
  { id: "sales_mysql", driver: "mysql", schema: "sales", tables: ["orders", "order_items", "customers", "products", "returns", "refunds", "promotions", "stores", "regions", "shipments", "inventory", "suppliers"] },
  { id: "finance_mysql", driver: "mysql", schema: "fin", tables: ["ledger", "invoices", "payments", "budgets", "forecasts", "tax_rates", "cost_centers", "fx_rates"] },
  { id: "hr_pg", driver: "postgres", schema: "hr", tables: ["employees", "payroll", "attendance", "org_units"] },
  { id: "warehouse_dw", driver: "mysql", schema: "dw", tables: names("dw_fact_", 120) }
];
const tablesOf = (id: string) => CONNS.find((c) => c.id === id)!.tables;

const ROLES: RoleDef[] = [
  { id: "sales_analyst", grants: [{ conn: "sales_mysql", tables: tablesOf("sales_mysql") }] },
  { id: "finance_reader", grants: [{ conn: "finance_mysql", tables: tablesOf("finance_mysql") }] },
  { id: "hr_reader", grants: [{ conn: "hr_pg", tables: tablesOf("hr_pg") }] },
  // "Wide card": the 何老师 shape — one role granting 132 tables across two connections.
  { id: "wide_catalog", grants: [{ conn: "warehouse_dw", tables: tablesOf("warehouse_dw") }, { conn: "sales_mysql", tables: tablesOf("sales_mysql") }] }
];

const BASE_AGENTS: AgentDef[] = [
  { id: "hehe", name: "何老师", roles: ["wide_catalog"] },
  { id: "zhangxc", name: "张星辰", roles: ["sales_analyst"] },
  { id: "fin_bot", name: "财务机器人", roles: ["finance_reader"] },
  { id: "ops_mixed", name: "复合角色 Agent", roles: ["sales_analyst", "finance_reader"] },
  { id: "idle_bot", name: "闲置 Agent", roles: ["hr_reader"] },
  { id: "review_bot", name: "越界探访 Agent", roles: ["sales_analyst"] }
];

const c = (agent: string, role: string, conn: string, table: string, count: number, outcome?: "ok" | "denied"): Call =>
  ({ agent, role, conn, table, count, outcome });

const SPARSE: Call[] = [
  c("hehe", "wide_catalog", "warehouse_dw", "dw_fact_007", 12),
  c("hehe", "wide_catalog", "sales_mysql", "orders", 5),
  c("zhangxc", "sales_analyst", "sales_mysql", "orders", 30),
  c("zhangxc", "sales_analyst", "sales_mysql", "customers", 8)
];

const RICH: Call[] = [
  ...SPARSE,
  c("hehe", "wide_catalog", "warehouse_dw", "dw_fact_033", 9),
  c("hehe", "wide_catalog", "warehouse_dw", "dw_fact_090", 2),
  c("zhangxc", "sales_analyst", "sales_mysql", "order_items", 20),
  c("zhangxc", "sales_analyst", "sales_mysql", "products", 9),
  c("zhangxc", "sales_analyst", "sales_mysql", "returns", 4),
  c("zhangxc", "sales_analyst", "sales_mysql", "stores", 2),
  c("fin_bot", "finance_reader", "finance_mysql", "ledger", 25),
  c("fin_bot", "finance_reader", "finance_mysql", "invoices", 14),
  c("fin_bot", "finance_reader", "finance_mysql", "payments", 6),
  c("fin_bot", "finance_reader", "finance_mysql", "budgets", 3),
  c("ops_mixed", "sales_analyst", "sales_mysql", "orders", 7),
  c("ops_mixed", "sales_analyst", "sales_mysql", "customers", 3),
  c("ops_mixed", "finance_reader", "finance_mysql", "ledger", 5),
  c("ops_mixed", "finance_reader", "finance_mysql", "fx_rates", 2),
  c("review_bot", "sales_analyst", "sales_mysql", "orders", 4),
  // Outside the granted set → needs_review (grantPaths==0, accessPaths>0).
  c("review_bot", "sales_analyst", "finance_mysql", "ledger", 3),
  // Denied calls count only toward deniedCalls, never toward an access path.
  c("zhangxc", "sales_analyst", "hr_pg", "payroll", 2, "denied")
];

/** Small deterministic PRNG (mulberry32) so `dense` is identical on every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function denseExtras(): { agents: AgentDef[]; calls: Call[] } {
  const rand = prng(20261117);
  const agents: AgentDef[] = [];
  const calls: Call[] = [];
  for (let i = 1; i <= 36; i += 1) {
    const id = `dense_${String(i).padStart(2, "0")}`;
    const role = i % 9 === 0 ? "hr_reader" : i % 2 === 0 ? "finance_reader" : "sales_analyst";
    const conn = role === "hr_reader" ? "hr_pg" : role === "finance_reader" ? "finance_mysql" : "sales_mysql";
    agents.push({ id, name: `批量 Agent ${String(i).padStart(2, "0")}`, roles: [role] });
    const pool = tablesOf(conn);
    for (const t of new Set(Array.from({ length: 4 }, () => pool[Math.floor(rand() * pool.length)]))) {
      calls.push(c(id, role, conn, t, 1 + Math.floor(rand() * 20)));
    }
  }
  return { agents, calls };
}

export function buildDataset(profile: SankeyProfile): SankeyDataset {
  if (profile === "grants-only") return { conns: CONNS, roles: ROLES, agents: BASE_AGENTS, calls: [] };
  if (profile === "sparse") return { conns: CONNS, roles: ROLES, agents: BASE_AGENTS, calls: SPARSE };
  if (profile === "dense") {
    const extra = denseExtras();
    return { conns: CONNS, roles: ROLES, agents: [...BASE_AGENTS, ...extra.agents], calls: [...RICH, ...extra.calls] };
  }
  return { conns: CONNS, roles: ROLES, agents: BASE_AGENTS, calls: RICH };
}

/** Counts a correct implementation must report with inquiryKind=all&accessGrade=all. */
export function expectedCounts(profile: SankeyProfile, data = buildDataset(profile)) {
  const grant = new Set<string>();
  for (const a of data.agents) {
    for (const rid of a.roles) {
      for (const g of data.roles.find((r) => r.id === rid)!.grants) {
        for (const t of g.tables) grant.add(`${a.id}|${rid}|${g.conn}|${t}`);
      }
    }
  }
  const confirmed = profile !== "candidate-only";
  const ok = data.calls.filter((x) => (x.outcome ?? "ok") === "ok");
  const access = new Set(ok.map((x) => `${x.agent}|${x.role}|${x.conn}|${x.table}`));
  const needsReview = [...access].filter((k) => !grant.has(k)).length;
  const sum = (xs: Call[]) => xs.reduce((n, x) => n + x.count, 0);
  return {
    profile,
    agents: data.agents.length,
    grantPaths: grant.size,
    accessPaths: confirmed ? access.size : 0,
    needsReviewPaths: confirmed ? needsReview : 0,
    rawCalls: confirmed ? sum(ok) : 0,
    deniedCalls: confirmed ? sum(data.calls.filter((x) => x.outcome === "denied")) : 0,
    seededCalls: sum(data.calls),
    associationStatus: confirmed ? "confirmed" : "candidate (confirmed-only gate drops every row)"
  };
}

const sha = (s: string) => `sha256:${createHash("sha256").update(s).digest("hex")}`;

/** Writes ktx.yaml, semantic-layer manifests and webui/config/access.yaml under `root`. */
export async function writeProject(root: string, data: SankeyDataset): Promise<void> {
  const ktx = ["connections:"];
  for (const k of data.conns) {
    ktx.push(`  ${k.id}:`, `    driver: ${k.driver}`, "    host: sandbox.invalid", "    port: 3306", `    database: ${k.schema}`,
      "    username: sandbox", "    password: sandbox", "    enabled_tables:", ...k.tables.map((t) => `      - ${k.schema}.${t}`),
      "    schemas:", `      - ${k.schema}`);
  }
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), `${ktx.join("\n")}\n`);
  for (const k of data.conns) {
    const dir = path.join(root, "config", "semantic-layer", k.id, "_schema");
    await mkdir(dir, { recursive: true });
    const body = ["tables:", ...k.tables.flatMap((t) => [`  ${t}:`, `    table: ${k.schema}.${t}`, "    descriptions:", `      db: sandbox table ${k.schema}.${t}`])];
    await writeFile(path.join(dir, `${k.schema}.yaml`), `${body.join("\n")}\n`);
  }
  const tools = ["lucy_catalog", "lucy_query", "lucy_read_source", "lucy_explain_query", "lucy_begin_question", "connection_list"];
  const y = ["roles:"];
  for (const r of data.roles) {
    y.push(`  ${r.id}:`, `    description: UAT sankey role ${r.id}`, "    allow:", "      connections:", ...r.grants.map((g) => `        - ${g.conn}`), "      tableSelectors:");
    for (const g of r.grants) {
      y.push(`        - connection: ${g.conn}`, `          schema: ${data.conns.find((k) => k.id === g.conn)!.schema}`, "          names:", ...g.tables.map((t) => `            - ${t}`));
    }
    y.push("      tools:", ...tools.map((t) => `        - ${t}`));
  }
  y.push("users:");
  for (const a of data.agents) {
    y.push(`  - id: ${a.id}`, `    name: ${a.name}`, "    enabled: true", "    tokens:", `      - hash: "${sha(`uat-sankey-${a.id}`)}"`, `        label: tok-${a.id}`, "        created: 2026-11-17");
    y.push(a.roles.length === 1 ? `    role: ${a.roles[0]}` : `    roles: [${a.roles.join(", ")}]`);
  }
  const known = ["lucy_query", "lucy_read_source", "lucy_explain_query", "lucy_catalog", "lucy_freshness", "lucy_begin_question", "lucy_continue_question",
    "wiki_search", "wiki_read", "entity_details", "dictionary_search", "discover_data", "connection_list", "kx_catalog", "sl_query", "sl_read_source",
    "sl_validate", "sql_execution", "sql_dialect_notes", "memory_ingest", "memory_ingest_status"];
  y.push("defaults:", "  deny_tools:", ...["sql_execution", "sql_dialect_notes", "memory_ingest", "memory_ingest_status", "sl_query", "sl_read_source"].map((t) => `    - ${t}`),
    "  known_tools:", ...known.map((t) => `    - ${t}`),
    "  table_touching_tools:", ...["lucy_query", "lucy_read_source", "lucy_explain_query", "lucy_freshness", "entity_details", "sl_validate", "sl_query", "sl_read_source"].map((t) => `    - ${t}`),
    "  sensitive_metadata_tools:", "    - dictionary_search", "    - discover_data", "  sensitive_table_prefixes: []");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), `${y.join("\n")}\n`);
}

/** Inserts audit rows for `profile` into an already-migrated audit database (idempotent per call). */
export function seedAudit(db: Database.Database, profile: SankeyProfile, data = buildDataset(profile), now = Date.now()): number {
  const status = profile === "candidate-only" ? "candidate" : "confirmed";
  const insLog = db.prepare(`INSERT INTO access_log (ts, user_id, token_label, tool, outcome, duration_ms, request_id, lucy_turn_id,
    role_ids, matched_role_id, association_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insSrc = db.prepare(`INSERT INTO access_log_sources (access_log_id, ts, user_id, tool, connection_id, schema_name, source_name,
    physical_table, extraction_method, confidence, created_at) VALUES (?,?,?,?,?,?,?,?,'args','high',?)`);
  const insTurn = db.prepare(`INSERT OR IGNORE INTO conversation_turns (turn_id, session_id, user_id, question_source, question_summary, created_at)
    VALUES (?,?,?,'reported',?,?)`);
  let n = 0;
  db.transaction(() => {
    for (const call of data.calls) {
      const schema = data.conns.find((k) => k.id === call.conn)!.schema;
      for (let i = 0; i < call.count; i += 1) {
        n += 1;
        const ts = new Date(now - ((n * 37) % (150 * 60)) * 60_000).toISOString();
        const turn = `uat-sankey-turn-${n}`;
        const tool = n % 3 === 0 ? "lucy_read_source" : "lucy_query";
        insTurn.run(turn, `uat-sankey-sess-${call.agent}`, call.agent, `UAT sankey question ${n}`, ts);
        const r = insLog.run(ts, call.agent, `tok-${call.agent}`, tool, call.outcome === "denied" ? "denied" : "ok", 12 + (n % 60),
          `uat-sankey-req-${n}`, turn, JSON.stringify([call.role]), call.role, profile === "candidate-only" && n % 2 ? null : status);
        insSrc.run(r.lastInsertRowid, ts, call.agent, tool, call.conn, schema, call.table, `${schema}.${call.table}`, ts);
      }
    }
  })();
  return n;
}
