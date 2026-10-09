#!/usr/bin/env node
/**
 * Semantic-layer type scan and access.yaml AbsoluteDeny scan.
 * Runs on the operator machine against a fixture directory, and inside the
 * Lucy pod (node + /app/webui/node_modules/yaml) against /data/lucy.
 *
 * Prints only file, field path, and type name — or role and tool name.
 * Never prints column descriptions, token hashes, or other YAML values.
 */
import { createRequire } from "node:module";
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ALLOWED = new Set(["string", "number", "time", "boolean"]);

/** SQL Server native types the field team already mapped onto KTX types. */
const TYPE_MAP = new Map([
  ["varchar", "string"],
  ["nvarchar", "string"],
  ["char", "string"],
  ["nchar", "string"],
  ["text", "string"],
  ["ntext", "string"],
  ["xml", "string"],
  ["uniqueidentifier", "string"],
  ["int", "number"],
  ["bigint", "number"],
  ["smallint", "number"],
  ["tinyint", "number"],
  ["decimal", "number"],
  ["numeric", "number"],
  ["float", "number"],
  ["real", "number"],
  ["money", "number"],
  ["smallmoney", "number"],
  ["bit", "boolean"],
  ["date", "time"],
  ["datetime", "time"],
  ["datetime2", "time"],
  ["smalldatetime", "time"],
  ["datetimeoffset", "time"]
]);

/** Keep in sync with webui/server/proxy/acl.ts ABSOLUTE_DENY_TOOLS. */
const ABSOLUTE_DENY = new Set([
  "sl_query",
  "sl_read_source",
  "sql_execution",
  "sql_dialect_notes",
  "memory_ingest",
  "memory_ingest_status"
]);

function loadYaml() {
  const candidates = ["/app/webui/node_modules/yaml/package.json"];
  if (import.meta.url) {
    candidates.push(fileUrlToRepoYaml(import.meta.url));
  }
  for (const pkg of candidates) {
    if (pkg && existsSync(pkg)) {
      return createRequire(pkg)("yaml");
    }
  }
  throw new Error("yaml package not found (expected /app/webui/node_modules/yaml or webui/node_modules/yaml)");
}

function fileUrlToRepoYaml(url) {
  const dir = path.dirname(new URL(url).pathname);
  return path.resolve(dir, "../../webui/node_modules/yaml/package.json");
}

const { parse, stringify } = loadYaml();

function baseType(value) {
  return String(value).trim().toLowerCase().split("(", 1)[0].trim();
}

function classify(value) {
  const base = baseType(value);
  if (ALLOWED.has(base)) return { ok: true };
  if (TYPE_MAP.has(base)) return { ok: false, mapped: TYPE_MAP.get(base), base };
  return { ok: false, base };
}

function walk(node, trail, hits) {
  if (Array.isArray(node)) {
    for (const item of node) {
      const label = item && typeof item === "object" && typeof item.name === "string" ? item.name : null;
      walk(item, label ? trail.concat(label) : trail, hits);
    }
    return;
  }
  if (!node || typeof node !== "object") return;
  if (typeof node.name === "string" && typeof node.type === "string") {
    const verdict = classify(node.type);
    if (!verdict.ok) {
      const fieldPath = trail[trail.length - 1] === node.name ? trail.join(".") : trail.concat(node.name).join(".");
      hits.push({
        path: fieldPath,
        type: node.type,
        mapped: verdict.mapped || null
      });
    }
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") walk(value, trail, hits);
  }
}

function yamlFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name.includes(".backup.")) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...yamlFiles(full));
    else if (name.endsWith(".yaml") || name.endsWith(".yml")) out.push(full);
  }
  return out.sort();
}

function scanTypes(dir) {
  const hits = [];
  for (const file of yamlFiles(dir)) {
    const doc = parse(readFileSync(file, "utf8"));
    const local = [];
    walk(doc, [], local);
    for (const hit of local) hits.push({ file, ...hit });
  }
  return hits;
}

function printTypeHits(hits, root) {
  for (const hit of hits) {
    const rel = path.relative(root, hit.file) || hit.file;
    const via = hit.mapped ? ` -> ${hit.mapped}` : " (no mapping)";
    console.log(`TYPE ${rel} ${hit.path} ${hit.type}${via}`);
  }
}

function applyTypes(dir, stamp) {
  let unsupported = 0;
  for (const file of yamlFiles(dir)) {
    const original = readFileSync(file, "utf8");
    const doc = parse(original);
    let changed = 0;
    const local = [];
    rewrite(doc, local, () => {
      changed += 1;
    });
    const unknown = local.filter((hit) => !hit.mapped);
    unsupported += unknown.length;
    if (changed > 0) {
      const backup = `${file}.backup.${stamp}`;
      copyFileSync(file, backup);
      writeFileSync(file, stringify(doc));
      console.log(`WROTE ${path.relative(dir, file) || file} backup ${path.basename(backup)}`);
    }
    for (const hit of unknown) {
      console.log(`TYPE ${path.relative(dir, file) || file} ${hit.path} ${hit.type} (no mapping)`);
    }
  }
  return unsupported;
}

function rewrite(node, unknown, onChange) {
  if (Array.isArray(node)) {
    for (const item of node) rewrite(item, unknown, onChange);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (typeof node.name === "string" && typeof node.type === "string") {
    const verdict = classify(node.type);
    if (!verdict.ok && verdict.mapped) {
      node.type = verdict.mapped;
      onChange();
    } else if (!verdict.ok) {
      unknown.push({ path: node.name, type: node.type, mapped: null });
    }
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") rewrite(value, unknown, onChange);
  }
}

function roleHits(doc) {
  const roles = doc && typeof doc.roles === "object" && doc.roles ? doc.roles : {};
  const hits = [];
  for (const [role, spec] of Object.entries(roles)) {
    const tools = spec && spec.allow && spec.allow.tools;
    if (!Array.isArray(tools)) continue;
    for (const tool of tools) {
      if (ABSOLUTE_DENY.has(tool)) hits.push({ role, tool });
    }
  }
  return hits;
}

function scanAccess(file) {
  const doc = parse(readFileSync(file, "utf8"));
  return roleHits(doc);
}

function applyAccess(file, stamp) {
  const original = readFileSync(file, "utf8");
  const doc = parse(original);
  const hits = roleHits(doc);
  if (hits.length === 0) return 0;
  const roles = doc.roles;
  for (const hit of hits) {
    const tools = roles[hit.role].allow.tools;
    roles[hit.role].allow.tools = tools.filter((tool) => !ABSOLUTE_DENY.has(tool));
  }
  const backup = `${file}.backup.${stamp}`;
  copyFileSync(file, backup);
  writeFileSync(file, stringify(doc));
  console.log(`WROTE ${path.basename(file)} backup ${path.basename(backup)}`);
  return 0;
}

function usage() {
  console.error(`usage: preflight-upgrade-lib.mjs <scan-types|apply-types|scan-access|apply-access> <path> [stamp]`);
  process.exit(2);
}

const [cmd, target, stamp] = process.argv.slice(2);
if (!cmd || !target) usage();

if (cmd === "scan-types") {
  const hits = scanTypes(target);
  printTypeHits(hits, target);
  process.exit(hits.length === 0 ? 0 : 1);
}
if (cmd === "apply-types") {
  if (!stamp) usage();
  const left = applyTypes(target, stamp);
  process.exit(left === 0 ? 0 : 1);
}
if (cmd === "scan-access") {
  const hits = scanAccess(target);
  for (const hit of hits) console.log(`ROLE ${hit.role} ${hit.tool}`);
  process.exit(hits.length === 0 ? 0 : 1);
}
if (cmd === "apply-access") {
  if (!stamp) usage();
  applyAccess(target, stamp);
  const left = scanAccess(target);
  for (const hit of left) console.log(`ROLE ${hit.role} ${hit.tool}`);
  process.exit(left.length === 0 ? 0 : 1);
}
usage();
