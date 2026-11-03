import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAuditDbForTests } from "../admin/audit";
import { buildServer } from "../index";
import {
  commitWikiUpload,
  listWikiVersions,
  previewWikiUpload,
  readWiki,
  restoreWikiVersion,
  writeWiki
} from "../wiki";

/**
 * Spec §4.3 — Wiki file_version / expected_version (428 missing, 409 stale), ACL validation on
 * every write path, and replace-style writes never silently changing the page's audience.
 * Synthetic content only.
 */

let projectRoot: string;
let prevRoot: string | undefined;
let prevContent: string | undefined;

const KEY = "global/acl-page.md";
const pagePath = () => path.join(projectRoot, "wiki", "global", "acl-page.md");

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-wiki-acl-"));
  await mkdir(path.join(projectRoot, "wiki", "global"), { recursive: true });
  await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  prevRoot = process.env.KTX_PROJECT_ROOT;
  prevContent = process.env.LUCY_CONTENT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  resetAuditDbForTests();
  await writeFile(pagePath(), "---\nallowed_roles:\n  - finance\nsummary: S\n---\n# Page\n", "utf8");
});

afterEach(async () => {
  resetAuditDbForTests();
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  if (prevContent === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = prevContent;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("two administrators saving the same Wiki page", () => {
  it("rejects a save without expected_version (428) and a stale one (409); nothing is written", async () => {
    const before = await readFile(pagePath(), "utf8");
    await expect(writeWiki(projectRoot, KEY, { frontmatter: { allowed_roles: ["*"] } })).rejects.toMatchObject({
      statusCode: 428,
      code: "wiki_expected_version_required"
    });
    await expect(
      writeWiki(projectRoot, KEY, { frontmatter: { allowed_roles: ["*"] }, expected_version: "sha256:stale" })
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_write_conflict" });
    expect(await readFile(pagePath(), "utf8")).toBe(before);
  });

  it("the second admin's ACL overwrite loses to the first (no silent last-writer-wins)", async () => {
    const base = (await readWiki(projectRoot, KEY)).file_version;
    // Admin A narrows to ops and saves first.
    await writeWiki(projectRoot, KEY, { frontmatter: { allowed_roles: ["ops"] }, expected_version: base });
    // Admin B, working from the same stale page, tries to widen to `*`.
    await expect(
      writeWiki(projectRoot, KEY, { frontmatter: { allowed_roles: ["*"] }, expected_version: base })
    ).rejects.toMatchObject({ statusCode: 409 });
    const page = await readWiki(projectRoot, KEY);
    expect(page.frontmatter.allowed_roles).toEqual(["ops"]);
    expect(page.acl).toEqual({ state: "roles", roles: ["ops"] });
  });

  it("an ACL-only save keeps the body and other properties; a content-only save keeps the ACL", async () => {
    const v1 = (await readWiki(projectRoot, KEY)).file_version;
    await writeWiki(projectRoot, KEY, { frontmatter: { allowed_roles: ["finance", "ops"] }, expected_version: v1 });
    let page = await readWiki(projectRoot, KEY);
    expect(page.content).toContain("# Page");
    expect(page.frontmatter.summary).toBe("S");
    expect(page.frontmatter.allowed_roles).toEqual(["finance", "ops"]);

    await writeWiki(projectRoot, KEY, { content: "# Edited\n", expected_version: page.file_version });
    page = await readWiki(projectRoot, KEY);
    expect(page.content).toContain("# Edited");
    expect(page.frontmatter.allowed_roles).toEqual(["finance", "ops"]);
  });

  it("a new page needs no version, and an explicit `[]` is a recorded 'no one' choice", async () => {
    await writeWiki(projectRoot, "global/fresh.md", { frontmatter: { allowed_roles: [] }, content: "# Fresh\n" });
    const page = await readWiki(projectRoot, "global/fresh.md");
    expect(page.acl.state).toBe("empty");
    expect(await readFile(path.join(projectRoot, "wiki", "global", "fresh.md"), "utf8")).toContain("allowed_roles: []");
  });

  it.each([
    ["`*` mixed with roles", ["*", "finance"]],
    ["a non-array value", "finance"],
    ["a non-string element", ["finance", 3]]
  ])("refuses to save %s", async (_label, value) => {
    const version = (await readWiki(projectRoot, KEY)).file_version;
    await expect(
      writeWiki(projectRoot, KEY, { frontmatter: { allowed_roles: value as never }, expected_version: version })
    ).rejects.toMatchObject({ statusCode: 400, code: "CONTEXT_ACL_INVALID" });
    expect((await readWiki(projectRoot, KEY)).acl).toEqual({ state: "roles", roles: ["finance"] });
  });
});

describe("replace-style writes keep the page audience unless the owner chooses otherwise", () => {
  it("upload replace requires the current version and carries the existing ACL over", async () => {
    // Spec 193 §5.4 — the commit needs the original Markdown, an explicit
    // access selection and the preview digest.
    await expect(
      commitWikiUpload(projectRoot, { key: KEY, markdown: "# Replaced\n", mode: "replace" })
    ).rejects.toMatchObject({ statusCode: 400, code: "wiki_upload_access_required" });
    await expect(
      commitWikiUpload(projectRoot, {
        key: KEY,
        markdown: "# Replaced\n",
        mode: "replace",
        access: { mode: "preserve_current" }
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "wiki_upload_preview_stale" });

    const preview = await previewWikiUpload(projectRoot, { key: KEY, markdown: "# Replaced\n", mode: "replace" });
    expect(preview.currentFileVersion).toBe((await readWiki(projectRoot, KEY)).file_version);
    expect(preview.access.suggested_selection).toEqual({ mode: "preserve_current" });
    expect(preview.access.final_acl).toEqual({ state: "roles", roles: ["finance"] });
    await commitWikiUpload(projectRoot, {
      key: KEY,
      markdown: "# Replaced\n",
      mode: "replace",
      access: { mode: "preserve_current" },
      expected_version: preview.currentFileVersion ?? "",
      preview_digest: preview.access.preview_digest
    });
    const page = await readWiki(projectRoot, KEY);
    expect(page.content).toContain("# Replaced");
    expect(page.frontmatter.allowed_roles).toEqual(["finance"]);
  });

  it("an upload only changes the ACL when the admin asks for it; a corrupt declaration is refused", async () => {
    const version = (await readWiki(projectRoot, KEY)).file_version;
    const corrupt = await previewWikiUpload(projectRoot, {
      key: KEY,
      markdown: "---\nallowed_roles: ['*', finance]\n---\n# X\n",
      mode: "replace",
      access: { mode: "use_uploaded" }
    });
    // The corrupt declaration cannot be adopted.
    expect(corrupt.access.uploaded_acl.state).toBe("corrupt");
    expect(corrupt.access.issues.some((issue) => issue.blocking)).toBe(true);
    await expect(
      commitWikiUpload(projectRoot, {
        key: KEY,
        markdown: "---\nallowed_roles: ['*', finance]\n---\n# X\n",
        mode: "replace",
        access: { mode: "use_uploaded" },
        expected_version: version,
        preview_digest: corrupt.access.preview_digest
      })
    ).rejects.toMatchObject({ code: "CONTEXT_ACL_INVALID" });

    // The default keeps the current audience even when the file declares one.
    const preserved = await previewWikiUpload(projectRoot, {
      key: KEY,
      markdown: "---\nallowed_roles: [ops]\n---\n# X\n",
      mode: "replace"
    });
    expect(preserved.access.final_acl).toEqual({ state: "roles", roles: ["finance"] });
    await commitWikiUpload(projectRoot, {
      key: KEY,
      markdown: "---\nallowed_roles: [ops]\n---\n# X\n",
      mode: "replace",
      access: { mode: "preserve_current" },
      expected_version: version,
      preview_digest: preserved.access.preview_digest
    });
    expect((await readWiki(projectRoot, KEY)).frontmatter.allowed_roles).toEqual(["finance"]);

    // Adopting the uploaded declaration is an explicit choice.
    const current = (await readWiki(projectRoot, KEY)).file_version;
    const adopted = await previewWikiUpload(projectRoot, {
      key: KEY,
      markdown: "---\nallowed_roles: [ops]\n---\n# X\n",
      mode: "replace",
      access: { mode: "use_uploaded" }
    });
    expect(adopted.access.final_acl).toEqual({ state: "roles", roles: ["ops"] });
    await commitWikiUpload(projectRoot, {
      key: KEY,
      markdown: "---\nallowed_roles: [ops]\n---\n# X\n",
      mode: "replace",
      access: { mode: "use_uploaded" },
      expected_version: current,
      preview_digest: adopted.access.preview_digest
    });
    expect((await readWiki(projectRoot, KEY)).frontmatter.allowed_roles).toEqual(["ops"]);
  });

  it("a new upload without an ACL warns that nobody can see it", async () => {
    const preview = await previewWikiUpload(projectRoot, { key: "global/new-upload.md", markdown: "# New\n" });
    expect(preview.access.final_acl.state).toBe("missing");
    expect(preview.access.issues.map((issue) => issue.code)).toContain("confirm_empty_required");
  });

  it("version restore never revives an older, wider ACL", async () => {
    // v1 (create) has `*`; then the owner narrows the audience to finance.
    await writeWiki(projectRoot, "global/restore.md", { frontmatter: { allowed_roles: ["*"] }, content: "# Old\n" });
    const wide = await readWiki(projectRoot, "global/restore.md");
    await writeWiki(projectRoot, "global/restore.md", {
      frontmatter: { allowed_roles: ["finance"] },
      content: "# New\n",
      expected_version: wide.file_version
    });
    const versions = await listWikiVersions(projectRoot, "global/restore.md");
    const oldest = versions.versions.at(-1);
    expect(oldest).toBeTruthy();
    await expect(
      restoreWikiVersion(projectRoot, "global/restore.md", oldest?.versionId ?? "")
    ).rejects.toMatchObject({ statusCode: 428, code: "wiki_expected_version_required" });
    await restoreWikiVersion(
      projectRoot,
      "global/restore.md",
      oldest?.versionId ?? "",
      undefined,
      (await readWiki(projectRoot, "global/restore.md")).file_version
    );
    const restored = await readWiki(projectRoot, "global/restore.md");
    expect(restored.content).toContain("# Old");
    expect(restored.frontmatter.allowed_roles).toEqual(["finance"]);
  });
});

describe("HTTP contract", () => {
  it("returns file_version on GET and 428 / 409 / 400 on PUT with stable codes", async () => {
    const app = buildServer();
    await app.ready();
    const got = await app.inject({ method: "GET", url: `/api/wiki/${encodeURIComponent(KEY)}` });
    expect(got.json().data.file_version).toMatch(/^sha256:/);
    expect(got.json().data.acl).toEqual({ state: "roles", roles: ["finance"] });

    const put = (payload: Record<string, unknown>) =>
      app.inject({ method: "PUT", url: `/api/wiki/${encodeURIComponent(KEY)}`, payload: { dryRun: false, ...payload } });
    const missing = await put({ content: "# x\n" });
    expect(missing.statusCode).toBe(428);
    expect(missing.json().error.code).toBe("wiki_expected_version_required");
    const stale = await put({ content: "# x\n", expected_version: "sha256:stale" });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("wiki_write_conflict");
    const invalid = await put({ frontmatter: { allowed_roles: ["*", "a"] }, expected_version: got.json().data.file_version });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("CONTEXT_ACL_INVALID");
    const ok = await put({ frontmatter: { allowed_roles: ["ops"] }, expected_version: got.json().data.file_version });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });
});
