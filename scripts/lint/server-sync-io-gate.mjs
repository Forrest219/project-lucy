#!/usr/bin/env node
/**
 * server-sync-io-gate.mjs — 静态棘轮门禁：禁止 webui/server/ 新增阻塞式同步 FS/进程 I/O 调用。
 *
 * 背景：错题本 2026-11-17 / 2026-11-20 / 2026-11-23 多次因主线程同步阻塞导致事件循环
 * 卡顿、readyz 超时摘流或 MCP 握手长尾。本门禁：
 *   1. 对 webui/server/ 全部非测试 .ts 文件按 server-sync-io-baseline.json 实行只减不增棘轮。
 *   2. webui/server/proxy/ 仅允许基线中已登记的一次性初始化调用，任何未登记文件或新增调用直接 FAIL。
 *   3. 适用边界：仅覆盖 Node.js 同步文件系统与子进程 API；better-sqlite3 同步查询由 event-loop-gate 守护。
 *
 * 用法：node scripts/lint/server-sync-io-gate.mjs [--root <dir>] [--baseline <file>]
 * 退出码：0=通过；1=存在新增或越线同步 I/O；2=门禁自身错误。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_ROOT = "webui/server";
const DEFAULT_BASELINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "server-sync-io-baseline.json");

export const SYNC_IO_RE = /\b(readFileSync|readdirSync|statSync|lstatSync|writeFileSync|appendFileSync|mkdirSync|existsSync|openSync|readSync|writeSync|closeSync|fsyncSync|chmodSync|unlinkSync|renameSync|copyFileSync|realpathSync|mkdtempSync|rmSync|rmdirSync|readlinkSync|accessSync|execSync|execFileSync|spawnSync)\s*\(/g;

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
      if (ch === "\n") { ranges.push([start, i]); inLineComment = false; }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") { ranges.push([start, i + 2]); inBlockComment = false; i += 1; }
      continue;
    }
    if (inString) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === inString) { ranges.push([start, i + 1]); inString = null; }
      continue;
    }
    if (ch === "/" && next === "/") { inLineComment = true; start = i; i += 1; continue; }
    if (ch === "/" && next === "*") { inBlockComment = true; start = i; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; start = i; }
  }
  if (inLineComment || inBlockComment || inString) ranges.push([start, text.length]);
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

export function scanFileSyncIo(content) {
  const ranges = buildNonCodeRanges(content);
  const hits = [];
  for (const match of content.matchAll(SYNC_IO_RE)) {
    const idx = match.index ?? 0;
    if (isInsideRanges(idx, ranges)) continue;
    hits.push({ fn: match[1], line: lineNumberAt(content, idx) });
  }
  return hits;
}

function* walkServerTs(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkServerTs(full);
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".d.ts")) {
      yield full;
    }
  }
}

export function evaluateSyncIo({ rootDir = path.join(REPO_ROOT, DEFAULT_ROOT), repoRoot = REPO_ROOT, baselineCounts = {} }) {
  const violations = [];
  const shrinkable = [];
  let scanned = 0;
  let totalCalls = 0;

  if (!existsSync(rootDir)) {
    return { scanned, totalCalls, violations, shrinkable };
  }

  const files = statSync(rootDir).isFile() ? [rootDir] : [...walkServerTs(rootDir)].sort();
  for (const file of files) {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    const hits = scanFileSyncIo(readFileSync(file, "utf8"));
    scanned += 1;
    totalCalls += hits.length;

    const allowed = Number(baselineCounts[rel] ?? 0);
    if (hits.length > allowed) {
      const prefix = rel.startsWith("webui/server/proxy/") ? "proxy path sync I/O" : "sync I/O count";
      violations.push({
        file: rel,
        actual: hits.length,
        allowed,
        hits,
        message: `${prefix} ${hits.length} exceeds baseline ${allowed} (${hits.map((h) => `${h.fn}@L${h.line}`).join(", ")})`
      });
    } else if (hits.length < allowed) {
      shrinkable.push({ file: rel, actual: hits.length, allowed });
    }
  }

  return { scanned, totalCalls, violations, shrinkable };
}

export function main(argv = process.argv.slice(2)) {
  let rootArg = DEFAULT_ROOT;
  let baselinePath = DEFAULT_BASELINE;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") rootArg = argv[++i];
    else if (argv[i] === "--baseline") baselinePath = argv[++i];
    else {
      console.error(`[server-sync-io-gate] unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }

  const baseline = JSON.parse(readFileSync(path.resolve(baselinePath), "utf8"));
  const counts = baseline?.counts ?? {};
  const rootDir = path.isAbsolute(rootArg) ? rootArg : path.join(REPO_ROOT, rootArg);
  const { scanned, totalCalls, violations, shrinkable } = evaluateSyncIo({
    rootDir,
    repoRoot: REPO_ROOT,
    baselineCounts: counts
  });

  if (violations.length > 0) {
    console.error(`[server-sync-io-gate] FAIL：发现 ${violations.length} 处同步 I/O 越线（扫描 ${scanned} 个文件）`);
    for (const v of violations) {
      console.error(`  ${v.file}: ${v.message}`);
    }
    process.exit(1);
  }

  if (shrinkable.length > 0) {
    console.log(`[server-sync-io-gate] INFO：以下文件同步 I/O 已减少，可收紧基线：`);
    for (const s of shrinkable) console.log(`  ${s.file}: ${s.allowed} -> ${s.actual}`);
  }
  console.log(`[server-sync-io-gate] PASS：扫描 ${scanned} 个服务端文件，总计 ${totalCalls} 处（均在基线内，无新增同步 I/O）`);
}

const isDirect =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) main();
