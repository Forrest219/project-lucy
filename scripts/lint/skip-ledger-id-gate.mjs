#!/usr/bin/env node
/**
 * skip-ledger-id-gate.mjs — 静态门禁：禁止无总账 ID 的 it.skip / describe.skip / test.skip 与任何 .only。
 *
 * 背景：错题本 docs/lessons/2026-11-19-fde-3b1c62af-defects-missed-by-uat.md 记录了
 * 移植分支测试时把探测用例改为 it.skip 且未挂总账 ID，导致缺陷静默漏检仍判 PASS。
 *
 * 规则：
 *   1. 任何目录中出现 it.only / test.only / describe.only 一律 FAIL。
 *   2. 任何 it.skip(...) / describe.skip(...) 必须在调用参数文本或紧邻前 2 行注释中携带
 *      总账/需求/缺口 ID（匹配 P[0-2]-N / REQ-NNN-NNN / GAP-... / L\d+-N）。
 *   3. test.skip(...)：
 *      - 在单元测试与脚本目录（webui/src、webui/server、scripts）中，一律要求携带总账 ID。
 *      - 在 Playwright E2E/性能目录（webui/tests/{e2e,live-e2e,performance,real-e2e}）中：
 *        - 条件守卫（首参非常量 true/字符串，且提供非空理由字符串）放行；
 *        - real-e2e 运行时 `test.skip(true, "BLOCKED: ...")` 放行；
 *        - 其余无条件 skip（test.skip() / test.skip("title", ...) / test.skip(true, ...)）必须带总账 ID。
 *
 * 用法：node scripts/lint/skip-ledger-id-gate.mjs [--root <dir>]...
 * 退出码：0=通过；1=存在违规；2=门禁自身错误。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".vite",
  ".vitest-cache",
  "playwright-report",
  ".worktrees",
]);

const CODE_EXT = /\.(ts|tsx|js|mjs|cjs)$/;

export const LEDGER_ID_RE = /\b(P[0-2]-\d+|REQ-\d{3}-\d{3}|GAP-[A-Z0-9-]+|L\d+-\d+)\b/;

const DEFAULT_ROOTS = [
  "webui/src",
  "webui/server",
  "webui/tests",
  "scripts",
];

const PLAYWRIGHT_GUARD_PREFIXES = [
  "webui/tests/e2e/",
  "webui/tests/live-e2e/",
  "webui/tests/performance/",
  "webui/tests/real-e2e/",
];

const REAL_E2E_PREFIX = "webui/tests/real-e2e/";

function isPlaywrightGuardPath(relPath) {
  const normalized = relPath.split(path.sep).join("/");
  return PLAYWRIGHT_GUARD_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isRealE2ePath(relPath) {
  const normalized = relPath.split(path.sep).join("/");
  return normalized.startsWith(REAL_E2E_PREFIX);
}

/**
 * Extract the argument list text inside `(...)` starting at the `(` index.
 */
function extractParenArgs(text, openParenIndex) {
  let depth = 0;
  let inString = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openParenIndex; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(openParenIndex + 1, i);
      }
    }
  }
  return text.slice(openParenIndex + 1, Math.min(text.length, openParenIndex + 400));
}

/**
 * Split top-level comma-separated arguments (respecting strings and nested brackets).
 */
function splitTopLevelArgs(argText) {
  const args = [];
  let current = "";
  let depth = 0;
  let inString = null;

  for (let i = 0; i < argText.length; i += 1) {
    const ch = argText[i];
    if (inString) {
      current += ch;
      if (ch === "\\" && i + 1 < argText.length) {
        current += argText[i + 1];
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) {
    args.push(current.trim());
  }
  return args;
}

/**
 * Return true if the match offset lies inside a comment or string literal.
 */
function buildNonCodeRanges(text) {
  const ranges = [];
  let inString = null;
  let inLineComment = false;
  let inBlockComment = false;
  let start = -1;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        ranges.push([start, i]);
        inLineComment = false;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        ranges.push([start, i + 2]);
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === inString) {
        ranges.push([start, i + 1]);
        inString = null;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      start = i;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      start = i;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      start = i;
    }
  }
  if (inLineComment || inBlockComment || inString) {
    ranges.push([start, text.length]);
  }
  return ranges;
}

function isInsideRanges(index, ranges) {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = ranges[mid];
    if (index < start) hi = mid - 1;
    else if (index >= end) lo = mid + 1;
    else return true;
  }
  return false;
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function isStringLiteral(expr) {
  return (
    (expr.startsWith('"') && expr.endsWith('"')) ||
    (expr.startsWith("'") && expr.endsWith("'")) ||
    (expr.startsWith("`") && expr.endsWith("`"))
  );
}

function stripQuotes(expr) {
  if (!isStringLiteral(expr)) return expr;
  return expr.slice(1, -1).trim();
}

export function scanFileContent(content, relPath) {
  const issues = [];
  const lines = content.split("\n");
  const nonCodeRanges = buildNonCodeRanges(content);
  const callRe = /\b(?:(it|test|describe)\.(skip|only|fixme)(?:\.each)?|(x(?:it|test|describe)))\s*\(/g;

  for (const match of content.matchAll(callRe)) {
    const index = match.index ?? 0;
    if (isInsideRanges(index, nonCodeRanges)) continue;

    const isXAlias = Boolean(match[3]);
    const callee = isXAlias ? match[3] : match[1];
    const modifier = isXAlias ? "skip" : match[2];
    const line = lineNumberAt(content, index);
    const openParenIndex = index + match[0].length - 1;
    const rawArgs = extractParenArgs(content, openParenIndex);
    const args = splitTopLevelArgs(rawArgs);

    if (modifier === "only") {
      issues.push({
        file: relPath,
        line,
        rule: "no-only",
        message: `${callee}.only(...) is forbidden in committed tests`,
      });
      continue;
    }

    // Check if ledger ID appears in arguments or the 2 preceding comment-only lines
    const precedingCommentLines = lines
      .slice(Math.max(0, line - 3), Math.max(0, line - 1))
      .filter((ln) => /^\s*(\/\/|\/\*|\*)/.test(ln))
      .join("\n");
    const hasLedgerId = LEDGER_ID_RE.test(rawArgs) || LEDGER_ID_RE.test(precedingCommentLines);

    if (hasLedgerId) continue;

    // Playwright conditional environment/browser guards in E2E/perf suites
    if (callee === "test" && modifier === "skip" && isPlaywrightGuardPath(relPath) && args.length >= 2) {
      const firstArg = args[0];
      const secondArg = args[1];
      const hasReason = isStringLiteral(secondArg) && stripQuotes(secondArg).length >= 4;

      if (isRealE2ePath(relPath) && hasReason && /^BLOCKED:/i.test(stripQuotes(secondArg))) {
        continue;
      }
      if (firstArg !== "true" && !isStringLiteral(firstArg) && hasReason) {
        continue;
      }
    }

    const label = isXAlias ? `${callee}(...)` : `${callee}.${modifier}(...)`;
    issues.push({
      file: relPath,
      line,
      rule: "skip-requires-ledger-id",
      message: `${label} must cite a ledger/requirement/gap ID (e.g. P1-57, REQ-030-077, GAP-...) in its title/reason or preceding comment`,
    });
  }

  return issues;
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && CODE_EXT.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      yield full;
    }
  }
}

export function collectIssues(roots = DEFAULT_ROOTS, repoRoot = REPO_ROOT) {
  const issues = [];
  let scanned = 0;

  for (const root of roots) {
    const abs = path.isAbsolute(root) ? root : path.join(repoRoot, root);
    if (!existsSync(abs)) continue;
    const stats = statSync(abs);
    const files = stats.isFile() ? [abs] : [...walk(abs)].sort();
    for (const file of files) {
      const rel = path.relative(repoRoot, file).split(path.sep).join("/");
      const content = readFileSync(file, "utf8");
      issues.push(...scanFileContent(content, rel));
      scanned += 1;
    }
  }

  return { scanned, issues };
}

export function main(argv = process.argv.slice(2)) {
  const customRoots = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") {
      const value = argv[++i];
      if (!value) {
        console.error("[skip-ledger-id-gate] --root requires a directory or file path");
        process.exit(2);
      }
      customRoots.push(value);
    } else {
      console.error(`[skip-ledger-id-gate] unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }

  const roots = customRoots.length > 0 ? customRoots : DEFAULT_ROOTS;
  const { scanned, issues } = collectIssues(roots, REPO_ROOT);

  if (issues.length > 0) {
    console.error(`[skip-ledger-id-gate] FAIL：发现 ${issues.length} 处违规（扫描 ${scanned} 个文件）`);
    for (const issue of issues) {
      console.error(`  ${issue.file}:${issue.line} [${issue.rule}] ${issue.message}`);
    }
    process.exit(1);
  }

  console.log(`[skip-ledger-id-gate] PASS：扫描 ${scanned} 个文件，0 处无总账 ID 的 skip 或 .only`);
}

const isDirect =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  main();
}
