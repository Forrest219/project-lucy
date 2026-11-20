/** Isolated, deterministic RACS data generator. No production/demo paths. */
import { mkdir, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { stringify } from "../../webui/node_modules/yaml/dist/index.js";

const out = path.resolve(process.argv[2] ?? "");
const scale = Number(process.argv[3] ?? 1);
if (!out.includes("/inbox/p1-58-59-finalization-20261120/") || ![1, 2, 5].includes(scale)) {
  throw new Error("requires task-owned fixture path and scale 1/2/5");
}
const project = path.join(out, "project");
const content = path.join(project, "config");
const secretDir = process.env.RACS_SECRET_DIR;
if (!secretDir || !path.resolve(secretDir).startsWith("/private/tmp/")) throw new Error("private RACS_SECRET_DIR required");
await mkdir(secretDir, { recursive: true, mode: 0o700 });
await chmod(secretDir, 0o700);
for (const dir of [project, content, path.join(project, "webui/config"), path.join(project, ".ktx-ui")]) {
  await mkdir(dir, { recursive: true });
}
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const connections: Record<string, unknown> = {};
const tables: Array<{ connection: string; source: string; physical: string; enabled: boolean }> = [];
const nConn = 8 * scale, nTables = 263 * scale, nEnabled = 259 * scale;
for (let c = 0; c < nConn; c++) {
  const id = `racs-c${c}`;
  const manifest: Record<string, unknown> = {};
  const enabled: string[] = [];
  for (let i = c; i < nTables; i += nConn) {
    const source = `racs_table_${i}`;
    const physical = `racs.${source}`;
    tables.push({ connection: id, source, physical, enabled: i < nEnabled });
    manifest[source] = { table: physical, columns: [
      { name: "id", type: "number", nullable: false },
      { name: "region", type: "string", nullable: true }
    ] };
    if (i < nEnabled) enabled.push(physical);
  }
  const dir = path.join(content, "semantic-layer", id, "_schema");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "racs.yaml"), stringify({ tables: manifest }));
  connections[id] = { driver: "mysql", engine: "mysql", host: "127.0.0.1", port: 3306,
    username: "racs_readonly", password: "", database: "racs", schemas: ["racs"],
    readonly: true, enabled_tables: enabled };
}
await writeFile(path.join(project, "ktx.yaml"), stringify({ project: { name: "racs-isolated-uat", root: "." }, connections }));
const roles: Record<string, unknown> = {};
for (let i = 0; i < 20 * scale; i++) {
  const table = tables.find((t) => t.source === `racs_table_${i % nEnabled}`)!;
  roles[`racs_r${i}`] = { description: `RACS ${i}`, permission_model_version: 2,
    allow: { tools: ["lucy_catalog", "lucy_query"], connections: [table.connection],
      tableSelectors: [{ connection: table.connection, schema: "racs", names: [table.source], row_access: "all" }] } };
}
const bearer = randomBytes(32).toString("hex");
const users = Array.from({ length: 100 * scale }, (_, i) => ({
  id: `racs_a${i}`, name: `RACS Agent ${i}`, enabled: i % 29 !== 28,
  roles: [`racs_r${i % (20 * scale)}`],
  tokens: Array.from({ length: 3 }, (_, j) => ({
    hash: `sha256:${i === 0 && j === 0 ? sha(bearer) : j === 2 && i < 2 ? "123456789abc" + sha(`collision-${i}`).slice(12) : sha(`racs-${i}-${j}`)}`,
    label: `t${j}`, created: "2026-01-01T00:00:00.000Z",
    ...(j === 1 && i === 2 ? { expires_at: "2026-01-02T00:00:00.000Z" } : {})
  }))
}));
await writeFile(path.join(project, "webui/config/access.yaml"), stringify({ users, roles, defaults: { deny_tools: ["sql_execution"] } }));
await writeFile(path.join(secretDir, "mcp-token"), bearer, { mode: 0o600 });
const password = randomBytes(24).toString("hex");
const { hashPassword } = await import("../../webui/server/auth/password.js");
const adminHash = await hashPassword(password);
const admins = ["owner", "operator", "operator2", "operator3", "operator4"].map((id, i) => ({
  id: `racs_${id}`, account_uid: `racs-fixture-uid-${i}`, display_name: `RACS ${id}`,
  role: i === 0 ? "owner" : "operator", enabled: true, password_hash: adminHash,
  created_at: "2026-01-01T00:00:00.000Z"
}));
await writeFile(path.join(project, "webui/config/admins.yaml"), stringify({ admins }));
await writeFile(path.join(secretDir, "login.json"), JSON.stringify({ adminId: "racs_owner", password }), { mode: 0o600 });
process.env.KTX_PROJECT_ROOT = project;
process.env.LUCY_CONTENT_ROOT = content;
process.env.LUCY_AUDIT_DB = path.join(project, ".ktx-ui/audit.sqlite");
const { getAuditDb, resetAuditDbForTests } = await import("../../webui/server/admin/audit.js");
const db = await getAuditDb();
const anchor = Date.now();
const anchorIso = new Date(anchor).toISOString();
const total = 1000000 * scale, windowRows = 200000 * scale;
// SQLite generation is bounded in chunks. 80% of rows hit the first 20% of
// subjects, with a single hottest subject >=20%; two subjects remain gold cases.
const insert = db.prepare(`WITH RECURSIVE seq(n) AS (SELECT ? UNION ALL SELECT n+1 FROM seq WHERE n < ?)
  INSERT INTO access_log(ts,user_id,token_hash_prefix,tool,outcome,duration_ms,request_id,policy_version,eval_mark,tables,args_summary)
  SELECT
    strftime('%Y-%m-%dT%H:%M:%fZ', (? - CASE WHEN n <= ? THEN
      CASE WHEN n%4 < 2 THEN (n%600000)+1000 WHEN n%4=2 THEN 8*86400000+(n%500000) ELSE 15*86400000+(n%500000) END
      ELSE 90*86400000+(n%86400000) END)/1000.0, 'unixepoch'),
    'racs_a' || CAST(CASE WHEN n%5=0 THEN 0 WHEN n%5<4 THEN 1+(n%?) ELSE ?+(n%?) END AS INTEGER),
    printf('sha256:%012d',n%3),
    CASE WHEN n%20<5 THEN 'server/probe' ELSE 'lucy_query' END,
    CASE WHEN n%100>=25 AND n%100<31 THEN 'denied' ELSE 'ok' END,
    1,'racs-seed-' || n,'racs-seed',CASE WHEN n%20>=17 THEN 1 ELSE 0 END,
    CASE WHEN n%20<5 THEN NULL ELSE '["racs.racs_table_0"]' END,
    CASE WHEN n%20>=17 THEN '{"connection":"rds-test"}' ELSE '{}' END
  FROM seq`);
const hot = Math.max(1, Math.floor(users.length * .2) - 1);
const coldCount = users.length - hot - 3;
for (let n = 1; n <= total; n += 100000) {
  db.transaction(() => insert.run(n, Math.min(n + 99999, total), anchor, windowRows, hot, hot + 1, coldCount))();
}
// Audit prefixes must exercise the actual configured credentials and IP metadata.
// A TEMP mapping leaves no product schema/index behind.
db.exec("CREATE TEMP TABLE racs_credentials(user_id TEXT,slot INTEGER,prefix TEXT,PRIMARY KEY(user_id,slot))");
const mapCredential = db.prepare("INSERT INTO racs_credentials VALUES (?,?,?)");
db.transaction(() => { for (const user of users) user.tokens.forEach((token, slot) => mapCredential.run(user.id, slot, token.hash.slice(0,19))); })();
db.exec(`UPDATE access_log SET token_hash_prefix=(SELECT prefix FROM racs_credentials c WHERE c.user_id=access_log.user_id AND c.slot=CAST(substr(request_id,11) AS INTEGER)%3), client_ip='198.51.100.' || (CAST(substr(request_id,11) AS INTEGER)%4+1) WHERE request_id LIKE 'racs-seed-%'`);
db.exec("DROP TABLE racs_credentials");
// Explicit old-only subject and configured credentials, including tied timestamps.
const add = db.prepare(`INSERT INTO access_log(ts,user_id,token_hash_prefix,tool,outcome,duration_ms,request_id,policy_version,eval_mark)
 VALUES (?,?,?,?,?,1,?,'racs-gold',0)`);
const oldOnly = users[users.length - 1]!;
add.run(new Date(anchor-90*86400000).toISOString(), oldOnly.id, oldOnly.tokens[0]!.hash.slice(0,19), "lucy_query", "ok", "old-only");
for (const user of users.slice(0, 3)) for (const token of user.tokens) {
  add.run(new Date(anchor-2000).toISOString(), user.id, token.hash.slice(0,19), "lucy_query", "ok", `gold-${user.id}-${token.label}`);
}
db.pragma("wal_checkpoint(TRUNCATE)");
const actual = db.prepare("SELECT COUNT(*) AS total, SUM(ts >= ?) AS windowRows FROM access_log")
  .get(new Date(anchor-30*86400000).toISOString());
resetAuditDbForTests();
await writeFile(path.join(out,"manifest.json"), JSON.stringify({ seed: "racs-final-4", scale, anchorIso,
  connections:nConn, manifests:nTables, enabled:nEnabled, roles:Object.keys(roles).length, agents:users.length,
  configuredTokens: users.length*3, audit:actual, tableKeys:tables }, null, 2));
console.log(JSON.stringify({ fixture: out, scale, audit:actual, credentialFiles: "private tmp only" }));
