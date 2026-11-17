#!/usr/bin/env node

/**
 * Static gate: clipboard copy surfaces.
 *
 * Why: 2026-11-17 错题 docs/lessons/2026-11-17-clipboard-http-fake-success.md —
 * a shared helper can report "copied" while nothing reached the clipboard, and
 * every call site inherits the lie. The helper is verified by a real-browser
 * UAT (UAT-SUITE-COPY-FAKE-SUCCESS); this gate keeps the *inventory* honest so
 * a new copy button cannot appear without being registered there.
 *
 * Rules:
 *  R1  Only src/lib/clipboard.ts may touch navigator.clipboard, execCommand or
 *      ClipboardItem. Everyone else goes through the shared helper.
 *  R2  Every production file that calls copyTextToClipboard / copyTextWithToast
 *      is listed in scripts/copy-surfaces.manifest.json with the exact call-site
 *      count; manifest files that no longer call the helper are stale.
 *  R3  Every manifest surface declares coverage "click" or "helper-only";
 *      "helper-only" must say why the button was not clicked.
 *  R5  copyTextToClipboard returns `{ ok, reason }` — an object that is always truthy.
 *      Every call site must read `.ok` (not `if (!result)`, not ignored), otherwise
 *      the failure branch is dead and the UI claims success unconditionally
 *      (Spec 192 section 13.2; found again in Onboarding.tsx on 2026-11-17).
 *  R4  Every "click" surface carries a stable sub-case id (UAT-COPY-02a, 02b, ...),
 *      unique across the manifest and written in the suite's cases.md, so other
 *      agents can cite one entry instead of "the third row".
 *
 * No allow-list beyond the manifest itself.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webuiRoot = path.resolve(scriptDir, "..");
const HELPER_FILE = "src/lib/clipboard.ts";
const MANIFEST_PATH = path.join(scriptDir, "copy-surfaces.manifest.json");
const CASES_DOC_PATH = path.resolve(webuiRoot, "..", "docs/qa/uat/suites/copy-fake-success/cases.md");
const COVERAGE = new Set(["click", "helper-only"]);
const CASE_ID = /^UAT-COPY-02[a-z]$/;

const RAW_API = /\bnavigator\s*\.\s*clipboard\b|\bexecCommand\s*\(|\bClipboardItem\b/;
const HELPER_CALL = /\b(?:copyTextToClipboard|copyTextWithToast)\s*\(/g;
const RESULT_CALL = /\bcopyTextToClipboard\s*\(/g;
const RESULT_WINDOW = 400;

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function isTestFile(rel) {
  return rel.includes("/__tests__/") || /\.test\.tsx?$/.test(rel);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(abs);
  }
  return out;
}

/** Production source files under webui/src (posix-relative to webui/). */
export function collectSourceFiles(root = webuiRoot) {
  return walk(path.join(root, "src"))
    .map((abs) => path.relative(root, abs).split(path.sep).join("/"))
    .filter((rel) => !isTestFile(rel))
    .sort();
}

export function countHelperCalls(content) {
  return (stripComments(content).match(HELPER_CALL) ?? []).length;
}

/** Calls of copyTextToClipboard whose result `.ok` is never read within the next few lines. */
export function countUncheckedResults(content) {
  const text = stripComments(content);
  let unchecked = 0;
  for (const match of text.matchAll(RESULT_CALL)) {
    const rest = text.slice(match.index + match[0].length, match.index + match[0].length + RESULT_WINDOW);
    if (!/\.ok\b/.test(rest)) unchecked += 1;
  }
  return unchecked;
}

export function usesRawClipboardApi(content) {
  return RAW_API.test(stripComments(content));
}

export function checkManifest(manifest, sources, casesDoc = null) {
  const problems = [];
  const files = manifest.files ?? {};
  const seen = new Set();
  const caseOwners = new Map();

  for (const [rel, content] of Object.entries(sources)) {
    if (rel === HELPER_FILE) continue;
    if (usesRawClipboardApi(content)) {
      problems.push(`R1 ${rel}: 直接使用 navigator.clipboard／execCommand／ClipboardItem，必须改走 ${HELPER_FILE}`);
    }
    const unchecked = countUncheckedResults(content);
    if (unchecked > 0) {
      problems.push(`R5 ${rel}: ${unchecked} 处 copyTextToClipboard 没有读取返回值的 .ok（返回的是恒为真的对象，必须判 result.ok）`);
    }
    const calls = countHelperCalls(content);
    if (calls === 0) continue;
    seen.add(rel);
    const entry = files[rel];
    if (!entry) {
      problems.push(`R2 ${rel}: 有 ${calls} 处复制调用，但未登记到 copy-surfaces.manifest.json`);
    } else if (entry.callSites !== calls) {
      problems.push(`R2 ${rel}: 登记 callSites=${entry.callSites}，源码实有 ${calls} 处，请同步登记表并补 UAT-COPY 用例`);
    }
  }

  for (const [rel, entry] of Object.entries(files)) {
    if (!seen.has(rel)) problems.push(`R2 ${rel}: 已登记但源码里不再调用复制 helper（或文件已删除），请清理登记表`);
    const surfaces = entry.surfaces ?? [];
    if (surfaces.length === 0) problems.push(`R3 ${rel}: 没有登记任何 surface`);
    for (const s of surfaces) {
      if (!s.id || !s.label || !s.route) problems.push(`R3 ${rel}: surface 缺少 id／label／route（${JSON.stringify(s)}）`);
      if (!COVERAGE.has(s.coverage)) problems.push(`R3 ${rel}#${s.id}: coverage 必须是 click 或 helper-only`);
      if (s.coverage === "helper-only" && !s.reason) problems.push(`R3 ${rel}#${s.id}: helper-only 必须写 reason（为何没有点击探针）`);
      if (s.coverage === "click") checkCaseId(rel, s, caseOwners, casesDoc, problems);
    }
  }
  return problems;
}

function checkCaseId(rel, surface, caseOwners, casesDoc, problems) {
  const where = `${rel}#${surface.id}`;
  if (!CASE_ID.test(surface.case ?? "")) {
    problems.push(`R4 ${where}: click 入口必须有子用例编号 case（形如 UAT-COPY-02a）`);
    return;
  }
  const owner = caseOwners.get(surface.case);
  if (owner) problems.push(`R4 ${where}: 子用例编号 ${surface.case} 与 ${owner} 重复`);
  else caseOwners.set(surface.case, where);
  if (casesDoc !== null && !casesDoc.includes(surface.case)) {
    problems.push(`R4 ${where}: ${surface.case} 未写入 docs/qa/uat/suites/copy-fake-success/cases.md`);
  }
}

export function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const sources = Object.fromEntries(
    collectSourceFiles().map((rel) => [rel, readFileSync(path.join(webuiRoot, rel), "utf8")])
  );
  const problems = checkManifest(manifest, sources, readFileSync(CASES_DOC_PATH, "utf8"));
  if (problems.length > 0) {
    console.error("Copy surfaces lint failed.\n");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("\n规则与背景：docs/qa/uat/suites/copy-fake-success/suite.md");
    process.exit(1);
  }
  const total = Object.values(manifest.files).reduce((n, f) => n + f.callSites, 0);
  console.log(`Copy surfaces lint passed (${Object.keys(manifest.files).length} files, ${total} call sites registered).`);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) main();
