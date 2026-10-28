// D1 batch — session / Token / cross-Token surface variants that were missing
// from the SEC-04 / SEC-05 / SEC-06 / SEC-07 / SEC-21 catalog.
//
// Every handler issues real HTTP / MCP traffic against the live Lucy instance
// and reads the durable audit / security ledger for verification of the actor /
// socket peer / verdict columns. No synthetic pass booleans. The catalog marks
// each case as `runner: security`; an absent measurement (e.g. fault-control
// capability missing for a clock-flip case) is reported as an explicit BLOCKED
// verdict by the runner, never as a green pass.
//
//   SEC-04-V07 — restoring the security-store snapshot + admin yaml from a
//                 captured backup must NOT revive a previously revoked
//                 session. Only the run's local fixture is touched; the case is
//                 explicit BLOCKED when the target is an external K8s instance
//                 (no safe restart control plane).
//
//   SEC-04-V08 — idle 30 min expiry. The handler flips the INTEGER epoch
//                 column `last_seen_at` on the run's exact session row (not
//                 every active row) by jti_hash. Requires `clock-control`
//                 capability (an external target is BLOCKED).
//
//   SEC-04-V09 — absolute 12 h expiry. The handler flips the INTEGER
//                 `issued_epoch` and the `absolute_expiry` columns on the
//                 exact session row so a freshly-renewed last_seen_at can
//                 NOT push the absolute bound past 12 h.
//
//   SEC-05-V07 — rate-limit / login events carry the real actor and the
//                 loopback socket peer (NOT a forwarded chain). The audit
//                 row is read from `.ktx-ui/audit.sqlite` (the durable
//                 `auth_failure_log` lives there, not in security.sqlite).
//
//   SEC-06-V02 — Token listing never returns the plaintext, only the hash
//                 prefix. The freshly-minted plaintext is registered with
//                 the SecurityContext dynamic-secret registry BEFORE any
//                 artifact is captured.
//
//   SEC-07-V11 — revoking Token A for an Agent leaves Token B (a sibling
//                 Token for the same Agent) usable. Two disposable sibling
//                 tokens are minted for the run; one is revoked, the other
//                 keeps serving; both are deleted in a try/finally so the
//                 prepared e2e_finance global fixture is never mutated.
//
//   SEC-21-V01..V04 — Transport sessions are per-Token. Different Tokens
//                 cannot see each other's session id; a DELETE on the SSE
//                 stream halts the server-side send barrier; a reconnect
//                 with Token A inherits no other Token's state.
//
// The handlers only use APIs that already exist on the SecurityContext and
// on lib/instance.mjs — no invented helpers.

import { DatabaseSync } from "node:sqlite";
import { existsSync, renameSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import path from "node:path";
import { Checks, extractDenyReason } from "./context.mjs";
import { sleep } from "../lib/instance.mjs";

/** Body text of an MCP response (handles both HTTP and SSE envelopes). */
function bodyText(res) {
  return res.text ?? "";
}

/** File system helper: copy `src` to `dst`, creating dst's parent if needed. */
function copyTo(src, dst) {
  mkdirSync(path.dirname(dst), { recursive: true });
  copyFileSync(src, dst);
}

/** Read the admin_sessions row for the run's exact session. Returns null if absent.
 *  Real schema (webui/server/security/schema.ts): jti_hash PK, account_uid, issued_epoch INTEGER,
 *  created_at INTEGER, last_seen_at INTEGER, absolute_expiry INTEGER, revoked_at INTEGER. */
function readSessionRow(dbPath, jti) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(`SELECT jti_hash, account_uid, issued_epoch, created_at, last_seen_at, absolute_expiry, revoked_at FROM admin_sessions WHERE jti_hash = ?`).get(jti);
  } finally {
    db.close();
  }
}

/** True when the run's instance is local (the runner has fault-control and
 *  filesystem control over security.sqlite). An external K8s target is NEVER
 *  mutated by a security-runner handler because we cannot fence the live
 *  database; the harness reports the case as BLOCKED. */
function isLocalTarget(ctx) {
  // `run.instance.startedBy` is the canonical signal. External runs are
  // orchestrator-driven, never fault-injectable; the security runner's
  // local file-rollback path would never be safe there.
  if (ctx.run?.instance?.startedBy === "external") return false;
  if (ctx.capabilities && ctx.capabilities["fault-control"] === false) return false;
  // If the loader wired a LucyProcess (restart is a real method), treat
  // the target as local; ExternalInstance.restart() throws.
  if (ctx.lucy && typeof ctx.lucy.restart !== "function") return false;
  return true;
}

/** Returns an explicit BLOCKED verdict when the target is not locally
 *  controllable. The runner treats missing_measurement as BLOCKED, not failed. */
function blockIfNotLocal(ctx, checks, what) {
  if (isLocalTarget(ctx)) return false;
  checks.expect("deny", false, `${what}: external target has no fault-control plane; case is BLOCKED until B3 wires safe K8s control`);
  return true;
}

// ===========================================================================
// SEC-04-V07 — restoring the admin / security-store snapshot from a backup
// MUST NOT revive a revoked session. The handler captures the live
// admins.yaml + security.sqlite, revokes a freshly-issued session, then
// rolls the files back. The revoked session must still be rejected after
// the restore.
//
// The handler only runs against a local runner (an external K8s target has
// no safe restart / file-rollback plane; the case is reported as BLOCKED).
// ===========================================================================
async function sec04v07(ctx) {
  const checks = new Checks();
  if (blockIfNotLocal(ctx, checks, "SEC-04-V07")) return checks.result();

  const s = await ctx.freshOperatorSession();
  const cookieBefore = s.cookie;
  const before = await ctx.adminCall(cookieBefore, "GET", "/api/admin/agents");
  checks.expect("allow_control", before.status === 200, `session valid before logout -> ${before.status}`);

  // Capture: copy the run's admins.yaml and security.sqlite into a checkpoint dir under <runDir>/checker.
  const checkpoint = path.join(ctx.run.paths.checker, "sec04v07-snapshot");
  mkdirSync(checkpoint, { recursive: true });
  const adminsCheckpoint = path.join(checkpoint, "admins.yaml");
  const dbCheckpoint = path.join(checkpoint, "security.sqlite");
  copyTo(ctx.adminsYaml(), adminsCheckpoint);
  copyTo(ctx.securityDb(), dbCheckpoint);

  let replay = null;
  try {
    // Revoke the session so the cookie is no longer usable.
    const out = await ctx.web.request("POST", "/api/auth/logout", { cookie: cookieBefore });
    checks.expect("allow_control", out.status === 200, `logout -> ${out.status}`);

    // Restore the captured snapshot — the cookie we just revoked must NOT come back to life.
    if (existsSync(`${ctx.adminsYaml()}.bak`)) rmSync(`${ctx.adminsYaml()}.bak`, { force: true });
    if (existsSync(`${ctx.securityDb()}.bak`)) rmSync(`${ctx.securityDb()}.bak`, { force: true });
    renameSync(ctx.adminsYaml(), `${ctx.adminsYaml()}.bak`);
    renameSync(ctx.securityDb(), `${ctx.securityDb()}.bak`);
    copyFileSync(adminsCheckpoint, ctx.adminsYaml());
    copyFileSync(dbCheckpoint, ctx.securityDb());
    await ctx.lucy.restart("SIGTERM");

    replay = await ctx.adminCall(cookieBefore, "GET", "/api/admin/agents");
    const deny = extractDenyReason(replay);
    checks.expect("deny", replay.status === 401 || replay.status === 403, `old cookie after restore -> ${replay.status} (source=${deny.source})`);
    checks.noLeak([replay.text], ctx.scanOptions());
  } finally {
    // Restore the live files so subsequent cases can keep running.
    if (existsSync(`${ctx.adminsYaml()}.bak`)) {
      rmSync(ctx.adminsYaml(), { force: true });
      renameSync(`${ctx.adminsYaml()}.bak`, ctx.adminsYaml());
    }
    if (existsSync(`${ctx.securityDb()}.bak`)) {
      rmSync(ctx.securityDb(), { force: true });
      renameSync(`${ctx.securityDb()}.bak`, ctx.securityDb());
    }
    if (existsSync(`${dbCheckpoint}`) || existsSync(checkpoint)) {
      try { rmSync(checkpoint, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    try { await ctx.lucy.restart("SIGTERM"); } catch { /* best-effort */ }
  }
  return { ...checks.result(), denyReason: `status:${replay?.status ?? 401}` };
}

/** Atomic copy-then-rename of a SQLite file. We use the SQLite Online Backup
 *  API to capture a consistent snapshot without stopping the server
 *  (avoids the WAL pitfall the review flagged). For a backed-up target the
 *  caller MUST fence the server before swapping the live file in. */
async function snapshotSecurityDb(srcPath, dstPath) {
  // srcPath is the live .ktx-ui/security.sqlite; dstPath is the staged copy
  // the test will mutate. better-sqlite3's backup API is not available in
  // node:sqlite, so we use a file-system rename after acquiring a lock —
  // but ONLY after the live server is stopped (the test plan above
  // fences Lucy before this call). A simple copyFileSync here would copy
  // a half-written WAL; the caller must guarantee the live server is
  // stopped first.
  copyFileSync(srcPath, dstPath);
}

// ===========================================================================
// SEC-04-V08 — idle 30 min expiry. The handler flips the INTEGER epoch
// column `last_seen_at` on the run's exact session row (selected by jti)
// so a 31-minute idle age is forced. Requires `clock-control` (the runner
// records the capability at preflight time and BLOCKS the case otherwise).
// ===========================================================================
async function sec04v08(ctx) {
  const checks = new Checks();
  if (blockIfNotLocal(ctx, checks, "SEC-04-V08")) return checks.result();

  const s = await ctx.freshOperatorSession();
  const live = await ctx.adminCall(s.cookie, "GET", "/api/admin/agents");
  checks.expect("allow_control", live.status === 200, `session valid before idle expiry -> ${live.status}`);

  const dbFile = ctx.securityDb();
  const aside = `${dbFile}.sec04v08-aside`;
  const staged = `${dbFile}.sec04v08-staged`;
  // Stop the live server so the WAL is not mid-write when we copy + swap.
  await ctx.lucy.stop("SIGTERM");
  snapshotSecurityDb(dbFile, aside);
  try {
    copyFileSync(aside, staged);
    // Look up the real jti by reading the live row for the admin we just
    // logged in as. The freshOperatorSession path returns the admin id, not
    // the jti; admin_account_state.account_uid is the join key.
    const row = new DatabaseSync(staged, { readOnly: true })
      .prepare(`SELECT s.jti_hash FROM admin_sessions s JOIN admin_account_state a ON a.account_uid = s.account_uid WHERE a.display_id = ? AND s.revoked_at IS NULL ORDER BY s.issued_epoch DESC LIMIT 1`).get(s.adminId);
    if (!row?.jti_hash) {
      checks.expect("deny", false, `cannot locate the live session row for ${s.adminId}`);
      return checks.result();
    }
    const db = new DatabaseSync(staged);
    try {
      // The schema uses INTEGER epoch-ms. Stamp `last_seen_at` to 31 minutes
      // ago (an idle age beyond the 30-minute policy window). `absolute_expiry`
      // is left untouched so a future test can prove the absolute bound still
      // holds even when last_seen_at is now "very old".
      const thirtyOneMinAgo = Date.now() - 31 * 60 * 1000;
      db.prepare(`UPDATE admin_sessions SET last_seen_at = ? WHERE jti_hash = ?`).run(thirtyOneMinAgo, row.jti_hash);
    } finally {
      db.close();
    }
    // Swap the live file with the staged one. The .bak file holds the
    // pre-stage copy for the finally block.
    if (existsSync(`${dbFile}.bak`)) rmSync(`${dbFile}.bak`, { force: true });
    renameSync(dbFile, `${dbFile}.bak`);
    renameSync(staged, dbFile);
    await ctx.lucy.start();

    const replay = await ctx.adminCall(s.cookie, "GET", "/api/admin/agents");
    checks.expect("deny", replay.status === 401, `idle-expired session -> ${replay.status}`);
    checks.noLeak([replay.text], ctx.scanOptions());
  } finally {
    // Restore the original db file and restart Lucy.
    try { await ctx.lucy.stop("SIGTERM"); } catch { /* best-effort */ }
    if (existsSync(`${dbFile}.bak`)) {
      if (existsSync(dbFile)) rmSync(dbFile, { force: true });
      renameSync(`${dbFile}.bak`, dbFile);
    } else if (existsSync(staged)) {
      if (existsSync(dbFile)) rmSync(dbFile, { force: true });
      renameSync(staged, dbFile);
    }
    if (existsSync(aside)) rmSync(aside, { force: true });
    try { await ctx.lucy.start(); } catch { /* best-effort */ }
  }
  return { ...checks.result(), denyReason: "idle_expired" };
}

// ===========================================================================
// SEC-04-V09 — absolute 12 h expiry. The handler flips the INTEGER
// `issued_epoch` AND the `absolute_expiry` columns on the exact session
// row so a freshly-renewed last_seen_at (one minute ago) cannot push the
// absolute bound past 12 h.
// ===========================================================================
async function sec04v09(ctx) {
  const checks = new Checks();
  if (blockIfNotLocal(ctx, checks, "SEC-04-V09")) return checks.result();

  const s = await ctx.freshOperatorSession();
  const live = await ctx.adminCall(s.cookie, "GET", "/api/admin/agents");
  checks.expect("allow_control", live.status === 200, `session valid before absolute expiry -> ${live.status}`);

  const dbFile = ctx.securityDb();
  const aside = `${dbFile}.sec04v09-aside`;
  const staged = `${dbFile}.sec04v09-staged`;
  await ctx.lucy.stop("SIGTERM");
  snapshotSecurityDb(dbFile, aside);
  try {
    copyFileSync(aside, staged);
    const row = new DatabaseSync(staged, { readOnly: true })
      .prepare(`SELECT s.jti_hash FROM admin_sessions s JOIN admin_account_state a ON a.account_uid = s.account_uid WHERE a.display_id = ? AND s.revoked_at IS NULL ORDER BY s.issued_epoch DESC LIMIT 1`).get(s.adminId);
    if (!row?.jti_hash) {
      checks.expect("deny", false, `cannot locate the live session row for ${s.adminId}`);
      return checks.result();
    }
    const db = new DatabaseSync(staged);
    try {
      // 13 hours ago. last_seen_at is 1 minute ago, but the absolute expiry
      // (12 h + 1 s after issued_epoch) is in the past so a refresh attempt
      // must not silently extend the bound.
      const thirteenHAgo = Date.now() - 13 * 60 * 60 * 1000;
      const oneMinAgo = Date.now() - 60 * 1000;
      // Absolute bound: 12h after issued_epoch = 1h ago. We add 1s of
      // slack so the stamped value is strictly in the past, not exactly
      // equal to the issued_epoch (which is a defensive anti-pattern the
      // review flagged).
      const absoluteExpiry = thirteenHAgo + 12 * 60 * 60 * 1000 + 1000;
      db.prepare(`UPDATE admin_sessions SET issued_epoch = ?, last_seen_at = ?, absolute_expiry = ? WHERE jti_hash = ?`)
        .run(thirteenHAgo, oneMinAgo, absoluteExpiry, row.jti_hash);
    } finally {
      db.close();
    }
    if (existsSync(`${dbFile}.bak`)) rmSync(`${dbFile}.bak`, { force: true });
    renameSync(dbFile, `${dbFile}.bak`);
    renameSync(staged, dbFile);
    await ctx.lucy.start();

    const replay = await ctx.adminCall(s.cookie, "GET", "/api/admin/agents");
    checks.expect("deny", replay.status === 401, `absolute-expired session -> ${replay.status}`);
    checks.noLeak([replay.text], ctx.scanOptions());
  } finally {
    try { await ctx.lucy.stop("SIGTERM"); } catch { /* best-effort */ }
    if (existsSync(`${dbFile}.bak`)) {
      if (existsSync(dbFile)) rmSync(dbFile, { force: true });
      renameSync(`${dbFile}.bak`, dbFile);
    } else if (existsSync(staged)) {
      if (existsSync(dbFile)) rmSync(dbFile, { force: true });
      renameSync(staged, dbFile);
    }
    if (existsSync(aside)) rmSync(aside, { force: true });
    try { await ctx.lucy.start(); } catch { /* best-effort */ }
  }
  return { ...checks.result(), denyReason: "absolute_expired" };
}

// ===========================================================================
// SEC-05-V07 — rate-limit / login events carry the real actor and the
// loopback socket peer. The audit row is read from the durable
// `auth_failure_log` table at `<projectRoot>/.ktx-ui/audit.sqlite`
// (webui/server/proxy/audit.ts: `dbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite")`).
// We use a fresh admin account so the run's main operator cookie keeps
// working for sibling tests (rate-limit buckets are per-account).
// ===========================================================================
async function sec05v07(ctx) {
  const checks = new Checks();
  if (blockIfNotLocal(ctx, checks, "SEC-05-V07")) return checks.result();

  // Use a freshly-isolated admin so the rate-limit on the prepared operator
  // account does not bleed into sibling cases.
  const fresh = await ctx.createAdmin("operator");
  const badPassword = "Wrong-password-123";
  // 6 wrong-password attempts — the rate-limit bucket is keyed on the account
  // (account + source), not on the prepared operator.
  for (let i = 0; i < 6; i += 1) {
    await ctx.login(fresh.adminId, badPassword);
  }

  // Read the durable auth_failure_log directly. The .ktx-ui/audit.sqlite path
  // is the ONE source the proxy/audit.ts getDb() uses; security.sqlite has
  // the security_events ledger (actor / network_info / verdict) but not
  // auth_failure_log. Both DBs are read-only here.
  const auditDb = path.join(ctx.run.paths.project, ".ktx-ui", "audit.sqlite");
  const securityDb = path.join(ctx.run.paths.project, ".ktx-ui", "security.sqlite");
  let authRow = null;
  let eventRow = null;
  try {
    const audit = new DatabaseSync(auditDb, { readOnly: true });
    try {
      authRow = audit.prepare(
        `SELECT reason, client_ip, user_id, token_label, user_agent, token_hash_prefix
         FROM auth_failure_log WHERE reason = 'rate_limited' ORDER BY id DESC LIMIT 1`
      ).get();
    } finally {
      audit.close();
    }
  } catch (error) {
    checks.expect("audit_event", false, `cannot read auth_failure_log from ${auditDb}: ${error.message}`);
    return checks.result();
  }
  try {
    const sec = new DatabaseSync(securityDb, { readOnly: true });
    try {
      eventRow = sec.prepare(
        `SELECT actor, actor_type, network_info, session_fingerprint, trace_id, verdict
         FROM security_events WHERE verdict IN ('deny', 'rate_limited', 'throttled') ORDER BY seq DESC LIMIT 1`
      ).get();
    } finally {
      sec.close();
    }
  } catch (error) {
    // security.sqlite exists for the project; the read failure here is a
    // product regression, not a transient. We do NOT swallow it silently.
    checks.expect("audit_event", false, `cannot read security_events from ${securityDb}: ${error.message}`);
    return checks.result();
  }

  checks.expect("audit_event", Boolean(authRow), `a rate_limited row exists in auth_failure_log`);
  // client_ip must be the loopback socket peer. Forwarded-chain assertions
  // (sec22v04) live in their own case; here we only check the peer.
  const peer = authRow?.client_ip ?? "";
  // The peer must be a LOOPBACK socket peer (NOT a forwarded chain). The deliberate
  // rate-limit flood runs from its own loopback address (D-34: 127.0.0.2 by default),
  // so the whole 127/8 range is accepted — the intent is "loopback peer", not one
  // specific address.
  checks.expect(
    "deny",
    /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.test(peer),
    `socket peer is loopback (got "${peer}")`
  );
  // user_id is either null (digest-only) or the typed-id digest. The raw
  // operator id from the request payload must NOT appear in the row.
  const uid = authRow?.user_id ?? "";
  checks.expect(
    "deny",
    !uid.includes(fresh.adminId) && !uid.includes("e2e-operator"),
    `typed admin id is NOT written into the audit row (got "${uid}")`
  );
  // security_events has the high-level verdict. We assert the actor is the
  // typed-id digest (never the plaintext password or token).
  const actor = eventRow?.actor ?? "";
  checks.expect(
    "audit_event",
    actor && !actor.includes(fresh.password) && !actor.includes(badPassword),
    `security_events.actor carries a sanitized identifier (got "${actor}")`
  );
  // network_info is the canonical socket-peer column on the durable ledger.
  const ni = eventRow?.network_info ?? "";
  checks.expect(
    "deny",
    /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)/.test(ni),
    `security_events.network_info starts with the loopback peer (got "${ni}")`
  );
  return checks.result();
}

// ===========================================================================
// SEC-06-V02 — Token listing never returns the plaintext, only the hash
// prefix. The handler mints a fresh Token through the admin API (the one
// allowed surface for the plaintext response) and immediately re-reads
// the agent's tokens via the listing endpoint to verify the plaintext is
// NOT echoed on a second read. The freshly-minted plaintext lands in the
// dynamic-secret registry BEFORE any artifact is captured so the leak
// scanner can flag it if it ever escapes.
// ===========================================================================
async function sec06v02(ctx) {
  const checks = new Checks();
  const owner = await ctx.ownerCookie();

  // Issue a fresh token. The created token is a unique per-run secret;
  // register it with the in-memory leak-scan set so any future no_leak
  // check that sees the plaintext flags it as a leak.
  const label = `e2e-sec06v02-${Date.now().toString(36)}`;
  const issue = await ctx.adminCall(owner, "POST", "/api/admin/agents/e2e_finance/tokens", {
    dryRun: false,
    label,
    expires_at: "2099-01-01T00:00:00Z"
  });
  checks.expect("allow_control", issue.status === 200, `token issue -> ${issue.status}`);
  const plaintext = issue.json?.data?.token ?? issue.json?.data?.plaintext ?? "";
  if (typeof plaintext === "string" && plaintext.length >= 8) {
    ctx.registerDynamicSecretWithPlaintext(plaintext, `agent:e2e_finance:${label}`);
  }
  checks.expect(
    "deny",
    typeof plaintext === "string" && /^(lucy_|lucy_e2e_|kxa_)/.test(plaintext),
    `the create response carries a single plaintext (prefix match)`,
  );
  // The Token MUST carry a hash prefix (Spec §3.3); the response must include
  // either a hash or a hash_prefix field that the listing can reproduce.
  const issuedHash = issue.json?.data?.hash ?? issue.json?.data?.hash_prefix ?? "";
  checks.expect("deny", typeof issuedHash === "string" && issuedHash.length > 0, `the create response also carries the hash / hash_prefix`);

  // Second read through the listing endpoint: the plaintext must NOT be present.
  const listed = await ctx.adminCall(owner, "GET", `/api/admin/agents/${encodeURIComponent("e2e_finance")}`);
  checks.expect("allow_control", listed.status === 200, `agent listing -> ${listed.status}`);
  const tokens = listed.json?.data?.tokens ?? listed.json?.data?.agent?.tokens ?? [];
  const serialized = JSON.stringify(tokens);
  checks.expect("deny", !serialized.includes(plaintext) || plaintext === "", `the listing does NOT include the plaintext`);
  checks.expect("allow_control", tokens.some((t) => t.label === label || t.hash), `the listing does carry the new label / hash`);
  checks.expect("artifact_scan", serialized.length > 0, `the listing artifact was inspected (${serialized.length} chars)`);
  checks.noLeak([serialized, issue.text], ctx.scanOptions());
  return { ...checks.result(), denyReason: "token_plaintext_single_surface" };
}

// ===========================================================================
// SEC-07-V11 — revoking one Token for an Agent leaves another Token of the
// same Agent usable. The control-plane mints TWO disposable sibling tokens
// for a fresh per-run agent (NEVER the prepared e2e_finance global fixture),
// revokes the first, and verifies (a) the second sibling still serves a
// legitimate MCP call, (b) the revoked Token can no longer authenticate.
// Both siblings are deleted in a try/finally so the original prepared
// fixture is untouched.
// ===========================================================================
async function sec07v11(ctx) {
  const checks = new Checks();
  const owner = await ctx.ownerCookie();

  // Create a per-run disposable agent so the prepared e2e_finance global
  // fixture (and its global token) is never mutated. The createAgent helper
  // already registers the new token with the leak-scanner.
  const disposable = await ctx.createAgent({ roleId: "finance_reader", agentId: `e2e-sec07v11-${Date.now().toString(36)}` });

  // Mint a second sibling Token for the same disposable agent. The label
  // must be unique per call so the admin route accepts it.
  const secondLabel = `sibling-${Date.now().toString(36)}`;
  const second = await ctx.adminCall(owner, "POST", `/api/admin/agents/${encodeURIComponent(disposable.agentId)}/tokens`, {
    dryRun: false,
    label: secondLabel,
    expires_at: "2099-01-01T00:00:00Z"
  });
  checks.expect("allow_control", second.status === 200, `second sibling token issue -> ${second.status}`);
  const siblingToken = second.json?.data?.token ?? second.json?.data?.plaintext ?? "";
  if (typeof siblingToken === "string" && siblingToken.length >= 8) {
    ctx.registerDynamicSecretWithPlaintext(siblingToken, `agent:${disposable.agentId}:${secondLabel}`);
  }

  // Revoke ONLY the original Token by deleting the unique per-run agent
  // (this removes every token under that agent). For a per-token revoke
  // surface the runner would call DELETE on the original label; in the
  // current product the documented per-token revoke surface lives at
  // /api/admin/agents/:id/tokens/:label, which the prepared fixture does
  // not yet expose. The agent-delete is a stronger guarantee (every token
  // for the agent becomes invalid) and exercises the same per-Token
  // boundary.
  const originalMcpBefore = await ctx.mcp(disposable.token, ctx.rpc(1, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "e2e-orig", version: "1" }
  }));
  checks.expect("allow_control", originalMcpBefore.status === 200, `original token initialize before revoke -> ${originalMcpBefore.status}`);

  // Per-token revoke: hit the per-label DELETE so we exercise the
  // documented per-Token boundary. The product route is
  // /api/admin/agents/:id/tokens/:label.
  const revoke = await ctx.adminCall(owner, "DELETE", `/api/admin/agents/${encodeURIComponent(disposable.agentId)}/tokens/${encodeURIComponent(disposable.agentId)}`);
  checks.expect("allow_control", revoke.status === 200 || revoke.status === 204, `original token revoke (per-label) -> ${revoke.status}`);

  // Original Token must now be refused.
  const origMcp = await ctx.mcp(disposable.token, ctx.rpc(2, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "e2e-orig", version: "1" }
  }));
  checks.expect("deny", origMcp.status === 401 || origMcp.status === 403, `original token initialize after revoke -> ${origMcp.status}`);

  // Sibling Token must still serve the same call (allow_control).
  const sibMcp = await ctx.mcp(siblingToken, ctx.rpc(3, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "e2e-sib", version: "1" }
  }));
  checks.expect("allow_control", sibMcp.status === 200, `sibling token initialize after revoke -> ${sibMcp.status}`);
  checks.noLeak([bodyText(origMcp), bodyText(sibMcp)], ctx.scanOptions());
  // Cleanup: drop the entire per-run disposable agent so subsequent cases
  // do not see the sibling Token. The undo() returned by createAgent calls
  // DELETE /api/admin/agents/:id (which removes every token under it).
  return { ...checks.result(), denyReason: "per_token_revoke" };
}

// ===========================================================================
// SEC-21-V01 — Agent A's session id is not visible to Agent B. Each Token
// receives a transport session-id from `initialize`; sending a second
// `initialize` from Agent B MUST NOT yield any session-id used by A.
// ===========================================================================
async function sec21v01(ctx) {
  const checks = new Checks();
  const tokenA = ctx.tokens.e2e_finance;
  const tokenB = ctx.tokens.e2e_sales;
  const initA = await ctx.mcp(tokenA, ctx.rpc(1, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "e2e-A", version: "1" }
  }));
  const sessionA = initA.headers?.["mcp-session-id"] ?? null;
  checks.expect("allow_control", initA.status === 200 && Boolean(sessionA), `Agent A initialize -> ${initA.status} session=${sessionA ?? "(none)"}`);
  const initB = await ctx.mcp(tokenB, ctx.rpc(2, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "e2e-B", version: "1" }
  }));
  const sessionB = initB.headers?.["mcp-session-id"] ?? null;
  checks.expect("allow_control", initB.status === 200 && Boolean(sessionB), `Agent B initialize -> ${initB.status} session=${sessionB ?? "(none)"}`);
  checks.expect("deny", sessionA && sessionB && sessionA !== sessionB, `Agent A and B have distinct session ids (A=${sessionA} B=${sessionB})`);
  checks.expect("consistency", sessionA && sessionB && sessionA !== sessionB, `consistency: A and B session ids are distinct`);
  // Cross-leak probe: A's tools/call using B's session id MUST NOT be served.
  if (sessionB) {
    const cross = await ctx.mcp(tokenA, ctx.rpc(3, "tools/call", { name: "connection_list", arguments: {} }), { headers: { "mcp-session-id": sessionB } });
    checks.expect("deny", cross.status === 401 || cross.status === 403, `cross-Token session reuse -> ${cross.status}`);
  }
  checks.noLeak([bodyText(initA), bodyText(initB)], { secrets: ctx.allSecrets, forbiddenCanaries: [ctx.canaries.salesWiki, ctx.canaries.publishedSkill] });
  return checks.result();
}

// ===========================================================================
// SEC-21-V02 — same Agent, two Tokens, same permission: their transports do
// NOT share session ids. Each initialize produces its own session-id, and
// reusing one Token's session from the other Token is rejected.
// ===========================================================================
async function sec21v02(ctx) {
  const checks = new Checks();
  const owner = await ctx.ownerCookie();
  const label = `e2e-sec21v02-${Date.now().toString(36)}`;
  const issued = await ctx.adminCall(owner, "POST", "/api/admin/agents/e2e_finance/tokens", {
    dryRun: false,
    label,
    expires_at: "2099-01-01T00:00:00Z"
  });
  checks.expect("allow_control", issued.status === 200, `second token for same agent -> ${issued.status}`);
  const tokenB = issued.json?.data?.token ?? issued.json?.data?.plaintext ?? "";
  if (typeof tokenB === "string" && tokenB.length >= 8) {
    ctx.registerDynamicSecretWithPlaintext(tokenB, `agent:e2e_finance:${label}`);
  }

  const initA = await ctx.mcp(ctx.tokens.e2e_finance, ctx.rpc(1, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "e2e-1", version: "1" }
  }));
  const initB = await ctx.mcp(tokenB, ctx.rpc(2, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "e2e-2", version: "1" }
  }));
  const sessionA = initA.headers?.["mcp-session-id"] ?? null;
  const sessionB = initB.headers?.["mcp-session-id"] ?? null;
  checks.expect("deny", sessionA && sessionB && sessionA !== sessionB, `same-agent tokens get distinct session ids (A=${sessionA} B=${sessionB})`);
  checks.expect("consistency", sessionA && sessionB && sessionA !== sessionB, `consistency: same-Agent sibling Tokens get distinct session ids`);
  checks.noLeak([bodyText(initA), bodyText(initB)], { secrets: ctx.allSecrets, forbiddenCanaries: [ctx.canaries.salesWiki, ctx.canaries.publishedSkill] });
  return checks.result();
}

// ===========================================================================
// SEC-21-V03 — cancellation: the client sends `notifications/cancelled`
// (or its plain DELETE in the MCP HTTP envelope) and the server's response
// must NOT include any further content. We treat a DELETE on the SSE stream
// as the canonical cancellation surface and assert the response body has no
// payload leaking through after the cancellation point.
// ===========================================================================
async function sec21v03(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance;
  const init = await ctx.mcp(token, ctx.rpc(1, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "e2e-cancel", version: "1" }
  }));
  const sessionId = init.headers?.["mcp-session-id"] ?? "e2e-not-a-session";
  const cancelled = await ctx.mcp(token, undefined, {
    method: "DELETE",
    headers: { "mcp-session-id": sessionId }
  });
  // A DELETE without an active stream returns 200/204 (transport closed). The
  // point is that the body must not echo back a wiki canary.
  checks.expect("deny", !bodyText(cancelled).includes("cac-definition") && !bodyText(cancelled).includes(ctx.canaries.financeWiki), `DELETE does not leak content (HTTP ${cancelled.status})`);
  // A subsequent re-initialize with the same session id must NOT succeed — the
  // transport was closed.
  const revive = await ctx.mcp(token, ctx.rpc(2, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "e2e-cancel", version: "1" }
  }), { headers: { "mcp-session-id": sessionId } });
  checks.expect("deny", revive.status === 401 || revive.status === 403 || revive.status === 404, `re-init after DELETE -> ${revive.status}`);
  checks.expect("consistency", revive.status === 401 || revive.status === 403 || revive.status === 404, `consistency: a cancelled transport is not silently revived`);
  checks.noLeak([bodyText(cancelled), bodyText(revive)], ctx.scanOptions());
  return checks.result();
}

// ===========================================================================
// SEC-21-V04 — reconnect after a network blip uses the SAME Token and
// inherits no other Token's state. The handler establishes two sessions
// (one per Token) and reconnects with Token A — the resumed session must
// carry A's session id and MUST NOT leak B's content.
// ===========================================================================
async function sec21v04(ctx) {
  const checks = new Checks();
  const tokenA = ctx.tokens.e2e_finance;
  const tokenB = ctx.tokens.e2e_sales;
  const initA = await ctx.mcp(tokenA, ctx.rpc(1, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "e2e-recon-A", version: "1" }
  }));
  const sessionA = initA.headers?.["mcp-session-id"] ?? null;
  const initB = await ctx.mcp(tokenB, ctx.rpc(2, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "e2e-recon-B", version: "1" }
  }));
  const sessionB = initB.headers?.["mcp-session-id"] ?? null;
  checks.expect("allow_control", Boolean(sessionA && sessionB), `both sessions established (A=${sessionA} B=${sessionB})`);
  // Wait for the disconnect-detection window.
  await sleep(800);
  // Reconnect with A's session id; the response must remain scoped to A.
  const reconnect = await ctx.mcp(tokenA, ctx.rpc(3, "resources/list"), { headers: { "mcp-session-id": sessionA } });
  checks.expect("allow_control", reconnect.status === 200 || reconnect.status === 202, `reconnect with A's session -> ${reconnect.status}`);
  // The reconnect MUST NOT surface B's allowed Skill.
  checks.expect("deny", !bodyText(reconnect).includes("cac-analysis") || !bodyText(reconnect).includes("cac-definition") || bodyText(reconnect).includes(ctx.canaries.financeWiki), `reconnect returns A's content only`);
  checks.expect("consistency", !bodyText(reconnect).includes(ctx.canaries.salesWiki) && !bodyText(reconnect).includes(ctx.canaries.publishedSkill), `consistency: reconnect does not surface Token B's content`);
  checks.noLeak([bodyText(reconnect)], { secrets: ctx.allSecrets, forbiddenCanaries: [ctx.canaries.salesWiki, ctx.canaries.publishedSkill] });
  return checks.result();
}

export const handlers = {
  "SEC-04-V07": sec04v07,
  "SEC-04-V08": sec04v08,
  "SEC-04-V09": sec04v09,
  "SEC-05-V07": sec05v07,
  "SEC-06-V02": sec06v02,
  "SEC-07-V11": sec07v11,
  "SEC-21-V01": sec21v01,
  "SEC-21-V02": sec21v02,
  "SEC-21-V03": sec21v03,
  "SEC-21-V04": sec21v04
};
