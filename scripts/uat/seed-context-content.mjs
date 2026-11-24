#!/usr/bin/env node
/**
 * UAT-SUITE-CONTEXT-CONTENT seed + R0-SEED probes.
 * Tracked entry: scripts/uat/seed-context-content.mjs (re-run support).
 * Secrets stay in /tmp and process memory; evidence JSON has fingerprints only.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEBUI = process.env.LUCY_WEBUI_URL || "http://127.0.0.1:55176";
const MCP = process.env.LUCY_MCP_URL || "http://127.0.0.1:57881/mcp";
const CRED =
  process.env.LUCY_WEBUI_LOGIN_FILE ||
  "/Users/forrest/Projects/config-for-agents/lucywebui logi.txt";
const WORK = "/tmp/uat-ctx-content-work";
const EVIDENCE = path.join(ROOT, "inbox/uat-ctx-content-2026-11-15");
const QUESTION = "UAT context content canary question for skill retrieval";
const CTX_TOOLS = ["wiki_search", "wiki_read", "lucy_skill_search", "lucy_skill_read"];

mkdirSync(WORK, { recursive: true });
mkdirSync(EVIDENCE, { recursive: true });
chmodSync(WORK, 0o700);

const runNonce = randomBytes(4).toString("hex"); // 8 hex
const gold = String(10000 + (randomBytes(2).readUInt16BE(0) % 90000));
const nonceBody = `UAT-CTX-BODY-${runNonce}`;
const ids = {
  allowRole: `uat-ctx-allow-${runNonce}`,
  nochanRole: `uat-ctx-nochan-${runNonce}`,
  noaclRole: `uat-ctx-noacl-${runNonce}`,
  allowAgent: `uca-${runNonce}`,
  nochanAgent: `ucn-${runNonce}`,
  noaclAgent: `ucd-${runNonce}`,
  wikiKey: `uat-ctx-wiki-${runNonce}.md`,
  skillDomain: "uat-ctx",
  skillName: `skill-${runNonce}`,
  skillUri: `lucy-skill://uat-ctx/skill-${runNonce}`
};

function sha12(s) {
  return createHash("sha256").update(String(s)).digest("hex").slice(0, 12);
}

function readLogin() {
  const lines = readFileSync(CRED, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // Non-empty lines: 1=account, 2=spare, 3=password (per workspace rule)
  if (lines.length < 3) throw new Error(`login file needs ≥3 non-empty lines: ${CRED}`);
  return { adminId: lines[0], password: lines[2] };
}

const cookieJar = { value: "" };

async function api(method, urlPath, body, { raw = false } = {}) {
  const headers = { Accept: "application/json" };
  if (cookieJar.value) headers.Cookie = cookieJar.value;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${WEBUI}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
  const set = res.headers.getSetCookie?.() || [];
  for (const c of set) {
    const m = String(c).match(/^(lucy_admin_session=[^;]+)/);
    if (m) cookieJar.value = m[1];
  }
  // fallback: single set-cookie header
  const sc = res.headers.get("set-cookie");
  if (sc) {
    const m = sc.match(/(lucy_admin_session=[^;]+)/);
    if (m) cookieJar.value = m[1];
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  if (raw) return { status: res.status, json, text };
  return { status: res.status, json };
}

async function mcp(token, method, params = {}, id = 1) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // SSE-ish: take last data json line
    const lines = text.split("\n").filter((l) => l.startsWith("data:"));
    for (const line of lines.reverse()) {
      try {
        json = JSON.parse(line.slice(5).trim());
        break;
      } catch {
        /* continue */
      }
    }
  }
  return { httpStatus: res.status, json, textPreview: text.slice(0, 400) };
}

function toolNamesFromList(listJson) {
  const tools = listJson?.result?.tools || listJson?.result?.result?.tools || [];
  return tools.map((t) => t.name).filter(Boolean);
}

function toolResultText(callJson) {
  const content = callJson?.result?.content || callJson?.result?.result?.content || [];
  return content
    .map((c) => c?.text || "")
    .join("\n");
}

function isErrorCall(callJson) {
  return Boolean(callJson?.result?.isError || callJson?.error || callJson?.result?.result?.isError);
}

function rpcErrorCode(callJson) {
  return callJson?.error?.code ?? callJson?.result?.error?.code ?? null;
}

async function main() {
  const evidence = {
    suiteId: "UAT-SUITE-CONTEXT-CONTENT",
    poolId: "P1-30",
    gitSha: null,
    runNonceFp: sha12(runNonce),
    goldFp: sha12(gold),
    nonceBodyFp: sha12(nonceBody),
    ids: { ...ids },
    question: QUESTION,
    credPath: CRED,
    steps: [],
    seed: {},
    r0Seed: {},
    tokens: {}
  };

  const health = await api("GET", "/api/health");
  evidence.gitSha = health.json?.data?.gitSha || health.json?.gitSha || null;
  evidence.steps.push({ step: "health", status: health.status, gitSha: evidence.gitSha });

  const { adminId, password } = readLogin();
  const login = await api("POST", "/api/auth/login", { adminId, password });
  if (login.status !== 200 || !cookieJar.value) {
    throw new Error(`login failed status=${login.status} cookie=${Boolean(cookieJar.value)}`);
  }
  evidence.steps.push({ step: "login", status: login.status, me: login.json?.data?.me?.id || login.json?.me?.id });

  async function createRole(roleId, tools) {
    const body = {
      dryRun: false,
      roleId,
      role: {
        description: `UAT context-content ${roleId}`,
        permission_model_version: 2,
        allow: { tools }
      }
    };
    const r = await api("POST", "/api/admin/roles", body);
    evidence.steps.push({ step: `role:${roleId}`, status: r.status, ok: r.json?.ok, code: r.json?.error?.code || r.json?.code });
    if (r.status >= 400 || r.json?.ok === false) throw new Error(`role create failed ${roleId}: ${JSON.stringify(r.json).slice(0, 400)}`);
    return r;
  }

  async function createAgent(agentId, roleId) {
    const body = {
      dryRun: false,
      agent: { id: agentId, name: `UAT ${agentId}`, roles: [roleId] }
    };
    const r = await api("POST", "/api/admin/agents", body);
    evidence.steps.push({ step: `agent:${agentId}`, status: r.status, ok: r.json?.ok, code: r.json?.error?.code || r.json?.code });
    if (r.status >= 400 || r.json?.ok === false) throw new Error(`agent create failed ${agentId}: ${JSON.stringify(r.json).slice(0, 400)}`);
    return r;
  }

  async function createToken(agentId, label) {
    const body = { dryRun: false, label, device_name: "uat-ctx-content", expires_in: "30d" };
    const r = await api("POST", `/api/admin/agents/${agentId}/tokens`, body);
    const token =
      r.json?.data?.token ||
      r.json?.token ||
      r.json?.data?.plainToken ||
      r.json?.plain_token ||
      null;
    if (r.status >= 400 || !token) {
      throw new Error(`token create failed ${agentId}: status=${r.status} ${JSON.stringify(r.json).slice(0, 500)}`);
    }
    const fp = sha12(token);
    const file = path.join(WORK, `${label}.txt`);
    writeFileSync(file, token, { mode: 0o600 });
    evidence.tokens[label] = { agentId, fp, file };
    evidence.steps.push({ step: `token:${label}`, status: r.status, fp });
    return token;
  }

  await createRole(ids.allowRole, CTX_TOOLS);
  await createRole(ids.nochanRole, ["connection_list"]);
  await createRole(ids.noaclRole, CTX_TOOLS);
  await createAgent(ids.allowAgent, ids.allowRole);
  await createAgent(ids.nochanAgent, ids.nochanRole);
  await createAgent(ids.noaclAgent, ids.noaclRole);
  const allowTok = await createToken(ids.allowAgent, "allow");
  const nochanTok = await createToken(ids.nochanAgent, "nochan");
  const noaclTok = await createToken(ids.noaclAgent, "noacl");

  const wikiContent = [
    `# UAT Context Wiki`,
    ``,
    `Canary body marker: ${nonceBody}`,
    `Numeric gold (observation only): ${gold}`,
    `Short tip: answer with the canary body marker when asked about UAT context content wiki.`
  ].join("\n");

  const wikiPut = await api("PUT", `/api/wiki/${ids.wikiKey}`, {
    dryRun: false,
    frontmatter: { allowed_roles: [ids.allowRole] },
    content: wikiContent
  });
  evidence.steps.push({
    step: "wiki_put",
    status: wikiPut.status,
    ok: wikiPut.json?.ok,
    code: wikiPut.json?.error?.code || wikiPut.json?.code
  });
  if (wikiPut.status >= 400) throw new Error(`wiki put failed: ${JSON.stringify(wikiPut.json).slice(0, 500)}`);

  const wikiGet = await api("GET", `/api/wiki/${ids.wikiKey}`);
  evidence.steps.push({ step: "wiki_get", status: wikiGet.status });

  const skillPost = await api("POST", "/api/skills", {
    domain: ids.skillDomain,
    name: ids.skillName,
    title: `UAT Context Skill ${runNonce}`,
    status: "published",
    roles_allowed: [ids.allowRole],
    triggers: [QUESTION],
    description: "UAT context content skill for retrieval canary",
    content: [
      `# UAT Context Skill`,
      ``,
      `Canary body marker: ${nonceBody}`,
      `Numeric gold (observation only): ${gold}`,
      `When asked the canary question, include the canary body marker in the answer.`
    ].join("\n")
  });
  evidence.steps.push({
    step: "skill_post",
    status: skillPost.status,
    ok: skillPost.json?.ok,
    code: skillPost.json?.error?.code || skillPost.json?.code
  });
  if (skillPost.status >= 400) throw new Error(`skill post failed: ${JSON.stringify(skillPost.json).slice(0, 600)}`);

  const skillGet = await api("GET", `/api/skills/${ids.skillDomain}/${ids.skillName}`);
  const skillStatus =
    skillGet.json?.data?.status || skillGet.json?.status || skillGet.json?.data?.skill?.status;
  const skillRoles =
    skillGet.json?.data?.roles_allowed ||
    skillGet.json?.roles_allowed ||
    skillGet.json?.data?.skill?.roles_allowed;
  evidence.steps.push({ step: "skill_get", status: skillGet.status, skillStatus, skillRoles });
  if (skillStatus !== "published") throw new Error(`skill status not published: ${skillStatus}`);

  // --- R0-SEED MCP probes ---
  const allowInit = await mcp(allowTok, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "uat-ctx-content", version: "1.0.0" }
  });
  const allowList = await mcp(allowTok, "tools/list", {}, 2);
  const allowNames = toolNamesFromList(allowList.json);
  const allowWiki = await mcp(
    allowTok,
    "tools/call",
    { name: "wiki_read", arguments: { key: ids.wikiKey } },
    3
  );
  const allowWikiText = toolResultText(allowWiki.json);
  const allowSkill = await mcp(
    allowTok,
    "tools/call",
    { name: "lucy_skill_read", arguments: { skill_name: ids.skillUri } },
    4
  );
  const allowSkillText = toolResultText(allowSkill.json);

  const nochanList = await mcp(nochanTok, "tools/list", {}, 2);
  const nochanNames = toolNamesFromList(nochanList.json);
  const nochanCall = await mcp(
    nochanTok,
    "tools/call",
    { name: "wiki_read", arguments: { key: ids.wikiKey } },
    3
  );

  const noaclList = await mcp(noaclTok, "tools/list", {}, 2);
  const noaclNames = toolNamesFromList(noaclList.json);
  const noaclCall = await mcp(
    noaclTok,
    "tools/call",
    { name: "wiki_read", arguments: { key: ids.wikiKey } },
    3
  );
  const noaclSkill = await mcp(
    noaclTok,
    "tools/call",
    { name: "lucy_skill_read", arguments: { skill_name: ids.skillUri } },
    4
  );

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const audit = await api(
    "GET",
    `/api/admin/audit?user=${encodeURIComponent(ids.allowAgent)}&tool=wiki_read&since=${encodeURIComponent(since)}&limit=20`
  );

  const checks = {
    allow_has_four_tools: CTX_TOOLS.every((t) => allowNames.includes(t)),
    allow_wiki_has_nonce: allowWikiText.includes(nonceBody),
    allow_skill_has_nonce: allowSkillText.includes(nonceBody),
    nochan_missing_ctx_tools: CTX_TOOLS.every((t) => !nochanNames.includes(t)),
    nochan_call_rejected: isErrorCall(nochanCall.json) || nochanCall.httpStatus === 403 || rpcErrorCode(nochanCall.json) === -32003,
    noacl_has_four_tools: CTX_TOOLS.every((t) => noaclNames.includes(t)),
    noacl_wiki_rejected: isErrorCall(noaclCall.json),
    noacl_skill_rejected: isErrorCall(noaclSkill.json),
    allow_init_ok: allowInit.httpStatus === 200 || Boolean(allowInit.json?.result)
  };

  evidence.r0Seed = {
    checks,
    allowToolCount: allowNames.length,
    allowNames,
    nochanNames,
    noaclNames,
    allowWikiHasNonce: checks.allow_wiki_has_nonce,
    allowSkillHasNonce: checks.allow_skill_has_nonce,
    nochanCall: {
      httpStatus: nochanCall.httpStatus,
      isError: isErrorCall(nochanCall.json),
      code: rpcErrorCode(nochanCall.json),
      preview: toolResultText(nochanCall.json).slice(0, 200)
    },
    noaclCall: {
      httpStatus: noaclCall.httpStatus,
      isError: isErrorCall(noaclCall.json),
      preview: toolResultText(noaclCall.json).slice(0, 200)
    },
    auditStatus: audit.status,
    auditSampleCount: Array.isArray(audit.json?.data) ? audit.json.data.length : audit.json?.items?.length || null
  };

  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  evidence.r0Seed.failed = failed;
  evidence.r0Seed.pass = failed.length === 0;

  // Persist meta for hosts (no raw nonce in tracked paths — only under inbox which is gitignored)
  writeFileSync(
    path.join(WORK, "meta.json"),
    JSON.stringify(
      {
        runNonce,
        nonceBody,
        gold,
        question: QUESTION,
        ids,
        mcpUrl: MCP,
        webui: WEBUI,
        gitSha: evidence.gitSha,
        tokenFiles: evidence.tokens
      },
      null,
      2
    ) + "\n",
    { mode: 0o600 }
  );
  writeFileSync(path.join(EVIDENCE, "seed-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  writeFileSync(
    path.join(EVIDENCE, "fingerprint.txt"),
    `runNonceFp=${evidence.runNonceFp}\nnonceBodyFp=${evidence.nonceBodyFp}\ngoldFp=${evidence.goldFp}\n`
  );

  console.log(JSON.stringify({ ok: evidence.r0Seed.pass, failed, runNonceFp: evidence.runNonceFp, gitSha: evidence.gitSha, work: WORK }, null, 2));
  if (!evidence.r0Seed.pass) process.exit(2);
}

main().catch((err) => {
  console.error("SEED_FAIL", err?.message || err);
  process.exit(1);
});
