#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const root = process.cwd();
const results = [];

function add(level, message) {
  results.push({ level, message });
}

function rel(file) {
  return path.join(root, file);
}

async function read(relPath) {
  return await readFile(rel(relPath), "utf8");
}

function hasWildcard(list) {
  return Array.isArray(list) && list.includes("*");
}

async function checkAccessConfig() {
  const accessRel = existsSync(rel("webui/config/access.yaml"))
    ? "webui/config/access.yaml"
    : "webui/config/access.yaml.example";
  const config = parse(await read(accessRel)) ?? {};
  const users = Array.isArray(config.users) ? config.users : [];
  const roles = config.roles && typeof config.roles === "object" ? config.roles : {};
  const defaults = config.defaults ?? {};

  if (Object.keys(roles).length === 0) add("fail", `${accessRel}: roles must not be empty`);
  if (users.length === 0) add("fail", `${accessRel}: users must not be empty`);

  for (const user of users) {
    const id = user?.id ?? "<missing>";
    for (const token of Array.isArray(user?.tokens) ? user.tokens : []) {
      if (!/^sha256:[a-f0-9]{64}$/.test(String(token?.hash ?? ""))) {
        add("fail", `${accessRel}: user ${id} has invalid token hash`);
      }
      for (const key of ["token", "secret", "value", "plaintext"]) {
        if (token?.[key] !== undefined) add("fail", `${accessRel}: user ${id} token stores forbidden plaintext field ${key}`);
      }
    }
    if (user?.enabled !== false && (hasWildcard(user?.allow?.tables) || hasWildcard(user?.allow?.tools))) {
      add("fail", `${accessRel}: enabled user ${id} must not use wildcard legacy allow`);
    }
    if (user?.enabled !== false && !user?.role && !user?.allow) {
      add("fail", `${accessRel}: enabled user ${id} has neither role nor allow policy`);
    }
  }

  for (const [roleId, role] of Object.entries(roles)) {
    const allow = role?.allow ?? {};
    if (!Array.isArray(allow.tools) || allow.tools.length === 0) add("fail", `${accessRel}: role ${roleId} must declare allow.tools`);
    if (!Array.isArray(allow.connections) || allow.connections.length === 0) add("fail", `${accessRel}: role ${roleId} must declare allow.connections`);
    if (!Array.isArray(allow.tableSelectors) || allow.tableSelectors.length === 0) add("fail", `${accessRel}: role ${roleId} must declare allow.tableSelectors`);
  }

  const denyTools = new Set(Array.isArray(defaults.deny_tools) ? defaults.deny_tools : []);
  for (const tool of ["sql_execution", "sql_dialect_notes", "memory_ingest", "memory_ingest_status"]) {
    if (!denyTools.has(tool)) add("fail", `${accessRel}: defaults.deny_tools must include ${tool}`);
  }
  if (!Array.isArray(defaults.known_tools) || defaults.known_tools.length === 0) add("fail", `${accessRel}: defaults.known_tools must be explicit`);
  if (!Array.isArray(defaults.table_touching_tools) || defaults.table_touching_tools.length === 0) add("fail", `${accessRel}: defaults.table_touching_tools must be explicit`);
  if (!Array.isArray(defaults.sensitive_table_prefixes) || defaults.sensitive_table_prefixes.length === 0) add("warn", `${accessRel}: defaults.sensitive_table_prefixes is empty`);
}

async function checkProxySecurityHooks() {
  const identity = await read("webui/server/proxy/identity.ts");
  const acl = await read("webui/server/proxy/acl.ts");
  const audit = await read("webui/server/proxy/audit.ts");
  const mcpProxy = await read("webui/server/proxy/mcp-proxy.ts");

  if (!identity.includes("isTokenRevoked")) add("fail", "identity.ts must check revoked tokens");
  if (!acl.includes("agent_disabled")) add("fail", "acl.ts must reject disabled agents");
  if (!acl.includes("raw_query_forbidden")) add("fail", "acl.ts must reject raw query/sql arguments");
  if (!acl.includes("sensitiveMetadataTools")) add("fail", "acl.ts must classify sensitive metadata tools");
  if (!audit.includes("revoked_tokens")) add("fail", "audit.ts must persist revoked tokens");
  if (!audit.includes("permission_snapshots")) add("fail", "audit.ts must persist permission snapshots");
  if (!audit.includes("truncateErrorDetail")) add("fail", "audit.ts must truncate error details");
  if (!mcpProxy.includes("writeLog")) add("fail", "mcp-proxy.ts must write audit logs");
}

async function checkSecretsAndDocs() {
  const dockerignore = await read(".dockerignore");
  const ignoredPatterns = dockerignore.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const ignoresKtxSecrets = ignoredPatterns.includes(".ktx") || ignoredPatterns.includes(".ktx/secrets") || ignoredPatterns.includes(".ktx/secrets/");
  const ignoresKtxUi = ignoredPatterns.includes(".ktx-ui") || ignoredPatterns.some((pattern) => pattern.startsWith(".ktx-ui/*.sqlite"));
  if (!ignoresKtxSecrets) add("fail", ".dockerignore must exclude .ktx secrets");
  if (!ignoresKtxUi) add("fail", ".dockerignore must exclude .ktx-ui sqlite/audit files");
  for (const pattern of ["ktx.yaml", "inbox", "secrets", "release"]) {
    if (!ignoredPatterns.includes(pattern)) {
      add("fail", `.dockerignore must exclude ${pattern}`);
    }
  }

  for (const file of [
    "docs/security-guide.md",
    "docs/customer-deployment-guide.md",
    "docs/deployment-docker.md",
    "docker-compose.secrets.yml",
    "webui/docs/07-mcp-auth-proxy-spec.md"
  ]) {
    if (!existsSync(rel(file))) add("fail", `${file} must exist`);
  }
}

async function main() {
  await checkAccessConfig();
  await checkProxySecurityHooks();
  await checkSecretsAndDocs();

  const failCount = results.filter((item) => item.level === "fail").length;
  const warnCount = results.filter((item) => item.level === "warn").length;
  for (const item of results) {
    console.log(`[security-baseline] ${item.level.toUpperCase()} ${item.message}`);
  }
  if (failCount > 0) {
    console.error(`[security-baseline] FAIL ${failCount} blocking issue(s), ${warnCount} warning(s)`);
    process.exit(1);
  }
  console.log(`[security-baseline] PASS ${warnCount} warning(s)`);
}

main().catch((error) => {
  console.error(`[security-baseline] FAIL: ${error.message}`);
  process.exit(1);
});
