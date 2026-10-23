/**
 * Spec 174 §8 — anonymous, deterministic performance fixture.
 *
 * Generates a disposable Lucy project (ktx.yaml, Schema Manifests, overlays,
 * access.yaml, admins.yaml, audit SQLite) plus a deterministic KTX stub. Every
 * value is synthetic; nothing is copied from the real checkout configuration.
 */
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";

export const FIXTURE_OWNER_MARKER = ".lucy-entry-perf-owner";
export const FIXTURE_SEED = 161;
export const FIXTURE_SHAPE = {
  connections: 7,
  manifests: 8,
  tables: 60,
  columns: 1786,
  enabledTables: 45,
  agents: 13,
  enabledAgents: 12,
  auditEventsPerEnabledAgent: 200
} as const;

export type FixtureManifest = {
  tool: "lucy-entry-performance-fixture";
  version: 1;
  seed: number;
  anchorIso: string;
  shape: typeof FIXTURE_SHAPE;
  connectionIds: string[];
  tableCount: number;
  columnCount: number;
  enabledTableCount: number;
  overlayCount: number;
  manifestBytes: Record<string, number>;
  totalManifestBytes: number;
  contentHash: string;
  auditInputDigest: string;
  auditEventCount: number;
  roles: string[];
  agents: Array<{ id: string; enabled: boolean; roles: string[]; legacyRole?: string; legacyAllow?: boolean; constraints?: boolean }>;
  paths: {
    projectRoot: string;
    contentRoot: string;
    accessPath: string;
    adminsPath: string;
    auditDb: string;
    stubBin: string;
    stubConfig: string;
    stubLog: string;
    loginSecret: string;
  };
};

/** mulberry32 — tiny deterministic PRNG. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]!;
}

function scriptCheckoutRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function realish(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(realish(parent), path.basename(p));
  }
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Output guard: fixtures may only live under `<checkout>/inbox/webui-entry-perf/`
 * (or the OS temp dir for unit tests) and never inside real config trees.
 */
export function assertSafeFixtureOutput(outDir: string, checkoutRoot = scriptCheckoutRoot()): string {
  const target = realish(path.resolve(outDir));
  const root = realish(checkoutRoot);
  const allowedRoots = [
    path.join(root, "inbox", "webui-entry-perf"),
    realish(os.tmpdir())
  ];
  if (!allowedRoots.some((allowed) => isInside(target, allowed) && target !== allowed)) {
    throw new Error(`[entry-perf-guard] fixture output must live under inbox/webui-entry-perf/<run-id>: ${target}`);
  }
  const forbidden = [
    path.join(root, "ktx.yaml"),
    path.join(root, "config"),
    path.join(root, "semantic-layer"),
    path.join(root, ".ktx"),
    path.join(root, "webui", "config")
  ];
  for (const blocked of forbidden) {
    if (isInside(target, blocked)) {
      throw new Error(`[entry-perf-guard] refusing to write inside real project path: ${blocked}`);
    }
  }
  return target;
}

/** Remove a run directory only when it carries this tool's owner marker. */
export async function removeOwnedRunDir(dir: string, checkoutRoot = scriptCheckoutRoot()): Promise<void> {
  const target = assertSafeFixtureOutput(dir, checkoutRoot);
  if (!existsSync(path.join(target, FIXTURE_OWNER_MARKER))) {
    throw new Error(`[entry-perf-guard] ${target} has no ${FIXTURE_OWNER_MARKER}; refusing to delete`);
  }
  await rm(target, { recursive: true, force: true });
}

type GeneratedTable = {
  conn: string;
  schema: string;
  name: string;
  columns: Array<Record<string, unknown>>;
};

const ENGINES = [
  { driver: "mysql", engine: "mysql" },
  { driver: "postgres", engine: "postgres" },
  { driver: "mysql", engine: "starrocks" },
  { driver: "mysql", engine: "doris" },
  { driver: "postgres", engine: "postgres" },
  { driver: "mysql", engine: "mysql" },
  { driver: "mysql", engine: "mysql" }
] as const;

const WORDS = ["order", "customer", "region", "ledger", "invoice", "product", "channel", "store", "payment", "refund", "budget", "campaign"];
const COLUMN_TYPES = ["string", "number", "time", "boolean"] as const;

function connectionIds(): string[] {
  return Array.from({ length: FIXTURE_SHAPE.connections }, (_, i) => `perf-conn-${String(i + 1).padStart(2, "0")}`);
}

/** 8 Manifests: perf-conn-01 has two schemas; perf-conn-07 has one Manifest and zero enabled tables. */
function manifestPlan(conns: string[]): Array<{ conn: string; schema: string; tables: number }> {
  const tablesPer = [8, 8, 8, 7, 7, 8, 7, 7];
  const plan = [
    { conn: conns[0]!, schema: "sales" },
    { conn: conns[0]!, schema: "finance" },
    { conn: conns[1]!, schema: "ops" },
    { conn: conns[2]!, schema: "mart" },
    { conn: conns[3]!, schema: "dw" },
    { conn: conns[4]!, schema: "crm" },
    { conn: conns[5]!, schema: "hr" },
    { conn: conns[6]!, schema: "archive" }
  ];
  return plan.map((entry, index) => ({ ...entry, tables: tablesPer[index]! }));
}

function generateTables(rng: () => number, conns: string[]): GeneratedTable[] {
  const tables: GeneratedTable[] = [];
  let tableIndex = 0;
  for (const manifest of manifestPlan(conns)) {
    for (let t = 0; t < manifest.tables; t += 1) {
      // 46 tables × 30 columns + 14 tables × 29 columns = 1786.
      const columnCount = tableIndex < 46 ? 30 : 29;
      const name = `${manifest.schema}_${pick(rng, WORDS)}_${String(tableIndex + 1).padStart(2, "0")}`;
      const columns: Array<Record<string, unknown>> = [
        { name: "id", type: "number", pk: true, nullable: false, descriptions: { db: "Synthetic primary key", human: "合成主键" } },
        { name: "region", type: "string", nullable: true, descriptions: { db: "Synthetic region", ai: "地区（合成）" } }
      ];
      for (let c = columns.length; c < columnCount; c += 1) {
        const type = pick(rng, COLUMN_TYPES);
        columns.push({
          name: `${pick(rng, WORDS)}_${type}_${c}`,
          type,
          nullable: rng() > 0.3,
          descriptions: { db: `Synthetic ${type} column ${c}`, ai: `合成字段 ${c}` }
        });
      }
      tables.push({ conn: manifest.conn, schema: manifest.schema, name, columns });
      tableIndex += 1;
    }
  }
  return tables;
}

function enabledTableSet(tables: GeneratedTable[], conns: string[]): Set<string> {
  // perf-conn-07 stays at zero enabled tables (catalog_bound context must include it).
  const candidates = tables.filter((table) => table.conn !== conns[6]);
  return new Set(candidates.slice(0, FIXTURE_SHAPE.enabledTables).map((table) => `${table.conn}::${table.schema}.${table.name}`));
}

function ktxYaml(conns: string[], tables: GeneratedTable[], enabled: Set<string>): string {
  const plan = manifestPlan(conns);
  const connections: Record<string, unknown> = {};
  conns.forEach((conn, index) => {
    const engine = ENGINES[index]!;
    connections[conn] = {
      driver: engine.driver,
      engine: engine.engine,
      readonly: true,
      host: `perf-db-${index + 1}.invalid`,
      port: engine.driver === "postgres" ? 5432 : 3306,
      username: `perf_reader_${index + 1}`,
      password: `file:.ktx/secrets/${conn}-password`,
      database: `perf_db_${index + 1}`,
      schemas: plan.filter((entry) => entry.conn === conn).map((entry) => entry.schema),
      enabled_tables: tables
        .filter((table) => table.conn === conn && enabled.has(`${table.conn}::${table.schema}.${table.name}`))
        .map((table) => `${table.schema}.${table.name}`)
    };
  });
  return `# Spec 174 anonymous performance fixture. Synthetic values only.\n${stringify({
    project: { name: "lucy-entry-perf-fixture", root: "." },
    connections,
    mcp: { bind: "127.0.0.1:0", auth: "none" }
  }, { lineWidth: 0 })}`;
}

function manifestYaml(schemaTables: GeneratedTable[], schema: string): string {
  const tables: Record<string, unknown> = {};
  for (const table of schemaTables) {
    tables[table.name] = {
      table: `${schema}.${table.name}`,
      descriptions: { db: `Synthetic table ${table.name}`, ai: `合成表 ${table.name}` },
      columns: table.columns
    };
  }
  return stringify({ tables }, { lineWidth: 0 });
}

function overlayYaml(table: GeneratedTable, rng: () => number): string {
  return stringify({
    grain: ["id"],
    measures: [
      { name: "row_count", expr: "count(*)", description: "合成行数" },
      { name: `sum_${table.columns[3]?.name ?? "value"}`, expr: `sum(${table.columns[3]?.name ?? "id"})` }
    ],
    segments: [{ name: "east_only", expr: "region = 'East'", description: rng() > 0.5 ? "东区" : "东部" }],
    descriptions: { human: `合成业务说明 ${table.name}` }
  }, { lineWidth: 0 });
}

const ROLE_TOOLS = ["lucy_catalog", "lucy_query", "lucy_read_source", "lucy_explain_query", "lucy_begin_question", "wiki_search", "wiki_read", "connection_list"];

const DEFAULTS = {
  deny_tools: ["sql_execution", "sql_dialect_notes", "memory_ingest", "memory_ingest_status", "sl_query", "sl_read_source"],
  known_tools: [
    "lucy_query", "lucy_read_source", "lucy_explain_query", "lucy_catalog", "lucy_freshness", "lucy_begin_question",
    "wiki_search", "wiki_read", "entity_details", "dictionary_search", "discover_data", "connection_list", "kx_catalog",
    "sl_query", "sl_read_source", "sl_validate", "sql_execution", "sql_dialect_notes", "memory_ingest", "memory_ingest_status"
  ],
  table_touching_tools: ["lucy_query", "lucy_read_source", "lucy_explain_query", "lucy_freshness", "entity_details", "sl_validate", "sl_query", "sl_read_source"],
  sensitive_metadata_tools: ["dictionary_search", "discover_data"],
  sensitive_table_prefixes: []
};

function fakeTokenHash(rng: () => number): string {
  let hex = "";
  for (let i = 0; i < 64; i += 1) hex += Math.floor(rng() * 16).toString(16);
  return `sha256:${hex}`;
}

type FixtureAgent = FixtureManifest["agents"][number] & { yaml: Record<string, unknown> };

function accessConfig(rng: () => number, conns: string[], tables: GeneratedTable[]): { yaml: string; agents: FixtureAgent[]; roles: string[] } {
  const salesTables = tables.filter((table) => table.conn === conns[0] && table.schema === "sales").slice(0, 6).map((table) => table.name);
  const roles: Record<string, unknown> = {
    lucy_admin: {
      description: "Synthetic admin follows all connections",
      permission_model_version: 2,
      allow: { connections: ["*"], source_scope: "catalog_bound", tools: ROLE_TOOLS }
    },
    sales_analyst: {
      description: "Synthetic sales selectors",
      permission_model_version: 2,
      allow: {
        connections: [conns[0]],
        tableSelectors: [{ connection: conns[0], schema: "sales", names: salesTables, row_access: "all" }],
        tools: ROLE_TOOLS
      }
    },
    catalog_pair: {
      description: "Synthetic catalog_bound on two connections",
      permission_model_version: 2,
      allow: { connections: [conns[1], conns[2]], source_scope: "catalog_bound", tools: ROLE_TOOLS }
    },
    ops_prefix: {
      description: "Synthetic legacy prefix selector",
      allow: {
        connections: [conns[1]],
        tableSelectors: [{ connection: conns[1], schema: "ops", prefix: "ops_" }],
        tools: ROLE_TOOLS
      }
    },
    wiki_reader: {
      description: "Synthetic meta-only role",
      allow: { connections: [conns[3]], tools: ["wiki_search", "wiki_read", "connection_list"] }
    },
    crm_catalog: {
      description: "Synthetic catalog_bound single connection",
      permission_model_version: 2,
      allow: { connections: [conns[4]], source_scope: "catalog_bound", tools: ROLE_TOOLS }
    }
  };
  const plan: Array<Omit<FixtureAgent, "yaml"> & { allow?: unknown; constraintsValue?: unknown }> = [
    { id: "perf_admin", enabled: true, roles: ["lucy_admin"] },
    { id: "perf_sales", enabled: true, roles: ["sales_analyst"] },
    { id: "perf_dual", enabled: true, roles: ["sales_analyst", "catalog_pair"] },
    { id: "perf_legacy_role", enabled: true, roles: [], legacyRole: "ops_prefix" },
    { id: "perf_wiki", enabled: true, roles: ["wiki_reader"] },
    { id: "perf_crm", enabled: true, roles: ["crm_catalog"] },
    {
      id: "perf_constrained",
      enabled: true,
      roles: ["sales_analyst"],
      constraints: true,
      constraintsValue: { sources: [{ connection: conns[0], schema: "sales", names: [salesTables[0]], predicates: [{ field: "region", op: "eq", value: "East" }] }] }
    },
    { id: "perf_legacy_allow", enabled: true, roles: [], legacyAllow: true, allow: { connections: [conns[5]], tables: tables.filter((t) => t.conn === conns[5]).slice(0, 3).map((t) => `${t.schema}.${t.name}`), tools: ["lucy_query", "lucy_catalog", "wiki_search"] } },
    { id: "perf_pair", enabled: true, roles: ["catalog_pair"] },
    { id: "perf_triple", enabled: true, roles: ["catalog_pair", "crm_catalog", "wiki_reader"] },
    { id: "perf_admin_2", enabled: true, roles: ["lucy_admin"] },
    { id: "perf_sales_2", enabled: true, roles: ["sales_analyst"] },
    { id: "perf_disabled", enabled: false, roles: ["catalog_pair"] }
  ];
  const agents: FixtureAgent[] = plan.map((entry, index) => {
    const yaml: Record<string, unknown> = {
      id: entry.id,
      name: `Perf Agent ${index + 1}`,
      enabled: entry.enabled,
      note: "Synthetic Spec 174 performance fixture agent",
      tokens: [{ hash: fakeTokenHash(rng), label: `perf-token-${index + 1}`, created: "2026-10-01" }]
    };
    if (entry.legacyRole) yaml.role = entry.legacyRole;
    else if (entry.roles.length > 0) yaml.roles = entry.roles;
    if (entry.allow) yaml.allow = entry.allow;
    if (entry.constraintsValue) yaml.constraints = entry.constraintsValue;
    const { allow: _allow, constraintsValue: _constraints, ...meta } = entry;
    return { ...meta, yaml };
  });
  const yaml = `# Spec 174 synthetic access fixture. Token hashes are random; no real secrets.\n${stringify({
    roles,
    users: agents.map((agent) => agent.yaml),
    defaults: DEFAULTS
  }, { lineWidth: 0 })}`;
  return { yaml, agents, roles: Object.keys(roles) };
}

const STUB_SCRIPT = `#!/bin/bash
# Spec 174 deterministic KTX stub (bash 3.2 compatible). Never contacts a database.
set -u
CONF="\${LUCY_PERF_STUB_CONFIG:-}"
LOG="\${LUCY_PERF_STUB_LOG:-}"
kind="other"
conn=""
if [ "\${1:-}" = "connection" ] && [ "\${2:-}" = "test" ]; then
  kind="test"; conn="\${3:-}"
elif [ "\${1:-}" = "sql" ]; then
  kind="sql"; conn="\${3:-}"
fi
delay=50
mode="ok"
if [ -n "$CONF" ] && [ -f "$CONF" ]; then
  while read -r key d m k; do
    case "$key" in "#"*|"") continue ;; esac
    if [ -n "\${k:-}" ] && [ "$k" != "$kind" ]; then continue; fi
    if [ "$key" = "*" ] || [ "$key" = "$conn" ]; then delay="$d"; mode="$m"; fi
  done < "$CONF"
fi
if [ -n "$LOG" ]; then echo "start $kind $conn $$" >> "$LOG"; fi
if [ "$mode" = "timeout" ]; then delay=45000; fi
secs=$(awk "BEGIN { printf \\"%.3f\\", $delay / 1000 }")
sleep "$secs"
if [ -n "$LOG" ]; then echo "end $kind $conn $$" >> "$LOG"; fi
if [ "$mode" = "fail" ]; then
  echo "Synthetic connection failure (fixture)" >&2
  exit 3
fi
if [ "$kind" = "sql" ]; then
  echo '{"columns":["schema_name","table_count"],"rows":[["sales",8],["finance",8],["ops",8],["mart",7],["dw",7],["crm",8],["hr",7],["archive",7]]}'
  exit 0
fi
if [ "$kind" = "test" ]; then
  echo "Status: ok (perf fixture)"
  exit 0
fi
echo "perf fixture KTX command completed"
exit 0
`;

async function writeText(file: string, content: string): Promise<number> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  return Buffer.byteLength(content);
}

/** Hash of every YAML / config input the display read model consumes. */
export async function computeFixtureContentHash(projectRoot: string): Promise<string> {
  const hash = createHash("sha256");
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".ktx-ui" || entry.name === ".ktx" || entry.name === "node_modules") continue;
        await walk(abs);
      } else if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) && entry.name !== "admins.yaml") {
        files.push(abs);
      }
    }
  }
  await walk(projectRoot);
  for (const file of files) {
    hash.update(path.relative(projectRoot, file));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

type AuditEventInput = {
  ts: string;
  userId: string;
  tool: string;
  outcome: "ok" | "denied" | "error";
  sessionId: string;
  turnId: string;
  table?: { conn: string; schema: string; source: string; physical: string };
  durationMs: number;
};

export function planAuditEvents(seed: number, anchorIso: string, agentIds: string[], tables: GeneratedTable[]): AuditEventInput[] {
  const rng = createRng(seed ^ 0x5eed);
  const anchor = Date.parse(anchorIso);
  const events: AuditEventInput[] = [];
  const businessTools = ["lucy_query", "lucy_read_source", "lucy_catalog", "wiki_search", "lucy_explain_query"];
  for (const userId of agentIds) {
    for (let i = 0; i < FIXTURE_SHAPE.auditEventsPerEnabledAgent; i += 1) {
      const offsetMs = Math.floor((rng() - 0.5) * 2 * 24 * 60 * 60 * 1000);
      const sessionNo = Math.floor(i / 20);
      const turnNo = Math.floor(i / 5);
      const roll = rng();
      const tool = roll < 0.12 ? pick(rng, ["initialize", "tools/list", "notifications/initialized"]) : pick(rng, businessTools);
      const outcome = tool.includes("/") || tool === "initialize" ? "ok" : roll > 0.9 ? "denied" : roll > 0.86 ? "error" : "ok";
      const table = pick(rng, tables);
      events.push({
        ts: new Date(anchor + offsetMs).toISOString(),
        userId,
        tool,
        outcome,
        sessionId: `perf-session-${userId}-${sessionNo}`,
        turnId: `perf-turn-${userId}-${turnNo}`,
        table: tool.startsWith("lucy_") ? { conn: table.conn, schema: table.schema, source: table.name, physical: `${table.schema}.${table.name}` } : undefined,
        durationMs: 20 + Math.floor(rng() * 400)
      });
    }
  }
  return events.sort((a, b) => a.ts.localeCompare(b.ts));
}

async function writeAuditDb(dbPath: string, events: AuditEventInput[], agentHashes: Map<string, string>): Promise<void> {
  const previous = process.env.LUCY_AUDIT_DB;
  process.env.LUCY_AUDIT_DB = dbPath;
  const audit = await import("../server/proxy/audit.ts");
  audit.closeAuditDb();
  try {
    const seenTurns = new Set<string>();
    let requestId = 1;
    for (const event of events) {
      const tokenHashPrefix = agentHashes.get(event.userId)?.slice(0, 19);
      if (!seenTurns.has(event.turnId)) {
        seenTurns.add(event.turnId);
        await audit.writeConversationTurn({
          turnId: event.turnId,
          sessionId: event.sessionId,
          userId: event.userId,
          tokenHashPrefix,
          platform: "perf-fixture",
          client: "perf-client",
          questionSource: "explicit",
          questionPreview: "合成问题（性能 fixture）"
        });
      }
      const id = await audit.writeLog({
        ts: event.ts,
        userId: event.userId,
        tokenLabel: "perf-token",
        tokenHashPrefix,
        lucySessionId: event.sessionId,
        lucyTurnId: event.turnId,
        turnAttributionMode: "explicit",
        turnAttributionConfidence: "high",
        lucyPlatform: "perf-fixture",
        client: "perf-client",
        tool: event.tool,
        tables: event.table ? [event.table.physical] : undefined,
        outcome: event.outcome,
        durationMs: event.durationMs,
        requestId: `perf-${requestId++}`
      });
      if (event.table) {
        await audit.writeAccessLogSources(id, event.ts, event.userId, event.tool, [{
          connectionId: event.table.conn,
          schemaName: event.table.schema,
          sourceName: event.table.source,
          physicalTable: event.table.physical,
          extractionMethod: "structured_args",
          confidence: "high"
        }]);
      }
    }
  } finally {
    audit.closeAuditDb();
    if (previous === undefined) delete process.env.LUCY_AUDIT_DB;
    else process.env.LUCY_AUDIT_DB = previous;
  }
}

export type GenerateOptions = {
  outDir: string;
  seed?: number;
  anchorIso?: string;
  withAudit?: boolean;
  withAdmins?: boolean;
  checkoutRoot?: string;
};

export function defaultAnchorIso(nowMs = Date.now()): string {
  const hour = 60 * 60 * 1000;
  return new Date(Math.floor(nowMs / hour) * hour - 84 * hour).toISOString();
}

export async function generatePerformanceFixture(options: GenerateOptions): Promise<FixtureManifest> {
  const seed = options.seed ?? FIXTURE_SEED;
  const anchorIso = options.anchorIso ?? defaultAnchorIso();
  const outDir = assertSafeFixtureOutput(options.outDir, options.checkoutRoot);
  if (existsSync(outDir) && (await readdir(outDir)).length > 0) {
    throw new Error(`[entry-perf-guard] fixture dir already exists and is not empty: ${outDir}`);
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, FIXTURE_OWNER_MARKER), "lucy-entry-performance\n", "utf8");

  const rng = createRng(seed);
  const conns = connectionIds();
  const tables = generateTables(rng, conns);
  const enabled = enabledTableSet(tables, conns);

  const projectRoot = path.join(outDir, "project");
  const contentRoot = path.join(projectRoot, "config");
  const semanticLayer = path.join(contentRoot, "semantic-layer");
  await writeText(path.join(projectRoot, "ktx.yaml"), ktxYaml(conns, tables, enabled));

  const manifestBytes: Record<string, number> = {};
  for (const manifest of manifestPlan(conns)) {
    const schemaTables = tables.filter((table) => table.conn === manifest.conn && table.schema === manifest.schema);
    const rel = path.posix.join("semantic-layer", manifest.conn, "_schema", `${manifest.schema}.yaml`);
    manifestBytes[rel] = await writeText(path.join(contentRoot, rel), manifestYaml(schemaTables, manifest.schema));
  }
  let overlayCount = 0;
  for (const [index, table] of tables.entries()) {
    if (index % 3 !== 0) continue;
    await writeText(path.join(semanticLayer, table.conn, `${table.name}.yaml`), overlayYaml(table, rng));
    overlayCount += 1;
  }
  for (const dir of ["wiki", "evals", "skills"]) await mkdir(path.join(contentRoot, dir), { recursive: true });
  await writeText(path.join(contentRoot, "wiki", "global", "perf-overview.md"), "---\ntitle: 合成口径说明\n---\n\n性能 fixture 合成 Wiki。\n");

  for (const conn of conns) {
    const secret = path.join(projectRoot, ".ktx", "secrets", `${conn}-password`);
    await writeText(secret, `synthetic-${conn}\n`);
    await chmod(secret, 0o600);
  }

  const access = accessConfig(rng, conns, tables);
  const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
  await writeText(accessPath, access.yaml);

  const loginSecret = path.join(outDir, "secrets", "login-password");
  const adminsPath = path.join(outDir, "auth", "admins.yaml");
  if (options.withAdmins !== false) {
    const password = `perf-${createHash("sha256").update(`${seed}:${anchorIso}:login`).digest("hex").slice(0, 20)}`;
    await writeText(loginSecret, password);
    await chmod(loginSecret, 0o600);
    const { hashPassword } = await import("../server/auth/password.ts");
    await writeText(adminsPath, stringify({
      version: "1",
      admins: [{ id: "perf_owner", display_name: "Perf Owner", password_hash: await hashPassword(password), role: "owner", enabled: true, created_at: anchorIso }]
    }));
  }

  const stubBin = path.join(outDir, "bin");
  await writeText(path.join(stubBin, "ktx"), STUB_SCRIPT);
  await chmod(path.join(stubBin, "ktx"), 0o755);
  const stubConfig = path.join(outDir, "stub", "ktx-stub.conf");
  const stubLog = path.join(outDir, "stub", "ktx-stub.log");
  await writeText(stubConfig, "# connId delayMs mode [kind]\n* 50 ok\n");

  const enabledAgentIds = access.agents.filter((agent) => agent.enabled).map((agent) => agent.id);
  const events = planAuditEvents(seed, anchorIso, enabledAgentIds, tables);
  const auditDb = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  if (options.withAudit !== false) {
    await mkdir(path.dirname(auditDb), { recursive: true });
    const hashes = new Map(access.agents.map((agent) => [agent.id, String((agent.yaml.tokens as Array<{ hash: string }>)[0]?.hash ?? "")]));
    await writeAuditDb(auditDb, events, hashes);
  }

  const totalManifestBytes = Object.values(manifestBytes).reduce((sum, value) => sum + value, 0);
  const manifest: FixtureManifest = {
    tool: "lucy-entry-performance-fixture",
    version: 1,
    seed,
    anchorIso,
    shape: FIXTURE_SHAPE,
    connectionIds: conns,
    tableCount: tables.length,
    columnCount: tables.reduce((sum, table) => sum + table.columns.length, 0),
    enabledTableCount: enabled.size,
    overlayCount,
    manifestBytes,
    totalManifestBytes,
    contentHash: await computeFixtureContentHash(projectRoot),
    auditInputDigest: createHash("sha256").update(JSON.stringify(events)).digest("hex"),
    auditEventCount: options.withAudit === false ? 0 : events.length,
    roles: access.roles,
    agents: access.agents.map(({ yaml: _yaml, ...agent }) => agent),
    paths: { projectRoot, contentRoot, accessPath, adminsPath, auditDb, stubBin, stubConfig, stubLog, loginSecret }
  };
  await writeText(path.join(outDir, "fixture-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function readFixtureManifest(fixtureDir: string): Promise<FixtureManifest> {
  return JSON.parse(await readFile(path.join(fixtureDir, "fixture-manifest.json"), "utf8")) as FixtureManifest;
}

export async function fixtureDirBytes(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await fixtureDirBytes(abs);
    else if (entry.isFile()) total += (await stat(abs)).size;
  }
  return total;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outIndex = process.argv.indexOf("--out");
  const out = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
  if (!out) {
    console.error("usage: tsx scripts/entry-performance-fixture.mts --out inbox/webui-entry-perf/<run-id>/fixture");
    process.exit(2);
  }
  const resolved = path.isAbsolute(out) ? out : path.resolve(scriptCheckoutRoot(), out);
  generatePerformanceFixture({ outDir: resolved })
    .then((manifest) => {
      console.log(JSON.stringify({ fixture: resolved, tables: manifest.tableCount, columns: manifest.columnCount, contentHash: manifest.contentHash }, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
