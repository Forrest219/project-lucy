// SEC-07, SEC-08, SEC-10-V03, SEC-14, SEC-21-V05: MCP admission and context-object authorization
// over the real proxy (Spec §3.3, §4). The proxy serves Wiki/Skill locally, so these run without KTX.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Checks, explicitDeny } from "./context.mjs";

const SKILL_URI = "lucy-skill://finance/finance-cac-analysis";
const SKILL_NAME = "finance-cac-analysis";
const DRAFT_NAME = "finance-draft-roadmap";

const isDenied = (res) => {
  if (explicitDeny(res)) return true;
  const text = res.json?.result?.content?.[0]?.text ?? "";
  return res.json?.result?.isError === true || /context_not_available|context_role_required|not.?allowed|denied|unknown tool/i.test(text);
};

const bodyText = (res) => res.text ?? "";

function agentRequests(ctx) {
  return {
    "tools/call": ctx.rpc(1, "tools/call", { name: "connection_list", arguments: {} }),
    "resources/list": ctx.rpc(2, "resources/list"),
    "resources/read": ctx.rpc(3, "resources/read", { uri: SKILL_URI }),
    "prompts/list": ctx.rpc(4, "prompts/list"),
    "prompts/get": ctx.rpc(5, "prompts/get", { name: SKILL_NAME }),
    notification: { jsonrpc: "2.0", method: "notifications/initialized" }
  };
}

async function disabledAgentCase(ctx, kind) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_disabled;
  let res;
  if (kind === "GET") res = await ctx.mcp(token, undefined, { method: "GET" });
  else if (kind === "DELETE") res = await ctx.mcp(token, undefined, { method: "DELETE", headers: { "mcp-session-id": "e2e-not-a-session" } });
  else res = await ctx.mcp(token, agentRequests(ctx)[kind]);
  checks.expect("deny", res.status === 403 || res.status === 401, `${kind} for a disabled Agent -> HTTP ${res.status}`);
  checks.noLeak([bodyText(res)], ctx.scanOptions());
  return { ...checks.result(), denyReason: res.json?.error?.message ?? `status:${res.status}` };
}

async function setAgentEnabled(ctx, agentId, enabled) {
  const owner = await ctx.ownerCookie();
  return ctx.adminCall(owner, "PATCH", `/api/admin/agents/${agentId}`, { dryRun: false, patch: { enabled } });
}

function writeWiki(ctx, name, frontmatter, canary) {
  const dir = path.dirname(ctx.wikiFile(name));
  mkdirSync(dir, { recursive: true });
  writeFileSync(ctx.wikiFile(name), `---\nsummary: e2e acl case\n${frontmatter}---\n\n# ACL case\n\n${canary}\n`);
}

function wikiOutcome(res, canary) {
  return { allowed: bodyText(res).includes(canary), denied: !bodyText(res).includes(canary) && isDenied(res), status: res.status };
}

async function aclCase(ctx, { name, frontmatter, expect }) {
  const checks = new Checks();
  const canary = `CANARY-ACL-${name.replace(/\W/g, "").toUpperCase()}-${ctx.run.seedDigest.slice(0, 8)}`;
  writeWiki(ctx, name, frontmatter, canary);
  const actors = { finance: ctx.tokens.e2e_finance, sales: ctx.tokens.e2e_sales, channel_only: ctx.tokens.e2e_channel_only, legacy: ctx.tokens.e2e_legacy, anonymous: "" };
  const texts = [];
  for (const [actor, shouldRead] of Object.entries(expect)) {
    const res = await ctx.wikiRead(actors[actor], name);
    texts.push(bodyText(res));
    const outcome = wikiOutcome(res, canary);
    if (shouldRead) checks.expect("allow_control", outcome.allowed, `${actor} reads ${name} -> HTTP ${res.status}`);
    else checks.expect("deny", outcome.denied, `${actor} must not read ${name} -> HTTP ${res.status}${outcome.allowed ? " (CANARY LEAKED)" : ""}`);
  }
  // The canary is deliberately readable by the entitled actors; the scan targets credentials and unrelated canaries.
  checks.noLeak(texts, { secrets: ctx.allSecrets, forbiddenCanaries: ctx.forbiddenFor([]) });
  return checks.result();
}

export const handlers = {
  "SEC-07-V01": (ctx) => disabledAgentCase(ctx, "tools/call"),
  "SEC-07-V02": (ctx) => disabledAgentCase(ctx, "resources/list"),
  "SEC-07-V03": (ctx) => disabledAgentCase(ctx, "resources/read"),
  "SEC-07-V04": (ctx) => disabledAgentCase(ctx, "prompts/list"),
  "SEC-07-V05": (ctx) => disabledAgentCase(ctx, "prompts/get"),
  "SEC-07-V06": (ctx) => disabledAgentCase(ctx, "GET"),
  "SEC-07-V07": (ctx) => disabledAgentCase(ctx, "DELETE"),
  "SEC-07-V08": (ctx) => disabledAgentCase(ctx, "notification"),

  "SEC-07-V09": async (ctx) => {
    const checks = new Checks();
    const token = ctx.tokens.e2e_sales;
    const init = await ctx.mcp(token, ctx.rpc(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "1" } }));
    const sessionId = init.headers["mcp-session-id"];
    const headers = sessionId ? { "mcp-session-id": sessionId } : {};
    const before = await ctx.mcp(token, ctx.rpc(2, "tools/call", { name: "wiki_read", arguments: { path: "sales/quota-notes.md" } }), { headers });
    checks.expect("allow_control", bodyText(before).includes(ctx.canaries.salesWiki), `before narrowing the sales Agent reads its Wiki -> ${before.status}`);
    try {
      const narrowed = await setAgentEnabled(ctx, "e2e_sales", false);
      checks.expect("allow_control", narrowed.status === 200, `owner disables the Agent -> ${narrowed.status}`);
      const after = await ctx.mcp(token, ctx.rpc(3, "tools/call", { name: "wiki_read", arguments: { path: "sales/quota-notes.md" } }), { headers });
      checks.expect("deny", after.status === 403 || after.status === 401, `old session after narrowing -> ${after.status}`);
      checks.noLeak([bodyText(after)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
    } finally {
      await setAgentEnabled(ctx, "e2e_sales", true);
    }
    return checks.result();
  },

  "SEC-07-V10": async (ctx) => {
    const checks = new Checks();
    const token = ctx.tokens.e2e_sales;
    try {
      const narrowed = await setAgentEnabled(ctx, "e2e_sales", false);
      checks.expect("allow_control", narrowed.status === 200, `owner disables the Agent -> ${narrowed.status}`);
      const init = await ctx.mcp(token, ctx.rpc(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "1" } }));
      checks.expect("deny", init.status === 403 || init.status === 401, `new session after narrowing -> ${init.status}`);
      checks.noLeak([bodyText(init)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
    } finally {
      await setAgentEnabled(ctx, "e2e_sales", true);
    }
    const restored = await ctx.wikiRead(token, "sales/quota-notes.md");
    checks.expect("allow_control", bodyText(restored).includes(ctx.canaries.salesWiki), "control: re-enabled Agent reads again");
    return checks.result();
  },

  "SEC-08-V01": async (ctx) => {
    const checks = new Checks();
    const texts = [];
    for (const body of [ctx.rpc(1, "initialize", {}), ctx.rpc(2, "tools/list"), ctx.rpc(3, "resources/read", { uri: SKILL_URI })]) {
      const res = await ctx.mcp("", body);
      texts.push(bodyText(res));
      checks.expect("deny", res.status === 401, `anonymous ${body.method} -> ${res.status}`);
    }
    checks.noLeak(texts, ctx.scanOptions());
    return checks.result();
  },

  "SEC-08-V02": async (ctx) => {
    const checks = new Checks();
    const res = await ctx.mcp("lucy_e2e_fake00000000000000000000000000000000", ctx.rpc(1, "tools/list"));
    checks.expect("deny", res.status === 401, `fake token -> ${res.status}`);
    checks.noLeak([bodyText(res)], ctx.scanOptions());
    return checks.result();
  },

  "SEC-08-V03": async (ctx) => {
    const checks = new Checks();
    const cookie = await ctx.ownerCookie();
    const asCookie = await ctx.mcpHttp.request("POST", "/mcp", { headers: { accept: "application/json, text/event-stream" }, cookie, body: ctx.rpc(1, "tools/list") });
    checks.expect("deny", asCookie.status === 401, `admin Cookie as MCP identity -> ${asCookie.status}`);
    const cookieValue = cookie.split("=").slice(1).join("=");
    const asBearer = await ctx.mcp(cookieValue, ctx.rpc(2, "tools/list"));
    checks.expect("deny", asBearer.status === 401, `admin session value as Bearer -> ${asBearer.status}`);
    checks.noLeak([bodyText(asCookie), bodyText(asBearer)], ctx.scanOptions());
    return checks.result();
  },

  "SEC-08-V04": async (ctx) => {
    const checks = new Checks();
    const init = await ctx.mcp(ctx.tokens.e2e_finance, ctx.rpc(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "1" } }));
    const foreignSession = init.headers["mcp-session-id"] ?? "e2e-guessed-session-id";
    const res = await ctx.mcp(ctx.tokens.e2e_sales, ctx.rpc(2, "resources/list"), { headers: { "mcp-session-id": foreignSession } });
    checks.expect("deny", !bodyText(res).includes(SKILL_NAME), `a foreign sessionId does not expose the other Agent's Skill (HTTP ${res.status})`);
    checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
    return checks.result();
  },

  "SEC-08-V05": async (ctx) => {
    const checks = new Checks();
    const batch = [ctx.rpc(1, "tools/list"), ctx.rpc(2, "resources/list")];
    const res = await ctx.mcp(ctx.tokens.e2e_finance, batch);
    checks.expect("deny", explicitDeny(res), `batch envelope -> ${res.status}`);
    checks.expect("deny", !Array.isArray(res.json), "no per-item batch response was produced");
    checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
    return checks.result();
  },

  "SEC-08-V06": async (ctx) => {
    const checks = new Checks();
    const texts = [];
    for (const raw of ['"just a string"', "42", "null", "true"]) {
      const res = await ctx.mcp(ctx.tokens.e2e_finance, undefined, { rawBody: raw, headers: { "content-type": "application/json" } });
      texts.push(bodyText(res));
      checks.expect("deny", explicitDeny(res), `envelope ${raw} -> ${res.status}`);
    }
    checks.noLeak(texts, { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
    return checks.result();
  },

  "SEC-08-V07": async (ctx) => {
    const checks = new Checks();
    const res = await ctx.mcp(ctx.tokens.e2e_finance, ctx.rpc(1, "debug/dumpState"));
    checks.expect("deny", explicitDeny(res), `unknown method -> ${res.status}`);
    checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
    return checks.result();
  },

  "SEC-08-V08": async (ctx) => {
    const checks = new Checks();
    const texts = [];
    for (const pathname of ["/admin", "/mcp2", "/mcp/../api/admin/agents", "/internal/ktx", "/mcp/unknown"]) {
      const res = await ctx.mcp(ctx.tokens.e2e_finance, ctx.rpc(1, "tools/list"), { pathname });
      texts.push(bodyText(res));
      checks.expect("deny", explicitDeny(res), `path ${pathname} -> ${res.status}`);
    }
    checks.noLeak(texts, { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
    return checks.result();
  },

  "SEC-10-V03": async (ctx) => {
    const checks = new Checks();
    const key = "finance/split-role-doc.md";
    const closed = await ctx.wikiRead(ctx.tokens.e2e_finance, key);
    checks.expect("allow_control", bodyText(closed).includes(ctx.canaries.splitWiki), `one role holds channel + grant -> ${closed.status}`);
    const split = await ctx.wikiRead(ctx.tokens.e2e_split_roles, key);
    checks.expect("deny", isDenied(split) && !bodyText(split).includes(ctx.canaries.splitWiki), "channel in role A + grant in role B must not stitch");
    checks.noLeak([bodyText(split)], { secrets: ctx.allSecrets, forbiddenCanaries: [ctx.canaries.splitWiki] });
    return checks.result();
  },

  "SEC-14-V01": (ctx) => aclCase(ctx, { name: "e2e-acl/missing.md", frontmatter: "", expect: { finance: false, sales: false, legacy: false } }),
  "SEC-14-V02": (ctx) => aclCase(ctx, { name: "e2e-acl/empty.md", frontmatter: "allowed_roles: []\n", expect: { finance: false, sales: false } }),
  "SEC-14-V03": (ctx) => aclCase(ctx, { name: "e2e-acl/single.md", frontmatter: "allowed_roles: [finance_reader]\n", expect: { finance: true, sales: false, anonymous: false } }),
  "SEC-14-V04": (ctx) => aclCase(ctx, { name: "e2e-acl/multi.md", frontmatter: "allowed_roles: [finance_reader, sales_reader]\n", expect: { finance: true, sales: true, channel_only: false } }),
  "SEC-14-V05": (ctx) => aclCase(ctx, { name: "e2e-acl/unknown-role.md", frontmatter: "allowed_roles: [role_that_was_deleted]\n", expect: { finance: false, sales: false } }),
  "SEC-14-V06": (ctx) => aclCase(ctx, { name: "e2e-acl/star.md", frontmatter: "allowed_roles: ['*']\n", expect: { finance: true, sales: true, anonymous: false, legacy: false } }),
  "SEC-14-V07": async (ctx) => {
    const checks = new Checks();
    const init = await ctx.mcp(ctx.tokens.e2e_legacy, ctx.rpc(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "1" } }));
    checks.expect("allow_control", init.status === 200, `legacy direct-allow data plane still initializes -> ${init.status}`);
    checks.expect("deny", !bodyText(init).includes(SKILL_NAME) && !bodyText(init).includes("cac-definition"), "legacy initialize carries no context directory");
    const res = await ctx.wikiRead(ctx.tokens.e2e_legacy, "shared/glossary.md");
    checks.expect("deny", isDenied(res) && !bodyText(res).includes(ctx.canaries.sharedWiki), `legacy Wiki read -> ${res.status}`);
    checks.expect("deny", /context_role_required/.test(bodyText(res)), "denial reason is context_role_required");
    checks.noLeak([bodyText(init), bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
    return { ...checks.result(), denyReason: "context_role_required" };
  },
  "SEC-14-V08": (ctx) =>
    aclCase(ctx, { name: "e2e-acl/public-no-acl.md", frontmatter: "visibility: public\n", expect: { finance: false, sales: false, anonymous: false } }),
  "SEC-14-V09": async (ctx) => {
    const checks = new Checks();
    const key = "finance/cac-definition.md";
    const search = (token) => ctx.mcp(token, ctx.rpc(1, "tools/call", { name: "wiki_search", arguments: { q: "获客成本" } }));
    const discover = ctx.tokens.e2e_discover_only;
    const found = await search(discover);
    checks.expect("allow_control", /cac-definition/.test(bodyText(found)), "discover-only role can list the granted summary");
    const readByDiscover = await ctx.wikiRead(discover, key);
    checks.expect("deny", !bodyText(readByDiscover).includes(ctx.canaries.financeWiki), "discover-only role cannot read the body");
    const readOnly = ctx.tokens.e2e_channel_only;
    const direct = await ctx.wikiRead(readOnly, key);
    checks.expect("allow_control", bodyText(direct).includes(ctx.canaries.financeWiki), "read-only role can read the known key");
    const listing = await search(readOnly);
    checks.expect("deny", !/cac-definition/.test(bodyText(listing)), "read-only role cannot discover/list");
    checks.noLeak([bodyText(found), bodyText(readByDiscover), bodyText(listing)], { secrets: ctx.allSecrets, forbiddenCanaries: [ctx.canaries.salesWiki, ctx.canaries.restrictedWiki] });
    return checks.result();
  },
  "SEC-14-V10": async (ctx) => {
    const checks = new Checks();
    const surfaces = async (token) => {
      const init = await ctx.mcp(token, ctx.rpc(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "1" } }));
      const resources = await ctx.mcp(token, ctx.rpc(2, "resources/list"));
      const prompts = await ctx.mcp(token, ctx.rpc(3, "prompts/list"));
      const search = await ctx.mcp(token, ctx.rpc(4, "tools/call", { name: "lucy_skill_search", arguments: { query: "获客成本" } }));
      return { init, resources, prompts, search };
    };
    const fin = await surfaces(ctx.tokens.e2e_finance);
    const sales = await surfaces(ctx.tokens.e2e_sales);
    for (const [surface, res] of Object.entries(fin)) {
      if (surface === "init") continue;
      checks.expect("consistency", bodyText(res).includes(SKILL_NAME), `${surface}: entitled Agent sees the published Skill`);
      checks.expect("consistency", !bodyText(res).includes(DRAFT_NAME), `${surface}: draft Skill is never listed`);
    }
    for (const [surface, res] of Object.entries(sales)) {
      checks.expect("consistency", !bodyText(res).includes(SKILL_NAME), `${surface}: unentitled Agent never sees the Skill`);
    }
    checks.noLeak(Object.values(sales).map(bodyText), { secrets: ctx.allSecrets, forbiddenCanaries: [ctx.canaries.publishedSkill, ctx.canaries.draftSkill, ctx.canaries.deprecatedSkill, ctx.canaries.financeWiki] });
    return checks.result();
  },

  "SEC-21-V05": async (ctx) => {
    const checks = new Checks();
    const a = await ctx.wikiRead(ctx.tokens.e2e_finance, "finance/cac-definition.md");
    const b = await ctx.wikiRead(ctx.tokens.e2e_sales, "finance/cac-definition.md");
    checks.expect("consistency", bodyText(a).includes(ctx.canaries.financeWiki), "headerless client A is served by its own Token identity");
    checks.expect("deny", !bodyText(b).includes(ctx.canaries.financeWiki), "headerless client B does not inherit A's state");
    checks.noLeak([bodyText(b)], { secrets: ctx.allSecrets, forbiddenCanaries: [ctx.canaries.financeWiki] });
    return checks.result();
  }
};
