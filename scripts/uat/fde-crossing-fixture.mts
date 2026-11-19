/** Run inside the isolated RPB container image; synthetic data only, never a customer DB. */
import Database from "../../webui/node_modules/better-sqlite3/lib/index.js";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const FILE = "/data/lucy/.ktx-ui/audit.sqlite";
const META = "/data/lucy/.ktx-ui/uat-p157-crossing.json";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const command = process.argv[2] ?? "check";
const db = new Database(FILE);
const facts = () => db.prepare("SELECT COUNT(*) rows,COUNT(DISTINCT user_id) users FROM access_log").get();
if (command === "seed") {
  // Dedicated first-sorted user makes closure completion observable while all 67
  // original padded users still rebuild under the unchanged full-size pressure.
  const user = "000-uat-p157-crossing";
  const now = Date.now(), boundary = now - 30 * 86_400_000, depth = 50;
  const ins = db.prepare(`INSERT INTO access_log (ts,user_id,tool,tables,lucy_session_id,outcome,duration_ms,request_id)
    VALUES (?,?,'lucy_query','["t1"]',?,'success',1,?)`);
  let serial = 0;
  const call = (ms: number, session: string) => Number(ins.run(new Date(ms).toISOString(), user, session, `p157-${now}-${++serial}`).lastInsertRowid);
  db.transaction(() => {
    for (let i = 0; i < depth; i++) {
      call(boundary - (i + 1) * 2000, `p157-chain-${i}`);
      call(boundary - i * 2000 + 1000, `p157-chain-${i}`);
    }
    // Keep the first crossing inquiry spanning the real cutoff throughout boot/sample windows.
    for (let i = 1; i <= 60; i++) call(boundary + i * 60_000, "p157-chain-0");
  })();
  const outside = [call(boundary - 300_000, "p157-outside"), call(boundary - 299_000, "p157-outside")];
  const audit = await import("../../webui/server/proxy/audit.ts");
  const worker = await import("../../webui/server/proxy/audit-rebuild-write.ts");
  // Fixture construction: materialize the previously broader rolling window with the real worker.
  await audit.rebuildInferredTurns(user, { lookbackHours: 721, gapMs: 120_000 });
  const outsideTurn = db.prepare(`SELECT t.* FROM inferred_turns t JOIN inferred_turn_access_logs l
    ON l.inferred_turn_id=t.inferred_turn_id WHERE l.access_log_id=?`).get(outside[0]) as { inferred_turn_id: string };
  if (!outsideTurn) throw new Error("outside inquiry not constructed");
  const outsideLinks = db.prepare("SELECT * FROM inferred_turn_access_logs WHERE inferred_turn_id=? ORDER BY access_log_id").all(outsideTurn.inferred_turn_id);
  const lower = new Date(boundary - depth * 2000).toISOString();
  call(now, "p157-fresh"); // Natural newest-id coverage makes this existing user dirty at next boot.
  const expectedIds = (db.prepare("SELECT id FROM access_log WHERE user_id=? AND ts>=? ORDER BY id").all(user, lower) as { id: number }[]).map((r) => r.id);
  const priorNumbers = db.prepare(`SELECT t.inferred_turn_id,t.inquiry_no FROM inferred_turns t
    WHERE t.user_id=? AND t.session_id LIKE 'p157-chain-%' ORDER BY t.inferred_turn_id`).all(user);
  const meta = { user, depth, lower, outside, outsideTurnId: outsideTurn.inferred_turn_id, outsideHash: hash(outsideTurn), outsideLinksHash: hash(outsideLinks), expectedIds, priorNumbers, facts: facts() };
  writeFileSync(META, JSON.stringify(meta));
  await worker.closeRebuildWriteWorker(); audit.closeAuditDb();
  console.log(JSON.stringify({ mode: "seed", user, depth, lower, expectedRows: expectedIds.length, outsideTurnId: meta.outsideTurnId, facts: meta.facts, noClockChange: true, constructionLookbackHours: 721, runtimeLookbackHours: 720 }));
} else {
  const meta = JSON.parse(readFileSync(META, "utf8"));
  const actual = (db.prepare(`SELECT DISTINCT l.access_log_id id FROM inferred_turn_access_logs l
    JOIN inferred_turns t ON t.inferred_turn_id=l.inferred_turn_id WHERE t.user_id=? AND t.started_at>=? ORDER BY id`).all(meta.user, meta.lower) as { id: number }[]).map((r) => r.id);
  const duplicates = db.prepare(`SELECT l.access_log_id,COUNT(*) n FROM inferred_turn_access_logs l
    JOIN access_log a ON a.id=l.access_log_id WHERE a.user_id=? GROUP BY l.access_log_id HAVING COUNT(*)<>1`).all(meta.user);
  const turn = db.prepare("SELECT * FROM inferred_turns WHERE inferred_turn_id=?").get(meta.outsideTurnId);
  const links = db.prepare("SELECT * FROM inferred_turn_access_logs WHERE inferred_turn_id=? ORDER BY access_log_id").all(meta.outsideTurnId);
  const retained = meta.priorNumbers.every((p: any) => (db.prepare("SELECT inquiry_no FROM inferred_turns WHERE inferred_turn_id=?").get(p.inferred_turn_id) as any)?.inquiry_no === p.inquiry_no);
  const state = db.prepare("SELECT status,watermark FROM inferred_rebuild_state WHERE user_id=?").get(meta.user) as { status: string };
  const pass = JSON.stringify(actual) === JSON.stringify(meta.expectedIds) && duplicates.length === 0 && hash(turn) === meta.outsideHash && hash(links) === meta.outsideLinksHash && retained && state?.status === "complete";
  console.log(JSON.stringify({ mode: "check", pass, user: meta.user, depth: meta.depth, expectedRows: meta.expectedIds.length, actualRows: actual.length, duplicates: duplicates.length, outsideTurnUnchanged: hash(turn) === meta.outsideHash, outsideLinksUnchanged: hash(links) === meta.outsideLinksHash, inquiryNumbersRetained: retained, state, facts: facts() }));
  if (!pass) process.exitCode = 1;
}
db.close();
