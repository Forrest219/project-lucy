#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webuiRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webuiRoot, "..");

const forbiddenTerms = [
  "财政部舱单",
  "舱单",
  "替代测试",
  "上传报价包",
  "添加架构",
  "目标架构",
  "模式清单",
  "重新加载资产",
];

const hardFailDirs = process.env.LINT_TARGET_DIR
  ? [path.resolve(process.env.LINT_TARGET_DIR)]
  : [path.join(webuiRoot, "src"), path.join(webuiRoot, "server")];

const documentationDirs = [
  path.join(webuiRoot, "docs"),
];

const fileExtensions = new Set([".ts", ".tsx", ".md", ".html"]);

const ignoredPathParts = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".vite",
]);

const docAllowancePatterns = [
  /禁止/,
  /禁用/,
  /Forbidden/i,
  /反例/,
  /错误/,
  /误译/,
  /错译/,
  /不得/,
  /不使用/,
  /不再/,
  /不要/,
  /不应/,
  /删除所有机器翻译幻觉/,
  /禁止文案/,
  /禁止项/,
  /典型禁止项/,
  /被显示为/,
  /显示为/,
  /语义不清/,
  /统一改为/,
  /Replace user-facing/i,
  /has no/i,
  /not `/i,
  /缺失 Manifest/,
  /上传资产包/,
  /连通测试/,
  /添加 Schema/,
  /目标 Schema/,
  /刷新本地目录/,
  /queryBy/,
  /not\.toBe/,
  /not\.toContain/,
  /No user-facing/i,
  /Do not/i,
  /防回归/,
  /guard/i,
];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if ([...ignoredPathParts].some((part) => absolute.split(path.sep).includes(part))) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...walk(absolute));
    } else if (entry.isFile() && fileExtensions.has(path.extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files;
}

function isTestOrTerminologyFixture(file) {
  const normalized = file.split(path.sep).join("/");
  return (
    normalized.includes("/__tests__/") ||
    /\.test\.[tj]sx?$/.test(file) ||
    normalized.endsWith("/forbidden-terms.ts")
  );
}

function isAllowedDocumentationContext(lines, index) {
  const start = Math.max(0, index - 8);
  const end = Math.min(lines.length, index + 9);
  const context = lines.slice(start, end).join("\n");
  return docAllowancePatterns.some((pattern) => pattern.test(context));
}

function scanForbiddenTerms(file, mode) {
  const content = readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  const issues = [];

  lines.forEach((line, index) => {
    for (const term of forbiddenTerms) {
      if (!line.includes(term)) continue;
      if (mode === "docs" && isAllowedDocumentationContext(lines, index)) continue;
      issues.push({
        file,
        line: index + 1,
        term,
        text: line.trim(),
      });
    }
  });

  return issues;
}

// ─── Translation-defense scanner (M21 P0) ───────────────────────────────────────
//
// The connection module is full of code-like identifiers (Schema, Manifest,
// Catalog, ktx.yaml, .yaml, ktx connection test, etc.) that browser
// translation plugins love to mangle. Every JSX element that renders one of
// these terms to the user MUST defend itself with both:
//   - `translate="no"` HTML attribute (modern browsers), and
//   - `className="notranslate"` (legacy Google Translate extension fallback)
// Anything else regresses the M21 fixes.
//
// We deliberately only check `.tsx` files (where JSX lives). Code identifiers
// inside `.ts` files, server files, and tests are out of scope — they
// surface through the JSX layer where the user actually sees them.

const highRiskTerms = [
  // Original M21 P0 terms
  /\bSchema\b/,
  /\bschema\b/,
  /\bManifest\b/,
  /\bmanifest\b/,
  /\bCatalog\b/,
  /ktx\.yaml/,
  /ktx connection test/,
  /ktx ingest/,
  /enabled_tables/,
  /semantic-layer/,
  /\.ya?ml\b/,
  // M39 polish: spec §11 red-line terms. These are professional
  // English nouns that browser translation plugins love to mangle
  // when they appear as user-facing copy. Every JSX node that
  // renders one of these MUST defend itself with both
  // `translate="no"` and `className="notranslate"`.
  /\bMCP\b/,
  /\bKTX\b/,
  /\bAgent\b/,
  /\bEndpoint\b/,
  /\bToken\b/,
  /\bRuntime\b/,
  /Eval Run/
];

const userFacingAttributeNames = ["aria-label", "placeholder", "title"];

const translationDefenseDirs = process.env.LINT_TARGET_DIR
  ? [path.resolve(process.env.LINT_TARGET_DIR)]
  : [path.join(webuiRoot, "src")];

const translationDefenseFiles = existingDirs(translationDefenseDirs)
  .flatMap(walk)
  .filter((file) => file.endsWith(".tsx"))
  .filter((file) => !isTestOrTerminologyFixture(file));

function findLeafTexts(body) {
  // Walk the body and collect only the literal text segments that sit at this
  // element's direct text level (i.e. between this element's own opening/closing
  // tags, NOT inside any nested child element or expression).
  const leaves = [];
  let buffer = "";
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "{") {
      if (buffer.trim()) leaves.push(buffer);
      buffer = "";
      depth = 1;
      i += 1;
      while (i < body.length && depth > 0) {
        const c = body[i];
        if (c === "{") depth += 1;
        else if (c === "}") depth -= 1;
        i += 1;
      }
      continue;
    }
    if (ch === "<" && /[A-Za-z/]/.test(body[i + 1] || "")) {
      if (buffer.trim()) leaves.push(buffer);
      buffer = "";
      // Skip until the matching close tag at the same depth. We only need to
      // step past one nesting level here because we don't recurse.
      let tagDepth = 1;
      i += 1;
      while (i < body.length && tagDepth > 0) {
        const c = body[i];
        if (c === "<" && /[A-Za-z]/.test(body[i + 1] || "")) tagDepth += 1;
        else if (c === "<" && body[i + 1] === "/") tagDepth -= 1;
        i += 1;
      }
      continue;
    }
    buffer += ch;
    i += 1;
  }
  if (buffer.trim()) leaves.push(buffer);
  return leaves;
}

function findHighRiskHits(text) {
  const hits = [];
  for (const pattern of highRiskTerms) {
    const match = text.match(pattern);
    if (match) {
      hits.push({ pattern: pattern.source, snippet: match[0] });
    }
  }
  return hits;
}

function hasTranslationDefense(attributes) {
  return /translate\s*=\s*["']no["']/.test(attributes) && /notranslate/.test(attributes);
}

function findHighRiskAttributeHits(attributes) {
  const hits = [];
  for (const name of userFacingAttributeNames) {
    const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*\`([\\s\\S]*?)\`\\s*\\})`, "g");
    let match;
    while ((match = pattern.exec(attributes)) !== null) {
      const value = match[1] ?? match[2] ?? match[3] ?? "";
      for (const hit of findHighRiskHits(value)) {
        hits.push({ ...hit, attribute: name });
      }
    }
  }
  return hits;
}

function scanTranslationDefense(file) {
  const content = readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  const issues = [];

  // Hand-rolled JSX element scanner. We track brace depth so `>` characters
  // inside {...} expressions (e.g. arrow functions in onClick, ternary
  // expressions in className) are not treated as the end of the opening tag.
  let i = 0;
  while (i < content.length) {
    const ltIdx = content.indexOf("<", i);
    if (ltIdx === -1) break;
    const next = content[ltIdx + 1] ?? "";
    if (!/[A-Za-z]/.test(next)) {
      i = ltIdx + 1;
      continue;
    }

    // Parse the opening tag.
    const tagMatch = /^<([A-Za-z][A-Za-z0-9]*)\b/.exec(content.slice(ltIdx));
    if (!tagMatch) {
      i = ltIdx + 1;
      continue;
    }
    const tagName = tagMatch[1];
    const openStart = ltIdx + 1 + tagName.length;
    const openEnd = findOpeningTagEnd(content, openStart);
    if (openEnd === -1) {
      i = ltIdx + 1;
      continue;
    }
    const attributes = content.slice(openStart, openEnd);
    const attributeHits = findHighRiskAttributeHits(attributes);
    if (attributeHits.length > 0 && !hasTranslationDefense(attributes)) {
      const upTo = content.slice(0, ltIdx);
      const lineNumber = upTo.split("\n").length;
      issues.push({
        file,
        line: lineNumber,
        tag: tagName,
        hits: attributeHits,
        text: lines[lineNumber - 1]?.trim() ?? attributes.slice(0, 80)
      });
    }

    // Self-closing tag: nothing to defend.
    if (content[openEnd - 1] === "/") {
      i = openEnd + 1;
      continue;
    }

    // Find the matching closing tag at the same depth.
    const closeStart = findMatchingClose(content, openEnd + 1, tagName);
    if (closeStart === -1) {
      // Probably not a real JSX element (e.g. a TypeScript generic like
      // `useState<Step>("input")`); advance by one character instead of
      // jumping past the opening tag, so we don't accidentally skip a real
      // JSX element that follows.
      i = ltIdx + 1;
      continue;
    }
    const body = content.slice(openEnd + 1, closeStart);
    const leafTexts = findLeafTexts(body);
    if (leafTexts.length === 0) {
      // Container element with no direct text — descend into the body so we
      // can audit the inner elements too.
      i = openEnd + 1;
      continue;
    }
    const hits = findHighRiskHits(leafTexts.join(" "));
    if (hits.length > 0 && !hasTranslationDefense(attributes)) {
      const upTo = content.slice(0, ltIdx);
      const lineNumber = upTo.split("\n").length;
      issues.push({
        file,
        line: lineNumber,
        tag: tagName,
        hits,
        text: lines[lineNumber - 1]?.trim() ?? body.slice(0, 80)
      });
    }
    // Move past the opening tag and let the next iteration scan the body so
    // we can audit nested elements (e.g. a <div> wrapping a <code> with
    // high-risk text). Without this we'd skip the entire subtree and miss
    // the leaf-level issues.
    i = openEnd + 1;
  }

  return issues;
}

function findOpeningTagEnd(content, start) {
  // Walk forward tracking brace/string/template depth. The first unescaped,
  // un-braced `>` is the end of the opening tag.
  let depth = 0;
  let inString = null;
  for (let i = start; i < content.length; i += 1) {
    const ch = content[i];
    if (inString) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (ch === ">" && depth === 0) return i;
  }
  return -1;
}

function findMatchingClose(content, start, tagName) {
  // Hand-rolled scanner: walk forward matching open/close pairs of the given
  // tag name. Self-closing `<Tag />` does not bump depth. The `>` characters
  // inside JSX attribute expressions (e.g. arrow functions) are skipped via
  // the same brace-depth logic as `findOpeningTagEnd`.
  const closeNeedle = `</${tagName}`;
  let depth = 1;
  let i = start;
  let iter = 0;
  while (i < content.length) {
    iter += 1;
    if (iter > 20000) return -1;
    const openStart = findNextOpenTag(content, i, tagName);
    const closeStart = findNextCloseTag(content, i, tagName);
    if (closeStart === -1) return -1;
    if (openStart !== -1 && openStart < closeStart) {
      const openEnd = findOpeningTagEnd(content, openStart + 1 + tagName.length);
      if (openEnd === -1) return -1;
      const isSelfClosing = content[openEnd - 1] === "/";
      if (!isSelfClosing) depth += 1;
      i = openEnd + 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) return closeStart;
    i = closeStart + closeNeedle.length + 1;
  }
  return -1;
}

function findNextOpenTag(content, start, tagName) {
  // Find the next occurrence of `<tagName` (followed by a word boundary)
  // after `start`. We don't try to fully parse the tag here — we only need
  // the position so the caller can decide whether the opening sits before
  // the next closing tag.
  const needle = `<${tagName}`;
  let from = start;
  while (from < content.length) {
    const idx = content.indexOf(needle, from);
    if (idx === -1) return -1;
    const after = content[idx + needle.length] ?? "";
    if (/[\s/>]/.test(after)) return idx;
    from = idx + 1;
  }
  return -1;
}

function findNextCloseTag(content, start, tagName) {
  // Find the position of `<` in the next `</tagName>` after `start`. We
  // require a non-letter character after the tag name so we don't pick up
  // longer tag names that share a prefix (e.g. `<div` vs `<dialog`).
  const needle = `</${tagName}`;
  const idx = content.indexOf(needle, start);
  if (idx === -1) return -1;
  const after = content[idx + needle.length] ?? "";
  if (/[A-Za-z]/.test(after)) {
    // Prefix collision — keep searching.
    return findNextCloseTag(content, idx + 1, tagName);
  }
  return idx;
}

function existingDirs(dirs) {
  return dirs.filter((dir) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}

const hardFailFiles = existingDirs(hardFailDirs)
  .flatMap(walk)
  .filter((file) => !isTestOrTerminologyFixture(file));
const documentationFiles = existingDirs(documentationDirs).flatMap(walk);

const issues = [
  ...hardFailFiles.flatMap((file) => scanForbiddenTerms(file, "hard")),
  ...documentationFiles.flatMap((file) => scanForbiddenTerms(file, "docs")),
  ...translationDefenseFiles.flatMap(scanTranslationDefense)
];

if (issues.length > 0) {
  const forbiddenCount = issues.filter((i) => "term" in i).length;
  const defenseCount = issues.length - forbiddenCount;
  console.error("Terminology lint failed.\n");
  if (forbiddenCount > 0) {
    console.error(
      `Found ${forbiddenCount} forbidden user-facing term(s). Replace them or move them into an allowed forbidden-term context.`
    );
  }
  if (defenseCount > 0) {
    console.error(
      `Found ${defenseCount} JSX element(s) rendering high-risk terms without both translate="no" and className="notranslate".`
    );
  }
  console.error("");
  for (const issue of issues) {
    const rel = path.relative(repoRoot, issue.file);
    if ("term" in issue) {
      console.error(`${rel}:${issue.line} forbidden term "${issue.term}"`);
      console.error(`  ${issue.text}`);
    } else {
      const termList = issue.hits.map((h) => h.snippet).join(", ");
      console.error(
        `${rel}:${issue.line} <${issue.tag}> renders high-risk term(s) [${termList}] without both translate="no" and notranslate`
      );
      console.error(`  ${issue.text}`);
    }
  }
  process.exit(1);
}

console.log(
  `Terminology lint passed (${hardFailFiles.length + documentationFiles.length} files scanned).`
);
