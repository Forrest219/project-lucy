#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NAV_PATH = "webui/src/app/navigation.ts";
const HANDBOOK_PATH = "docs/SYSTEM_HANDBOOK.md";

/**
 * Thrown when at least one sidebar entry has no corresponding section / FAQ line /
 * §1.5 entry-map row in `docs/SYSTEM_HANDBOOK.md`. Carries the same `name` so callers
 * can `instanceof CoverageError` (also surfaces as a stable prefix for log scrapers).
 */
export class CoverageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CoverageError";
  }
}

/**
 * Walk `text` from `openIdx` (which must point at `openChar`) and return the index
 * *after* the matching `closeChar`. Skips over JS/TS string literals (single, double,
 * and template quotes), line comments, and block comments so braces inside them don't
 * disturb depth tracking.
 */
function findBalanced(text, openIdx, openChar, closeChar) {
  let depth = 1;
  let i = openIdx + 1;
  const n = text.length;
  while (i < n && depth > 0) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          i++;
          break;
        }
        i++;
      }
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < n - 1 && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else if (c === openChar) {
      depth++;
      i++;
    } else if (c === closeChar) {
      depth--;
      i++;
    } else {
      i++;
    }
  }
  return i;
}

/**
 * Build a map `identifier → { id, label, to }` for every `export const X: NavItem = { ... }`
 * declaration in the file. Used to dereference identifiers that `navGroups.items` references
 * (e.g. `topLevelEntry`) back to their full NavItem shape.
 */
function indexNavItemDeclarations(text) {
  const byIdent = new Map();
  const declRe = /(?:export\s+)?const\s+(\w+)\s*:\s*NavItem\s*=\s*\{/g;
  let m;
  while ((m = declRe.exec(text)) !== null) {
    const ident = m[1];
    const openBraceIdx = declRe.lastIndex - 1;
    const closeIdx = findBalanced(text, openBraceIdx, "{", "}");
    const body = text.slice(openBraceIdx, closeIdx);
    const idM = body.match(/(^|\s)id:\s*"([^"]+)"/);
    const labelM = body.match(/(^|\s)label:\s*"([^"]+)"/);
    const toM = body.match(/(^|\s)to:\s*"([^"]+)"/);
    if (idM && labelM && toM) {
      byIdent.set(ident, { id: idM[2], label: labelM[2], to: toM[2] });
    }
  }
  return byIdent;
}

/**
 * Locate `export const NAME ... = [` (or `const NAME = [`) in `text` and return the
 * array literal text including the enclosing brackets. Returns `null` if not found.
 */
function extractArrayLiteral(text, name) {
  const re = new RegExp(`(?:export\\s+)?const\\s+${name}\\b[\\s\\S]*?=\\s*\\[`, "g");
  const m = re.exec(text);
  if (!m) return null;
  const openBracketIdx = m.index + m[0].length - 1;
  const closeIdx = findBalanced(text, openBracketIdx, "[", "]");
  return text.slice(openBracketIdx, closeIdx);
}

function parseTableRow(line) {
  const trimmed = line.replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

/**
 * Walk an `items: [ ... ]` body. Each top-level entry is either:
 *   - an inline object literal `{ id, label, to, ... }` — parsed directly, OR
 *   - an identifier reference (e.g. `topLevelEntry`) — looked up in `byIdent`.
 * Throws if an identifier reference cannot be resolved.
 */
function walkItemsArray(itemsInner, byIdent, sourceLabel) {
  const items = [];
  let i = 0;
  const n = itemsInner.length;
  while (i < n) {
    while (i < n && /[\s,]/.test(itemsInner[i])) i++;
    if (i >= n) break;
    // Skip line comments at top level of items array so mid-array `//` notes
    // aren't mistaken for an identifier reference (e.g. `// v1.9.0: 连通测试…`).
    if (itemsInner[i] === "/" && itemsInner[i + 1] === "/") {
      while (i < n && itemsInner[i] !== "\n") i++;
      continue;
    }
    // Skip block comments at top level.
    if (itemsInner[i] === "/" && itemsInner[i + 1] === "*") {
      i += 2;
      while (i < n - 1 && !(itemsInner[i] === "*" && itemsInner[i + 1] === "/")) i++;
      i = Math.min(n, i + 2);
      continue;
    }
    const c = itemsInner[i];
    if (c === "{") {
      const openIdx = i;
      const closeIdx = findBalanced(itemsInner, openIdx, "{", "}");
      const objText = itemsInner.slice(openIdx, closeIdx);
      const idM = objText.match(/(^|\s)id:\s*"([^"]+)"/);
      const labelM = objText.match(/(^|\s)label:\s*"([^"]+)"/);
      const toM = objText.match(/(^|\s)to:\s*"([^"]+)"/);
      if (idM && labelM && toM) {
        items.push({ id: idM[2], label: labelM[2], to: toM[2] });
      } else {
        throw new Error(
          `inline object in ${sourceLabel} items array is missing one of id/label/to; cannot lint coverage. ` +
          `Object excerpt: ${objText.slice(0, 80)}…`
        );
      }
      i = closeIdx;
    } else if (/[a-zA-Z_$]/.test(c)) {
      const start = i;
      while (i < n && /[a-zA-Z_$0-9]/.test(itemsInner[i])) i++;
      const ident = itemsInner.slice(start, i);
      const found = byIdent.get(ident);
      if (!found) {
        throw new Error(
          `could not resolve item reference "${ident}" in ${sourceLabel} items; ` +
            `ensure "export const ${ident}: NavItem = { ... }" exists at top-level of the nav source file.`
        );
      }
      items.push(found);
    } else {
      i++;
    }
  }
  return items;
}

/**
 * Parse `webui/src/app/navigation.ts` and return an ordered, flat list of
 * `{ id, label, to, groupId, groupTitle }` entries — one per actual sidebar
 * item visible in the WebUI (including reference-resolved entries such as
 * `topLevelEntry`). The order matches the file's `navGroups` order.
 */
export function readNavEntries(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(
      `navigation source not found at ${filePath}; expected \`${NAV_PATH}\` at repo root. ` +
        `Restore the file, then re-run \`npm run lint:handbook-coverage\`.`
    );
  }
  const text = readFileSync(filePath, "utf8");
  const byIdent = indexNavItemDeclarations(text);
  const arrayText = extractArrayLiteral(text, "navGroups");
  if (arrayText === null) {
    throw new Error(
      `could not locate \`export const navGroups ... = [ ... ]\` array literal in ${filePath}. ` +
        `Either the export was renamed or its shape changed; update \`scripts/gates/handbook-coverage.mjs\` to match.`
    );
  }
  const inner = arrayText.slice(1, -1);
  const groups = [];
  let i = 0;
  const n = inner.length;
  while (i < n) {
    while (i < n && /[\s,]/.test(inner[i])) i++;
    if (i >= n) break;
    if (inner[i] !== "{") {
      i++;
      continue;
    }
    const openIdx = i;
    const closeIdx = findBalanced(inner, openIdx, "{", "}");
    const groupText = inner.slice(openIdx, closeIdx);
    const idM = groupText.match(/(^|\s)id:\s*"([^"]+)"/);
    const titleM = groupText.match(/(^|\s)title:\s*"([^"]+)"/);
    const itemsKeyIdx = groupText.indexOf("items:");
    if (idM && titleM && itemsKeyIdx !== -1) {
      const itemsOpen = groupText.indexOf("[", itemsKeyIdx);
      if (itemsOpen !== -1) {
        const itemsClose = findBalanced(groupText, itemsOpen, "[", "]");
        const itemsInner = groupText.slice(itemsOpen + 1, itemsClose - 1);
        const items = walkItemsArray(itemsInner, byIdent, `${path.basename(filePath)} group "${idM[2]}"`);
        groups.push({ id: idM[2], title: titleM[2], items });
      }
    }
    i = closeIdx;
  }
  if (groups.length === 0) {
    throw new Error(
      `parsed 0 groups from ${filePath}; \`navGroups\` may be malformed. ` +
        `If you renamed the export or restructured the array, update the parser.`
    );
  }
  const navEntries = [];
  for (const g of groups) {
    for (const item of g.items) {
      if (navEntries.some((e) => e.id === item.id)) {
        throw new Error(
          `duplicate nav id "${item.id}" detected across groups; cannot lint coverage. ` +
            `Each sidebar item id must be unique.`
        );
      }
      navEntries.push({
        id: item.id,
        label: item.label,
        to: item.to,
        groupId: g.id,
        groupTitle: g.title
      });
    }
  }
  return navEntries;
}

/**
 * Extract every `[label](#anchor)` link that appears in the handbook's `## 目录`
 * (TOC) section, stopping at the next `##` heading. Returns `[{ anchor, label }]`.
 * Does NOT include the bullets before §1; those are deep-link anchors, not
 * sidebar entries — we don't lint them.
 */
export function parseHandbookSectionAnchors(markdown) {
  const anchors = [];
  const lines = markdown.split("\n");
  let inToc = false;
  const linkRe = /\[([^\]]+)\]\(#([^)]+)\)/g;
  for (const line of lines) {
    // `## 目录` is followed by Chinese chars; `\b` is unreliable on non-ASCII
    // headings, so anchor on `## 目录` literally and stop at the next `## `.
    if (line.startsWith("## 目录")) {
      inToc = true;
      continue;
    }
    if (inToc) {
      if (/^## /.test(line)) break;
      let m;
      while ((m = linkRe.exec(line)) !== null) {
        anchors.push({ anchor: m[2], label: m[1] });
      }
    }
  }
  return anchors;
}

/**
 * Parse the `### 1.5 WebUI 入口速查` markdown table and return the set of
 * sidebar-entry route strings listed in its `路径` column. Backticked cells
 * like `` `/admin/usage` `` are normalised to `/admin/usage`.
 */
export function parseSection15Paths(markdown) {
  const lines = markdown.split("\n");
  let inSection = false;
  const tableLines = [];
  for (const line of lines) {
    if (/^### 1\.5 /.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (/^### /.test(line) || /^## /.test(line)) break;
      if (/^\|.*\|$/.test(line)) tableLines.push(line);
    }
  }
  if (tableLines.length < 3) {
    throw new Error(
      `§1.5 WebUI 入口速查 table not found in ${HANDBOOK_PATH}; expected a header row, ` +
        `a separator row, and at least one data row. Restore the table or update the parser.`
    );
  }
  const headerCells = parseTableRow(tableLines[0]);
  const pathColIdx = headerCells.findIndex((h) => h === "路径");
  if (pathColIdx === -1) {
    throw new Error(
      `§1.5 WebUI 入口速查 table in ${HANDBOOK_PATH} has no \`路径\` column; ` +
        `either restore it or rename the column header to match.`
    );
  }
  const paths = new Set();
  for (let i = 2; i < tableLines.length; i++) {
    const cells = parseTableRow(tableLines[i]);
    const cell = cells[pathColIdx];
    if (cell) {
      const cleaned = cell.replace(/`/g, "").trim();
      if (cleaned.startsWith("/")) paths.add(cleaned);
    }
  }
  return paths;
}

/**
 * For each nav `to` path, scan the handbook body and return a Map<to, lineNumbers[]>
 * listing every line that contains the path as a substring. Used as the
 * "broad coverage" check (passes as long as the path appears at least once
 * anywhere in the handbook outside the §1.5 table).
 */
export function findHandbookSectionReferences(markdown, toKeys) {
  const lines = markdown.split("\n");
  const hits = new Map();
  for (const to of toKeys) hits.set(to, []);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const to of toKeys) {
      if (to.length >= 4 && line.includes(to)) {
        hits.get(to).push(i + 1);
      }
    }
  }
  return hits;
}

/**
 * Return the set of nav `to` paths that appear as a literal substring inside
 * `## 0. 常见问题速查` (and its sub-sections). Used as the FAQ-reference check.
 */
export function findFaqSectionReferences(markdown, toKeys) {
  const lines = markdown.split("\n");
  let inSection = false;
  const foundInFaq = new Set();
  for (const line of lines) {
    if (/^## 0\. /.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (/^## /.test(line)) break;
      for (const to of toKeys) {
        if (to.length >= 4 && line.includes(to)) foundInFaq.add(to);
      }
    }
  }
  return foundInFaq;
}

/**
 * Verify that every nav entry satisfies at least one of the three coverage criteria:
 *   A. `to` is listed in the §1.5 入口速查 table (authoritative sidebar-map).
 *   B. `to` appears as a literal in the handbook body (broad-coverage).
 *   C. `to` appears inside §0 常见问题速查 (FAQ-citation).
 * Throws `CoverageError` listing every entry that fails all three.
 */
export function assertCoverage(navEntries, section15Paths, faqPaths, handbookPathHits) {
  const missing = [];
  for (const entry of navEntries) {
    const in15 = section15Paths.has(entry.to);
    const inFaq = faqPaths.has(entry.to);
    const inBody = (handbookPathHits.get(entry.to) || []).length > 0;
    if (!in15 && !inFaq && !inBody) {
      missing.push(entry);
    }
  }
  if (missing.length > 0) {
    const detailLines = missing.map((m) => {
      return (
        `missing-section: navigation entry "${m.label}" (${m.to}) (group: ${m.groupTitle}) ` +
        `has no corresponding handbook coverage. ` +
        `Add ONE of: ` +
        `(A) a row to §1.5 WebUI 入口速查 (路径: ${m.to}); ` +
        `(B) any §3.x section that mentions ${m.to} in body text; ` +
        `(C) a §0.x 常见问题速查 row that references ${m.to}.`
      );
    });
    throw new CoverageError(
      `${missing.length} sidebar entr${missing.length === 1 ? "y" : "ies"} lack handbook coverage in ${HANDBOOK_PATH}:\n` +
        detailLines.map((d) => `  - ${d}`).join("\n") +
        `\nFix by editing ${HANDBOOK_PATH} (preferred: add to §1.5 WebUI 入口速查) or by updating ` +
        `${NAV_PATH} so its routes align with the documented sections.`
    );
  }
  return navEntries.length;
}

/**
 * Top-level entry point: read the real repo files, run all four phases, and
 * return `{ covered, navEntries }`. Throws on any parse / coverage failure so
 * the executable entry below can convert errors into a non-zero exit code.
 */
export function runHandbookCoverage(root = ROOT) {
  const navPath = path.join(root, NAV_PATH);
  const handbookPath = path.join(root, HANDBOOK_PATH);
  if (!existsSync(handbookPath)) {
    throw new Error(
      `handbook not found at ${handbookPath}; expected \`${HANDBOOK_PATH}\` at repo root.`
    );
  }
  const navEntries = readNavEntries(navPath);
  const handbookMd = readFileSync(handbookPath, "utf8");
  const section15Paths = parseSection15Paths(handbookMd);
  parseHandbookSectionAnchors(handbookMd); // parsed eagerly to surface TOC drift early
  const toKeys = navEntries.map((e) => e.to);
  const faqPaths = findFaqSectionReferences(handbookMd, toKeys);
  const handbookPathHits = findHandbookSectionReferences(handbookMd, toKeys);
  const covered = assertCoverage(navEntries, section15Paths, faqPaths, handbookPathHits);
  return { covered, navEntries };
}

// 双边 realpath 比较：macOS 上 `process.argv[1]` 可能是软链路径（/tmp → /private/tmp），
// 直接比较会在软链调用时静默跳过执行块、退出码 0 却不报错 —— 门禁失效放行。
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const result = runHandbookCoverage();
    console.log(`[handbook-coverage] OK ${result.covered} nav entries covered`);
  } catch (error) {
    console.error("[handbook-coverage] FAIL");
    if (error instanceof CoverageError) {
      console.error(error.message);
    } else {
      console.error(error.message);
    }
    process.exitCode = 1;
  }
}
