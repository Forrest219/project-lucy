import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAuditDb, resetAuditDbForTests } from "../admin/audit";
import { getSecurityStore, closeSecurityStore } from "../security/instance";
import { invalidateWikiAccessHoldCache, isWikiKeyHeld } from "../wiki-access-holds";
import {
  saveWikiAccess,
  previewWikiAccess
} from "../wiki-access";
import {
  classifyAccessDirection,
  type AccessDirection
} from "../wiki-access-effects";
import {
  aclOfMarkdown,
  applyRawAllowedRoles,
  canonicalDeclaration,
  computeWikiAccessDigest,
  mutateWikiAccessUnlocked,
  normalizeRequestedRoles,
  readAclDeclaration,
  resolveUploadAcl,
  suggestUploadAccessSelection,
  WikiAccessError
} from "../wiki-access-operation";
import { recoverWikiAccessOperations } from "../wiki-access-recovery";
import { canAccessWikiPage, resolveWikiPage } from "../proxy/wiki-acl";
import { parseObjectAcl, type ContextSnapshot, type ObjectAcl } from "../proxy/context-acl";
import type { TrustedActor } from "../security/request-actor";
import type { Identity } from "../proxy/identity";
import {
  commitWikiUpload,
  deleteWiki,
  listWikiVersions,
  moveWiki,
  previewWikiUpload,
  readWiki,
  restoreWikiVersion,
  writeWiki
} from "../wiki";
import { wikiContentHash } from "../wiki-hash";

/**
 * Spec 193 §8 — the ONE coordinated authorization mutation, the per-key
 * widening hold and the crash recovery.
 *
 * The hold is prepared through the real durable security store, the denial is
 * asserted through the real `canAccessWikiPage` decision point, and every
 * mutation is refused through the real write services.
 */

let projectRoot: string;
let prevRoot: string | undefined;
let prevContent: string | undefined;
let prevAuditDb: string | undefined;

const KEY = "global/op-page.md";
const pagePath = () => path.join(projectRoot, "wiki", "global", "op-page.md");

const IDENTITY: Identity = {
  userId: "agent-a",
  tokenLabel: "label",
  tokenHashPrefix: "prefix"
};

const SNAPSHOT: ContextSnapshot = {
  ok: true,
  roleIds: ["finance"],
  roleChannels: { finance: ["wiki_search", "wiki_read"] },
  policyVersion: "test-policy",
  roleChannelVersion: "test-channels"
};

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-wiki-op-"));
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
});

afterEach(async () => {
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

/** Prepare a durable widening operation → the key is held from this moment on. */
async function prepareHold(key: string, input: {
  direction?: AccessDirection;
  oldHash?: string;
  targetHash?: string;
} = {}): Promise<string> {
  const store = await getSecurityStore();
  if (!store.ok) throw new Error("the security store is unavailable");
  const operationId = `wac-${randomUUID()}`;
  const prepared = store.value.prepareWikiAccessOperation({
    operationId,
    wikiKey: key,
    direction: input.direction ?? "widen",
    actor: "tester",
    actorType: "system",
    oldHash: input.oldHash,
    targetHash: input.targetHash,
    summary: `wiki_access:${key}`
  });
  if (!prepared.ok) throw new Error(`prepare failed: ${prepared.code}`);
  invalidateWikiAccessHoldCache();
  return operationId;
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  const end = raw.indexOf("\n---", 4);
  if (!raw.startsWith("---\n") || end < 0) return { frontmatter: "", body: raw };
  return { frontmatter: raw.slice(4, end), body: raw.slice(end + "\n---".length).replace(/^\r?\n/, "") };
}

async function auditRowsFor(filePath: string): Promise<Array<Record<string, unknown>>> {
  const db = await getAuditDb();
  return db
    .prepare("SELECT id, actor, actor_type, change_type, operation, request_id, write_status FROM config_change_log WHERE file_path = ? ORDER BY id ASC")
    .all(filePath) as Array<Record<string, unknown>>;
}

const OPERATOR: TrustedActor = {
  actorId: "operator-7",
  actorType: "ui_admin",
  accountUid: null,
  role: "owner",
  authMode: "required",
  sessionId: null,
  requestId: null,
  actorIp: null
};

describe("Spec 193 §4.3 — the direction decides whether the key is held", () => {
  const matrix: Array<[string, ObjectAcl, ObjectAcl, AccessDirection]> = [
    ["equal", { state: "roles", roles: ["a"] }, { state: "roles", roles: ["a"] }, "neutral"],
    ["strict subset", { state: "roles", roles: ["a", "b"] }, { state: "roles", roles: ["a"] }, "narrow"],
    ["superset", { state: "roles", roles: ["a"] }, { state: "roles", roles: ["a", "b"] }, "widen"],
    ["mixed add + remove", { state: "roles", roles: ["a", "b"] }, { state: "roles", roles: ["b", "c"] }, "widen"],
    ["corrupt → non-empty", { state: "corrupt", detail: "wildcard_mixed" }, { state: "roles", roles: ["a"] }, "widen"],
    ["all → roles", { state: "all" }, { state: "roles", roles: ["a"] }, "narrow"],
    ["roles → all", { state: "roles", roles: ["a"] }, { state: "all" }, "widen"],
    ["missing → roles", { state: "missing" }, { state: "roles", roles: ["a"] }, "widen"]
  ];

  it.each(matrix)("%s", (_label, current, next, expected) => {
    expect(classifyAccessDirection(current, next)).toBe(expected);
  });

  it("a narrowing leaves no hold behind", async () => {
    const first = (await readWiki(projectRoot, KEY)).file_version;
    const widen = await previewWikiAccess(projectRoot, KEY, {
      allowed_roles: ["finance", "ops"],
      expected_version: first
    });
    expect(widen.direction).toBe("widen");
    await saveWikiAccess(projectRoot, KEY, {
      allowed_roles: ["finance", "ops"],
      expected_version: first,
      preview_digest: widen.preview_digest
    });

    const second = (await readWiki(projectRoot, KEY)).file_version;
    const narrow = await previewWikiAccess(projectRoot, KEY, {
      allowed_roles: ["finance"],
      expected_version: second
    });
    expect(narrow.direction).toBe("narrow");
    await saveWikiAccess(projectRoot, KEY, {
      allowed_roles: ["finance"],
      expected_version: second,
      preview_digest: narrow.preview_digest
    });

    const store = await getSecurityStore();
    expect(store.ok).toBe(true);
    if (!store.ok) return;
    expect(store.value.isWikiAccessWideningHeld(KEY)).toEqual({ ok: true, value: false });
    expect(store.value.listWikiAccessHolds()).toEqual({ ok: true, value: [] });
  });
});

describe("Spec 193 §9.4 — an unresolved widening denies the whole key", () => {
  it("denies search AND read, even when the widened bytes are already on disk", async () => {
    const page = await resolveWikiPage(KEY);
    expect(page).toBeTruthy();
    if (!page) return;

    // Without a hold the very same page is visible to the Role.
    expect(await canAccessWikiPage(IDENTITY, page, "discover", SNAPSHOT)).toEqual({ allowed: true });
    expect(await canAccessWikiPage(IDENTITY, page, "read", SNAPSHOT)).toEqual({ allowed: true });

    // The widening bytes reached the disk but the security operation was not
    // committed: the key is held from this moment on.
    const widened = await readFile(pagePath(), "utf8");
    const targetBytes = widened.replace("- finance", "- ops");
    await writeFile(pagePath(), targetBytes, "utf8");
    await prepareHold(KEY, {
      direction: "widen",
      oldHash: wikiContentHash(widened),
      targetHash: wikiContentHash(targetBytes)
    });

    const heldPage = await resolveWikiPage(KEY);
    expect(heldPage).toBeTruthy();
    if (!heldPage) return;
    expect(await canAccessWikiPage(IDENTITY, heldPage, "discover", SNAPSHOT)).toEqual({
      allowed: false,
      reason: "context_not_available"
    });
    expect(await canAccessWikiPage(IDENTITY, heldPage, "read", SNAPSHOT)).toEqual({
      allowed: false,
      reason: "context_not_available"
    });
  });

  it("rejects every other mutation of a held key with 409 wiki_access_change_pending", async () => {
    const version = (await readWiki(projectRoot, KEY)).file_version;
    await writeWiki(projectRoot, KEY, { content: "# Page v2\n", expected_version: version });
    const current = (await readWiki(projectRoot, KEY)).file_version;
    const bytes = await readFile(pagePath(), "utf8");

    await prepareHold(KEY, {
      direction: "widen",
      oldHash: wikiContentHash(bytes),
      targetHash: wikiContentHash(`${bytes}wider`)
    });

    // 1. A body save.
    await expect(
      writeWiki(projectRoot, KEY, { content: "# hijacked\n", expected_version: current })
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_access_change_pending" });

    // 2. An upload commit.
    const uploadPreview = await previewWikiUpload(projectRoot, {
      key: KEY,
      markdown: "# Uploaded\n",
      mode: "replace",
      access: { mode: "preserve_current" }
    });
    await expect(
      commitWikiUpload(projectRoot, {
        key: KEY,
        markdown: "# Uploaded\n",
        mode: "replace",
        access: { mode: "preserve_current" },
        expected_version: current,
        preview_digest: uploadPreview.access.preview_digest
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_access_change_pending" });

    // 3. An authorization save.
    const accessPreview = await previewWikiAccess(projectRoot, KEY, {
      allowed_roles: ["ops"],
      expected_version: current
    });
    await expect(
      saveWikiAccess(projectRoot, KEY, {
        allowed_roles: ["ops"],
        expected_version: current,
        preview_digest: accessPreview.preview_digest
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_access_change_pending" });

    // 4. A version restore.
    const versions = await listWikiVersions(projectRoot, KEY);
    const versionId = versions.versions[0]?.versionId ?? "";
    await expect(
      restoreWikiVersion(projectRoot, KEY, versionId, undefined, current)
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_access_change_pending" });

    // 5. A move.
    await expect(
      moveWiki(projectRoot, KEY, "moved", undefined, current)
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_access_change_pending" });

    // 6. A delete.
    await expect(
      deleteWiki(projectRoot, KEY, undefined, current)
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_access_change_pending" });

    // NOTHING was written.
    expect(await readFile(pagePath(), "utf8")).toBe(bytes);
  });

  it("cannot move the uncommitted widening to another key", async () => {
    const current = (await readWiki(projectRoot, KEY)).file_version;
    const bytes = await readFile(pagePath(), "utf8");
    const widenedBytes = bytes.replace("- finance", "- ops");
    await writeFile(pagePath(), widenedBytes, "utf8");
    await prepareHold(KEY, {
      direction: "widen",
      oldHash: wikiContentHash(bytes),
      targetHash: wikiContentHash(widenedBytes)
    });

    await expect(
      moveWiki(projectRoot, KEY, "moved", undefined, wikiContentHash(widenedBytes))
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_access_change_pending" });

    // The widening content never reaches another key and the source stays held.
    await expect(readFile(path.join(projectRoot, "wiki", "moved", "op-page.md"), "utf8")).rejects.toThrow();
    expect(await isWikiKeyHeld(KEY)).toBe(true);
    expect(await readFile(pagePath(), "utf8")).toBe(widenedBytes);
  });
});

describe("Spec 193 §8 — the ONE coordinated mutation primitive", () => {
  it("writes the target, commits the durable operation and leaves no hold behind", async () => {
    const version = (await readWiki(projectRoot, KEY)).file_version;
    const nextAcl = parseObjectAcl(["ops"], true);

    const result = await mutateWikiAccessUnlocked({
      projectRoot,
      key: KEY,
      expectedVersion: version,
      existence: "must_exist",
      buildTarget: (currentText) => ({
        targetMarkdown: applyRawAllowedRoles(currentText, canonicalDeclaration(nextAcl)),
        nextAcl
      }),
      actor: OPERATOR,
      versionOperation: "access_update",
      changeType: "wiki_access_update"
    });

    expect(result.status).toBe("applied");
    expect(result.direction).toBe("widen");
    expect(result.acl).toEqual({ state: "roles", roles: ["ops"] });
    expect(result.operationId).toBeTruthy();
    expect(await readFile(pagePath(), "utf8")).toContain("- ops");

    const store = await getSecurityStore();
    expect(store.ok).toBe(true);
    if (!store.ok) return;
    const record = store.value.getWikiAccessOperation(result.operationId ?? "");
    expect(record.ok).toBe(true);
    if (record.ok) expect(record.value?.state).toBe("committed");
    expect(store.value.isWikiAccessWideningHeld(KEY)).toEqual({ ok: true, value: false });
  });

  it("refuses a stale version and writes nothing", async () => {
    const before = await readFile(pagePath(), "utf8");
    const nextAcl = parseObjectAcl(["ops"], true);

    await expect(
      mutateWikiAccessUnlocked({
        projectRoot,
        key: KEY,
        expectedVersion: "sha256:stale",
        existence: "must_exist",
        buildTarget: (currentText) => ({
          targetMarkdown: applyRawAllowedRoles(currentText, canonicalDeclaration(nextAcl)),
          nextAcl
        }),
        actor: OPERATOR,
        versionOperation: "access_update",
        changeType: "wiki_access_update"
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_write_conflict" });

    expect(await readFile(pagePath(), "utf8")).toBe(before);
    const store = await getSecurityStore();
    expect(store.ok).toBe(true);
    if (!store.ok) return;
    expect(store.value.listWikiAccessOperationsByKey(KEY)).toEqual({ ok: true, value: [] });
  });
});

describe("Spec 193 §6.2 — an authorization-only save touches nothing but the declaration", () => {
  it("preserves the body verbatim and every unknown frontmatter field", async () => {
    const before = await readFile(pagePath(), "utf8");
    const beforeParts = splitFrontmatter(before);
    const version = (await readWiki(projectRoot, KEY)).file_version;

    const preview = await previewWikiAccess(projectRoot, KEY, {
      allowed_roles: ["ops"],
      expected_version: version
    });
    const result = await saveWikiAccess(projectRoot, KEY, {
      allowed_roles: ["ops"],
      expected_version: version,
      preview_digest: preview.preview_digest
    });
    expect(result.status).toBe("applied");

    const after = await readFile(pagePath(), "utf8");
    const afterParts = splitFrontmatter(after);
    expect(afterParts.body).toBe(beforeParts.body);
    expect(after).toContain("owner_team: platform");
    expect(after).toContain("summary: S");
    expect(after).toContain("- ops");
    expect(after).not.toContain("- finance");

    // The change is audited with the trusted actor and the access_update operation.
    const rows = await auditRowsFor("wiki/global/op-page.md");
    expect(rows.length).toBeGreaterThan(0);
    const row = rows.at(-1);
    expect(row?.change_type).toBe("wiki_access_update");
    expect(row?.operation).toBe("access_update");
    expect(row?.write_status).toBe("committed");
  });

  it("a canonical no-op writes no file, creates no version and no audit row", async () => {
    // First perform a REAL change so the baseline is not empty.
    const first = (await readWiki(projectRoot, KEY)).file_version;
    const widening = await previewWikiAccess(projectRoot, KEY, {
      allowed_roles: ["ops"],
      expected_version: first
    });
    await saveWikiAccess(projectRoot, KEY, {
      allowed_roles: ["ops"],
      expected_version: first,
      preview_digest: widening.preview_digest
    });

    const version = (await readWiki(projectRoot, KEY)).file_version;
    const preview = await previewWikiAccess(projectRoot, KEY, {
      allowed_roles: ["ops"],
      expected_version: version
    });
    expect(preview.noop).toBe(true);

    const before = await readFile(pagePath(), "utf8");
    const versionsBefore = await listWikiVersions(projectRoot, KEY);
    const auditBefore = await auditRowsFor("wiki/global/op-page.md");
    expect(auditBefore.length).toBeGreaterThan(0);

    const result = await saveWikiAccess(projectRoot, KEY, {
      allowed_roles: ["ops"],
      expected_version: version,
      preview_digest: preview.preview_digest
    });
    expect(result.status).toBe("noop");
    expect(result.direction).toBe("neutral");

    expect(await readFile(pagePath(), "utf8")).toBe(before);
    const versionsAfter = await listWikiVersions(projectRoot, KEY);
    expect(versionsAfter.versions).toHaveLength(versionsBefore.versions.length);
    expect(await auditRowsFor("wiki/global/op-page.md")).toHaveLength(auditBefore.length);

    // A no-op does not even prepare a durable security operation.
    const store = await getSecurityStore();
    expect(store.ok).toBe(true);
    if (!store.ok) return;
    const operations = store.value.listWikiAccessOperationsByKey(KEY);
    expect(operations.ok).toBe(true);
    if (!operations.ok) return;
    expect(operations.value.every((operation) => operation.state === "committed")).toBe(true);
  });

  it("records the change as an `access_update` version", async () => {
    const version = (await readWiki(projectRoot, KEY)).file_version;
    const preview = await previewWikiAccess(projectRoot, KEY, {
      allowed_roles: ["ops"],
      expected_version: version
    });
    await saveWikiAccess(projectRoot, KEY, {
      allowed_roles: ["ops"],
      expected_version: version,
      preview_digest: preview.preview_digest
    });

    const versions = await listWikiVersions(projectRoot, KEY);
    expect(versions.versions.some((entry) => entry.operation === "access_update")).toBe(true);
  });
});

describe("Spec 193 §8.2 — the startup recovery never ratifies a widening", () => {
  it("a widening whose bytes reached the disk becomes needs_review and stays held", async () => {
    const original = await readFile(pagePath(), "utf8");
    const widened = original.replace("- finance", "- ops");
    await writeFile(pagePath(), widened, "utf8");
    const operationId = await prepareHold(KEY, {
      direction: "widen",
      oldHash: wikiContentHash(original),
      targetHash: wikiContentHash(widened)
    });

    const report = await recoverWikiAccessOperations();
    expect(report.needsReview).toContain(operationId);
    expect(report.committed).not.toContain(operationId);
    expect(report.holdWidening).toBe(true);

    // The operation is NOT committed and the write is NOT replayed.
    const store = await getSecurityStore();
    expect(store.ok).toBe(true);
    if (!store.ok) return;
    const record = store.value.getWikiAccessOperation(operationId);
    expect(record.ok).toBe(true);
    if (!record.ok) return;
    expect(record.value?.state).toBe("needs_review");
    expect(store.value.listWikiAccessOperations("committed")).toEqual({ ok: true, value: [] });

    // The key stays denied.
    expect(await isWikiKeyHeld(KEY)).toBe(true);
    expect(await readFile(pagePath(), "utf8")).toBe(widened);
  });

  it("a pending operation whose bytes are still the old ones is aborted and the hold is released", async () => {
    const original = await readFile(pagePath(), "utf8");
    const operationId = await prepareHold(KEY, {
      direction: "widen",
      oldHash: wikiContentHash(original),
      targetHash: wikiContentHash(`${original}never-written`)
    });

    const report = await recoverWikiAccessOperations();
    expect(report.aborted).toContain(operationId);
    expect(report.needsReview).not.toContain(operationId);

    const store = await getSecurityStore();
    expect(store.ok).toBe(true);
    if (!store.ok) return;
    const record = store.value.getWikiAccessOperation(operationId);
    expect(record.ok).toBe(true);
    if (!record.ok) return;
    expect(record.value?.state).toBe("aborted");
    expect(await isWikiKeyHeld(KEY)).toBe(false);
    expect(await readFile(pagePath(), "utf8")).toBe(original);
  });
});

describe("the declaration helpers keep the raw declaration honest", () => {
  it("reads, canonicalizes and rewrites only `allowed_roles`", () => {
    const markdown = "---\nallowed_roles:\n  - finance\nsummary: S\n---\n# Page\n";
    expect(readAclDeclaration(markdown)).toEqual({ declared: true, value: ["finance"] });
    expect(readAclDeclaration("---\nsummary: S\n---\n# Page\n")).toEqual({ declared: false, value: undefined });
    expect(aclOfMarkdown(markdown)).toEqual({ state: "roles", roles: ["finance"] });

    const rewritten = applyRawAllowedRoles(markdown, canonicalDeclaration(parseObjectAcl(["ops"], true)));
    expect(rewritten).toContain("- ops");
    expect(rewritten).toContain("summary: S");
    expect(rewritten).toContain("# Page");

    // `preserve_current` never turns a missing declaration into an empty one.
    const withoutDeclaration = "---\nsummary: S\n---\n# Page\n";
    expect(applyRawAllowedRoles(withoutDeclaration, { declared: false, value: undefined })).not.toContain(
      "allowed_roles"
    );
  });

  it("refuses an illegal requested role list with CONTEXT_ACL_INVALID", () => {
    expect(normalizeRequestedRoles(["finance", "ops"])).toEqual(["finance", "ops"]);
    expect(normalizeRequestedRoles(["*"])).toEqual(["*"]);
    expect(() => normalizeRequestedRoles(["*", "finance"])).toThrowError(
      expect.objectContaining({ code: "CONTEXT_ACL_INVALID", statusCode: 400 })
    );
  });

  it("resolves the upload selection matrix and suggests a selection", () => {
    const exists = { declared: true, value: ["finance"] };
    const uploaded = { declared: true, value: ["ops"] };
    const absent = { declared: false, value: undefined };

    expect(suggestUploadAccessSelection({ exists: true, uploadedAcl: parseObjectAcl(["ops"], true) })).toEqual({
      mode: "preserve_current"
    });
    expect(suggestUploadAccessSelection({ exists: false, uploadedAcl: parseObjectAcl(["ops"], true) })).toEqual({
      mode: "use_uploaded"
    });

    expect(
      resolveUploadAcl({
        exists: true,
        currentDeclaration: exists,
        uploadedDeclaration: uploaded,
        selection: { mode: "preserve_current" }
      })
    ).toMatchObject({ declaration: exists, acl: { state: "roles", roles: ["finance"] } });

    expect(
      resolveUploadAcl({
        exists: false,
        currentDeclaration: absent,
        uploadedDeclaration: uploaded,
        selection: { mode: "use_uploaded" }
      })
    ).toMatchObject({ acl: { state: "roles", roles: ["ops"] } });

    expect(
      resolveUploadAcl({
        exists: false,
        currentDeclaration: absent,
        uploadedDeclaration: uploaded,
        selection: { mode: "set", allowed_roles: ["auditor"] }
      })
    ).toMatchObject({ acl: { state: "roles", roles: ["auditor"] } });

    expect(() =>
      resolveUploadAcl({
        exists: false,
        currentDeclaration: absent,
        uploadedDeclaration: { declared: true, value: ["*", "finance"] },
        selection: { mode: "use_uploaded" }
      })
    ).toThrowError(expect.objectContaining({ code: "CONTEXT_ACL_INVALID" }));

    expect(() =>
      resolveUploadAcl({
        exists: false,
        currentDeclaration: absent,
        uploadedDeclaration: uploaded,
        selection: { mode: "preserve_current" }
      })
    ).toThrowError(expect.objectContaining({ code: "wiki_upload_access_required" }));
  });

  it("binds the digest to the key, the version, the ACL and the role channel version", () => {
    const base = {
      key: KEY,
      expectedVersion: "sha256:aaa",
      nextAcl: parseObjectAcl(["finance", "ops"], true),
      roleChannelVersion: "rcv-1"
    };
    const digest = computeWikiAccessDigest(base);
    expect(digest).toMatch(/^wac-[0-9a-f]{32}$/);
    expect(computeWikiAccessDigest({ ...base, roleChannelVersion: "rcv-2" })).not.toBe(digest);
    expect(computeWikiAccessDigest({ ...base, expectedVersion: "sha256:bbb" })).not.toBe(digest);
    // The Role ORDER does not change the digest.
    expect(
      computeWikiAccessDigest({ ...base, nextAcl: parseObjectAcl(["ops", "finance"], true) })
    ).toBe(digest);
  });

  it("exposes a stable error type for the API layer", () => {
    const error = new WikiAccessError("wiki_access_change_pending", "held", 409);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("wiki_access_change_pending");
    expect(error.statusCode).toBe(409);
  });
});
