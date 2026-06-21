#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const root = process.cwd();
const results = [];

function rel(...parts) {
  return path.join(root, ...parts);
}

function read(relPath) {
  return readFileSync(rel(relPath), "utf8");
}

function add(check, level, message) {
  results.push({ check, level, message });
}

function walk(dir, predicate, out = []) {
  const abs = rel(dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs)) {
    const full = path.join(abs, entry);
    const relPath = path.relative(root, full).replaceAll(path.sep, "/");
    const st = statSync(full);
    if (st.isDirectory()) walk(relPath, predicate, out);
    else if (predicate(relPath)) out.push(relPath);
  }
  return out;
}

function extractFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  return match ? parse(match[1]) ?? {} : {};
}

function routeStatus() {
  const check = "route-status";
  const app = read("webui/src/app/App.tsx");
  const status = read("docs/webui-impl-status.md");
  const routes = [
    "/connections",
    "/connections/whitelist",
    "/connections/test",
    "/eval/cases",
    "/eval/runs",
    "/eval/monitor",
    "/admin/agents",
    "/admin/audit"
  ];
  for (const route of routes) {
    const routePath = route === "/" ? "/" : route.replace(/^\//, "");
    if (!app.includes(`path="${routePath}"`) && !app.includes(`to="${route}"`) && !app.includes(`to: "${route}"`)) {
      add(check, "fail", `webui/src/app/App.tsx: expected route ${route} not found`);
    }
  }
  const stalePatterns = [
    "数据库接入.*待开发",
    "Agent 实例.*待开发",
    "Case 管理.*待开发",
    "运行历史.*待开发",
    "趋势监控.*待开发"
  ];
  for (const pattern of stalePatterns) {
    if (new RegExp(pattern).test(status)) {
      add(check, "fail", `docs/webui-impl-status.md: stale status matched /${pattern}/`);
    }
  }
  if (!results.some((item) => item.check === check && item.level === "fail")) {
    add(check, "pass", "routes and status table are aligned for first-batch modules");
  }
}

function apiSpec() {
  const check = "api-spec";
  const files = [
    "webui/server/index.ts",
    ...walk("webui/server/admin", (file) => file.endsWith(".ts")),
    ...walk("webui/server/eval", (file) => file.endsWith(".ts"))
  ];
  const routes = new Set();
  const routeRe = /app\.(?:get|post|put|patch|delete)(?:<[\s\S]*?>)?\(\s*["'`]([^"'`]+)["'`]/g;
  for (const file of files) {
    const text = read(file);
    for (const match of text.matchAll(routeRe)) routes.add(match[1]);
  }
  const spec = read("webui/docs/03-api-spec.md");
  for (const route of [...routes].sort()) {
    if (!spec.includes(route)) {
      add(check, "fail", `webui/docs/03-api-spec.md: missing ${route}`);
    }
  }
  if (!results.some((item) => item.check === check && item.level === "fail")) {
    add(check, "pass", `${routes.size} registered REST routes are documented`);
  }
}

function skillDependency() {
  const check = "skill-dependency";
  const files = walk("skills", (file) => file.endsWith("/SKILL.md") || file === "skills/SKILL.md");
  for (const file of files) {
    const fm = extractFrontmatter(read(file));
    const deps = Array.isArray(fm.dependencies) ? fm.dependencies : [];
    if (deps.length === 0) {
      add(check, "warn", `${file}: dependencies is empty`);
      continue;
    }
    for (const dep of deps) {
      if (typeof dep !== "string") continue;
      const depPath = path.resolve(root, path.dirname(file), dep);
      if (!existsSync(depPath)) add(check, "fail", `${file}: dependency ${dep} not found`);
    }
  }
  if (!results.some((item) => item.check === check && item.level === "fail")) {
    add(check, "pass", `${files.length} skill files have resolvable dependencies`);
  }
}

function parseVersion(value) {
  const match = String(value ?? "").match(/v?(\d+)\.(\d+)/);
  return match ? Number(match[1]) * 100 + Number(match[2]) : 0;
}

function evalSchemaVersion() {
  const check = "eval-schema-version";
  const conventions = read("docs/eval-quiz-conventions.md");
  const current = conventions.match(/\|\s*v(\d+\.\d+)\s*\|/)?.[1] ?? "1.4";
  const currentValue = parseVersion(current);
  const files = walk("evals", (file) => file.endsWith("-eval-cases.yaml"));
  for (const file of files) {
    const doc = parse(read(file)) ?? {};
    const version = doc.metadata?.runner_schema_version;
    if (!version) add(check, "fail", `${file}: metadata.runner_schema_version missing`);
    else if (parseVersion(version) < currentValue) add(check, "warn", `${file}: runner_schema_version ${version} is older than v${current}`);
    if (!doc.safety_contract) add(check, "fail", `${file}: safety_contract missing`);
    if (!doc.metadata?.paired_quiz) add(check, "warn", `${file}: metadata.paired_quiz missing`);
  }
  if (!results.some((item) => item.check === check && item.level === "fail")) {
    add(check, "pass", `${files.length} eval files are readable and have required safety_contract`);
  }
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function loadSourceEntries() {
  const entries = [];
  const files = walk("semantic-layer", (file) => file.includes("/_schema/") && file.endsWith(".yaml"));
  for (const file of files) {
    const parts = file.split("/");
    const connectionId = normalize(parts[1]);
    const schema = normalize(path.basename(file, ".yaml"));
    const doc = parse(read(file)) ?? {};
    for (const [sourceName, value] of Object.entries(doc.tables ?? {})) {
      const table = normalize(value?.table ?? `${schema}.${sourceName}`);
      entries.push({ connectionId, schema, sourceName: normalize(sourceName), table });
    }
  }
  return entries;
}

function selectorMatches(selector, entry) {
  const connection = selector.connection ? normalize(selector.connection) : undefined;
  const schema = selector.schema ? normalize(selector.schema) : undefined;
  if (connection && entry.connectionId !== connection) return false;
  if (schema && entry.schema !== schema) return false;
  if (selector.prefix) return entry.sourceName.startsWith(normalize(selector.prefix));
  if (Array.isArray(selector.names)) {
    const names = selector.names.map(normalize);
    return names.includes(entry.sourceName) || names.includes(entry.table);
  }
  return false;
}

function accessRolePolicy() {
  const check = "access-role-policy";
  const config = parse(read("webui/config/access.yaml")) ?? {};
  const roles = config.roles ?? {};
  const users = Array.isArray(config.users) ? config.users : [];
  const denyTools = new Set(config.defaults?.deny_tools ?? []);
  const tableTouching = new Set(config.defaults?.table_touching_tools ?? ["sl_query", "sl_read_source", "sl_validate", "entity_details"]);
  const sources = loadSourceEntries();

  for (const [roleId, role] of Object.entries(roles)) {
    const allow = role.allow ?? {};
    const tools = Array.isArray(allow.tools) ? allow.tools : [];
    if (tools.includes("*")) add(check, "fail", `webui/config/access.yaml: role ${roleId} allow.tools contains *`);
    for (const tool of tools) {
      if (denyTools.has(tool)) add(check, "fail", `webui/config/access.yaml: role ${roleId} allows globally denied tool ${tool}`);
    }
    const selectors = Array.isArray(allow.tableSelectors) ? allow.tableSelectors : [];
    const connections = Array.isArray(allow.connections) ? allow.connections : [];
    if ((selectors.length > 0 || tools.some((tool) => tableTouching.has(tool))) && connections.length === 0) {
      add(check, "fail", `webui/config/access.yaml: role ${roleId} touches tables but has no allow.connections`);
    }
    for (const selector of selectors) {
      const matches = sources.filter((entry) => selectorMatches(selector, entry));
      if (matches.length === 0) add(check, "fail", `webui/config/access.yaml: role ${roleId} selector matches 0 sources`);
    }
  }

  for (const user of users) {
    if (user.role && !roles[user.role]) add(check, "fail", `webui/config/access.yaml: user ${user.id} references missing role ${user.role}`);
    if (user.role && user.allow) add(check, "warn", `webui/config/access.yaml: user ${user.id} has both role and legacy allow`);
    const wildcard = user.allow?.tables?.includes("*") || user.allow?.tools?.includes("*");
    if (wildcard && user.enabled !== false) add(check, "fail", `webui/config/access.yaml: enabled legacy wildcard user ${user.id}`);
    if (wildcard && user.enabled === false) add(check, "warn", `webui/config/access.yaml: disabled legacy wildcard user ${user.id} must not be re-enabled without role`);
  }

  if (!results.some((item) => item.check === check && item.level === "fail")) {
    add(check, "pass", "access role policy has no blocking errors");
  }
}

const checks = [routeStatus, apiSpec, skillDependency, evalSchemaVersion, accessRolePolicy];
for (const check of checks) {
  try {
    check();
  } catch (error) {
    add(check.name, "fail", `${error.message}`);
  }
}

let failed = false;
for (const item of results) {
  const tag = item.level.toUpperCase();
  if (item.level === "fail") failed = true;
  console.log(`[spec-lint] ${tag} ${item.check}`);
  console.log(`  ${item.message}`);
}

process.exit(failed ? 1 : 0);
