import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  classifyVerdict,
  evaluateSuiteRows,
  parseIndexRows,
} from "./uat-verdict-gate.mjs";

function makeUatDir(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "uat-verdict-gate-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

function row({ suite, dir = "sample", runs = "", verdict = "**NOT RUN**" }) {
  const runsCell = runs ? `[跑次](${runs})` : "尚无";
  return `| \`UAT-SUITE-${suite}\` | **P1-99** | [suites/${dir}](suites/${dir}/suite.md) | 环境 | ${runsCell} | ${verdict} |`;
}

describe("uat-verdict-gate", () => {
  it("classifies verdicts with worst-state-wins across bold segments", () => {
    assert.equal(classifyVerdict("**PASS**（R0／01–06）"), "PASS");
    assert.equal(classifyVerdict("**PASS WITH GAPS**（仅B1）"), "PASS WITH GAP");
    assert.equal(
      classifyVerdict("**FAIL**（首轮）**2026-11-24 增量登记**：**NOT RUN**"),
      "FAIL",
    );
    assert.equal(classifyVerdict("尚无 | **NOT RUN**".replace("尚无 | ", "")), "NOT RUN");
    assert.equal(classifyVerdict("无粗体判定"), null);
    assert.equal(classifyVerdict("**SEED_ONLY**（具名冻结收口）"), "SEED_ONLY");
  });

  it("parses index rows and skips auxiliary rows without a suite.md path", () => {
    const text = [
      "| Suite | 总账 ID | 路径 | 必做环境 | 最近跑次 | 结果 |",
      "|---|---|---|---|---|---|",
      row({ suite: "ALPHA", runs: "runs/2026-01-01-a.md", verdict: "**PASS**" }),
      "| `UAT-SUITE-CONTEXT-CONTENT` | — | 改前诊断 | 诊断 | | 无粗体 |",
    ].join("\n");
    const rows = parseIndexRows(text);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].dir, "sample");
    assert.deepEqual(rows[0].runLinks, ["runs/2026-01-01-a.md"]);
    assert.equal(rows[0].verdict, "PASS");
    assert.equal(rows[1].dir, null);
    assert.equal(rows[1].verdict, null);
  });

  it("flags a missing faces declaration and orphan registry entries", () => {
    const rows = parseIndexRows(row({ suite: "ALPHA" }));
    const { violations } = evaluateSuiteRows({
      rows,
      registry: { "UAT-SUITE-OTHER": { faces: ["api"] } },
      uatDir: "/unused",
    });
    assert.deepEqual(
      violations.map((v) => v.rule).sort(),
      ["missing-faces-declaration", "orphan-registry-entry"],
    );
  });

  it("rejects faces outside the vocabulary", () => {
    const rows = parseIndexRows(row({ suite: "ALPHA" }));
    const { violations } = evaluateSuiteRows({
      rows,
      registry: { "UAT-SUITE-ALPHA": { faces: ["browser"] } },
      uatDir: "/unused",
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].rule, "invalid-faces");
  });

  it("requires an existing run link for PASS verdicts", () => {
    const dir = makeUatDir({
      "suites/sample/suite.md": "# suite\n",
    });
    const rows = parseIndexRows(row({ suite: "ALPHA", runs: "runs/gone.md", verdict: "**PASS**" }));
    const { violations } = evaluateSuiteRows({
      rows,
      registry: { "UAT-SUITE-ALPHA": { faces: ["api"], tier: "strict" } },
      uatDir: dir,
    });
    assert.deepEqual(
      violations.map((v) => v.rule).sort(),
      ["run-file-missing"],
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("requires browser evidence for webui-face PASS in strict tier", () => {
    const dir = makeUatDir({
      "suites/sample/suite.md": "# suite\n",
      "runs/2026-01-01-api-only.md": "纯 API 跑次，无浏览器。\n",
    });
    const rows = parseIndexRows(
      row({ suite: "ALPHA", runs: "runs/2026-01-01-api-only.md", verdict: "**PASS**" }),
    );
    const registry = { "UAT-SUITE-ALPHA": { faces: ["webui"], tier: "strict" } };
    const strict = evaluateSuiteRows({ rows, registry, uatDir: dir });
    assert.deepEqual(
      strict.violations.map((v) => v.rule),
      ["webui-pass-requires-browser-evidence"],
    );
    const legacy = evaluateSuiteRows({
      rows,
      registry: { "UAT-SUITE-ALPHA": { faces: ["webui"], tier: "legacy" } },
      uatDir: dir,
    });
    assert.equal(legacy.violations.length, 0);
    assert.equal(legacy.warnings.length, 1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts webui-face PASS when a run cites real browser evidence", () => {
    const dir = makeUatDir({
      "suites/sample/suite.md": "# suite\n",
      "runs/2026-01-01-browser.md": "真实前台浏览器 1920×1080，primaryReady 320ms。\n",
    });
    const rows = parseIndexRows(
      row({ suite: "ALPHA", runs: "runs/2026-01-01-browser.md", verdict: "**PASS**" }),
    );
    const { violations } = evaluateSuiteRows({
      rows,
      registry: { "UAT-SUITE-ALPHA": { faces: ["webui"], tier: "strict" } },
      uatDir: dir,
    });
    assert.equal(violations.length, 0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("requires MIP linkage or a reasoned exemption for mcp-face PASS", () => {
    const dir = makeUatDir({ "suites/sample/suite.md": "# suite\n" });
    const rows = parseIndexRows(row({ suite: "ALPHA", runs: "runs/a.md", verdict: "**PASS**" }));
    const base = { faces: ["mcp"], tier: "strict" };

    const missing = evaluateSuiteRows({
      rows,
      registry: { "UAT-SUITE-ALPHA": { ...base, runs: "runs/a.md" } },
      uatDir: dir,
    });
    assert.ok(missing.violations.some((v) => v.rule === "run-file-missing"));
    assert.ok(missing.violations.some((v) => v.rule === "mcp-pass-requires-mip-linkage"));

    const exemptNoReason = evaluateSuiteRows({
      rows: parseIndexRows(row({ suite: "ALPHA", verdict: "**PASS**" })),
      registry: {
        "UAT-SUITE-ALPHA": { ...base, mip: { status: "exempt", reason: "  " } },
      },
      uatDir: dir,
    });
    assert.ok(exemptNoReason.violations.some((v) => v.rule === "mip-exempt-requires-reason"));

    mkdirSync(path.join(dir, "runs"), { recursive: true });
    writeFileSync(path.join(dir, "suites/sample/suite.md"), "回归归 UAT-MIP 主档\n");
    writeFileSync(path.join(dir, "runs/linked.md"), "跑次\n");
    const linked = evaluateSuiteRows({
      rows: parseIndexRows(
        row({ suite: "ALPHA", runs: "runs/linked.md", verdict: "**PASS**" }),
      ),
      registry: { "UAT-SUITE-ALPHA": { ...base, mip: { status: "linked" } } },
      uatDir: dir,
    });
    assert.equal(linked.violations.length, 0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("blocks PASS claims on auxiliary rows without a suite.md path", () => {
    const line =
      "| `UAT-SUITE-AUX` | — | 无路径 | 环境 | | **PASS** |";
    const rows = parseIndexRows(line);
    assert.equal(rows[0].dir, null);
    const { violations } = evaluateSuiteRows({
      rows,
      registry: {},
      uatDir: "/unused",
    });
    assert.deepEqual(
      violations.map((v) => v.rule),
      ["aux-row-no-pass"],
    );
  });
});
