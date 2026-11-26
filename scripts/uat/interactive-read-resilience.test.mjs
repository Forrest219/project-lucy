import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  A_CLASS_BUSY_REASONS,
  CALIBRATION_CASES,
  DEFAULT_PLAN,
  buildFakeRun,
  calibrateJudges,
  createRecorder,
  displayFromHeaders,
  fireSyncPoint,
  judgeDisplay,
  judgeRun,
  nearestRank,
  peakInFlight,
  redactReceipt,
  sameValue
} from "./interactive-read-resilience.mjs";

const SCRIPT = fileURLToPath(new URL("./interactive-read-resilience.mjs", import.meta.url));
const clone = (v) => JSON.parse(JSON.stringify(v));
const find = (res, code) => res.findings.filter((f) => f.code === code);

test("good fake run: PASS, 50 agents in flight at both sync points", () => {
  const res = judgeRun(buildFakeRun());
  assert.equal(res.verdict, "PASS", JSON.stringify(res.findings));
  assert.equal(res.stats.syncPoints.S1.peakInFlight, 50);
  assert.equal(res.stats.syncPoints.S2.peakInFlight, 50);
  assert.ok(res.stats.syncPoints.S1.sendSpreadMs <= 50);
});

test("late 200 is detected even though status is 200", () => {
  const run = buildFakeRun();
  const r = run.receipts.find((x) => x.id === "S1-3");
  r.clientDoneMs = r.sentMs + 10_001;
  const res = judgeRun(run);
  assert.equal(res.verdict, "FAIL");
  assert.deepEqual(find(res, "late_200").map((f) => f.id), ["S1-3"]);
});

test("deadline boundary: exactly at limit passes", () => {
  const run = buildFakeRun();
  const r = run.receipts.find((x) => x.id === "S1-3");
  r.clientDoneMs = r.sentMs + 10_000;
  assert.equal(judgeRun(run).verdict, "PASS");
});

test("initial 503 followed by retry success is still a failure", () => {
  const run = clone(CALIBRATION_CASES.find((c) => c.code === "initial_503_retry_success").mutate(buildFakeRun()));
  const res = judgeRun(run);
  const hit = find(res, "initial_503_retry_success");
  assert.equal(res.verdict, "FAIL");
  assert.equal(hit.length, 1);
  assert.equal(hit[0].retriedToSuccess, true);
  assert.equal(hit[0].attempts, 2);
});

test("first 503 with no recovery reports first_attempt_503; controlled fault is exempt", () => {
  const run = buildFakeRun();
  Object.assign(run.receipts.find((x) => x.id === "S2-5"), { httpStatus: 503, observed: {} });
  assert.equal(find(judgeRun(run), "first_attempt_503").length, 1);
  run.receipts.find((x) => x.id === "S2-5").controlledFault = true;
  assert.equal(find(judgeRun(run), "first_attempt_503").length, 0);
});

test("expected 403 for a revoked target is not a first-attempt failure", () => {
  const res = judgeRun(buildFakeRun());
  assert.equal(find(res, "first_attempt_failed").length, 0);
  assert.equal(find(res, "unexpected_permission_result").length, 0);
});

test("unexpected permission result: denied target served data, or allowed query rejected", () => {
  const leak = buildFakeRun();
  Object.assign(leak.receipts.find((x) => x.id === "deny-0"), { httpStatus: 200, observed: { allowed: true, leaked: true } });
  assert.equal(find(judgeRun(leak), "unexpected_permission_result").length, 1);

  const rejected = buildFakeRun();
  Object.assign(rejected.receipts.find((x) => x.id === "S2-7"), { httpStatus: 403, observed: { allowed: false } });
  const res = judgeRun(rejected);
  assert.equal(res.verdict, "FAIL");
  assert.equal(find(res, "unexpected_permission_result")[0].id, "S2-7");

  const leakedOnly = buildFakeRun();
  leakedOnly.receipts.find((x) => x.id === "deny-0").observed.leaked = true;
  assert.equal(find(judgeRun(leakedOnly), "unexpected_permission_result").length, 1);
});

test("wrong SQL value is detected; numeric strings and exact match are accepted", () => {
  const run = buildFakeRun();
  run.receipts.find((x) => x.id === "S2-9").observed.sqlValue = 999;
  const res = judgeRun(run);
  assert.equal(res.verdict, "FAIL");
  assert.deepEqual(find(res, "wrong_sql_value")[0].observed, 999);

  const ok = buildFakeRun();
  ok.receipts.find((x) => x.id === "S2-9").observed.sqlValue = "1000";
  assert.equal(judgeRun(ok).verdict, "PASS");
  assert.equal(sameValue("a ", "a"), true);
  assert.equal(sameValue(1, 2), false);
  assert.equal(sameValue(1.0004, 1, 0.001), true);
});

test("success response without observed SQL value is missing evidence, not PASS", () => {
  const run = buildFakeRun();
  delete run.receipts.find((x) => x.id === "S2-9").observed.sqlValue;
  const res = judgeRun(run);
  assert.equal(res.verdict, "BLOCKED");
  assert.ok(find(res, "missing_evidence").some((f) => f.field === "observed.sqlValue"));
});

test("never reaching 50 in flight: verdict not PASS, pressure not covered", () => {
  const run = clone(CALIBRATION_CASES.find((c) => c.code === "in_flight_below_target").mutate(buildFakeRun()));
  const res = judgeRun(run);
  const hit = find(res, "in_flight_below_target");
  assert.equal(hit.length, 1);
  assert.equal(hit[0].syncPoint, "S2");
  assert.ok(hit[0].peak < 50);
  assert.equal(res.verdict, "BLOCKED");
});

test("a proven product failure takes precedence over missing pressure evidence", () => {
  const run = buildFakeRun();
  for (const r of run.receipts.filter((x) => x.syncPoint === "S2")) r.proxyEndMs = r.proxyArriveMs + 10;
  run.receipts.find((x) => x.id === "S2-9").observed.sqlValue = 1;
  assert.equal(judgeRun(run).verdict, "FAIL");
});

test("in-flight uses distinct agents, so duplicate requests from one agent do not inflate the peak", () => {
  const same = Array.from({ length: 60 }, () => ({ agentId: "a", start: 0, end: 100 }));
  assert.equal(peakInFlight(same), 1);
  const distinct = Array.from({ length: 50 }, (_, i) => ({ agentId: `a${i}`, start: i, end: 100 }));
  assert.equal(peakInFlight(distinct), 50);
  assert.equal(peakInFlight([{ agentId: "a", start: 0, end: 10 }, { agentId: "b", start: 10, end: 20 }]), 2, "touching intervals count as overlap");
  assert.equal(peakInFlight([]), 0);
});

test("sync spread over 50 ms is flagged", () => {
  const run = buildFakeRun();
  const r = run.receipts.find((x) => x.id === "S1-10");
  for (const k of ["sentMs", "proxyArriveMs", "proxyEndMs", "clientDoneMs"]) r[k] += 200;
  const res = judgeRun(run);
  assert.equal(find(res, "sync_spread_exceeded").length, 1);
  assert.equal(res.verdict, "BLOCKED");
});

test("missing evidence: proxy times, audit link, dropped receipt, unfinished request, duplicate id", () => {
  const cases = {
    proxy: (run) => delete run.receipts.find((x) => x.id === "S1-11").proxyEndMs,
    audit: (run) => delete run.receipts.find((x) => x.id === "S2-12").auditRef,
    dropped: (run) => { run.receipts = run.receipts.filter((x) => x.id !== "S2-13"); },
    unfinished: (run) => delete run.receipts.find((x) => x.id === "S1-14").clientDoneMs,
    duplicate: (run) => { run.receipts.find((x) => x.id === "S1-15").id = "S1-16"; }
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const run = buildFakeRun();
    mutate(run);
    const res = judgeRun(run);
    assert.equal(res.verdict, "BLOCKED", name);
    assert.ok(res.codes.includes(name === "duplicate" ? "duplicate_correlation_id" : "missing_evidence"), name);
  }
});

test("no receipts at all is BLOCKED, never PASS", () => {
  assert.equal(judgeRun({ receipts: [] }).verdict, "BLOCKED");
  assert.equal(judgeRun(undefined).verdict, "BLOCKED");
});

test("declared sync point with zero receipts is BLOCKED", () => {
  const run = buildFakeRun();
  run.receipts = run.receipts.filter((x) => x.syncPoint !== "S2");
  const res = judgeRun(run);
  assert.equal(res.verdict, "BLOCKED");
  assert.ok(res.findings.some((f) => f.code === "missing_evidence" && f.syncPoint === "S2"));
});

test("timeout is recorded at the deadline and always fails", () => {
  const run = buildFakeRun();
  Object.assign(run.receipts.find((x) => x.id === "S2-4"), { timedOut: true, httpStatus: null });
  const res = judgeRun(run);
  assert.equal(res.verdict, "FAIL");
  assert.equal(find(res, "timeout").length, 1);
});

test("credential in a receipt fails; redactReceipt removes it", () => {
  const run = buildFakeRun();
  run.receipts[0].headers = { Authorization: "Bearer abc.def", note: "x" };
  assert.equal(find(judgeRun(run), "credential_leak").length, 1);
  const clean = redactReceipt(run.receipts);
  assert.equal(clean[0].headers.Authorization, "[redacted]");
  run.receipts = clean;
  assert.equal(find(judgeRun(run), "credential_leak").length, 0);
  assert.equal(redactReceipt({ n: "see Bearer xyz123" }).n, "see Bearer [redacted]");
});

test("latency budgets use nearest-rank percentiles and fail on regression", () => {
  assert.equal(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5), 5);
  assert.equal(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.99), 10);
  assert.equal(nearestRank([], 0.5), null);
  const run = buildFakeRun();
  run.plan.budgets = [{ name: "init", steps: ["initialize"], p50: 200 }];
  const res = judgeRun(run);
  assert.equal(res.verdict, "FAIL");
  assert.equal(find(res, "latency_budget_exceeded")[0].metric, "p50");
  run.plan.budgets = [{ name: "init", steps: ["initialize"], p50: 400, p99: 2000 }];
  assert.equal(judgeRun(run).verdict, "PASS");
});

test("calibration: every known-bad sample is judged as expected", () => {
  const res = calibrateJudges();
  const bad = res.cases.filter((c) => !c.ok);
  assert.deepEqual(bad, []);
  assert.ok(res.cases.length > CALIBRATION_CASES.length);
});

test("calibration detects a judge that waves everything through", () => {
  const res = calibrateJudges(() => ({ verdict: "PASS", codes: [] }));
  assert.equal(res.ok, false);
  assert.equal(res.cases.filter((c) => !c.ok).length, CALIBRATION_CASES.length);
});

test("recorder with a fake clock produces deterministic receipts; timeouts are charged at the deadline", () => {
  let t = 100;
  const rec = createRecorder({ now: () => (t += 10), runId: "t", window: "no-write" });
  const a = rec.begin({ step: "initialize", agentId: "a1", role: "lucy_admin" });
  a.sent();
  const done = a.finish({ httpStatus: 200 });
  assert.deepEqual([done.id, done.sentMs, done.clientDoneMs, done.attempt], ["t-1", 110, 120, 1]);
  const b = rec.begin({ step: "lucy_query", agentId: "a2" });
  b.sent();
  const timedOut = b.finish({ timedOut: true });
  assert.equal(timedOut.clientDoneMs - timedOut.sentMs, 10_000);
  const run = rec.toRun({ agents: 1 });
  assert.equal(run.schema, "irr-receipts/1");
  assert.equal(run.receipts.length, 2);
});

test("fireSyncPoint shares plannedMs, tight send spread, and records thrown errors as aborted", async () => {
  const rec = createRecorder({ runId: "s" });
  const agents = Array.from({ length: 50 }, (_, i) => ({ agentId: `a${i}`, role: "r", expected: { allow: true } }));
  const out = await fireSyncPoint({
    recorder: rec, syncPoint: "S1", step: "initialize", agents,
    send: async (agent) => {
      if (agent.agentId === "a7") throw new Error("socket hang up");
      return { httpStatus: 200 };
    }
  });
  assert.equal(out.length, 50);
  assert.equal(new Set(out.map((r) => r.plannedMs)).size, 1);
  const sent = out.map((r) => r.sentMs);
  assert.ok(Math.max(...sent) - Math.min(...sent) <= 50);
  const aborted = out.find((r) => r.agentId === "a7");
  assert.equal(aborted.aborted, true);
  assert.match(aborted.error, /socket hang up/);
  assert.equal(new Set(out.map((r) => r.id)).size, 50);
});

test("CLI: calibrate exits 0; judge maps verdict to exit code", () => {
  const cal = spawnSync(process.execPath, [SCRIPT, "calibrate"], { encoding: "utf8" });
  assert.equal(cal.status, 0, cal.stderr);
  assert.equal(JSON.parse(cal.stdout).ok, true);

  const dir = mkdtempSync(path.join(os.tmpdir(), "irr-"));
  const goodFile = path.join(dir, "good.json");
  writeFileSync(goodFile, JSON.stringify(buildFakeRun()));
  assert.equal(spawnSync(process.execPath, [SCRIPT, "judge", goodFile]).status, 0);

  const bad = buildFakeRun();
  bad.receipts.find((x) => x.id === "S2-9").observed.sqlValue = 1;
  const badFile = path.join(dir, "bad.json");
  writeFileSync(badFile, JSON.stringify(bad));
  assert.equal(spawnSync(process.execPath, [SCRIPT, "judge", badFile]).status, 1);

  assert.equal(spawnSync(process.execPath, [SCRIPT]).status, 64);
});

// ---------- v1.4 扩容（X1）：降级读取 200、等待预算 10 s、08-B 新口径 ----------

test("v1.4: good run counts grace/stale/pending from the receipts; fresh 200s are counted separately", () => {
  const res = judgeRun(buildFakeRun());
  assert.equal(res.verdict, "PASS", JSON.stringify(res.findings));
  const d = res.stats.display;
  assert.equal(d.stale, 1);
  assert.equal(d.pending, 1);
  assert.equal(d.grace, 0);
  assert.equal(d.degraded, 2);
  assert.equal(d.fresh, 100, "50 agents × 2 sync points; the 403 denial is not a served read");
  assert.equal(d.byStep.roster_summary.stale, 1);
  assert.equal(d.byStep.sources.pending, 1);
});

test("v1.4: display markers are read from the frozen response headers (plain object or Headers)", () => {
  const fromObject = displayFromHeaders({
    "X-Lucy-Display-State": "Stale", "X-Lucy-Display-Age-Ms": "125000", "X-Lucy-Display-Generation": "L3", "X-Lucy-Display-Prolonged": "1"
  });
  assert.deepEqual(fromObject, { state: "stale", ageMs: 125000, generation: "L3", pendingMs: undefined, prolonged: true });
  const fromHeaders = displayFromHeaders(new Headers({ "x-lucy-display-state": "pending", "x-lucy-display-pending-ms": "3000" }));
  assert.equal(fromHeaders.state, "pending");
  assert.equal(fromHeaders.pendingMs, 3000);
  assert.equal(displayFromHeaders({}), null);
  assert.equal(displayFromHeaders(undefined), null);
});

test("v1.4: the recorder derives the display marker from raw headers", () => {
  let t = 0;
  const rec = createRecorder({ now: () => (t += 10), runId: "h" });
  const h = rec.begin({ step: "sources", agentId: "ui" });
  h.sent();
  const done = h.finish({ httpStatus: 200, headers: { "x-lucy-display-state": "grace", "x-lucy-display-age-ms": "30000" } });
  assert.equal(done.display.state, "grace");
  const res = judgeDisplay(rec.receipts);
  assert.equal(res.stats.grace, 1);
  assert.deepEqual(res.findings, []);
});

test("v1.4: an A-class 503 as first response is a FAIL and is attributed to class A (08-B old 503-is-fine criterion is gone)", () => {
  const run = buildFakeRun();
  Object.assign(run.receipts.find((x) => x.id === "D-pending"), { httpStatus: 503, busyReason: "build_wait_timeout", display: undefined });
  const res = judgeRun(run);
  assert.equal(res.verdict, "FAIL");
  const first = find(res, "first_attempt_503");
  assert.equal(first.length, 1);
  assert.equal(first[0].class, "A");
  assert.equal(find(res, "case_08b_busy_503").length, 1);
  assert.ok(A_CLASS_BUSY_REASONS.includes("build_wait_timeout"));
});

test("v1.4: an A-class 503 that is retried to success is still a FAIL (retry does not offset)", () => {
  const run = buildFakeRun();
  Object.assign(run.receipts.find((x) => x.id === "D-pending"), { httpStatus: 503, busyReason: "reconcile_failed", display: undefined });
  run.receipts.push({
    id: "D-pending-r2", logicalId: "D-pending", attempt: 2, step: "sources", agentId: "ui-admin", sentMs: 9000, clientDoneMs: 9300, httpStatus: 200
  });
  const res = judgeRun(run);
  assert.equal(res.verdict, "FAIL");
  assert.equal(find(res, "initial_503_retry_success").length, 1);
});

test("v1.4: 08-B expects fresh/grace or marked stale/pending 200 — each of those passes", () => {
  for (const display of [null, { state: "grace", ageMs: 30_000 }, { state: "stale", ageMs: 150_000 }, { state: "pending", pendingMs: 4_000 }]) {
    const run = buildFakeRun();
    const r = run.receipts.find((x) => x.id === "D-pending");
    r.hasData = false;
    if (display) r.display = display; else delete r.display;
    assert.equal(judgeRun(run).verdict, "PASS", JSON.stringify(display));
  }
});

test("v1.4: build wait budget is 10 s (was 4 s): 4.006 s passes, exactly 10 s passes, above 10 s fails", () => {
  assert.equal(DEFAULT_PLAN.buildWaitBudgetMs, 10_000);
  const withMs = (ms) => {
    const run = buildFakeRun();
    const r = run.receipts.find((x) => x.id === "D-pending");
    r.clientDoneMs = r.sentMs + ms;
    return judgeRun(run);
  };
  assert.equal(withMs(4_006).verdict, "PASS");
  assert.equal(withMs(10_000).verdict, "PASS");
  const over = withMs(10_001);
  assert.equal(over.verdict, "FAIL");
  assert.deepEqual(find(over, "build_wait_exceeded").map((f) => f.limitMs), [10_000]);
  // a plan may still tighten the budget explicitly
  const tight = buildFakeRun();
  tight.plan.buildWaitBudgetMs = 4_000;
  assert.equal(find(judgeRun(tight), "build_wait_exceeded").length, 1);
});

test("v1.4: pending must carry no data; stale/grace must carry an age; D_max needs Prolonged", () => {
  const withData = buildFakeRun();
  withData.receipts.find((x) => x.id === "D-pending").observed = { sqlValue: 0 };
  delete withData.receipts.find((x) => x.id === "D-pending").hasData;
  assert.equal(find(judgeRun(withData), "pending_with_data").length, 1);

  const noAge = buildFakeRun();
  delete noAge.receipts.find((x) => x.id === "D-stale").display.ageMs;
  const blocked = judgeRun(noAge);
  assert.equal(blocked.verdict, "BLOCKED");
  assert.ok(find(blocked, "missing_evidence").some((f) => f.field === "display.ageMs"));

  // I-4: pending without hasData (and no sqlValue) is missing evidence, never a pass
  const noHasData = buildFakeRun();
  delete noHasData.receipts.find((x) => x.id === "D-pending").hasData;
  const noHasDataRes = judgeRun(noHasData);
  assert.equal(noHasDataRes.verdict, "BLOCKED");
  assert.ok(find(noHasDataRes, "missing_evidence").some((f) => f.field === "hasData"));
});

test("I-3: Prolonged is judged by continuous degraded serve time, not by data age", () => {
  // first stale response already has a huge data age (post-grace): no Prolonged needed
  const aged = buildFakeRun();
  aged.receipts.find((x) => x.id === "D-stale").display.ageMs = 200_000;
  assert.equal(judgeRun(aged).verdict, "PASS");

  const stale = (id, doneMs, display) => ({
    id, logicalId: id, attempt: 1, step: "roster_summary", agentId: "ui-admin",
    sentMs: doneMs - 400, clientDoneMs: doneMs, httpStatus: 200, display: { state: "stale", ageMs: 150_000, ...display }
  });
  // streak 7.4 s → 187.4 s (> D_max + tolerance) without Prolonged → FAIL; with it → PASS
  const late = buildFakeRun();
  late.receipts.push(stale("D-stale-late", 7_400 + 180_000 + 3_000, { prolonged: false }));
  assert.equal(find(judgeRun(late), "prolonged_flag_missing").length, 1);
  late.receipts.find((x) => x.id === "D-stale-late").display.prolonged = true;
  const ok = judgeRun(late);
  assert.equal(ok.verdict, "PASS");
  assert.equal(ok.stats.display.prolonged, 1);

  // inside D_max + tolerance: not required
  const near = buildFakeRun();
  near.receipts.push(stale("D-stale-near", 7_400 + 181_500, { prolonged: false }));
  assert.equal(judgeRun(near).verdict, "PASS");

  // a fresh response resets the streak
  const reset = buildFakeRun();
  reset.receipts.push({ id: "D-fresh", logicalId: "D-fresh", attempt: 1, step: "roster_summary", agentId: "ui-admin", sentMs: 100_000, clientDoneMs: 100_300, httpStatus: 200 });
  reset.receipts.push(stale("D-stale-after-fresh", 290_000, { prolonged: false }));
  assert.equal(judgeRun(reset).verdict, "PASS");

  // header-derived receipts: X-Lucy-Display-Prolonged: 1 is what counts
  const viaHeaders = buildFakeRun();
  viaHeaders.receipts.find((x) => x.id === "D-stale").display = undefined;
  viaHeaders.receipts.find((x) => x.id === "D-stale").headers = { "X-Lucy-Display-State": "stale", "X-Lucy-Display-Age-Ms": "130000" };
  viaHeaders.receipts.push({
    id: "D-stale-h2", logicalId: "D-stale-h2", attempt: 1, step: "roster_summary", agentId: "ui-admin", sentMs: 191_000, clientDoneMs: 191_400, httpStatus: 200,
    headers: { "X-Lucy-Display-State": "stale", "X-Lucy-Display-Age-Ms": "310000", "X-Lucy-Display-Prolonged": "1" }
  });
  assert.equal(judgeRun(viaHeaders).verdict, "PASS");
});

test("v1.4: a no-pressure window (08-A) accepts zero degradation, a pressure window accepts it", () => {
  const run = buildFakeRun();
  assert.equal(judgeRun(run).verdict, "PASS");
  run.plan.noDegradation = true;
  const res = judgeRun(run);
  assert.equal(res.verdict, "FAIL");
  assert.equal(find(res, "degraded_in_no_pressure_window").length, 2);
  const clean = buildFakeRun();
  clean.receipts = clean.receipts.filter((r) => !r.id.startsWith("D-"));
  clean.plan.noDegradation = true;
  assert.equal(judgeRun(clean).verdict, "PASS");
});

test("v1.4: unknown display state values fail instead of being counted as fresh", () => {
  const run = buildFakeRun();
  run.receipts.find((x) => x.id === "D-stale").display.state = "busy";
  const res = judgeRun(run);
  assert.equal(res.verdict, "FAIL");
  assert.equal(find(res, "unknown_display_state")[0].state, "busy");
});

test("v1.4: non-200 and timed-out receipts are not counted as served reads", () => {
  const run = buildFakeRun();
  Object.assign(run.receipts.find((x) => x.id === "D-stale"), { httpStatus: 403, display: undefined });
  assert.equal(judgeRun(run).stats.display.stale, 0);
});
