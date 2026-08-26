#!/usr/bin/env node
/**
 * Optional Agent Chat (A3) packaging / live smoke (M0).
 *
 * Default: static checks (compose, pin format docs, memory-off, loopback, …).
 * --live: runtime probes; missing deps/credentials => blocked (exit 2).
 * Never a Lucy headless / SOW hard gate.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = "inbox/agent-chat-a3-smoke-evidence.json";

/** repository:tag@sha256:<64 hex> */
export const PINNED_IMAGE_RE = /^[^@\s\/]+(?:\/[^@\s]+)*:[^@\s]+@sha256:[a-fA-F0-9]{64}$/;

export const ALLOWED_LUCY_DATA_TOOLS = new Set([
  "lucy_catalog",
  "lucy_read_source",
  "lucy_query",
  "lucy_explain_query",
  "lucy_freshness",
  "lucy_begin_question"
]);

export function isPinnedImageRef(value) {
  return typeof value === "string" && PINNED_IMAGE_RE.test(value.trim());
}

export function parseDotEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

export function mcpUrlPolicy(url) {
  if (typeof url !== "string" || !url.trim()) return { ok: false, reason: "empty" };
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (u.protocol === "https:") return { ok: true, mode: "https" };
  if (u.protocol !== "http:") return { ok: false, reason: "bad-protocol" };
  const host = u.hostname.toLowerCase();
  const allowed =
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "host.docker.internal" ||
    host.endsWith(".internal");
  if (allowed) return { ok: true, mode: "http-local" };
  return { ok: false, reason: "http-requires-https-for-remote" };
}

export function countMeaningfulSseDeltas(sseText) {
  let count = 0;
  let framing = false;
  let completed = false;
  for (const line of String(sseText).split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      framing = true;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      if (payload === "[DONE]") {
        completed = true;
        continue;
      }
      try {
        const obj = JSON.parse(payload);
        const delta =
          obj?.choices?.[0]?.delta?.content ??
          obj?.choices?.[0]?.message?.content ??
          obj?.delta?.content ??
          obj?.data?.content ??
          obj?.content ??
          "";
        if (typeof delta === "string" && delta.trim().length > 0) count += 1;
        if (
          obj?.completed === true ||
          obj?.done === true ||
          obj?.data?.done === true ||
          obj?.choices?.some?.((choice) => choice?.finish_reason != null)
        ) {
          completed = true;
        }
      } catch {
        // Malformed/heartbeat frames are framing evidence only, never content.
      }
    }
  }
  return { framing, meaningfulDeltaCount: count, completed };
}

export function assertStreamEvidence({ sseText, completed }) {
  const parsed = countMeaningfulSseDeltas(sseText ?? "");
  const { framing, meaningfulDeltaCount } = parsed;
  const completedOk = parsed.completed && completed !== false;
  if (!framing) return { ok: false, reason: "no-sse-framing", meaningfulDeltaCount };
  if (!completedOk) return { ok: false, reason: "not-completed", meaningfulDeltaCount };
  if (meaningfulDeltaCount < 1) return { ok: false, reason: "no-meaningful-delta", meaningfulDeltaCount };
  return { ok: true, meaningfulDeltaCount, framing: true, completed: true };
}

export function evaluateCallableTools(callableToolNames, allowList = ALLOWED_LUCY_DATA_TOOLS) {
  const names = [...new Set((callableToolNames ?? []).map(String))];
  const forbidden = names.filter((n) => !allowList.has(n) && !n.startsWith("lucy_"));
  const extraLucy = names.filter((n) => n.startsWith("lucy_") && !allowList.has(n));
  const missing = [...allowList].filter((n) => !names.includes(n));
  const ok = forbidden.length === 0 && extraLucy.length === 0 && missing.length === 0;
  return { ok, effectiveCallableTools: names, forbidden, extraLucy, missing };
}

export function publicAuthEvidence(result) {
  return Object.fromEntries(
    ["status", "reason", "httpStatus", "authMode", "role", "email", "adminId"]
      .filter((key) => result?.[key] !== undefined)
      .map((key) => [key, result[key]])
  );
}

export async function inspectImageEvidence(immutableRef) {
  const result = spawnSync("docker", ["image", "inspect", immutableRef, "--format", "{{json .}}"], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return { ok: false, immutableReference: immutableRef, error: result.stderr || result.stdout };
  }
  const raw = JSON.parse(result.stdout);
  const img = Array.isArray(raw) ? raw[0] : raw;
  return {
    ok: true,
    immutableReference: immutableRef,
    id: img.Id ?? null,
    repoDigests: img.RepoDigests ?? []
  };
}

async function requestJson(url, options, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { res, body, text };
  } finally {
    clearTimeout(timer);
  }
}

/** Lucy Admin login → private session cookie. Never persist the returned cookie. */
export async function lucyAdminLogin({ baseUrl, adminId, password, fetchImpl = fetch, timeoutMs = 5000 }) {
  if (!baseUrl) return { status: "blocked", reason: "missing-lucy-admin-base-url" };
  try {
    const statusResult = await requestJson(
      new URL("/api/auth/status", baseUrl).toString(),
      { method: "GET" },
      fetchImpl,
      timeoutMs
    );
    if (!statusResult.res.ok) {
      return { status: "fail", reason: "auth-status-failed", httpStatus: statusResult.res.status };
    }
    const authMode = statusResult.body?.data?.mode;
    if (authMode === "open") return { status: "ok", cookie: "", authMode };
    if (authMode === "bootstrap") return { status: "fail", reason: "lucy-admin-bootstrap-required", authMode };
    if (!adminId || !password) return { status: "blocked", reason: "missing-lucy-admin-credentials", authMode };

    const { res } = await requestJson(new URL("/api/auth/login", baseUrl).toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ adminId, password })
    }, fetchImpl, timeoutMs);
    if (res.status === 401 || res.status === 403) {
      return { status: "fail", reason: "login-unauthorized", httpStatus: res.status, authMode };
    }
    if (!res.ok) {
      return { status: "fail", reason: "login-failed", httpStatus: res.status, authMode };
    }
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const cookieHeader =
      setCookie.map((c) => c.split(";")[0]).join("; ") ||
      (res.headers.get("set-cookie") || "").split(",").map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
    if (!cookieHeader.includes("lucy_admin_session")) {
      return { status: "fail", reason: "missing-session-cookie", httpStatus: res.status, authMode };
    }
    return { status: "ok", cookie: cookieHeader, authMode, adminId };
  } catch (error) {
    return { status: "blocked", reason: "lucy-unreachable", error: String(error?.message || error) };
  }
}

/** Open WebUI login → private bearer token. Never persist the returned token. */
export async function openWebuiLogin({ baseUrl, email, password, fetchImpl = fetch, timeoutMs = 5000 }) {
  if (!baseUrl) return { status: "blocked", reason: "missing-open-webui-base-url" };
  if (!email || !password) return { status: "blocked", reason: "missing-open-webui-admin-credentials" };
  try {
    const { res, body } = await requestJson(new URL("/api/v1/auths/signin", baseUrl).toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    }, fetchImpl, timeoutMs);
    if (res.status === 401 || res.status === 403) {
      return { status: "fail", reason: "open-webui-login-unauthorized", httpStatus: res.status };
    }
    if (!res.ok) return { status: "fail", reason: "open-webui-login-failed", httpStatus: res.status };
    if (!body?.token) return { status: "fail", reason: "open-webui-missing-token", httpStatus: res.status };
    if (body.role !== "admin") return { status: "fail", reason: "open-webui-admin-required", role: body.role };
    return { status: "ok", token: body.token, role: body.role, email: body.email ?? email };
  } catch (error) {
    return { status: "blocked", reason: "open-webui-unreachable", error: String(error?.message || error) };
  }
}

export async function probeOpenWebuiPosture({ baseUrl, token, fetchImpl = fetch, timeoutMs = 5000 }) {
  try {
    const headers = { authorization: `Bearer ${token}` };
    const [configResult, usersResult] = await Promise.all([
      requestJson(new URL("/api/config", baseUrl).toString(), { headers }, fetchImpl, timeoutMs),
      requestJson(new URL("/api/v1/users/?page=1", baseUrl).toString(), { headers }, fetchImpl, timeoutMs)
    ]);
    for (const result of [configResult, usersResult]) {
      if (result.res.status === 401 || result.res.status === 403) {
        return { status: "fail", reason: "open-webui-posture-unauthorized", httpStatus: result.res.status };
      }
      if (!result.res.ok) {
        return { status: "fail", reason: "open-webui-posture-probe-failed", httpStatus: result.res.status };
      }
    }
    const signupEnabled = configResult.body?.features?.enable_signup;
    const users = Array.isArray(usersResult.body?.users) ? usersResult.body.users : [];
    const userCount = Number(usersResult.body?.total ?? users.length);
    const adminCount = users.filter((user) => user?.role === "admin").length;
    const ok = signupEnabled === false && userCount === 1 && users.length === 1 && adminCount === 1;
    return {
      status: ok ? "ok" : "fail",
      ...(ok ? {} : { reason: "open-webui-single-account-posture-failed" }),
      signupEnabled,
      userCount,
      adminCount
    };
  } catch (error) {
    return { status: "blocked", reason: "open-webui-unreachable", error: String(error?.message || error) };
  }
}

export function extractCallableToolsFromToolsets(payload) {
  const toolsets = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  return [...new Set(
    toolsets
      .filter((toolset) => toolset?.enabled === true)
      .flatMap((toolset) => Array.isArray(toolset?.tools) ? toolset.tools : [])
      .map(String)
  )].sort();
}

export function probeHermesCallableTools({ root = ROOT, envFile = "agent-chat/.env", spawnImpl = spawnSync } = {}) {
  const python = [
    "import json,os,urllib.request",
    "req=urllib.request.Request('http://127.0.0.1:8642/v1/toolsets',headers={'Authorization':'Bearer '+os.environ['API_SERVER_KEY']})",
    "print(urllib.request.urlopen(req,timeout=10).read().decode())"
  ].join("; ");
  const result = spawnImpl("docker", [
    "compose", "-f", "docker-compose.agent-chat.yml", "--profile", "agent-chat", "--env-file", envFile,
    "exec", "-T", "hermes", "python", "-c", python
  ], { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return {
      status: "blocked",
      reason: "hermes-toolset-probe-unavailable",
      error: String(result.error?.message || result.stderr || result.stdout || "probe failed").slice(0, 500)
    };
  }
  try {
    const callableToolNames = extractCallableToolsFromToolsets(JSON.parse(result.stdout));
    if (!callableToolNames.length) {
      // Some pinned Hermes versions omit MCP-derived tools from /v1/toolsets.
      // An empty view cannot prove the model-facing set, so never turn it into
      // either a false pass or a product failure.
      return { status: "blocked", reason: "hermes-toolset-probe-incomplete-for-mcp" };
    }
    return { status: "ok", callableToolNames };
  } catch (error) {
    return { status: "blocked", reason: "hermes-toolset-probe-invalid-json" };
  }
}

export async function submitOpenWebuiChat({
  baseUrl,
  token,
  model,
  question,
  fetchImpl = fetch,
  timeoutMs = 120_000
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(new URL("/api/chat/completions", baseUrl).toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "text/event-stream"
      },
      body: JSON.stringify({ model, messages: [{ role: "user", content: question }], stream: true }),
      signal: controller.signal
    });
    if (res.status === 401 || res.status === 403) {
      return { status: "fail", reason: "open-webui-chat-unauthorized", httpStatus: res.status };
    }
    if (!res.ok) return { status: "fail", reason: "open-webui-chat-failed", httpStatus: res.status };
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      return { status: "fail", reason: "open-webui-chat-not-sse", contentType };
    }
    const sseText = await res.text();
    const stream = assertStreamEvidence({ sseText });
    return { status: stream.ok ? "ok" : "fail", ...(stream.ok ? {} : { reason: stream.reason }), stream };
  } catch (error) {
    return { status: "blocked", reason: "open-webui-chat-unreachable", error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function findUniqueTurnByCaseId({
  baseUrl,
  cookie,
  validationCaseId,
  fetchImpl = fetch,
  timeoutMs = 5000
}) {
  const url = new URL("/api/admin/audit/turns", baseUrl);
  url.searchParams.set("source", "reported");
  url.searchParams.set("q", validationCaseId);
  url.searchParams.set("limit", "2");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url.toString(), {
      headers: { cookie },
      signal: controller.signal
    });
    if (res.status === 401 || res.status === 403) {
      return { status: "fail", reason: "turns-unauthorized", httpStatus: res.status };
    }
    if (!res.ok) return { status: "fail", reason: "turns-list-failed", httpStatus: res.status };
    const body = await res.json();
    const total = body?.data?.total ?? body?.total ?? (Array.isArray(body?.data?.entries) ? body.data.entries.length : 0);
    const entries = body?.data?.entries ?? body?.data ?? body?.entries ?? [];
    const list = Array.isArray(entries) ? entries : [];
    if (total !== 1 && list.length !== 1) {
      return {
        status: "fail",
        reason: "turn-not-unique",
        total: total ?? list.length,
        entryIds: list.map((entry) => entry?.id ?? entry?.turnId).filter(Boolean)
      };
    }
    const turnId = list[0]?.id ?? list[0]?.turnId;
    if (!turnId) return { status: "fail", reason: "missing-turn-id" };
    return { status: "ok", turnId, total: 1 };
  } catch (error) {
    return { status: "blocked", reason: "lucy-unreachable", error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function loadTurnAccessLogs({ baseUrl, cookie, turnId, fetchImpl = fetch, timeoutMs = 5000 }) {
  const url = new URL(`/api/admin/audit/turns/${encodeURIComponent(turnId)}`, baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url.toString(), { headers: { cookie }, signal: controller.signal });
    if (res.status === 401 || res.status === 403) {
      return { status: "fail", reason: "turn-detail-unauthorized", httpStatus: res.status };
    }
    if (!res.ok) return { status: "fail", reason: "turn-detail-failed", httpStatus: res.status };
    const body = await res.json();
    const accessLogs = body?.data?.accessLogs ?? [];
    return { status: "ok", accessLogs, detail: body?.data };
  } catch (error) {
    return { status: "blocked", reason: "lucy-unreachable", error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

export function assertTurnHasAllowedDataCall(accessLogs) {
  const logs = accessLogs ?? [];
  const allowed = logs.filter(
    (row) =>
      ALLOWED_LUCY_DATA_TOOLS.has(row.tool) &&
      row.tool !== "lucy_begin_question" &&
      (row.outcome === "ok" || row.outcome === undefined)
  );
  const forbidden = logs.filter((row) => {
    const t = String(row.tool || "");
    return /terminal|browser|memory_ingest|sql_execution|code_execution/i.test(t);
  });
  if (forbidden.length) return { ok: false, reason: "forbidden-tools", forbidden, allowedDataCallCount: allowed.length };
  if (!allowed.length) return { ok: false, reason: "no-allowed-data-call", allowedDataCallCount: 0 };
  return {
    ok: true,
    allowedDataCallCount: allowed.length,
    linkedAccessLogIds: allowed.map((r) => r.id).filter((id) => id != null),
    traceIds: [...new Set(allowed.map((r) => r.traceId ?? r.trace_id).filter(Boolean))]
  };
}

export function credentialsMustNotAlias({
  apiServerKey,
  lucyAgentToken,
  webuiAdminPassword,
  lucyAdminPassword
}) {
  if (apiServerKey && lucyAgentToken && apiServerKey === lucyAgentToken) {
    return { ok: false, reason: "api-server-key-must-not-alias-lucy-agent-token" };
  }
  if (!lucyAdminPassword) return { ok: true, skipped: true };
  if (webuiAdminPassword && webuiAdminPassword === lucyAdminPassword) {
    return { ok: false, reason: "open-webui-admin-password-must-not-alias-lucy-admin" };
  }
  return { ok: true };
}

async function exists(rel) {
  try {
    await access(path.join(ROOT, rel));
    return true;
  } catch {
    return false;
  }
}

async function readText(rel) {
  return readFile(path.join(ROOT, rel), "utf8");
}

function record(evidence, name, ok, detail = {}) {
  evidence.checks[name] = { ok, ...detail };
  return ok;
}

export async function runStaticChecks(evidence, { root = ROOT } = {}) {
  let ok = true;
  const read = (rel) => readFile(path.join(root, rel), "utf8");
  const ex = async (rel) => {
    try {
      await access(path.join(root, rel));
      return true;
    } catch {
      return false;
    }
  };

  ok = record(evidence, "composeOverlayExists", await ex("docker-compose.agent-chat.yml")) && ok;
  ok = record(evidence, "envExampleExists", await ex("agent-chat/.env.example")) && ok;
  ok = record(evidence, "hermesConfigExampleExists", await ex("agent-chat/hermes-home.example/config.yaml")) && ok;
  ok = record(evidence, "runbookExists", await ex("docs/runbook-lucy-agent-chat-a3.md")) && ok;
  ok = record(evidence, "designSpecExists", await ex("docs/design-lucy-agent-chat-a3.md")) && ok;

  if (await ex("docker-compose.agent-chat.yml")) {
    const compose = await read("docker-compose.agent-chat.yml");
    ok = record(evidence, "composeUsesAgentChatProfile", compose.includes('profiles: ["agent-chat"]')) && ok;
    ok = record(evidence, "composeDoesNotPublishHermesPort", !compose.includes("8642:8642")) && ok;
    ok =
      record(evidence, "composeRequiresPinnedHermes", compose.includes("${HERMES_IMAGE:?pinned image required}")) &&
      ok;
    ok =
      record(
        evidence,
        "composeRequiresPinnedOpenWebui",
        compose.includes("${OPEN_WEBUI_IMAGE:?pinned image required}")
      ) && ok;
    ok =
      record(
        evidence,
        "composeLoopbackBindDefault",
        compose.includes("${AGENT_CHAT_WEBUI_BIND_HOST:-127.0.0.1}")
      ) && ok;
    ok = record(evidence, "composeSignupDisabled", compose.includes('ENABLE_SIGNUP: "false"')) && ok;
    ok = record(evidence, "composeWebuiAdminEnv", compose.includes("WEBUI_ADMIN_EMAIL") && compose.includes("WEBUI_ADMIN_PASSWORD")) && ok;
    if (await ex("docker-compose.yml")) {
      const main = await read("docker-compose.yml");
      ok =
        record(evidence, "defaultComposeHasNoAgentChat", !main.includes("open-webui") && !main.includes("lucy-agent-chat")) &&
        ok;
    }
  }

  if (await ex("agent-chat/hermes-home.example/config.yaml")) {
    const cfg = await read("agent-chat/hermes-home.example/config.yaml");
    ok =
      record(evidence, "hermesConfigHasMcpLucyOnlyApiServer", /platform_toolsets:[\s\S]*api_server:[\s\S]*mcp-lucy/.test(cfg)) &&
      ok;
    ok =
      record(
        evidence,
        "hermesMemoryExplicitlyOff",
        /memory_enabled:\s*false/.test(cfg) && /user_profile_enabled:\s*false/.test(cfg)
      ) && ok;
    ok = record(evidence, "hermesDisablesMemoryToolset", /disabled_toolsets:[\s\S]*-\s*memory/.test(cfg)) && ok;
    ok =
      record(evidence, "hermesConfigUsesEnvPlaceholdersForLucySecrets", cfg.includes("${LUCY_PUBLIC_MCP_URL}") && cfg.includes("${LUCY_AGENT_TOKEN}")) &&
      ok;
  }

  if (await ex("agent-chat/.env.example")) {
    const envEx = await read("agent-chat/.env.example");
    const parsed = parseDotEnv(envEx);
    ok = record(evidence, "envExamplePinnedHermesFormat", isPinnedImageRef(parsed.HERMES_IMAGE)) && ok;
    ok = record(evidence, "envExamplePinnedOpenWebuiFormat", isPinnedImageRef(parsed.OPEN_WEBUI_IMAGE)) && ok;
    ok =
      record(
        evidence,
        "envExampleHasLayerKeys",
        envEx.includes("API_SERVER_KEY") && envEx.includes("LUCY_AGENT_TOKEN") && envEx.includes("LUCY_PUBLIC_MCP_URL")
      ) && ok;
    ok =
      record(
        evidence,
        "envExampleDeclaresLucyAdminSeparate",
        envEx.includes("LUCY_ADMIN_ID") && envEx.includes("LUCY_ADMIN_PASSWORD") && envEx.includes("WEBUI_ADMIN_EMAIL")
      ) && ok;
    ok = record(evidence, "envExampleDocumentsFirstBootAdmin", /fresh volume|first-boot|首次/i.test(envEx) || envEx.includes("WEBUI_ADMIN_EMAIL")) && ok;
  }

  if (await ex("agent-chat/.gitignore")) {
    const gi = await read("agent-chat/.gitignore");
    ok = record(evidence, "gitignoreCoversEnv", gi.includes(".env")) && ok;
    ok = record(evidence, "gitignoreCoversHermesHome", /hermes-home\/?/.test(gi)) && ok;
  }

  return ok;
}

async function fetchText(url, { headers = {}, method = "GET", body, timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

async function runLive(evidence, values, timeoutMs) {
  const envPath = path.join(ROOT, "agent-chat/.env");
  let env = {};
  try {
    env = parseDotEnv(await readFile(envPath, "utf8"));
  } catch {
    evidence.notes.push("agent-chat/.env missing; using process.env only");
  }
  const pick = (k, ...alts) => {
    for (const key of [k, ...alts]) {
      if (typeof values[key] === "string" && values[key].trim()) return values[key].trim();
      if (env[key]) return env[key];
      if (process.env[key]) return process.env[key];
    }
    return "";
  };

  const hermesImage = pick("HERMES_IMAGE");
  const openWebuiImage = pick("OPEN_WEBUI_IMAGE");
  if (!isPinnedImageRef(hermesImage) || !isPinnedImageRef(openWebuiImage)) {
    record(evidence, "livePinnedImages", false, { reason: "missing-or-invalid-pin", hermesImage: Boolean(hermesImage), openWebuiImage: Boolean(openWebuiImage) });
    return "blocked";
  }
  record(evidence, "livePinnedImages", true);

  const hermesInspect = await inspectImageEvidence(hermesImage);
  const openInspect = await inspectImageEvidence(openWebuiImage);
  evidence.runtime = {
    hermesImage: hermesInspect,
    openWebuiImage: openInspect
  };
  if (!hermesInspect.ok || !openInspect.ok) {
    record(evidence, "imageInspect", false, { hermes: hermesInspect, openWebui: openInspect });
    return "blocked";
  }
  record(evidence, "imageInspect", true);

  const mcpPolicy = mcpUrlPolicy(pick("LUCY_PUBLIC_MCP_URL"));
  record(evidence, "mcpUrlPolicy", mcpPolicy.ok, mcpPolicy);
  if (!mcpPolicy.ok) return "fail";

  const dataClass = pick("A3_DATA_CLASS") || "nonprod";
  if (dataClass === "approved-customer" && !pick("A3_DATA_APPROVAL_ID")) {
    record(evidence, "dataClassification", false, { reason: "missing-approval-id" });
    return "blocked";
  }
  record(evidence, "dataClassification", true, { dataClass, approvalId: pick("A3_DATA_APPROVAL_ID") || null, providerRegion: pick("A3_LLM_PROVIDER_REGION") || null });

  const apiServerKey = pick("API_SERVER_KEY");
  const lucyAgentToken = pick("LUCY_AGENT_TOKEN");
  if (!apiServerKey || !lucyAgentToken) {
    record(evidence, "credentialSeparation", false, { reason: "missing-l2-or-l3-credential" });
    return "blocked";
  }
  const alias = credentialsMustNotAlias({
    apiServerKey,
    lucyAgentToken,
    webuiAdminPassword: pick("WEBUI_ADMIN_PASSWORD"),
    lucyAdminPassword: pick("LUCY_ADMIN_PASSWORD")
  });
  if (!alias.ok) {
    record(evidence, "credentialSeparation", false, alias);
    return "fail";
  }
  record(evidence, "credentialSeparation", true, alias);

  const openWebuiUrl =
    (typeof values["open-webui-url"] === "string" && values["open-webui-url"].trim()) ||
    process.env.AGENT_CHAT_OPEN_WEBUI_URL ||
    `http://127.0.0.1:${pick("AGENT_CHAT_WEBUI_HOST_PORT") || "3000"}`;

  try {
    const res = await fetchText(openWebuiUrl, { timeoutMs });
    record(evidence, "openWebuiHttp", res.status > 0 && res.status < 500, { status: res.status });
    if (!(res.status > 0 && res.status < 500)) return "blocked";
  } catch (error) {
    record(evidence, "openWebuiHttp", false, { error: String(error?.message || error) });
    return "blocked";
  }

  const volumeMode = pick("A3_VOLUME_MODE") || "unknown";
  if (volumeMode !== "fresh" && volumeMode !== "existing") {
    record(evidence, "openWebuiRuntimePosture", false, { reason: "set-A3_VOLUME_MODE=fresh|existing" });
    return "blocked";
  }
  evidence.notes.push(
    `WEBUI_ADMIN_* is first-boot only. volumeMode=${volumeMode}; runtime APIs, not operator declarations, decide posture.`
  );

  const webuiLogin = await openWebuiLogin({
    baseUrl: openWebuiUrl,
    email: pick("WEBUI_ADMIN_EMAIL"),
    password: pick("WEBUI_ADMIN_PASSWORD"),
    timeoutMs
  });
  record(evidence, "openWebuiLogin", webuiLogin.status === "ok", publicAuthEvidence(webuiLogin));
  if (webuiLogin.status === "blocked") return "blocked";
  if (webuiLogin.status !== "ok") return "fail";

  const posture = await probeOpenWebuiPosture({
    baseUrl: openWebuiUrl,
    token: webuiLogin.token,
    timeoutMs
  });
  record(evidence, "openWebuiRuntimePosture", posture.status === "ok", { ...posture, mode: volumeMode });
  if (posture.status === "blocked") return "blocked";
  if (posture.status !== "ok") return "fail";

  const toolProbe = probeHermesCallableTools();
  record(evidence, "hermesToolsetProbe", toolProbe.status === "ok", {
    status: toolProbe.status,
    reason: toolProbe.reason,
    callableToolNames: toolProbe.callableToolNames
  });
  if (toolProbe.status === "blocked") return "blocked";
  if (toolProbe.status !== "ok") return "fail";
  const toolEval = evaluateCallableTools(toolProbe.callableToolNames);
  evidence.runtime.effectiveCallableTools = toolEval.effectiveCallableTools;
  record(evidence, "effectiveCallableTools", toolEval.ok, toolEval);
  if (!toolEval.ok) return "fail";

  const lucyBase = pick("LUCY_ADMIN_BASE_URL");
  const login = await lucyAdminLogin({
    baseUrl: lucyBase,
    adminId: pick("LUCY_ADMIN_ID"),
    password: pick("LUCY_ADMIN_PASSWORD"),
    timeoutMs
  });
  record(evidence, "lucyAdminLogin", login.status === "ok", publicAuthEvidence(login));
  if (login.status === "blocked") return "blocked";
  if (login.status !== "ok") return "fail";

  const validationCaseId = `A3_CASE:${randomUUID()}`;
  evidence.validationCaseId = validationCaseId;
  const baseQuestion = pick("A3_VALIDATION_QUESTION") || "请仅使用 Lucy MCP 列出当前可访问的数据源，并简要回答。";
  const question = `${baseQuestion.trim()} ${validationCaseId}`;
  const chat = await submitOpenWebuiChat({
    baseUrl: openWebuiUrl,
    token: webuiLogin.token,
    model: pick("API_SERVER_MODEL_NAME") || "lucy-data-agent",
    question,
    timeoutMs
  });
  evidence.stream = chat.stream;
  record(evidence, "streamEvidence", chat.status === "ok", {
    status: chat.status,
    reason: chat.reason,
    httpStatus: chat.httpStatus,
    contentType: chat.contentType,
    ...chat.stream
  });
  if (chat.status === "blocked") return "blocked";
  if (chat.status !== "ok") return "fail";

  const found = await findUniqueTurnByCaseId({
    baseUrl: lucyBase,
    cookie: login.cookie,
    validationCaseId,
    timeoutMs
  });
  record(evidence, "uniqueTurn", found.status === "ok", found);
  if (found.status === "blocked") return "blocked";
  if (found.status !== "ok") return "fail";

  const detail = await loadTurnAccessLogs({
    baseUrl: lucyBase,
    cookie: login.cookie,
    turnId: found.turnId,
    timeoutMs
  });
  record(evidence, "turnDetail", detail.status === "ok", {
    status: detail.status,
    reason: detail.reason,
    httpStatus: detail.httpStatus,
    accessLogCount: Array.isArray(detail.accessLogs) ? detail.accessLogs.length : 0
  });
  if (detail.status === "blocked") return "blocked";
  if (detail.status !== "ok") return "fail";

  const callAssert = assertTurnHasAllowedDataCall(detail.accessLogs);
  evidence.lucy = {
    turnId: found.turnId,
    ...callAssert
  };
  record(evidence, "allowedDataCall", callAssert.ok, callAssert);
  if (!callAssert.ok) return "fail";

  return "pass";
}

async function main() {
  const { values } = parseArgs({
    options: {
      live: { type: "boolean", default: false },
      "hermes-health-url": { type: "string" },
      "open-webui-url": { type: "string" },
      "api-server-key": { type: "string" },
      out: { type: "string", short: "o", default: DEFAULT_OUT },
      "timeout-ms": { type: "string", default: "120000" },
      help: { type: "boolean", short: "h", default: false }
    },
    allowPositionals: false
  });

  if (values.help) {
    console.log(`Usage:
  npm run smoke:agent-chat:a3
  npm run smoke:agent-chat:a3 -- --live

Exit: 0 pass, 1 fail, 2 blocked.
Does NOT belong in smoke:p0:headless-config.`);
    process.exit(0);
  }

  const outFile = path.resolve(ROOT, String(values.out ?? DEFAULT_OUT));
  const timeoutMs = Number.parseInt(String(values["timeout-ms"] ?? "120000"), 10);
  const live = Boolean(values.live);

  const evidence = {
    contract: "agent-chat-a3-m0",
    gateKind: "optional-smoke",
    headlessHardGate: false,
    checkedAt: new Date().toISOString(),
    generatedBy: "scripts/agent-chat-a3-smoke.mjs",
    live,
    status: "fail",
    checks: {},
    notes: []
  };

  const staticOk = await runStaticChecks(evidence);
  let liveStatus = "skipped";
  if (live) {
    liveStatus = await runLive(evidence, values, timeoutMs);
  }

  if (!staticOk) evidence.status = "fail";
  else if (live && liveStatus === "blocked") {
    evidence.status = "blocked";
    evidence.notes.push("Live dependencies incomplete or unreachable; packaging checks passed.");
  } else if (live && liveStatus === "fail") evidence.status = "fail";
  else evidence.status = "pass";

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: evidence.status, out: outFile, live }, null, 2));

  if (evidence.status === "pass") process.exit(0);
  if (evidence.status === "blocked") process.exit(2);
  process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(async (err) => {
    console.error(err);
    process.exit(1);
  });
}
