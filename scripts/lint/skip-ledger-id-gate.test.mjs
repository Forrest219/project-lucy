import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { collectIssues, scanFileContent } from "./skip-ledger-id-gate.mjs";

describe("skip-ledger-id-gate", () => {
  it("allows it.skip when title includes a ledger or requirement ID", () => {
    const src = `
      it.skip("P1-57-SK1: bounds old-result reads", () => {});
      describe.skip("REQ-030-077: deferred wide table suite", () => {});
    `;
    assert.deepEqual(scanFileContent(src, "webui/server/__tests__/sample.test.ts"), []);
  });

  it("allows it.skip when a preceding comment cites a ledger or gap ID", () => {
    const src = `
      // Tracked under GAP-UAT-P0-3-ESCAPE until host confirm lands
      it.skip("waits for host confirmation", () => {});
    `;
    assert.deepEqual(scanFileContent(src, "webui/server/__tests__/sample.test.ts"), []);
  });

  it("rejects it.skip and describe.skip without a ledger ID", () => {
    const src = `
      it.skip("temporarily disabled", () => {});
      describe.skip("untracked skip", () => {});
    `;
    const issues = scanFileContent(src, "webui/server/__tests__/sample.test.ts");
    assert.equal(issues.length, 2);
    assert.equal(issues[0].rule, "skip-requires-ledger-id");
    assert.equal(issues[1].rule, "skip-requires-ledger-id");
  });

  it("rejects xit, xdescribe, test.fixme, and it.skip.each without a ledger ID", () => {
    const src = `
      xit("disabled via xit", () => {});
      xdescribe("disabled suite", () => {});
      test.fixme("broken case", async () => {});
      it.skip.each([1, 2])("case %i", () => {});
    `;
    const issues = scanFileContent(src, "webui/server/__tests__/sample.test.ts");
    assert.equal(issues.length, 4);
    assert.ok(issues.every((i) => i.rule === "skip-requires-ledger-id"));
  });

  it("does not allow a non-comment code line containing a ledger ID to whitelist an unowned skip", () => {
    const src = `
      const label = "P1-57";
      it.skip("unowned skip after code line", () => {});
    `;
    const issues = scanFileContent(src, "webui/server/__tests__/sample.test.ts");
    assert.equal(issues.length, 1);
  });

  it("always rejects .only even if a ledger ID is present", () => {
    const src = `
      it.only("P1-57: focused test", () => {});
      test.only("focused playwright test", async () => {});
    `;
    const issues = scanFileContent(src, "webui/tests/e2e/specs/sample.spec.ts");
    assert.equal(issues.length, 2);
    assert.ok(issues.every((i) => i.rule === "no-only"));
  });

  it("allows conditional environment/browser guards in Playwright E2E/perf suites", () => {
    const src = `
      test.skip(testInfo.project.name !== "chromium", "runs once in desktop Chromium");
      test.skip(!liveSecretsAvailable(), "external credential files not present");
    `;
    assert.deepEqual(scanFileContent(src, "webui/tests/e2e/specs/sample.spec.ts"), []);
    assert.deepEqual(scanFileContent(src, "webui/tests/live-e2e/sample.spec.ts"), []);
  });

  it("allows runtime BLOCKED skips in real-e2e suites but rejects unconditional non-BLOCKED skips", () => {
    const okSrc = `test.skip(true, "BLOCKED: no audit entry in this run");`;
    assert.deepEqual(scanFileContent(okSrc, "webui/tests/real-e2e/sample.spec.ts"), []);

    const badSrc = `test.skip("flaky test", async () => {});`;
    const issues = scanFileContent(badSrc, "webui/tests/real-e2e/sample.spec.ts");
    assert.equal(issues.length, 1);
    assert.equal(issues[0].rule, "skip-requires-ledger-id");
  });

  it("rejects conditional test.skip inside server/unit test directories when no ledger ID is present", () => {
    const src = `test.skip(!process.env.CI, "skip locally");`;
    const issues = scanFileContent(src, "webui/server/__tests__/sample.test.ts");
    assert.equal(issues.length, 1);
    assert.equal(issues[0].rule, "skip-requires-ledger-id");
  });

  it("ignores mentions of it.skip inside strings and comments", () => {
    const src = `
      // Do not use it.skip() without a ledger ID
      const doc = "example: test.only('foo')";
    `;
    assert.deepEqual(scanFileContent(src, "scripts/sample.mjs"), []);
  });

  it("scans a temporary directory cleanly via collectIssues", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "skip-gate-"));
    try {
      const file = path.join(dir, "bad.test.mjs");
      writeFileSync(file, `it.skip("no id here", () => {});\n`, "utf8");
      const { scanned, issues } = collectIssues([dir], dir);
      assert.equal(scanned, 1);
      assert.equal(issues.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
