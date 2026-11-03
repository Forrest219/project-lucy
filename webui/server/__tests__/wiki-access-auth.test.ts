import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  api,
  createAuthFixture,
  loginCookie,
  startLucy,
  type AuthFixture,
  type RunningLucy
} from "./webui-auth-fixture";

/**
 * Spec 193 SC-23 — the access endpoints keep the operator's ordinary Wiki
 * maintenance rights and refuse an unauthenticated caller.
 *
 * The assertions run over REAL HTTP against the real server in the required
 * auth mode. The auth fixture is the repository's shared one.
 */

const KEY = "global/auth-page.md";
const KEY_URL = `/api/wiki/${encodeURIComponent(KEY)}`;

let fx: AuthFixture;
let lucy: RunningLucy;
let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;

beforeEach(async () => {
  fx = await createAuthFixture({ secret: "env" });
  // The default content root is `<projectRoot>/config`; the Wiki content of
  // this fixture lives directly under the project root.
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.LUCY_CONTENT_ROOT = ".";
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.LUCY_AUDIT_DB = path.join(fx.root, "audit.sqlite");
  await fx.writeAdmins([{ id: "bob", role: "operator" }]);
  await writeFile(
    path.join(fx.root, "wiki", "global", "auth-page.md"),
    "---\nallowed_roles:\n  - finance\n---\n# Page\n",
    "utf8"
  );
  lucy = await startLucy();
});

afterEach(async () => {
  await lucy.stop();
  await fx.restore();
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
});

describe("Spec 193 SC-23 — the access endpoints and the auth mode", () => {
  it("refuses an unauthenticated read of the access summary", async () => {
    const res = await api(lucy.baseUrl, "GET", `${KEY_URL}/access`);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "AUTH_REQUIRED" } });
  });

  it("refuses an unauthenticated preview", async () => {
    const res = await api(lucy.baseUrl, "POST", `${KEY_URL}/access/preview`, undefined, {
      allowed_roles: ["ops"]
    });
    expect(res.status).toBe(401);
  });

  it("refuses an unauthenticated save", async () => {
    const res = await api(lucy.baseUrl, "PUT", `${KEY_URL}/access`, undefined, {
      allowed_roles: ["ops"]
    });
    expect(res.status).toBe(401);
  });

  it("refuses an unauthenticated batch commit", async () => {
    const res = await api(lucy.baseUrl, "POST", "/api/wiki/access/batch/commit", undefined, {
      operation_id: "wbo-anon",
      plan_digest: "wbd-anon",
      idempotency_key: "idem-anon",
      items: [{ key: KEY, expected_version: "sha256:anon" }],
      action: { mode: "add", role_ids: ["ops"] }
    });
    expect(res.status).toBe(401);
  });

  it("lets a signed-in operator read the access summary", async () => {
    const cookie = await loginCookie(lucy.baseUrl, "bob");
    const res = await api(lucy.baseUrl, "GET", `${KEY_URL}/access`, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { key: string; acl: unknown } };
    expect(body.data.key).toBe(KEY);
    expect(body.data.acl).toEqual({ state: "roles", roles: ["finance"] });
  });

  it("lets a signed-in operator change the access of one document", async () => {
    const cookie = await loginCookie(lucy.baseUrl, "bob");
    const current = await readFile(path.join(fx.root, "wiki", "global", "auth-page.md"), "utf8");
    const summary = await api(lucy.baseUrl, "GET", `${KEY_URL}/access`, cookie);
    expect(summary.status).toBe(200);
    const version = (await summary.json()).data.file_version as string;

    const preview = await api(lucy.baseUrl, "POST", `${KEY_URL}/access/preview`, cookie, {
      allowed_roles: ["finance", "ops"],
      expected_version: version
    });
    expect(preview.status).toBe(200);
    const digest = (await preview.json()).data.preview_digest as string;

    const saved = await api(lucy.baseUrl, "PUT", `${KEY_URL}/access`, cookie, {
      allowed_roles: ["finance", "ops"],
      expected_version: version,
      preview_digest: digest
    });
    expect(saved.status).toBe(200);
    expect((await saved.json()).data.status).toBe("applied");

    // The body is untouched and the declaration changed.
    const after = await readFile(path.join(fx.root, "wiki", "global", "auth-page.md"), "utf8");
    expect(after).toContain("# Page");
    expect(after).toContain("finance");
    expect(after).toContain("ops");
    // The body below the frontmatter is byte-identical.
    expect(after.slice(after.indexOf("# Page"))).toBe(current.slice(current.indexOf("# Page")));
  });
});
