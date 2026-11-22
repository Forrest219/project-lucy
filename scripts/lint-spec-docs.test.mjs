import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkInteractionContract,
  checkStatusFunnel,
  classifyViolations,
  collectDesignSystemViolations,
  collectDocViolations,
  collectFilenameViolation,
  collectStaleStatusViolations,
  collectStatusVocabViolations,
  listNumberedSpecsUnder,
  loadRegisteredRoutes,
  scanRepo
} from "./lint-spec-docs.mjs";

const SPEC = "docs/specs/lucy-20261030-sample-spec.md";
const PLAN = "docs/plans/lucy-20261030-sample-plan.md";

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
  "## 闭口层级",
  "",
  "- 层级：功能合同",
  "- 本条承诺：示例承诺",
  "- 本条出口：契约测试",
  "- 不在本条出口：整库旅程、Agent 路径、故障注入、证据等级",
  "- 上线关系：本条收口不表示可上线",
  "",
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

test("仓库现状：门禁在基线之上必须通过（已知存量残余除外）", () => {
  const result = scanRepo();
  // 已知存量残余（非本条范围，禁止在本条修）：
  //  1) lucy-20261122-prepack-closure-multi-agent-plan.md 的 plan-parts/metadata（其他在途条目的文件）；
  //  2) status-funnel 对已授权、尚未迁「| 阶段 |」的存量 Spec 的 SC-10 类判失败（MIG 批次另授权补齐）。
  // 上述两类在专用测试里钉住；此处只拦截一切新增违规。
  const knownResidual = (v) =>
    (v.file === "docs/plans/lucy-20261122-prepack-closure-multi-agent-plan.md" &&
      (v.rule === "plan-parts" || v.rule === "metadata")) ||
    v.rule === "status-funnel";
  const unexpected = result.blocking.filter((v) => !knownResidual(v));
  assert.equal(
    unexpected.length,
    0,
    `新增形态违规 ${unexpected.length} 条：\n` + unexpected.map((v) => `  ${v.file} [${v.rule}]`).join("\n")
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

test("文件名：Spec 与 Plan 共用 lucy-YYYYMMDD-<slug>", () => {
  assert.equal(collectFilenameViolation(SPEC), null);
  assert.equal(collectFilenameViolation(PLAN), null);
  assert.equal(
    collectFilenameViolation("docs/plans/2026-10-30-lucy-sample-plan.md").rule,
    "filename"
  );
  assert.equal(collectFilenameViolation("docs/plans/lucy-20261030-v8-runtime-plan.md"), null);
  assert.match(
    collectFilenameViolation("docs/plans/lucy-20261030-v0p25-ops-plan.md").message,
    /版本段「v0p25」/
  );
});

test("文件名：无日期、版本段、截断日期 → filename 违规", () => {
  const undated = collectFilenameViolation("docs/specs/lucy-ci-restoration-spec.md");
  assert.equal(undated.rule, "filename");
  const versioned = collectFilenameViolation("docs/specs/lucy-20261028-v0p25-ops-spec.md");
  assert.match(versioned.message, /版本段「v0p25」/);
  const shortDate = collectFilenameViolation("docs/specs/lucy-202608-05-demo-spec.md");
  assert.equal(shortDate.rule, "filename");
  const planVersion = collectFilenameViolation("docs/plans/2026-10-28-lucy-v0.25-ops-plan.md");
  assert.equal(planVersion.rule, "filename");
});

test("文件名：v8 技术专名不当作版本段", () => {
  assert.equal(collectFilenameViolation("docs/specs/lucy-20261030-v8-runtime-spec.md"), null);
});

test("文件名：webui 数字流水号 Spec 已封板", () => {
  const violation = collectFilenameViolation("webui/docs/194-access-grade-spec.md");
  assert.equal(violation.rule, "filename");
  assert.match(violation.message, /数字流水号/);
  const oneDigit = collectFilenameViolation("webui/docs/7-access-grade-spec.md");
  assert.equal(oneDigit.rule, "filename");
  const nested = collectFilenameViolation("webui/docs/submodule/194-access-grade-spec.md");
  assert.equal(nested.rule, "filename");
});

test("扫描：模块 docs 子目录与一位流水号会被扫到", () => {
  const root = mkdtempSync(path.join(tmpdir(), "lucy-spec-docs-"));
  try {
    const nested = path.join(root, "webui", "docs", "submodule");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, "194-access-grade-spec.md"), "# x\n");
    writeFileSync(path.join(root, "webui", "docs", "7-access-grade-spec.md"), "# x\n");
    writeFileSync(path.join(root, "webui", "docs", "readme.md"), "# x\n");
    const found = listNumberedSpecsUnder(path.join(root, "webui", "docs"), "webui/docs");
    assert.deepEqual(found, [
      "webui/docs/7-access-grade-spec.md",
      "webui/docs/submodule/194-access-grade-spec.md"
    ]);
    for (const rel of found) {
      assert.equal(collectFilenameViolation(rel).rule, "filename");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const repo = scanRepo();
  assert.ok(
    repo.violations.some((v) => v.file === "webui/docs/07-mcp-auth-proxy-spec.md" && v.rule === "filename"),
    "仓库扫描必须覆盖 webui/docs 下已有的数字流水号 Spec"
  );
});

test("闭口层级：发布取证写法通过", () => {
  const text = SPEC_HEADER + [
    "## 闭口层级",
    "",
    "- 层级：发布取证",
    "- 本条承诺：这一批承诺在目标拓扑上一起成立",
    "- 本条出口：候选集上的系统路径",
    "- 不在本条出口：各模块自己的合同",
    "- 上线关系：本条通过不表示各模块无问题",
    "",
    "## 5. 核心流程（伪代码）",
    "",
    "```text",
    "step()",
    "```",
    ""
  ].join("\n");
  assert.ok(!rulesOf(collectDocViolations(SPEC, text)).includes("close-layer"));
});

test("闭口层级：字段按行精确解析", () => {
  const notContract = SPEC_HEADER + SPEC_BODY.replace("层级：功能合同", "层级：非功能合同");
  assert.match(
    collectDocViolations(SPEC, notContract).find((v) => v.rule === "close-layer").message,
    /只能是/
  );

  const emptyPromise = SPEC_HEADER + SPEC_BODY.replace("本条承诺：示例承诺", "本条承诺：");
  assert.match(
    collectDocViolations(SPEC, emptyPromise).find((v) => v.rule === "close-layer").message,
    /本条承诺/
  );

  const mentionEvidence = SPEC_HEADER + SPEC_BODY.replace(
    "不在本条出口：整库旅程、Agent 路径、故障注入、证据等级",
    "不在本条出口：发布取证层级的整库旅程"
  );
  assert.ok(!rulesOf(collectDocViolations(SPEC, mentionEvidence)).includes("close-layer"));
});

test("闭口层级：缺少小节、层级写两个、功能合同缺上线关系 → close-layer 违规", () => {
  const missing = collectDocViolations(SPEC, SPEC_HEADER + "## 5. 核心流程（伪代码）\n");
  assert.match(missing.find((v) => v.rule === "close-layer").message, /缺少「闭口层级」/);

  const both = SPEC_HEADER + SPEC_BODY.replace("层级：功能合同", "层级：功能合同或发布取证");
  assert.match(
    collectDocViolations(SPEC, both).find((v) => v.rule === "close-layer").message,
    /只能是/
  );

  const noShip = SPEC_HEADER + SPEC_BODY.replace("本条收口不表示可上线", "待定");
  assert.match(
    collectDocViolations(SPEC, noShip).find((v) => v.rule === "close-layer").message,
    /本条收口不表示可上线/
  );
});

test("stale-status：作废标记必须紧贴被作废的那句", () => {
  const bare = "A01–A12 记为「未执行且不排期」，本条不可交付 UAT。";
  const marked = "曾记「未执行且不排期」，并推出「不可交付 UAT」。这两句已作废，不得当作现值。";
  const negated = "L25-09 当前仍未执行且不排期，该状态未作废。";
  const otherFact = "登录次数已作废；L25-09 当前仍未执行且不排期，本条不可交付 UAT。";
  assert.equal(collectStaleStatusViolations("docs/reviews/sample.md", bare).length, 1);
  assert.equal(collectStaleStatusViolations("docs/reviews/sample.md", marked).length, 0);
  assert.equal(collectStaleStatusViolations("docs/reviews/sample.md", negated).length, 1);
  assert.equal(collectStaleStatusViolations("docs/reviews/sample.md", otherFact).length, 1);
});

test("stale-status：不走基线豁免", () => {
  const violations = [{ file: "docs/reviews/sample.md", rule: "stale-status", message: "" }];
  const baseline = [{ file: "docs/reviews/sample.md", rule: "stale-status" }];
  const { blocking } = classifyViolations(violations, baseline);
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].rule, "stale-status");
});

test("stale-status：仓库现值里没有裸写的已作废状态", () => {
  const result = scanRepo();
  const hits = result.blocking.filter((v) => v.rule === "stale-status");
  assert.deepEqual(hits, []);
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

const COLON = "\uff1a";
const SEMI = "\uff1b";
const COMMA = "\u3001";
const BAR = "\uff5c";
const VIEW = "1920\u00d71080";
const REL = "docs/specs/lucy-20261107-sample-interaction-spec.md";
const QUESTIONS = [
  "Q1 主任务能否从页头和主工作区开始，而不必先读 Spec",
  "Q2 PageHeader 是否满足按钮规范 §3 第 8 条，其他 action group 是否各自最多一个 primary，并且与「不做」不冲突",
  "Q3 空、错误、0 条是否在面板内写明原因；不适用是否写了原因",
  "Q4 决定信息是否足够；截断或隐藏时能否看见原因",
  "Q5 控件是否与基准页同一套；新模式是否指向已存在的设计系统章节",
  "Q6 用户可见术语是否已登记，或已写在本 Spec 的 Terminology Compliance"
];
const ALL_LABELS = ["首访", "空", "加载", "错误", "0 条", "成功", "部分", "主动作", "决定信息"];
const STATE = ["首访", "空", "加载", "错误", "0 条", "成功", "部分"].map((label, index) => `${label}${COLON}可见${index}`).join(SEMI);

function interactionDoc(status, body) {
  return `| 元数据 | 内容 |\n|---|---|\n| 状态 | ${status} |\n\n${body}\n`;
}

function runInteraction(body, planBody, options = {}) {
  const spec = interactionDoc(options.status ?? "草案", body);
  const plan = planBody == null ? null : interactionDoc(options.planStatus ?? "草案", planBody);
  return checkInteractionContract(options.specRel ?? REL, spec, plan, options);
}

function assertFail(result, fragment) {
  assert.ok(result.length > 0, "应当失败");
  assert.match(result.map((item) => item.message).join("\n"), fragment);
}

function inventoryLines(route, labels = ALL_LABELS, start = 1) {
  return labels.map((element, index) => `- E${start + index}${BAR}${route}${BAR}${element}${BAR}主区${BAR}看得到`).join("\n");
}

function idList(count) {
  return Array.from({ length: count }, (_, index) => `E${index + 1}`).join(COMMA);
}

function reviewLines(value = "通过") {
  return QUESTIONS.map((question) => `- ${question}${COLON}${value === "不通过" ? `不通过 原因${COLON}不行` : value}`).join("\n");
}

function contractBody(options = {}) {
  const route = options.route ?? "/admin/agents";
  const prefix = `新路由${COLON}`;
  const paths = route.split(COMMA).map((token) => {
    const trimmed = token.trim();
    return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
  });
  const labels = options.labels ?? ALL_LABELS;
  let cursor = 1;
  const generated = paths.map((routePath) => {
    const block = inventoryLines(routePath, labels, cursor);
    cursor += labels.length;
    return block;
  }).join("\n");
  return [
    `见 \`${paths[0]}\`。`,
    "## 交互合同",
    "",
    `- 路由${COLON}${route}`,
    `- 基准页${COLON}${options.benchmark ?? "/catalog"}`,
    `- 一件事${COLON}看清这一页`,
    `- 状态${COLON}${options.state ?? STATE}`,
    `- 主动作${COLON}${options.action ?? "一个 primary，不做第二个"}`,
    `- 决定信息${COLON}下一跳`,
    `- 术语${COLON}${options.term ?? "已登记"}`,
    `- 台账${COLON}${options.ledger ?? "无新台账"}`,
    `- 状态维度${COLON}${options.dimension ?? "同一状态维度不得互相否定"}`,
    "",
    options.between ?? "",
    "## 元素清单",
    "",
    options.inventoryText ?? generated,
    "",
    options.afterInventory ?? "",
    "## 交互评审",
    "",
    options.reviewText ?? reviewLines(),
    ""
  ].join("\n");
}

function browserBody(options = {}) {
  return [
    "## 浏览器验证",
    "",
    `- 路由${COLON}${options.route ?? "/admin/agents"}`,
    `- 视口${COLON}${options.viewport ?? VIEW}`,
    `- 状态${COLON}${options.ids ?? idList(9)}`,
    `- 证据${COLON}${options.evidence ?? "未执行"}`,
    ""
  ].join("\n");
}

function waiverBody() {
  return `## 交互合同豁免\n\n- 原因${COLON}不改变用户可见 WebUI 表面。只加 lint。\n- 不改变${COLON}页面\n`;
}

function waiverPlan() {
  return `## 浏览器验证\n\n不适用${COLON}不改变用户可见 WebUI 表面。\n`;
}

test("SC-01：反引号路由触发，围栏内不触发，生产路由表含 joins", () => {
  assert.ok(loadRegisteredRoutes().has("/joins/:conn/:schema/:table"));
  assertFail(runInteraction("见 `/joins/:conn/:schema/:table`。\n", null), /交互合同/);
  assertFail(runInteraction("见 `/future-board`。\n", null), /交互合同/);
  assertFail(runInteraction("实现落在 webui/src/app/App.tsx。\n", null), /交互合同/);
  assert.deepEqual(runInteraction("```text\n`/future-board`\n```\n正文没有路由。\n", null), []);
  assert.deepEqual(runInteraction("普通句子 /future-board 没有反引号。\n", null), []);
  assert.deepEqual(runInteraction("桌面 `/Users/forrest/Desktop`。\n", null), []);
});

test("SC-02：豁免形状、互斥和授权口令", () => {
  assertFail(runInteraction(`${waiverBody()}\n## 交互合同\n\n- 路由${COLON}/admin/agents\n`, waiverPlan()), /不能并存/);
  assertFail(runInteraction(`${waiverBody()}\n## 交互合同豁免\n\n- 原因${COLON}不改变用户可见 WebUI 表面\n- 不改变${COLON}页面\n`, waiverPlan()), /超过一个/);
  assertFail(runInteraction(`## 交互合同豁免\n\n- 原因${COLON}不改变用户可见 WebUI 表面\n`, waiverPlan()), /2 行/);
  assertFail(runInteraction(`## 交互合同豁免\n\n- 原因${COLON}只是后端\n- 不改变${COLON}页面\n`, waiverPlan()), /不改变用户可见 WebUI 表面/);
  assertFail(runInteraction(`${waiverBody()}\n## 交互评审\n\n说明\n`, waiverPlan()), /交互评审/);
  assertFail(runInteraction(`${waiverBody()}\n## 元素清单\n\n- E1${BAR}/admin/agents${BAR}主动作${BAR}主区${BAR}看得到\n`, waiverPlan()), /元素清单/);
  assertFail(runInteraction(waiverBody(), `## 浏览器验证\n\n不适用${COLON}\n`), /不适用/);
  assert.deepEqual(runInteraction(waiverBody(), waiverPlan()), []);
  assert.deepEqual(runInteraction(waiverBody(), waiverPlan(), { status: "开发授权已获得" }), []);
});

test("SC-03：合同九行的顺序、重复、小节外、状态段和不适用原因", () => {
  const lines = contractBody().split("\n");
  const routeAt = lines.findIndex((line) => line.startsWith(`- 路由${COLON}`));
  [lines[routeAt], lines[routeAt + 1]] = [lines[routeAt + 1], lines[routeAt]];
  assertFail(runInteraction(lines.join("\n"), browserBody()), /标签应为「路由」/);
  const duplicated = contractBody().replace(`- 一件事${COLON}`, `- 路由${COLON}/catalog\n- 一件事${COLON}`);
  assertFail(runInteraction(duplicated, browserBody()), /10 行/);
  assertFail(runInteraction(contractBody().replace(`- 台账${COLON}无新台账\n`, ""), browserBody()), /8 行/);
  assertFail(runInteraction(contractBody({ state: `首访${COLON}a${SEMI}空${COLON}b` }), browserBody()), /7 段/);
  const na = STATE.replace(`首访${COLON}可见0`, `首访${COLON}不适用${COLON}`);
  assertFail(runInteraction(contractBody({ state: na }), browserBody()), /不适用缺少原因/);
  assertFail(runInteraction(contractBody().replace(`- 路由${COLON}`, "- 路由:"), browserBody()), /全角冒号/);
  assert.deepEqual(runInteraction(contractBody(), browserBody()), []);
});

test("SC-04：已登记路由、新路由和基准页", () => {
  const joins = "/joins/:conn/:schema/:table";
  assert.deepEqual(runInteraction(contractBody({ route: joins, inventoryText: inventoryLines(joins) }), browserBody({ route: joins })), []);
  assertFail(runInteraction(contractBody({ route: "/future-board" }), browserBody({ route: "/future-board" })), /路由不合法/);
  const fresh = `新路由${COLON}/future-board`;
  assert.deepEqual(runInteraction(contractBody({ route: fresh }), browserBody({ route: fresh })), []);
  const taken = `新路由${COLON}/admin/agents`;
  assertFail(runInteraction(contractBody({ route: taken }), browserBody({ route: taken })), /路由不合法/);
  assertFail(runInteraction(contractBody({ benchmark: `新模式${COLON}webui/docs/design-system/missing-file.md` }), browserBody()), /新模式文件不存在/);
  assert.deepEqual(runInteraction(contractBody({ benchmark: `新模式${COLON}webui/docs/design-system/00-principles.md` }), browserBody()), []);
});

test("SC-05：主动作必须同时有 primary 和「不做」", () => {
  assertFail(runInteraction(contractBody({ action: "不做第二个" }), browserBody()), /primary/);
  assertFail(runInteraction(contractBody({ action: "一个 primary" }), browserBody()), /不做/);
});

test("SC-06：台账必须是无新台账或合法 UX 编号", () => {
  assertFail(runInteraction(contractBody({ ledger: "以后再说" }), browserBody()), /台账/);
  assert.deepEqual(runInteraction(contractBody({ ledger: "见 UX-CATALOG-001" }), browserBody()), []);
});

test("SC-07：标记行、问句和两个合同标题之间不得插入别的二级标题", () => {
  assertFail(runInteraction("交互合同适用\n", null), /交互合同/);
  assert.deepEqual(runInteraction("```text\n交互合同适用\n```\n没有别的触发。\n", null), []);
  assertFail(runInteraction(contractBody({ reviewText: reviewLines().replace("主任务", "主路径") }), browserBody()), /标签应为/);
  assertFail(runInteraction(contractBody({ reviewText: `${reviewLines()}\n- ${QUESTIONS[0]}${COLON}通过` }), browserBody()), /7 行/);
  assertFail(runInteraction(contractBody({ between: "## 别的标题\n\n说明\n" }), browserBody()), /必须是「元素清单」/);
  assertFail(runInteraction(contractBody({ afterInventory: "## 别的标题\n\n说明\n" }), browserBody()), /必须是「交互评审」/);
});

test("SC-08：授权口令只强制触发合同的六问；已批准开工不取消 grandfather", () => {
  assertFail(runInteraction(contractBody({ reviewText: reviewLines("未评") }), browserBody(), { status: "开发授权已获得" }), /六问必须全是「通过」/);
  assert.deepEqual(runInteraction(contractBody(), browserBody(), { status: "开发授权已获得" }), []);
  assert.deepEqual(runInteraction(waiverBody(), waiverPlan(), { status: "开发授权已获得" }), []);
  assert.deepEqual(runInteraction("见 `/admin/agents`。\n", null, { status: "已批准开工", grandfatherFiles: [REL] }), []);
  assert.deepEqual(runInteraction(contractBody({ reviewText: reviewLines("未评") }), browserBody()), []);
});

test("SC-09：证据形状通过不等于台账 Verified", () => {
  const evidenceRel = "docs/reviews/interaction-shape.md";
  const linesFor = ({ missing, twice, extra } = {}) => {
    const lines = Array.from({ length: 9 }, (_, index) => `E${index + 1}`).filter((id) => id !== missing).map((id) => `${id}${COLON}通过`);
    if (twice) lines.push(`E1${COLON}失败`);
    if (extra) lines.push(`E99${COLON}通过`);
    return ["/admin/agents", VIEW, ...lines].join("\n");
  };
  assertFail(runInteraction(contractBody(), "## 其他\n\n没有浏览器。\n"), /浏览器验证/);
  assertFail(runInteraction(contractBody(), browserBody({ viewport: "1920x1080" })), /视口/);
  assertFail(runInteraction(contractBody(), browserBody({ evidence: "docs/reviews" })), /目录/);
  assertFail(runInteraction(contractBody(), browserBody({ evidence: "../docs/reviews/a.md" })), /越界/);
  assertFail(runInteraction(contractBody(), browserBody({ evidence: "docs/README.md" })), /允许范围/);
  assertFail(runInteraction(contractBody(), browserBody({ evidence: "docs/reviews/missing-interaction-evidence.md" })), /不存在/);
  assertFail(runInteraction(contractBody(), browserBody({ evidence: evidenceRel }), { files: { [evidenceRel]: linesFor({ missing: "E9" }) } }), /E9/);
  assertFail(runInteraction(contractBody(), browserBody({ evidence: evidenceRel }), { files: { [evidenceRel]: linesFor({ twice: true }) } }), /E1/);
  assertFail(runInteraction(contractBody(), browserBody({ evidence: evidenceRel }), { files: { [evidenceRel]: linesFor({ extra: true }) } }), /E99/);
  assertFail(runInteraction(contractBody(), browserBody({ ids: `${idList(9)}${COMMA}E999` })), /必须恰好是/);
  assertFail(runInteraction(contractBody(), browserBody({ ids: idList(8) })), /必须恰好是/);
  assertFail(runInteraction(contractBody(), browserBody({ ids: ["E1", "E1", "E3", "E4", "E5", "E6", "E7", "E8", "E9"].join(COMMA) })), /必须恰好是/);
  assertFail(runInteraction(contractBody(), browserBody(), { planStatus: "浏览器验证已完成" }), /未执行/);
  assert.deepEqual(runInteraction(contractBody(), browserBody({ evidence: evidenceRel }), { files: { [evidenceRel]: linesFor() } }), []);
});

test("SC-10：grandfather 先跳过；授权口令或标记行才进入检查", () => {
  const broken = `见 \`/admin/agents\`。\n\n## 交互合同豁免\n\n- 原因${COLON}随便\n`;
  assert.deepEqual(runInteraction(broken, null, { grandfatherFiles: [REL] }), []);
  assertFail(runInteraction(broken, waiverPlan(), { status: "开发授权已获得", grandfatherFiles: [REL] }), /2 行/);
  assertFail(runInteraction("交互合同适用\n见 `/admin/agents`。\n", null, { grandfatherFiles: [REL] }), /交互合同/);
});

test("SC-15：元素清单的编号、必填元素、重复、禁止记号和清单外结果", () => {
  assertFail(runInteraction(contractBody().replace("## 元素清单\n", "## 清单\n"), browserBody()), /元素清单/);
  assertFail(runInteraction(`${contractBody()}\n## 元素清单\n\n- E1${BAR}/admin/agents${BAR}主动作${BAR}主区${BAR}看得到\n`, browserBody()), /超过一个/);
  assertFail(runInteraction(contractBody().replace(`- E2${BAR}`, `- E3${BAR}`), browserBody()), /连续递增/);
  assertFail(runInteraction(contractBody().replace(`${BAR}决定信息${BAR}`, `${BAR}备注${BAR}`), browserBody()), /缺少：.*决定信息/);
  assertFail(runInteraction(contractBody().replace(`${BAR}空${BAR}`, `${BAR}首访${BAR}`), browserBody()), /元素重复/);
  assertFail(runInteraction(contractBody().replace("看得到", "看得到 class=foo"), browserBody()), /class=/);
  assertFail(runInteraction(contractBody().replace("主区", "主区 DOM"), browserBody()), /DOM/);
  assertFail(runInteraction(contractBody().replace("看得到", "间距 12px"), browserBody()), /像素/);
  assertFail(runInteraction(contractBody({ between: "## 别的标题\n\n说明\n" }), browserBody()), /元素清单/);
  const state = STATE.replace(`首访${COLON}可见0`, `首访${COLON}不适用${COLON}没有首访`);
  const labels = ALL_LABELS.filter((label) => label !== "首访");
  assert.deepEqual(runInteraction(contractBody({ state, labels }), browserBody({ ids: idList(8) })), []);
  assert.deepEqual(runInteraction(contractBody({ state }), browserBody()), []);
  const route = `/admin/agents${COMMA}/catalog`;
  assert.deepEqual(runInteraction(contractBody({ route }), browserBody({ route, ids: idList(18) })), []);
  const evidenceRel = "docs/reviews/interaction-extra.md";
  const extra = ["/admin/agents", VIEW, ...Array.from({ length: 9 }, (_, index) => `E${index + 1}${COLON}通过`), `E99${COLON}失败`].join("\n");
  assertFail(runInteraction(contractBody(), browserBody({ evidence: evidenceRel }), { files: { [evidenceRel]: extra } }), /E99/);
});

test("本门禁 Spec 的豁免在写上开发授权已获得之后仍然通过", () => {
  const specRel = "docs/specs/lucy-20261107-ui-interaction-contract-gate-spec.md";
  const spec = readFileSync(new URL("../docs/specs/lucy-20261107-ui-interaction-contract-gate-spec.md", import.meta.url), "utf8");
  const plan = readFileSync(new URL("../docs/plans/lucy-20261107-ui-interaction-contract-gate-plan.md", import.meta.url), "utf8");
  assert.deepEqual(checkInteractionContract(specRel, spec, plan, { grandfatherFiles: [] }), []);
  const authorized = spec.replace(/^\|\s*状态\s*\|([^|\n]*)\|/m, "| 状态 | 开发授权已获得 |");
  assert.match(authorized, /\| 状态 \| 开发授权已获得 \|/);
  assert.deepEqual(checkInteractionContract(specRel, authorized, plan, { grandfatherFiles: [specRel] }), []);
});

test("SC-11 / SC-12：治理句子写进 DEVELOPMENT.md 和台账 README", () => {
  const dev = readFileSync(new URL("../docs/governance/DEVELOPMENT.md", import.meta.url), "utf8");
  assert.match(dev, /其他说法不取消跳过/);
  assert.match(dev, /这一步不是 lint/);
  assert.match(dev, /六问只适用于触发且没有有效豁免的 Spec/);
  assert.match(dev, /恰好覆盖/);
  assert.match(dev, /不在本轮补清单/);
  const ledger = readFileSync(new URL("../docs/ui-ux-feedback/README.md", import.meta.url), "utf8");
  assert.match(ledger, /没有修复时不得写成 Fixed/);
  assert.match(ledger, /记号不代替复核/);
});

test("SC-14：生产 grandfather 名单内的现行 Spec 不因交互合同失败", () => {
  const listed = new Set(JSON.parse(readFileSync(new URL("../docs/governance/ui-interaction-contract-grandfather.json", import.meta.url), "utf8")).files);
  const hits = scanRepo().violations.filter((item) => item.rule === "interaction-contract" && listed.has(item.file));
  assert.deepEqual(hits, []);
});

function makeDesignSystem(files) {
  const root = mkdtempSync(path.join(tmpdir(), "ds-lint-"));
  const dir = path.join(root, "webui/docs/design-system");
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return root;
}

const DS_CHAPTER_OK = "# 章\n\n| 元数据 | 内容 |\n|---|---|\n| 版本 | v1.0 |\n| 撰写日期 | 2026-11-14 |\n";

test("设计系统：章节齐备且被 README 链接 → 无违规", () => {
  const root = makeDesignSystem({ "README.md": "- `10-a.md`：A\n", "10-a.md": DS_CHAPTER_OK });
  try {
    assert.deepEqual(collectDesignSystemViolations(root, "2026-11-14"), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("设计系统：章节未入 README、缺版本 → ds-index、ds-meta", () => {
  const root = makeDesignSystem({ "README.md": "无\n", "10-a.md": "# 章\n\n无头部\n" });
  try {
    const rules = collectDesignSystemViolations(root, "2026-11-14").map((v) => v.rule);
    assert.ok(rules.includes("ds-index"));
    assert.ok(rules.includes("ds-meta"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("设计系统：临时决策缺期限或已过期 → ds-td-expiry；有效期内通过", () => {
  const gov = (rows) => DS_CHAPTER_OK + "\n### 当前临时决策\n\n| 编号 | 模式 |\n|---|---|\n" + rows + "\n### 已升格临时决策\n\n| TD-OLD | x |\n";
  const run = (rows) => {
    const root = makeDesignSystem({ "README.md": "`99-governance.md`\n", "99-governance.md": gov(rows) });
    try {
      return collectDesignSystemViolations(root, "2026-11-14").filter((v) => v.rule === "ds-td-expiry");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  assert.equal(run("| TD-1 | a | 升级期限：2026-12-31 |").length, 0);
  assert.equal(run("| TD-2 | a | 无期限 |").length, 1);
  assert.equal(run("| TD-3 | a | 升级期限：2026-11-01 |").length, 1);
});

test("Design System Compliance：引用不存在的章节 → ds-ref；引用存在的章节不报", () => {
  const body = (ref) =>
    SPEC_HEADER + SPEC_BODY + "\n## 10. Design System Compliance\n\n### Referenced Specs\n\n- `webui/docs/design-system/" + ref + "`\n\n" +
    "### What This Change Follows\n\n- x\n\n### Exceptions (If Any)\n\n- None\n\n### Follow-up Needed\n\n- None\n";
  assert.ok(rulesOf(collectDocViolations(SPEC, body("99-nope-missing.md"))).includes("ds-ref"));
  assert.ok(!rulesOf(collectDocViolations(SPEC, body("10-components-button.md"))).includes("ds-ref"));
});

const VOCAB_SPEC = "docs/specs/lucy-20261122-status-vocab-fixture-spec.md";

function vocabDoc(statusRow, { header = "状态", body = "" } = {}) {
  return [
    "# 夹具",
    "",
    "| 元数据 | 内容 |",
    "|---|---|",
    `| ${header} | ${statusRow} |`,
    "",
    body
  ].join("\n");
}

test("status-vocab：英文整词命中／中文与未授权句放行／缺状态行不报（建议书 §6.2 第 2 条）", () => {
  assert.equal(collectStatusVocabViolations(VOCAB_SPEC, vocabDoc("Implemented")).length, 1);
  assert.equal(collectStatusVocabViolations(VOCAB_SPEC, vocabDoc("草案")).length, 0);
  assert.equal(collectStatusVocabViolations(VOCAB_SPEC, vocabDoc("终稿已确权，未获开发授权")).length, 0);
  assert.equal(collectStatusVocabViolations(VOCAB_SPEC, vocabDoc("当前草稿 `r6` 不是放行包")).length, 0);
  // 缺状态行 → 本规则绝不报（归 metadata）
  assert.equal(collectStatusVocabViolations(VOCAB_SPEC, "# 裸文档\n\n无元数据表\n").length, 0);
  // 扫描面＝头部元数据表；正文引用英文词不受本条约束
  assert.equal(
    collectStatusVocabViolations(VOCAB_SPEC, vocabDoc("草案", { body: "正文提到 Implemented 与 Draft 不算违规。\n" })).length,
    0
  );
});

test("status-vocab：版本段排除／词边界／大小写敏感（建议书 §3.4／B1）", () => {
  assert.equal(collectStatusVocabViolations(VOCAB_SPEC, vocabDoc("v0.1-draft；草案")).length, 0);
  assert.equal(collectStatusVocabViolations(VOCAB_SPEC, vocabDoc("v0.2-draft；终稿已确权")).length, 0);
  assert.equal(collectStatusVocabViolations(VOCAB_SPEC, vocabDoc("当前 Draft `r6` 不是放行包")).length, 1);
  assert.equal(collectStatusVocabViolations(VOCAB_SPEC, vocabDoc("当前 draft 包")).length, 0);
  assert.equal(collectStatusVocabViolations(VOCAB_SPEC, vocabDoc("Drafts 不是独立词")).length, 0);
  assert.equal(collectStatusVocabViolations(VOCAB_SPEC, vocabDoc("Approved for planning")).length, 1);
  assert.equal(collectStatusVocabViolations(VOCAB_SPEC, vocabDoc("Superseded by X")).length, 1);
  assert.equal(collectStatusVocabViolations(VOCAB_SPEC, vocabDoc("Ready for Review")).length, 1);
});

test("status-vocab：表头 Status 独立扫描，不经 statusCell（建议书 §3.4／B2）", () => {
  const headerOnly = collectStatusVocabViolations(VOCAB_SPEC, vocabDoc("草案", { header: "Status" }));
  assert.equal(headerOnly.length, 1);
  assert.match(headerOnly[0].message, /Status/);
  const both = collectStatusVocabViolations(VOCAB_SPEC, vocabDoc("Implemented", { header: "Status" }));
  assert.equal(both.length, 2);
});

const FUNNEL_REL = "docs/specs/lucy-20261122-status-funnel-fixture-spec.md";

function funnelDoc({ stage, status, layer = "功能合同", scope = undefined, marker = false }) {
  const rows = ["| 元数据 | 内容 |", "|---|---|"];
  if (stage !== undefined) rows.push(`| 阶段 | ${stage} |`);
  rows.push(`| 状态 | ${status} |`);
  if (scope !== undefined) rows.push(`| 收口范围 | ${scope} |`);
  const parts = ["# 夹具", "", ...rows, ""];
  if (layer) {
    const ship = layer === "发布取证" ? "本条通过不表示各模块无问题" : "本条收口不表示可上线";
    parts.push("## 闭口层级", "", `- 层级：${layer}`, "- 本条承诺：x", "- 本条出口：x", "- 不在本条出口：x", `- 上线关系：${ship}`, "");
  }
  if (marker) parts.push("状态漏斗门禁：纳入检查", "");
  return parts.join("\n");
}

function runFunnel({ stage, status, layer, scope, marker = false, planStatus = null, grandfather = false }) {
  const text = funnelDoc({ stage, status, layer, scope, marker });
  const planText = planStatus == null ? null : `| 元数据 | 内容 |\n|---|---|\n| 状态 | ${planStatus} |\n`;
  return checkStatusFunnel(FUNNEL_REL, text, planText, {
    grandfatherFiles: grandfather ? [FUNNEL_REL] : []
  });
}

function funnelFail(result, fragment) {
  assert.ok(result.length > 0, "应当失败");
  assert.match(result[0].message, fragment);
}

test("SC-01／SC-02：非 grandfather 缺阶段行失败；非法 CODE 失败；去 * 后整格匹配", () => {
  funnelFail(runFunnel({ stage: undefined, status: "草案" }), /恰好一行「阶段」/);
  funnelFail(runFunnel({ stage: "S6", status: "草案" }), /不是合法阶段码/);
  funnelFail(runFunnel({ stage: "S3｜可上线", status: "草案" }), /不是合法阶段码/);
  funnelFail(runFunnel({ stage: "s3", status: "草案" }), /不是合法阶段码/);
  assert.deepEqual(runFunnel({ stage: "*S3*", status: "草案" }), []);
  assert.deepEqual(runFunnel({ stage: " S3 ", status: "开发授权已获得；实现进行中" }), []);
});

test("SC-03：S5 命中未收口短语表失败（含 ≠功能已收口），无短语通过", () => {
  funnelFail(runFunnel({ stage: "S5", status: "≠功能已收口" }), /未收口短语「≠功能已收口」/);
  funnelFail(runFunnel({ stage: "S5", status: "≠ 功能合同收口" }), /未收口短语/);
  funnelFail(runFunnel({ stage: "S5", status: "功能合同尚未收口" }), /未收口短语/);
  funnelFail(runFunnel({ stage: "S5", status: "实现进行中" }), /未收口短语「实现进行中」/);
  assert.deepEqual(runFunnel({ stage: "S5", status: "功能合同已收口" }), []);
});

test("SC-04：S1／S2 含授权口令失败；S3 含口令通过", () => {
  funnelFail(runFunnel({ stage: "S1", status: "开发授权已获得；实现中" }), /不得含「开发授权已获得」/);
  funnelFail(runFunnel({ stage: "S2", status: "开发授权已获得；实现中" }), /不得含「开发授权已获得」/);
  assert.deepEqual(runFunnel({ stage: "S3", status: "开发授权已获得；实现进行中" }), []);
});

test("SC-05：状态行 ≠ 可上线 通过；阶段:后把可上线／UAT 当作阶段码失败；≠-前缀放行", () => {
  assert.deepEqual(runFunnel({ stage: "S3", status: "S3｜v1.0。仍 ≠ 可上线；≠ UAT PASS" }), []);
  assert.deepEqual(runFunnel({ stage: "S3", status: "S3｜v1.0。阶段：≠ 可上线" }), []);
  assert.deepEqual(runFunnel({ stage: "S3", status: "S3｜v1.0。阶段：≠ UAT PASS" }), []);
  funnelFail(runFunnel({ stage: "S3", status: "阶段：可上线" }), /当作阶段码/);
  funnelFail(runFunnel({ stage: "S3", status: "阶段： UAT PASS" }), /当作阶段码/);
  funnelFail(runFunnel({ stage: "S3", status: "阶段：测试台PASS" }), /当作阶段码/);
  assert.deepEqual(runFunnel({ stage: "S3", status: "阶段：S3｜v1.0。仍 ≠ 可上线" }), []);
});

test("SC-06：发布取证必须 X_REL；X_REL 放行", () => {
  funnelFail(runFunnel({ stage: "S5", status: "功能合同已收口", layer: "发布取证" }), /X_REL/);
  assert.deepEqual(runFunnel({ stage: "X_REL", status: "发布取证收口", layer: "发布取证" }), []);
});

test("SC-07／SC-08：收口范围仅 S5；S5 合法收口范围通过", () => {
  assert.deepEqual(runFunnel({ stage: "S5", status: "功能合同已收口", scope: "示例范围" }), []);
  funnelFail(runFunnel({ stage: "S4", status: "实现已落地", scope: "示例范围" }), /收口范围/);
  funnelFail(runFunnel({ stage: "S5", status: "功能合同已收口", scope: "" }), /收口范围/);
});

test("SC-09／SC-10／SC-11：grandfather 跳过；口令或标记行取消跳过", () => {
  assert.deepEqual(runFunnel({ stage: undefined, status: "草案", grandfather: true }), []);
  funnelFail(runFunnel({ stage: undefined, status: "开发授权已获得；实现中", grandfather: true }), /恰好一行「阶段」/);
  funnelFail(runFunnel({ stage: undefined, status: "草案", marker: true, grandfather: true }), /恰好一行「阶段」/);
});

test("SC-12：Plan 镜像前缀与 Spec 阶段码一致", () => {
  assert.deepEqual(runFunnel({ stage: "S3", status: "开发授权已获得；实现进行中", planStatus: "阶段:S3｜v1.0。实现进行中" }), []);
  assert.deepEqual(runFunnel({ stage: "S3", status: "开发授权已获得；实现进行中", planStatus: "S3｜v1.0" }), []);
  assert.deepEqual(runFunnel({ stage: "S3", status: "开发授权已获得；实现进行中", planStatus: "S3。v1.0" }), []);
  assert.deepEqual(runFunnel({ stage: "S3", status: "开发授权已获得；实现进行中", planStatus: "*S3｜v1.0*" }), []);
  funnelFail(runFunnel({ stage: "S3", status: "开发授权已获得；实现进行中", planStatus: "**S3**｜v1.0" }), /未镜像/);
  funnelFail(runFunnel({ stage: "S3", status: "开发授权已获得；实现进行中", planStatus: "阶段:S4｜v1.0" }), /未镜像/);
  funnelFail(runFunnel({ stage: "S4", status: "实现已落地", planStatus: "S3｜v1.0" }), /未镜像/);
});

test("SC-09／SC-10 生产名单：grandfather 内无口令无标记不被误伤；失败只限授权缺阶段类", () => {
  const listed = new Set(
    JSON.parse(readFileSync(new URL("../docs/governance/spec-status-funnel-grandfather.json", import.meta.url), "utf8")).files
  );
  const hits = scanRepo().blocking.filter((v) => v.rule === "status-funnel");
  // 双向：名单内「状态行含口令 OR 标记行」且头部无「| 阶段 |」的文件集合（预期失败集）须与实际失败集一致。
  // 预期集为空 → 实际须 0 失败（无口令无标记不被误伤）；预期集非空 → 实际须全部判失败（SC-10 类）。
  const head60 = (text) => text.split("\n").slice(0, 60).join("\n");
  const expectedFail = [...listed].filter((file) => {
    const text = readFileSync(new URL("../" + file, import.meta.url), "utf8");
    const status = head60(text).match(/^\|\s*\*{0,2}状态\*{0,2}\s*\|([^|\n]*)/m)?.[1] ?? "";
    const marked = text
      .replace(/```[\s\S]*?```/g, "")
      .split("\n")
      .some((line) => line.trim() === "状态漏斗门禁：纳入检查");
    const hasPhase = /^\|\s*\*{0,2}阶段\*{0,2}\s*\|/m.test(head60(text));
    return (status.includes("开发授权已获得") || marked) && !hasPhase;
  });
  assert.deepEqual(
    hits.filter((h) => listed.has(h.file)).map((h) => h.file).sort(),
    expectedFail.sort(),
    "grandfather 名单内实际 status-funnel 失败集应等于「授权口令或标记行且缺阶段」预期集"
  );
  for (const h of hits) {
    assert.ok(listed.has(h.file), `${h.file} 不在 grandfather 名单却被判失败`);
    const text = readFileSync(new URL("../" + h.file, import.meta.url), "utf8");
    assert.ok(text.includes("开发授权已获得"), `${h.file} 失败须因状态含授权口令（SC-10 类）`);
  }
});
