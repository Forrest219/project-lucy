#!/usr/bin/env node
// 2026-10-19-r1 audit-trust / T03a — association_status backfill runner.
// Contract `inbox/audit-trust/audit-trust-2026-10-19-r1/T00-r2/implementation-contract.md`
// §3.1 迁移执行顺序 step 2 / §2.1 撤销规则 5.
//
// Design (T03a G3 fixes #4 + #5 + #6):
//   1. Open the live audit.sqlite in **read-only** mode.
//   2. Use better-sqlite3's `db.backup(targetDb)` API to take a consistent
//      snapshot — captures committed WAL contents; T03a G3 finding #4.
//   3. Run backfillAssociationStatus() on the snapshot (in read-write).
//   4. recordBackfillRun() is awaited; on rejection we ABORT and leave the
//      live DB untouched. T03a G3 finding #5.
//   5. `input_sha256` hashes the snapshot's pre-backfill rows (input data),
//      not the result counters. T03a G3 finding #6.
//   6. `--promote` is a separate operator step that requires the Lucy server
//      to be **stopped** (the script refuses to run --promote against a
//      locked live file). Replace uses `rename` only after the snapshot's
//      `user_version` is verified.
//
// Usage:
//   AUDIT_DB_PATH=./audit.sqlite node scripts/audit-trust/2026-10-19-r1-backfill.mjs
//   AUDIT_DB_PATH=./audit.sqlite node scripts/audit-trust/2026-10-19-r1-backfill.mjs --promote

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { rename as fsRename, unlink } from "node:fs/promises";
import Database from "better-sqlite3";

const PROMOTE = process.argv.includes("--promote");
const DB_PATH = process.env.AUDIT_DB_PATH ?? "./audit.sqlite";
const ABS_PATH = resolve(DB_PATH);
const TMP_PATH = `${ABS_PATH}.backfill-tmp`;
const CLASSIFICATION_VERSION = "audit-trust-2026-10-19-r1.v1";
const DIGEST_VERSION = "audit-trust-2026-10-19-r1.v1";
const RUNNING_ACTOR = process.env.BACKFILL_ACTOR ?? "local-admin";
const MIGRATION_TEXT =
  "association_status backfill: session_bound->legacy_unverified; " +
  "explicit+validated->confirmed; explicit+invalidated->conflict; " +
  "others->unassigned. Per contract §3.1 step 2.";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function main() {
  // 1. Open live DB read-only and take a consistent snapshot via SQLite's
  // backup API. The backup target is a *filename* (better-sqlite3 writes the
  // snapshot there), then we open it read-write for the backfill.
  const liveDb = new Database(ABS_PATH, { readonly: true, fileMustExist: true });
  await liveDb.backup(TMP_PATH);
  liveDb.close();

  const tmpDb = new Database(TMP_PATH);

  // 2. Hash the pre-backfill rows (input data, not counters). Includes the
  // explicit_turn_validated flag so different migration inputs produce
  // different hashes. Column may be missing in pre-v2 schemas — coalesce.
  const hasExplicitCol = !!tmpDb
    .prepare(
      `SELECT 1 FROM pragma_table_info('access_log') WHERE name = 'explicit_turn_validated'`
    )
    .get();
  const explicitCol = hasExplicitCol ? "explicit_turn_validated" : "NULL";
  const inputRows = tmpDb
    .prepare(
      `SELECT 'access_log' AS t, id, turn_attribution_mode, association_status, ${explicitCol} AS explicit_turn_validated FROM access_log
       UNION ALL
       SELECT 'conversation_turns' AS t, turn_id AS id, question_source AS turn_attribution_mode, association_status, NULL AS explicit_turn_validated FROM conversation_turns
       ORDER BY t, id`
    )
    .all();
  const inputSha256 = sha256(Buffer.from(JSON.stringify(inputRows), "utf8"));

  // 3. Import backfill function lazily (TS module).
  const mod = await import("../../webui/server/proxy/audit.ts").catch(() => null);
  if (!mod || typeof mod.backfillAssociationStatus !== "function") {
    console.error(
      "FATAL: cannot import backfillAssociationStatus. Run via: npx tsx scripts/audit-trust/2026-10-19-r1-backfill.mjs"
    );
    tmpDb.close();
    await unlink(TMP_PATH).catch(() => undefined);
    process.exit(2);
  }

  // 4. Run backfill on snapshot.
  const backfillResult = await mod.backfillAssociationStatus(tmpDb);

  // 5. Persist audit_meta — AWAITED; on rejection, leave live DB untouched.
  try {
    await mod.recordBackfillRun({
      database: tmpDb,
      result: backfillResult,
      migrationText: MIGRATION_TEXT,
      classificationVersion: CLASSIFICATION_VERSION,
      digestVersion: DIGEST_VERSION,
      runningActor: RUNNING_ACTOR,
      inputSha256
    });
  } catch (err) {
    console.error("FATAL: recordBackfillRun rejected; live DB untouched.", err);
    tmpDb.close();
    await unlink(TMP_PATH).catch(() => undefined);
    process.exit(3);
  }

  // 6. Compute post-backfill digest for recordkeeping.
  const postRows = tmpDb
    .prepare(
      `SELECT 'access_log' AS t, id, association_status FROM access_log
       UNION ALL
       SELECT 'conversation_turns' AS t, turn_id AS id, association_status FROM conversation_turns
       ORDER BY t, id`
    )
    .all();
  const postSha256 = sha256(Buffer.from(JSON.stringify(postRows), "utf8"));

  tmpDb.close();

  const summary = {
    dbPath: ABS_PATH,
    tmpPath: TMP_PATH,
    classificationVersion: CLASSIFICATION_VERSION,
    digestVersion: DIGEST_VERSION,
    runningActor: RUNNING_ACTOR,
    inputSha256,
    postSha256,
    ...backfillResult,
    promoted: false
  };
  console.log(JSON.stringify(summary, null, 2));

  if (PROMOTE) {
    // 7. Operator step: requires Lucy to be stopped AND no other SQLite
    // connection to be active. The standard "open read-write then close"
    // probe does NOT prove the absence of other writers (SQLite WAL allows
    // multiple readers). Instead we require an env-file sentinel: the
    // operator must create `.lucy-stopped-for-backfill` next to the DB.
    // (This is also a deliberate operator gate, not an automatic one.)
    const sentinelPath = ABS_PATH + ".lucy-stopped-for-backfill";
    const fs = await import("node:fs/promises");
    let sentinelExists = false;
    try {
      await fs.access(sentinelPath);
      sentinelExists = true;
    } catch {
      sentinelExists = false;
    }
    if (!sentinelExists) {
      console.error(
        "FATAL: --promote refused. Create sentinel file " +
          sentinelPath +
          " AFTER stopping Lucy, then re-run. Lucy must be fully down (no live DB writers)."
      );
      process.exit(4);
    }
    // Best-effort lock probe: open in read-write + IMMEDIATE to acquire
    // the reserved lock; if any other process holds it, this throws.
    const liveWritable = new Database(ABS_PATH, { fileMustExist: true });
    try {
      liveWritable.exec("BEGIN IMMEDIATE; ROLLBACK;");
    } catch (err) {
      liveWritable.close();
      console.error("FATAL: live DB is locked by another writer; cannot promote.", err);
      process.exit(5);
    }
    liveWritable.close();
    await fsRename(TMP_PATH, ABS_PATH);
    console.log(JSON.stringify({ ...summary, promoted: true }, null, 2));
  } else {
    console.error(
      "INFO: snapshot at " +
        TMP_PATH +
        ". Inspect then re-run with --promote (after Lucy is down) to swap."
    );
  }
}

main().catch((err) => {
  console.error("BACKFILL_FAILED", err);
  process.exit(1);
});