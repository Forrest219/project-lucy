import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CALIBRATION_CASES,
  buildFakeRun,
  calibrateJudges,
  createRecorder,
  fireSyncPoint,
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
