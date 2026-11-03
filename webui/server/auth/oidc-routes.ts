import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { findOidcBinding, loadAdminsConfig, resolveAuthMode } from "./admins-store.js";
import { ensureAccountUid, issueSession, revokeUndeliveredSession } from "./account-state.js";
import { exchangeAuthorizationCode, verifyIdToken } from "./oidc-client.js";
import { getStartupOidcRuntimeView } from "./oidc-runtime.js";
import { OidcTransactionStore } from "./oidc-transactions.js";
import { gateOidcCallbackAttempt, gateOidcStartAttempt, replyAuthGate } from "./rate-limit.js";
import { buildSessionCookie } from "./session.js";
import { issuerDigest, recordAuthEvent, subjectDigest } from "../security/auth-events.js";

/**
 * OIDC protocol routes (L25-06 Spec §5.2 / §6).
 *
 * The flow is Authorization Code + PKCE. The server keeps the transaction in
 * process memory; a restart drops pending logins and the user starts again. No
 * IdP token ever reaches a Lucy cookie: the browser gets the same v2 Lucy session
 * the local login produces.
 */

const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const TRANSACTION_MAX_ENTRIES = 1024;
const TRANSACTION_COOKIE = "lucy_oidc_transaction";

/** One process, one store: Lucy is single-instance by contract. */
const transactions = new OidcTransactionStore({
  ttlMs: TRANSACTION_TTL_MS,
  maxEntries: TRANSACTION_MAX_ENTRIES
});

export type OidcCallbackErrorCode =
  | "OIDC_LOGIN_INVALID"
  | "OIDC_LOGIN_FAILED"
  | "OIDC_PROVIDER_UNAVAILABLE"
  | "OIDC_ACCOUNT_NOT_BOUND"
  | "OIDC_ACCOUNT_UNAVAILABLE"
  | "AUTH_STATE_UNAVAILABLE";

const OIDC_NOT_AVAILABLE = {
  ok: false,
  error: {
    code: "OIDC_NOT_AVAILABLE",
    message: "单点登录当前不可用，请使用本地账户登录或联系部署人员"
  }
} as const;

/**
 * A `returnTo` is a Lucy-internal absolute path or nothing.
 *
 * Rejected: anything not starting with a single `/`, protocol-relative paths,
 * backslashes, control characters and anything carrying a scheme. The character
 * class is positive, so an unlisted character rejects the value rather than
 * slipping through.
 */
const SAFE_RETURN_TO = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*$/;

export function sanitizeInternalReturnTo(raw: unknown): string {
  if (typeof raw !== "string") return "/overview";
  const value = raw.trim();
  if (!value.startsWith("/")) return "/overview";
  if (!SAFE_RETURN_TO.test(value)) return "/overview";
  return value;
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function readCookie(request: FastifyRequest, name: string): string {
  const header = request.headers.cookie;
  if (!header) return "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function setTransactionCookie(reply: FastifyReply, state: string, path: string): void {
  reply.header(
    "Set-Cookie",
    `${TRANSACTION_COOKIE}=${encodeURIComponent(state)}; Path=${path}; HttpOnly; SameSite=Lax; Secure; Max-Age=600`
  );
}

/**
 * The clearing cookie for the login transaction.
 *
 * It is returned instead of being written straight away: `reply.header("Set-Cookie", …)`
 * REPLACES the previous value, so a callback that also hands out the Lucy session
 * cookie must send both in ONE array, otherwise the session cookie silently drops
 * the transaction clearing (or the other way round).
 */
function transactionClearCookie(path: string): string {
  return `${TRANSACTION_COOKIE}=; Path=${path}; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

/** A failed callback returns to the login page with a fixed code — never raw provider output. */
function redirectLoginError(reply: FastifyReply, code: OidcCallbackErrorCode): FastifyReply {
  return reply.code(303).header("Location", `/login?oidc_error=${encodeURIComponent(code)}`).send();
}

export function registerOidcRoutes(app: FastifyInstance): void {
  app.post<{ Body: { returnTo?: string } }>("/api/auth/oidc/start", async (request, reply) => {
    reply.header("Cache-Control", "no-store");

    const gate = await gateOidcStartAttempt(request);
    if (!gate.ok) return replyAuthGate(reply, gate);

    // open / bootstrap / unavailable never borrow the identity provider.
    if ((await resolveAuthMode()) !== "required") {
      return reply.status(503).send(OIDC_NOT_AVAILABLE);
    }

    const runtime = await getStartupOidcRuntimeView();
    if (!runtime.enabled || !runtime.profile) {
      await recordAuthEvent({
        kind: "login_failure",
        request,
        actor: "anonymous",
        actorType: "anonymous",
        summary: { method: "oidc", reason: "oidc_config_unavailable" }
      });
      return reply.status(503).send(OIDC_NOT_AVAILABLE);
    }
    const profile = runtime.profile;

    const returnTo = sanitizeInternalReturnTo(request.body?.returnTo);
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken();
    const challenge = createHash("sha256").update(verifier).digest("base64url");

    transactions.putSingleUse(sha256Hex(state), {
      nonce,
      verifier,
      returnTo,
      profileDigest: runtime.profileDigest ?? "",
      expiresAt: Date.now() + TRANSACTION_TTL_MS
    });
    setTransactionCookie(reply, state, profile.redirectPath);

    const url = new URL(profile.authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", profile.clientId);
    url.searchParams.set("redirect_uri", `${profile.publicWebuiUrl}${profile.redirectPath}`);
    url.searchParams.set("scope", profile.scopes);
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");

    return { ok: true, data: { authorizationUrl: url.toString() } };
  });

  app.get<{
    Querystring: { state?: string; code?: string; error?: string; error_description?: string };
  }>("/api/auth/oidc/callback", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");

    const runtime = await getStartupOidcRuntimeView();
    const cookiePath = runtime.profile?.redirectPath ?? "/api/auth/oidc/callback";

    const state = typeof request.query.state === "string" ? request.query.state : "";
    const stateHash = state ? sha256Hex(state) : "";
    // Peek first: a random state must not create a transaction bucket.
    const pending = stateHash ? transactions.peek(stateHash) : undefined;
    const gate = await gateOidcCallbackAttempt(request, stateHash || "-", Boolean(pending));
    if (!gate.ok) return replyAuthGate(reply, gate);

    const txCookie = readCookie(request, TRANSACTION_COOKIE);
    // Consume before validating: a replay must never reach the token exchange twice.
    const tx = stateHash ? transactions.consumeOnce(stateHash) : undefined;
    if (!tx || !txCookie || !state || !constantTimeEqual(txCookie, state)) {
      reply.header("Set-Cookie", transactionClearCookie(cookiePath));
      await recordAuthEvent({
        kind: "login_failure",
        request,
        actor: "anonymous",
        actorType: "anonymous",
        summary: { method: "oidc", reason: "invalid_state" }
      });
      return redirectLoginError(reply, "OIDC_LOGIN_INVALID");
    }
    reply.header("Set-Cookie", transactionClearCookie(cookiePath));

    // The provider's error is only a class; its description never leaves this branch.
    if (typeof request.query.error === "string" && request.query.error) {
      await recordAuthEvent({
        kind: "login_failure",
        request,
        actor: "anonymous",
        actorType: "anonymous",
        summary: { method: "oidc", reason: "provider_error" }
      });
      return redirectLoginError(reply, "OIDC_LOGIN_FAILED");
    }

    if (!runtime.enabled || !runtime.profile || !runtime.clientSecret || runtime.profileDigest !== tx.profileDigest) {
      await recordAuthEvent({
        kind: "login_failure",
        request,
        actor: "anonymous",
        actorType: "anonymous",
        summary: { method: "oidc", reason: "profile_changed_or_invalid" }
      });
      return redirectLoginError(reply, "OIDC_LOGIN_INVALID");
    }
    const profile = runtime.profile;

    const code = typeof request.query.code === "string" ? request.query.code : "";
    if (!code) {
      await recordAuthEvent({
        kind: "login_failure",
        request,
        actor: "anonymous",
        actorType: "anonymous",
        summary: { method: "oidc", reason: "invalid_state" }
      });
      return redirectLoginError(reply, "OIDC_LOGIN_INVALID");
    }

    let idToken: string;
    try {
      const tokenResponse = await exchangeAuthorizationCode({
        code,
        verifier: tx.verifier,
        redirectUri: `${profile.publicWebuiUrl}${profile.redirectPath}`,
        tokenEndpoint: profile.tokenEndpoint,
        tokenEndpointAuth: profile.tokenEndpointAuth,
        clientId: profile.clientId,
        clientSecret: runtime.clientSecret
      });
      idToken = tokenResponse.idToken;
    } catch {
      await recordAuthEvent({
        kind: "login_failure",
        request,
        actor: "anonymous",
        actorType: "anonymous",
        summary: { method: "oidc", reason: "code_exchange_failed" }
      });
      return redirectLoginError(reply, "OIDC_PROVIDER_UNAVAILABLE");
    }

    let claims: { iss: string; sub: string };
    try {
      claims = await verifyIdToken({
        idToken,
        jwksUri: profile.jwksUri,
        expectedIssuer: profile.issuer,
        expectedAudience: profile.clientId,
        expectedNonce: tx.nonce
      });
    } catch {
      await recordAuthEvent({
        kind: "login_failure",
        request,
        actor: "anonymous",
        actorType: "anonymous",
        summary: { method: "oidc", reason: "id_token_invalid" }
      });
      return redirectLoginError(reply, "OIDC_LOGIN_INVALID");
    }

    let config;
    try {
      config = await loadAdminsConfig({ fresh: true });
    } catch {
      // A broken admins.yaml must not surface as a 500: the caller gets the same
      // fixed refusal as an unusable account.
      await recordAuthEvent({
        kind: "login_failure",
        request,
        actor: "anonymous",
        actorType: "anonymous",
        summary: { method: "oidc", reason: "account_unavailable" }
      });
      return redirectLoginError(reply, "OIDC_ACCOUNT_UNAVAILABLE");
    }
    const match = findOidcBinding(config, claims.iss, claims.sub);
    if (!match) {
      await recordAuthEvent({
        kind: "login_failure",
        request,
        actor: "anonymous",
        actorType: "anonymous",
        summary: {
          method: "oidc",
          reason: "account_not_bound",
          issuerDigest: issuerDigest(claims.iss),
          subjectDigest: subjectDigest(claims.sub)
        }
      });
      return redirectLoginError(reply, "OIDC_ACCOUNT_NOT_BOUND");
    }

    const account = match.admin;
    if (!account.enabled) {
      await recordAuthEvent({
        kind: "login_failure",
        request,
        actor: "anonymous",
        actorType: "anonymous",
        summary: { method: "oidc", reason: "account_unavailable", targetId: account.id }
      });
      return redirectLoginError(reply, "OIDC_ACCOUNT_UNAVAILABLE");
    }

    // Legacy accounts get their immutable uid on first login (controlled, audited migration).
    let resolved = account;
    if (!resolved.account_uid) {
      try {
        resolved = (await ensureAccountUid(resolved.id)) ?? resolved;
      } catch {
        return redirectLoginError(reply, "AUTH_STATE_UNAVAILABLE");
      }
      if (!resolved.account_uid || !resolved.enabled) {
        return redirectLoginError(reply, "AUTH_STATE_UNAVAILABLE");
      }
    }

    const session = await issueSession(resolved);
    if (!session.ok) {
      return redirectLoginError(
        reply,
        session.status === 401 ? "OIDC_ACCOUNT_UNAVAILABLE" : ("AUTH_STATE_UNAVAILABLE")
      );
    }

    // The session is only handed out once its login is durably on the ledger.
    if (
      !(await recordAuthEvent({
        kind: "login_success",
        request,
        actor: resolved.id,
        summary: { method: "oidc" }
      }))
    ) {
      // The session row already exists; it must not survive undelivered.
      await revokeUndeliveredSession(session.token);
      return redirectLoginError(reply, "AUTH_STATE_UNAVAILABLE");
    }

    // One header call carries both cookies: a second `reply.header("Set-Cookie", …)`
    // would REPLACE the first one instead of adding to it.
    reply.header("Set-Cookie", [
      transactionClearCookie(cookiePath),
      buildSessionCookie(session.token, session.exp)
    ]);
    return reply.code(303).header("Location", tx.returnTo).send();
  });
}
