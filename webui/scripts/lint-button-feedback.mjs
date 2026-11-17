#!/usr/bin/env node

/**
 * Static gate: button-level success feedback (download / save / export).
 *
 * Why: P1-42 / REQ-030-063. P1-40 showed that a button can claim success while
 * the action did not happen. The browser UAT (UAT-SUITE-BUTTON-FEEDBACK) is the
 * proof; this gate keeps the inventory honest and blocks the code shapes that
 * produced the defects found in the sweep.
 *
 * Scope is button level only: is the success feedback conditioned on the
 * action's observable result. It does not judge export content or business
 * correctness.
 *
 * Rules (all hard, no allow-list beyond the manifest itself):
 *  B1  Every production file that triggers a browser download is listed in
 *      scripts/download-surfaces.manifest.json with the exact trigger count.
 *      Triggers: `<anchor>.download = ...` and JSX `<ApiDownloadLink>`. The shared
 *      implementation (src/lib/downloadApiFile.ts) is covered by its unit tests and
 *      is not an entry. Stale manifest files fail.
 *  B2  Every surface declares coverage "click" or "not-run"; "not-run" must say
 *      why, "click" carries a unique UAT-BTN-NN id written in the suite's cases.md.
 *  B5  A raw `<a href="/api/…">` / export-or-download URL anchor is forbidden: the
 *      browser hides every HTTP failure inside its own download bar and the page
 *      says nothing. Use <ApiDownloadLink> (found on the audit reconciliation
 *      export, which answered 409 and left the user with no message).
 *  B3  Any raw `fetch(` outside src/lib/apiClient.ts must read `.ok` in the same
 *      function window: an HTTP 4xx/5xx is a normal response, not an exception.
 *  B4  Server: every `writeAccessYaml(` call site must handle a non-committed
 *      terminal state (rolled_back / recovery_required) before answering ok.
 *      Found in DELETE /api/admin/agents/:userId, which answered `written: true`
 *      after a rollback.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webuiRoot = path.resolve(scriptDir, "..");
const API_CLIENT = "src/lib/apiClient.ts";
const MANIFEST_PATH = path.join(scriptDir, "download-surfaces.manifest.json");
const CASES_DOC_PATH = path.resolve(webuiRoot, "..", "docs/qa/uat/suites/button-feedback/cases.md");
const CASE_ID = /^UAT-BTN-\d{2}[a-z]?$/;
const COVERAGE = new Set(["click", "not-run"]);

const HELPER_FILES = new Set(["src/lib/downloadApiFile.ts"]);
const JS_DOWNLOAD = /\.download\s*=(?!=)/g;
const API_LINK = /<ApiDownloadLink\b/g;
const ANCHOR_TAG = /<a\b[^>]*>/g;
const DOWNLOAD_HREF = /href=\{?[`"'][^"'`]*\/api\/|href=\{[\w.]*(?:[Ee]xport|[Dd]ownload)[\w.]*\}/;
const RAW_FETCH = /(?<![.\w])fetch\s*\(/g;
const FETCH_WINDOW = 900;
const WRITE_CALL = /(?<!function\s)(?<!async function\s)\bwriteAccessYaml\s*\(/g;
const WRITE_WINDOW = 3000;
const WRITE_HANDLED = /accessWriteResponseBody|finishConfirmedAgentWrite|\.rolledBack\b|\.status\s*(?:!==|===)\s*"committed"/;

export function stripComments(text) {
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

export function collectFiles(root, sub) {
  return walk(path.join(root, sub))
    .map((abs) => path.relative(root, abs).split(path.sep).join("/"))
    .filter((rel) => !isTestFile(rel))
    .map((rel) => ({ rel, text: stripComments(readFileSync(path.join(root, rel), "utf8")) }));
}

export function countDownloadTriggers(text) {
  return (text.match(JS_DOWNLOAD) ?? []).length + (text.match(API_LINK) ?? []).length;
}

export function findRawApiAnchors(text) {
  const found = [];
  for (const match of text.matchAll(ANCHOR_TAG)) {
    if (DOWNLOAD_HREF.test(match[0])) found.push(text.slice(0, match.index).split("\n").length);
  }
  return found;
}

export function findUnguardedFetches(text) {
  const found = [];
  for (const match of text.matchAll(RAW_FETCH)) {
    const window = text.slice(match.index, match.index + FETCH_WINDOW);
    if (!/\.ok\b/.test(window)) found.push(text.slice(0, match.index).split("\n").length);
  }
  return found;
}

export function findUnhandledWrites(text) {
  const found = [];
  for (const match of text.matchAll(WRITE_CALL)) {
    const window = text.slice(match.index, match.index + WRITE_WINDOW);
    if (!WRITE_HANDLED.test(window)) found.push(text.slice(0, match.index).split("\n").length);
  }
  return found;
}

export function checkManifest(manifest, sources, casesDoc = null) {
  const errors = [];
  const declared = manifest.files ?? {};
  const seenCases = new Map();

  for (const { rel, text } of sources) {
    if (HELPER_FILES.has(rel)) continue;
    const actual = countDownloadTriggers(text);
    const entry = declared[rel];
    if (actual > 0 && !entry) {
      errors.push(`B1 ${rel}: ${actual} download trigger(s) not registered in download-surfaces.manifest.json`);
    } else if (entry && entry.triggers !== actual) {
      errors.push(`B1 ${rel}: manifest says ${entry.triggers} trigger(s), source has ${actual}`);
    }
  }
  const known = new Set(sources.map((s) => s.rel));
  for (const [rel, entry] of Object.entries(declared)) {
    if (!known.has(rel)) {
      errors.push(`B1 ${rel}: listed in manifest but file no longer exists`);
      continue;
    }
    const surfaces = entry.surfaces ?? [];
    if (surfaces.length !== entry.triggers) {
      errors.push(`B2 ${rel}: ${surfaces.length} surface(s) declared for ${entry.triggers} trigger(s)`);
    }
    for (const surface of surfaces) {
      if (!COVERAGE.has(surface.coverage)) {
        errors.push(`B2 ${rel}#${surface.id}: coverage must be "click" or "not-run"`);
        continue;
      }
      if (surface.coverage === "not-run") {
        if (!surface.reason) errors.push(`B2 ${rel}#${surface.id}: "not-run" needs a reason`);
        continue;
      }
      if (!CASE_ID.test(surface.case ?? "")) {
        errors.push(`B2 ${rel}#${surface.id}: "click" needs a case id like UAT-BTN-01`);
        continue;
      }
      if (seenCases.has(surface.case)) {
        errors.push(`B2 ${rel}#${surface.id}: case ${surface.case} already used by ${seenCases.get(surface.case)}`);
      }
      seenCases.set(surface.case, `${rel}#${surface.id}`);
      if (casesDoc !== null && !casesDoc.includes(surface.case)) {
        errors.push(`B2 ${rel}#${surface.id}: ${surface.case} is not written in the suite's cases.md`);
      }
    }
  }
  return errors;
}

export function checkSources(uiSources, serverSources) {
  const errors = [];
  for (const { rel, text } of uiSources) {
    if (rel === API_CLIENT) continue;
    for (const line of findRawApiAnchors(text)) {
      errors.push(`B5 ${rel}:${line}: raw <a> download link to an API path — use <ApiDownloadLink> so a refused download is reported`);
    }
    for (const line of findUnguardedFetches(text)) {
      errors.push(`B3 ${rel}:${line}: raw fetch() without reading \`.ok\` — an HTTP error would pass as success`);
    }
  }
  for (const { rel, text } of serverSources) {
    for (const line of findUnhandledWrites(text)) {
      errors.push(`B4 ${rel}:${line}: writeAccessYaml() result is not checked for rolled_back / recovery_required`);
    }
  }
  return errors;
}

export function main() {
  const ui = collectFiles(webuiRoot, "src");
  const server = collectFiles(webuiRoot, "server");
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const casesDoc = existsSync(CASES_DOC_PATH) ? readFileSync(CASES_DOC_PATH, "utf8") : null;
  const errors = [...checkManifest(manifest, ui, casesDoc), ...checkSources(ui, server)];

  const triggers = ui.filter((s) => !HELPER_FILES.has(s.rel)).reduce((n, s) => n + countDownloadTriggers(s.text), 0);
  const fetches = ui.filter((s) => s.rel !== API_CLIENT).reduce((n, s) => n + (s.text.match(RAW_FETCH) ?? []).length, 0);
  const writes = server.reduce((n, s) => n + (s.text.match(WRITE_CALL) ?? []).length, 0);
  console.log(`button-feedback baseline: ${triggers} download trigger(s), ${fetches} raw fetch() site(s), ${writes} writeAccessYaml() call(s)`);

  if (errors.length > 0) {
    console.error(`FAILED: ${errors.length} button-feedback violation(s)`);
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
  }
  console.log("PASSED: button-feedback gate");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
