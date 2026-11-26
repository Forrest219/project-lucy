import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUDGETS_MS,
  summarizeSamples,
  judgeMainPathArms,
  judgeEventLoop,
  percentile
} from "../public-entry-static-lib.mjs";

function sample(path, totalMs, extra = {}) {
  return { kind: "entry", path, method: "GET", status: 200, bytes: 128, totalMs, ...extra };
}

test("summarizes per path with P50/P95/P99/max against frozen budgets", () => {
  const rows = [
    sample("/api/branding", 100),
    sample("/api/branding", 200),
    ...Array.from({ length: 98 }, (_, i) => sample("/api/branding", 300 + i))
  ];
  const out = summarizeSamples(rows);
  const branding = out.find((r) => r.key === "GET /api/branding");
  assert.equal(branding.ok, true);
  assert.equal(branding.n, 100);
  assert.equal(branding.budgetMs, BUDGETS_MS["/api/branding"].complete);
  assert.ok(branding.p99 <= branding.budgetMs);
});

test("flags over-budget P99, over max limit, timeouts and zero-byte", () => {
  const slow = Array.from({ length: 100 }, () => sample("/api/branding", 1500));
  const over = summarizeSamples(slow).find((r) => r.key === "GET /api/branding");
  assert.equal(over.ok, false);
  assert.equal(over.overBudget, true);

  const maxOut = Array.from({ length: 100 }, () => sample("/api/branding", 900));
  maxOut.push(sample("/api/branding", 2500)); // max 2500 > 2 × 1000
  const maxVerdict = summarizeSamples(maxOut).find((r) => r.key === "GET /api/branding");
  assert.equal(maxVerdict.ok, false);
  assert.equal(maxVerdict.overMax, true);

  const timeout = summarizeSamples([sample("/api/branding", 15000, { error: "timeout after 15000ms" })]).find((r) => r.key === "GET /api/branding");
  assert.equal(timeout.ok, false);
  assert.equal(timeout.timeouts, 1);

  const zero = summarizeSamples([sample("/api/branding", 100, { bytes: 0 })]).find((r) => r.key === "GET /api/branding");
  assert.equal(zero.ok, false);
  assert.equal(zero.zeroByte, 1);

  const status = summarizeSamples([sample("/api/branding", 100, { status: 503, expectedStatus: 200 })]).find((r) => r.key === "GET /api/branding");
  assert.equal(status.ok, false);
  assert.equal(status.badStatus, 1);
});

test("GET / uses TTFB+complete budgets and login POST is budgeted", () => {
  const home = summarizeSamples([sample("/", 1000)]).find((r) => r.key === "GET /");
  assert.equal(home.budgetMs, BUDGETS_MS["/"].complete);
  const login = summarizeSamples([{ ...sample("/api/auth/login", 2000), method: "POST" }]).find((r) => r.key === "POST /api/auth/login");
  assert.equal(login.budgetMs, BUDGETS_MS["/api/auth/login"].complete);
});

test("main-path arms: at least one success; other must succeed or bounded-reject; hang fails", () => {
  assert.equal(judgeMainPathArms([{ arm: "mcp", success: true }, { arm: "admin", success: true }]).ok, true);
  const one = judgeMainPathArms([
    { arm: "mcp", success: true },
    { arm: "admin", success: false, boundedReject: { ok: true, ms: 4000, code: "SERVICE_DRAINING" } }
  ]);
  assert.equal(one.ok, true);
  assert.equal(one.needsRetryAfterStop, true);

  assert.equal(judgeMainPathArms([
    { arm: "mcp", success: true },
    { arm: "admin", success: false, timeoutOrHang: true }
  ]).ok, false);

  assert.equal(judgeMainPathArms([
    { arm: "mcp", success: false, boundedReject: { ok: true, ms: 5000, code: "X" } },
    { arm: "admin", success: false, boundedReject: { ok: true, ms: 5000, code: "X" } }
  ]).ok, false);
});

test("event loop limits: p99<=400 and max<=800", () => {
  assert.equal(judgeEventLoop([{ p99Ms: 380, maxMs: 790 }]).ok, true);
  const bad = judgeEventLoop([{ p99Ms: 100, maxMs: 900 }]);
  assert.equal(bad.ok, false);
  assert.equal(bad.violations, 1);
});

test("percentile nearest-upper convention", () => {
  assert.equal(percentile([1, 2, 3, 4], 0.99), 4);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
  assert.equal(percentile([], 0.5), null);
});
