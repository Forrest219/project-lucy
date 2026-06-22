#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const root = process.cwd();
const results = [];
let scriptError = false;

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
  const routePaths = new Set([...app.matchAll(/<Route\b[^>]*\bpath=["'`]([^"'`]+)["'`]/g)].map((match) => match[1]));
  const navTargets = new Set([...app.matchAll(/\bto:\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1]));
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
    const routeRegistered = routePaths.has(route) || routePaths.has(routePath) || navTargets.has(route);
    if (!routeRegistered) {
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
    ...walk("webui/server/eval", (file) => file.endsWith(".ts")),
    ...walk("webui/server/proxy", (file) => file.endsWith(".ts"))
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

function listField(value) {
  return Array.isArray(value) ? value : [];
}

function validateQuizLinks(check, file, doc) {
  const cases = Array.isArray(doc.cases) ? doc.cases : [];
  const quizCases = Array.isArray(doc.quiz_cases) ? doc.quiz_cases : [];
  const caseIds = new Set(cases.map((item) => item?.id).filter((id) => typeof id === "string"));
  const quizIds = new Set(quizCases.map((item) => item?.id).filter((id) => typeof id === "string"));

  if (doc.metadata?.paired_quiz && quizCases.length === 0) {
    add(check, "fail", `${file}: metadata.paired_quiz is set but quiz_cases is missing or empty`);
  }

  for (const quizCase of quizCases) {
    const quizId = typeof quizCase?.id === "string" ? quizCase.id : "<missing quiz id>";
    if (quizCase?.eval_refs !== undefined && !Array.isArray(quizCase.eval_refs)) {
      add(check, "fail", `${file}: quiz ${quizId} eval_refs must be an array`);
      continue;
    }
    for (const ref of listField(quizCase?.eval_refs)) {
      if (typeof ref !== "string" || !caseIds.has(ref)) {
        add(check, "fail", `${file}: quiz ${quizId} eval_refs references missing case ${ref}`);
      }
    }
  }

  for (const evalCase of cases) {
    const caseId = typeof evalCase?.id === "string" ? evalCase.id : "<missing case id>";
    if (evalCase?.linked_quiz_questions !== undefined && !Array.isArray(evalCase.linked_quiz_questions)) {
      add(check, "fail", `${file}: case ${caseId} linked_quiz_questions must be an array`);
      continue;
    }
    for (const ref of listField(evalCase?.linked_quiz_questions)) {
      if (typeof ref !== "string" || !quizIds.has(ref)) {
        add(check, "fail", `${file}: case ${caseId} linked_quiz_questions references missing quiz ${ref}`);
      }
    }
  }
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
    validateQuizLinks(check, file, doc);
  }
  if (!results.some((item) => item.check === check && item.level === "fail")) {
    add(check, "pass", `${files.length} eval files are readable with safety_contract and valid quiz links`);
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

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function checkAllowedKeys(check, object, allowed, location) {
  if (!isObject(object)) return;
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      add(check, "fail", `webui/config/access.yaml: ${location} contains unsupported field ${key}`);
    }
  }
}

function accessRolePolicy() {
  const check = "access-role-policy";
  const config = parse(read("webui/config/access.yaml")) ?? {};
  const roles = config.roles ?? {};
  const users = Array.isArray(config.users) ? config.users : [];
  const denyTools = new Set(config.defaults?.deny_tools ?? []);
  const tableTouching = new Set(config.defaults?.table_touching_tools ?? ["sl_query", "sl_read_source", "sl_validate", "entity_details"]);
  const sources = loadSourceEntries();
  const topLevelKeys = new Set(["roles", "users", "defaults"]);
  const roleKeys = new Set(["description", "allow"]);
  const roleAllowKeys = new Set(["connections", "tableSelectors", "tools"]);
  const selectorKeys = new Set(["connection", "schema", "names", "prefix"]);
  const userKeys = new Set(["id", "name", "note", "enabled", "role", "tokens", "allow"]);
  const userAllowKeys = new Set(["tables", "tools", "connections"]);
  const tokenKeys = new Set(["hash", "label", "created", "expires_at"]);
  const defaultsKeys = new Set([
    "deny_tools",
    "known_tools",
    "table_touching_tools",
    "sensitive_metadata_tools",
    "sensitive_table_prefixes"
  ]);

  checkAllowedKeys(check, config, topLevelKeys, "top level");
  checkAllowedKeys(check, config.defaults, defaultsKeys, "defaults");

  for (const [roleId, role] of Object.entries(roles)) {
    checkAllowedKeys(check, role, roleKeys, `role ${roleId}`);
    const allow = role.allow ?? {};
    checkAllowedKeys(check, allow, roleAllowKeys, `role ${roleId}.allow`);
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
      checkAllowedKeys(check, selector, selectorKeys, `role ${roleId}.allow.tableSelectors[]`);
      const matches = sources.filter((entry) => selectorMatches(selector, entry));
      if (matches.length === 0) add(check, "fail", `webui/config/access.yaml: role ${roleId} selector matches 0 sources`);
    }
  }

  for (const user of users) {
    checkAllowedKeys(check, user, userKeys, `user ${user.id ?? "<missing id>"}`);
    checkAllowedKeys(check, user.allow, userAllowKeys, `user ${user.id ?? "<missing id>"}.allow`);
    for (const token of Array.isArray(user.tokens) ? user.tokens : []) {
      checkAllowedKeys(check, token, tokenKeys, `user ${user.id ?? "<missing id>"}.tokens[]`);
    }
    if (user.role && !roles[user.role]) add(check, "fail", `webui/config/access.yaml: user ${user.id} references missing role ${user.role}`);
    if (user.role && user.allow) add(check, "warn", `webui/config/access.yaml: user ${user.id} has both role and legacy allow`);
    if (!user.role && user.allow && user.enabled !== false) add(check, "warn", `webui/config/access.yaml: enabled legacy allow user ${user.id} should migrate to role`);
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
    scriptError = true;
    add(check.name, "error", `${error.message}`);
  }
}

let failed = false;
for (const item of results) {
  const tag = item.level.toUpperCase();
  if (item.level === "fail") failed = true;
  if (item.level === "error") scriptError = true;
  console.log(`[spec-lint] ${tag} ${item.check}`);
  console.log(`  ${item.message}`);
}

process.exit(scriptError ? 2 : failed ? 1 : 0);
