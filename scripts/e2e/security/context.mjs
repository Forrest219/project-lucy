// Shared state and helpers for security-integration case handlers (Plan T10 step 4).
// Handlers receive one SecurityContext; they speak real HTTP to the Lucy instance of the run and read
// secrets only from <runDir>/checker/secrets (never from argv, never printed).

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { scanMany } from "../lib/leak-scan.mjs";
import { LucyHttp } from "../lib/instance.mjs";

const RPC_DENY_CODES = new Set([-32001, -32003, -32600, -32601, -32602]);

/**
 * An explicit, approved denial: an HTTP 4xx, or a well-formed JSON-RPC refusal. A 5xx (including a crash
 * or an unhandled error) is never a denial; GATE-01 requires that "the server broke" cannot read as "ACL held".
 */
export function explicitDeny(res) {
  if (res.status >= 400 && res.status < 500) return true;
  if (res.status >= 500) return false;
  return RPC_DENY_CODES.has(res.json?.error?.code);
}

export class Checks {
  constructor() {
    this.assertions = [];
    this.extra = {};
  }

  expect(token, passed, detail = "") {
    this.assertions.push({ token, passed: Boolean(passed), ...(detail ? { detail: String(detail).slice(0, 300) } : {}) });
    return Boolean(passed);
  }

  /** Records the leakage verdict as a `no_leak` assertion and keeps the (secret-free) scan summary. */
  noLeak(texts, scanOptions) {
    const scan = scanMany(texts, scanOptions);
    this.extra.leakage = { scanned: true, hits: scan.hits };
    this.expect("no_leak", scan.hits === 0, scan.hits === 0 ? "" : `${scan.hits} leak hit(s): ${JSON.stringify(scan.detail)}`);
    return scan.hits === 0;
  }

  result() {
    return { assertions: this.assertions, ...this.extra };
  }
}

/** Digest of the run's project tree excluding runtime state; used for `no_side_effect`. */
export function projectDigest(projectDir) {
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".ktx-ui") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) hash.update(`${path.relative(projectDir, full)}\0${createHash("sha256").update(readFileSync(full)).digest("hex")}\n`);
    }
  };
  walk(projectDir);
  return hash.digest("hex");
}

const MCP_ACCEPT = "application/json, text/event-stream";

export class SecurityContext {
  constructor({ run, lucy, capabilities }) {
    this.run = run;
    this.lucy = lucy;
    this.capabilities = capabilities;
    this.web = new LucyHttp(run.instance.baseUrl);
    this.mcpHttp = new LucyHttp(`http://${run.instance.host}:${run.instance.proxyPort}`);
    const secretsDir = run.secretsDir;
    this.tokens = JSON.parse(readFileSync(path.join(secretsDir, "tokens.json"), "utf8"));
    this.adminCreds = JSON.parse(readFileSync(path.join(secretsDir, "admins.json"), "utf8"));
    this.bootstrapToken = readFileSync(path.join(secretsDir, "bootstrap-token"), "utf8").trim();
    this.gold = JSON.parse(readFileSync(path.join(run.paths.checker, "gold.json"), "utf8"));
    this.canaries = this.gold.canaries;
    this.cookies = {};
    this.counters = { adminSeq: 0 };
  }

  /** Every credential value this run knows; any appearance in an output is a leak. */
  get allSecrets() {
    return [
      ...Object.values(this.tokens),
      this.bootstrapToken,
      this.adminCreds.owner.password,
      this.adminCreds.operator.password
    ];
  }

  /** Canaries an identity must never see (everything except the ones it is entitled to). */
  forbiddenFor(allowed = []) {
    return Object.values(this.canaries).filter((value) => !allowed.includes(value));
  }

  scanOptions(allowedCanaries = []) {
    return { secrets: this.allSecrets, forbiddenCanaries: this.forbiddenFor(allowedCanaries) };
  }

  async authStatus() {
    return this.web.request("GET", "/api/auth/status");
  }

  async login(adminId, password) {
    const res = await this.web.request("POST", "/api/auth/login", { body: { adminId, password } });
    return { res, cookie: res.status === 200 ? res.cookie : null };
  }

  /** Bootstraps the first owner exactly once for the run; later calls just log the owner in. */
  async ownerCookie() {
    if (this.cookies.owner) return this.cookies.owner;
    const { owner } = this.adminCreds;
    const status = (await this.authStatus()).json?.data?.mode;
    if (status === "bootstrap") {
      const res = await this.web.request("POST", "/api/auth/bootstrap", {
        headers: { "x-lucy-bootstrap-token": this.bootstrapToken },
        body: { adminId: owner.adminId, displayName: "E2E Owner", password: owner.password }
      });
      if (res.status !== 200 || !res.cookie) throw new Error(`owner bootstrap failed: HTTP ${res.status}`);
      this.cookies.owner = res.cookie;
      return res.cookie;
    }
    const { res, cookie } = await this.login(owner.adminId, owner.password);
    if (!cookie) throw new Error(`owner login failed: HTTP ${res.status}`);
    this.cookies.owner = cookie;
    return cookie;
  }

  async adminCall(cookie, method, url, body) {
    return this.web.request(method, url, { cookie, ...(body !== undefined ? { body } : {}) });
  }

  /** Creates an account through the owner API and returns its credentials (never logged). */
  async createAdmin(role = "operator") {
    const owner = await this.ownerCookie();
    this.counters.adminSeq += 1;
    const adminId = `e2e-${role}-${Date.now().toString(36)}${this.counters.adminSeq}`;
    const password = `Pw-${createHash("sha256").update(`${adminId}${Math.random()}`).digest("hex").slice(0, 20)}`;
    const res = await this.adminCall(owner, "POST", "/api/admin/admins", { adminId, displayName: adminId, password, role });
    if (res.status !== 200) throw new Error(`createAdmin(${role}) failed: HTTP ${res.status}`);
    return { adminId, password };
  }

  async operatorCookie() {
    if (this.cookies.operator) return this.cookies.operator;
    const { operator } = this.adminCreds;
    const owner = await this.ownerCookie();
    const existing = await this.adminCall(owner, "GET", "/api/admin/admins");
    const has = existing.json?.data?.admins?.some((a) => a.id === operator.adminId);
    if (!has) {
      const created = await this.adminCall(owner, "POST", "/api/admin/admins", {
        adminId: operator.adminId, displayName: "E2E Operator", password: operator.password, role: "operator"
      });
      if (created.status !== 200) throw new Error(`operator creation failed: HTTP ${created.status}`);
    }
    const { res, cookie } = await this.login(operator.adminId, operator.password);
    if (!cookie) throw new Error(`operator login failed: HTTP ${res.status}`);
    this.cookies.operator = cookie;
    return cookie;
  }

  /** A fresh, independently revocable operator-role session (consumes one login). */
  async freshOperatorSession() {
    const creds = await this.createAdmin("operator");
    const { res, cookie } = await this.login(creds.adminId, creds.password);
    if (!cookie) throw new Error(`fresh operator login failed: HTTP ${res.status}`);
    return { ...creds, cookie };
  }

  mcpHeaders(token, extra = {}) {
    return { ...(token ? { authorization: `Bearer ${token}` } : {}), accept: MCP_ACCEPT, ...extra };
  }

  mcp(token, body, { method = "POST", pathname = "/mcp", headers = {}, rawBody } = {}) {
    return this.mcpHttp.request(method, pathname, {
      headers: this.mcpHeaders(token, headers),
      ...(rawBody !== undefined ? { rawBody } : method === "GET" || method === "DELETE" ? {} : { body })
    });
  }

  rpc(id, method, params) {
    return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
  }

  async wikiRead(token, key) {
    return this.mcp(token, this.rpc(1, "tools/call", { name: "wiki_read", arguments: { path: key } }));
  }

  wikiFile(...segments) {
    return path.join(this.run.paths.project, "wiki", ...segments);
  }

  adminsYaml() {
    return path.join(this.run.paths.project, "webui", "config", "admins.yaml");
  }

  securityDb() {
    return path.join(this.run.paths.project, ".ktx-ui", "security.sqlite");
  }

  digest() {
    return projectDigest(this.run.paths.project);
  }
}
