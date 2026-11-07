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
 *   stale-status 「未执行且不排期」「不可交付 UAT」不得裸写；作废标记必须紧贴该句，且不走基线豁免
 *   interaction-contract 触发的 Spec 须有可解析的交互合同与元素清单，或一份有效豁免。文法见
 *     docs/specs/lucy-20261107-ui-interaction-contract-gate-spec.md。grandfather 名单内的文件，
 *     在没有标记行、且状态行不含「开发授权已获得」时直接通过
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
const GRANDFATHER_FILE = "docs/governance/ui-interaction-contract-grandfather.json";

const SPEC_FILENAME = /^lucy-(\d{8})-([a-z0-9]+(?:-[a-z0-9]+)*)-spec\.md$/;
const PLAN_FILENAME = /^lucy-(\d{8})-([a-z0-9]+(?:-[a-z0-9]+)*)-plan\.md$/;
const NUMBERED_SPEC_BASENAME = /^\d+-.+-spec\.md$/;
const MODULE_DOCS_SKIP = new Set(["docs", "inbox", "node_modules"]);
/** 只拒绝 v0p25、v2p5 这种产品版本段。v8 这类技术专名不在此列。 */
const VERSION_SEGMENT = /^v\d+p\d+$/i;
const CLOSE_LAYER_FIELDS = ["不在本条出口", "本条承诺", "本条出口", "上线关系", "层级"];
const STALE_STATUS_PHRASE = /未执行且不排期|未执行且未排期|不可交付 UAT/g;
const STALE_STATUS_EXTRA = [
  "docs/README.md",
  "docs/plans/README.md",
  "docs/governance/project-overview.md"
];
const STALE_STATUS_PREFIX = /(?:不再写|不构成功能阻断|已作废的?)[「"\s]*$/;
const STALE_STATUS_SUFFIX = /^(?:[」"'*\s。，、；：|（）()]|和|或|并|推出|的现在时|已就地标|已于同日|该句|该记法|这两句|这句|「[^」]{0,24}」)*(?:(?<!未)已?作废|不再写|不得当作现值|不构成功能阻断)/;

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
    if (!match || !isYyyymmdd(match[1])) {
      return {
        file: relPath,
        rule: "filename",
        message: "Plan 文件名必须是 lucy-YYYYMMDD-<slug>-plan.md，且与对应 Spec 的 lucy-YYYYMMDD-<slug> 相同"
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

function phraseIsVoided(line, index, length) {
  const before = line.slice(Math.max(0, index - 24), index);
  if (STALE_STATUS_PREFIX.test(before)) return true;
  const after = line.slice(index + length, index + length + 80);
  return STALE_STATUS_SUFFIX.test(after);
}

export function collectStaleStatusViolations(relPath, text) {
  const violations = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    STALE_STATUS_PHRASE.lastIndex = 0;
    let bare = false;
    for (const match of lines[i].matchAll(STALE_STATUS_PHRASE)) {
      if (phraseIsVoided(lines[i], match.index, match[0].length)) continue;
      bare = true;
      break;
    }
    if (!bare) continue;
    violations.push({
      file: relPath,
      rule: "stale-status",
      message: `第 ${i + 1} 行把已作废的状态写成现值。作废标记必须紧贴「未执行且不排期」或「不可交付 UAT」：紧前写不再写、不构成功能阻断，或紧后写已作废、不再写、不得当作现值、不构成功能阻断。「未作废」和同一行里另一件事的「作废」不算。现行状态只读 Spec 头部。`
    });
  }
  return violations;
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

  violations.push(...collectStaleStatusViolations(relPath, text));

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
 *   - 基线内 → 不报（`stale-status` 除外，这条永不豁免）；
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
    if (v.rule !== "stale-status" && baselineKeys.has(`${v.file}::${v.rule}`)) continue;
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
  const grandfatherFiles = loadGrandfatherFiles();
  const registeredRoutes = loadRegisteredRoutes();
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
    if (isSpec) {
      const planRel = path.posix.join(PLAN_DIR, path.posix.basename(relPath).replace(/-spec\.md$/, "-plan.md"));
      const planText = existsSync(path.join(repoRoot, planRel)) ? read(planRel) : null;
      violations.push(...checkInteractionContract(relPath, text, planText, { grandfatherFiles, registeredRoutes }));
    }
  }
  for (const relPath of STALE_STATUS_EXTRA) {
    if (!existsSync(path.join(repoRoot, relPath))) continue;
    violations.push(...collectStaleStatusViolations(relPath, read(relPath)));
  }
  const reviewsDir = path.join(repoRoot, "docs/reviews");
  if (existsSync(reviewsDir)) {
    for (const name of readdirSync(reviewsDir).filter((item) => item.endsWith(".md")).sort()) {
      const relPath = path.posix.join("docs/reviews", name);
      violations.push(...collectStaleStatusViolations(relPath, read(relPath)));
    }
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

const FW_COLON = "\uff1a";
const FW_SEMI = "\uff1b";
const FW_COMMA = "\u3001";
const FW_BAR = "\uff5c";
const ROUTE_TOKEN = /^\/[a-z][a-z0-9-]*(?:\/:[A-Za-z][A-Za-z0-9_-]*|\/[A-Za-z0-9_.:~*-]+)*$/;
const UX_ID = /UX-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]+/;
const MARKER_LINE = "交互合同适用";
const AUTH_PHRASE = "开发授权已获得";
const WAIVER_REASON = "不改变用户可见 WebUI 表面";
const DIMENSION_PHRASE = "同一状态维度不得互相否定";
const BENCHMARKS = new Set([
  "/admin/tokens",
  "/catalog",
  "/skills",
  "/connections/enabled-tables",
  "/admin/agents"
]);
const NEW_MODE = /^新模式：webui\/docs\/design-system\/[^/]+\.md$/;
const STATE_LABELS = ["首访", "空", "加载", "错误", "0 条", "成功", "部分"];
const CONTRACT_LABELS = ["路由", "基准页", "一件事", "状态", "主动作", "决定信息", "术语", "台账", "状态维度"];
const BROWSER_LABELS = ["路由", "视口", "状态", "证据"];
const REVIEW_LABELS = [
  "Q1 主任务能否从页头和主工作区开始，而不必先读 Spec",
  "Q2 PageHeader 是否满足按钮规范 §3 第 8 条，其他 action group 是否各自最多一个 primary，并且与「不做」不冲突",
  "Q3 空、错误、0 条是否在面板内写明原因；不适用是否写了原因",
  "Q4 决定信息是否足够；截断或隐藏时能否看见原因",
  "Q5 控件是否与基准页同一套；新模式是否指向已存在的设计系统章节",
  "Q6 用户可见术语是否已登记，或已写在本 Spec 的 Terminology Compliance"
];
const VIEWPORTS = new Set(["1920\u00d71080", "1440\u00d7900"]);

function stripFences(text) {
  return text.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
}

function statusCell(text) {
  if (!text) return "";
  const head = text.split("\n").slice(0, 60).join("\n");
  const match = head.match(/^\|\s*\*{0,2}状态\*{0,2}\s*\|([^|\n]*)/m);
  return match ? match[1] : "";
}

function h2s(text) {
  const found = [];
  const re = /^##[ \t]+(.+?)[ \t]*$/gm;
  for (const match of text.matchAll(re)) {
    const lineEnd = text.indexOf("\n", match.index);
    found.push({
      title: match[1].trim(),
      index: match.index,
      bodyStart: lineEnd === -1 ? text.length : lineEnd + 1
    });
  }
  return found;
}

function sectionLines(text, headings, title) {
  const index = headings.findIndex((heading) => heading.title === title);
  if (index < 0) return null;
  const end = headings[index + 1]?.index ?? text.length;
  return text.slice(headings[index].bodyStart, end).split("\n").map((line) => line.trim()).filter(Boolean);
}

function violation(specRel, message) {
  return [{ file: specRel, rule: "interaction-contract", message }];
}

function parseLabeledLines(lines, labels) {
  if (lines.length !== labels.length) return { error: `非空行应有 ${labels.length} 行，实际 ${lines.length} 行` };
  const fields = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith("- ")) return { error: `第 ${i + 1} 行不是「- 」开头` };
    const body = line.slice(2);
    const colon = body.indexOf(FW_COLON);
    if (colon < 0) return { error: `第 ${i + 1} 行缺少全角冒号` };
    const label = body.slice(0, colon).trim();
    const value = body.slice(colon + 1).trim();
    if (label !== labels[i]) return { error: `第 ${i + 1} 行标签应为「${labels[i]}」，实际是「${label}」` };
    if (!value) return { error: `「${label}」的值为空` };
    fields[label] = value;
  }
  return { fields };
}

export function loadRegisteredRoutes() {
  const routes = new Set();
  const app = read("webui/src/app/App.tsx");
  for (const match of app.matchAll(/\bpath="([^"]+)"/g)) routes.add(match[1]);
  const nav = read("webui/src/app/navigation.ts");
  for (const match of nav.matchAll(/\bto:\s*"([^"]+)"/g)) routes.add(match[1]);
  return routes;
}

function loadGrandfatherFiles() {
  if (!existsSync(path.join(repoRoot, GRANDFATHER_FILE))) return [];
  const parsed = JSON.parse(read(GRANDFATHER_FILE));
  if (!Array.isArray(parsed.files)) {
    throw new Error(`${GRANDFATHER_FILE} 缺少 files 数组`);
  }
  return parsed.files;
}

function locate(rel, options) {
  if (options.files && Object.prototype.hasOwnProperty.call(options.files, rel)) {
    return { kind: "file", text: options.files[rel] };
  }
  if (options.directories && options.directories.has(rel)) return { kind: "dir" };
  const abs = path.join(repoRoot, rel);
  if (!existsSync(abs)) return { kind: "missing" };
  const stat = statSync(abs);
  if (stat.isDirectory()) return { kind: "dir" };
  if (!stat.isFile()) return { kind: "missing" };
  return { kind: "file", text: readFileSync(abs, "utf8") };
}

function routeTokenIsLegal(token, routes) {
  if (routes.has(token)) return true;
  const prefix = "新路由：";
  if (token.startsWith(prefix)) {
    const routePath = token.slice(prefix.length);
    return ROUTE_TOKEN.test(routePath) && !routes.has(routePath);
  }
  return false;
}

function parseState(value) {
  const parts = value.split(FW_SEMI);
  if (parts.length !== STATE_LABELS.length) {
    return { error: `状态应有 ${STATE_LABELS.length} 段，实际 ${parts.length} 段` };
  }
  const values = {};
  for (let i = 0; i < STATE_LABELS.length; i += 1) {
    const prefix = `${STATE_LABELS[i]}${FW_COLON}`;
    if (!parts[i].startsWith(prefix)) return { error: `状态第 ${i + 1} 段应为「${STATE_LABELS[i]}」` };
    const rest = parts[i].slice(prefix.length).trim();
    if (!rest) return { error: `状态「${STATE_LABELS[i]}」为空` };
    if (rest.startsWith(`不适用${FW_COLON}`) && rest.slice(`不适用${FW_COLON}`.length).trim() === "") {
      return { error: `状态「${STATE_LABELS[i]}」的不适用缺少原因` };
    }
    values[STATE_LABELS[i]] = rest;
  }
  return { values };
}

function parseVerdict(value) {
  if (value === "未评" || value === "通过") return { verdict: value };
  if (value.startsWith("不通过")) {
    const rest = value.slice("不通过".length);
    const marker = `原因${FW_COLON}`;
    const index = rest.indexOf(marker);
    if (index < 0 || rest.slice(0, index).trim() !== "" || rest.slice(index + marker.length).trim() === "") {
      return { error: "「不通过」同一行要有「原因：」和非空原因" };
    }
    return { verdict: "不通过" };
  }
  return { error: `评审取值无法识别：${value}` };
}

function evidenceProblem(rel, options) {
  if (rel.includes("..") || rel.startsWith("/") || rel.startsWith("\\")) return "路径越界";
  const found = locate(rel, options);
  if (found.kind === "dir") return "证据路径是目录";
  if (rel === "docs/README.md" || !(rel.startsWith("docs/reviews/") || rel.startsWith("docs/ui-ux-feedback/")) || !rel.endsWith(".md")) {
    return "证据路径不在允许范围内";
  }
  if (found.kind !== "file") return "证据文件不存在";
  return null;
}

function inventoryPaths(routeValue) {
  return routeValue.split(FW_COMMA).map((token) => token.trim()).filter(Boolean).map((token) => (
    token.startsWith("新路由：") ? token.slice("新路由：".length) : token
  ));
}

/**
 * 交互合同门禁。文法与 docs/specs/lucy-20261107-ui-interaction-contract-gate-spec.md §4、§6 一致。
 * grandfather 跳过是第一支：不解析豁免，也不解析合同。
 */
export function checkInteractionContract(specRel, specText, planText, options = {}) {
  const body = stripFences(specText);
  const marked = body.split("\n").some((line) => line.trim() === MARKER_LINE);
  const authorized = statusCell(specText).includes(AUTH_PHRASE);
  const grandfathered = (options.grandfatherFiles ?? []).includes(specRel);
  if (grandfathered && !marked && !authorized) return [];

  const headings = h2s(body);
  const count = (title) => headings.filter((heading) => heading.title === title).length;
  const waiverCount = count("交互合同豁免");
  const contractCount = count("交互合同");
  const reviewCount = count("交互评审");
  const inventoryCount = count("元素清单");
  for (const [title, total] of [["交互合同豁免", waiverCount], ["交互合同", contractCount], ["交互评审", reviewCount], ["元素清单", inventoryCount]]) {
    if (total > 1) return violation(specRel, `二级标题「${title}」超过一个`);
  }
  if (waiverCount > 0 && contractCount > 0) return violation(specRel, "交互合同豁免与交互合同不能并存");

  const planHeadings = planText == null ? null : h2s(stripFences(planText));
  const planStatus = statusCell(planText);

  if (waiverCount === 1) {
    const lines = sectionLines(body, headings, "交互合同豁免");
    const parsed = parseLabeledLines(lines, ["原因", "不改变"]);
    if (parsed.error) return violation(specRel, `交互合同豁免${parsed.error}`);
    if (!parsed.fields["原因"].includes(WAIVER_REASON)) {
      return violation(specRel, "豁免原因必须含「不改变用户可见 WebUI 表面」");
    }
    if (reviewCount !== 0) return violation(specRel, "有效豁免不能再有「交互评审」");
    if (inventoryCount !== 0) return violation(specRel, "有效豁免不能再有「元素清单」");
    if (planHeadings == null) return violation(specRel, "豁免 Spec 缺少配对 Plan");
    const browserCount = planHeadings.filter((heading) => heading.title === "浏览器验证").length;
    if (browserCount !== 1) return violation(specRel, "配对 Plan 必须恰好有一个「浏览器验证」");
    const browserLines = sectionLines(stripFences(planText), planHeadings, "浏览器验证");
    const first = browserLines[0] ?? "";
    if (!first.startsWith(`不适用${FW_COLON}`) || first.slice(`不适用${FW_COLON}`.length).trim() === "") {
      return violation(specRel, "豁免 Plan 的浏览器验证第一条须为「不适用：」加非空说明");
    }
    return [];
  }

  let triggered = marked || body.includes("webui/src/");
  if (!triggered) {
    for (const match of body.matchAll(/`([^`]+)`/g)) {
      if (ROUTE_TOKEN.test(match[1])) {
        triggered = true;
        break;
      }
    }
  }
  if (!triggered) return [];

  if (contractCount !== 1) return violation(specRel, "触发的 Spec 必须恰好有一个「交互合同」");
  if (inventoryCount !== 1) return violation(specRel, "触发的 Spec 必须恰好有一个「元素清单」");
  const contractIndex = headings.findIndex((heading) => heading.title === "交互合同");
  if (headings[contractIndex + 1]?.title !== "元素清单") {
    return violation(specRel, "「交互合同」的下一个二级标题必须是「元素清单」");
  }
  const inventoryIndex = contractIndex + 1;
  if (headings[inventoryIndex + 1]?.title !== "交互评审") {
    return violation(specRel, "「元素清单」的下一个二级标题必须是「交互评审」");
  }

  const contractParsed = parseLabeledLines(sectionLines(body, headings, "交互合同"), CONTRACT_LABELS);
  if (contractParsed.error) return violation(specRel, `交互合同${contractParsed.error}`);
  const fields = contractParsed.fields;
  const tokens = fields["路由"].split(FW_COMMA).map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) return violation(specRel, "交互合同路由为空");
  const routes = options.registeredRoutes ?? loadRegisteredRoutes();
  for (const token of tokens) {
    if (!routeTokenIsLegal(token, routes)) return violation(specRel, `路由不合法：${token}`);
  }
  if (!BENCHMARKS.has(fields["基准页"])) {
    if (!NEW_MODE.test(fields["基准页"])) return violation(specRel, `基准页不合法：${fields["基准页"]}`);
    const modePath = fields["基准页"].slice("新模式：".length);
    if (locate(modePath, options).kind !== "file") return violation(specRel, `新模式文件不存在：${modePath}`);
  }
  const state = parseState(fields["状态"]);
  if (state.error) return violation(specRel, state.error);
  if (!fields["主动作"].includes("primary") || !fields["主动作"].includes("不做")) {
    return violation(specRel, "主动作必须同时含 primary 与「不做」");
  }
  if (!fields["术语"].includes("已登记") && !fields["术语"].includes("本条新增")) {
    return violation(specRel, "术语必须含「已登记」或「本条新增」");
  }
  if (fields["台账"] !== "无新台账" && !UX_ID.test(fields["台账"])) {
    return violation(specRel, "台账必须是「无新台账」，或含合法 UX 编号");
  }
  if (!fields["状态维度"].includes(DIMENSION_PHRASE)) {
    return violation(specRel, "状态维度必须含「同一状态维度不得互相否定」");
  }

  const rows = sectionLines(body, headings, "元素清单");
  if (!rows || rows.length === 0) return violation(specRel, "元素清单至少要有一行");
  const paths = inventoryPaths(fields["路由"]);
  const pathSet = new Set(paths);
  const seen = new Map(paths.map((routePath) => [routePath, new Map()]));
  const ids = [];
  for (let i = 0; i < rows.length; i += 1) {
    const line = rows[i];
    if (!line.startsWith("- ")) return violation(specRel, `元素清单第 ${i + 1} 行不是「- 」开头`);
    const parts = line.slice(2).split(FW_BAR).map((part) => part.trim());
    if (parts.length !== 5 || parts.some((part) => part === "")) {
      return violation(specRel, `元素清单第 ${i + 1} 行必须是五段全角竖线`);
    }
    const expectedId = `E${i + 1}`;
    if (parts[0] !== expectedId) return violation(specRel, `元素清单编号应从 E1 连续递增，第 ${i + 1} 行是 ${parts[0]}`);
    if (parts.some((part) => /class=|DOM|[0-9]+px/.test(part))) {
      return violation(specRel, `元素清单第 ${i + 1} 行含 class=、DOM 或像素`);
    }
    const [, routePath, element] = parts;
    if (!pathSet.has(routePath)) return violation(specRel, `元素清单路由不在合同里：${routePath}`);
    const elements = seen.get(routePath);
    if (elements.has(element)) return violation(specRel, `同一路径的元素重复：${routePath}／${element}`);
    elements.set(element, true);
    ids.push(expectedId);
  }
  const required = STATE_LABELS.filter((label) => !state.values[label].startsWith(`不适用${FW_COLON}`));
  required.push("主动作", "决定信息");
  for (const routePath of paths) {
    const elements = seen.get(routePath);
    for (const element of required) {
      if (!elements.has(element)) return violation(specRel, `元素清单缺少：${routePath}／${element}`);
    }
  }

  const reviewParsed = parseLabeledLines(sectionLines(body, headings, "交互评审"), REVIEW_LABELS);
  if (reviewParsed.error) return violation(specRel, `交互评审${reviewParsed.error}`);
  for (const label of REVIEW_LABELS) {
    const verdict = parseVerdict(reviewParsed.fields[label]);
    if (verdict.error) return violation(specRel, verdict.error);
    if (authorized && verdict.verdict !== "通过") {
      return violation(specRel, "状态行含「开发授权已获得」时，六问必须全是「通过」");
    }
  }

  if (planHeadings == null) return violation(specRel, "触发的 Spec 缺少配对 Plan");
  const browserCount = planHeadings.filter((heading) => heading.title === "浏览器验证").length;
  if (browserCount !== 1) return violation(specRel, "配对 Plan 必须恰好有一个「浏览器验证」");
  const browserParsed = parseLabeledLines(sectionLines(stripFences(planText), planHeadings, "浏览器验证"), BROWSER_LABELS);
  if (browserParsed.error) return violation(specRel, `浏览器验证${browserParsed.error}`);
  const browser = browserParsed.fields;
  if (browser["路由"] !== fields["路由"]) return violation(specRel, "浏览器验证的路由必须与交互合同的路由整串相同");
  if (!VIEWPORTS.has(browser["视口"])) return violation(specRel, `视口不合法：${browser["视口"]}`);
  const expectedIds = ids.join(FW_COMMA);
  if (browser["状态"] !== expectedIds) return violation(specRel, `浏览器验证的状态必须恰好是 ${expectedIds}`);
  if (browser["证据"] === "未执行") {
    if (planStatus.includes("浏览器验证已完成")) {
      return violation(specRel, "Plan 状态已写浏览器验证已完成，证据却仍是未执行");
    }
    return [];
  }
  const pathError = evidenceProblem(browser["证据"], options);
  if (pathError) return violation(specRel, pathError);
  const evidenceText = locate(browser["证据"], options).text;
  if (!evidenceText.includes(fields["路由"]) || !evidenceText.includes(browser["视口"])) {
    return violation(specRel, "证据正文必须含合同路由值和视口");
  }
  const counts = new Map();
  for (const match of evidenceText.matchAll(/E([1-9][0-9]*)：(通过|失败)/g)) {
    const id = `E${match[1]}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const id of ids) {
    if (counts.get(id) !== 1) return violation(specRel, `证据里 ${id} 的结果不是恰好一条`);
  }
  for (const id of counts.keys()) {
    if (!ids.includes(id)) return violation(specRel, `证据出现清单外编号 ${id}`);
  }
  return [];
}

function main() {
  const result = scanRepo();
  console.log(formatReport(result));
  process.exit(result.blocking.length ? 1 : 0);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
