#!/usr/bin/env node

/**
 * Static gate: URL-driven controlled text inputs.
 *
 * Spec: docs/specs/lucy-20261029-url-driven-input-ime-composition-spec.md
 * §5.1 (判定算法) and §5.5 (门禁语义).
 *
 * The defect this gate guards against is not "onChange writes the URL" — that
 * is the *correct* pattern. The defect is a controlled text input whose
 * `value` prop is derived from router state: React then re-renders the input
 * with a value that may differ from the DOM value, and Chrome cancels the
 * in-flight IME composition on every such write (Spec §1.3).
 *
 * The correct shape is a local-state mirror: `value` comes from component
 * state, and the URL follows as the downstream source of truth (Spec §5.2).
 *
 * This gate has no allow-list. Either the input is mirrored, or it is not a
 * controlled text input, or the value source is genuinely local.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webuiRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webuiRoot, "..");

/**
 * Input types that never host an IME composition (Spec §2.2 / §5.1). They
 * are skipped by the判定 entirely — a `<select>` or a checkbox cannot break a
 * composition, so reporting it would be a false positive.
 */
const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox",
  "radio",
  "hidden",
  "submit",
  "button",
  "range",
  "file",
  "color",
  "date",
  "datetime-local",
  "time",
]);

const IDENT = "[A-Za-z_$][A-Za-z0-9_$]*";

const ignoredPathParts = new Set(["node_modules", "dist", "coverage", ".vite"]);

// ─── Low-level scanning helpers ───────────────────────────────────────────────

/**
 * Walk forward from `start` (just after the tag name) to the `>` that closes
 * the opening tag, skipping over `>` characters that live inside JSX
 * attribute expressions or quoted strings.
 */
function findOpeningTagEnd(content, start) {
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
    if (ch === '"' || ch === "'" || ch === "`") {
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

/** Index of the `}` matching the `{` at `start`. */
function findMatchingBrace(content, start) {
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
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Parse the attribute list of a JSX opening tag.
 * Returns `[{ name, value, kind }]` where kind is "expression" | "string" |
 * "boolean".
 */
function parseJsxAttributes(raw) {
  const attrs = [];
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && /\s/.test(raw[i])) i += 1;
    if (i >= raw.length) break;

    const nameStart = i;
    while (i < raw.length && /[A-Za-z0-9_:.-]/.test(raw[i])) i += 1;
    const name = raw.slice(nameStart, i);
    if (!name) {
      i += 1;
      continue;
    }

    while (i < raw.length && /\s/.test(raw[i])) i += 1;
    if (raw[i] !== "=") {
      attrs.push({ name, value: null, kind: "boolean" });
      continue;
    }

    i += 1;
    while (i < raw.length && /\s/.test(raw[i])) i += 1;
    const ch = raw[i];
    if (ch === "{") {
      const end = findMatchingBrace(raw, i);
      if (end === -1) {
        attrs.push({ name, value: raw.slice(i + 1), kind: "expression" });
        break;
      }
      attrs.push({ name, value: raw.slice(i + 1, end), kind: "expression" });
      i = end + 1;
    } else if (ch === '"' || ch === "'") {
      const end = raw.indexOf(ch, i + 1);
      const stop = end === -1 ? raw.length : end;
      attrs.push({ name, value: raw.slice(i + 1, stop), kind: "string" });
      i = stop + 1;
    } else {
      const start = i;
      while (i < raw.length && !/\s/.test(raw[i])) i += 1;
      attrs.push({ name, value: raw.slice(start, i), kind: "string" });
    }
  }
  return attrs;
}

/**
 * Read the right-hand side of a `const NAME = ...` declaration starting right
 * after the `=`. The expression ends at a `;` or a newline that sits at
 * bracket depth 0, so multi-line object literals stay intact.
 */
function readExpression(content, start) {
  let depth = 0;
  let inString = null;
  const limit = Math.min(content.length, start + 4000);
  for (let i = start; i < limit; i += 1) {
    const ch = content[i];
    if (inString) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth < 0) depth = 0;
      continue;
    }
    if (depth === 0 && (ch === ";" || ch === "\n")) {
      return content.slice(start, i);
    }
  }
  return content.slice(start, limit);
}

/**
 * True when `expr` mentions the identifier `name` as a whole word.
 *
 * A property access (`draft.roleId`) reads a *property*, not the variable of
 * the same name, so an identifier directly preceded by `.` is not a reference
 * to that variable. Without this rule the gate would flag every
 * `value={someState.field}` whose field happens to share a name with a
 * route-derived local — a false positive, not a defect.
 */
export function referencesIdentifier(expr, name) {
  if (!expr || !name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_$.])${escaped}([^A-Za-z0-9_$]|$)`).test(expr);
}

/**
 * True when the expression only *reads* values — no call, no `await`, no
 * `new`, no template interpolation.
 *
 * The transitive closure of Spec §5.1 follows local constants that reference
 * a URL-derived variable. Without this restriction the closure explodes:
 * `const data = await apiPatch(`/api/admin/agents/${userId}`)` mentions the
 * route param inside a template literal, `data` becomes "URL-derived", and
 * everything computed from `data` inherits the label. A pure value
 * expression reads the URL's text; a call produces something else.
 */
function isPureValueExpression(expr) {
  const stripped = expr
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
  if (/\b(?:await|new)\b/.test(stripped)) return false;
  if (/[A-Za-z_$][A-Za-z0-9_$]*\s*\(/.test(stripped)) return false;
  return true;
}

// ─── Spec §5.1: collect URL-derived variables ─────────────────────────────────

/**
 * All `const NAME = <expr>` bindings in the file, keyed by name. Each name
 * keeps every right-hand side it was bound to.
 */
function collectLocalConsts(text) {
  const consts = new Map();
  const pattern = new RegExp(`\\bconst\\s+(${IDENT})\\s*=`, "g");
  for (const m of text.matchAll(pattern)) {
    const rhs = readExpression(text, m.index + m[0].length);
    if (!consts.has(m[1])) consts.set(m[1], []);
    consts.get(m[1]).push(rhs);
  }
  return consts;
}

/**
 * Collect the local variables whose value is derived from router state.
 *
 * Seeds:
 *  (1) `const x = searchParams.get(...)`
 *  (2) `const { a, b } = useParams()`
 *  (3) `const x = ...get("literal")`  (custom get() wrappers)
 *  (4) `const x = ...location.search`
 *  (5) transitive closure: a local const whose RHS mentions a seed.
 */
export function collectUrlDerivedVars(text) {
  const seeds = new Set();

  // (1) useSearchParams-derived local constants
  for (const m of text.matchAll(
    new RegExp(`const\\s+(${IDENT})\\s*=\\s*[^;\\n]*searchParams\\.get(All)?\\(`, "g")
  )) {
    seeds.add(m[1]);
  }

  // (2) useParams destructuring
  for (const m of text.matchAll(
    new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*useParams`, "g")
  )) {
    for (const part of m[1].split(",")) {
      const name = part.split(":")[0].trim();
      if (name) seeds.add(name);
    }
  }

  // (3) custom get() wrappers
  for (const m of text.matchAll(
    new RegExp(`const\\s+(${IDENT})\\s*=\\s*[^;\\n]*\\bget\\(\\s*["'\`]`, "g")
  )) {
    seeds.add(m[1]);
  }

  // (4) location.search
  for (const m of text.matchAll(
    new RegExp(`const\\s+(${IDENT})\\s*=\\s*[^;\\n]*location\\.search`, "g")
  )) {
    seeds.add(m[1]);
  }

  // (5) transitive closure over local constants
  const consts = collectLocalConsts(text);
  let changed = true;
  let rounds = 0;
  while (changed && rounds < 20) {
    changed = false;
    rounds += 1;
    for (const [name, rhsList] of consts) {
      if (seeds.has(name)) continue;
      const referencesSeed = rhsList.some((rhs) => {
        if (!isPureValueExpression(rhs)) return false;
        for (const seed of seeds) {
          if (referencesIdentifier(rhs, seed)) return true;
        }
        return false;
      });
      if (referencesSeed) {
        seeds.add(name);
        changed = true;
      }
    }
  }

  return seeds;
}

// ─── Spec §5.1: collect text inputs ───────────────────────────────────────────

/**
 * Every controlled text input / textarea in the file, with the raw `value`
 * expression and a human-readable label.
 */
export function collectTextInputs(text) {
  const inputs = [];
  for (const m of text.matchAll(/<(input|textarea)\b/g)) {
    const tag = m[1];
    const afterName = m.index + 1 + tag.length;
    const tagEnd = findOpeningTagEnd(text, afterName);
    if (tagEnd === -1) continue;

    const attrs = parseJsxAttributes(text.slice(afterName, tagEnd));
    const typeAttr = attrs.find((a) => a.name === "type");
    if (
      tag === "input" &&
      typeAttr &&
      typeAttr.kind === "string" &&
      NON_TEXT_INPUT_TYPES.has(typeAttr.value.trim().toLowerCase())
    ) {
      continue;
    }

    const valueAttr = attrs.find((a) => a.name === "value");
    const labelAttr =
      attrs.find((a) => a.name === "aria-label") ??
      attrs.find((a) => a.name === "placeholder") ??
      attrs.find((a) => a.name === "data-testid");
    const label =
      labelAttr && labelAttr.kind === "string" && labelAttr.value.trim()
        ? labelAttr.value.trim()
        : `<${tag}>`;

    inputs.push({
      tag,
      line: text.slice(0, m.index).split("\n").length,
      valueExpr: valueAttr && valueAttr.kind === "expression" ? valueAttr.value : null,
      hasValueProp: Boolean(valueAttr),
      label,
    });
  }
  return inputs;
}

// ─── Spec §5.1: the judgement ─────────────────────────────────────────────────

/**
 * A text input is URL-driven when its `value` prop mentions a URL-derived
 * variable. `onChange` writing the URL is irrelevant — that is the correct
 * pattern when `value` is driven by local state.
 */
export function isUrlDriven(input, seeds) {
  if (!input.valueExpr) return false;
  for (const seed of seeds) {
    if (referencesIdentifier(input.valueExpr, seed)) return true;
  }
  return false;
}

/** Scan one file's content and return its findings. */
export function scanFileContent(content, file) {
  const seeds = collectUrlDerivedVars(content);
  const findings = [];
  for (const input of collectTextInputs(content)) {
    if (isUrlDriven(input, seeds)) {
      findings.push({ file, line: input.line, label: input.label, valueExpr: input.valueExpr });
    }
  }
  return findings;
}

// ─── Gate plumbing ────────────────────────────────────────────────────────────

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if ([...ignoredPathParts].some((part) => absolute.split(path.sep).includes(part))) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...walk(absolute));
    } else if (entry.isFile() && absolute.endsWith(".tsx")) {
      files.push(absolute);
    }
  }
  return files;
}

function isTestFile(file) {
  const normalized = file.split(path.sep).join("/");
  return normalized.includes("/__tests__/") || /\.test\.tsx?$/.test(file);
}

/** Every `.tsx` file under `webui/src`, excluding tests. */
export function collectScanFiles(root = path.join(webuiRoot, "src")) {
  let stats;
  try {
    stats = statSync(root);
  } catch {
    return [];
  }
  if (!stats.isDirectory()) return [];
  return walk(root).filter((file) => !isTestFile(file)).sort();
}

/** All findings across the scan roots. */
export function collectIssues(root = path.join(webuiRoot, "src")) {
  const files = collectScanFiles(root);
  const issues = [];
  for (const file of files) {
    issues.push(...scanFileContent(readFileSync(file, "utf8"), file));
  }
  return { files, issues };
}

export function formatReport(issues) {
  const lines = [];
  lines.push("URL-driven input lint failed.\n");
  lines.push(
    `Found ${issues.length} controlled text input(s) whose value comes from router state.`
  );
  lines.push("");
  for (const issue of issues) {
    const rel = path.relative(repoRoot, issue.file);
    lines.push(`${rel}:${issue.line} ${issue.label}`);
    lines.push(
      `  value={${issue.valueExpr}} — value 源取自路由状态，改用局部状态镜像（Spec §5.2）`
    );
  }
  return lines.join("\n");
}

export function main() {
  const { files, issues } = collectIssues();

  if (issues.length > 0) {
    console.error(formatReport(issues));
    process.exit(1);
  }

  console.log(`URL-driven input lint passed (${files.length} files scanned).`);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) main();
