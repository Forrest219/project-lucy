import Database from "better-sqlite3";
import Fastify from "fastify";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Real file-backed audit database and worker; only the rolling clock is controlled (L1).
// The same-image, full-scale Docker probe windows remain a separate UAT obligation.
let root: string, file: string, now: number;
let db: Database.Database;
let audit: typeof import("../proxy/audit");
const LOOKBACK = 30 * 86_400_000;
const user = "crossing";
const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(async () => {
  vi.resetModules();
  root = await mkdtemp(path.join(os.tmpdir(), "lucy-sc-crossing-"));
  file = path.join(root, "audit.sqlite"); now = Date.now();
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n");
  vi.stubEnv("KTX_PROJECT_ROOT", root); vi.stubEnv("LUCY_CONTENT_ROOT", ".");
  vi.stubEnv("LUCY_AUDIT_DB", file);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  audit = await import("../proxy/audit");
  await audit.openProxyAuditDb();
  db = new Database(file);
});

afterEach(async () => {
  const { closeRebuildWriteWorker } = await import("../proxy/audit-rebuild-write");
  await closeRebuildWriteWorker();
  const { resetAuditDbForTests } = await import("../admin/audit"); resetAuditDbForTests();
  const { closeSecurityStore } = await import("../security/instance"); closeSecurityStore();
  db?.close(); audit?.closeAuditDb();
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});

function call(ts: number, session: string, who = user): number {
  return Number(db.prepare(`INSERT INTO access_log (ts,user_id,tool,tables,lucy_session_id,outcome,duration_ms,request_id)
    VALUES (?,?,'sl_query','["t1"]',?,'ok',1,?)`).run(iso(ts), who, session, `${who}-${session}-${ts}`).lastInsertRowid);
}
function links(id: number) {
  return db.prepare("SELECT inferred_turn_id FROM inferred_turn_access_logs WHERE access_log_id=? ORDER BY inferred_turn_id").all(id) as { inferred_turn_id: string }[];
}
function turnFor(id: number) {
  const link = links(id)[0];
  return db.prepare("SELECT * FROM inferred_turns WHERE inferred_turn_id=?").get(link.inferred_turn_id) as Record<string, unknown>;
}
async function rebuild(hours = 720) {
  return audit.rebuildInferredTurns(user, { lookbackHours: hours, gapMs: 120_000 });
}
async function rolling() {
  const boundary = now - LOOKBACK;
  const first = call(boundary + 10_000, "same");
  const second = call(boundary + 50_000, "same");
  await rebuild();
  const prior = turnFor(second);
  now += 35_000;
  const recent = call(now - 1_000, "recent");
  await rebuild();
  return { first, second, recent, prior };
}

it("SC-11 preserves one existing inquiry across the rolling cutoff", async () => {
  const { first, second, prior } = await rolling();
  expect(links(first)).toHaveLength(1); expect(links(second)).toHaveLength(1);
  expect(links(first)).toEqual(links(second));
  expect(turnFor(second).inquiry_no).toBe(prior.inquiry_no);
  expect(turnFor(second).inferred_turn_id).toBe(prior.inferred_turn_id);
});

it("SC-12 returns the unique inquiry through real detail HTTP and the call presentation", async () => {
  const { second } = await rolling();
  const admin = await import("../admin/audit");
  const app = Fastify(); admin.registerAuditRoutes(app);
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  try {
    const candidates = db.prepare("SELECT inferred_turn_id FROM inferred_turns WHERE user_id=?").all(user) as { inferred_turn_id: string }[];
    const containing: number[] = [];
    for (const t of candidates) {
      const res = await fetch(base + "/api/admin/audit/turns/" + t.inferred_turn_id + "?hours=2160");
      expect(res.status).toBe(200);
      const body = await res.json();
      if (body.data.accessLogs.some((row: { id: number }) => row.id === second)) containing.push(body.data.inquiryNo);
    }
    const presented = admin.presentCallRows(db, [db.prepare("SELECT * FROM access_log WHERE id=?").get(second) as any]);
    expect(containing).toEqual([presented[0].inquiry_no]);
    expect(presented[0].inferred_turn_id).toBe(links(second)[0].inferred_turn_id);
  } finally { await app.close(); }
});

it("SC-13 retains every original access_log row after a rolling rebuild", async () => {
  const { first, second, recent } = await rolling();
  expect(db.prepare("SELECT id FROM access_log WHERE user_id=? ORDER BY id").all(user)).toEqual([first, second, recent].map((id) => ({ id })));
});

it("SC-14 heals an existing duplicate without a batch dirty-mark operation", async () => {
  const b = now - LOOKBACK;
  const a = call(b - 10_000, "same"), shared = call(b + 50_000, "same"), recent = call(now - 1_000, "recent");
  await rebuild(721);
  const prior = turnFor(shared);
  const duplicate = { ...prior, inferred_turn_id: "duplicate", started_at: iso(b + 10_000), ended_at: iso(now), inquiry_no: 999 };
  db.prepare(`INSERT INTO inferred_turns (${Object.keys(duplicate).join(",")}) VALUES (${Object.keys(duplicate).map(() => "?").join(",")})`).run(...Object.values(duplicate));
  db.prepare("INSERT INTO inferred_turn_access_logs (inferred_turn_id,access_log_id) VALUES ('duplicate',?)").run(shared);
  expect(links(shared)).toHaveLength(2);
  await rebuild();
  for (const id of [a, shared, recent]) expect(links(id)).toHaveLength(1);
  expect(turnFor(shared).inquiry_no).toBe(prior.inquiry_no);
  expect(db.prepare("SELECT 1 FROM inferred_turns WHERE inferred_turn_id='duplicate'").get()).toBeUndefined();
});

function chain(depth: number) {
  const b = now - LOOKBACK;
  const ids: number[] = [];
  for (let i = 0; i < depth; i++) {
    ids.push(call(b - (i + 1) * 2_000, `chain-${i}`));
    ids.push(call(b - i * 2_000 + 1_000, `chain-${i}`));
  }
  const outside = [call(b - 300_000, "outside"), call(b - 299_000, "outside")];
  return { ids, outside };
}

it("SC-15 closes multiple interleaved existing inquiries and leaves outside inquiries byte-for-byte intact", async () => {
  const { ids, outside } = chain(3);
  await rebuild(721);
  const numbers = ids.map((id) => turnFor(id).inquiry_no);
  const untouched = turnFor(outside[0]);
  const outsideLinks = outside.map(links);
  await rebuild();
  for (const [i, id] of ids.entries()) {
    expect(links(id)).toHaveLength(1);
    expect(turnFor(id).inquiry_no).toBe(numbers[i]);
  }
  expect(turnFor(outside[0])).toEqual(untouched);
  expect(outside.map(links)).toEqual(outsideLinks);
});

it("SC-16 full 200000-row/69-user fixture preserves exact read set and existing page/write budgets", async () => {
  const insert = db.prepare(`INSERT INTO access_log (ts,user_id,tool,tables,lucy_session_id,outcome,duration_ms,request_id)
    VALUES (?,?,'sl_query','["t1"]',?,'ok',1,?)`);
  const target: number[] = [];
  db.transaction(() => {
    for (let i = 0; i < 200_000; i++) {
      const who = i % 69 === 0 ? user : `other-${i % 69}`;
      const id = Number(insert.run(iso(now - 3_600_000 + i), who, `filler-${i % 8}`, `scale-${i}`).lastInsertRowid);
      if (who === user) target.push(id);
    }
  })();
  const { ids, outside } = chain(50); target.push(...ids);
  await rebuild(721);
  const untouched = turnFor(outside[0]), outsideLinks = outside.map(links);
  const numbers = ids.map((id) => turnFor(id).inquiry_no);
  const read: number[] = [], pages: number[] = [];
  const originalPrepare = Database.prototype.prepare;
  vi.spyOn(Database.prototype, "prepare").mockImplementation(function (this: Database.Database, sql: string) {
    const stmt = originalPrepare.call(this, sql);
    if (sql.includes("SELECT id, ts, tool, tables") && sql.includes("LIMIT ?")) {
      const all = stmt.all.bind(stmt) as (...args: unknown[]) => unknown[];
      vi.spyOn(stmt, "all").mockImplementation((...args: unknown[]) => {
        const rows = all(...args) as { id: number }[];
        pages.push(rows.length); read.push(...rows.map((row) => row.id)); return rows;
      });
    }
    return stmt;
  });
  const worker = await import("../proxy/audit-rebuild-write");
  const writes = vi.spyOn(worker, "runWriteSliceOffThread");
  await rebuild();
  expect(new Set(read)).toEqual(new Set(target));
  expect(read.length).toBe(target.length);
  expect(pages.length).toBeGreaterThan(2);
  expect(Math.max(...pages)).toBeLessThanOrEqual(400);
  expect(writes.mock.calls.length).toBeGreaterThan(1);
  expect(writes.mock.calls.every(([, turns]) => turns.length <= 8)).toBe(true);
  for (const [i, id] of ids.entries()) {
    expect(links(id)).toHaveLength(1); expect(turnFor(id).inquiry_no).toBe(numbers[i]);
  }
  expect(turnFor(outside[0])).toEqual(untouched);
  expect(outside.map(links)).toEqual(outsideLinks);
  expect((db.prepare("SELECT COUNT(*) n FROM access_log").get() as { n: number }).n).toBe(200_102);
}, 60_000);
