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

function accessConfigRelPath() {
  if (existsSync(rel("webui/config/access.yaml"))) return "webui/config/access.yaml";
  return "webui/config/access.yaml.example";
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
  const accessPath = accessConfigRelPath();
  const config = parse(read(accessPath)) ?? {};
  const roles = config.roles ?? {};
  const users = Array.isArray(config.users) ? config.users : [];
  const denyTools = new Set(config.defaults?.deny_tools ?? []);
  const tableTouching = new Set(config.defaults?.table_touching_tools ?? ["sl_query", "sl_read_source", "sl_validate", "entity_details"]);
  const sources = loadSourceEntries();
  const topLevelKeys = new Set(["roles", "users", "defaults"]);
  const roleKeys = new Set(["description", "permission_model_version", "allow"]);
  const roleAllowKeys = new Set(["connections", "tableSelectors", "tools", "source_scope"]);
  // row_policy listed so "all"+row_policy can be rejected explicitly; scoped+row_policy
  // remains blocked by the scoped Gate-B gate below until WP-I1.
  const selectorKeys = new Set(["connection", "schema", "names", "prefix", "row_access", "row_policy"]);
  const userKeys = new Set(["id", "name", "note", "enabled", "role", "roles", "tokens", "allow", "constraints"]);
  const userAllowKeys = new Set(["tables", "tools", "connections"]);
  const tokenKeys = new Set(["hash", "label", "created", "expires_at"]);
  const defaultsKeys = new Set([
    "deny_tools",
    "known_tools",
    "table_touching_tools",
    "sensitive_metadata_tools",
    "sensitive_table_prefixes"
  ]);
  const constraintBindingKeys = new Set(["connection", "schema", "names", "predicates"]);

  checkAllowedKeys(check, config, topLevelKeys, "top level");
  checkAllowedKeys(check, config.defaults, defaultsKeys, "defaults");

  for (const [roleId, role] of Object.entries(roles)) {
    if (role && typeof role === "object" && Object.prototype.hasOwnProperty.call(role, "constraints")) {
      add(
        check,
        "fail",
        `webui/config/access.yaml: role ${roleId} contains 'constraints' (constraints_forbidden_on_role; Spec 100)`
      );
    }
    checkAllowedKeys(check, role, roleKeys, `role ${roleId}`);
    const allow = role.allow ?? {};
    checkAllowedKeys(check, allow, roleAllowKeys, `role ${roleId}.allow`);
    // Spec 98 §7 — generation is explicit; a missing field is only tolerated
    // inside the AC-P0 migration window (warn), and becomes fail afterwards.
    const modelVersion = role.permission_model_version;
    if (modelVersion === undefined) {
      add(check, "warn", `webui/config/access.yaml: role ${roleId} has no permission_model_version (migration window)`);
    } else if (modelVersion !== 1 && modelVersion !== 2) {
      add(check, "fail", `webui/config/access.yaml: role ${roleId} permission_model_version must be 1 or 2`);
    }
    const tools = Array.isArray(allow.tools) ? allow.tools : [];
    if (tools.includes("*")) add(check, "fail", `webui/config/access.yaml: role ${roleId} allow.tools contains *`);
    // Spec 98 / 131 — AbsoluteDeny + unclassified fail closed (must match webui/server/proxy/acl.ts).
    const absoluteDenyTools = new Set([
      "sl_query",
      "sl_read_source",
      "sql_execution",
      "sql_dialect_notes",
      "memory_ingest",
      "memory_ingest_status"
    ]);
    const classifiedRoleTools = new Set([
      "lucy_query",
      "lucy_read_source",
      "lucy_explain_query",
      "lucy_freshness",
      "entity_details",
      "sl_validate",
      "dictionary_search",
      "discover_data",
      "lucy_catalog",
      "kx_catalog",
      "connection_list",
      "wiki_search",
      "wiki_read",
      "lucy_begin_question",
      "lucy_skill_search",
      "lucy_skill_read"
    ]);
    for (const tool of tools) {
      if (denyTools.has(tool)) add(check, "fail", `webui/config/access.yaml: role ${roleId} allows globally denied tool ${tool}`);
      if (absoluteDenyTools.has(tool)) {
        add(check, "fail", `webui/config/access.yaml: role ${roleId} allow.tools contains AbsoluteDeny tool ${tool}`);
      } else if (!classifiedRoleTools.has(tool)) {
        add(check, "fail", `webui/config/access.yaml: role ${roleId} allow.tools contains unclassified tool ${tool}`);
      }
    }
    const sourceScope = typeof allow.source_scope === "string" ? allow.source_scope.trim() : undefined;
    if (sourceScope !== undefined && sourceScope !== "catalog_bound") {
      add(check, "fail", `webui/config/access.yaml: role ${roleId} allow.source_scope must be catalog_bound when set`);
    }
    const catalogBound = sourceScope === "catalog_bound";
    if (catalogBound && modelVersion !== 2) {
      add(check, "fail", `webui/config/access.yaml: role ${roleId} catalog_bound requires permission_model_version 2`);
    }
    const selectors = Array.isArray(allow.tableSelectors) ? allow.tableSelectors : [];
    const connections = Array.isArray(allow.connections) ? allow.connections : [];
    if (catalogBound && selectors.length > 0) {
      add(check, "fail", `webui/config/access.yaml: role ${roleId} catalog_bound forbids tableSelectors`);
    }
    if ((catalogBound || selectors.length > 0 || tools.some((tool) => tableTouching.has(tool))) && connections.length === 0) {
      add(check, "fail", `webui/config/access.yaml: role ${roleId} touches tables but has no allow.connections`);
    }
    if (catalogBound) {
      // Source membership is resolved at runtime against enabled_tables; lint only checks shape.
      continue;
    }
    for (const selector of selectors) {
      checkAllowedKeys(check, selector, selectorKeys, `role ${roleId}.allow.tableSelectors[]`);
      const rowAccess = selector.row_access;
      if (rowAccess !== undefined && rowAccess !== "all" && rowAccess !== "scoped") {
        add(check, "fail", `webui/config/access.yaml: role ${roleId} selector row_access must be 'all' or 'scoped'`);
      }
      // Spec 99 §7 — generation 1 has no scoped / row_policy.
      if (
        (modelVersion === 1 || modelVersion === undefined) &&
        (rowAccess === "scoped" || selector.row_policy !== undefined)
      ) {
        add(
          check,
          "fail",
          `webui/config/access.yaml: role ${roleId} selector uses scoped/row_policy, which permission_model_version 1 forbids`
        );
      }
      // Spec 99 §11 / Gate B — scoped requires structural row_policy (op ∈ {eq,in}); all+row_policy fails.
      if (rowAccess === "scoped") {
        const policy = selector.row_policy;
        if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
          add(check, "fail", `webui/config/access.yaml: role ${roleId} scoped selector requires row_policy`);
        } else {
          const predicates = policy.predicates;
          if (!Array.isArray(predicates) || predicates.length === 0) {
            add(check, "fail", `webui/config/access.yaml: role ${roleId} row_policy.predicates must be a non-empty array`);
          } else {
            for (const pred of predicates) {
              if (!pred || typeof pred !== "object" || Array.isArray(pred)) {
                add(check, "fail", `webui/config/access.yaml: role ${roleId} row_policy predicate must be an object`);
                continue;
              }
              if (typeof pred.field !== "string" || !pred.field.trim()) {
                add(check, "fail", `webui/config/access.yaml: role ${roleId} row_policy predicate field is required`);
              }
              if (pred.op !== "eq" && pred.op !== "in") {
                add(check, "fail", `webui/config/access.yaml: role ${roleId} row_policy op must be eq|in`);
              }
            }
          }
        }
      }
      if (selector.row_policy !== undefined && rowAccess !== "scoped") {
        add(
          check,
          "fail",
          `webui/config/access.yaml: role ${roleId} selector row_policy is only valid with row_access 'scoped'`
        );
      }
      if (modelVersion === 2 && selector.prefix !== undefined) {
        add(check, "fail", `webui/config/access.yaml: role ${roleId} selector uses prefix, which v2 forbids`);
      }
      if (modelVersion === 2 && rowAccess === undefined) {
        add(check, "fail", `webui/config/access.yaml: role ${roleId} selector is missing row_access, which v2 requires`);
      }
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
    // Spec 100 — Agent constraints shape (catalog/capability binding is runtime compile).
    if (user && typeof user === "object" && Object.prototype.hasOwnProperty.call(user, "constraints")) {
      const constraints = user.constraints;
      if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) {
        add(check, "fail", `webui/config/access.yaml: user ${user.id ?? "<missing id>"} constraints must be an object (Spec 100)`);
      } else {
        const sources = constraints.sources;
        if (!Array.isArray(sources) || sources.length === 0) {
          add(check, "fail", `webui/config/access.yaml: user ${user.id ?? "<missing id>"} constraints.sources must be a non-empty array (Spec 100)`);
        } else {
          for (const [index, binding] of sources.entries()) {
            if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
              add(check, "fail", `webui/config/access.yaml: user ${user.id} constraints.sources[${index}] must be an object`);
              continue;
            }
            checkAllowedKeys(check, binding, constraintBindingKeys, `user ${user.id}.constraints.sources[${index}]`);
            if (binding.prefix !== undefined) {
              add(check, "fail", `webui/config/access.yaml: user ${user.id} constraints.sources[${index}] forbids prefix`);
            }
            if (!Array.isArray(binding.names) || binding.names.length === 0) {
              add(check, "fail", `webui/config/access.yaml: user ${user.id} constraints.sources[${index}] names must be a non-empty array`);
            }
            const predicates = binding.predicates;
            if (!Array.isArray(predicates) || predicates.length === 0) {
              add(check, "fail", `webui/config/access.yaml: user ${user.id} constraints.sources[${index}] predicates must be a non-empty array`);
            } else {
              for (const pred of predicates) {
                if (!pred || typeof pred !== "object" || Array.isArray(pred)) {
                  add(check, "fail", `webui/config/access.yaml: user ${user.id} constraints predicate must be an object`);
                  continue;
                }
                if (typeof pred.field !== "string" || !pred.field.trim()) {
                  add(check, "fail", `webui/config/access.yaml: user ${user.id} constraints predicate field is required`);
                }
                if (pred.op !== "eq" && pred.op !== "in") {
                  add(check, "fail", `webui/config/access.yaml: user ${user.id} constraints predicate op must be eq|in`);
                }
              }
            }
          }
        }
      }
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
