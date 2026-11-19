/**
 * LS-24 判定函数单测（P1-34 §11.4）
 * 验证 readTables 判定逻辑：全部 deferred 或字段总数为 0 应判 FAIL，不得静默通过。
 * 本文件使用 node --test，不依赖 Docker 或真实数据库。
 *
 * 登记 root-test-registry.json：scripts/uat/large-schema-ingestion-ls24.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { judgeReadTables } from "./lib/large-schema-judgment.mjs";

/**
 * Extracted decision logic for UAT-SCALE-04/06.
 * @param {object} result - { done, columns, failure }
 * @param {number} expectedTables
 * @param {number} expectedColumnsMin
 * @returns {{ pass: boolean; reason: string }}
 */

test("LS-24 judgment: 0 tables done → FAIL", () => {
  const j = judgeReadTables({ done: 0, columns: 0, failure: "" }, 600, 1);
  assert.equal(j.pass, false, `expected FAIL: ${j.reason}`);
});

test("LS-24 judgment: tables done but 0 columns → FAIL (all deferred)", () => {
  // Simulates the case where readTables counted done=600 but no columns were actually read.
  const j = judgeReadTables({ done: 600, columns: 0, failure: "" }, 600, 1);
  assert.equal(j.pass, false, `expected FAIL when columns=0: ${j.reason}`);
});

test("LS-24 judgment: partial tables done → FAIL", () => {
  const j = judgeReadTables({ done: 500, columns: 15000, failure: "" }, 600, 1);
  assert.equal(j.pass, false, `expected FAIL when done<expected: ${j.reason}`);
});

test("LS-24 judgment: all done with expected columns → PASS", () => {
  const j = judgeReadTables({ done: 600, columns: 18000, failure: "" }, 600, 1);
  assert.equal(j.pass, true, `expected PASS: ${j.reason}`);
});

test("LS-24 judgment: failure string set → FAIL", () => {
  const j = judgeReadTables({ done: 600, columns: 18000, failure: "HTTP 503" }, 600, 1);
  assert.equal(j.pass, false, `expected FAIL when failure set: ${j.reason}`);
});

test("LS-24 judgment: permission and missing metadata cannot be a successful output", () => {
  assert.equal(judgeReadTables({ done: 599, columns: 17970, failure: "t0:permission" }, 600, 18000).pass, false);
  assert.equal(judgeReadTables({ done: 600, columns: NaN, failure: "" }, 600, 18000).pass, false);
});
