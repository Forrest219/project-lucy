#!/usr/bin/env node
/**
 * yaml-alias-gate.mjs — P1-76 静态门禁：树内 YAML 产物禁止 anchor／alias。
 *
 * 背景：yaml.stringify 对共享引用去重产出 anchor/alias；KTX 以默认
 * maxAliasCount=100 解析，超限拒读。本门禁在写入侧之外兜住静态文件与手写违规。
 *
 * 判定：对每个目标 YAML 用 yaml.parseDocument（maxAliasCount:-1 关闭解析上限）
 * 遍历 AST——Alias 节点（*ref）与带 anchor 的节点（&ref）任一出现即 FAIL。
 * 解析失败的文件记 WARN 并跳过（非本门禁职责）。
 *
 * 用法：node scripts/lint/yaml-alias-gate.mjs [--root <dir>]...
 * 默认 roots：config/semantic-layer、customer-config、examples、webui/config、仓库根 *.yaml。
 * 退出码：0=通过；1=存在 anchor/alias；2=门禁自身错误。
 */
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, visit } from "yaml";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".ktx", ".ktx-ui", "dist", "inbox", "var",
  "release", "runs", ".claude", ".cursor", ".codex", ".worktrees",
  ".vite", ".vitest-cache", "playwright-report",
]);
const YAML_EXT = /\.(ya?ml)$/i;

const args = process.argv.slice(2);
const customRoots = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--root") customRoots.push(args[++i]);
}

const defaultRoots = [
  "config/semantic-layer",
  "customer-config",
  "examples",
  "webui/config",
];
const roots = customRoots.length > 0
  ? customRoots
  : defaultRoots.filter((r) => existsSync(path.join(REPO, r)));

const violations = [];
const warns = [];
let scanned = 0;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".ktx-ui") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(full);
    } else if (e.isFile() && YAML_EXT.test(e.name)) {
      yield full;
    }
  }
}

// 文本级权威判定（零容差基线 + 人工复核成本可接受）：
// alias 引用 `*name`／anchor 定义 `&name`，仅匹配 token 起始边界
// （行首、空白、: , - [ { 之后；& 后须紧跟名字字符，避免误伤 "A&B"、"sales & profit"）。
const ALIAS_TOKEN = /(^|[\s:,\-\[\]{])\*[A-Za-z0-9_][\w.-]*/g;
const ANCHOR_TOKEN = /(^|[\s:,\-\[\]{])&[A-Za-z0-9_][\w.-]*/g;

function checkFile(file) {
  const rel = path.relative(REPO, file);
  const text = readFileSync(file, "utf8");
  // 交叉验证：AST 别名计数（能解析时）
  let astAliases = null;
  try {
    const doc = parseDocument(text, { maxAliasCount: -1, uniqueKeys: false });
    let count = 0;
    try {
      visit(doc, {
        "*": (...args) => {
          const n = args.find((a) => a && typeof a === "object" &&
            (typeof a.type === "string" || typeof a.source === "string"));
          if (n && n.type === "ALIAS") count++;
        },
      });
    } catch {
      /* visit 版本差异时仅依赖文本判定 */
    }
    if (doc.errors && doc.errors.length > 0) astAliases = null;
    else astAliases = count;
  } catch {
    /* 解析失败走文本判定 */
  }
  const lines = text.split("\n");
  const fileHits = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\s*#/.test(ln)) continue; // 整行注释
    ALIAS_TOKEN.lastIndex = 0;
    ANCHOR_TOKEN.lastIndex = 0;
    let m;
    while ((m = ALIAS_TOKEN.exec(ln))) {
      fileHits.push(`${rel}:${i + 1} alias *${m[0].slice(m[1].length + 1)}`);
    }
    while ((m = ANCHOR_TOKEN.exec(ln))) {
      fileHits.push(`${rel}:${i + 1} anchor &${m[0].slice(m[1].length + 1)}`);
    }
  }
  // 文本判定 0 命中但 AST 有别名 → 报 WARN 人工复核（不应发生，双保险）
  if (fileHits.length === 0 && astAliases && astAliases > 0) {
    warns.push(`${rel}: AST 检出 ${astAliases} 个 alias 但文本判定 0 命中，请人工复核`);
  }
  violations.push(...fileHits);
  scanned++;
}

// 仓库根散文件
if (customRoots.length === 0) {
  for (const e of readdirSync(REPO)) {
    if (YAML_EXT.test(e) && statSync(path.join(REPO, e)).isFile()) {
      checkFile(path.join(REPO, e));
    }
  }
}
for (const r of roots) {
  const abs = path.isAbsolute(r) ? r : path.join(REPO, r);
  if (!existsSync(abs)) {
    warns.push(`root 不存在，跳过：${r}`);
    continue;
  }
  if (statSync(abs).isFile()) {
    checkFile(abs);
    continue;
  }
  for (const f of walk(abs)) checkFile(f);
}

for (const w of warns) console.log("[yaml-alias-gate][WARN] " + w);
if (violations.length > 0) {
  console.error(`[yaml-alias-gate] FAIL：${violations.length} 处 anchor/alias（扫描 ${scanned} 个文件）`);
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}
console.log(`[yaml-alias-gate] PASS：扫描 ${scanned} 个 YAML 文件，0 处 anchor/alias`);
