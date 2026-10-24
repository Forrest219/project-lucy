import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminsConfigError,
  loadAdminsConfig,
  resolveAuthMode,
  saveAdminsConfig
} from "../auth/admins-store.js";
import { issueSession } from "../auth/account-state.js";
import { hashPassword } from "../auth/password.js";
import { parseOidcProfile } from "../auth/oidc-profile.js";
import { SECURITY_SCHEMA_VERSION } from "../security/schema.js";
import { createAuthFixture, login, startLucy, type AuthFixture, type RunningLucy } from "./webui-auth-fixture.js";

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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ISSUER = "https://oidc.ksyun.com";
const EMAIL = "zhangsan@kingsoft.com";

const KINGSOFT_PROFILE = {
  issuer: ISSUER,
  authorizationEndpoint: "https://oidc.ksyun.com/auth",
  tokenEndpoint: "https://oidc.ksyun.com/token",
  jwksUri: "https://oidc.ksyun.com/keys",
  endSessionEndpoint: "https://oidc.ksyun.com/logout",
  clientId: "watchers",
  scopes: "openid profile email offline_access feishu_login",
  tokenEndpointAuth: "client_secret_post" as const,
  logoutStyle: "id_token_hint" as const,
  redirectPath: "/api/auth/oidc/callback",
  publicWebuiUrl: "https://lucy.example.com"
};

async function writeAdmins(fx: AuthFixture, body: string): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  const { resetAdminsCache } = await import("../auth/admins-store.js");
  await writeFile(fx.adminsPath, body, "utf8");
  resetAdminsCache();
}

describe("v2.0 OIDC reservation", () => {
  let fx: AuthFixture;
  let lucy: RunningLucy | undefined;

  afterEach(async () => {
    await lucy?.stop();
    lucy = undefined;
    await fx?.restore();
  });

  it("accepts a Kingsoft authorization-code profile without contacting the issuer", () => {
    const profile = parseOidcProfile(KINGSOFT_PROFILE);
    expect(profile.scopes).toContain("feishu_login");
    expect(profile.publicWebuiUrl).toBe("https://lucy.example.com");
    expect(profile.tokenEndpointAuth).toBe("client_secret_post");

    const pandora = parseOidcProfile({
      ...KINGSOFT_PROFILE,
      issuer: "http://oidc.pandora.tnoc.ksyun.com",
      discoveryUrl: "http://oidc.pandora.tnoc.ksyun.com/.well-known/openid-configuration",
      tokenEndpointAuth: "client_secret_basic",
      logoutStyle: "access_token"
    });
    expect(pandora.issuer).toBe("http://oidc.pandora.tnoc.ksyun.com");
    expect(pandora.tokenEndpointAuth).toBe("client_secret_basic");

    expect(() => parseOidcProfile({ ...KINGSOFT_PROFILE, clientSecret: "secret" })).toThrow(/secret file/);
    expect(() => parseOidcProfile({ ...KINGSOFT_PROFILE, publicWebuiUrl: "http://lucy.example.com" })).toThrow(/https/);
  });

  it("keeps an OIDC binding and unknown fields across a save, and does not turn the email into the account id", async () => {
    fx = await createAuthFixture({ secret: "env" });
    const passwordHash = await hashPassword("correct-horse-battery");
    await writeAdmins(
      fx,
      [
        'version: "1"',
        "admins:",
        "  - id: owner1",
        "    account_uid: 11111111-1111-1111-1111-111111111111",
        "    display_name: Owner",
        `    password_hash: "${passwordHash}"`,
        "    role: owner",
        "    enabled: true",
        '    created_at: "2026-10-18T00:00:00.000Z"',
        "  - id: ops-user",
        "    account_uid: 22222222-2222-2222-2222-222222222222",
        "    display_name: 张三",
        "    role: operator",
        "    enabled: true",
        '    created_at: "2026-10-18T00:00:00.000Z"',
        "    future_field: keep-me",
        "    oidc_bindings:",
        `      - issuer: ${ISSUER}`,
        "        sub: opaque-sub",
        `        email: ${EMAIL}`
      ].join("\n")
    );

    const loaded = await loadAdminsConfig({ fresh: true });
    const operator = loaded.admins.find((admin) => admin.id === "ops-user");
    expect(operator?.id).toBe("ops-user");
    expect(operator?.password_hash).toBeUndefined();
    expect(operator?.oidc_bindings).toEqual([{ issuer: ISSUER, sub: "opaque-sub", email: EMAIL }]);
    expect(operator?.preserved).toEqual({ future_field: "keep-me" });

    await saveAdminsConfig(
      { ...loaded, admins: loaded.admins.map((admin) => (admin.id === "owner1" ? { ...admin, display_name: "Owner 2" } : admin)) },
      { changeType: "admin_patch", actor: "owner1", targetId: "owner1" }
    );
    const text = await readFile(fx.adminsPath, "utf8");
    expect(text).toContain("future_field: keep-me");
    expect(text).toContain(`email: ${EMAIL}`);
    expect(text).toContain("id: ops-user");
    expect(text).not.toContain(`id: ${EMAIL}`);

    const again = await loadAdminsConfig({ fresh: true });
    expect(again.admins.find((admin) => admin.id === "ops-user")?.oidc_bindings?.[0]?.email).toBe(EMAIL);
  });

  it("rejects a file that reuses an issuer and email, without opening the deployment", async () => {
    fx = await createAuthFixture({ secret: "env" });
    const passwordHash = await hashPassword("correct-horse-battery");
    await writeAdmins(
      fx,
      [
        'version: "1"',
        "admins:",
        "  - id: owner1",
        `    password_hash: "${passwordHash}"`,
        "    role: owner",
        "    oidc_bindings:",
        `      - issuer: ${ISSUER}`,
        "        sub: sub-a",
        `        email: ${EMAIL}`,
        "  - id: ops-user",
        "    role: operator",
        "    oidc_bindings:",
        `      - issuer: ${ISSUER}`,
        "        sub: sub-b",
        `        email: ${EMAIL.toUpperCase()}`
      ].join("\n")
    );
    await expect(loadAdminsConfig({ fresh: true })).rejects.toBeInstanceOf(AdminsConfigError);
    expect(await resolveAuthMode()).toBe("unavailable");
  });

  it("still rejects an account that has neither a password nor a binding", async () => {
    fx = await createAuthFixture({ secret: "env" });
    await writeAdmins(fx, 'version: "1"\nadmins:\n  - id: owner1\n    role: owner\n');
    await expect(loadAdminsConfig({ fresh: true })).rejects.toThrow(/password_hash/);
  });

  it("issues a v2 session without sealing a logout hint or bumping the security schema", async () => {
    fx = await createAuthFixture({ secret: "env" });
    const passwordHash = await hashPassword("correct-horse-battery");
    await writeAdmins(
      fx,
      [
        'version: "1"',
        "admins:",
        "  - id: ops-user",
        "    account_uid: 22222222-2222-2222-2222-222222222222",
        "    display_name: 张三",
        "    role: operator",
        "    enabled: true",
        '    created_at: "2026-10-18T00:00:00.000Z"',
        "    oidc_bindings:",
        `      - issuer: ${ISSUER}`,
        "        sub: opaque-sub",
        `        email: ${EMAIL}`
      ].join("\n")
    );
    const admin = (await loadAdminsConfig({ fresh: true })).admins[0];
    const issued = await issueSession(admin, { logoutHint: "id-token-hint-value" });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const claims = JSON.parse(Buffer.from(issued.token.split(".")[0] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    expect(claims.v).toBe(2);
    expect(claims).not.toHaveProperty("logoutHint");
    expect(JSON.stringify(claims)).not.toContain("id-token-hint-value");
    // Audit-trust T03 migrated the shared security schema to v2; Lucy v0.25 /
    // L25-09 B26 migrated it to v3 (audit increment additive columns, including
    // `endpoint_id`). OIDC reservation itself adds no migration.
    expect(SECURITY_SCHEMA_VERSION).toBe(3);
  });

  it("reports only local login and refuses a password for an OIDC-only account", async () => {
    fx = await createAuthFixture({ secret: "env" });
    const passwordHash = await hashPassword("correct-horse-battery");
    await writeAdmins(
      fx,
      [
        'version: "1"',
        "admins:",
        "  - id: owner1",
        "    account_uid: 11111111-1111-1111-1111-111111111111",
        "    display_name: Owner",
        `    password_hash: "${passwordHash}"`,
        "    role: owner",
        "    enabled: true",
        '    created_at: "2026-10-18T00:00:00.000Z"',
        "  - id: ops-user",
        "    account_uid: 22222222-2222-2222-2222-222222222222",
        "    display_name: 张三",
        "    role: operator",
        "    enabled: true",
        '    created_at: "2026-10-18T00:00:00.000Z"',
        "    oidc_bindings:",
        `      - issuer: ${ISSUER}`,
        "        sub: opaque-sub",
        `        email: ${EMAIL}`
      ].join("\n")
    );
    lucy = await startLucy();
    const status = await fetch(`${lucy.baseUrl}/api/auth/status`);
    const body = await status.json() as { data?: { methods?: string[] } };
    expect(body.data?.methods).toEqual(["local"]);
    expect(JSON.stringify(body)).not.toContain("oidc.ksyun.com");

    const denied = await login(lucy.baseUrl, "ops-user", "correct-horse-battery");
    expect(denied.status).toBe(401);
    const owner = await login(lucy.baseUrl, "owner1");
    expect(owner.status).toBe(200);
  });

  it("records the OIDC shape in Helm values and does not inject it into the pod env", async () => {
    const values = await readFile(path.join(repoRoot, "deploy/k8s/helm/lucy/values.yaml"), "utf8");
    const helpers = await readFile(path.join(repoRoot, "deploy/k8s/helm/lucy/templates/_helpers.tpl"), "utf8");
    expect(values).toContain("publicUrl:");
    expect(values).toContain("tokenEndpointAuth: client_secret_post");
    expect(values).toContain("client_secret_basic");
    expect(values).toContain("feishu_login");
    expect(values).toContain("https://oidc.ksyun.com");
    expect(helpers).not.toContain("oidc.ksyun.com");
    expect(helpers).not.toContain("LUCY_PUBLIC_WEBUI_URL");
    expect(helpers).not.toContain(".Values.oidc");
  });
});
