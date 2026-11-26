/**
 * P1-75 X1 附录 A 对账（轻量 grep 版）：webui/server 里出现 503 的代码窗口所带的错误码，
 * 必须在 Spec 附录 A「503 原因登记表」里登记；缺登记＝本表之外的 503，UAT 判失败。
 *
 * 这是 grep 级别的缺口探测（候选清单，窗口内相邻的非 503 错误码会产生噪声，须人工甄别），不是完整的 X0 出口对账：
 *   TODO(X0/X1)：动态拼接的错误码、经 helper 间接返回 503 的出口、`statusCode` 变量传递的路径，
 *   仍须 X0 人工对账；本脚本只保证「字面量错误码出现在 503 附近而附录 A 没有」不会静默漏过。
 *
 * 用法：node scripts/uat/check-503-registry.mjs [--strict] [--json]
 *   默认：打印缺登记清单并 exit 0（提示）；--strict：有缺登记即 exit 1（X1 冻结后在 CI 使用）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SPEC_PATH = "docs/specs/lucy-20261123-interactive-read-resilience-spec.md";
export const SERVER_DIR = "webui/server";
const WINDOW_LINES = 6;
const CODE_LITERAL = /["'`]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)["'`]/g;
/** 与 503 同窗出现但不是原因码的常量（HTTP 头、枚举名等）。 */
const IGNORED = new Set(["Retry-After"]);

/** 附录 A 全文里反引号包裹的标识符（原因码、busy reason、readyz 状态）。 */
export function registeredCodes(specText) {
  const start = specText.indexOf("## 附录 A");
  if (start < 0) throw new Error("附录 A not found in spec");
  const next = specText.indexOf("\n## ", start + 5);
  const section = specText.slice(start, next < 0 ? undefined : next);
  const codes = new Set();
  for (const match of section.matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/g)) codes.add(match[1]);
  return codes;
}

/** 返回 [{ line, codes }]：每个含 503 的行，及其 ±WINDOW_LINES 窗口内的大写错误码字面量。 */
export function find503Windows(source) {
  const lines = source.split("\n");
  const hits = [];
  lines.forEach((text, index) => {
    if (!/\b503\b/.test(text) || /^\s*(\/\/|\*|\/\*)/.test(text)) return;
    const from = Math.max(0, index - WINDOW_LINES);
    const window = lines.slice(from, index + WINDOW_LINES + 1).join("\n");
    const codes = [...new Set([...window.matchAll(CODE_LITERAL)].map((m) => m[1]))].filter((c) => !IGNORED.has(c));
    hits.push({ line: index + 1, codes });
  });
  return hits;
}

function listServerFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(full).isDirectory()) out.push(...listServerFiles(full));
    else if (/\.(ts|mts|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

export function reconcile({ specText, files }) {
  const registered = registeredCodes(specText);
  const unregistered = [];
  let windows = 0;
  for (const { file, source } of files) {
    for (const hit of find503Windows(source)) {
      windows += 1;
      const missing = hit.codes.filter((code) => !registered.has(code));
      if (missing.length) unregistered.push({ file, line: hit.line, codes: missing });
    }
  }
  return { windows, registered: registered.size, unregistered };
}

function main(argv) {
  const strict = argv.includes("--strict");
  const specText = readFileSync(path.join(ROOT, SPEC_PATH), "utf8");
  const files = listServerFiles(path.join(ROOT, SERVER_DIR)).map((full) => ({
    file: path.relative(ROOT, full),
    source: readFileSync(full, "utf8")
  }));
  const result = reconcile({ specText, files });
  if (argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`503 windows scanned: ${result.windows}; appendix A identifiers: ${result.registered}`);
    for (const item of result.unregistered) console.log(`UNREGISTERED ${item.file}:${item.line} ${item.codes.join(", ")}`);
    if (!result.unregistered.length) console.log("OK: every error-code literal near a 503 is registered in appendix A (grep-level only; see TODO in header).");
  }
  return strict && result.unregistered.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
