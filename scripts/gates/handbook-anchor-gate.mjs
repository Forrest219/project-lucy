#!/usr/bin/env node
/**
 * Local gate for `docs/SYSTEM_HANDBOOK.md` (the Lucy user-manual SSOT).
 *
 * Two checks, both of them regressions that were previously found by hand:
 *
 *   1. **锚点有效性** — every `](#…)` link in the handbook must resolve to a
 *      real target. A target is valid when it is either
 *        - a sidebar section id produced by the server's `parseHelpToc()`
 *          (contract table first, `stableSlug()` fallback), or
 *        - a DOM anchor id of a heading (`#` … `######`) that the markdown
 *          renderer emits, i.e. `slugifyHeading()` of the heading text.
 *      Code fences are skipped: a `#` inside a fence is not a heading.
 *
 *   2. **TOC 可达性** — every `parseHelpToc()` entry must be reachable in the
 *      article body the WebUI actually renders: the leading preface (H1 +
 *      metadata table + optional hand-authored 「目录」 block) is stripped and
 *      the rest is split into sections. An entry without a matching heading
 *      is a dead sidebar link.
 *
 * The slug / contract / strip / split rules are *replicated* here so the gate
 * runs on plain Node (no `webui/node_modules` needed). The replicas are kept
 * honest by `scripts/gates/handbook-anchor-gate.test.mjs`, which diffs them
 * against the real TypeScript implementations (`webui/src/lib/wiki.ts`,
 * `webui/server/help.ts`) through `npx tsx`.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HANDBOOK_PATH = "docs/SYSTEM_HANDBOOK.md";
const HELP_SERVER_PATH = "webui/server/help.ts";

/**
 * Thrown when the handbook contains a dead `](#…)` link or a TOC entry that
 * cannot be reached. `name` is stable so callers can `instanceof` it (and so
 * log scrapers can grep for a stable prefix).
 */
export class HandbookAnchorError extends Error {
  constructor(message) {
    super(message);
    this.name = "HandbookAnchorError";
  }
}

/* ------------------------------------------------------------------ *
 * Contract table (`webui/server/help.ts` → `SECTION_ID_CONTRACT`)
 * ------------------------------------------------------------------ */

/**
 * Walk `text` from `openIdx` (which must point at `[`) and return the index of
 * the matching `]`. String literals are skipped so brackets inside titles do
 * not disturb the depth count.
 */
function findClosingBracket(text, openIdx) {
  let depth = 1;
  let i = openIdx + 1;
  while (i < text.length) {
    const c = text[i];
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
  throw new HandbookAnchorError(
    `unbalanced \`[\` while reading \`SECTION_ID_CONTRACT\` from ${HELP_SERVER_PATH}; ` +
      `the contract literal shape changed — update \`scripts/gates/handbook-anchor-gate.mjs\`.`
  );
}

/**
 * Read the `SECTION_ID_CONTRACT` map straight out of the **source** of
 * `webui/server/help.ts` instead of keeping a hand-copied duplicate here.
 * The literal is stable (one `["标题", "id"],` per line), so a scan of the
 * `new Map<string, string>([ ... ])` body is enough.
 */
export function extractSectionIdContract(sourceText) {
  const declIdx = sourceText.indexOf("SECTION_ID_CONTRACT");
  if (declIdx === -1) {
    throw new HandbookAnchorError(
      `could not locate \`SECTION_ID_CONTRACT\` in ${HELP_SERVER_PATH}; ` +
        `either the export was renamed or its shape changed — update ` +
        `\`scripts/gates/handbook-anchor-gate.mjs\` to match.`
    );
  }
  const mapIdx = sourceText.indexOf("new Map", declIdx);
  const openIdx = sourceText.indexOf("[", mapIdx === -1 ? declIdx : mapIdx);
  if (openIdx === -1) {
    throw new HandbookAnchorError(
      `could not locate the \`SECTION_ID_CONTRACT\` map literal in ${HELP_SERVER_PATH}; ` +
        `update \`scripts/gates/handbook-anchor-gate.mjs\` to match.`
    );
  }
  const closeIdx = findClosingBracket(sourceText, openIdx);
  const body = sourceText.slice(openIdx + 1, closeIdx);
  const contract = new Map();
  const entryRe = /\[\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]/g;
  let match;
  while ((match = entryRe.exec(body)) !== null) {
    contract.set(JSON.parse(`"${match[1]}"`), JSON.parse(`"${match[2]}"`));
  }
  if (contract.size === 0) {
    throw new HandbookAnchorError(
      `parsed 0 entries from \`SECTION_ID_CONTRACT\` in ${HELP_SERVER_PATH}; ` +
        `the contract literal shape changed — update \`scripts/gates/handbook-anchor-gate.mjs\`.`
    );
  }
  return contract;
}

/* ------------------------------------------------------------------ *
 * Slug rules (mirrors of `webui/server/help.ts` and `webui/src/lib/wiki.ts`)
 * ------------------------------------------------------------------ */

/** Mirror of `webui/server/help.ts` → `stableSlug()`. */
export function stableSlug(title) {
  const ascii = title
    .toLowerCase()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii) return ascii;
  return createHash("sha1").update(title).digest("hex").slice(0, 10);
}

/** Mirror of `webui/server/help.ts` → `cleanSectionTitle()`. */
export function cleanSectionTitle(title) {
  return title.replace(/^\d+(?:\.\d+)*\.?\s*/, "").trim();
}

/** Mirror of `webui/src/lib/wiki.ts` → `slugifyHeading()`. */
export function slugifyHeading(text) {
  return text
    .toLowerCase()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Mirror of `webui/src/lib/wiki.ts` → `ensureUniqueHeadingId()`. */
export function ensureUniqueHeadingId(base, taken) {
  let candidate = base || "section";
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  taken.add(candidate);
  return candidate;
}

/** Mirror of `webui/server/help.ts` → `sectionIdFor()` (contract first). */
export function sectionIdFor(title, contract) {
  const cleanTitle = cleanSectionTitle(title);
  return contract.get(cleanTitle) ?? stableSlug(cleanTitle);
}

/* ------------------------------------------------------------------ *
 * TOC parsing (mirror of `webui/server/help.ts` → `parseHelpToc()`)
 * ------------------------------------------------------------------ */

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^```/;
const TOC_EXCLUDE_MARKER = "<!-- toc:exclude -->";

function dedupeId(base, used) {
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

/**
 * Mirror of `webui/server/help.ts` → `parseHelpToc()`. H2–H4 enter the TOC;
 * `<!-- toc:exclude -->` only affects the immediately following line; id
 * collisions get a `-2` / `-3` suffix.
 */
export function parseHelpToc(markdown, contract) {
  const used = new Map();
  const items = [];
  let inFence = false;
  let excludeNextHeading = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE_RE.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.trim() === TOC_EXCLUDE_MARKER) {
      excludeNextHeading = true;
      continue;
    }
    const match = line.match(HEADING_RE);
    if (!match) {
      excludeNextHeading = false;
      continue;
    }
    const rawLevel = match?.[1]?.length ?? 1;
    const title = (match?.[2] ?? "").trim();
    if (excludeNextHeading) {
      excludeNextHeading = false;
      continue;
    }
    if (rawLevel < 2 || rawLevel > 4) continue;
    items.push({
      id: dedupeId(sectionIdFor(title, contract), used),
      level: rawLevel,
      title
    });
  }
  return items;
}

/* ------------------------------------------------------------------ *
 * Front-end body pipeline (mirrors of `webui/src/pages/HelpCenter.tsx`)
 * ------------------------------------------------------------------ */

/** Mirror of `HelpCenter.tsx` → `isHelpTableSeparatorLine()`. */
function isHelpTableSeparatorLine(line) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  if (!inner) return false;
  return inner
    .split("|")
    .map((cell) => cell.trim())
    .every((cell) => /^:?-{3,}:?$/.test(cell));
}

/** Mirror of `HelpCenter.tsx` → `isHelpPeerHeading()` (H2 / H3). */
function isHelpPeerHeading(line) {
  return /^#{2,3}\s+\S/.test(line);
}

/**
 * Mirror of `HelpCenter.tsx` → `stripLeadingHandbookPreface()`: drop the
 * leading H1, the metadata pipe table right after it and the optional
 * hand-authored 「目录」 block (which ends at the next H2 / H3).
 */
export function stripLeadingHandbookPreface(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  if (i >= lines.length || !/^#\s+/.test(lines[i] ?? "")) return markdown;
  i++;

  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;

  if (i + 1 >= lines.length) return markdown;
  const headerLine = lines[i] ?? "";
  const separatorLine = lines[i + 1] ?? "";
  if (!headerLine.includes("|") || !isHelpTableSeparatorLine(separatorLine)) return markdown;

  i += 2;
  while (i < lines.length && (lines[i] ?? "").trim() !== "") {
    if (!(lines[i] ?? "").includes("|")) break;
    i++;
  }

  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;

  if (/^##\s+目录\s*#*\s*$/.test(lines[i] ?? "")) {
    i++;
    while (i < lines.length && !isHelpPeerHeading(lines[i] ?? "")) i++;
    while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  }

  return lines.slice(i).join("\n");
}

/**
 * Mirror of `HelpCenter.tsx` → `headingMatchesOutsideFences()`: the H2–H4
 * headings of the rendered body. H4 only counts when the title is a TOC
 * title (H5+ never become section boundaries).
 */
export function headingMatchesOutsideFences(markdown, toc) {
  const matches = [];
  const tocTitles = new Set(toc.map((item) => item.title));
  let offset = 0;
  let inFence = false;
  for (const line of markdown.split(/(\r?\n)/)) {
    if (line === "\n" || line === "\r\n") {
      offset += line.length;
      continue;
    }
    const trimmed = line.trim();
    if (FENCE_RE.test(trimmed)) {
      inFence = !inFence;
    } else if (!inFence) {
      const heading = line.match(/^(#{2,4})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        const level = heading[1]?.length ?? 2;
        const title = (heading[2] ?? "").trim();
        if (level > 3 && !tocTitles.has(title)) {
          offset += line.length;
          continue;
        }
        matches.push({ index: offset, level, title });
      }
    }
    offset += line.length;
  }
  return matches;
}

/**
 * Mirror of `HelpCenter.tsx` → `splitIntoSections()`: the sections the WebUI
 * renders. `id` is the TOC id of the section, or `section-<index>` when the
 * heading has no TOC entry.
 */
export function splitIntoSections(markdown, toc) {
  if (toc.length === 0) {
    return [{ id: "system-overview", markdown }];
  }

  const headingToItem = new Map(toc.map((item) => [item.title, item]));
  const matches = headingMatchesOutsideFences(markdown, toc);
  const sections = [];

  const firstHeading = matches[0];
  if (firstHeading?.index && firstHeading.index > 0) {
    const preface = markdown.slice(0, firstHeading.index).replace(/^#\s+.+(?:\r?\n)?/, "").trim();
    if (preface) {
      sections.push({ id: "handbook-title", markdown: preface });
    }
  }

  matches.forEach((match, index) => {
    const item = headingToItem.get(match.title);
    const start = match.index;
    const end = matches[index + 1]?.index ?? markdown.length;
    sections.push({
      id: item?.id ?? `section-${index}`,
      tocItem: item,
      markdown: markdown.slice(start, end).trim()
    });
  });

  return sections.filter((section) => section.markdown.length > 0);
}

/* ------------------------------------------------------------------ *
 * Handbook scanning
 * ------------------------------------------------------------------ */

/**
 * Collect every heading of the handbook that is rendered as a DOM heading:
 * `#` … `######`, outside code fences. `anchor` is the id the markdown
 * renderer puts on the element (`slugifyHeading` + uniqueness suffix).
 */
export function collectHeadingAnchors(markdown) {
  const headings = [];
  const taken = new Set();
  let inFence = false;
  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (FENCE_RE.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (!match) continue;
    const level = match[1].length;
    const text = (match[2] ?? "").trim();
    const anchor = ensureUniqueHeadingId(slugifyHeading(text), taken);
    headings.push({ line: index + 1, level, text, title: text, anchor });
  }
  return headings;
}

/**
 * Collect every `](#…)` link of the handbook with the line it lives on.
 * Links inside code fences are not rendered as links and are skipped.
 */
export function collectAnchorLinks(markdown) {
  const links = [];
  const linkRe = /\[([^\]]*)\]\(#([^)]*)\)/g;
  let inFence = false;
  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (FENCE_RE.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const match of line.matchAll(linkRe)) {
      links.push({ line: index + 1, label: match[1], target: match[2] });
    }
  }
  return links;
}

/* ------------------------------------------------------------------ *
 * Checks
 * ------------------------------------------------------------------ */

/**
 * Run both checks over one handbook. Returns the raw material so callers
 * (and tests) can inspect it; `issues` is the list of human readable
 * failures (empty when the handbook is healthy).
 */
export function checkHandbookAnchors({ markdown, contract, handbookPath = HANDBOOK_PATH }) {
  const toc = parseHelpToc(markdown, contract);
  const headings = collectHeadingAnchors(markdown);
  const links = collectAnchorLinks(markdown);

  // Valid targets: sidebar section ids ∪ rendered heading anchors.
  const validTargets = new Set(toc.map((item) => item.id));
  for (const heading of headings) {
    validTargets.add(heading.anchor);
  }

  const deadLinks = links.filter((link) => !validTargets.has(link.target));

  // TOC reachability: the article body the WebUI renders is the handbook
  // without its leading preface, split into sections.
  const bodyMarkdown = stripLeadingHandbookPreface(markdown);
  const sections = splitIntoSections(bodyMarkdown, toc);
  const bodyTitles = new Set(headingMatchesOutsideFences(bodyMarkdown, toc).map((m) => m.title));
  const renderedIds = new Set(sections.map((section) => section.id));
  const unreachableEntries = toc.filter(
    (item) => !bodyTitles.has(item.title) || !renderedIds.has(item.id)
  );

  const issues = [
    ...formatDeadLinks(deadLinks, handbookPath),
    ...formatUnreachableEntries(unreachableEntries, handbookPath)
  ];

  return {
    toc,
    headings,
    links,
    validTargets,
    deadLinks,
    sections,
    unreachableEntries,
    issues
  };
}

/** Human readable rendering of the dead `](#…)` links. */
export function formatDeadLinks(deadLinks, handbookPath = HANDBOOK_PATH) {
  if (deadLinks.length === 0) return [];
  return [
    `dead-anchor: ${deadLinks.length} link(s) in ${handbookPath} point at a non-existent anchor:`,
    ...deadLinks.map(
      (link) =>
        `  - line ${link.line}: ](#${link.target})` +
        (link.label ? `  — label "${link.label}"` : "") +
        `  (not a section id and not a heading anchor)`
    )
  ];
}

/** Human readable rendering of the unreachable TOC entries. */
export function formatUnreachableEntries(unreachableEntries, handbookPath = HANDBOOK_PATH) {
  if (unreachableEntries.length === 0) return [];
  return [
    `unreachable-toc: ${unreachableEntries.length} sidebar entr(y/ies) in ${handbookPath} have no reachable section:`,
    ...unreachableEntries.map(
      (item) =>
        `  - "${item.title}" (id: ${item.id}, level: H${item.level})` +
        `  — no matching heading in the rendered body (preface stripped → sectioned)`
    )
  ];
}

/**
 * Throw when the handbook has a dead anchor link. Kept separate from
 * `assertTocReachable()` so each check can be asserted on its own.
 */
export function assertNoDeadAnchors(deadLinks, handbookPath = HANDBOOK_PATH) {
  const issues = formatDeadLinks(deadLinks, handbookPath);
  if (issues.length > 0) {
    throw new HandbookAnchorError(issues.join("\n"));
  }
  return deadLinks.length;
}

/** Throw when a TOC entry cannot be reached in the rendered body. */
export function assertTocReachable(unreachableEntries, handbookPath = HANDBOOK_PATH) {
  const issues = formatUnreachableEntries(unreachableEntries, handbookPath);
  if (issues.length > 0) {
    throw new HandbookAnchorError(issues.join("\n"));
  }
  return unreachableEntries.length;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Read the real repo files, run both checks and return a summary. Throws
 * `HandbookAnchorError` when the handbook is unhealthy.
 */
export function runHandbookAnchorGate(root = ROOT) {
  const handbookPath = path.join(root, HANDBOOK_PATH);
  const helpPath = path.join(root, HELP_SERVER_PATH);
  if (!existsSync(handbookPath)) {
    throw new Error(
      `handbook not found at ${handbookPath}; expected \`${HANDBOOK_PATH}\` at repo root.`
    );
  }
  if (!existsSync(helpPath)) {
    throw new Error(
      `help server source not found at ${helpPath}; expected \`${HELP_SERVER_PATH}\` at repo root.`
    );
  }
  const markdown = readFileSync(handbookPath, "utf8");
  const contract = extractSectionIdContract(readFileSync(helpPath, "utf8"));
  const result = checkHandbookAnchors({ markdown, contract, handbookPath: HANDBOOK_PATH });
  if (result.issues.length > 0) {
    throw new HandbookAnchorError(
      `${result.issues.length} issue(s) found in ${HANDBOOK_PATH}:\n${result.issues.join("\n")}\n` +
        `Fix the handbook (preferred) or update \`${HELP_SERVER_PATH}\` / \`webui/src/lib/wiki.ts\` ` +
        `when the slug rules themselves changed.`
    );
  }
  return {
    ...result,
    contractSize: contract.size
  };
}

/**
 * True when this module is the process entry point. Both sides are resolved
 * through `realpath` so a symlinked checkout / temp dir does not silently
 * skip the CLI block.
 */
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
    const result = runHandbookAnchorGate();
    console.log(
      `[handbook-anchor-gate] OK ${result.links.length} anchor links · ` +
        `${result.toc.length} TOC sections · ${result.headings.length} headings · ` +
        `${result.contractSize} contract ids`
    );
  } catch (error) {
    console.error("[handbook-anchor-gate] FAIL");
    console.error(error.message);
    process.exitCode = 1;
  }
}
