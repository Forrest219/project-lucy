#!/usr/bin/env node
/**
 * uat-verdict-gate.mjs — 静态门禁：UAT 判定合规（升级验收底线机检）。
 *
 * 背景：docs/qa/uat/CONVENTIONS.md「升级验收底线（强制）」（2026-11-27 委托人明示）：
 *   1. 任何升级不得造成用户体验降级（主张收口须有对照证据）；
 *   2. 所有新发功能必须通过 UI 验证（API／单测／CR 不构成验收）；
 *   3. WebUI 升级必须经浏览器验证（真实前台浏览器＋计时）；
 *   4. MCP 升级必须做性能测试（挂 UAT-MIP 档跑次对照）。
 *
 * 本门禁把可机械判定的部分落到测试台 SOT 上：
 *   R1 声明完整性：INDEX 中每个挂 suite.md 的套件必须在 docs/qa/uat/suite-faces.json
 *      登记「验收面」；registry 中不得有 INDEX 不存在的孤儿条目。
 *   R2 验收面词表：faces 只允许 webui／mcp／api。
 *   R3 判定词表：INDEX 判定须可解析为 PASS／PASS WITH GAP／FAIL／BLOCKED／
 *      NOT RUN／SEED_ONLY／SKIPPED（无粗体判定的辅助行跳过）。
 *   R4 PASS 须有跑次：判定为 PASS／PASS WITH GAP 时，跑次列须含 ≥1 个 runs/*.md
 *      链接，且每个链接的文件真实存在。
 *   R5 WebUI 面浏览器证据：faces 含 webui 且 PASS 时，至少一条跑次文件含浏览器
 *      证据标记（真实前台浏览器／前台 Chrome／primaryReady／Playwright 等）。
 *   R6 MCP 面 MIP 关联：faces 含 mcp 且 PASS 时，registry 须登记 mip linked
 *      （suite.md 或 INDEX 行引用 UAT-MIP）或显式豁免（含原因）。
 *
 * tier 语义：strict＝硬失败（0.35 起新套件默认）；legacy＝只告警（0.30 及以前
 * 存量套件，按 spec grandfather 惯例不追溯拦 CI，但每次运行都打印待整改项）。
 *
 * 用法：node scripts/lint/uat-verdict-gate.mjs [--uat-dir <dir>]
 * 退出码：0=通过（可含 legacy 告警）；1=存在 strict 违规；2=门禁自身错误。
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_UAT_DIR = path.join(REPO_ROOT, "docs/qa/uat");

export const FACE_VOCAB = new Set(["webui", "mcp", "api"]);

const VERDICT_PRIORITY = [
  "FAIL",
  "BLOCKED",
  "SEED_ONLY",
  "NOT RUN",
  "SKIPPED",
  "PASS WITH GAP",
  "PASS",
];

// 判定同义词归一：PASS WITH GAPS（复数笔误）等。
const VERDICT_ALIASES = [
  { re: /PASS WITH GAPS?(?![A-Z])/g, to: "PASS WITH GAP" },
];

const BROWSER_EVIDENCE_RE =
  /(真实前台|前台\s*(?:Chrome|Chromium|浏览器|登录|会话)|browser|primaryReady|Playwright)/i;

const PASS_LIKE = new Set(["PASS", "PASS WITH GAP"]);

function normalizeVerdictTokens(text) {
  let normalized = text;
  for (const { re, to } of VERDICT_ALIASES) {
    normalized = normalized.replace(re, to);
  }
  return normalized;
}

/**
 * 从 INDEX 判定单元格解析出唯一判定词。
 * 只看粗体段（**...**）；无粗体段返回 null（辅助行，不判定）。
 * 多个粗体段并存时按「最差状态优先」取词，防止后缀补录把 FAIL 行洗成 PASS。
 */
export function classifyVerdict(rawCell) {
  const segments = [];
  const re = /\*\*([^*]+)\*\*/g;
  let m;
  while ((m = re.exec(rawCell)) !== null) {
    segments.push(normalizeVerdictTokens(m[1]));
  }
  if (segments.length === 0) return null;
  for (const verdict of VERDICT_PRIORITY) {
    if (segments.some((seg) => seg.includes(verdict))) return verdict;
  }
  return null;
}

/**
 * 解析 INDEX.md 的套件行。
 * 返回 [{ suiteId, dir|null, runLinks[], verdict|null, rawRow }]。
 * 无 suites 路径链接的行视为辅助行（dir=null），不参与 R1/R4–R6。
 */
export function parseIndexRows(indexText) {
  const rows = [];
  for (const line of indexText.split("\n")) {
    if (!line.startsWith("| `UAT-SUITE-")) continue;
    const suiteMatch = line.match(/UAT-SUITE-[A-Z0-9-]+/);
    if (!suiteMatch) continue;
    const cells = line.split("|").map((c) => c.trim());
    // cells: ["", suite, ledger, path, env, runs, verdict, ""]
    const pathCell = cells[3] ?? "";
    const runsCell = cells[5] ?? "";
    const verdictCell = cells[6] ?? "";
    const dirMatch = pathCell.match(/suites\/([a-z0-9-]+)\/suite\.md/);
    const runLinks = [...runsCell.matchAll(/\(((?:suites\/[a-z0-9-]+\/)?runs\/[^)\s]+\.md)\)/g)].map((m) => m[1]);
    rows.push({
      suiteId: suiteMatch[0],
      dir: dirMatch ? dirMatch[1] : null,
      runLinks,
      verdict: classifyVerdict(verdictCell),
      rawRow: line,
    });
  }
  return rows;
}

/**
 * 核心评估。rows 来自 parseIndexRows；registry 为 suite-faces.json 解析结果；
 * uatDir 用于读取 suite.md 与 runs 文件（readFile 可注入供测试）。
 */
export function evaluateSuiteRows({ rows, registry, uatDir, readFile = readFileSync }) {
  const violations = [];
  const warnings = [];
  const push = (list, severity) => (finding) => {
    list.push({ severity, ...finding });
  };
  const addV = push(violations, "strict");
  const addW = push(warnings, "legacy");

  const seen = new Set();
  for (const row of rows) {
    seen.add(row.suiteId);
    const entry = registry[row.suiteId];

    // 辅助行（无 suite.md 路径）：只要求不主张 PASS，避免绕过登记。
    if (row.dir === null) {
      if (row.verdict !== null && PASS_LIKE.has(row.verdict)) {
        addV({
          rule: "aux-row-no-pass",
          suiteId: row.suiteId,
          message: "无 suite.md 路径的辅助行不得主张 PASS／PASS WITH GAP",
        });
      }
      continue;
    }

    if (!entry) {
      addV({
        rule: "missing-faces-declaration",
        suiteId: row.suiteId,
        message: `未在 suite-faces.json 登记验收面（dir=${row.dir}）`,
      });
      continue;
    }

    const tier = entry.tier === "legacy" ? "legacy" : "strict";
    const emit = tier === "legacy" ? addW : addV;

    // R2 验收面词表
    const faces = Array.isArray(entry.faces) ? entry.faces : [];
    const badFaces = faces.filter((f) => !FACE_VOCAB.has(f));
    if (faces.length === 0 || badFaces.length > 0) {
      addV({
        rule: "invalid-faces",
        suiteId: row.suiteId,
        message: `验收面声明非法：${JSON.stringify(entry.faces)}（词表 webui/mcp/api）`,
      });
      continue;
    }

    // R3 判定词表（INDEX 行有粗体但解析不出合法词）
    if (row.verdict === null && /\*\*[^*]+\*\*/.test(row.rawRow.split("|")[6] ?? "")) {
      emit({
        rule: "unparseable-verdict",
        suiteId: row.suiteId,
        message: "判定列含粗体但无法解析出合法判定词",
      });
    }

    const passLike = row.verdict !== null && PASS_LIKE.has(row.verdict);

    // R4 PASS 须有真实跑次链接
    if (passLike) {
      if (row.runLinks.length === 0) {
        emit({
          rule: "pass-requires-run-link",
          suiteId: row.suiteId,
          message: "判定为 PASS／PASS WITH GAP 但跑次列无 runs/*.md 链接",
        });
      }
      for (const link of row.runLinks) {
        const runPath = path.join(uatDir, link);
        if (!existsSync(runPath)) {
          emit({
            rule: "run-file-missing",
            suiteId: row.suiteId,
            message: `跑次文件不存在：${link}`,
          });
        }
      }
    }

    // R5 WebUI 面 PASS 须有浏览器证据
    if (passLike && faces.includes("webui") && row.runLinks.length > 0) {
      const hasBrowserEvidence = row.runLinks.some((link) => {
        const runPath = path.join(uatDir, link);
        if (!existsSync(runPath)) return false;
        try {
          return BROWSER_EVIDENCE_RE.test(readFile(runPath, "utf8"));
        } catch {
          return false;
        }
      });
      if (!hasBrowserEvidence) {
        emit({
          rule: "webui-pass-requires-browser-evidence",
          suiteId: row.suiteId,
          message: "验收面含 webui 且 PASS，但跑次均无浏览器证据标记（真实前台浏览器／Chrome／primaryReady／Playwright）",
        });
      }
    }

    // R6 MCP 面 PASS 须有 MIP 关联或显式豁免
    if (passLike && faces.includes("mcp")) {
      const mip = entry.mip;
      if (!mip || (mip.status !== "linked" && mip.status !== "exempt")) {
        emit({
          rule: "mcp-pass-requires-mip-linkage",
          suiteId: row.suiteId,
          message: "验收面含 mcp 且 PASS，但未登记 mip linked／exempt",
        });
      } else if (mip.status === "exempt" && !(typeof mip.reason === "string" && mip.reason.trim().length >= 4)) {
        emit({
          rule: "mip-exempt-requires-reason",
          suiteId: row.suiteId,
          message: "mip exempt 须写明豁免原因",
        });
      } else if (mip.status === "linked") {
        const suiteMd = path.join(uatDir, "suites", row.dir, "suite.md");
        let linked = /\bUAT-MIP\b/.test(row.rawRow);
        if (!linked && existsSync(suiteMd)) {
          linked = /\bUAT-MIP\b/.test(readFile(suiteMd, "utf8"));
        }
        if (!linked) {
          emit({
            rule: "mip-linked-requires-reference",
            suiteId: row.suiteId,
            message: "mip linked 但 suite.md 与 INDEX 行均未引用 UAT-MIP",
          });
        }
      }
    }
  }

  // R1b 孤儿 registry 条目
  for (const suiteId of Object.keys(registry)) {
    if (!seen.has(suiteId)) {
      addV({
        rule: "orphan-registry-entry",
        suiteId,
        message: "suite-faces.json 条目在 INDEX 中无对应套件行",
      });
    }
  }

  return { violations, warnings };
}

function loadRegistry(registryPath) {
  if (!existsSync(registryPath)) {
    console.error(`[uat-verdict] registry 不存在：${registryPath}`);
    process.exit(2);
  }
  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf8"));
    if (!parsed || typeof parsed.suites !== "object" || parsed.suites === null) {
      console.error("[uat-verdict] registry 缺少 suites 对象");
      process.exit(2);
    }
    return parsed.suites;
  } catch (err) {
    console.error(`[uat-verdict] registry 解析失败：${err.message}`);
    process.exit(2);
  }
}

function main() {
  const argv = process.argv.slice(2);
  let uatDir = DEFAULT_UAT_DIR;
  const idx = argv.indexOf("--uat-dir");
  if (idx !== -1) {
    uatDir = path.resolve(argv[idx + 1]);
  }

  const indexPath = path.join(uatDir, "INDEX.md");
  const registryPath = path.join(uatDir, "suite-faces.json");
  if (!existsSync(indexPath)) {
    console.error(`[uat-verdict] INDEX 不存在：${indexPath}`);
    process.exit(2);
  }
  const rows = parseIndexRows(readFileSync(indexPath, "utf8"));
  const registry = loadRegistry(registryPath);
  const { violations, warnings } = evaluateSuiteRows({ rows, registry, uatDir });

  for (const w of warnings) {
    console.log(`[uat-verdict][WARN:${w.rule}] ${w.suiteId} — ${w.message}`);
  }
  for (const v of violations) {
    console.error(`[uat-verdict][FAIL:${v.rule}] ${v.suiteId} — ${v.message}`);
  }

  const summary = `套件行 ${rows.length}；strict 违规 ${violations.length}；legacy 告警 ${warnings.length}`;
  if (violations.length > 0) {
    console.error(`[uat-verdict] ${summary} — 未通过`);
    process.exit(1);
  }
  console.log(`[uat-verdict] ${summary} — 通过`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}
