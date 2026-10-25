// Shared state and helpers for security-integration case handlers (Plan T10 step 4).
// Handlers receive one SecurityContext; they speak real HTTP to the Lucy instance of the run and read
// secrets only from <runDir>/checker/secrets (never from argv, never printed).
//
// C1 additions (2026-10-18 review corrections):
//   - explicit deny-reason allowlist (`explicitDeny` / `denyReasonMatches`); an HTTP 500 or an
//     internal JSON-RPC -32603 is NEVER a denial. Real server returns HTTP 200 with
//     `result.isError: true` and `content[0].text: "Access denied: <reason><hint>..."` — we
//     parse that envelope structurally and look the reason up in the allowlist by prefix
//     (`Access denied: <reason>...`);
//   - independent upstream execution observer (`observeUpstream` / `awaitUpstream`) bound to
//     the run / instance / agent / token / source. Each call acquires a NEW monotonic cursor
//     snapshot (no time-window cache) so a before/after pair is two distinct measured counts;
//     missing provider is `"unknown"`, never a fabricated zero;
//   - dynamic secret registry (`registerDynamicSecret`) that persists atomically to a private
//     0600 file under <runDir>/checker/registry so the global collector can consume it after
//     the run; the file is OUTSIDE the archived tree.

import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync, chmodSync, existsSync } from "node:fs";
import path from "node:path";
import { observeExecutions, toRunnerShape, createPassThroughObserver } from "../lib/execution-observer.mjs";
import { scanMany } from "../lib/leak-scan.mjs";
import { LucyHttp } from "../lib/instance.mjs";

/** JSON-RPC error codes that are policy / authorization / capability refusals (NOT server bugs).
 *  -32603 (internal error) and -32700 (parse error) are NOT deny codes. */
const RPC_POLICY_DENY_CODES = new Set([-32001, -32003, -32600, -32601, -32602]);

/** C1 explicit deny reason allowlist. The real server emits `Access denied: <reason>...` so
 *  lookups are done by PREFIX (the reason comes after `Access denied: ` and may have a hint
 *  suffix). The list is intentionally narrow. */
const DENY_REASON_ALLOWLIST = new Set([
  // AC-P0 capability / auth
  "AUTH_INVALID",
  "AUTH_DISABLED",
  "AUTH_THROTTLED",
  "AUTH_REQUIRED",
  "TOOL_NOT_FOUND",
  "tool_not_found",
  // AC-P1 row policy
  "row_policy_upstream_unproven",
  "row_policy_requires_wrapped_tool",
  "row_policy_query_shape_forbidden",
  "row_policy_field_unresolved",
  "row_policy_op_forbidden",
  "row_policy_predicates_empty",
  // AC-P0 absolute deny
  "tool_absolute_deny:sl_query",
  "tool_absolute_deny:sl_read_source",
  "tool_absolute_deny:sql_execution",
  "tool_absolute_deny:sql_dialect_notes",
  "tool_absolute_deny:memory_ingest",
  "tool_absolute_deny:memory_ingest_status",
  // Connection / source / table
  "unknown_or_forbidden_connection",
  "explicit_table_required",
  "explicit_connection_required",
  "invalid_arguments",
  "raw_query_forbidden",
  // Context / role
  "context_not_available",
  "context_role_required",
  "role_resolution_failed",
  // MCP / generic
  "method_not_found",
  "invalid_request",
  "invalid_params",
  "WIKI_FRONTMATTER_UNSUPPORTED",
  "AUDIT_UNAVAILABLE"
]);

/** Extract the deny reason from the documented MCP envelope. Returns `{ matched, reason,
 *  raw, source }` where:
 *  - `matched` is the allowlisted reason when the response IS an explicit deny
 *  - `source` records where the reason was found so cases can report "wrong envelope"
 *  - HTTP 5xx, internal -32603, -32700 parse errors, and 200 with `result.isError: false`
 *    all return `matched: null` (NOT a deny).
 *  - HTTP 401 / 403 ARE explicit denials (the gate refused the request); the matched
 *    reason is taken from the JSON-RPC error message if it is allowlisted, otherwise
 *    the reason is `http_401` / `http_403` and the case must report "wrong reason". */
export function extractDenyReason(res) {
  if (!res) return { matched: null, reason: null, raw: "", source: "no-response" };
  if (res.status >= 500) {
    return { matched: null, reason: null, raw: res.text?.slice(0, 200) ?? "", source: `http_${res.status}` };
  }
  // 401 / 403 — explicit transport-layer refusals. The matched reason is the
  // allowlisted JSON-RPC error message when present, otherwise `http_401` /
  // `http_403` is the verbatim reason and the case must report "wrong reason".
  if (res.status === 401 || res.status === 403) {
    const errMessage = res.json?.error?.message ?? "";
    for (const allowed of DENY_REASON_ALLOWLIST) {
      if (errMessage === allowed) return { matched: allowed, reason: allowed, raw: errMessage, source: `http_${res.status}` };
    }
    return { matched: `http_${res.status}`, reason: `http_${res.status}`, raw: errMessage, source: `http_${res.status}_unmatched` };
  }
  if (res.status === 404) {
    return { matched: null, reason: null, raw: res.json?.error?.message ?? "", source: "http_404" };
  }
  // JSON-RPC error path
  const err = res.json?.error;
  if (err && typeof err.code === "number") {
    if (!RPC_POLICY_DENY_CODES.has(err.code)) {
      return { matched: null, reason: null, raw: err.message ?? "", source: `jsonrpc_${err.code}` };
    }
    for (const allowed of DENY_REASON_ALLOWLIST) {
      if (err.message === allowed) return { matched: allowed, reason: allowed, raw: err.message, source: "jsonrpc_error" };
    }
    return { matched: null, reason: null, raw: err.message ?? "", source: "jsonrpc_error_unmatched" };
  }
  // MCP tools/call result envelope (HTTP 200, with `result.isError` / `result.content[0].text`)
  const result = res.json?.result;
  if (result && Array.isArray(result.content) && result.content.length > 0) {
    const first = result.content[0];
    const text = first?.text ?? "";
    if (result.isError === true) {
      // Real server emits "Access denied: <reason><hint>". Strip the prefix and match the rest
      // against the allowlist. The reason is taken verbatim up to the first `:` hint delimiter.
      const accessPrefix = "Access denied:";
      if (typeof text === "string" && text.startsWith(accessPrefix)) {
        const tail = text.slice(accessPrefix.length).trim();
        // Reason ends at the first `:` that is followed by a hint (lower-case, 'hint', or '<')
        // OR at end-of-string when there is no hint.
        const hintMatch = tail.match(/^([A-Za-z0-9_\-/:]+)(?::.*)?$/);
        const reason = hintMatch ? hintMatch[1] : tail;
        if (DENY_REASON_ALLOWLIST.has(reason)) {
          return { matched: reason, reason, raw: text, source: "mcp_iserror_access_denied" };
        }
        return { matched: null, reason, raw: text, source: "mcp_iserror_unmatched_reason" };
      }
      return { matched: null, reason: null, raw: text, source: "mcp_iserror_other" };
    }
    // Successful MCP result: 200 + result.isError != true + content[0].text is JSON-encoded data
    return { matched: null, reason: null, raw: text.slice(0, 200), source: "mcp_result_ok" };
  }
  // Other (empty body, non-JSON, no content array, etc.)
  return { matched: null, reason: null, raw: res.text?.slice(0, 200) ?? "", source: "unrecognized" };
}

/** True only when the response is an explicit, allowlisted denial. */
export function explicitDeny(res) {
  return extractDenyReason(res).matched !== null;
}

/** True only when the response is an explicit allowlisted denial whose reason matches the
 *  case's `expectedReason`. A wrong reason returns `false`, not a partial pass. */
export function denyReasonMatches(res, expectedReason) {
  const { matched, source } = extractDenyReason(res);
  if (!matched) return false;
  if (!expectedReason) return true;
  if (matched === expectedReason) return true;
  // Allow the case to match on a substring (e.g. expectedReason = "tool_absolute_deny:sl_query" matches
  // an emitted reason of the same allowlisted value). Equality is the safe default.
  if (matched.includes(expectedReason) && source === "mcp_iserror_access_denied") return true;
  return false;
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
  constructor({ run, lucy, capabilities, observerFactory }) {
    this.run = run;
    this.lucy = lucy;
    this.capabilities = capabilities;
    this.web = new LucyHttp(run.instance.baseUrl);
    // Use the registered MCP URL verbatim (Spec §6.2 / §6.5 / §8.3): it already encodes the proxy port,
    // the non-default pathname and any query prefix the operator chose. Building a new
    // `http://${host}:${proxyPort}` URL would silently drop the pathname/query and, on a real
    // external run, point at the WRONG endpoint of the registered deployment (e.g. the bare
    // 7878 KTX port instead of the 7879 bearer-token-protected MCP proxy). LucyHttp will reject
    // any request that tries to escape this base URL.
    if (!run.instance?.mcpUrl) throw new Error(`SecurityContext requires run.instance.mcpUrl to be set (got ${run.instance?.mcpUrl})`);
    this.mcpHttp = new LucyHttp(run.instance.mcpUrl);
    const secretsDir = run.secretsDir;
    this.tokens = JSON.parse(readFileSync(path.join(secretsDir, "tokens.json"), "utf8"));
    this.adminCreds = JSON.parse(readFileSync(path.join(secretsDir, "admins.json"), "utf8"));
    this.bootstrapToken = readFileSync(path.join(secretsDir, "bootstrap-token"), "utf8").trim();
    const checkerDir = run.paths?.checker ?? path.join(run.paths.runDir, "checker");
    this.gold = JSON.parse(readFileSync(path.join(checkerDir, "gold.json"), "utf8"));
    this.canaries = this.gold.canaries;
    this.cookies = {};
    this.counters = { adminSeq: 0, observerSeq: 0 };
    // Dynamic secrets created during a run (admin passwords, additional agent tokens, etc.).
    // Persisted to a private 0600 file under <runDir>/checker/registry/dynamic-secrets.json so
    // the global collector can consume it after the process ends. The file is OUTSIDE the
    // archived tree (archive-evidence.mjs skips this path). Both fingerprint AND plaintext
    // are stored — the fingerprint is the lookup key, the plaintext is what makes an
    // exact-substring scan possible (the A7 collector cannot match a secret value from its
    // hash alone).
    this.registryDir = path.join(checkerDir, "registry");
    this.registryFile = path.join(this.registryDir, "dynamic-secrets.json");
    if (!existsSync(this.registryDir)) mkdirSync(this.registryDir, { recursive: true, mode: 0o700 });
    this.dynamicSecrets = new Map();
    this._dynamicSecretPlain = new Map();
    if (existsSync(this.registryFile)) {
      try {
        const existing = JSON.parse(readFileSync(this.registryFile, "utf8"));
        for (const entry of existing) {
          this.dynamicSecrets.set(entry.fingerprint, entry);
          if (typeof entry.value === "string" && entry.value.length >= 4) this._dynamicSecretPlain.set(entry.fingerprint, entry.value);
        }
      } catch { /* fresh registry */ }
    }
    // No time-window cache: each call to observeUpstream/awaitUpstream is a distinct monotonic
    // snapshot. We only keep a per-instance cursor so a before/after pair can verify the
    // source produced strictly-monotonically increasing counts (a regression if the provider
    // re-uses the same count).
    this._observerCursor = 0;
    // The observer factory: per-run, returns an asynchronous `observe` callback that the
    // execution-observer module understands. Default is no provider => `unknown`.
    this._observerFactory = typeof observerFactory === "function" ? observerFactory : null;
  }

  /** Register a freshly created secret (token, password) so the leak scan sees it.
   *  Returns a fingerprint that is safe to print.
   *
   *  The plaintext value is persisted to the private 0600 registry file OUTSIDE the
   *  archive tree (under `<runDir>/checker/registry/dynamic-secrets.json`) so the
   *  global collector can perform an exact-substring scan after the process ends.
   *  The file is unreadable by any user other than the run owner (mode 0600) and
   *  never reaches the signed archive. Hash names alone are NOT enough for an
   *  exact-substring leak scan.
   *
   *  The plaintext is ALSO kept in the in-memory leak-scan set (`_dynamicSecretPlain`)
   *  so `allSecrets` always contains the EXACT current secret, even when callers
   *  forget to use `registerDynamicSecretWithPlaintext`. Previously the entry was
   *  fingerprint-only and `allSecrets` relied on a separate map that callers did
   *  not populate — a freshly minted password would evade the leak scanner. */
  registerDynamicSecret(value, label = "agent") {
    if (typeof value !== "string" || value.length < 4) throw new Error("registerDynamicSecret requires a non-trivial string");
    const fingerprint = createHash("sha256").update(value).digest("hex").slice(0, 12);
    this._rememberDynamicSecretPlaintext(value, fingerprint);
    const entry = { fingerprint, label, createdAt: new Date().toISOString(), value };
    this.dynamicSecrets.set(fingerprint, entry);
    this._persistRegistry();
    return fingerprint;
  }

  _persistRegistry() {
    // Persist BOTH fingerprint and plaintext to the private 0600 file. The fingerprint
    // is the lookup key the A7 global collector uses after the process ends; the
    // plaintext is what makes an exact-substring scan possible. Without the plaintext,
    // the collector cannot detect a leak of the secret value itself (fingerprint !=
    // secret). The 0600 mode + path-outside-archive guarantee keeps the value out of
    // the signed archive and away from any non-run-owner reader.
    const entries = [...this.dynamicSecrets.values()];
    const tmp = `${this.registryFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(entries, null, 2), { mode: 0o600 });
    renameSync(tmp, this.registryFile);
    chmodSync(this.registryFile, 0o600);
  }

  /** Every credential value this run knows; any appearance in an output is a leak. */
  get allSecrets() {
    return [
      ...Object.values(this.tokens),
      this.bootstrapToken,
      this.adminCreds.owner.password,
      this.adminCreds.operator.password,
      ...this._dynamicSecretValues()
    ];
  }

  _dynamicSecretValues() {
    // The dynamic-secret plaintexts are kept in this in-memory map. The registry file
    // (and therefore the A7 collector) carries the same plaintexts, but the leak
    // scanner must read them in-process so a leak in an early artefact is caught
    // before the process ends.
    return this._dynamicSecretPlain ? [...this._dynamicSecretPlain.values()] : [];
  }

  _rememberDynamicSecretPlaintext(value, fingerprint = null) {
    if (!this._dynamicSecretPlain) this._dynamicSecretPlain = new Map();
    const fp = fingerprint ?? createHash("sha256").update(value).digest("hex").slice(0, 12);
    this._dynamicSecretPlain.set(fp, value);
  }

  /** Alias kept for callers that explicitly want both `registerDynamicSecret` and the
   *  in-memory plaintext. Behaviour is identical to `registerDynamicSecret`; the
   *  plaintext is now always kept in memory, so the explicit variant is a no-op
   *  beyond being a documentation marker. NEVER pass a secret read from another
   *  source — only mint-time values. */
  registerDynamicSecretWithPlaintext(value, label = "agent") {
    return this.registerDynamicSecret(value, label);
  }

  /** Canaries an identity must never see (everything except the ones it is entitled to). */
  forbiddenFor(allowed = []) {
    return Object.values(this.canaries).filter((value) => !allowed.includes(value));
  }

  scanOptions(allowedCanaries = []) {
    return { secrets: this.allSecrets, forbiddenCanaries: this.forbiddenFor(allowedCanaries) };
  }

  /**
   * Acquire a fresh independent upstream execution observation. Each call returns a NEW
   * snapshot with a strictly-monotonic `cursor` and a `snapshotId` so a before/after pair
   * cannot accidentally read the same value (the fresh review caught a time-window cache
   * returning the same snapshot to both calls).
   *
   * The previous version of this method synchronously called `observeExecutions` (which
   * returns a Promise) and then ran `toRunnerShape(obs)` on the still-pending Promise —
   * every field on the returned shape was `undefined`. The fix is to make this method
   * itself async and to `await` the underlying execution-observer before shaping.
   *
   * Missing provider returns `upstreamExecutionCount: "unknown"`, never a fabricated zero.
   * A bad observation (non-integer, negative, NaN, unallowlisted source) also returns
   * `"unknown"` with a `problems` entry. The cursor / snapshot id are stamped AFTER the
   * upstream call resolves, so a window of identical (since, until, agent, token) inputs
   * still produces a fresh snapshot — but they are NOT the source's own monotonic cursor;
   * for that, look at `hashes.sourceHash` / `hashes.resultSetHash`.
   *
   * @param {Object} args
   * @param {string} args.since          ISO-8601
   * @param {string} args.until          ISO-8601
   * @param {string} args.agentId
   * @param {string} [args.tokenFingerprint]
   * @param {string} [args.identity]   filter identity (default = "lucy-e2e-observer")
   */
  async observeUpstream({ since, until, agentId, tokenFingerprint, identity = "lucy-e2e-observer" } = {}) {
    this.counters.observerSeq += 1;
    const cursor = this.counters.observerSeq;
    const snapshotId = createHash("sha256").update(`${this.run.runId}|${this.run.instanceId ?? ""}|${agentId}|${tokenFingerprint ?? ""}|${since}|${until}|${cursor}`).digest("hex").slice(0, 16);
    if (typeof this._observerFactory !== "function") {
      return {
        upstreamExecutionCount: "unknown",
        window: { since, until },
        source: "no-observer",
        snapshotId,
        cursor,
        problems: ["no independent observation provider was configured (the runner did not wire a real KTX/DB pass-through observer; missing provider is 'unknown', not 0)"]
      };
    }
    const observer = this._observerFactory({
      agentId,
      tokenFingerprint: tokenFingerprint ?? "",
      identity,
      runId: this.run.runId,
      instanceId: this.run.instanceId
    });
    const obs = await observeExecutions({
      runId: this.run.runId,
      instanceId: this.run.instanceId,
      agentId,
      tokenFingerprint: tokenFingerprint ?? "",
      since,
      until,
      observe: observer
    });
    const shape = toRunnerShape(obs);
    shape.snapshotId = snapshotId;
    shape.cursor = cursor;
    return shape;
  }

  /** Async/await interface — the SecurityContext itself awaits the underlying execution
   *  observer and returns the resolved shape. Tests and call sites may `await` this method. */
  async awaitUpstream(args) {
    return this.observeUpstream(args);
  }

  /** Difference between two observations: number of upstream executions that happened in the
   *  window. Returns `null` if either observation is `unknown`, the cursors are not
   *  monotonically ordered, the snapshots do not share the same (agentId, source, identity),
   *  or any of the counts is non-finite. NEVER returns a fabricated zero. */
  upstreamDelta(before, after) {
    if (!before || !after) return null;
    if (before.upstreamExecutionCount === "unknown" || after.upstreamExecutionCount === "unknown") return null;
    if (typeof before.upstreamExecutionCount !== "number" || typeof after.upstreamExecutionCount !== "number") return null;
    if (!Number.isInteger(before.upstreamExecutionCount) || !Number.isInteger(after.upstreamExecutionCount)) return null;
    if (before.upstreamExecutionCount < 0 || after.upstreamExecutionCount < 0) return null;
    if (typeof before.cursor !== "number" || typeof after.cursor !== "number") return null;
    if (after.cursor <= before.cursor) return null;
    if (before.source !== after.source) return null;
    if (before.window?.since !== after.window?.since || before.window?.until !== after.window?.until) return null;
    if (before.snapshotId === after.snapshotId) return null;
    const delta = after.upstreamExecutionCount - before.upstreamExecutionCount;
    if (!Number.isInteger(delta) || delta < 0) return null;
    return delta;
  }

  async authStatus() {
    return this.web.request("GET", "/api/auth/status");
  }

  async login(adminId, password) {
    const res = await this.web.request("POST", "/api/auth/login", { body: { adminId, password } });
    return { res, cookie: res.status === 200 ? res.cookie : null };
  }

  /**
   * A login refused by the product's OWN rate limit is a missing precondition, not a
   * product failure: the case could not be evaluated at all, so it must be BLOCKED.
   *
   * The product's limit (5 logins per account+source per 15 min, 30 per source per
   * 5 min) is a security control and must not be raised for the test suite. This leg
   * establishes a FRESH operator session per case, so a full run can exhaust the
   * per-source budget; the honest verdict for a case that could not get a session is
   * "blocked", never "failed".
   */
  static rateLimitError(message) {
    const error = new Error(message);
    error.blockedReason = "login_rate_limited";
    return error;
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
    if (!cookie) {
      if (res.status === 429) throw SecurityContext.rateLimitError(`owner login refused by the rate limit: HTTP ${res.status}`);
      throw new Error(`owner login failed: HTTP ${res.status}`);
    }
    this.cookies.owner = res.cookie;
    return cookie;
  }

  async adminCall(cookie, method, url, body) {
    return this.web.request(method, url, { cookie, ...(body !== undefined ? { body } : {}) });
  }

  /** Creates an account through the owner API and returns its credentials (never logged).
   *  The plaintext password is registered with the dynamic-secret registry so the leak
   *  scanner can flag it if it ever escapes. */
  async createAdmin(role = "operator") {
    const owner = await this.ownerCookie();
    this.counters.adminSeq += 1;
    const adminId = `e2e-${role}-${Date.now().toString(36)}${this.counters.adminSeq}`;
    const password = `Pw-${createHash("sha256").update(`${adminId}${Math.random()}`).digest("hex").slice(0, 20)}`;
    // Register BEFORE the response so even a 200 echo of the password lands in the registry.
    const fingerprint = this.registerDynamicSecretWithPlaintext(password, `admin:${adminId}`);
    const res = await this.adminCall(owner, "POST", "/api/admin/admins", { adminId, displayName: adminId, password, role });
    if (res.status !== 200) throw new Error(`createAdmin(${role}) failed: HTTP ${res.status}`);
    return { adminId, password, fingerprint };
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
    this.cookies.operator = res.cookie;
    return cookie;
  }

  /** A fresh, independently revocable operator-role session (consumes one login). */
  async freshOperatorSession() {
    const creds = await this.createAdmin("operator");
    const { res, cookie } = await this.login(creds.adminId, creds.password);
    if (!cookie) {
      if (res.status === 429) throw SecurityContext.rateLimitError(`fresh operator login refused by the rate limit: HTTP ${res.status}`);
      throw new Error(`fresh operator login failed: HTTP ${res.status}`);
    }
    return { ...creds, cookie };
  }

  /**
   * Create a disposable Agent identity with a freshly generated token and a single role from
   * the access.yaml template's role set, returning the new plaintext token + fingerprint.
   * The caller MUST save the undo function returned by this method and call it in a
   * try/finally so the run leaves the fixture in its original state. The plaintext token
   * lands in the dynamic-secret registry before any artefact is captured.
   *
   * @param {string} roleId      a role id declared in access.yaml
   * @param {string} agentId     a unique agent id (use `e2e-<roleId>-<runId>` so concurrent runs do not collide)
   */
  async createAgent({ roleId, agentId }) {
    const owner = await this.ownerCookie();
    const token = `lucy_e2e_${randomBytes(24).toString("hex")}`;
    const fingerprint = this.registerDynamicSecretWithPlaintext(token, `agent:${agentId}`);
    const tokenHash = `sha256:${createHash("sha256").update(token).digest("hex")}`;
    const res = await this.adminCall(owner, "POST", "/api/admin/agents", {
      agent: { id: agentId, name: agentId, role: roleId, tokens: [{ hash: tokenHash, label: agentId }] }
    });
    if (res.status !== 200) throw new Error(`createAgent(${agentId}) failed: HTTP ${res.status}`);
    const undo = async () => {
      await this.adminCall(owner, "DELETE", `/api/admin/agents/${encodeURIComponent(agentId)}`);
    };
    return { agentId, token, fingerprint, undo };
  }

  mcpHeaders(token, extra = {}) {
    return { ...(token ? { authorization: `Bearer ${token}` } : {}), accept: MCP_ACCEPT, ...extra };
  }

  mcp(token, body, { method = "POST", pathname = "", headers = {}, rawBody } = {}) {
    // `pathname` defaults to empty string so LucyHttp resolves it against the registered MCP baseUrl
    // verbatim. A real external run may register a non-default pathname like `/lucy-v2/mcp`; passing
    // the literal `/mcp` here would silently strip the prefix and reach a different endpoint.
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

  // ---- Data-plane tool call helpers (MCP tools that touch KTX / data) ----
  // Each helper issues one real MCP `tools/call` request and returns the raw response.
  // Handlers must parse the JSON-RPC payload, verify the expected status / reason,
  // and never trust an HTTP 200 alone to mean the call was authorized (GATE-01).

  async lucyQuery(token, args, id = 1) {
    return this.mcp(token, this.rpc(id, "tools/call", { name: "lucy_query", arguments: args }));
  }

  async lucyReadSource(token, args, id = 1) {
    return this.mcp(token, this.rpc(id, "tools/call", { name: "lucy_read_source", arguments: args }));
  }

  async lucyExplainQuery(token, args, id = 1) {
    return this.mcp(token, this.rpc(id, "tools/call", { name: "lucy_explain_query", arguments: args }));
  }

  async lucyFreshness(token, args, id = 1) {
    return this.mcp(token, this.rpc(id, "tools/call", { name: "lucy_freshness", arguments: args }));
  }

  async lucyCatalog(token, id = 1) {
    return this.mcp(token, this.rpc(id, "tools/call", { name: "lucy_catalog", arguments: {} }));
  }

  async connectionList(token, id = 1) {
    return this.mcp(token, this.rpc(id, "tools/call", { name: "connection_list", arguments: {} }));
  }

  async discoverData(token, args, id = 1) {
    return this.mcp(token, this.rpc(id, "tools/call", { name: "discover_data", arguments: args }));
  }

  async dictionarySearch(token, args, id = 1) {
    return this.mcp(token, this.rpc(id, "tools/call", { name: "dictionary_search", arguments: args }));
  }

  async entityDetails(token, args, id = 1) {
    return this.mcp(token, this.rpc(id, "tools/call", { name: "entity_details", arguments: args }));
  }

  async slQuery(token, args, id = 1) {
    return this.mcp(token, this.rpc(id, "tools/call", { name: "sl_query", arguments: args }));
  }

  async slValidate(token, args, id = 1) {
    return this.mcp(token, this.rpc(id, "tools/call", { name: "sl_validate", arguments: args }));
  }

  /**
   * Parse the MCP `tools/call` JSON content envelope. Returns:
   *   { ok: true,  parsed } when the call returned a structured result
   *   { ok: false, reason, message } when the response is an explicit deny or
   *   a malformed / empty envelope. The caller's checks must use this; they
   *   must NOT rely on HTTP 200 alone to consider a call successful.
   */
  parseMcpToolResult(res) {
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: `http_${res.status}`, message: res.json?.error?.message ?? "" };
    }
    if (res.status === 404) {
      return { ok: false, reason: "tool_not_found", message: res.json?.error?.message ?? "" };
    }
    if (res.status >= 500) {
      return { ok: false, reason: `http_${res.status}`, message: res.text?.slice(0, 200) ?? "" };
    }
    if (res.json?.error) {
      return { ok: false, reason: res.json.error.code ?? "jsonrpc_error", message: res.json.error.message ?? "" };
    }
    const content = res.json?.result?.content;
    if (!Array.isArray(content) || content.length === 0) {
      return { ok: false, reason: "empty_content", message: "" };
    }
    const first = content[0];
    if (first?.type !== "text") {
      return { ok: false, reason: "unexpected_content_type", message: first?.type ?? "unknown" };
    }
    const isError = res.json?.result?.isError === true;
    let parsed = null;
    try { parsed = JSON.parse(first.text); } catch { parsed = first.text; }
    if (isError) {
      return { ok: false, reason: "tool_is_error", message: typeof parsed === "string" ? parsed : JSON.stringify(parsed) };
    }
    return { ok: true, parsed };
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

// Re-export the pass-through observer factory so callers can wire the privileged exec channel
// through `observerFactory: ({ agentId, identity, runId, instanceId }) => observe(...)` without
// pulling the execution-observer module into every handler file.
export { createPassThroughObserver };

/**
 * The A7 global collector reads dynamic-secret plaintexts from the registry file
 * produced by the SecurityContext after the process ends. The contract published
 * here is consumed by the A7 collector (scripts/e2e/lib/a7-collector.ts is a future
 * placeholder; the actual collector is wired through the `archive-evidence.mjs`
 * exclusion of `<runDir>/checker/registry/`). The file is OUTSIDE the archive tree.
 *
 * Schema (lucy-secret-registry-v1):
 *   [ { fingerprint: string(12hex), label: string, createdAt: ISO-8601, value: string }, ... ]
 *
 * The fingerprint is sha256(value).slice(0,12); the value is the exact plaintext. The
 * 0600 mode + path-outside-archive guarantee keeps the value out of the signed
 * archive and away from any non-run-owner reader.
 */
export const SECRET_REGISTRY_CONTRACT = "lucy-secret-registry-v1";

/** Read the registry file path for a run (or null when the run has no checkerDir). */
export function secretRegistryFileFor(run) {
  if (!run?.paths?.checker) return null;
  return path.join(run.paths.checker, "registry", "dynamic-secrets.json");
}
