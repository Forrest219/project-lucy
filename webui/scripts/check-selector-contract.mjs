#!/usr/bin/env node
// webui/scripts/check-selector-contract.mjs
// 关联主文档：docs/qa/lucy-webui-e2e-test-suite.md §5 / §7
// 关联契约表：docs/qa/selector-contract.md
// 关联 Spec 源：webui/tests/e2e/specs/**/*.spec.ts
//
// 双向检查（v0.3 起）：
//   1. 实现新增 testid 但契约表没登记 → fail（防止契约漂移）
//   2. L1/L2 spec 引用 testid 但实现缺失 → fail（防止 spec 跑空指针）
//   3. 契约表登记了 testid 但实现已删除 → warn（可能 pending PR）
//
// CI 接入：npm run e2e:selector-contract
// 任何 fail → exit 1

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { execSync } from "node:child_process";

const REPO = resolve(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "../..");
const CONTRACT = join(REPO, "docs/qa/selector-contract.md");
const SPECS = join(REPO, "webui/tests/e2e/specs");
const SRC = join(REPO, "webui/src");

if (!existsSync(CONTRACT)) {
  console.error(`[FAIL] contract file not found: ${CONTRACT}`);
  process.exit(1);
}

// 1. 解析契约表：只把 markdown 表格**首列**的反引号代码块算契约登记
//    表格行格式：`^\| \`<id>\` \|( \|.*)?$`
//    实现思路：先按行扫，识别表格行 + 抓首列反引号内容；内容里允许 `[\w-${}\.]+`
//    模板 testid（多 ${...} 段，如 `schema-row-${conn.id}-${schema}`）整体捕获
const contractContent = readFileSync(CONTRACT, "utf-8");
const contracted = new Set();
for (const line of contractContent.split(/\r?\n/)) {
  // 表格行：以 | 开头
  if (!line.trimStart().startsWith("|")) continue;
  // 抓首列反引号整体内容（不细分内部模板段）
  const m = line.match(/^\|\s+`([^`]+)`\s*\|/);
  if (!m) continue;
  const id = m[1].trim();
  // 合法 testid 字符：[a-z0-9-] + ${...} 模板段 + 路径分隔符 / .
  if (!/^[a-z0-9./-]+(\$\{[^}]+\}[a-z0-9./-]*)*$/.test(id)) continue;
  contracted.add(id);
}

if (contracted.size === 0) {
  console.error(`[FAIL] no testids parsed from ${CONTRACT}`);
  process.exit(1);
}

// 2. 扫实现：data-testid="..." 静态 + data-testid={`...${var}...`} 模板
//    只扫 webui/src/，跳过 webui/src/__tests__/（vitest 内部夹具，非 E2E 关心）
const implemented = new Map(); // id -> [file, ...]
const templated = new Map();   // 模板 id（带 ${var}）-> [file, ...]
function walk(dir, skipDir) {
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (skipDir && ent === skipDir) continue;
      walk(p, skipDir);
    } else if (/\.(tsx?|jsx?)$/.test(ent)) {
      const text = readFileSync(p, "utf-8");
      const rel = relative(REPO, p);
      for (const m of text.matchAll(/data-testid="([a-z][a-z0-9-]+)"/g)) {
        if (!implemented.has(m[1])) implemented.set(m[1], []);
        implemented.get(m[1]).push(rel);
      }
      for (const m of text.matchAll(/data-testid=\{`([^`]+)`\}/g)) {
        if (!templated.has(m[1])) templated.set(m[1], []);
        templated.get(m[1]).push(rel);
      }
    }
  }
}
walk(SRC, "__tests__");

// 3. 扫 spec：getByTestId("...") 静态 + 模板
const specRefs = new Map();
function walkSpecs(dir) {
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    const s = statSync(p);
    if (s.isDirectory()) walkSpecs(p);
    else if (/\.spec\.(tsx?|jsx?)$/.test(ent)) {
      const text = readFileSync(p, "utf-8");
      const rel = relative(REPO, p);
      for (const m of text.matchAll(/getByTestId\("([a-z][a-z0-9-]+)"/g)) {
        if (!specRefs.has(m[1])) specRefs.set(m[1], []);
        specRefs.get(m[1]).push(rel);
      }
      for (const m of text.matchAll(/getByTestId\(`([^`]+)`\)/g)) {
        if (!specRefs.has(m[1])) specRefs.set(m[1], []);
        specRefs.get(m[1]).push(rel);
      }
    }
  }
}
if (existsSync(SPECS)) walkSpecs(SPECS);

// 4. 双向 fail / warn
let failed = false;
const issues = { fail: [], warn: [] };

// 4a. 实现的静态 testid 必须登记
for (const [id, files] of implemented) {
  if (!contracted.has(id)) {
    issues.fail.push(
      `[UNREGISTERED] data-testid="${id}" used in ${files.join(", ")} but not in selector-contract.md`
    );
  }
}

// 4b. 模板 testid（如 connection-card-${conn.id}）必须以模板形式登记
//    把模板中的 ${...} 段视作 wildcard；用全字符串转义 + 非贪婪通配
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function isTemplatedContracted(id) {
  for (const c of contracted) {
    if (!c.includes("${")) continue;
    // 把契约里的 ${...} 段替换成 (?:.+?) 实现"中间任意字符"语义
    const reSrc = c
      .split(/\$\{[^}]+\}/)
      .map(escapeRegExp)
      .join("[^${}]+"); // ${ 还没转义；用排除字符类避免吞掉后续 ${...}
    // 上面 join 之后再转义掉残留的 ${
    const finalSrc = reSrc.replace(/\\\$\\{/g, "\\$\\{");
    const regex = new RegExp("^" + finalSrc + "$");
    if (regex.test(id)) return true;
  }
  return false;
}
for (const [tpl, files] of templated) {
  if (!contracted.has(tpl) && !isTemplatedContracted(tpl)) {
    issues.fail.push(
      `[UNREGISTERED TEMPLATE] data-testid={\`${tpl}\`} used in ${files.join(", ")} but not in selector-contract.md`
    );
  }
}

// 4c. ★ v0.3 新增：L1/L2 spec 引用 testid 但实现缺失 → fail
for (const [id, files] of specRefs) {
  // 模板引用（spec 里 getByTestId(`...${var}...`)）暂跳过强校验
  if (id.includes("${")) continue;
  if (!implemented.has(id) && !isTemplatedContracted(id)) {
    // 静态实现确实没有 → fail
    issues.fail.push(
      `[SPEC-DANGLES-IMPL] getByTestId("${id}") used in ${files.join(", ")} but no implementation found in webui/src/`
    );
  }
}

// 4d. 契约表登记但实现已删除 → warn（可能 pending PR）
for (const id of contracted) {
  if (id.includes("${")) continue;
  if (!implemented.has(id) && !isTemplatedContracted(id)) {
    issues.warn.push(
      `[ORPHAN] contract registers "${id}" but no implementation found in webui/src/`
    );
  }
}

// 5. 输出
for (const line of issues.fail) {
  console.error(`❌ ${line}`);
  failed = true;
}
for (const line of issues.warn) {
  console.warn(`⚠️  ${line}`);
}

const totalImpl = implemented.size;
const totalContracted = contracted.size;
const totalTemplated = templated.size;
const totalSpecRefs = specRefs.size;
console.log(
  `\nSummary: ${totalImpl} static testids in impl, ${totalTemplated} templated, ${totalContracted} in contract, ${totalSpecRefs} spec refs.`
);

if (failed) {
  console.error(`\n[FAIL] ${issues.fail.length} issue(s) require attention.`);
  process.exit(1);
} else {
  console.log(`\n[OK] selector contract is consistent.`);
}
