/** Child process for page-event-loop-sweep.mts: the Lucy WebUI server under test. */
import path from "node:path";
import { rm } from "node:fs/promises";
import { seedAuditScale } from "../tests/performance/fixtures/audit-scale-fixture.ts";
import { seedAuditLedgerProof } from "../tests/performance/fixtures/audit-ledger-fixture.ts";

const ROOT = process.env.SWEEP_ROOT ?? "/tmp/lucy-sweep/root";
const auditDb = path.join(path.dirname(ROOT), "audit-scale.sqlite");
if (process.env.SWEEP_SEED === "1") {
  for (const suffix of ["", "-wal", "-shm"]) await rm(auditDb + suffix, { force: true });
}
process.env.KTX_PROJECT_ROOT = ROOT;
process.env.LUCY_CONTENT_ROOT = path.join(ROOT, "config");
process.env.LUCY_AUDIT_DB = auditDb;
process.env.LUCY_WEBUI_DIST_DIR = process.env.SWEEP_DIST ?? "/tmp/lucy-sweep/dist";
process.env.LUCY_DEPLOYMENT_MODE = "development";
process.env.LUCY_CHART_DEPLOYMENT_MODE = "development";
process.env.LUCY_WEBUI_AUTH = "off";
delete process.env.LUCY_TURN_REBUILD_ON_READ;
delete process.env.VITEST;

const { getAuditDb } = await import("../server/admin/audit.ts");
if (process.env.SWEEP_SEED === "1") {
  const seeded = await getAuditDb();
  seedAuditScale(seeded);
  await seedAuditLedgerProof(seeded, ROOT); // formal reconciliation / v2 export need a provable ledger bound
}
if (process.env.SWEEP_SEED_UI === "1") {
  // ui_page_views / ui_catalog_navigation_events: customer-scale guess (not an incident measurement).
  const db = await getAuditDb();
  db.exec(`CREATE TABLE IF NOT EXISTS ui_page_views (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, admin_id TEXT NOT NULL, page_key TEXT NOT NULL, menu_id TEXT, group_id TEXT);
    CREATE INDEX IF NOT EXISTS idx_ui_page_views_ts ON ui_page_views(ts);
    CREATE TABLE IF NOT EXISTS ui_catalog_navigation_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, visit_id TEXT NOT NULL, event_type TEXT NOT NULL, context_level TEXT);
    CREATE INDEX IF NOT EXISTS idx_ui_catalog_navigation_events_ts ON ui_catalog_navigation_events(ts);
    CREATE INDEX IF NOT EXISTS idx_ui_catalog_navigation_events_visit ON ui_catalog_navigation_events(visit_id, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ui_catalog_navigation_events_visit_start ON ui_catalog_navigation_events(visit_id) WHERE event_type = 'visit_start';`);
  const now = Date.now(), span = 30 * 24 * 3600_000;
  const pages = ["/overview", "/catalog", "/admin/agents", "/admin/audit", "/admin/usage", "/wiki", "/skills", "/admin/roles", "/admin/access-map", "/eval/cases"];
  const insPage = db.prepare("INSERT INTO ui_page_views (ts, admin_id, page_key, menu_id, group_id) VALUES (?, ?, ?, ?, ?)");
  const insNav = db.prepare("INSERT INTO ui_catalog_navigation_events (ts, visit_id, event_type, context_level) VALUES (?, ?, ?, ?)");
  db.transaction(() => {
    for (let i = 0; i < 300_000; i += 1) {
      const pk = pages[i % pages.length];
      insPage.run(new Date(now - Math.floor(Math.random() * span)).toISOString(), `admin-${i % 12}`, pk, pk.slice(1) || "home", "g");
    }
    for (let v = 0; v < 50_000; v += 1) {
      const ts = new Date(now - Math.floor(Math.random() * span)).toISOString();
      insNav.run(ts, `visit-${v}`, "visit_start", "root");
      insNav.run(ts, `visit-${v}`, "tree_select", "schema");
      insNav.run(ts, `visit-${v}`, "row_open", "schema");
    }
  })();
}
const { buildServer } = await import("../server/index.ts");
const { inferredRebuildStatus } = await import("../server/admin/inferred-turn-maintainer.ts");
const app = buildServer();
await app.listen({ host: "127.0.0.1", port: 0 });
const addr = app.server.address();
const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
const deadline = Date.now() + (process.env.SWEEP_SEED === "1" ? 12 * 60_000 : 90_000);
let stable = 0;
while (Date.now() < deadline) {
  const s = inferredRebuildStatus();
  stable = s.complete && (s.lastCompletedAt || process.env.SWEEP_SEED !== "1") ? stable + 1 : 0;
  if (stable >= 3) break;
  await new Promise((r) => setTimeout(r, 500));
}
// printRoutes is a radix tree: a child's path is its parent's path plus its own segment.
const routes = new Set<string>();
const stack: string[] = [];
for (const line of app.printRoutes({ commonPrefix: false }).split("\n")) {
  const m = line.match(/^((?:│   |    )*)(?:├── |└── )(\S+)(?: \(([^)]*)\))?$/);
  if (!m) continue;
  const depth = m[1].length / 4;
  stack.length = depth;
  const full = (depth ? stack[depth - 1] : "") + m[2];
  stack[depth] = full;
  if (m[3]?.split(",").map((x) => x.trim()).includes("GET")) routes.add(full);
}
process.send?.({ ready: base, routes: [...routes].sort() });
