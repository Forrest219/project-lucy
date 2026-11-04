#!/usr/bin/env node
/**
 * 本地门禁：`docs/SYSTEM_HANDBOOK.md` §4.4「可用工具面」的**工具全集**必须与
 * 运行时**实际可授予的工具全集完全相等**。
 *
 * 背景（为什么需要这道门禁）：
 *
 *   §4.4 是**接入侧**章节——接入方按它配置角色的 MCP 工具勾选。此前它只写了
 *   「6 个 `lucy_*` 核心工具」+「兼容/辅助工具**可能包括** …等」，而运行时
 *   实际可授予 21 个。两处口径不一致时，接入方照 §4.4 建角色会漏配
 *   `lucy_skill_search` / `lucy_skill_read`（业务 Skill 读取通道）、
 *   `lucy_continue_question`、`lucy_ops_*`（运维控制面）等工具。
 *
 *   §3.5「角色工具勾选速查」当时是完整的，但它是**管理员视角**；接入侧读者
 *   往往只读 §4。两章各写一份清单，必然漂移。
 *
 * 事实源（运行时，唯一）：
 *   - `webui/server/proxy/acl.ts` → `DATA_PLANE_TOOLS` / `META_TOOLS` / `CONTEXT_TOOLS`
 *   - `webui/server/ops/control-plane.ts` → `CONTROL_PLANE_TOOLS`（`name` 字段）
 *
 * 手册侧：`docs/SYSTEM_HANDBOOK.md` §4.4 区间内的 markdown 表格**第一格**里
 * 被反引号包裹的小写 snake_case token。每个工具一行（允许一格多个，如
 * `` `wiki_search` / `wiki_read` ``）。
 *
 * 失败意味着什么：
 *   - 运行时有、手册没有 → 接入方按手册配不出这个工具的能力；
 *   - 手册有、运行时没有 → 手册承诺了不存在的工具，接入方会照着配一个不生效的项。
 *   两种都是「手册与核心功能脱节」，必须当场修手册或修运行时登记。
 *
 * 本门禁是**纯 Node ESM**，不依赖 `webui/node_modules`（与同目录
 * `handbook-anchor-gate.mjs` 一致），因此可以在没有 webui 依赖的环境里跑。
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const HANDBOOK_PATH = "docs/SYSTEM_HANDBOOK.md";
const ACL_PATH = "webui/server/proxy/acl.ts";
const CONTROL_PLANE_PATH = "webui/server/ops/control-plane.ts";

/**
 * Thrown when the handbook's §4.4 tool list and the runtime tool registry
 * disagree. Carries a stable `name` so callers can `instanceof` it and log
 * scrapers can grep for a stable prefix.
 */
export class ToolSurfaceError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolSurfaceError";
  }
}

/* ------------------------------------------------------------------ *
 * Runtime side — where the truth lives
 * ------------------------------------------------------------------ */

/**
 * Walk `text` from `openIdx` (which must point at `[`) and return the index of
 * the matching `]`.
 *
 * This is a small tokenizer: it skips **comments before strings**, because a
 * stray apostrophe inside a `//` comment (e.g. `run through lucy's ACL.`)
 * would otherwise open a fake string literal and swallow the array's closing
 * bracket. Strings are skipped whole so brackets inside them do not count.
 */
function findClosingBracket(text, openIdx) {
  let depth = 1;
  let i = openIdx + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i += 1;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  throw new ToolSurfaceError(
    `unbalanced \`[\` while reading a tool registry literal; ` +
      `the literal shape changed — update \`scripts/gates/handbook-tool-surface.mjs\`.`
  );
}

/**
 * Locate the `[` that opens a `const NAME … = [ … ]` array literal.
 *
 * Anchoring on the `=` (not on the first `[` after the identifier) matters:
 * a type annotation such as `readonly OpsToolSpec[]` contains a `[` that
 * would otherwise be mistaken for the array literal.
 */
function findArrayLiteralStart(sourceText, declIdx, constName, filePath) {
  const eqIdx = sourceText.indexOf("=", declIdx);
  const openIdx = sourceText.indexOf("[", eqIdx === -1 ? declIdx : eqIdx);
  if (eqIdx === -1 || openIdx === -1) {
    throw new ToolSurfaceError(
      `could not locate the array literal of \`${constName}\` in ${filePath}.`
    );
  }
  return openIdx;
}

/**
 * Extract a `const NAME = [ ... ] as const;` array of **bare string literals**
 * from a TypeScript source file.
 *
 * Only lines that are exactly one string literal are accepted, so a nested
 * object literal (like `CONTROL_PLANE_TOOLS`) cannot leak extra names into
 * the result.
 */
export function extractStringArray(sourceText, constName, filePath) {
  const declIdx = sourceText.indexOf(`const ${constName}`);
  if (declIdx === -1) {
    throw new ToolSurfaceError(
      `could not locate \`const ${constName}\` in ${filePath}; ` +
        `either the export was renamed or its shape changed — update ` +
        `\`scripts/gates/handbook-tool-surface.mjs\` to match.`
    );
  }
  const openIdx = findArrayLiteralStart(sourceText, declIdx, constName, filePath);
  const closeIdx = findClosingBracket(sourceText, openIdx);
  const body = sourceText.slice(openIdx + 1, closeIdx);
  const names = [];
  const lineRe = /^\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*,?\s*$/gm;
  let match;
  while ((match = lineRe.exec(body)) !== null) {
    names.push(match[1]);
  }
  if (names.length === 0) {
    throw new ToolSurfaceError(
      `parsed 0 tool names out of \`${constName}\` in ${filePath}; ` +
        `the literal shape changed — update \`scripts/gates/handbook-tool-surface.mjs\`.`
    );
  }
  return names;
}

/**
 * Extract the `name: "xxx"` fields of an array of tool-spec objects
 * (`CONTROL_PLANE_TOOLS` in `webui/server/ops/control-plane.ts`).
 */
export function extractObjectArrayNames(sourceText, constName, filePath) {
  const declIdx = sourceText.indexOf(`const ${constName}`);
  if (declIdx === -1) {
    throw new ToolSurfaceError(
      `could not locate \`const ${constName}\` in ${filePath}; ` +
        `update \`scripts/gates/handbook-tool-surface.mjs\` to match.`
    );
  }
  const openIdx = findArrayLiteralStart(sourceText, declIdx, constName, filePath);
  const closeIdx = findClosingBracket(sourceText, openIdx);
  const body = sourceText.slice(openIdx + 1, closeIdx);
  const names = [];
  const nameRe = /\bname:\s*"([A-Za-z_][A-Za-z0-9_]*)"/g;
  let match;
  while ((match = nameRe.exec(body)) !== null) {
    names.push(match[1]);
  }
  if (names.length === 0) {
    throw new ToolSurfaceError(
      `parsed 0 tool names out of \`${constName}\` in ${filePath}; ` +
        `update \`scripts/gates/handbook-tool-surface.mjs\` to match.`
    );
  }
  return names;
}

/**
 * Read the **complete** set of grantable MCP tool names from the runtime.
 *
 * Four registries, unioned:
 *   - `DATA_PLANE_TOOLS`   — query / read / validate tools
 *   - `META_TOOLS`         — catalog / discovery / question-trace tools
 *   - `CONTEXT_TOOLS`      — Wiki + Skill discover/read channels (subset of META today)
 *   - `CONTROL_PLANE_TOOLS` — `lucy_ops_*` control-plane tools
 */
export function readRuntimeToolNames(root = ROOT) {
  const aclPath = path.join(root, ACL_PATH);
  const controlPlanePath = path.join(root, CONTROL_PLANE_PATH);
  for (const p of [aclPath, controlPlanePath]) {
    if (!existsSync(p)) {
      throw new ToolSurfaceError(
        `runtime source not found at ${p}; expected \`${path.relative(root, p)}\` at repo root.`
      );
    }
  }
  const aclText = readFileSync(aclPath, "utf8");
  const controlPlaneText = readFileSync(controlPlanePath, "utf8");
  const names = new Set();
  for (const name of extractStringArray(aclText, "DATA_PLANE_TOOLS", ACL_PATH)) names.add(name);
  for (const name of extractStringArray(aclText, "META_TOOLS", ACL_PATH)) names.add(name);
  for (const name of extractStringArray(aclText, "CONTEXT_TOOLS", ACL_PATH)) names.add(name);
  for (const name of extractObjectArrayNames(controlPlaneText, "CONTROL_PLANE_TOOLS", CONTROL_PLANE_PATH)) {
    names.add(name);
  }
  return names;
}

/* ------------------------------------------------------------------ *
 * Handbook side — §4.4 可用工具面
 * ------------------------------------------------------------------ */

/** Tool names are lowercase snake_case; uppercase names are env vars. */
const TOOL_NAME_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Read the tool names the handbook's §4.4 declares.
 *
 * §4.4 must contain exactly one **canonical tool table** — the one whose
 * header cell reads 「工具」. Every row of that table lists one grantable
 * tool in its first cell (a cell may hold several, e.g.
 * `` `wiki_search` / `wiki_read` ``).
 *
 * Anchoring on the header (rather than "any table in the section") keeps
 * unrelated tables out of the comparison by construction: the §4.4 参数规则
 * table has 「规则」 as its first header cell, so parameter names such as
 * `` `limit` `` / `` `order_by` `` never enter the comparison. Prose mentions
 * (e.g. the `sl_query` / `sl_read_source` absolute-deny note) are ignored
 * for the same reason — the canonical table is the single source of truth.
 */
export function readHandbookToolNames(markdown) {
  const lines = markdown.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^###\s+4\.4\s/.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    throw new ToolSurfaceError(
      `§4.4 可用工具面 section not found in ${HANDBOOK_PATH}; ` +
        `either the heading was renamed or the section was removed — ` +
        `update \`scripts/gates/handbook-tool-surface.mjs\` to match.`
    );
  }

  // Collect the §4.4 line range. The next H2 ends the section; `### ` and
  // `#### ` do NOT match `^## ` (third character is `#`, not a space), so
  // nested subsections stay inside.
  const sectionLines = [];
  let inFence = false;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^## /.test(line)) break;
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    sectionLines.push(trimmed);
  }

  // Find the canonical tool table: the first table whose header first cell
  // is exactly 「工具」.
  const tableHeaderRe = /^\|\s*工具\s*\|/;
  let names = null;
  for (let i = 0; i < sectionLines.length; i += 1) {
    const line = sectionLines[i];
    if (!/^\|.*\|$/.test(line)) continue;
    if (!tableHeaderRe.test(line)) continue;
    names = new Set();
    // Skip the header row and the separator row.
    for (let j = i + 2; j < sectionLines.length; j += 1) {
      const row = sectionLines[j];
      if (!/^\|.*\|$/.test(row)) break;
      const firstCell = row.replace(/^\|/, "").split("|")[0] ?? "";
      const tokenRe = /`([A-Za-z_][A-Za-z0-9_]*)`/g;
      let match;
      while ((match = tokenRe.exec(firstCell)) !== null) {
        const name = match[1];
        if (TOOL_NAME_RE.test(name)) names.add(name);
      }
    }
    break;
  }

  if (names === null) {
    throw new ToolSurfaceError(
      `no canonical tool table found in §4.4 可用工具面 of ${HANDBOOK_PATH}; ` +
        `expected a markdown table whose first header cell is 「工具」 and whose rows ` +
        `list one grantable tool per row.`
    );
  }
  return names;
}

/* ------------------------------------------------------------------ *
 * Parity check
 * ------------------------------------------------------------------ */

/**
 * Assert that the handbook's §4.4 tool list and the runtime registry are the
 * **same set**. Throws `ToolSurfaceError` listing both directions of drift.
 */
export function assertToolSurfaceParity(runtimeNames, handbookNames) {
  const missing = [...runtimeNames].filter((name) => !handbookNames.has(name)).sort();
  const extra = [...handbookNames].filter((name) => !runtimeNames.has(name)).sort();
  if (missing.length === 0 && extra.length === 0) {
    return runtimeNames.size;
  }
  const lines = [];
  if (missing.length > 0) {
    lines.push(
      `missing-in-handbook: ${missing.length} tool(s) are grantable at runtime but absent ` +
        `from §4.4 可用工具面 — add one row per tool to that section's tool table: ` +
        missing.join(", ")
    );
  }
  if (extra.length > 0) {
    lines.push(
      `unknown-in-runtime: ${extra.length} tool(s) are documented in §4.4 but not registered ` +
        `in the runtime tool registry — either fix the handbook row or register the tool: ` +
        extra.join(", ")
    );
  }
  throw new ToolSurfaceError(
    `${HANDBOOK_PATH} §4.4 tool list does not match the runtime tool registry:\n` +
      lines.map((l) => `  - ${l}`).join("\n") +
      `\nRuntime truth lives in ${ACL_PATH} (DATA_PLANE_TOOLS / META_TOOLS / CONTEXT_TOOLS) ` +
      `and ${CONTROL_PLANE_PATH} (CONTROL_PLANE_TOOLS).`
  );
}

/**
 * Read the repo files, run both sides, and return the shared tool count.
 */
export function runToolSurfaceCheck(root = ROOT) {
  const handbookPath = path.join(root, HANDBOOK_PATH);
  if (!existsSync(handbookPath)) {
    throw new ToolSurfaceError(
      `handbook not found at ${handbookPath}; expected \`${HANDBOOK_PATH}\` at repo root.`
    );
  }
  const runtimeNames = readRuntimeToolNames(root);
  const handbookNames = readHandbookToolNames(readFileSync(handbookPath, "utf8"));
  const count = assertToolSurfaceParity(runtimeNames, handbookNames);
  return { count, runtimeNames, handbookNames };
}

// 双边 realpath 比较：macOS 上 `process.argv[1]` 可能是软链路径（/tmp → /private/tmp），
// 直接比较会在软链调用时静默跳过执行块、退出码 0 却不报错 —— 门禁失效放行。
function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return path.resolve(entry) === self;
  }
}

if (isMainModule()) {
  try {
    const result = runToolSurfaceCheck();
    console.log(`[handbook-tool-surface] OK ${result.count} tools match §4.4 可用工具面`);
  } catch (error) {
    console.error("[handbook-tool-surface] FAIL");
    console.error(error.message);
    process.exitCode = 1;
  }
}
