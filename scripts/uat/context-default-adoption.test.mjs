import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CALIBRATION_CASES,
  DEPS,
  buildFakeRun,
  calibrateJudges,
  classifyTool,
  containsValue,
  judgeAdoption,
  judgeHostQuality,
  judgeJourney,
  peakPlateaus
} from "./context-default-adoption.mjs";

const SCRIPT = fileURLToPath(new URL("./context-default-adoption.mjs", import.meta.url));
const clone = (v) => JSON.parse(JSON.stringify(v));
const has = (res, code) => res.findings.filter((f) => f.code === code);
const journey = (run, id) => run.journeys.find((j) => j.id === id);

test("good fake run: PASS across host quality, PERF and MIX", () => {
  const res = judgeAdoption(buildFakeRun());
  assert.equal(res.verdict, "PASS", JSON.stringify(res.findings));
  assert.equal(res.stats.host.journeys, 18);
  assert.deepEqual(res.stats.host.hintDependence, []);
});

test("search snippet only is not a body read", () => {
  const run = buildFakeRun();
  const j = journey(run, "claude-code-02-0");
  j.calls = j.calls.filter((c) => c.tool !== "wiki_read");
  const res = judgeAdoption(run);
  assert.equal(res.verdict, "FAIL");
  assert.equal(has(res, "search_snippet_only_as_body_read")[0].host, "claude-code");
  assert.equal(has(res, "missing_body_read_receipt").length, 0);
});

test("read whose result is only a snippet/summary is rejected", () => {
  const run = buildFakeRun();
  const read = journey(run, "cursor-agent-03-0").calls.find((c) => c.tool === "lucy_skill_read");
  read.result = { bodyKind: "summary", bodyBytes: 60 };
  assert.ok(has(judgeAdoption(run), "search_snippet_only_as_body_read").length);
});

test("no lookup and no read at all -> missing body-read receipt", () => {
  const run = buildFakeRun();
  const j = journey(run, "claude-code-04-0");
  j.calls = j.calls.filter((c) => c.dependency !== DEPS.skillBrief);
  const res = judgeAdoption(run);
  const f = has(res, "missing_body_read_receipt");
  assert.equal(f.length, 1);
  assert.equal(f[0].dependency, DEPS.skillBrief);
});

test("equivalent skill read entries (resources/read, prompts/get) count as body reads and merge for duplicates", () => {
  assert.equal(classifyTool("resources/read"), "skill_read");
  assert.equal(classifyTool("prompts/get"), "skill_read");
  const run = buildFakeRun();
  const j = journey(run, "claude-code-03-0");
  const read = j.calls.find((c) => c.tool === "lucy_skill_read");
  read.tool = "resources/read";
  assert.equal(judgeJourney(j).findings.length, 0);
  j.calls.push({ ...read, id: "again", logicalId: "again", tool: "prompts/get" });
  assert.equal(has(judgeAdoption(run), "duplicate_tool_call").length, 1);
});

test("duplicate lookup, duplicate read, duplicate query are all rejected", () => {
  for (const pick of [(c) => c.tool === "wiki_search", (c) => c.tool === "wiki_read", (c) => c.tool === "lucy_query"]) {
    const run = buildFakeRun();
    const j = journey(run, "claude-code-02-0");
    const src = j.calls.find(pick);
    j.calls.push({ ...src, id: `dup-${src.id}`, logicalId: `dup-${src.id}` });
    const res = judgeAdoption(run);
    assert.equal(res.verdict, "FAIL");
    assert.equal(has(res, "duplicate_tool_call").length, 1, src.tool);
  }
});

test("wrong SQL value and wrong answer value fail; 17 does not satisfy 7", () => {
  assert.equal(containsValue("共 17 笔", 7), false);
  assert.equal(containsValue("共 7 笔", 7), true);
  assert.equal(containsValue("比值 1.5。", 1.5), true);
  const run = buildFakeRun();
  journey(run, "claude-code-01-0").calls.find((c) => c.tool === "lucy_query").result.sqlValue = 8;
  journey(run, "cursor-agent-01-0").answer.text = "共有 17 笔订单。";
  const res = judgeAdoption(run);
  assert.equal(has(res, "wrong_sql_value")[0].expected, 7);
  assert.equal(has(res, "wrong_answer_value")[0].host, "cursor-agent");
});

test("answer must carry the governed rule conclusion; writes breach rules", () => {
  const run = buildFakeRun();
  journey(run, "claude-code-04-0").answer.text = "待处理 3 笔，有效 2 笔，比值 1.5。";
  journey(run, "cursor-agent-06-0").calls.push({ id: "w", tool: "wiki_update", sentMs: 1, clientDoneMs: 2, httpStatus: 200 });
  const res = judgeAdoption(run);
  const rules = has(res, "rule_breach").map((f) => f.rule).sort();
  assert.deepEqual(rules, ["priority-review", "zero-write-calls"]);
});

test("first timeout then retry success is a failure, not a pass", () => {
  const run = buildFakeRun();
  const j = journey(run, "claude-code-02-0");
  const read = j.calls.find((c) => c.tool === "wiki_read");
  j.calls.push({ ...read, id: "read-retry", attempt: 2 });
  Object.assign(read, { httpStatus: null, timedOut: true, result: undefined, auditRef: undefined });
  const res = judgeAdoption(run);
  assert.equal(res.verdict, "FAIL");
  assert.equal(has(res, "first_timeout_then_retry_success").length, 1);
});

test("controlled timeout (06) is not a product failure, but retrying it is a duplicate", () => {
  const run = buildFakeRun();
  assert.equal(judgeAdoption(run).verdict, "PASS");
  const j = journey(run, "cursor-agent-06-0");
  const timedOut = j.calls.find((c) => c.timedOut);
  j.calls.push({ ...timedOut, id: "retry", attempt: 2, timedOut: false, httpStatus: 200, controlledFault: false });
  const res = judgeAdoption(run);
  assert.equal(has(res, "duplicate_tool_call").length, 1);
  assert.equal(has(res, "first_timeout_then_retry_success").length, 0);
});

test("06 exceeding pre-registered deadline fails; missing timing is BLOCKED", () => {
  const run = buildFakeRun();
  journey(run, "claude-code-06-0").timing.finalAnswerMs = 130_000;
  assert.equal(has(judgeAdoption(run), "perf_deadline_exceeded").length, 1);
  delete journey(run, "claude-code-06-0").timing;
  assert.ok(has(judgeAdoption(run), "missing_evidence").some((f) => f.field === "timing"));
});

test("01／05 must stay at zero context lookups", () => {
  const run = buildFakeRun();
  journey(run, "cursor-agent-05-0").calls.push({ id: "s", tool: "wiki_search", dependency: DEPS.wiki, sentMs: 1, clientDoneMs: 2, httpStatus: 200 });
  const res = judgeAdoption(run);
  assert.equal(res.verdict, "FAIL");
  assert.equal(has(res, "unexpected_context_call")[0].caseId, "05");
});

test("natural fails while explicit passes → hint dependence recorded", () => {
  const run = buildFakeRun();
  const nat = journey(run, "claude-code-03-0");
  nat.calls = nat.calls.filter((c) => c.dependency !== DEPS.skillBacklog);
  const res = judgeHostQuality(run.journeys);
  assert.deepEqual(res.stats.hintDependence, [{ host: "claude-code", caseId: "03", firstFailure: "lookup_not_initiated_or_body_read_missing" }]);
});

test("missing dual-host journey is BLOCKED, not PASS", () => {
  const run = buildFakeRun();
  run.journeys = run.journeys.filter((j) => j.host !== "cursor-agent");
  const res = judgeAdoption(run);
  assert.equal(res.verdict, "BLOCKED");
  assert.equal(has(res, "missing_evidence").length, 9);
});

test("PERF 01／05: both blocks slower → FAIL; one block → BLOCKED until third block; third block settles", () => {
  const run = buildFakeRun();
  const blocks = run.perf.interleaved.filter((b) => b.host === "claude-code" && b.caseId === "05");
  blocks[0].b.forEach((s) => { s.finalMs += 1; });
  let res = judgeAdoption(clone(run));
  assert.equal(res.verdict, "BLOCKED");
  assert.ok(has(res, "perf_third_block_required").every((f) => f.metric === "final_answer"));

  run.perf.interleaved.push({ ...clone(blocks[1]), block: "b3" });
  assert.equal(judgeAdoption(clone(run)).verdict, "PASS");

  blocks[1].b.forEach((s) => { s.finalMs += 1; });
  res = judgeAdoption(run);
  assert.equal(res.verdict, "FAIL");
  assert.ok(has(res, "perf_over_budget").length >= 1);
});

test("PERF 01／05 rejects thin blocks, one block, incorrect B samples and context calls on B", () => {
  const run = buildFakeRun();
  run.perf.interleaved = run.perf.interleaved.filter((b) => !(b.host === "claude-code" && b.caseId === "01" && b.block === "b2"));
  assert.ok(has(judgeAdoption(clone(run)), "perf_insufficient_samples").some((f) => f.requiredBlocks === 2));

  const bad = buildFakeRun();
  bad.perf.interleaved[0].b[4].correct = false;
  assert.equal(has(judgeAdoption(bad), "perf_incorrect_sample").length, 1);

  const ctx = buildFakeRun();
  ctx.perf.interleaved[2].b[0].contextCalls = 1;
  assert.equal(has(judgeAdoption(ctx), "unexpected_context_call").length, 1);

  const aBad = buildFakeRun();
  aBad.perf.interleaved[0].a[0].correct = false;
  const res = judgeAdoption(aBad);
  assert.equal(res.verdict, "BLOCKED");
  assert.ok(has(res, "perf_baseline_incomplete").length);
});

test("PERF 02／03／04: p95 over A, max over A, denominator mismatch, incomplete baseline", () => {
  const p95 = buildFakeRun();
  p95.perf.natural[0].natural.forEach((s) => { s.finalMs += 5000; });
  const r1 = judgeAdoption(p95);
  assert.equal(r1.verdict, "FAIL");
  assert.ok(has(r1, "perf_over_budget").length && has(r1, "perf_max_exceeded").length);

  const max = buildFakeRun();
  max.perf.natural[1].natural[7].finalMs = 50_000;
  const r2 = judgeAdoption(max);
  assert.equal(r2.verdict, "FAIL");
  assert.equal(has(r2, "perf_max_exceeded")[0].overCount, 1);

  const denom = buildFakeRun();
  denom.perf.natural[2].natural.pop();
  assert.equal(judgeAdoption(denom).verdict, "BLOCKED");

  const base = buildFakeRun();
  base.perf.natural[3].explicit[0].correct = false;
  assert.ok(has(judgeAdoption(base), "perf_baseline_incomplete").length);

  const retry = buildFakeRun();
  retry.perf.natural[4].natural[0].firstAttempt = false;
  assert.ok(has(judgeAdoption(retry), "perf_not_first_attempt").length);
});

test("MIX: peak plateau is computed by distinct agents", () => {
  const { peak, segments } = peakPlateaus([
    { agentId: "a", start: 0, end: 10 }, { agentId: "b", start: 5, end: 20 }, { agentId: "c", start: 8, end: 12 }
  ]);
  assert.equal(peak, 3);
  assert.deepEqual(segments, [{ start: 8, end: 10 }]);
});

test("MIX: context call outside the base peak window → BLOCKED missing overlap evidence", () => {
  const run = buildFakeRun();
  for (const c of run.mix.windows[1].sides.B.extra.journeys[5].calls.filter((x) => x.proxyArriveMs)) {
    c.proxyArriveMs = 9000; c.proxyEndMs = 9050;
  }
  const res = judgeAdoption(run);
  assert.equal(res.verdict, "BLOCKED");
  assert.deepEqual([...new Set(has(res, "missing_mix_overlap_evidence").map((f) => f.window))], ["W2"]);
});

test("MIX: no proxy interval on a context call is BLOCKED; no peak plateau is BLOCKED", () => {
  const run = buildFakeRun();
  delete run.mix.windows[0].sides.A.extra.journeys[0].calls[0].proxyEndMs;
  assert.equal(judgeAdoption(run).verdict, "BLOCKED");
  const noBase = buildFakeRun();
  for (const r of noBase.mix.windows[2].sides.A.base.receipts) { delete r.proxyArriveMs; delete r.proxyEndMs; }
  assert.ok(has(judgeAdoption(noBase), "missing_mix_overlap_evidence").some((f) => f.field === "base peak plateau"));
});

test("MIX: write window needs roster×write overlap; read-only windows do not", () => {
  const run = buildFakeRun();
  delete run.mix.windows[0].sides.A.writeEvidence;
  assert.equal(judgeAdoption(clone(run)).verdict, "PASS");
  delete run.mix.windows[1].sides.B.writeEvidence;
  const res = judgeAdoption(run);
  assert.equal(res.verdict, "BLOCKED");
  assert.equal(has(res, "missing_mix_overlap_evidence")[0].field, "writeEvidence.roster×writes");
});

test("MIX: extra load must be 4 wiki + 4 skill + 4 combo with auth pre-check", () => {
  const run = buildFakeRun();
  run.mix.windows[0].sides.B.extra.journeys[0].kind = "skill";
  assert.ok(has(judgeAdoption(clone(run)), "mix_load_composition").length);
  const run2 = buildFakeRun();
  run2.mix.windows[0].sides.B.extra.journeys[3].authPrecheck = false;
  assert.ok(has(judgeAdoption(run2), "missing_evidence").some((f) => f.field === "authPrecheck"));
});

test("MIX: extra journey first-attempt errors and base-gate regressions both fail; timeouts stay per-side", () => {
  const run = buildFakeRun();
  const j = run.mix.windows[0].sides.B.extra.journeys[9];
  const read = j.calls.find((c) => c.tool === "lucy_skill_read");
  Object.assign(read, { httpStatus: null, timedOut: true, result: undefined, auditRef: undefined });
  const res = judgeAdoption(run);
  assert.equal(res.verdict, "FAIL");
  const f = has(res, "first_attempt_timeout")[0];
  assert.deepEqual([f.window, f.side, f.scope], ["W1", "B", "extra"]);

  const base = buildFakeRun();
  const late = base.mix.windows[2].sides.A.base.receipts.find((r) => r.id === "S1-3");
  late.clientDoneMs = late.sentMs + 10_500;
  const r2 = judgeAdoption(base);
  assert.equal(has(r2, "late_200")[0].scope, "base");
  assert.equal(r2.verdict, "FAIL");
});

test("MIX: revocation control must deny old and new sessions", () => {
  const run = buildFakeRun();
  run.mix.windows[1].sides.A.revocation.newSessionDenied = false;
  assert.equal(has(judgeAdoption(run), "revocation_leak").length, 1);
  delete run.mix.windows[1].sides.A.revocation;
  assert.ok(has(judgeAdoption(run), "missing_evidence").some((f) => f.field === "revocation"));
});

test("empty / credential-bearing receipts", () => {
  assert.equal(judgeAdoption({}).verdict, "BLOCKED");
  const run = buildFakeRun();
  journey(run, "claude-code-01-0").prompt = "Authorization: Bearer abcdef123456";
  assert.equal(judgeAdoption(run).verdict, "FAIL");
});

test("calibration: every known-bad sample is judged as expected", () => {
  const res = calibrateJudges();
  assert.ok(res.ok, JSON.stringify(res.cases.filter((c) => !c.ok)));
  assert.equal(res.cases.length, CALIBRATION_CASES.length + 1);
});

test("CLI: calibrate exits 0; judge exit codes follow verdict", () => {
  assert.equal(spawnSync("node", [SCRIPT, "calibrate"]).status, 0);
  const dir = mkdtempSync(path.join(os.tmpdir(), "cda-"));
  const good = path.join(dir, "good.json");
  writeFileSync(good, JSON.stringify(buildFakeRun()));
  assert.equal(spawnSync("node", [SCRIPT, "judge", good]).status, 0);
  const bad = buildFakeRun();
  journey(bad, "claude-code-01-0").calls.find((c) => c.tool === "lucy_query").result.sqlValue = 1;
  const badPath = path.join(dir, "bad.json");
  writeFileSync(badPath, JSON.stringify(bad));
  assert.equal(spawnSync("node", [SCRIPT, "judge", badPath]).status, 1);
  assert.equal(spawnSync("node", [SCRIPT]).status, 64);
});
