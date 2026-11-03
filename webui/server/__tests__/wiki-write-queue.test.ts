import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAuditDbForTests } from "../admin/audit";
import {
  commitWikiUpload,
  deleteWiki,
  listWikiVersions,
  moveWiki,
  previewWikiDirectoryRename,
  previewWikiUpload,
  readWiki,
  renameWikiDirectory,
  restoreWikiVersion,
  writeWiki
} from "../wiki";
import { isWikiWriteQueueHeld, withWikiWriteQueue } from "../wiki-write-queue";
import { mutateWikiAccessUnlocked } from "../wiki-access-operation";
import { parseObjectAcl } from "../proxy/context-acl";

/**
 * Spec 193 §8.1 / Plan M66 Task 2 — the ONE in-process Wiki write queue.
 *
 * Every assertion below is about real behaviour: the bytes on disk, the
 * version history and the HTTP-level error contract. Synthetic content only.
 */

let projectRoot: string;
let prevRoot: string | undefined;
let prevContent: string | undefined;
let prevAuditDb: string | undefined;

const KEY = "global/queue-page.md";
const pagePath = () => path.join(projectRoot, "wiki", "global", "queue-page.md");

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-wiki-queue-"));
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
  await writeFile(pagePath(), "---\nallowed_roles:\n  - finance\nsummary: S\n---\n# Page\n", "utf8");
});

afterEach(async () => {
  resetAuditDbForTests();
  if (prevAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = prevAuditDb;
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  if (prevContent === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = prevContent;
  await rm(projectRoot, { recursive: true, force: true });
});

/** Fail fast instead of hanging when a write path deadlocks on the queue. */
async function withDeadline<T>(promise: Promise<T>, ms = 4000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("deadlock: the operation did not finish in time")), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe("the shared Wiki write queue serializes the writers", () => {
  it("runs two same-key writers one after the other: the second one loses the version check", async () => {
    const version = (await readWiki(projectRoot, KEY)).file_version;

    const results = await Promise.allSettled([
      writeWiki(projectRoot, KEY, { content: "# A\n", expected_version: version }),
      writeWiki(projectRoot, KEY, { content: "# B\n", expected_version: version })
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      statusCode: 409,
      code: "wiki_write_conflict"
    });

    // Exactly ONE write reached the disk: one baseline version plus exactly
    // one `edit_save` version.
    const stored = await readFile(pagePath(), "utf8");
    expect(["# A\n", "# B\n"].some((body) => stored.endsWith(body))).toBe(true);
    const versions = await listWikiVersions(projectRoot, KEY);
    expect(versions.versions.filter((version) => version.operation === "edit_save")).toHaveLength(1);
  });

  it("lets the second writer use the version the first one produced", async () => {
    const first = (await readWiki(projectRoot, KEY)).file_version;
    await writeWiki(projectRoot, KEY, { content: "# A\n", expected_version: first });
    const second = (await readWiki(projectRoot, KEY)).file_version;
    expect(second).not.toBe(first);

    await writeWiki(projectRoot, KEY, { content: "# B\n", expected_version: second });
    const stored = await readFile(pagePath(), "utf8");
    expect(stored).toContain("# B");
    expect(stored).not.toContain("# A");
  });

  it("does not let a rejected writer poison the queue", async () => {
    await expect(
      writeWiki(projectRoot, KEY, { content: "# Rejected\n", expected_version: "sha256:stale" })
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_write_conflict" });

    const version = (await readWiki(projectRoot, KEY)).file_version;
    await writeWiki(projectRoot, KEY, { content: "# Accepted\n", expected_version: version });
    expect(await readFile(pagePath(), "utf8")).toContain("# Accepted");
  });
});

describe("every write path re-checks the version INSIDE the queue", () => {
  it("writeWiki: 428 without a version, 409 with a stale one, nothing written", async () => {
    const before = await readFile(pagePath(), "utf8");
    await expect(writeWiki(projectRoot, KEY, { content: "# X\n" })).rejects.toMatchObject({
      statusCode: 428,
      code: "wiki_expected_version_required"
    });
    await expect(
      writeWiki(projectRoot, KEY, { content: "# X\n", expected_version: "sha256:stale" })
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_write_conflict" });
    expect(await readFile(pagePath(), "utf8")).toBe(before);
  });

  it("upload commit: 428 without a version, 409 with a stale one, nothing written", async () => {
    const before = await readFile(pagePath(), "utf8");
    const preview = await previewWikiUpload(projectRoot, {
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
        preview_digest: preview.access.preview_digest
      })
    ).rejects.toMatchObject({ statusCode: 428, code: "wiki_expected_version_required" });

    await expect(
      commitWikiUpload(projectRoot, {
        key: KEY,
        markdown: "# Uploaded\n",
        mode: "replace",
        access: { mode: "preserve_current" },
        expected_version: "sha256:stale",
        preview_digest: preview.access.preview_digest
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_write_conflict" });

    expect(await readFile(pagePath(), "utf8")).toBe(before);
  });

  it("version restore: 428 without a version, 409 with a stale one, nothing written", async () => {
    await writeWiki(projectRoot, KEY, { content: "# Page v2\n", expected_version: (await readWiki(projectRoot, KEY)).file_version });
    const versions = await listWikiVersions(projectRoot, KEY);
    const versionId = versions.versions[0]?.versionId ?? "";
    const before = await readFile(pagePath(), "utf8");

    await expect(restoreWikiVersion(projectRoot, KEY, versionId)).rejects.toMatchObject({
      statusCode: 428,
      code: "wiki_expected_version_required"
    });
    await expect(
      restoreWikiVersion(projectRoot, KEY, versionId, undefined, "sha256:stale")
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_write_conflict" });
    expect(await readFile(pagePath(), "utf8")).toBe(before);
  });

  it("move: 428 without a version, 409 with a stale one, nothing moved", async () => {
    const before = await readFile(pagePath(), "utf8");

    await expect(moveWiki(projectRoot, KEY, "moved")).rejects.toMatchObject({
      statusCode: 428,
      code: "wiki_expected_version_required"
    });
    await expect(
      moveWiki(projectRoot, KEY, "moved", undefined, "sha256:stale")
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_write_conflict" });

    expect(await readFile(pagePath(), "utf8")).toBe(before);
    await expect(readFile(path.join(projectRoot, "wiki", "moved", "queue-page.md"), "utf8")).rejects.toThrow();
  });

  it("delete: 428 without a version, 409 with a stale one, nothing deleted", async () => {
    const before = await readFile(pagePath(), "utf8");

    await expect(deleteWiki(projectRoot, KEY)).rejects.toMatchObject({
      statusCode: 428,
      code: "wiki_expected_version_required"
    });
    await expect(
      deleteWiki(projectRoot, KEY, undefined, "sha256:stale")
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_write_conflict" });
    expect(await readFile(pagePath(), "utf8")).toBe(before);
  });
});

describe("the target existence contract is re-checked inside the queue", () => {
  it("a create never silently becomes a replace", async () => {
    const before = await readFile(pagePath(), "utf8");
    const preview = await previewWikiUpload(projectRoot, {
      key: KEY,
      markdown: "# Uploaded\n",
      mode: "create",
      access: { mode: "use_uploaded" }
    });
    await expect(
      commitWikiUpload(projectRoot, {
        key: KEY,
        markdown: "# Uploaded\n",
        mode: "create",
        access: { mode: "use_uploaded" },
        expected_version: preview.currentFileVersion ?? "",
        preview_digest: preview.access.preview_digest
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_write_conflict" });
    expect(await readFile(pagePath(), "utf8")).toBe(before);
  });

  it("a replace never silently becomes a create", async () => {
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/absent.md",
      markdown: "# Uploaded\n",
      mode: "replace",
      access: { mode: "set", allowed_roles: ["finance"] }
    });
    await expect(
      commitWikiUpload(projectRoot, {
        key: "global/absent.md",
        markdown: "# Uploaded\n",
        mode: "replace",
        access: { mode: "set", allowed_roles: ["finance"] },
        preview_digest: preview.access.preview_digest
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_write_conflict" });
    await expect(readFile(path.join(projectRoot, "wiki", "global", "absent.md"), "utf8")).rejects.toThrow();
  });

  it("two concurrent creates of the same key leave one document, not a silent overwrite", async () => {
    const results = await Promise.allSettled([
      writeWiki(projectRoot, "global/race.md", {
        content: "# First\n",
        frontmatter: { allowed_roles: ["finance"] }
      }),
      writeWiki(projectRoot, "global/race.md", {
        content: "# Second\n",
        frontmatter: { allowed_roles: ["finance"] }
      })
    ]);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    // The second create ran AFTER the first one finished, so the target
    // existed by the time it re-checked the state inside the queue: an
    // existing document needs an `expected_version` (428). The upload
    // `mode: "create"` contract answers 409 `wiki_write_conflict` instead —
    // see the "a create never silently becomes a replace" case above.
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      statusCode: 428,
      code: "wiki_expected_version_required"
    });
    const stored = await readFile(path.join(projectRoot, "wiki", "global", "race.md"), "utf8");
    expect(["# First\n", "# Second\n"].some((body) => stored.endsWith(body))).toBe(true);
  });
});

describe("the directory rename re-checks every document baseline plus the source/target state", () => {
  beforeEach(async () => {
    await mkdir(path.join(projectRoot, "wiki", "docs"), { recursive: true });
    await writeFile(path.join(projectRoot, "wiki", "docs", "a.md"), "---\nallowed_roles: [finance]\n---\n# A\n", "utf8");
    await writeFile(path.join(projectRoot, "wiki", "docs", "b.md"), "---\nallowed_roles: [finance]\n---\n# B\n", "utf8");
  });

  it("refuses a stale preview digest and renames nothing", async () => {
    const preview = await previewWikiDirectoryRename(projectRoot, { sourcePath: "docs", newName: "papers" });
    expect(preview.documents.map((doc) => doc.sourceKey)).toEqual(["docs/a.md", "docs/b.md"]);

    await expect(
      renameWikiDirectory(projectRoot, {
        sourcePath: "docs",
        newName: "papers",
        preview_digest: "stale-digest"
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "WIKI_DIRECTORY_CONFLICT" });

    await expect(readFile(path.join(projectRoot, "wiki", "docs", "a.md"), "utf8")).resolves.toContain("# A");
    await expect(readFile(path.join(projectRoot, "wiki", "papers", "a.md"), "utf8")).rejects.toThrow();
  });

  it("refuses a stale per-document baseline and renames nothing", async () => {
    const preview = await previewWikiDirectoryRename(projectRoot, { sourcePath: "docs", newName: "papers" });
    await expect(
      renameWikiDirectory(projectRoot, {
        sourcePath: "docs",
        newName: "papers",
        preview_digest: preview.preview_digest,
        expected_versions: { "docs/a.md": "sha256:stale" }
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "WIKI_DIRECTORY_CONFLICT" });
    await expect(readFile(path.join(projectRoot, "wiki", "docs", "b.md"), "utf8")).resolves.toContain("# B");
    await expect(readFile(path.join(projectRoot, "wiki", "papers", "b.md"), "utf8")).rejects.toThrow();
  });

  it("refuses a source directory that no longer exists and renames nothing", async () => {
    await expect(
      renameWikiDirectory(projectRoot, { sourcePath: "docs", newName: "papers" })
    ).resolves.toMatchObject({ sourcePath: "docs", targetPath: "papers", renamedDocuments: 2 });

    await expect(
      renameWikiDirectory(projectRoot, { sourcePath: "docs", newName: "archive" })
    ).rejects.toMatchObject({ statusCode: 404, code: "WIKI_DIRECTORY_NOT_FOUND" });
  });

  it("refuses a target directory that already exists", async () => {
    await mkdir(path.join(projectRoot, "wiki", "papers"), { recursive: true });
    await expect(
      renameWikiDirectory(projectRoot, { sourcePath: "docs", newName: "papers" })
    ).rejects.toMatchObject({ statusCode: 409, code: "WIKI_DIRECTORY_CONFLICT" });
    await expect(readFile(path.join(projectRoot, "wiki", "docs", "a.md"), "utf8")).resolves.toContain("# A");
  });
});

describe("a composite operation never re-acquires the queue", () => {
  it("the unlocked mutation helper does not take the queue by itself", async () => {
    let heldInsideHelper: boolean | null = null;
    const result = await withDeadline(
      mutateWikiAccessUnlocked({
        projectRoot,
        key: KEY,
        expectedVersion: (await readWiki(projectRoot, KEY)).file_version,
        existence: "must_exist",
        buildTarget: (currentText) => {
          heldInsideHelper = isWikiWriteQueueHeld();
          const nextAcl = parseObjectAcl(["ops"], true);
          return {
            targetMarkdown: currentText.replace("  - finance", "  - ops"),
            nextAcl
          };
        },
        actor: {
          actorId: "tester",
          actorType: "system",
          accountUid: null,
          role: null,
          authMode: "system",
          sessionId: null,
          requestId: null,
          actorIp: null
        },
        versionOperation: "access_update",
        changeType: "wiki_access_update"
      })
    );

    expect(result.status).toBe("applied");
    // The helper was called directly: it did NOT acquire the queue itself.
    expect(heldInsideHelper).toBe(false);
    expect(await readFile(pagePath(), "utf8")).toContain("- ops");
  });

  it("a composite upload that routes through the unlocked helper does not deadlock", async () => {
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/composite.md",
      markdown: "---\nallowed_roles: [finance]\n---\n# Composite\n",
      mode: "create",
      access: { mode: "use_uploaded" }
    });

    const committed = await withDeadline(
      commitWikiUpload(projectRoot, {
        key: "global/composite.md",
        markdown: "---\nallowed_roles: [finance]\n---\n# Composite\n",
        mode: "create",
        access: { mode: "use_uploaded" },
        preview_digest: preview.access.preview_digest
      })
    );

    expect(committed.access.final_acl).toEqual({ state: "roles", roles: ["finance"] });
    expect(await readFile(path.join(projectRoot, "wiki", "global", "composite.md"), "utf8")).toContain("# Composite");
  });

  it("the queue depth is observable and returns to zero after a failure", async () => {
    expect(isWikiWriteQueueHeld()).toBe(false);
    await withDeadline(
      withWikiWriteQueue(async () => {
        expect(isWikiWriteQueueHeld()).toBe(true);
        throw new Error("boom");
      }).catch(() => undefined)
    );
    expect(isWikiWriteQueueHeld()).toBe(false);
  });
});
