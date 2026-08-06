import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  createWikiDirectory,
  createWikiVersionSnapshot,
  commitWikiUpload,
  listWikiDirectories,
  listWiki,
  listWikiVersions,
  moveWiki,
  normalizeWikiDirectoryPath,
  previewWikiMove,
  previewWikiUpload,
  previewWikiVersionRestore,
  previewWikiWrite,
  readWiki,
  readWikiVersion,
  restoreWikiVersion,
  writeWiki
} from "../wiki";
import { ForbiddenPathError, safeMkdir, safeRemove } from "../fs-safe";
import { buildServer } from "../index";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-wiki-"));
  await mkdir(path.join(projectRoot, "wiki", "global"), { recursive: true });
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("wiki editor storage", () => {
  it("round-trips frontmatter and markdown", async () => {
    await writeFile(
      path.join(projectRoot, "wiki", "global", "revenue.md"),
      "---\nsummary: Revenue note\ntags:\n  - finance\nsl_refs:\n  - mysql/schema/table\n---\n# Revenue\n",
      "utf8"
    );

    const page = await readWiki(projectRoot, "global/revenue.md");
    expect(page.frontmatter.summary).toBe("Revenue note");
    expect(page.frontmatter.tags).toEqual(["finance"]);
    expect(page.frontmatter.sl_refs).toEqual(["mysql/schema/table"]);
    expect(page.content).toContain("# Revenue");
  });

  it("previews without writing, then writes only under wiki", async () => {
    const preview = await previewWikiWrite(projectRoot, "global/new.md", {
      frontmatter: { summary: "New note", tags: ["ops"], sl_refs: ["mysql/schema/source"] },
      content: "# New\n"
    });

    expect(preview.diff).toContain("+summary: New note");
    await expect(readFile(path.join(projectRoot, "wiki", "global", "new.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    await writeWiki(projectRoot, "global/new.md", {
      frontmatter: { summary: "New note", tags: ["ops"], sl_refs: ["mysql/schema/source"] },
      content: "# New\n"
    });
    await expect(readFile(path.join(projectRoot, "wiki", "global", "new.md"), "utf8")).resolves.toContain("# New");
  });

  it("lists markdown pages and rejects unsafe keys", async () => {
    await writeWiki(projectRoot, "global/a.md", { content: "A\n" });
    await expect(listWiki(projectRoot)).resolves.toEqual([
      { key: "global/a.md", summary: undefined, tags: [], slRefs: [] }
    ]);
    await expect(previewWikiWrite(projectRoot, "../raw-sources/a.md", { content: "bad" })).rejects.toBeInstanceOf(ForbiddenPathError);
    await expect(previewWikiWrite(projectRoot, "/tmp/a.md", { content: "bad" })).rejects.toBeInstanceOf(ForbiddenPathError);
  });

  it("previews uploaded markdown without writing, then commits through the wiki allowlist", async () => {
    const markdown = "---\nsummary: Uploaded\nsl_refs:\n  - mysql/schema/table\n---\n# Uploaded\n";
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/uploaded.md",
      markdown
    });

    expect(preview.filePath).toBe("wiki/global/uploaded.md");
    expect(preview.exists).toBe(false);
    expect(preview.title).toBe("Uploaded");
    expect(preview.slRefs).toEqual(["mysql/schema/table"]);
    expect(preview.diff).toContain("+summary: Uploaded");
    await expect(readFile(path.join(projectRoot, "wiki", "global", "uploaded.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    await commitWikiUpload(projectRoot, {
      key: "global/uploaded.md",
      markdown
    });
    await expect(readFile(path.join(projectRoot, "wiki", "global", "uploaded.md"), "utf8")).resolves.toBe(markdown);
  });

  it("rejects unsafe upload keys and non-markdown targets", async () => {
    await expect(
      previewWikiUpload(projectRoot, {
        key: "../raw-sources/leak.md",
        markdown: "# Bad\n"
      })
    ).rejects.toBeInstanceOf(ForbiddenPathError);
    await expect(
      previewWikiUpload(projectRoot, {
        key: "global/not-markdown.txt",
        markdown: "# Bad\n"
      })
    ).rejects.toBeInstanceOf(ForbiddenPathError);
  });

  it("normalizes wiki directory paths and rejects unsafe directory segments", () => {
    expect(normalizeWikiDirectoryPath("ops/playbooks")).toBe("ops/playbooks");
    expect(() => normalizeWikiDirectoryPath("../x")).toThrow("目录路径不合法");
    expect(() => normalizeWikiDirectoryPath("/tmp/x")).toThrow("目录路径不合法");
    expect(() => normalizeWikiDirectoryPath("ops/../x")).toThrow("目录路径不合法");
    expect(() => normalizeWikiDirectoryPath(".hidden")).toThrow("目录路径不合法");
    expect(() => normalizeWikiDirectoryPath("ops/.hidden")).toThrow("目录路径不合法");
  });

  it("safeMkdir rejects symlink parent escape through the wiki allowlist", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-wiki-outside-"));
    await symlink(outside, path.join(projectRoot, "wiki", "linked"));
    await expect(safeMkdir(projectRoot, "wiki/linked/escape")).rejects.toBeInstanceOf(ForbiddenPathError);
    await rm(outside, { recursive: true, force: true });
  });

  it("safeRemove rejects symlink removal through the wiki allowlist", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-wiki-outside-"));
    await symlink(path.join(outside, "snapshot.md"), path.join(projectRoot, "wiki", "linked.md"));
    await expect(safeRemove(projectRoot, "wiki/linked.md")).rejects.toBeInstanceOf(ForbiddenPathError);
    await rm(outside, { recursive: true, force: true });
  });

  it("creates empty wiki directories and persists metadata without creating pages", async () => {
    const created = await createWikiDirectory(projectRoot, { path: "ops" });
    expect(created.created).toBe(true);
    expect(created.directory).toMatchObject({
      path: "ops",
      documentCount: 0,
      explicit: true,
      empty: true
    });

    const metadata = await readFile(path.join(projectRoot, "wiki", ".lucy-directories.json"), "utf8");
    expect(metadata).toContain("\"path\": \"ops\"");
    await expect(listWiki(projectRoot)).resolves.toEqual([]);
    await expect(listWikiDirectories(projectRoot)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "ops", documentCount: 0, explicit: true, empty: true })
      ])
    );
  });

  it("treats repeated directory creation as idempotent and includes ancestors", async () => {
    await createWikiDirectory(projectRoot, { path: "ops/playbooks" });
    const repeated = await createWikiDirectory(projectRoot, { parent: "ops", name: "playbooks" });
    expect(repeated.created).toBe(false);

    const directories = await listWikiDirectories(projectRoot);
    expect(directories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "ops", explicit: true, empty: true }),
        expect.objectContaining({ path: "ops/playbooks", explicit: true, empty: true })
      ])
    );
    const metadata = JSON.parse(await readFile(path.join(projectRoot, "wiki", ".lucy-directories.json"), "utf8"));
    expect(metadata.directories.filter((item: { path: string }) => item.path === "ops/playbooks")).toHaveLength(1);
  });

  it("merges explicit directories with markdown-derived directories and counts subtree documents", async () => {
    await createWikiDirectory(projectRoot, { path: "ops" });
    await writeWiki(projectRoot, "ops/playbooks/demo.md", { content: "# Demo\n" });

    const directories = await listWikiDirectories(projectRoot);
    expect(directories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "ops", documentCount: 1, explicit: true, empty: false }),
        expect.objectContaining({ path: "ops/playbooks", documentCount: 1, explicit: false, empty: false })
      ])
    );
  });

  it("exposes empty directory creation through the wiki API route", async () => {
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    const previousProjectRoot = process.env.KTX_PROJECT_ROOT;
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const app = buildServer();
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/wiki/directories",
        payload: { parent: "ops", name: "playbooks" }
      });
      expect(created.statusCode).toBe(200);
      expect(created.json()).toMatchObject({
        ok: true,
        data: {
          created: true,
          directory: {
            path: "ops/playbooks",
            documentCount: 0,
            explicit: true,
            empty: true
          }
        }
      });

      const listed = await app.inject({ method: "GET", url: "/api/wiki" });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().data.directories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "ops", documentCount: 0, explicit: true, empty: true }),
          expect.objectContaining({ path: "ops/playbooks", documentCount: 0, explicit: true, empty: true })
        ])
      );
    } finally {
      await app.close();
      if (previousProjectRoot === undefined) {
        delete process.env.KTX_PROJECT_ROOT;
      } else {
        process.env.KTX_PROJECT_ROOT = previousProjectRoot;
      }
    }
  });

  it("creates a top-level directory via { path } and { parent: '', name } (M56 UX-WIKI-008)", async () => {
    const createdByPath = await createWikiDirectory(projectRoot, { path: "ops-top" });
    expect(createdByPath.created).toBe(true);
    expect(createdByPath.directory.path).toBe("ops-top");
    expect(createdByPath.filePath).toBe("wiki/ops-top/");

    const createdByParentName = await createWikiDirectory(projectRoot, {
      parent: "",
      name: "ops-top-2"
    });
    expect(createdByParentName.created).toBe(true);
    expect(createdByParentName.directory.path).toBe("ops-top-2");
    expect(createdByParentName.filePath).toBe("wiki/ops-top-2/");

    // The top-level directories are siblings of `global`, not children
    // of an implicit `global` parent. We assert the absence of any
    // `global/ops-top` style nesting here.
    const directories = await listWikiDirectories(projectRoot);
    const paths = directories.map((item) => item.path);
    expect(paths).toEqual(expect.arrayContaining(["ops-top", "ops-top-2"]));
    expect(paths.filter((item) => item === "global/ops-top")).toEqual([]);
    expect(paths.filter((item) => item === "global/ops-top-2")).toEqual([]);

    const metadata = JSON.parse(
      await readFile(path.join(projectRoot, "wiki", ".lucy-directories.json"), "utf8")
    );
    const persisted = (metadata.directories as Array<{ path: string }>).map((entry) => entry.path);
    expect(persisted).toEqual(expect.arrayContaining(["ops-top", "ops-top-2"]));
  });

  it("creates a top-level directory through the wiki API route (M56 UX-WIKI-008)", async () => {
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    const previousProjectRoot = process.env.KTX_PROJECT_ROOT;
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const app = buildServer();
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/wiki/directories",
        payload: { parent: "", name: "browser-top" }
      });
      expect(created.statusCode).toBe(200);
      const body = created.json();
      expect(body).toMatchObject({
        ok: true,
        data: {
          created: true,
          directory: { path: "browser-top", empty: true, explicit: true },
          filePath: "wiki/browser-top/"
        }
      });
    } finally {
      await app.close();
      if (previousProjectRoot === undefined) {
        delete process.env.KTX_PROJECT_ROOT;
      } else {
        process.env.KTX_PROJECT_ROOT = previousProjectRoot;
      }
    }
  });

  it("deletes empty directories and removes them from metadata (M56 UX-WIKI-010)", async () => {
    const { deleteWikiDirectory } = await import("../wiki");
    await createWikiDirectory(projectRoot, { path: "ops-empty" });

    const result = await deleteWikiDirectory(projectRoot, "ops-empty");
    expect(result).toEqual({
      path: "ops-empty",
      deleted: true,
      filePath: "wiki/ops-empty/"
    });
    await expect(stat(path.join(projectRoot, "wiki", "ops-empty"))).rejects.toMatchObject({
      code: "ENOENT"
    });

    const metadata = JSON.parse(
      await readFile(path.join(projectRoot, "wiki", ".lucy-directories.json"), "utf8")
    );
    const persisted = (metadata.directories as Array<{ path: string }>).map((entry) => entry.path);
    expect(persisted).not.toContain("ops-empty");
  });

  it("rejects deleting a non-empty directory with WIKI_DIRECTORY_NOT_EMPTY (M56 UX-WIKI-010)", async () => {
    const { deleteWikiDirectory, WikiDirectoryError } = await import("../wiki");
    await writeWiki(projectRoot, "ops-stay/note.md", { content: "# Note\n" });
    await expect(deleteWikiDirectory(projectRoot, "ops-stay")).rejects.toBeInstanceOf(WikiDirectoryError);
    await expect(deleteWikiDirectory(projectRoot, "ops-stay")).rejects.toMatchObject({
      code: "WIKI_DIRECTORY_NOT_EMPTY"
    });
    await expect(readFile(path.join(projectRoot, "wiki", "ops-stay", "note.md"), "utf8")).resolves.toContain(
      "# Note"
    );
  });

  it("rejects deleting a symlink target and traversal paths (M56 UX-WIKI-010)", async () => {
    const { deleteWikiDirectory, WikiDirectoryError } = await import("../wiki");
    const outside = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-wiki-outside-rm-"));
    await symlink(outside, path.join(projectRoot, "wiki", "linked-rm"));
    await expect(deleteWikiDirectory(projectRoot, "linked-rm")).rejects.toMatchObject({
      code: "FORBIDDEN_PATH"
    });
    // Path traversal is caught by the directory path normalizer before
    // it ever reaches the filesystem helper.
    await expect(
      deleteWikiDirectory(projectRoot, "../raw-sources")
    ).rejects.toBeInstanceOf(WikiDirectoryError);
    await expect(
      deleteWikiDirectory(projectRoot, "../raw-sources")
    ).rejects.toMatchObject({ code: "WIKI_DIRECTORY_INVALID" });
    await rm(outside, { recursive: true, force: true });
  });

  it("deletes a Markdown document and clears its version history (Spec 118 UX-WIKI-045)", async () => {
    const { deleteWiki, WikiNotFoundError } = await import("../wiki");
    await writeWiki(projectRoot, "global/to-delete.md", { content: "# Delete me\n" });
    await createWikiVersionSnapshot(projectRoot, "global/to-delete.md", "# Delete me\n", {
      operation: "edit_save",
      force: true
    });
    const before = await listWikiVersions(projectRoot, "global/to-delete.md");
    expect(before.versions.length).toBeGreaterThan(0);

    const result = await deleteWiki(projectRoot, "global/to-delete.md");
    expect(result).toEqual({
      key: "global/to-delete.md",
      deleted: true,
      filePath: "wiki/global/to-delete.md"
    });
    await expect(
      stat(path.join(projectRoot, "wiki", "global", "to-delete.md"))
    ).rejects.toMatchObject({ code: "ENOENT" });
    const after = await listWikiVersions(projectRoot, "global/to-delete.md");
    expect(after.versions).toEqual([]);
    await expect(deleteWiki(projectRoot, "global/to-delete.md")).rejects.toBeInstanceOf(
      WikiNotFoundError
    );
  });

  it("deletes a Markdown document through the wiki API route (Spec 118)", async () => {
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    await writeWiki(projectRoot, "global/api-delete-doc.md", { content: "# API Delete\n" });
    const previousProjectRoot = process.env.KTX_PROJECT_ROOT;
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const app = buildServer();
    try {
      const deleted = await app.inject({
        method: "DELETE",
        url: "/api/wiki/global%2Fapi-delete-doc.md"
      });
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json()).toMatchObject({
        ok: true,
        data: {
          key: "global/api-delete-doc.md",
          deleted: true,
          filePath: "wiki/global/api-delete-doc.md"
        }
      });
      const missing = await app.inject({
        method: "DELETE",
        url: "/api/wiki/global%2Fapi-delete-doc.md"
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({
        ok: false,
        error: { code: "WIKI_NOT_FOUND" }
      });
    } finally {
      await app.close();
      if (previousProjectRoot === undefined) {
        delete process.env.KTX_PROJECT_ROOT;
      } else {
        process.env.KTX_PROJECT_ROOT = previousProjectRoot;
      }
    }
  });

  it("exposes directory deletion through the wiki API route (M56 UX-WIKI-010)", async () => {
    const { createWikiDirectory } = await import("../wiki");
    await createWikiDirectory(projectRoot, { path: "api-delete" });
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    const previousProjectRoot = process.env.KTX_PROJECT_ROOT;
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const app = buildServer();
    try {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/wiki/directories/api-delete"
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        data: {
          path: "api-delete",
          deleted: true,
          filePath: "wiki/api-delete/"
        }
      });

      const listed = await app.inject({ method: "GET", url: "/api/wiki" });
      expect(listed.statusCode).toBe(200);
      const dirs = listed.json().data.directories as Array<{ path: string }>;
      expect(dirs.map((item) => item.path)).not.toContain("api-delete");
    } finally {
      await app.close();
      if (previousProjectRoot === undefined) {
        delete process.env.KTX_PROJECT_ROOT;
      } else {
        process.env.KTX_PROJECT_ROOT = previousProjectRoot;
      }
    }
  });

  it("renames an empty directory and rewrites metadata (Spec 109)", async () => {
    const { previewWikiDirectoryRename, renameWikiDirectory } = await import("../wiki");
    await createWikiDirectory(projectRoot, { path: "ops-empty" });

    await expect(
      previewWikiDirectoryRename(projectRoot, { sourcePath: "ops-empty", newName: "ops-empty" })
    ).rejects.toMatchObject({ code: "WIKI_DIRECTORY_INVALID" });

    await expect(
      previewWikiDirectoryRename(projectRoot, { sourcePath: "", newName: "x" })
    ).rejects.toMatchObject({ code: "WIKI_DIRECTORY_RENAME_ROOT" });

    const preview = await previewWikiDirectoryRename(projectRoot, {
      sourcePath: "ops-empty",
      newName: "ops-renamed"
    });
    expect(preview).toMatchObject({
      sourcePath: "ops-empty",
      targetPath: "ops-renamed",
      documentCount: 0,
      directoryCount: 1,
      conflicts: []
    });

    const result = await renameWikiDirectory(projectRoot, {
      sourcePath: "ops-empty",
      newName: "ops-renamed"
    });
    expect(result).toMatchObject({
      sourcePath: "ops-empty",
      targetPath: "ops-renamed",
      renamedDocuments: 0,
      renamedDirectories: 1
    });
    await expect(stat(path.join(projectRoot, "wiki", "ops-renamed"))).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });
    await expect(stat(path.join(projectRoot, "wiki", "ops-empty"))).rejects.toMatchObject({
      code: "ENOENT"
    });
    const directories = await listWikiDirectories(projectRoot);
    expect(directories.map((item) => item.path)).toContain("ops-renamed");
    expect(directories.map((item) => item.path)).not.toContain("ops-empty");
  });

  it("renames a directory tree with documents and carries version history (Spec 109)", async () => {
    const { previewWikiDirectoryRename, renameWikiDirectory } = await import("../wiki");
    await createWikiDirectory(projectRoot, { path: "team/drafts" });
    await writeWiki(projectRoot, "team/drafts/note.md", {
      frontmatter: { summary: "Draft note" },
      content: "# Draft\n"
    });
    await createWikiVersionSnapshot(projectRoot, "team/drafts/note.md", "# Draft\n", {
      operation: "create"
    });

    const preview = await previewWikiDirectoryRename(projectRoot, {
      sourcePath: "team",
      newName: "squad"
    });
    expect(preview.documentCount).toBe(1);
    expect(preview.directoryCount).toBeGreaterThanOrEqual(2);
    expect(preview.documents[0]).toEqual({
      sourceKey: "team/drafts/note.md",
      targetKey: "squad/drafts/note.md"
    });

    await createWikiDirectory(projectRoot, { path: "squad" });
    const conflictPreview = await previewWikiDirectoryRename(projectRoot, {
      sourcePath: "team",
      newName: "squad"
    });
    expect(conflictPreview.conflicts.length).toBeGreaterThan(0);
    await expect(
      renameWikiDirectory(projectRoot, { sourcePath: "team", newName: "squad" })
    ).rejects.toMatchObject({ code: "WIKI_DIRECTORY_CONFLICT" });

    // Remove the conflicting empty target so rename can proceed.
    const { deleteWikiDirectory } = await import("../wiki");
    await deleteWikiDirectory(projectRoot, "squad");

    const result = await renameWikiDirectory(projectRoot, {
      sourcePath: "team",
      newName: "squad"
    });
    expect(result.renamedDocuments).toBe(1);
    await expect(
      readFile(path.join(projectRoot, "wiki", "squad", "drafts", "note.md"), "utf8")
    ).resolves.toContain("# Draft");
    await expect(listWiki(projectRoot)).resolves.toEqual([
      expect.objectContaining({ key: "squad/drafts/note.md", summary: "Draft note" })
    ]);

    const versions = await listWikiVersions(projectRoot, "squad/drafts/note.md");
    expect(versions.versions.some((item) => item.operation === "move")).toBe(true);
    expect(versions.versions.some((item) => item.previousKey === "team/drafts/note.md")).toBe(true);
  });

  it("exposes directory rename through the wiki API routes (Spec 109)", async () => {
    await createWikiDirectory(projectRoot, { path: "api-rename" });
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    const previousProjectRoot = process.env.KTX_PROJECT_ROOT;
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const app = buildServer();
    try {
      const preview = await app.inject({
        method: "POST",
        url: "/api/wiki/directories/rename/preview",
        payload: { sourcePath: "api-rename", newName: "api-renamed" }
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.json().data.targetPath).toBe("api-renamed");

      const renamed = await app.inject({
        method: "POST",
        url: "/api/wiki/directories/rename",
        payload: { sourcePath: "api-rename", newName: "api-renamed" }
      });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json()).toMatchObject({
        ok: true,
        data: {
          sourcePath: "api-rename",
          targetPath: "api-renamed",
          renamedDirectories: 1
        }
      });
    } finally {
      await app.close();
      if (previousProjectRoot === undefined) {
        delete process.env.KTX_PROJECT_ROOT;
      } else {
        process.env.KTX_PROJECT_ROOT = previousProjectRoot;
      }
    }
  });

  it("creates version snapshots and keeps history files out of wiki pages", async () => {
    await createWikiVersionSnapshot(projectRoot, "global/history.md", "# V1\n", {
      operation: "create"
    });

    const history = JSON.parse(await readFile(path.join(projectRoot, "wiki", ".lucy-history", "index.json"), "utf8"));
    expect(history.documents["global/history.md"].versions).toHaveLength(1);
    await expect(listWiki(projectRoot)).resolves.toEqual([]);
  });

  it("keeps only the latest five wiki versions", async () => {
    for (let index = 1; index <= 6; index += 1) {
      await createWikiVersionSnapshot(projectRoot, "global/retained.md", `# V${index}\n`, {
        operation: index === 1 ? "create" : "edit_save"
      });
    }

    const versions = await listWikiVersions(projectRoot, "global/retained.md");
    expect(versions.retentionLimit).toBe(5);
    expect(versions.versions).toHaveLength(5);
    expect(versions.versions.map((item) => item.title)).toEqual([
      "V6",
      "V5",
      "V4",
      "V3",
      "V2"
    ]);
  });

  it("derives pruned snapshot paths instead of trusting stored history metadata", async () => {
    await writeFile(path.join(projectRoot, "wiki", "global", "protected.md"), "# Protected\n", "utf8");
    for (let index = 1; index <= 5; index += 1) {
      await createWikiVersionSnapshot(projectRoot, "global/tampered.md", `# V${index}\n`, {
        operation: index === 1 ? "create" : "edit_save"
      });
    }

    const indexPath = path.join(projectRoot, "wiki", ".lucy-history", "index.json");
    const history = JSON.parse(await readFile(indexPath, "utf8"));
    history.documents["global/tampered.md"].versions[0].snapshotPath = "wiki/global/protected.md";
    await writeFile(indexPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");

    await createWikiVersionSnapshot(projectRoot, "global/tampered.md", "# V6\n", {
      operation: "edit_save"
    });

    await expect(readFile(path.join(projectRoot, "wiki", "global", "protected.md"), "utf8")).resolves.toBe("# Protected\n");
    const versions = await listWikiVersions(projectRoot, "global/tampered.md");
    expect(versions.versions.map((item) => item.title)).toEqual([
      "V6",
      "V5",
      "V4",
      "V3",
      "V2"
    ]);
  });

  it("generates create, edit, upload and restore versions", async () => {
    await writeWiki(projectRoot, "global/versioned.md", { content: "# First\n" });
    await writeWiki(projectRoot, "global/versioned.md", { content: "# Second\n" });
    await writeWiki(projectRoot, "global/versioned.md", { content: "# Second\n" });
    await commitWikiUpload(projectRoot, {
      key: "global/versioned.md",
      markdown: "# Uploaded\n",
      overwrite: true,
      sourceFileName: "uploaded.md"
    });

    let versions = await listWikiVersions(projectRoot, "global/versioned.md");
    expect(versions.versions.map((item) => item.operation)).toEqual([
      "upload_replace",
      "edit_save",
      "create"
    ]);
    expect(versions.versions[0]).toMatchObject({
      title: "Uploaded",
      sourceFileName: "uploaded.md"
    });

    const createVersion = versions.versions.find((item) => item.operation === "create");
    expect(createVersion).toBeTruthy();
    const detail = await readWikiVersion(projectRoot, "global/versioned.md", createVersion?.versionId ?? "");
    expect(detail.rawMarkdown).toContain("# First");
    expect(detail.diffFromCurrent).toContain("Uploaded");

    const preview = await previewWikiVersionRestore(projectRoot, "global/versioned.md", createVersion?.versionId ?? "");
    expect(preview.targetTitle).toBe("First");
    await expect(readFile(path.join(projectRoot, "wiki", "global", "versioned.md"), "utf8")).resolves.toContain("# Uploaded");

    const restored = await restoreWikiVersion(projectRoot, "global/versioned.md", createVersion?.versionId ?? "");
    expect(restored.restoredFromVersionId).toBe(createVersion?.versionId);
    await expect(readFile(path.join(projectRoot, "wiki", "global", "versioned.md"), "utf8")).resolves.toContain("# First");
    versions = await listWikiVersions(projectRoot, "global/versioned.md");
    expect(versions.versions[0]).toMatchObject({
      operation: "restore",
      restoredFromVersionId: createVersion?.versionId
    });
  });

  it("exposes wiki version history through API routes", async () => {
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    const previousProjectRoot = process.env.KTX_PROJECT_ROOT;
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const app = buildServer();
    try {
      const saved = await app.inject({
        method: "PUT",
        url: "/api/wiki/global%2Fapi-versioned.md",
        payload: { dryRun: false, content: "# API First\n" }
      });
      expect(saved.statusCode).toBe(200);
      const upload = await app.inject({
        method: "POST",
        url: "/api/wiki/upload/commit",
        payload: {
          key: "global/api-versioned.md",
          markdown: "# API Uploaded\n",
          overwrite: true,
          sourceFileName: "api-uploaded.md"
        }
      });
      expect(upload.statusCode).toBe(200);

      const listed = await app.inject({
        method: "GET",
        url: "/api/wiki/global%2Fapi-versioned.md/versions"
      });
      expect(listed.statusCode).toBe(200);
      const versions = listed.json().data.versions;
      expect(versions[0]).toMatchObject({
        operation: "upload_replace",
        sourceFileName: "api-uploaded.md"
      });
      const createVersion = versions.find((item: { operation: string }) => item.operation === "create");
      const detail = await app.inject({
        method: "GET",
        url: `/api/wiki/global%2Fapi-versioned.md/versions/${createVersion.versionId}`
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.rawMarkdown).toContain("# API First");

      const restorePreview = await app.inject({
        method: "POST",
        url: `/api/wiki/global%2Fapi-versioned.md/versions/${createVersion.versionId}/restore/preview`
      });
      expect(restorePreview.statusCode).toBe(200);
      expect(restorePreview.json().data.targetTitle).toBe("API First");
      await expect(readFile(path.join(projectRoot, "wiki", "global", "api-versioned.md"), "utf8")).resolves.toContain("# API Uploaded");

      const restored = await app.inject({
        method: "POST",
        url: `/api/wiki/global%2Fapi-versioned.md/versions/${createVersion.versionId}/restore`
      });
      expect(restored.statusCode).toBe(200);
      await expect(readFile(path.join(projectRoot, "wiki", "global", "api-versioned.md"), "utf8")).resolves.toContain("# API First");
    } finally {
      await app.close();
      if (previousProjectRoot === undefined) {
        delete process.env.KTX_PROJECT_ROOT;
      } else {
        process.env.KTX_PROJECT_ROOT = previousProjectRoot;
      }
    }
  });
});

describe("wiki document move (M56 UX-WIKI-011)", () => {
  it("previews a move without touching the filesystem", async () => {
    await writeWiki(projectRoot, "global/source-note.md", {
      frontmatter: { summary: "Source" },
      content: "# Source\n"
    });

    const preview = await previewWikiMove(projectRoot, "global/source-note.md", "ops/playbooks");
    expect(preview.sourceKey).toBe("global/source-note.md");
    expect(preview.targetKey).toBe("ops/playbooks/source-note.md");
    expect(preview.targetDirectory).toBe("ops/playbooks");
    expect(preview.exists).toBe(false);
    expect(preview.title).toBe("Source");
    expect(preview.basenameChanged).toBe(false);
    expect(preview.proposedMarkdown).toContain("# Source");

    await expect(stat(path.join(projectRoot, "wiki", "ops"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("moves the markdown file, re-keys the version history, and records a move version", async () => {
    await writeWiki(projectRoot, "global/cross-team-note.md", {
      frontmatter: { summary: "Cross team" },
      content: "# Cross team\n"
    });
    // Edit save so we have at least one baseline snapshot under the old key.
    await writeWiki(projectRoot, "global/cross-team-note.md", {
      frontmatter: { summary: "Cross team v2" },
      content: "# Cross team v2\n"
    });

    const result = await moveWiki(projectRoot, "global/cross-team-note.md", "ops/playbooks");
    expect(result.key).toBe("ops/playbooks/cross-team-note.md");
    expect(result.previousKey).toBe("global/cross-team-note.md");

    await expect(stat(path.join(projectRoot, "wiki", "global", "cross-team-note.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(projectRoot, "wiki", "ops", "playbooks", "cross-team-note.md"), "utf8")).resolves.toContain(
      "# Cross team v2"
    );

    // The target directory must exist on disk for future uploads.
    const directoryInfo = await stat(path.join(projectRoot, "wiki", "ops", "playbooks"));
    expect(directoryInfo.isDirectory()).toBe(true);

    // Versions are now keyed under the new path, with the latest entry
    // marking the move and pointing back to the previous key.
    const versions = await listWikiVersions(projectRoot, "ops/playbooks/cross-team-note.md");
    expect(versions.versions[0]).toMatchObject({
      operation: "move",
      previousKey: "global/cross-team-note.md"
    });
    expect(versions.versions.some((entry) => entry.operation === "edit_save")).toBe(true);

    // Reading under the old key returns no history (we deliberately
    // migrate rather than copy so the UI never re-renders the stale
    // path).
    const oldVersions = await listWikiVersions(projectRoot, "global/cross-team-note.md");
    expect(oldVersions.versions).toEqual([]);
  });

  it("rejects moving into a key that already exists with WIKI_MOVE_TARGET_EXISTS", async () => {
    await writeWiki(projectRoot, "global/collide.md", { content: "# Source\n" });
    await writeWiki(projectRoot, "ops/collide.md", { content: "# Target\n" });

    await expect(
      moveWiki(projectRoot, "global/collide.md", "ops")
    ).rejects.toMatchObject({ code: "WIKI_MOVE_TARGET_EXISTS" });
    await expect(readFile(path.join(projectRoot, "wiki", "global", "collide.md"), "utf8")).resolves.toContain(
      "# Source"
    );
  });

  it("rejects moving an unknown source with WIKI_NOT_FOUND", async () => {
    await expect(
      moveWiki(projectRoot, "global/missing.md", "ops")
    ).rejects.toMatchObject({ code: "WIKI_NOT_FOUND" });
  });

  it("exposes move preview and commit through the wiki API routes", async () => {
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    await writeWiki(projectRoot, "global/api-move.md", { content: "# API Move\n" });
    const previousProjectRoot = process.env.KTX_PROJECT_ROOT;
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const app = buildServer();
    try {
      const preview = await app.inject({
        method: "POST",
        url: "/api/wiki/global%2Fapi-move.md/move/preview",
        payload: { targetDirectory: "ops" }
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.json().data).toMatchObject({
        sourceKey: "global/api-move.md",
        targetKey: "ops/api-move.md",
        targetDirectory: "ops",
        exists: false
      });

      const committed = await app.inject({
        method: "POST",
        url: "/api/wiki/global%2Fapi-move.md/move",
        payload: { targetDirectory: "ops" }
      });
      expect(committed.statusCode).toBe(200);
      expect(committed.json().data).toMatchObject({
        key: "ops/api-move.md",
        previousKey: "global/api-move.md",
        targetDirectory: "ops"
      });
      await expect(readFile(path.join(projectRoot, "wiki", "ops", "api-move.md"), "utf8")).resolves.toContain(
        "# API Move"
      );
    } finally {
      await app.close();
      if (previousProjectRoot === undefined) {
        delete process.env.KTX_PROJECT_ROOT;
      } else {
        process.env.KTX_PROJECT_ROOT = previousProjectRoot;
      }
    }
  });
});

describe("wiki upload preflight enrichment (M56 UX-WIKI-013)", () => {
  it("surfaces sourceFileName, targetKey and titles for create-mode uploads", async () => {
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/draft-note.md",
      markdown: "---\nsummary: Imported\n---\n# Imported\n",
      sourceFileName: "draft-note.md"
    });

    expect(preview).toMatchObject({
      mode: "create",
      sourceFileName: "draft-note.md",
      targetKey: "global/draft-note.md",
      existingTitle: null,
      targetTitle: "Imported",
      title: "Imported"
    });
    expect(preview.warnings).toEqual([]);
  });

  it("warns when the source filename basename differs from the target key", async () => {
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/renamed.md",
      markdown: "# Body\n",
      sourceFileName: "草案.md"
    });
    expect(preview.sourceFileName).toBe("草案.md");
    expect(preview.targetKey).toBe("global/renamed.md");
    expect(preview.warnings.some((warning) => warning.includes("草案.md") && warning.includes("renamed.md"))).toBe(true);
  });

  it("reports existingTitle when previewing an overwrite upload", async () => {
    await writeWiki(projectRoot, "global/covered.md", {
      frontmatter: { summary: "Existing title" },
      content: "# Existing title\n"
    });
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/covered.md",
      markdown: "# Replacement\n",
      mode: "replace",
      sourceFileName: "covered.md"
    });
    expect(preview).toMatchObject({
      mode: "replace",
      sourceFileName: "covered.md",
      targetKey: "global/covered.md",
      existingTitle: "Existing title",
      targetTitle: "Replacement"
    });
  });
});
