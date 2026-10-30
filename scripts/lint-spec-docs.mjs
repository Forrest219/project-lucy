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
 *   filename    新 Spec / Plan 使用唯一文件名；模块 docs 数字流水号 Spec 已封板
 *   close-layer 新功能 Spec 必须有「闭口层级」，且层级只能是功能合同或发布取证
 *
 * 存量违规冻结在 docs/governance/spec-plan-doc-baseline.json：**基线只减不增**。
 * 新增违规 → exit 1；基线里已不再违规的条目 → 报 stale（提示可从基线移除），不阻塞。
 *
 * 判定范围按 **git 跟踪状态** 分流（共享工作区纪律）：
 *   - **已跟踪文件**（已提交或已 git add）的基线外违规 ⇒ **阻塞**（exit 1）；
 *   - **未跟踪文件**（尚未 git add 的在途草稿）的基线外违规 ⇒ **只报 WARN，不阻塞**。
 * 理由：共享工作区里，一个会话的在途草稿不该把另一个会话的门禁打成红；但该文件一旦被
 * git add 或提交，同一条违规**立即转为阻塞项**——CI 侧工作树干净、文件均已跟踪，
 * 判定口径与本地一致，规则一点不松。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const SPEC_DIR = "docs/specs";
const PLAN_DIR = "docs/plans";
const SPEC_INDEX = "docs/README.md";
const PLAN_INDEX = "docs/plans/README.md";
const BASELINE_FILE = "docs/governance/spec-plan-doc-baseline.json";

const SPEC_FILENAME = /^lucy-(\d{8})-([a-z0-9]+(?:-[a-z0-9]+)*)-spec\.md$/;
const PLAN_FILENAME = /^(\d{4}-\d{2}-\d{2})-lucy-([a-z0-9]+(?:-[a-z0-9]+)*)-plan\.md$/;
const NUMBERED_SPEC_BASENAME = /^\d+-.+-spec\.md$/;
const MODULE_DOCS_SKIP = new Set(["docs", "inbox", "node_modules"]);
/** 只拒绝 v0p25、v2p5 这种产品版本段。v8 这类技术专名不在此列。 */
const VERSION_SEGMENT = /^v\d+p\d+$/i;
const CLOSE_LAYER_FIELDS = ["不在本条出口", "本条承诺", "本条出口", "上线关系", "层级"];

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

/** 递归列出某个模块 docs 目录下的数字流水号 Spec。relDir 使用 posix 分隔。 */
export function listNumberedSpecsUnder(absDir, relDir) {
  const found = [];
  function walk(abs, rel) {
    for (const name of readdirSync(abs)) {
      if (name === "node_modules") continue;
      const absChild = path.join(abs, name);
      const relChild = `${rel}/${name}`;
      if (statSync(absChild).isDirectory()) {
        walk(absChild, relChild);
      } else if (NUMBERED_SPEC_BASENAME.test(name)) {
        found.push(relChild);
      }
    }
  }
  if (existsSync(absDir) && statSync(absDir).isDirectory()) walk(absDir, relDir);
  return found.sort();
}

function listNumberedModuleSpecs() {
  const found = [];
  for (const name of readdirSync(repoRoot)) {
    if (MODULE_DOCS_SKIP.has(name) || name.startsWith(".")) continue;
    const abs = path.join(repoRoot, name, "docs");
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
    found.push(...listNumberedSpecsUnder(abs, `${name}/docs`));
  }
  return found.sort();
}

function isNumberedModuleSpec(relPath) {
  const normalized = relPath.split(path.sep).join("/");
  if (normalized.startsWith("docs/")) return false;
  const base = path.posix.basename(normalized);
  if (!NUMBERED_SPEC_BASENAME.test(base)) return false;
  return /(?:^|\/)[^/]+\/docs\/(?:[^/]+\/)*\d+-.+-spec\.md$/.test(normalized);
}

function isYyyymmdd(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  return year >= 2020 && year <= 2099 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function isIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  return isYyyymmdd(`${match[1]}${match[2]}${match[3]}`);
}

function versionSegment(slug) {
  return slug.split("-").find((part) => VERSION_SEGMENT.test(part)) ?? null;
}

/** 文件名身份。规范见 DEVELOPMENT.md「功能闭口与发布取证」。 */
export function collectFilenameViolation(relPath) {
  const base = path.posix.basename(relPath);
  if (relPath.startsWith(`${SPEC_DIR}/`)) {
    const match = SPEC_FILENAME.exec(base);
    if (!match || !isYyyymmdd(match[1])) {
      return {
        file: relPath,
        rule: "filename",
        message: "Spec 文件名必须是 lucy-YYYYMMDD-<slug>-spec.md；slug 只用小写字母、数字和连字符，版本写在头部"
      };
    }
    const version = versionSegment(match[2]);
    if (version) {
      return {
        file: relPath,
        rule: "filename",
        message: `Spec 文件名不得包含版本段「${version}」；版本写在头部`
      };
    }
    return null;
  }
  if (relPath.startsWith(`${PLAN_DIR}/`)) {
    const match = PLAN_FILENAME.exec(base);
    if (!match || !isIsoDate(match[1])) {
      return {
        file: relPath,
        rule: "filename",
        message: "Plan 文件名必须是 YYYY-MM-DD-lucy-<slug>-plan.md；slug 只用小写字母、数字和连字符，版本写在头部"
      };
    }
    const version = versionSegment(match[2]);
    if (version) {
      return {
        file: relPath,
        rule: "filename",
        message: `Plan 文件名不得包含版本段「${version}」；版本写在头部`
      };
    }
    return null;
  }
  if (isNumberedModuleSpec(relPath)) {
    return {
      file: relPath,
      rule: "filename",
      message: "模块 docs 的数字流水号 Spec 已封板（含子目录、一位及以上数字）；新产品 Spec 只写 docs/specs/lucy-YYYYMMDD-<slug>-spec.md"
    };
  }
  return null;
}

function sectionBody(text, titlePattern) {
  const lines = text.split("\n");
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{2,4})\s+(.+)$/.exec(lines[i]);
    if (!match) continue;
    const title = match[2].trim();
    if (start === -1 && titlePattern.test(title)) {
      start = i + 1;
      level = match[1].length;
      continue;
    }
    if (start !== -1 && match[1].length <= level) return lines.slice(start, i).join("\n");
  }
  return start === -1 ? null : lines.slice(start).join("\n");
}

function parseCloseLayerField(line) {
  const trimmed = line.trim().replace(/^[-*]\s+/, "");
  for (const name of CLOSE_LAYER_FIELDS) {
    const match = new RegExp(`^${name}\\s*[:：]\\s*(.*)$`).exec(trimmed);
    if (!match) continue;
    return { name, value: match[1].trim() };
  }
  return null;
}

function collectCloseLayerViolations(relPath, text) {
  const body = sectionBody(text, /闭口层级$/);
  if (body === null) {
    return [{ file: relPath, rule: "close-layer", message: "Spec 缺少「闭口层级」小节" }];
  }
  const fields = new Map();
  for (const line of body.split("\n")) {
    const parsed = parseCloseLayerField(line);
    if (!parsed) continue;
    if (!fields.has(parsed.name)) fields.set(parsed.name, []);
    fields.get(parsed.name).push(parsed.value);
  }
  const violations = [];
  const missing = [];
  for (const name of ["层级", "本条承诺", "本条出口", "不在本条出口", "上线关系"]) {
    const values = fields.get(name) ?? [];
    if (values.length !== 1 || values[0] === "") missing.push(name);
  }
  if (missing.length) {
    violations.push({
      file: relPath,
      rule: "close-layer",
      message: `「闭口层级」缺少或为空：${missing.join("、")}`
    });
  }
  const layerValues = (fields.get("层级") ?? []).filter((value) => value !== "");
  const uniqueLayer = [...new Set(layerValues)];
  const layerOk = uniqueLayer.length === 1 && (uniqueLayer[0] === "功能合同" || uniqueLayer[0] === "发布取证");
  if (layerValues.length > 0 && !layerOk) {
    violations.push({
      file: relPath,
      rule: "close-layer",
      message: "「闭口层级」的层级只能是「功能合同」或「发布取证」之一"
    });
  }
  const ship = (fields.get("上线关系") ?? []).find((value) => value !== "") ?? "";
  if (uniqueLayer.length === 1 && uniqueLayer[0] === "功能合同" && ship && !ship.includes("本条收口不表示可上线")) {
    violations.push({
      file: relPath,
      rule: "close-layer",
      message: "功能合同的上线关系必须写「本条收口不表示可上线」"
    });
  }
  if (uniqueLayer.length === 1 && uniqueLayer[0] === "发布取证" && ship && !ship.includes("本条通过不表示各模块无问题")) {
    violations.push({
      file: relPath,
      rule: "close-layer",
      message: "发布取证的上线关系必须写「本条通过不表示各模块无问题」"
    });
  }
  return violations;
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
  const filenameViolation = collectFilenameViolation(relPath);
  if (filenameViolation) violations.push(filenameViolation);

  if (isSpec) {
    violations.push(...collectCloseLayerViolations(relPath, text));
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

/**
 * 取 git 已跟踪文件集合（含**已暂存**的新增文件）。
 * 返回 null = 无法判定（例如不在 git 仓库内 / git 不可用）→ 调用方按「已跟踪」保守处理。
 */
export function loadTrackedFiles() {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    return new Set(out.split("\0").filter(Boolean));
  } catch {
    return null;
  }
}

/**
 * 把违规按基线分类：
 *   - 基线内 → 不报；
 *   - 基线外且**已跟踪** → blocking（exit 1）；
 *   - 基线外且**未跟踪** → warnings（只提醒，不阻塞共享工作区）；
 *   - 基线里已不再违规的条目 → stale。
 *
 * trackedFiles 传 null 时一律按「已跟踪」处理（保守：宁可阻塞，不可漏报）。
 */
export function classifyViolations(violations, baselineEntries, trackedFiles = null) {
  const baselineKeys = new Set(baselineEntries.map((e) => `${e.file}::${e.rule}`));
  const currentKeys = new Set(violations.map((v) => `${v.file}::${v.rule}`));
  const blocking = [];
  const warnings = [];
  for (const v of violations) {
    if (baselineKeys.has(`${v.file}::${v.rule}`)) continue;
    const tracked = trackedFiles === null ? true : trackedFiles.has(v.file);
    if (tracked) blocking.push(v);
    else warnings.push(v);
  }
  return {
    blocking,
    warnings,
    stale: baselineEntries.filter((e) => !currentKeys.has(`${e.file}::${e.rule}`))
  };
}

/** 全量扫描：返回 { violations, blocking, stale, baseline, scanned }。 */
export function scanRepo() {
  const specFiles = listMarkdown(SPEC_DIR);
  const planFiles = listMarkdown(PLAN_DIR);
  const webuiNumbered = listNumberedModuleSpecs();
  const specIndex = linkedBasenames(SPEC_INDEX);
  const planIndex = linkedBasenames(PLAN_INDEX);

  const violations = [];
  for (const relPath of webuiNumbered) {
    const filenameViolation = collectFilenameViolation(relPath);
    if (filenameViolation) violations.push(filenameViolation);
  }
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
  const trackedFiles = loadTrackedFiles();
  const { blocking, warnings, stale } = classifyViolations(violations, baseline.entries, trackedFiles);

  return {
    violations,
    blocking,
    warnings,
    stale,
    baseline,
    trackedFiles,
    scanned: specFiles.length + planFiles.length + webuiNumbered.length
  };
}

export function formatReport(result) {
  const lines = [];
  const warnings = result.warnings ?? [];
  if (result.blocking.length) {
    lines.push("Spec/Plan doc lint FAILED — 以下为新增形态违规（基线外）：");
    for (const v of result.blocking) lines.push(`  ${v.file} [${v.rule}] ${v.message}`);
    lines.push("");
    lines.push("修法：见 docs/governance/DEVELOPMENT.md「新增 Spec / Plan 的落盘清单」。");
    lines.push("若确认某项为存量豁免而非遗漏，请把它写进 docs/governance/spec-plan-doc-baseline.json 并说明理由 —— 基线只减不增。");
  } else {
    const warnNote = warnings.length ? `, ${warnings.length} warnings on untracked files` : "";
    lines.push(`Spec/Plan doc lint passed (${result.scanned} files scanned, ${result.baseline.entries.length} baseline exemptions${warnNote}).`);
  }
  if (warnings.length) {
    lines.push("");
    lines.push("WARN — 以下文件尚未被 git 跟踪（未 git add），形态违规不阻塞本工作树；一旦 git add 或提交即转为阻塞项：");
    for (const v of warnings) lines.push(`  ${v.file} [${v.rule}] ${v.message}`);
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
