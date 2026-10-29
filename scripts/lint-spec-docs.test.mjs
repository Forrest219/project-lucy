import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyViolations,
  collectDocViolations,
  scanRepo
} from "./lint-spec-docs.mjs";

const SPEC = "docs/specs/sample-spec.md";
const PLAN = "docs/plans/sample-plan.md";

const SPEC_HEADER = [
  "# 示例 Spec",
  "",
  "| 元数据 | 内容 |",
  "|---|---|",
  "| 文档类型 / 版本 | 功能设计基线 / v0.1-draft |",
  "| 状态 | 待审阅，未批准 |",
  "",
  "---",
  ""
].join("\n");

const SPEC_BODY = [
  "## 5. 核心流程（伪代码）",
  "",
  "```text",
  "step()",
  "```",
  "",
  "## 9. Terminology Compliance",
  "",
  "This feature follows `webui/docs/00-product-terminology-standard.md`.",
  "",
  "New terms:",
  "- None",
  ""
].join("\n");

const PLAN_HEADER = [
  "# 示例 Plan",
  "",
  "| 元数据 | 内容 |",
  "|---|---|",
  "| 状态 | 待审阅，未批准 |",
  "| 授权边界 | 无 |",
  "| 验收 | SC-01 全部未执行 |",
  "",
  "---",
  ""
].join("\n");

const PLAN_BODY = [
  "## 1. 目标与实施原则",
  "## 2. 开工前置",
  "## 5. 验收追踪",
  "## 6. 完成定义与非目标复核",
  "## 7. 风险与回滚",
  ""
].join("\n");

function rulesOf(violations) {
  return violations.map((v) => v.rule);
}

test("Spec：形态齐备时无违规", () => {
  const violations = collectDocViolations(SPEC, SPEC_HEADER + SPEC_BODY);
  assert.deepEqual(rulesOf(violations), []);
});

test("Spec：缺少伪代码小节 → pseudocode 违规", () => {
  const text = SPEC_HEADER + "## 9. Terminology Compliance\n\nThis feature follows x.\n\nNew terms:\n- None\n";
  assert.ok(rulesOf(collectDocViolations(SPEC, text)).includes("pseudocode"));
});

test("Spec：显式写明伪代码豁免 → 不报 pseudocode", () => {
  const text = SPEC_HEADER + "## 伪代码豁免\n\n本次为纯文案变更，伪代码不适用。\n";
  assert.ok(!rulesOf(collectDocViolations(SPEC, text)).includes("pseudocode"));
});

test("Spec：头部缺少版本或状态 → metadata 违规", () => {
  const text = "# 裸文档\n\n正文\n";
  assert.ok(rulesOf(collectDocViolations(SPEC, text)).includes("metadata"));
});

test("Design System Compliance：缺四段式模板 → 四条 ds-shape 违规", () => {
  const text = SPEC_HEADER + SPEC_BODY + "\n## 10. Design System Compliance\n\n自制表格形态。\n";
  const ds = collectDocViolations(SPEC, text).filter((v) => v.rule === "ds-shape");
  assert.equal(ds.length, 4);
  assert.match(ds.map((d) => d.message).join(" "), /Referenced Specs/);
  assert.match(ds.map((d) => d.message).join(" "), /Follow-up Needed/);
});

test("Design System Compliance：按规定模板四段 → 无 ds-shape 违规", () => {
  const text =
    SPEC_HEADER +
    SPEC_BODY +
    "\n## 10. Design System Compliance\n\n" +
    "### Referenced Specs\n\n- `a.md`\n\n" +
    "### What This Change Follows\n\n- [x] x\n\n" +
    "### Exceptions (If Any)\n\n- None\n\n" +
    "### Follow-up Needed\n\n- None\n";
  assert.ok(!rulesOf(collectDocViolations(SPEC, text)).includes("ds-shape"));
});

test("Terminology Compliance：缺 New terms 字段 → term-shape 违规", () => {
  const text = SPEC_HEADER + "## 5. 核心流程（伪代码）\n\n## 9. Terminology Compliance\n\nThis feature follows x.\n";
  const term = collectDocViolations(SPEC, text).filter((v) => v.rule === "term-shape");
  assert.equal(term.length, 1);
  assert.match(term[0].message, /New terms/);
});

test("Plan：五类小节齐备 → 无 plan-parts 违规", () => {
  const violations = collectDocViolations(PLAN, PLAN_HEADER + PLAN_BODY);
  assert.deepEqual(rulesOf(violations), []);
});

test("Plan：缺风险小节 → plan-parts 违规", () => {
  const text = PLAN_HEADER + PLAN_BODY.replace("## 7. 风险与回滚\n", "");
  const parts = collectDocViolations(PLAN, text).filter((v) => v.rule === "plan-parts");
  assert.equal(parts.length, 1);
  assert.match(parts[0].message, /风险/);
});

test("Plan：头部缺授权边界 → metadata 违规", () => {
  const text = "# 裸 Plan\n\n" + PLAN_BODY;
  assert.ok(rulesOf(collectDocViolations(PLAN, text)).includes("metadata"));
});

test("基线分类：基线内违规不阻塞，新增违规阻塞，基线失效项报 stale", () => {
  const violations = [
    { file: SPEC, rule: "index", message: "" },
    { file: PLAN, rule: "plan-parts", message: "" }
  ];
  const baselineEntries = [
    { file: SPEC, rule: "index" },
    { file: "docs/specs/gone.md", rule: "pseudocode" }
  ];
  const { blocking, stale } = classifyViolations(violations, baselineEntries);
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].rule, "plan-parts");
  assert.equal(stale.length, 1);
  assert.equal(stale[0].file, "docs/specs/gone.md");
});

test("仓库现状：门禁在基线之上必须通过（不得有新增违规）", () => {
  const result = scanRepo();
  assert.equal(
    result.blocking.length,
    0,
    `新增形态违规 ${result.blocking.length} 条：\n` + result.blocking.map((v) => `  ${v.file} [${v.rule}]`).join("\n")
  );
});

test("判定范围：未跟踪文件的违规只告警，不阻塞（共享工作区不互相误伤）", () => {
  const violations = [
    { file: "docs/specs/draft.md", rule: "index", message: "" },
    { file: "docs/specs/tracked.md", rule: "index", message: "" }
  ];
  const tracked = new Set(["docs/specs/tracked.md"]);
  const { blocking, warnings } = classifyViolations(violations, [], tracked);
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].file, "docs/specs/tracked.md");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].file, "docs/specs/draft.md");
});

test("判定范围：无法判定跟踪状态时保守按阻塞处理（宁可阻塞不可漏报）", () => {
  const violations = [{ file: SPEC, rule: "index", message: "" }];
  const { blocking, warnings } = classifyViolations(violations, [], null);
  assert.equal(blocking.length, 1);
  assert.equal(warnings.length, 0);
});

test("判定范围：git 跟踪集合含已入库文件；已跟踪文件不得降级为告警", () => {
  const result = scanRepo();
  assert.ok(result.trackedFiles instanceof Set, "trackedFiles 必须是 Set");
  assert.ok(result.trackedFiles.has("docs/README.md"), "已入库的索引文件应在跟踪集合内");
  for (const w of result.warnings ?? []) {
    assert.ok(
      !result.trackedFiles.has(w.file),
      `${w.file} 已被 git 跟踪，不应只落在告警通道`
    );
  }
});
