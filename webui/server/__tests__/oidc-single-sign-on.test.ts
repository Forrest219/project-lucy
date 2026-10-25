import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { SignJWT, base64url, exportJWK } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetOidcRuntimeCache } from "../auth/oidc-runtime.js";
import { sanitizeInternalReturnTo } from "../auth/oidc-routes.js";
import {
  api,
  cookiePair,
  createAuthFixture,
  login,
  loginCookie,
  startLucy,
  type AuthFixture,
  type RunningLucy
} from "./webui-auth-fixture.js";

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []), run: vi.fn() })),
    exec: vi.fn(),
    pragma: vi.fn()
  })),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => undefined),
  registerAgentAuditRoutes: vi.fn(),
  registerAuditRoutes: vi.fn()
}));

/** Lets a test make the durable login ledger fail, so the session must not be handed out. */
const authEventHooks = vi.hoisted(() => ({ fail: false }));

vi.mock("../security/auth-events.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../security/auth-events.js")>();
  return {
    ...actual,
    recordAuthEvent: vi.fn(async (...args: Parameters<typeof actual.recordAuthEvent>) => {
      if (authEventHooks.fail) return false;
      return actual.recordAuthEvent(...args);
    })
  };
});

const CLIENT_ID = "lucy-webui";
const CLIENT_SECRET = "client-secret-value-for-tests";
const SUB = "opaque-subject-1";
const ISSUER = "http://127.0.0.1:59999";

const OIDC_ENV_KEYS = ["LUCY_OIDC_CONFIG_FILE", "LUCY_OIDC_CLIENT_SECRET_FILE"] as const;
const savedOidcEnv: Partial<Record<(typeof OIDC_ENV_KEYS)[number], string | undefined>> = {};

/**
 * A local mock identity provider.
 *
 * It only exists for protocol-level assertions. It is NOT evidence for OIDC-25:
 * the customer issuer acceptance needs the real provider.
 */
async function startMockIdp() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  // A second key pair the provider never publishes: a token signed with it must be refused.
  const { privateKey: foreignPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = (await exportJWK(publicKey)) as Record<string, unknown>;
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";

  const state = {
    expectedChallenge: "",
    expectedNonce: "",
    expectedSub: SUB,
    lastTokenRequest: null as Record<string, string> | null,
    tokenCalls: 0,
    jwksCalls: 0,
    overrideClaims: null as Record<string, unknown> | null,
    // The knobs below let a test produce a token that has to be refused.
    overrideIssuer: null as string | null,
    overrideAudience: null as string | string[] | null,
    overrideAzp: null as string | null,
    overrideTtlSeconds: null as number | null,
    omitExpiration: false,
    signWithForeignKey: false,
    useAlgNone: false,
    algorithm: "RS256"
  };

  const app = Fastify();
  // OAuth2 token requests are form-encoded; Fastify does not parse that by default.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    }
  );
  app.get("/jwks", async () => {
    state.jwksCalls += 1;
    return { keys: [jwk] };
  });
  app.post("/token", async (request, reply) => {
    state.tokenCalls += 1;
    const body = (request.body ?? {}) as Record<string, string>;
    state.lastTokenRequest = body;
    // PKCE round trip: the verifier the server sends must hash to the challenge it published.
    const { createHash } = await import("node:crypto");
    const verifier = body.code_verifier ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (!state.expectedChallenge || challenge !== state.expectedChallenge) {
      return reply.status(400).send({ error: "invalid_grant" });
    }
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      nonce: state.expectedNonce,
      email: "bound@example.com",
      ...(state.overrideAzp ? { azp: state.overrideAzp } : {}),
      ...(state.overrideClaims ?? {})
    };
    const builder = new SignJWT(claims)
      .setProtectedHeader({
        alg: state.algorithm,
        kid: state.signWithForeignKey ? "foreign-key" : "test-key"
      })
      .setIssuer(state.overrideIssuer ?? ISSUER)
      .setAudience(state.overrideAudience ?? CLIENT_ID)
      .setSubject(state.expectedSub)
      .setIssuedAt(now);
    if (!state.omitExpiration) builder.setExpirationTime(now + (state.overrideTtlSeconds ?? 300));
    let idToken: string;
    if (state.useAlgNone) {
      // An unsigned token: the header claims `none` and the signature segment is empty.
      const header = base64url.encode(
        new TextEncoder().encode(JSON.stringify({ alg: "none", kid: "test-key", typ: "JWT" }))
      );
      const payload = base64url.encode(
        new TextEncoder().encode(
          JSON.stringify({
            ...claims,
            iss: state.overrideIssuer ?? ISSUER,
            aud: state.overrideAudience ?? CLIENT_ID,
            sub: state.expectedSub,
            iat: now,
            exp: now + 300
          })
        )
      );
      idToken = `${header}.${payload}.`;
    } else if (state.algorithm.startsWith("HS")) {
      // A symmetric algorithm signs with a shared secret; an asymmetric one with a key pair.
      idToken = await builder.sign(Buffer.from("mock-idp-shared-secret-0123456789abcdef", "utf8"));
    } else {
      idToken = await builder.sign(state.signWithForeignKey ? foreignPrivateKey : privateKey);
    }
    return { access_token: "provider-access-token", token_type: "Bearer", id_token: idToken, refresh_token: "provider-refresh-token" };
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("no mock idp address");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    state,
    baseUrl,
    stop: async () => {
      await app.close();
    }
  };
}

type Oidp = Awaited<ReturnType<typeof startMockIdp>>;

async function writeOidcFiles(options: {
  idp: Oidp;
  profileOverride?: Record<string, unknown>;
  secretContent?: string;
  secretMode?: number;
}): Promise<{ profilePath: string; secretPath: string; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-oidc-"));
  const profilePath = path.join(dir, "profile.yaml");
  const secretPath = path.join(dir, "client-secret");
  const profile = {
    issuer: ISSUER,
    authorizationEndpoint: `${options.idp.baseUrl}/authorize`,
    tokenEndpoint: `${options.idp.baseUrl}/token`,
    jwksUri: `${options.idp.baseUrl}/jwks`,
    clientId: CLIENT_ID,
    scopes: "openid profile email",
    tokenEndpointAuth: "client_secret_post",
    redirectPath: "/api/auth/oidc/callback",
    publicWebuiUrl: "https://lucy.example.com",
    ...(options.profileOverride ?? {})
  };
  await writeFile(profilePath, JSON.stringify(profile), "utf8");
  await writeFile(secretPath, options.secretContent ?? CLIENT_SECRET, "utf8");
  await chmod(secretPath, options.secretMode ?? 0o600);
  return { profilePath, secretPath, dir };
}

function enableOidc(profilePath: string, secretPath: string): void {
  process.env.LUCY_OIDC_CONFIG_FILE = profilePath;
  process.env.LUCY_OIDC_CLIENT_SECRET_FILE = secretPath;
  resetOidcRuntimeCache();
}

function disableOidc(): void {
  delete process.env.LUCY_OIDC_CONFIG_FILE;
  delete process.env.LUCY_OIDC_CLIENT_SECRET_FILE;
  resetOidcRuntimeCache();
}

/** Reads one named cookie out of a response that may carry several Set-Cookie headers. */
function cookieNamed(response: Response, name: string): string {
  const all = response.headers.getSetCookie?.() ?? [];
  for (const value of all) {
    const pair = value.split(";")[0] ?? "";
    if (pair.startsWith(`${name}=`)) return pair;
  }
  return "";
}

/** Drives one login attempt and returns the authorization URL plus the transaction cookie. */
async function startLogin(base: string, returnTo?: string) {
  const res = await fetch(`${base}/api/auth/oidc/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(returnTo === undefined ? {} : { returnTo })
  });
  const body = (await res.json()) as { ok?: boolean; data?: { authorizationUrl?: string } };
  return {
    status: res.status,
    body,
    authorizationUrl: body.data?.authorizationUrl ?? "",
    transactionCookie: cookiePair(res)
  };
}

/** Drives one full OIDC login and returns the callback response plus the session cookie. */
async function completeOidcLogin(base: string, idp: Oidp) {
  const start = await startLogin(base);
  const url = new URL(start.authorizationUrl);
  idp.state.expectedChallenge = url.searchParams.get("code_challenge") ?? "";
  idp.state.expectedNonce = url.searchParams.get("nonce") ?? "";
  const callback = await fetch(
    `${base}/api/auth/oidc/callback?code=the-code&state=${url.searchParams.get("state")}`,
    { redirect: "manual", headers: { cookie: start.transactionCookie } }
  );
  return { callback, sessionCookie: cookieNamed(callback, "lucy_admin_session") };
}

/** One login attempt that may be refused: returns the redirect target. */
async function oidcLoginRedirect(base: string, idp: Oidp): Promise<string> {
  const { callback } = await completeOidcLogin(base, idp);
  return callback.headers.get("location") ?? "";
}

describe("L25-06 OIDC single sign-on", () => {
  let fx: AuthFixture | undefined;
  let lucy: RunningLucy | undefined;
  let idp: Oidp | undefined;
  let dir: string | undefined;

  afterEach(async () => {
    await lucy?.stop();
    lucy = undefined;
    await idp?.stop();
    idp = undefined;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
    for (const key of OIDC_ENV_KEYS) {
      if (savedOidcEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedOidcEnv[key];
    }
    disableOidc();
    await fx?.restore();
    fx = undefined;
  });

  it("OIDC-01/OIDC-26: stays off by default and exposes only the local method", async () => {
    fx = await createAuthFixture({ secret: "env" });
    await fx.writeAdmins([{ id: "owner1", role: "owner" }]);
    lucy = await startLucy();

    const status = await (await fetch(`${lucy.baseUrl}/api/auth/status`)).json();
    expect(status.data.methods).toEqual(["local"]);
    expect(JSON.stringify(status)).not.toContain("oidc");
  });

  it("OIDC-26: an invalid profile or a missing secret keeps OIDC off and local login alive", async () => {
    fx = await createAuthFixture({ secret: "env" });
    await fx.writeAdmins([{ id: "owner1", role: "owner" }]);
    idp = await startMockIdp();

    const bad = await writeOidcFiles({ idp, profileOverride: { scopes: "profile email" } });
    dir = bad.dir;
    enableOidc(bad.profilePath, bad.secretPath);
    lucy = await startLucy();

    const status = await (await fetch(`${lucy.baseUrl}/api/auth/status`)).json();
    expect(status.data.methods).toEqual(["local"]);
    // Local login still works: an OIDC misconfiguration never touches the recovery path.
    expect((await login(lucy.baseUrl, "owner1")).status).toBe(200);

    await lucy.stop();
    lucy = undefined;
    await rm(bad.dir, { recursive: true, force: true });
    dir = undefined;

    const good = await writeOidcFiles({ idp });
    dir = good.dir;
    enableOidc(good.profilePath, path.join(good.dir, "missing-secret"));
    lucy = await startLucy();
    const status2 = await (await fetch(`${lucy.baseUrl}/api/auth/status`)).json();
    expect(status2.data.methods).toEqual(["local"]);
    expect((await login(lucy.baseUrl, "owner1")).status).toBe(200);
  });

  it("OIDC-02/OIDC-04: a valid configuration publishes the OIDC method without leaking identity detail", async () => {
    fx = await createAuthFixture({ secret: "env" });
    await fx.writeAdmins([{ id: "owner1", role: "owner" }]);
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    const status = await (await fetch(`${lucy.baseUrl}/api/auth/status`)).json();
    expect(status.data.methods).toEqual(["local", "oidc"]);
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("issuer");
    expect(serialized).not.toContain(CLIENT_ID);
    expect(serialized).not.toContain(CLIENT_SECRET);

    const start = await startLogin(lucy.baseUrl);
    expect(start.status).toBe(200);
    const url = new URL(start.authorizationUrl);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe("https://lucy.example.com/api/auth/oidc/callback");
    expect(url.searchParams.get("scope")).toContain("openid");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(start.transactionCookie).toContain("lucy_oidc_transaction=");
  });

  it("OIDC-05/OIDC-17: a missing state, a wrong cookie and a replay all fail closed", async () => {
    fx = await createAuthFixture({ secret: "env" });
    await fx.writeAdmins([{ id: "owner1", role: "owner" }]);
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    const start = await startLogin(lucy.baseUrl);
    const state = new URL(start.authorizationUrl).searchParams.get("state") ?? "";

    // No state at all.
    const noState = await fetch(`${lucy.baseUrl}/api/auth/oidc/callback?code=abc`, { redirect: "manual" });
    expect(noState.status).toBe(303);
    expect(noState.headers.get("location")).toContain("oidc_error=OIDC_LOGIN_INVALID");

    // Right state, wrong cookie.
    const wrongCookie = await fetch(`${lucy.baseUrl}/api/auth/oidc/callback?code=abc&state=${state}`, {
      redirect: "manual",
      headers: { cookie: "lucy_oidc_transaction=not-the-state" }
    });
    expect(wrongCookie.status).toBe(303);
    expect(wrongCookie.headers.get("location")).toContain("oidc_error=OIDC_LOGIN_INVALID");

    // Right state and cookie, but the transaction was already consumed by the failures above.
    const replay = await fetch(`${lucy.baseUrl}/api/auth/oidc/callback?code=abc&state=${state}`, {
      redirect: "manual",
      headers: { cookie: start.transactionCookie }
    });
    expect(replay.status).toBe(303);
    expect(replay.headers.get("location")).toContain("oidc_error=OIDC_LOGIN_INVALID");
  });

  it("OIDC-06/OIDC-08: a bound owner signs in and gets the owner role with a v2 session", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    await writeBoundAdmins(fx, [{ id: "owner1", role: "owner", sub: SUB, password: true }]);
    const start = await startLogin(lucy.baseUrl);
    const url = new URL(start.authorizationUrl);
    idp.state.expectedChallenge = url.searchParams.get("code_challenge") ?? "";
    idp.state.expectedNonce = url.searchParams.get("nonce") ?? "";

    const callback = await fetch(
      `${lucy.baseUrl}/api/auth/oidc/callback?code=the-code&state=${url.searchParams.get("state")}`,
      { redirect: "manual", headers: { cookie: start.transactionCookie } }
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe("/overview");
    expect(idp.state.lastTokenRequest?.code_verifier).toBeTruthy();
    expect(idp.state.lastTokenRequest?.client_secret).toBe(CLIENT_SECRET);
    expect(idp.state.lastTokenRequest?.redirect_uri).toBe("https://lucy.example.com/api/auth/oidc/callback");

    const sessionCookie = cookieNamed(callback, "lucy_admin_session");
    expect(sessionCookie).toContain("lucy_admin_session=");
    // The transaction cookie is cleared in the same response, not left behind.
    expect(cookieNamed(callback, "lucy_oidc_transaction")).toBe("lucy_oidc_transaction=");
    const meRes = await api(lucy.baseUrl, "GET", "/api/auth/me", sessionCookie);
    const me = await meRes.json();
    expect(me.data.me.role).toBe("owner");
    expect(me.data.me.id).toBe("owner1");
  });

  it("OIDC-09: a bound operator signs in with the operator role and cannot manage accounts or bindings", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    await writeBoundAdmins(fx, [
      { id: "owner1", role: "owner", sub: "owner-sub", password: true },
      { id: "op1", role: "operator", sub: SUB, password: true }
    ]);

    const { callback, sessionCookie } = await completeOidcLogin(lucy.baseUrl, idp);
    expect(callback.status).toBe(303);
    expect(sessionCookie).toContain("lucy_admin_session=");

    const me = await (await api(lucy.baseUrl, "GET", "/api/auth/me", sessionCookie)).json();
    expect(me.data.me.role).toBe("operator");
    expect(me.data.me.id).toBe("op1");

    // Managing login accounts stays owner-only.
    const created = await api(lucy.baseUrl, "POST", "/api/admin/admins", sessionCookie, {
      adminId: "op2",
      password: "correct-horse-battery"
    });
    expect(created.status).toBe(403);
    expect((await created.json()).error.code).toBe("OWNER_REQUIRED");

    // Managing identity bindings stays owner-only.
    const rebound = await api(lucy.baseUrl, "PUT", "/api/admin/admins/op1/oidc-binding", sessionCookie, {
      issuer: ISSUER,
      sub: "another-sub"
    });
    expect(rebound.status).toBe(403);
    expect((await rebound.json()).error.code).toBe("OWNER_REQUIRED");

    // The operator never reads the identity bindings of an account.
    const list = await (await api(lucy.baseUrl, "GET", "/api/admin/admins", sessionCookie)).json();
    expect(JSON.stringify(list)).not.toContain("another-sub");

    // The sign-in grants no data-plane rights: no token, no access.yaml change.
    const op1 = (await fx.readAdmins()).find((a) => a.id === "op1");
    expect(op1?.tokens).toBeUndefined();
    expect(await readFile(path.join(fx.root, "webui", "config", "access.yaml"), "utf8")).toBe("users: []\n");
  });

  it("OIDC-11: the first sign-in migrates the uid, a disabled or deleted account is refused and a rebuilt account gets a new uid", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    await writeBoundAdmins(fx, [
      { id: "owner1", role: "owner", sub: "owner-sub", password: true },
      { id: "op1", role: "operator", sub: SUB, password: true }
    ]);

    // 1. A legacy account without account_uid gets one on its first OIDC sign-in.
    const first = await completeOidcLogin(lucy.baseUrl, idp);
    expect(first.callback.status).toBe(303);
    const migrated = (await fx.readAdmins()).find((a) => a.id === "op1")?.account_uid;
    expect(typeof migrated).toBe("string");
    expect(migrated).toBeTruthy();

    const ownerCookie = await loginCookie(lucy.baseUrl, "owner1");

    // 2. A disabled account cannot sign in any more.
    const disabled = await api(lucy.baseUrl, "PATCH", "/api/admin/admins/op1", ownerCookie, { enabled: false });
    expect(disabled.status).toBe(200);
    expect(await oidcLoginRedirect(lucy.baseUrl, idp)).toContain("oidc_error=OIDC_ACCOUNT_UNAVAILABLE");

    // 3. A deleted account is not bound any more.
    const deleted = await api(lucy.baseUrl, "DELETE", "/api/admin/admins/op1", ownerCookie);
    expect(deleted.status).toBe(200);
    expect(await oidcLoginRedirect(lucy.baseUrl, idp)).toContain("oidc_error=OIDC_ACCOUNT_NOT_BOUND");

    // 4. A rebuilt account with the same id carries a NEW uid.
    const recreated = await api(lucy.baseUrl, "POST", "/api/admin/admins", ownerCookie, {
      adminId: "op1",
      password: "correct-horse-battery",
      role: "operator",
      oidcBinding: { issuer: ISSUER, sub: SUB, email: "op1@example.com" }
    });
    expect(recreated.status).toBe(200);
    const rebuilt = (await fx.readAdmins()).find((a) => a.id === "op1")?.account_uid;
    expect(rebuilt).toBeTruthy();
    expect(rebuilt).not.toBe(migrated);
  });

  it("OIDC-11: a role change revokes the issued session and the next sign-in uses the new role", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    await writeBoundAdmins(fx, [
      { id: "owner1", role: "owner", sub: "owner-sub", password: true },
      { id: "op1", role: "operator", sub: SUB, password: true }
    ]);

    const first = await completeOidcLogin(lucy.baseUrl, idp);
    expect((await api(lucy.baseUrl, "GET", "/api/auth/me", first.sessionCookie)).status).toBe(200);

    const ownerCookie = await loginCookie(lucy.baseUrl, "owner1");
    const changed = await api(lucy.baseUrl, "PATCH", "/api/admin/admins/op1", ownerCookie, { role: "owner" });
    expect(changed.status).toBe(200);

    // The session issued under the old role is revoked.
    expect((await api(lucy.baseUrl, "GET", "/api/auth/me", first.sessionCookie)).status).toBe(401);

    // Signing in again yields the new role.
    const second = await completeOidcLogin(lucy.baseUrl, idp);
    const me = await (await api(lucy.baseUrl, "GET", "/api/auth/me", second.sessionCookie)).json();
    expect(me.data.me.role).toBe("owner");
  });

  it("OIDC-15: an issued session needs no IdP round trip, a disabled account is refused at once and an IdP outage is not a revocation", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    await writeBoundAdmins(fx, [
      { id: "owner1", role: "owner", sub: "owner-sub", password: true },
      { id: "op1", role: "operator", sub: SUB, password: true }
    ]);

    const { sessionCookie } = await completeOidcLogin(lucy.baseUrl, idp);
    const tokenCalls = idp.state.tokenCalls;
    const jwksCalls = idp.state.jwksCalls;

    // Every later request is answered by Lucy alone.
    for (let i = 0; i < 3; i += 1) {
      expect((await api(lucy.baseUrl, "GET", "/api/auth/me", sessionCookie)).status).toBe(200);
    }
    expect(idp.state.tokenCalls).toBe(tokenCalls);
    expect(idp.state.jwksCalls).toBe(jwksCalls);

    // The provider goes down. The session Lucy already issued keeps working:
    // an IdP outage is not a revocation.
    await idp.stop();
    idp = undefined;
    expect((await api(lucy.baseUrl, "GET", "/api/auth/me", sessionCookie)).status).toBe(200);

    // Disabling the Lucy account refuses the issued session immediately.
    const ownerCookie = await loginCookie(lucy.baseUrl, "owner1");
    const disabled = await api(lucy.baseUrl, "PATCH", "/api/admin/admins/op1", ownerCookie, { enabled: false });
    expect(disabled.status).toBe(200);
    expect((await api(lucy.baseUrl, "GET", "/api/auth/me", sessionCookie)).status).toBe(401);
  });

  it("OIDC-10: an unbound subject with the same email is refused and no account is created", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    // The provider asserts the same email as the local account, but the subject differs.
    await writeBoundAdmins(fx, [
      { id: "owner1", role: "owner", sub: "different-sub", password: true, email: "bound@example.com" }
    ]);
    idp.state.expectedSub = "unknown-sub";

    const start = await startLogin(lucy.baseUrl);
    const url = new URL(start.authorizationUrl);
    idp.state.expectedChallenge = url.searchParams.get("code_challenge") ?? "";
    idp.state.expectedNonce = url.searchParams.get("nonce") ?? "";

    const callback = await fetch(
      `${lucy.baseUrl}/api/auth/oidc/callback?code=the-code&state=${url.searchParams.get("state")}`,
      { redirect: "manual", headers: { cookie: start.transactionCookie } }
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toContain("oidc_error=OIDC_ACCOUNT_NOT_BOUND");
    const admins = await fx.readAdmins();
    expect(admins).toHaveLength(1);
  });

  it("OIDC-07: a nonce mismatch refuses the login", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    await writeBoundAdmins(fx, [{ id: "owner1", role: "owner", sub: SUB, password: true }]);
    const start = await startLogin(lucy.baseUrl);
    const url = new URL(start.authorizationUrl);
    idp.state.expectedChallenge = url.searchParams.get("code_challenge") ?? "";
    // The provider signs a different nonce than the one Lucy issued.
    idp.state.expectedNonce = "a-different-nonce";

    const callback = await fetch(
      `${lucy.baseUrl}/api/auth/oidc/callback?code=the-code&state=${url.searchParams.get("state")}`,
      { redirect: "manual", headers: { cookie: start.transactionCookie } }
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toContain("oidc_error=OIDC_LOGIN_INVALID");
  });

  it("OIDC-07: a wrong issuer, audience or azp, an expired or expiry-less token, a foreign key and a symmetric signature are all refused", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    await writeBoundAdmins(fx, [{ id: "owner1", role: "owner", sub: SUB, password: true }]);

    // The issuer must equal the configured one byte for byte.
    idp.state.overrideIssuer = "http://127.0.0.1:1/other-issuer";
    expect(await oidcLoginRedirect(lucy.baseUrl, idp)).toContain("oidc_error=OIDC_LOGIN_INVALID");
    idp.state.overrideIssuer = null;

    // The audience must contain this client.
    idp.state.overrideAudience = "another-client";
    expect(await oidcLoginRedirect(lucy.baseUrl, idp)).toContain("oidc_error=OIDC_LOGIN_INVALID");
    idp.state.overrideAudience = null;

    // An azp for somebody else is a mismatch even with a single audience.
    idp.state.overrideAzp = "another-client";
    expect(await oidcLoginRedirect(lucy.baseUrl, idp)).toContain("oidc_error=OIDC_LOGIN_INVALID");
    idp.state.overrideAzp = null;

    // Several audiences without a matching azp are refused.
    idp.state.overrideAudience = [CLIENT_ID, "another-client"];
    expect(await oidcLoginRedirect(lucy.baseUrl, idp)).toContain("oidc_error=OIDC_LOGIN_INVALID");
    idp.state.overrideAudience = null;

    // An expired token is refused (the clock tolerance is 5 s).
    idp.state.overrideTtlSeconds = -60;
    expect(await oidcLoginRedirect(lucy.baseUrl, idp)).toContain("oidc_error=OIDC_LOGIN_INVALID");
    idp.state.overrideTtlSeconds = null;

    // A token without an expiry is refused: `exp` is a required claim.
    idp.state.omitExpiration = true;
    expect(await oidcLoginRedirect(lucy.baseUrl, idp)).toContain("oidc_error=OIDC_LOGIN_INVALID");
    idp.state.omitExpiration = false;

    // A token signed by a key the provider never published is refused.
    idp.state.signWithForeignKey = true;
    expect(await oidcLoginRedirect(lucy.baseUrl, idp)).toContain("oidc_error=OIDC_LOGIN_INVALID");
    idp.state.signWithForeignKey = false;

    // A symmetric signature is refused: only asymmetric algorithms are allowed.
    idp.state.algorithm = "HS256";
    expect(await oidcLoginRedirect(lucy.baseUrl, idp)).toContain("oidc_error=OIDC_LOGIN_INVALID");
    idp.state.algorithm = "RS256";

    // An unsigned token (`alg: none`) is refused as well.
    idp.state.useAlgNone = true;
    expect(await oidcLoginRedirect(lucy.baseUrl, idp)).toContain("oidc_error=OIDC_LOGIN_INVALID");
    idp.state.useAlgNone = false;

    // The valid token still signs in, so the refusals above are specific.
    const ok = await completeOidcLogin(lucy.baseUrl, idp);
    expect(ok.callback.status).toBe(303);
    expect(ok.callback.headers.get("location")).toBe("/overview");
    expect(ok.sessionCookie).toContain("lucy_admin_session=");
  });

  it("OIDC-17: a returnTo that leaves Lucy falls back to the overview", () => {
    expect(sanitizeInternalReturnTo("/overview")).toBe("/overview");
    expect(sanitizeInternalReturnTo("/admin/agents?tab=roles")).toBe("/admin/agents?tab=roles");
    expect(sanitizeInternalReturnTo("https://evil.example.com")).toBe("/overview");
    expect(sanitizeInternalReturnTo("//evil.example.com")).toBe("/overview");
    expect(sanitizeInternalReturnTo("/\\evil.example.com")).toBe("/overview");
    expect(sanitizeInternalReturnTo("/path\nwith-control")).toBe("/overview");
    expect(sanitizeInternalReturnTo("/path with-space")).toBe("/overview");
    expect(sanitizeInternalReturnTo(undefined)).toBe("/overview");
    expect(sanitizeInternalReturnTo(42)).toBe("/overview");
  });

  it("OIDC-05: a profile that changes under a pending login invalidates that transaction", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    await writeBoundAdmins(fx, [{ id: "owner1", role: "owner", sub: SUB, password: true }]);

    const start = await startLogin(lucy.baseUrl);
    const url = new URL(start.authorizationUrl);
    const state = url.searchParams.get("state") ?? "";
    idp.state.expectedChallenge = url.searchParams.get("code_challenge") ?? "";
    idp.state.expectedNonce = url.searchParams.get("nonce") ?? "";

    // The provider configuration changes underneath the pending login. Only the
    // scope list changes: it moves the profile digest without touching the
    // audience, so the refusal below can only come from the digest check.
    const profileDoc = JSON.parse(await readFile(files.profilePath, "utf8")) as Record<string, unknown>;
    profileDoc.scopes = "openid profile email offline_access";
    await writeFile(files.profilePath, JSON.stringify(profileDoc), "utf8");
    resetOidcRuntimeCache();

    const callback = await fetch(
      `${lucy.baseUrl}/api/auth/oidc/callback?code=the-code&state=${state}`,
      { redirect: "manual", headers: { cookie: start.transactionCookie } }
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toContain("oidc_error=OIDC_LOGIN_INVALID");
    // No session cookie at all: the failure closes the door.
    expect(cookieNamed(callback, "lucy_admin_session")).toBe("");
  });

  it("OIDC-13: removing a binding revokes the session it issued, and the identity source no longer leads to the account", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    await writeBoundAdmins(fx, [
      { id: "owner1", role: "owner", sub: "owner-sub", password: true },
      { id: "op1", role: "operator", sub: SUB, password: true }
    ]);

    const { sessionCookie } = await completeOidcLogin(lucy.baseUrl, idp);
    expect((await api(lucy.baseUrl, "GET", "/api/auth/me", sessionCookie)).status).toBe(200);

    const ownerCookie = await loginCookie(lucy.baseUrl, "owner1");
    const removed = await api(
      lucy.baseUrl,
      "DELETE",
      `/api/admin/admins/op1/oidc-binding?issuer=${encodeURIComponent(ISSUER)}`,
      ownerCookie
    );
    expect(removed.status).toBe(200);

    // The session the binding had issued is revoked.
    expect((await api(lucy.baseUrl, "GET", "/api/auth/me", sessionCookie)).status).toBe(401);

    // And the identity source no longer resolves to that account.
    expect(await oidcLoginRedirect(lucy.baseUrl, idp)).toContain("oidc_error=OIDC_ACCOUNT_NOT_BOUND");
  });

  it("OIDC-12: a binding cannot be removed from an account that has no other credential", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    // op1 has the identity binding and nothing else: no local password.
    await writeBoundAdmins(fx, [
      { id: "owner1", role: "owner", sub: "owner-sub", password: true },
      { id: "op1", role: "operator", sub: SUB, password: false }
    ]);

    const ownerCookie = await loginCookie(lucy.baseUrl, "owner1");
    const removed = await api(
      lucy.baseUrl,
      "DELETE",
      `/api/admin/admins/op1/oidc-binding?issuer=${encodeURIComponent(ISSUER)}`,
      ownerCookie
    );
    expect(removed.status).toBe(400);
    expect((await removed.json()).error.code).toBe("AUTH_CREDENTIAL_REQUIRED");
  });

  it("OIDC-19: a login whose durable ledger entry cannot be written hands out no session", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    await writeBoundAdmins(fx, [{ id: "owner1", role: "owner", sub: SUB, password: true }]);

    // The login verifies cryptographically, but its durable login event cannot be written.
    authEventHooks.fail = true;
    try {
      const { callback } = await completeOidcLogin(lucy.baseUrl, idp);
      expect(callback.status).toBe(303);
      expect(callback.headers.get("location")).toContain("oidc_error=AUTH_STATE_UNAVAILABLE");
      // No session is handed out, so the account row cannot outlive the login.
      expect(cookieNamed(callback, "lucy_admin_session")).toBe("");
    } finally {
      authEventHooks.fail = false;
    }
  });

  it("OIDC-12: the last local-password owner cannot be disabled, demoted or deleted", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    // owner1 is the only account that can still sign in with a local password;
    // owner2 is an owner, but it can only arrive through the identity provider.
    await writeBoundAdmins(fx, [
      { id: "owner1", role: "owner", sub: "owner-sub", password: true },
      { id: "owner2", role: "owner", sub: "owner2-sub", password: false }
    ]);

    const ownerCookie = await loginCookie(lucy.baseUrl, "owner1");

    // Disabling it would leave no enabled owner with a local password.
    const disabled = await api(lucy.baseUrl, "PATCH", "/api/admin/admins/owner1", ownerCookie, { enabled: false });
    expect(disabled.status).toBe(400);
    expect((await disabled.json()).error.code).toBe("LOCAL_OWNER_REQUIRED");

    // Demoting it does the same.
    const demoted = await api(lucy.baseUrl, "PATCH", "/api/admin/admins/owner1", ownerCookie, { role: "operator" });
    expect(demoted.status).toBe(400);
    expect((await demoted.json()).error.code).toBe("LOCAL_OWNER_REQUIRED");

    // Deleting it does the same.
    const deleted = await api(lucy.baseUrl, "DELETE", "/api/admin/admins/owner1", ownerCookie);
    expect(deleted.status).toBe(400);
    expect((await deleted.json()).error.code).toBe("LOCAL_OWNER_REQUIRED");
  });

  it("OIDC-19: a state that was never issued creates no transaction bucket", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    await writeBoundAdmins(fx, [{ id: "owner1", role: "owner", sub: SUB, password: true }]);

    // The same unknown state, ten times: if each callback created a transaction
    // bucket, that one bucket would reach its limit (5) and start refusing.
    for (let i = 0; i < 10; i += 1) {
      const res = await fetch(`${lucy.baseUrl}/api/auth/oidc/callback?code=abc&state=never-issued`, {
        redirect: "manual"
      });
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toContain("oidc_error=OIDC_LOGIN_INVALID");
    }
  });

  it("OIDC-19: an OIDC flood cannot open a hole around the local login", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    await writeBoundAdmins(fx, [{ id: "owner1", role: "owner", sub: SUB, password: true }]);

    // Spend the shared source budget on the OIDC entry point.
    for (let i = 0; i < 31; i += 1) {
      await fetch(`${lucy.baseUrl}/api/auth/oidc/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
    }

    // The local login shares that budget, so it is refused as well: an OIDC
    // flood must not buy a caller more local attempts.
    const local = await login(lucy.baseUrl, "owner1");
    expect(local.status).toBe(429);
  });

  it("OIDC-14: an unreachable provider fails the OIDC login only", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    await writeBoundAdmins(fx, [{ id: "owner1", role: "owner", sub: SUB, password: true }]);
    const start = await startLogin(lucy.baseUrl);
    const url = new URL(start.authorizationUrl);
    idp.state.expectedChallenge = url.searchParams.get("code_challenge") ?? "";
    idp.state.expectedNonce = url.searchParams.get("nonce") ?? "";
    // The provider now rejects the exchange.
    idp.state.expectedChallenge = "a-different-challenge";

    const callback = await fetch(
      `${lucy.baseUrl}/api/auth/oidc/callback?code=the-code&state=${url.searchParams.get("state")}`,
      { redirect: "manual", headers: { cookie: start.transactionCookie } }
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toContain("oidc_error=OIDC_PROVIDER_UNAVAILABLE");

    // The local recovery path is untouched.
    expect((await login(lucy.baseUrl, "owner1")).status).toBe(200);
  });

  it("OIDC-03: bootstrap never borrows the identity provider", async () => {
    fx = await createAuthFixture({ secret: "env" });
    await fx.writeAdmins([]);
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    const status = await (await fetch(`${lucy.baseUrl}/api/auth/status`)).json();
    expect(status.data.methods).toEqual(["local"]);
    const start = await startLogin(lucy.baseUrl);
    expect(start.status).toBe(503);
    expect(start.body.ok).toBe(false);
  });

  it("OIDC-12: the last local-password owner cannot be stripped of its password", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    // One owner with a binding and a password, one operator with a binding only.
    await writeBoundAdmins(fx, [
      { id: "owner1", role: "owner", sub: SUB, password: true },
      { id: "ops1", role: "operator", sub: "ops-sub", password: false }
    ]);

    const ownerCookie = await loginCookie(lucy.baseUrl, "owner1");
    const removed = await api(lucy.baseUrl, "PATCH", "/api/admin/admins/owner1", ownerCookie, {
      removeLocalPassword: true
    });
    expect(removed.status).toBe(400);
    const body = (await removed.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("LOCAL_OWNER_REQUIRED");
  });

  it("OIDC-13/OIDC-19: binding writes need the owner, refuse a foreign issuer and report conflicts", async () => {
    fx = await createAuthFixture({ secret: "env" });
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    await fx.writeAdmins([{ id: "owner1", role: "owner" }, { id: "ops1", role: "operator" }]);
    const ownerCookie = await loginCookie(lucy.baseUrl, "owner1");
    const opsCookie = await loginCookie(lucy.baseUrl, "ops1");

    // An operator cannot manage bindings.
    const asOperator = await api(lucy.baseUrl, "PUT", "/api/admin/admins/ops1/oidc-binding", opsCookie, {
      issuer: ISSUER,
      sub: "ops-sub",
      email: "ops@example.com"
    });
    expect(asOperator.status).toBe(403);

    // A foreign issuer is refused.
    const foreign = await api(lucy.baseUrl, "PUT", "/api/admin/admins/ops1/oidc-binding", ownerCookie, {
      issuer: "https://another-idp.example.com",
      sub: "ops-sub",
      email: "ops@example.com"
    });
    expect(foreign.status).toBe(400);
    expect(((await foreign.json()) as { error?: { code?: string } }).error?.code).toBe("OIDC_ISSUER_MISMATCH");

    // A valid binding is accepted and shows up for the owner.
    const added = await api(lucy.baseUrl, "PUT", "/api/admin/admins/ops1/oidc-binding", ownerCookie, {
      issuer: ISSUER,
      sub: "ops-sub",
      email: "ops@example.com"
    });
    expect(added.status).toBe(200);
    const admins = await (await api(lucy.baseUrl, "GET", "/api/admin/admins", ownerCookie)).json();
    const ops = (admins.data.admins as Array<{ id: string; loginMethods?: string[] }>).find(
      (a) => a.id === "ops1"
    );
    expect(ops?.loginMethods).toContain("oidc");

    // The same subject cannot be bound twice.
    const conflict = await api(lucy.baseUrl, "PUT", "/api/admin/admins/owner1/oidc-binding", ownerCookie, {
      issuer: ISSUER,
      sub: "ops-sub",
      email: "other@example.com"
    });
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { error?: { code?: string } }).error?.code).toBe("OIDC_BINDING_CONFLICT");
  });

  it("OIDC-21: accepts the 0440 mode Kubernetes produces and refuses a world-readable one", async () => {
    fx = await createAuthFixture({ secret: "env" });
    await fx.writeAdmins([{ id: "owner1", role: "owner" }]);
    idp = await startMockIdp();

    // Kubelet's fsGroup pass rewrites the mounted Secret to root:10001 0440.
    // A runtime that only accepted 0400/0600 would disable OIDC on every real
    // customer deployment while the chart still reports enabled.
    const grouped = await writeOidcFiles({ idp, secretMode: 0o440 });
    dir = grouped.dir;
    enableOidc(grouped.profilePath, grouped.secretPath);
    lucy = await startLucy();
    const ok = await (await fetch(`${lucy.baseUrl}/api/auth/status`)).json();
    expect(ok.data.methods).toEqual(["local", "oidc"]);
    await lucy.stop();
    lucy = undefined;
    await rm(grouped.dir, { recursive: true, force: true });
    dir = undefined;

    // World-readable is still refused.
    const world = await writeOidcFiles({ idp, secretMode: 0o644 });
    dir = world.dir;
    enableOidc(world.profilePath, world.secretPath);
    lucy = await startLucy();
    const refused = await (await fetch(`${lucy.baseUrl}/api/auth/status`)).json();
    expect(refused.data.methods).toEqual(["local"]);
  });

  it("OIDC-20: the unauthenticated status endpoint never reads the OIDC files again", async () => {
    fx = await createAuthFixture({ secret: "env" });
    await fx.writeAdmins([{ id: "owner1", role: "owner" }]);
    idp = await startMockIdp();
    const files = await writeOidcFiles({ idp });
    dir = files.dir;
    enableOidc(files.profilePath, files.secretPath);
    lucy = await startLucy();

    const first = await (await fetch(`${lucy.baseUrl}/api/auth/status`)).json();
    expect(first.data.methods).toEqual(["local", "oidc"]);

    // Break the files: the cached view keeps serving, so no request path reads the disk.
    await rm(files.profilePath, { force: true });
    await rm(files.secretPath, { force: true });
    const second = await (await fetch(`${lucy.baseUrl}/api/auth/status`)).json();
    expect(second.data.methods).toEqual(["local", "oidc"]);
  });
});

/** Writes the whole admins.yaml with the given accounts, each optionally OIDC-bound. */
async function writeBoundAdmins(
  fx: AuthFixture,
  accounts: Array<{ id: string; role: "owner" | "operator"; sub: string; password: boolean; email?: string }>
): Promise<void> {
  const { hashPassword } = await import("../auth/password.js");
  const { resetAdminsCache } = await import("../auth/admins-store.js");
  const { writeFile } = await import("node:fs/promises");
  const lines = ['version: "1"', "admins:"];
  for (const account of accounts) {
    const passwordHash = account.password ? await hashPassword("correct-horse-battery") : undefined;
    lines.push(
      `  - id: ${account.id}`,
      `    display_name: ${account.id}`,
      ...(passwordHash ? [`    password_hash: "${passwordHash}"`] : []),
      `    role: ${account.role}`,
      "    enabled: true",
      '    created_at: "2026-10-18T00:00:00.000Z"',
      "    oidc_bindings:",
      `      - issuer: ${ISSUER}`,
      `        sub: ${account.sub}`,
      `        email: ${account.email ?? `${account.id}@example.com`}`
    );
  }
  await writeFile(fx.adminsPath, `${lines.join("\n")}\n`, "utf8");
  resetAdminsCache();
}
