#!/usr/bin/env node
/**
 * Spec / Plan 文档形态门禁（docs/governance/DEVELOPMENT.md「新增 Spec / Plan 的落盘清单」）。
 *
 * 背景：机器门禁（lint:spec / lint:terminology / lint:ia-boundary）只覆盖机器可判定项
 * （路由 / API / 术语 / 元数据），**不覆盖文档形态**。本脚本补上形态这一层。
 *
 * 规则清单：
 *   index       Spec/Plan 必须被对应索引 README 链接
 *   ds-shape    含「Design System Compliance」小节 ⇒ 必须用规定模板的四段式
 *   term-shape  含「Terminology Compliance」小节 ⇒ 必须含 This feature follows + New terms:
 *   pseudocode  Spec 必须有「核心流程（伪代码）」/「Core Algorithm」，或显式写明伪代码豁免
 *   plan-parts  Plan 必须有 目标 / 开工前置 / 验收 / 完成定义 / 风险 五类小节
 *   metadata    Spec 须有 文档类型·版本·状态；Plan 须有 状态·授权边界·验收
 *
 * 存量违规冻结在 docs/governance/spec-plan-doc-baseline.json：**基线只减不增**。
 * 新增违规 → exit 1；基线里已不再违规的条目 → 报 stale（提示可从基线移除），不阻塞。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const SPEC_DIR = "docs/specs";
const PLAN_DIR = "docs/plans";
const SPEC_INDEX = "docs/README.md";
const PLAN_INDEX = "docs/plans/README.md";
const BASELINE_FILE = "docs/governance/spec-plan-doc-baseline.json";

const DS_TEMPLATE_PARTS = [
  { re: /Referenced\s+Specs/i, label: "Referenced Specs" },
  { re: /What\s+This\s+Change\s+Follows/i, label: "What This Change Follows" },
  { re: /Exceptions/i, label: "Exceptions" },
  { re: /Follow-up\s+Needed/i, label: "Follow-up Needed" }
];

/**
 * Plan 必备小节。**按语义匹配，不规定确切措辞**——存量 Plan 的标题写法差异很大
 * （「实施步骤」「回滚方案」「交付判定」…），只要覆盖到该语义即算满足。
 */
const PLAN_REQUIRED_PARTS = [
  { re: /目标|目的|概览|概述/, label: "目标" },
  { re: /开工前置|前置条件|前置|开工裁决/, label: "开工前置" },
  { re: /验收|Acceptance|SC-\d/i, label: "验收" },
  { re: /完成定义|交付判定|完成标准|Definition of Done/i, label: "完成定义" },
  { re: /风险|回滚|Risk/i, label: "风险" }
];

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

function listMarkdown(dirRel) {
  const abs = path.join(repoRoot, dirRel);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort()
    .map((name) => path.posix.join(dirRel, name));
}

function headings(text) {
  return [...text.matchAll(/^(#{2,4})\s+(.+)$/gm)].map((m) => ({
    level: m[1].length,
    title: m[2].trim()
  }));
}

function linkedBasenames(indexRel) {
  const abs = path.join(repoRoot, indexRel);
  if (!existsSync(abs)) return new Set();
  const text = readFileSync(abs, "utf8");
  return new Set(
    [...text.matchAll(/\]\(([^)#]+\.md)\)/g)].map((m) => path.basename(m[1]))
  );
}

/** 文档头部元数据表（前 60 行）里是否出现某个字段名。 */
function headerHas(text, field) {
  const head = text.split("\n").slice(0, 60).join("\n");
  return new RegExp(`\\|\\s*\\*{0,2}[^|]*${field}`).test(head);
}

/** 收集单个文档的形态违规。 */
export function collectDocViolations(relPath, text) {
  const violations = [];
  const isSpec = relPath.startsWith(`${SPEC_DIR}/`);
  const hs = headings(text);

  if (isSpec) {
    const hasPseudo = hs.some((h) => /核心流程（伪代码）/.test(h.title) || /Core Algorithm/i.test(h.title));
    const hasExemption = /伪代码(豁免|不适用|不触发)/.test(text);
    if (!hasPseudo && !hasExemption) {
      violations.push({ file: relPath, rule: "pseudocode", message: "Spec 缺少「核心流程（伪代码）」/「Core Algorithm」小节，也没有写明伪代码豁免" });
    }
    if (!headerHas(text, "文档类型|版本") || !headerHas(text, "状态")) {
      violations.push({ file: relPath, rule: "metadata", message: "Spec 头部元数据缺少「文档类型 / 版本」或「状态」" });
    }
  } else {
    const titles = hs.map((h) => h.title).join("\n");
    for (const part of PLAN_REQUIRED_PARTS) {
      if (!part.re.test(titles)) {
        violations.push({ file: relPath, rule: "plan-parts", message: `Plan 缺少「${part.label}」类小节` });
      }
    }
    if (!headerHas(text, "状态") || !headerHas(text, "授权边界") || !headerHas(text, "验收")) {
      violations.push({ file: relPath, rule: "metadata", message: "Plan 头部元数据缺少「状态」「授权边界」或「验收」" });
    }
  }

  const dsHeading = hs.find((h) => /Design System Compliance/i.test(h.title));
  if (dsHeading) {
    const dsIndex = hs.indexOf(dsHeading);
    const sub = hs.slice(dsIndex + 1).filter((h) => h.level > dsHeading.level);
    const subTitles = sub.map((h) => h.title).join("\n");
    for (const part of DS_TEMPLATE_PARTS) {
      if (!part.re.test(subTitles)) {
        violations.push({ file: relPath, rule: "ds-shape", message: `Design System Compliance 缺少规定模板子段「${part.label}」` });
      }
    }
  }

  if (hs.some((h) => /Terminology Compliance/i.test(h.title))) {
    if (!/This feature follows/.test(text)) {
      violations.push({ file: relPath, rule: "term-shape", message: "Terminology Compliance 缺少 This feature follows 句式" });
    }
    if (!/New terms:/.test(text)) {
      violations.push({ file: relPath, rule: "term-shape", message: "Terminology Compliance 缺少 New terms: 字段" });
    }
  }

  return violations;
}

export function loadBaseline() {
  if (!existsSync(path.join(repoRoot, BASELINE_FILE))) return { entries: [] };
  try {
    const parsed = JSON.parse(read(BASELINE_FILE));
    const entries = Array.isArray(parsed) ? parsed : parsed.entries ?? [];
    return { entries, raw: parsed };
  } catch {
    return { entries: [] };
  }
}

/** 把违规按基线分类：不在基线内的为新增违规（阻塞）；基线里已不再违规的为 stale。 */
export function classifyViolations(violations, baselineEntries) {
  const baselineKeys = new Set(baselineEntries.map((e) => `${e.file}::${e.rule}`));
  const currentKeys = new Set(violations.map((v) => `${v.file}::${v.rule}`));
  return {
    blocking: violations.filter((v) => !baselineKeys.has(`${v.file}::${v.rule}`)),
    stale: baselineEntries.filter((e) => !currentKeys.has(`${e.file}::${e.rule}`))
  };
}

/** 全量扫描：返回 { violations, blocking, stale, baseline, scanned }。 */
export function scanRepo() {
  const specFiles = listMarkdown(SPEC_DIR);
  const planFiles = listMarkdown(PLAN_DIR);
  const specIndex = linkedBasenames(SPEC_INDEX);
  const planIndex = linkedBasenames(PLAN_INDEX);

  const violations = [];
  for (const relPath of [...specFiles, ...planFiles]) {
    const text = read(relPath);
    const isSpec = relPath.startsWith(`${SPEC_DIR}/`);
    const indexSet = isSpec ? specIndex : planIndex;
    if (!indexSet.has(path.basename(relPath))) {
      violations.push({
        file: relPath,
        rule: "index",
        message: `${isSpec ? "Spec" : "Plan"} 未被 ${isSpec ? SPEC_INDEX : PLAN_INDEX} 索引登记`
      });
    }
    violations.push(...collectDocViolations(relPath, text));
  }

  const baseline = loadBaseline();
  const { blocking, stale } = classifyViolations(violations, baseline.entries);

  return { violations, blocking, stale, baseline, scanned: specFiles.length + planFiles.length };
}

export function formatReport(result) {
  const lines = [];
  if (result.blocking.length) {
    lines.push("Spec/Plan doc lint FAILED — 以下为新增形态违规（基线外）：");
    for (const v of result.blocking) lines.push(`  ${v.file} [${v.rule}] ${v.message}`);
    lines.push("");
    lines.push("修法：见 docs/governance/DEVELOPMENT.md「新增 Spec / Plan 的落盘清单」。");
    lines.push("若确认某项为存量豁免而非遗漏，请把它写进 docs/governance/spec-plan-doc-baseline.json 并说明理由 —— 基线只减不增。");
  } else {
    lines.push(`Spec/Plan doc lint passed (${result.scanned} files scanned, ${result.baseline.entries.length} baseline exemptions).`);
  }
  if (result.stale.length) {
    lines.push("");
    lines.push(`STALE baseline entries (${result.stale.length}) —— 这些条目已不再违规，可从基线移除：`);
    for (const e of result.stale) lines.push(`  ${e.file} [${e.rule}]`);
  }
  return lines.join("\n");
}

function main() {
  const result = scanRepo();
  console.log(formatReport(result));
  process.exit(result.blocking.length ? 1 : 0);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
