#!/usr/bin/env node
/**
 * ensure-scale-baseline.mjs — 让运行中的 demo／UAT 栈达到全局规模水位。
 *
 * SOT：docs/qa/uat/scale-baseline.md。
 * 行为：先只读检查；已达标且存在 marker 则跳过；否则按序跑 MySQL 大 Schema
 * ＋ access／wiki-skills／audit 造数三件套，复核后写入卷内 marker。
 * 默认不含 Hive（未起栈时基线允许 SKIPPED）；设 UAT_SCALE_INCLUDE_HIVE=1 才灌 Hive。
 *
 * 用法：
 *   node scripts/uat/ensure-scale-baseline.mjs
 *   node scripts/uat/ensure-scale-baseline.mjs --force
 *   node scripts/uat/ensure-scale-baseline.mjs --check-only
 *   ENSURE_SCALE_DRY_RUN=1 node scripts/uat/ensure-scale-baseline.mjs
 *
 * 覆盖：UAT_LUCY_CONTAINER、UAT_DEMO_DB_CONTAINER、LUCY_DEMO_WEBUI_HOST_PORT、
 *       UAT_SCALE_INCLUDE_HIVE、ENSURE_SCALE_FORCE、ENSURE_SCALE_CHECK_ONLY、
 *       ENSURE_SCALE_DRY_RUN、ENSURE_SCALE_SKIP_MARKER
 */
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MARKER_PATH,
  SCALE_SEED,
  SCALE_SOT,
  formatMarker,
  parseMarker,
  shouldReseed,
} from "./ensure-scale-baseline-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = new Set(process.argv.slice(2));
const FORCE = argv.has("--force") || process.env.ENSURE_SCALE_FORCE === "1";
const CHECK_ONLY =
  argv.has("--check-only") || process.env.ENSURE_SCALE_CHECK_ONLY === "1";
const DRY_RUN = process.env.ENSURE_SCALE_DRY_RUN === "1";
const SKIP_MARKER = process.env.ENSURE_SCALE_SKIP_MARKER === "1";
const INCLUDE_HIVE = process.env.UAT_SCALE_INCLUDE_HIVE === "1";

const LUCY = process.env.UAT_LUCY_CONTAINER || resolveLucyContainer();
const DB = process.env.UAT_DEMO_DB_CONTAINER || resolveDbContainer();

function resolveLucyContainer() {
  for (const name of ["compose-lucy-1", "project-lucy-lucy-1"]) {
    if (running(name)) return name;
  }
  return "compose-lucy-1";
}

function resolveDbContainer() {
  for (const name of ["compose-demo-db-1", "project-lucy-demo-db-1"]) {
    if (running(name)) return name;
  }
  return "compose-demo-db-1";
}

function running(container) {
  try {
    const out = execFileSync(
      "docker",
      ["inspect", "-f", "{{.State.Running}}", container],
      { stdio: ["pipe", "pipe", "pipe"] },
    )
      .toString()
      .trim();
    return out === "true";
  } catch {
    return false;
  }
}

function runNode(relScript, extraEnv = {}) {
  const script = path.join(ROOT, relScript);
  const env = {
    ...process.env,
    UAT_LUCY_CONTAINER: LUCY,
    UAT_DEMO_DB_CONTAINER: DB,
    ...extraEnv,
  };
  if (DRY_RUN) {
    console.log(`[ensure-scale] DRY_RUN would run: node ${relScript}`);
    return 0;
  }
  const r = spawnSync(process.execPath, [script], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  return r.status ?? 1;
}

function runBash(relScript, args = [], extraEnv = {}) {
  const script = path.join(ROOT, relScript);
  const env = {
    ...process.env,
    UAT_LUCY_CONTAINER: LUCY,
    UAT_DEMO_DB_CONTAINER: DB,
    ...extraEnv,
  };
  if (DRY_RUN) {
    console.log(
      `[ensure-scale] DRY_RUN would run: bash ${relScript} ${args.join(" ")}`.trim(),
    );
    return 0;
  }
  const r = spawnSync("bash", [script, ...args], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  return r.status ?? 1;
}

function readMarker() {
  try {
    const body = execFileSync(
      "docker",
      ["exec", LUCY, "sh", "-c", `cat ${MARKER_PATH} 2>/dev/null || true`],
      { stdio: ["pipe", "pipe", "pipe"] },
    )
      .toString()
      .trim();
    return body ? parseMarker(body) : null;
  } catch {
    return null;
  }
}

function writeMarker() {
  if (SKIP_MARKER || DRY_RUN) {
    if (DRY_RUN) console.log(`[ensure-scale] DRY_RUN would write ${MARKER_PATH}`);
    return;
  }
  const body = formatMarker({
    profile: "global",
    sot: SCALE_SOT,
    seed: String(SCALE_SEED),
    seeded_at: new Date().toISOString(),
    include_mysql: "1",
    include_hive: INCLUDE_HIVE ? "1" : "0",
    container: LUCY,
  });
  const b64 = Buffer.from(body, "utf8").toString("base64");
  execFileSync(
    "docker",
    [
      "exec",
      LUCY,
      "sh",
      "-c",
      `printf '%s' '${b64}' | base64 -d > ${MARKER_PATH} && chown 10001:10001 ${MARKER_PATH} 2>/dev/null || true`,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  console.log(`[ensure-scale] wrote ${MARKER_PATH}`);
}

function checkBaseline() {
  // Always run the real read-only check so DRY_RUN still prints an accurate
  // reseed decision; only seed / marker writes are skipped under DRY_RUN.
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts/uat/check-uat-scale-baseline.mjs")],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        UAT_LUCY_CONTAINER: LUCY,
        UAT_DEMO_DB_CONTAINER: DB,
      },
      stdio: "inherit",
    },
  );
  return r.status ?? 1;
}

function seedAll() {
  console.log("[ensure-scale] seeding MySQL large-schema fixtures…");
  const mysqlRc = runBash("scripts/uat/seed-large-schema-fixtures.sh", ["mysql"]);
  if (mysqlRc !== 0) return mysqlRc;

  if (INCLUDE_HIVE) {
    console.log("[ensure-scale] seeding Hive large-schema fixtures…");
    const hiveRc = runBash("scripts/uat/seed-large-schema-fixtures.sh", ["hive"]);
    if (hiveRc !== 0) return hiveRc;
  } else {
    console.log("[ensure-scale] Hive skipped (set UAT_SCALE_INCLUDE_HIVE=1 to include)");
  }

  console.log("[ensure-scale] seeding access.yaml…");
  const accessRc = runNode("scripts/uat/seed-scale-access.mjs");
  if (accessRc !== 0) return accessRc;

  console.log("[ensure-scale] seeding wiki + skills…");
  const wikiRc = runNode("scripts/uat/seed-scale-wiki-skills.mjs");
  if (wikiRc !== 0) return wikiRc;

  console.log("[ensure-scale] seeding audit rows…");
  return runNode("scripts/uat/seed-scale-audit-rows.mjs");
}

function main() {
  console.log(
    `[ensure-scale] lucy=${LUCY} db=${DB} force=${FORCE ? 1 : 0} check_only=${CHECK_ONLY ? 1 : 0}`,
  );

  if (!running(LUCY) || !running(DB)) {
    console.error(
      `[ensure-scale] containers not running: lucy=${running(LUCY)} db=${running(DB)}`,
    );
    process.exit(2);
  }

  const marker = readMarker();
  if (marker) {
    console.log(
      `[ensure-scale] marker present seed=${marker.seed || "?"} seeded_at=${marker.seeded_at || "?"}`,
    );
  } else {
    console.log("[ensure-scale] marker absent");
  }

  if (CHECK_ONLY) {
    const rc = checkBaseline();
    process.exit(rc);
  }

  const checkRc = checkBaseline();
  const decision = shouldReseed({
    force: FORCE,
    checkOk: checkRc === 0,
    hasMarker: Boolean(marker),
  });
  console.log(`[ensure-scale] decision=${decision.action} (${decision.reason})`);

  if (decision.action === "skip") {
    if (!marker && !SKIP_MARKER && !DRY_RUN) writeMarker();
    console.log("[ensure-scale] already at scale baseline");
    process.exit(0);
  }

  const seedRc = seedAll();
  if (seedRc !== 0) {
    console.error(`[ensure-scale] seed failed (exit ${seedRc})`);
    process.exit(seedRc);
  }

  if (DRY_RUN) {
    writeMarker();
    console.log("[ensure-scale] DRY_RUN complete — no post-seed check (seeds were not applied)");
    process.exit(0);
  }

  const afterRc = checkBaseline();
  if (afterRc !== 0) {
    console.error("[ensure-scale] post-seed baseline check failed");
    process.exit(afterRc);
  }

  writeMarker();
  console.log("[ensure-scale] ok — scale baseline ensured");
  process.exit(0);
}

main();
