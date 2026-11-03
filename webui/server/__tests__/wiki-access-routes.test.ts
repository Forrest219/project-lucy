import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { getAuditDb, resetAuditDbForTests } from "../admin/audit";
import { buildServer } from "../index";
import { getSecurityStore, closeSecurityStore } from "../security/instance";
import { invalidateWikiAccessHoldCache, isWikiKeyHeld } from "../wiki-access-holds";
import { wikiContentHash } from "../wiki-hash";

/**
 * Spec 193 §6.2 / §10 — the single-document access API.
 *
 * Everything is asserted through the real HTTP surface (`app.inject`), the
 * real bytes on disk, the real version history and the real audit rows.
 */

let projectRoot: string;
let prevRoot: string | undefined;
let prevContent: string | undefined;
let prevAuditDb: string | undefined;
let app: FastifyInstance;

const KEY = "global/access-page.md";
const pagePath = () => path.join(projectRoot, "wiki", "global", "access-page.md");
const accessUrl = () => `/api/wiki/${encodeURIComponent(KEY)}/access`;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-wiki-routes-"));
  await mkdir(path.join(projectRoot, "wiki", "global"), { recursive: true });
  await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  prevRoot = process.env.KTX_PROJECT_ROOT;
  prevContent = process.env.LUCY_CONTENT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  prevAuditDb = process.env.LUCY_AUDIT_DB;
  // The global test setup points every suite at ONE shared audit database;
  // each test owns its own so the audit assertions are hermetic.
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  resetAuditDbForTests();
  await writeFile(
    pagePath(),
    "---\nallowed_roles:\n  - finance\nsummary: S\nowner_team: platform\n---\n# Page\n\nBody line.\n",
    "utf8"
  );
  app = buildServer();
  await app.ready();
});

afterEach(async () => {
  await app.close();
  closeSecurityStore();
  resetAuditDbForTests();
  if (prevAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = prevAuditDb;
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  if (prevContent === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = prevContent;
  await rm(projectRoot, { recursive: true, force: true });
});

async function currentVersion(): Promise<string> {
  return wikiContentHash(await readFile(pagePath(), "utf8"));
}

async function previewDigestFor(allowedRoles: unknown): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `${accessUrl()}/preview`,
    payload: { allowed_roles: allowedRoles, expected_version: await currentVersion() }
  });
  expect(response.statusCode).toBe(200);
  return response.json().data.preview_digest as string;
}

async function auditRowsFor(filePath: string): Promise<Array<Record<string, unknown>>> {
  const db = await getAuditDb();
  return db
    .prepare(
      "SELECT id, actor, actor_type, change_type, operation, request_id, write_status FROM config_change_log WHERE file_path = ? ORDER BY id ASC"
    )
    .all(filePath) as Array<Record<string, unknown>>;
}

async function prepareHold(key: string): Promise<string> {
  const store = await getSecurityStore();
  if (!store.ok) throw new Error("the security store is unavailable");
  const operationId = `wac-${randomUUID()}`;
  const bytes = await readFile(pagePath(), "utf8");
  const prepared = store.value.prepareWikiAccessOperation({
    operationId,
    wikiKey: key,
    direction: "widen",
    actor: "tester",
    actorType: "system",
    oldHash: wikiContentHash(bytes),
    targetHash: wikiContentHash(`${bytes}wider`),
    summary: `wiki_access:${key}`
  });
  if (!prepared.ok) throw new Error(`prepare failed: ${prepared.code}`);
  invalidateWikiAccessHoldCache();
  return operationId;
}

describe("GET /api/wiki/:key/access", () => {
  it("returns the exact summary shape", async () => {
    const response = await app.inject({ method: "GET", url: accessUrl() });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.ok).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual([
      "acl",
      "declared_role_count",
      "declared_without_discover",
      "declared_without_read",
      "file_version",
      "key",
      "role_channel_version",
      "role_effects"
    ]);
    expect(body.data.key).toBe(KEY);
    expect(body.data.acl).toEqual({ state: "roles", roles: ["finance"] });
    expect(body.data.declared_role_count).toBe(1);
    expect(body.data.file_version).toBe(await currentVersion());
    expect(body.data.role_channel_version).toMatch(/^rcv-[0-9a-f]{32}$/);
    expect(Array.isArray(body.data.role_effects)).toBe(true);
  });

  it("404s for an unknown document", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/wiki/${encodeURIComponent("global/nope.md")}/access`
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("WIKI_NOT_FOUND");
  });

  it("carries the pending change of a held key", async () => {
    const operationId = await prepareHold(KEY);
    const response = await app.inject({ method: "GET", url: accessUrl() });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.pending_change).toEqual({ operation_id: operationId, state: "pending" });
  });
});

describe("POST /api/wiki/:key/access/preview", () => {
  it("returns the old and the new ACL, the direction, the effects and the digest", async () => {
    const version = await currentVersion();
    const response = await app.inject({
      method: "POST",
      url: `${accessUrl()}/preview`,
      payload: { allowed_roles: ["finance", "ops"], expected_version: version }
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(Object.keys(body.data).sort()).toEqual([
      "current_acl",
      "declared_role_count",
      "declared_without_discover",
      "declared_without_read",
      "direction",
      "file_version",
      "key",
      "next_acl",
      "noop",
      "preview_digest",
      "role_channel_version",
      "role_effects"
    ]);
    expect(body.data.current_acl).toEqual({ state: "roles", roles: ["finance"] });
    expect(body.data.next_acl).toEqual({ state: "roles", roles: ["finance", "ops"] });
    expect(body.data.direction).toBe("widen");
    expect(body.data.noop).toBe(false);
    expect(body.data.declared_role_count).toBe(2);
    expect(body.data.preview_digest).toMatch(/^wac-[0-9a-f]{32}$/);
    expect(body.data.file_version).toBe(version);
  });

  it("428s without a version and 409s with a stale one", async () => {
    const missing = await app.inject({
      method: "POST",
      url: `${accessUrl()}/preview`,
      payload: { allowed_roles: ["finance"] }
    });
    expect(missing.statusCode).toBe(428);
    expect(missing.json().error.code).toBe("wiki_expected_version_required");

    const stale = await app.inject({
      method: "POST",
      url: `${accessUrl()}/preview`,
      payload: { allowed_roles: ["finance"], expected_version: "sha256:stale" }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("wiki_write_conflict");
  });

  it("400s for an illegal ACL request", async () => {
    const response = await app.inject({
      method: "POST",
      url: `${accessUrl()}/preview`,
      payload: { allowed_roles: ["*", "finance"], expected_version: await currentVersion() }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("CONTEXT_ACL_INVALID");
  });
});

describe("PUT /api/wiki/:key/access", () => {
  it("428s without a version and 409s with a stale one; nothing is written", async () => {
    const before = await readFile(pagePath(), "utf8");
    const digest = await previewDigestFor(["finance", "ops"]);

    const missing = await app.inject({
      method: "PUT",
      url: accessUrl(),
      payload: { allowed_roles: ["finance", "ops"], preview_digest: digest }
    });
    expect(missing.statusCode).toBe(428);
    expect(missing.json().error.code).toBe("wiki_expected_version_required");

    const stale = await app.inject({
      method: "PUT",
      url: accessUrl(),
      payload: { allowed_roles: ["finance", "ops"], expected_version: "sha256:stale", preview_digest: digest }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("wiki_write_conflict");

    expect(await readFile(pagePath(), "utf8")).toBe(before);
  });

  it("409s with a stale digest and writes nothing", async () => {
    const before = await readFile(pagePath(), "utf8");
    const response = await app.inject({
      method: "PUT",
      url: accessUrl(),
      payload: {
        allowed_roles: ["finance", "ops"],
        expected_version: await currentVersion(),
        preview_digest: "wac-00000000000000000000000000000000"
      }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("wiki_access_preview_stale");
    expect(await readFile(pagePath(), "utf8")).toBe(before);
  });

  it("400s for a corrupt ACL request", async () => {
    const before = await readFile(pagePath(), "utf8");
    const response = await app.inject({
      method: "PUT",
      url: accessUrl(),
      payload: {
        allowed_roles: ["*", "finance"],
        expected_version: await currentVersion(),
        preview_digest: await previewDigestFor(["finance"])
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("CONTEXT_ACL_INVALID");
    expect(await readFile(pagePath(), "utf8")).toBe(before);
  });

  it("409s for a held key and writes nothing", async () => {
    const before = await readFile(pagePath(), "utf8");
    await prepareHold(KEY);
    const digest = await previewDigestFor(["finance", "ops"]);

    const response = await app.inject({
      method: "PUT",
      url: accessUrl(),
      payload: {
        allowed_roles: ["finance", "ops"],
        expected_version: await currentVersion(),
        preview_digest: digest
      }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("wiki_access_change_pending");
    expect(await readFile(pagePath(), "utf8")).toBe(before);
  });

  it("applies a widening and then a narrowing", async () => {
    const widenDigest = await previewDigestFor(["finance", "ops"]);
    const widen = await app.inject({
      method: "PUT",
      url: accessUrl(),
      payload: {
        allowed_roles: ["finance", "ops"],
        expected_version: await currentVersion(),
        preview_digest: widenDigest
      }
    });
    expect(widen.statusCode).toBe(200);
    expect(Object.keys(widen.json().data).sort()).toEqual([
      "acl",
      "direction",
      "file_version",
      "key",
      "role_channel_version",
      "role_effects",
      "status"
    ]);
    expect(widen.json().data.status).toBe("applied");
    expect(widen.json().data.direction).toBe("widen");
    expect(widen.json().data.acl).toEqual({ state: "roles", roles: ["finance", "ops"] });
    expect(await readFile(pagePath(), "utf8")).toContain("- ops");

    const narrowDigest = await previewDigestFor(["finance"]);
    const narrow = await app.inject({
      method: "PUT",
      url: accessUrl(),
      payload: {
        allowed_roles: ["finance"],
        expected_version: await currentVersion(),
        preview_digest: narrowDigest
      }
    });
    expect(narrow.statusCode).toBe(200);
    expect(narrow.json().data.direction).toBe("narrow");
    expect(narrow.json().data.acl).toEqual({ state: "roles", roles: ["finance"] });
  });

  it("preserves the body verbatim and every unknown frontmatter field", async () => {
    const before = await readFile(pagePath(), "utf8");
    const bodyOf = (raw: string) => raw.slice(raw.indexOf("\n---", 4) + "\n---".length).replace(/^\r?\n/, "");

    const digest = await previewDigestFor(["ops"]);
    const response = await app.inject({
      method: "PUT",
      url: accessUrl(),
      payload: { allowed_roles: ["ops"], expected_version: await currentVersion(), preview_digest: digest }
    });
    expect(response.statusCode).toBe(200);

    const after = await readFile(pagePath(), "utf8");
    expect(bodyOf(after)).toBe(bodyOf(before));
    expect(after).toContain("owner_team: platform");
    expect(after).toContain("summary: S");
    expect(after).toContain("- ops");
    expect(after).not.toContain("- finance");
  });

  it("a canonical no-op writes no file, creates no version and no audit row", async () => {
    // A real change first, so the baseline is not empty.
    const widenDigest = await previewDigestFor(["ops"]);
    await app.inject({
      method: "PUT",
      url: accessUrl(),
      payload: { allowed_roles: ["ops"], expected_version: await currentVersion(), preview_digest: widenDigest }
    });

    const before = await stat(pagePath());
    const bytes = await readFile(pagePath(), "utf8");
    const versionsBefore = await app.inject({
      method: "GET",
      url: `/api/wiki/${encodeURIComponent(KEY)}/versions`
    });
    const auditBefore = await auditRowsFor("wiki/global/access-page.md");
    expect(auditBefore.length).toBeGreaterThan(0);

    const digest = await previewDigestFor(["ops"]);
    const response = await app.inject({
      method: "PUT",
      url: accessUrl(),
      payload: { allowed_roles: ["ops"], expected_version: await currentVersion(), preview_digest: digest }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe("noop");
    expect(response.json().data.direction).toBe("neutral");

    // The file was NOT rewritten: the inode and the mtime are unchanged.
    const after = await stat(pagePath());
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await readFile(pagePath(), "utf8")).toBe(bytes);

    const versionsAfter = await app.inject({
      method: "GET",
      url: `/api/wiki/${encodeURIComponent(KEY)}/versions`
    });
    expect(versionsAfter.json().data.versions).toHaveLength(
      versionsBefore.json().data.versions.length
    );
    expect(await auditRowsFor("wiki/global/access-page.md")).toHaveLength(auditBefore.length);
  });

  it("records the trusted actor, never a body-supplied one", async () => {
    const digest = await previewDigestFor(["ops"]);
    const response = await app.inject({
      method: "PUT",
      url: accessUrl(),
      payload: {
        allowed_roles: ["ops"],
        expected_version: await currentVersion(),
        preview_digest: digest,
        actor: "mallory",
        actor_id: "mallory",
        actor_type: "system"
      }
    });
    expect(response.statusCode).toBe(200);

    const rows = await auditRowsFor("wiki/global/access-page.md");
    const row = rows.at(-1);
    expect(row?.actor).toBe("local-admin");
    expect(row?.actor).not.toBe("mallory");
    expect(row?.actor_type).toBe("ui_admin");
    expect(row?.change_type).toBe("wiki_access_update");
    expect(row?.operation).toBe("access_update");
  });
});

describe("Spec 193 §8.2 — the startup recovery runs before the server accepts requests", () => {
  it("reconciles a pending widening into needs_review and keeps the hold", async () => {
    // A widening whose bytes reached the disk but whose durable security
    // operation was never committed. This is the crash window of §8.2.
    const oldBytes = await readFile(pagePath(), "utf8");
    const widenedBytes = oldBytes.replace("allowed_roles:\n  - finance", "allowed_roles:\n  - finance\n  - ops");
    await writeFile(pagePath(), widenedBytes, "utf8");

    const store = await getSecurityStore();
    expect(store.ok).toBe(true);
    if (!store.ok) return;
    const operationId = `wac-${randomUUID()}`;
    const prepared = store.value.prepareWikiAccessOperation({
      operationId,
      wikiKey: KEY,
      direction: "widen",
      actor: "tester",
      actorType: "system",
      oldHash: wikiContentHash(oldBytes),
      targetHash: wikiContentHash(widenedBytes),
      summary: `wiki_access:${KEY}`
    });
    expect(prepared.ok).toBe(true);
    invalidateWikiAccessHoldCache();
    expect(await isWikiKeyHeld(KEY)).toBe(true);

    // Rebuild the server: the `onReady` hook must run the recovery. Before
    // the wiring existed, the operation stayed `pending` forever and the key
    // stayed held without any `needs_review` evidence.
    await app.close();
    app = buildServer();
    await app.ready();

    const recoveredStore = await getSecurityStore();
    expect(recoveredStore.ok).toBe(true);
    if (!recoveredStore.ok) return;
    const recovered = recoveredStore.value.getWikiAccessOperation(operationId);
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.value?.state).toBe("needs_review");
    // The widening is NOT ratified and the key stays denied.
    expect(await isWikiKeyHeld(KEY)).toBe(true);
  });
});
