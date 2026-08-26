import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_LUCY_DATA_TOOLS,
  assertStreamEvidence,
  assertTurnHasAllowedDataCall,
  credentialsMustNotAlias,
  evaluateCallableTools,
  extractCallableToolsFromToolsets,
  openWebuiLogin,
  probeHermesCallableTools,
  probeOpenWebuiPosture,
  publicAuthEvidence,
  isPinnedImageRef,
  lucyAdminLogin,
  mcpUrlPolicy,
  findUniqueTurnByCaseId,
  submitOpenWebuiChat
} from "./agent-chat-a3-smoke.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts/agent-chat-a3-smoke.mjs");

function mockResponse(status, body, headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const text = typeof body === "string" ? body : body == null ? "" : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name) => normalized[String(name).toLowerCase()] ?? null,
      getSetCookie: () => normalized["set-cookie-array"] ?? []
    },
    text: async () => text,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body)
  };
}

describe("agent-chat-a3-smoke helpers", () => {
  it("accepts pinned image refs and rejects latest/main", () => {
    const good =
      "nousresearch/hermes-agent:1.2.3@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    assert.equal(isPinnedImageRef(good), true);
    assert.equal(isPinnedImageRef("nousresearch/hermes-agent:latest"), false);
    assert.equal(isPinnedImageRef("ghcr.io/open-webui/open-webui:main"), false);
  });

  it("mcpUrlPolicy allows local http and requires https for remote", () => {
    assert.equal(mcpUrlPolicy("http://host.docker.internal:7879/mcp").ok, true);
    assert.equal(mcpUrlPolicy("https://lucy.example.com/mcp").ok, true);
    assert.equal(mcpUrlPolicy("http://lucy.example.com/mcp").ok, false);
  });

  it("stream evidence requires SSE framing, completed, and >=1 delta", () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      "data: [DONE]",
      ""
    ].join("\n");
    assert.equal(assertStreamEvidence({ sseText: sse, completed: true }).ok, true);
    assert.equal(assertStreamEvidence({ sseText: '{"final":"only"}', completed: true }).ok, false);
    assert.equal(assertStreamEvidence({ sseText: "data: [DONE]\n", completed: true }).ok, false);
    assert.equal(assertStreamEvidence({ sseText: 'data: {"heartbeat":"alive"}\ndata: [DONE]\n' }).ok, false);
    assert.equal(assertStreamEvidence({ sseText: 'data: {"choices":[{"delta":{"content":"hi"}}]}\n' }).ok, false);
  });

  it("callable tools must exactly equal the M0 Lucy allow-list", () => {
    const expected = [...ALLOWED_LUCY_DATA_TOOLS];
    const ok = evaluateCallableTools(expected);
    assert.equal(ok.ok, true);
    const missing = evaluateCallableTools(["lucy_catalog", "lucy_query"]);
    assert.equal(missing.ok, false);
    assert.ok(missing.missing.length > 0);
    const forbidden = evaluateCallableTools([...expected, "terminal"]);
    assert.equal(forbidden.ok, false);
    assert.deepEqual(forbidden.forbidden, ["terminal"]);
    const extraLucy = evaluateCallableTools([...expected, "lucy_shell"]);
    assert.equal(extraLucy.ok, false);
    assert.deepEqual(extraLucy.extraLucy, ["lucy_shell"]);
  });

  it("rejects Open WebUI admin aliasing Lucy admin", () => {
    const r = credentialsMustNotAlias({
      webuiAdminPassword: "same",
      lucyAdminPassword: "same"
    });
    assert.equal(r.ok, false);
    assert.equal(
      credentialsMustNotAlias({ apiServerKey: "same", lucyAgentToken: "same" }).reason,
      "api-server-key-must-not-alias-lucy-agent-token"
    );
  });

  it("turn access logs require allowed lucy data call", () => {
    assert.equal(
      assertTurnHasAllowedDataCall([
        { id: 1, tool: "lucy_begin_question", outcome: "ok" },
        { id: 2, tool: "lucy_query", outcome: "ok", traceId: "t1" }
      ]).ok,
      true
    );
    assert.equal(assertTurnHasAllowedDataCall([{ tool: "lucy_begin_question", outcome: "ok" }]).ok, false);
  });

  it("lucyAdminLogin uses auth status and the adminId contract", async () => {
    const calls = [];
    const responses = [
      mockResponse(200, { data: { mode: "required" } }),
      mockResponse(200, { ok: true }, { "set-cookie-array": ["lucy_admin_session=private; HttpOnly"] })
    ];
    const fetchLogin = async (url, options) => {
      calls.push({ url, options });
      return responses.shift();
    };
    const loggedIn = await lucyAdminLogin({
      baseUrl: "http://example.test",
      adminId: "admin-1",
      password: "secret",
      fetchImpl: fetchLogin
    });
    assert.equal(loggedIn.status, "ok");
    assert.equal(new URL(calls[0].url).pathname, "/api/auth/status");
    assert.equal(new URL(calls[1].url).pathname, "/api/auth/login");
    assert.deepEqual(JSON.parse(calls[1].options.body), { adminId: "admin-1", password: "secret" });

    const missing = await lucyAdminLogin({
      baseUrl: "http://example.test",
      adminId: "",
      password: "",
      fetchImpl: async () => mockResponse(200, { data: { mode: "required" } })
    });
    assert.equal(missing.status, "blocked");

    let call = 0;
    const fetch401 = async () =>
      call++ === 0 ? mockResponse(200, { data: { mode: "required" } }) : mockResponse(401, { error: "no" });
    const unauthorized = await lucyAdminLogin({
      baseUrl: "http://example.test",
      adminId: "admin-1",
      password: "x",
      fetchImpl: fetch401
    });
    assert.equal(unauthorized.status, "fail");
  });

  it("public auth evidence omits Open WebUI tokens and Lucy cookies", () => {
    assert.deepEqual(
      publicAuthEvidence({ status: "ok", role: "admin", email: "a@b.c", token: "private" }),
      { status: "ok", role: "admin", email: "a@b.c" }
    );
    assert.deepEqual(
      publicAuthEvidence({ status: "ok", authMode: "required", adminId: "admin-1", cookie: "private" }),
      { status: "ok", authMode: "required", adminId: "admin-1" }
    );
  });

  it("probes Open WebUI login, signup switch, and exactly one admin account", async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options });
      const pathname = new URL(url).pathname;
      if (pathname === "/api/v1/auths/signin") {
        return mockResponse(200, { token: "private", role: "admin", email: "a3@localhost" });
      }
      if (pathname === "/api/config") {
        return mockResponse(200, { features: { enable_signup: false } });
      }
      if (pathname === "/api/v1/users/") {
        return mockResponse(200, { users: [{ id: "u1", role: "admin" }], total: 1 });
      }
      throw new Error(`unexpected URL ${url}`);
    };
    const login = await openWebuiLogin({
      baseUrl: "http://webui.test",
      email: "a3@localhost",
      password: "secret",
      fetchImpl
    });
    assert.equal(login.status, "ok");
    assert.deepEqual(JSON.parse(calls[0].options.body), { email: "a3@localhost", password: "secret" });
    const posture = await probeOpenWebuiPosture({
      baseUrl: "http://webui.test",
      token: login.token,
      fetchImpl
    });
    assert.deepEqual(posture, {
      status: "ok",
      signupEnabled: false,
      userCount: 1,
      adminCount: 1
    });
  });

  it("extracts enabled Hermes toolsets and blocks on an incomplete MCP view", () => {
    assert.deepEqual(
      extractCallableToolsFromToolsets({
        data: [
          { enabled: true, tools: ["lucy_query", "lucy_catalog"] },
          { enabled: false, tools: ["terminal"] }
        ]
      }),
      ["lucy_catalog", "lucy_query"]
    );
    const empty = probeHermesCallableTools({
      spawnImpl: () => ({ status: 0, stdout: JSON.stringify({ data: [] }), stderr: "" })
    });
    assert.equal(empty.status, "blocked");
    assert.equal(empty.reason, "hermes-toolset-probe-incomplete-for-mcp");
    const malformed = probeHermesCallableTools({
      spawnImpl: () => ({ status: 0, stdout: "not-json", stderr: "" })
    });
    assert.equal(malformed.status, "blocked");
    assert.equal(malformed.reason, "hermes-toolset-probe-invalid-json");
  });

  it("submits the validation question through Open WebUI and verifies returned SSE", async () => {
    let request;
    const result = await submitOpenWebuiChat({
      baseUrl: "http://webui.test",
      token: "private",
      model: "lucy-data-agent",
      question: "验证 A3_CASE:case-1",
      fetchImpl: async (url, options) => {
        request = { url, options };
        return mockResponse(
          200,
          'data: {"choices":[{"delta":{"content":"ok"}}]}\ndata: [DONE]\n',
          { "content-type": "text/event-stream" }
        );
      }
    });
    assert.equal(result.status, "ok");
    assert.equal(new URL(request.url).pathname, "/api/chat/completions");
    const body = JSON.parse(request.options.body);
    assert.equal(body.messages[0].content, "验证 A3_CASE:case-1");
    assert.equal(body.stream, true);
  });

  it("findUniqueTurnByCaseId requires total === 1", async () => {
    const fetchTwo = async () => ({
      status: 200,
      ok: true,
      json: async () => ({ data: { total: 2, entries: [{ id: "a" }, { id: "b" }] } })
    });
    const r = await findUniqueTurnByCaseId({
      baseUrl: "http://example.test",
      cookie: "lucy_admin_session=x",
      validationCaseId: "A3_CASE:1",
      fetchImpl: fetchTwo
    });
    assert.equal(r.status, "fail");
    assert.equal(r.reason, "turn-not-unique");
  });
});

describe("agent-chat-a3-smoke CLI", () => {
  it("passes static packaging checks", () => {
    const out = path.join(ROOT, "inbox/agent-chat-a3-smoke-test-evidence.json");
    const result = spawnSync(process.execPath, [SCRIPT, "--out", out], {
      cwd: ROOT,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"status": "pass"/);
  });

  it("live without stack returns blocked (exit 2)", () => {
    const out = path.join(ROOT, "inbox/agent-chat-a3-smoke-live-blocked-evidence.json");
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--live", "--out", out, "--open-webui-url", "http://127.0.0.1:9", "--timeout-ms", "500"],
      { cwd: ROOT, encoding: "utf8" }
    );
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stdout, /"status": "blocked"/);
  });
});
