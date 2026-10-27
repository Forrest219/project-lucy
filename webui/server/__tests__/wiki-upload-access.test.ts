import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAuditDbForTests } from "../admin/audit";
import { closeSecurityStore } from "../security/instance";
import { commitWikiUpload, previewWikiUpload, readWiki } from "../wiki";

/**
 * Spec 193 §5 — the upload authorization decision matrix.
 *
 * create / replace × missing / empty / roles / all / corrupt, the explicit
 * access selection, the server-side confirmations and the preview digest
 * binding. Synthetic content only.
 */

let projectRoot: string;
let prevRoot: string | undefined;
let prevContent: string | undefined;
let prevAuditDb: string | undefined;

const KEY = "global/upload-page.md";
const pagePath = () => path.join(projectRoot, "wiki", "global", "upload-page.md");

const ROLE_ROLES = "---\nallowed_roles: [finance]\nsummary: S\n---\n# Page\n\nBody.\n";
const EMPTY_ROLES = "---\nallowed_roles: []\n---\n# Page\n";
const ALL_ROLES = "---\nallowed_roles: ['*']\n---\n# Page\n";
const CORRUPT_ROLES = "---\nallowed_roles: ['*', finance]\n---\n# Page\n";
const NO_ROLES = "---\nsummary: S\n---\n# Page\n";

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-wiki-upload-"));
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
  await writeFile(pagePath(), ROLE_ROLES, "utf8");
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

describe("Spec 193 §5.2 — a new upload can use the uploaded declaration or set a replacement", () => {
  it("create + `use_uploaded` writes the uploaded roles", async () => {
    const markdown = "---\nallowed_roles: [finance]\nsummary: New\n---\n# New page\n";
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/created.md",
      markdown,
      mode: "create",
      access: { mode: "use_uploaded" }
    });

    expect(preview.exists).toBe(false);
    expect(preview.access.current_acl).toBeNull();
    expect(preview.access.uploaded_acl).toEqual({ state: "roles", roles: ["finance"] });
    expect(preview.access.final_acl).toEqual({ state: "roles", roles: ["finance"] });
    expect(preview.access.suggested_selection).toEqual({ mode: "use_uploaded" });
    expect(preview.access.direction).toBe("widen");
    expect(preview.access.issues.filter((issue) => issue.blocking)).toHaveLength(0);

    await commitWikiUpload(projectRoot, {
      key: "global/created.md",
      markdown,
      mode: "create",
      access: { mode: "use_uploaded" },
      preview_digest: preview.access.preview_digest
    });

    const stored = await readFile(path.join(projectRoot, "wiki", "global", "created.md"), "utf8");
    expect(stored).toContain("- finance");
    expect(stored).toContain("# New page");
    expect((await readWiki(projectRoot, "global/created.md")).acl).toEqual({
      state: "roles",
      roles: ["finance"]
    });
  });

  it("create + `set` replaces the uploaded declaration", async () => {
    const markdown = "---\nallowed_roles: [finance]\n---\n# New page\n";
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/created-set.md",
      markdown,
      mode: "create",
      access: { mode: "set", allowed_roles: ["ops"] }
    });
    expect(preview.access.final_acl).toEqual({ state: "roles", roles: ["ops"] });
    expect(preview.access.uploaded_acl).toEqual({ state: "roles", roles: ["finance"] });

    await commitWikiUpload(projectRoot, {
      key: "global/created-set.md",
      markdown,
      mode: "create",
      access: { mode: "set", allowed_roles: ["ops"] },
      preview_digest: preview.access.preview_digest
    });

    const stored = await readFile(path.join(projectRoot, "wiki", "global", "created-set.md"), "utf8");
    expect(stored).toContain("- ops");
    expect(stored).not.toContain("- finance");
  });
});

describe("Spec 193 §5.3 — a replace keeps the current authorization by default", () => {
  it("reports the uploaded difference but does not adopt it", async () => {
    const markdown = "---\nallowed_roles: [ops]\n---\n# Replaced\n";
    const preview = await previewWikiUpload(projectRoot, { key: KEY, markdown, mode: "replace" });

    expect(preview.access.suggested_selection).toEqual({ mode: "preserve_current" });
    expect(preview.access.current_acl).toEqual({ state: "roles", roles: ["finance"] });
    expect(preview.access.uploaded_acl).toEqual({ state: "roles", roles: ["ops"] });
    expect(preview.access.final_acl).toEqual({ state: "roles", roles: ["finance"] });

    const current = (await readWiki(projectRoot, KEY)).file_version;
    await commitWikiUpload(projectRoot, {
      key: KEY,
      markdown,
      mode: "replace",
      access: { mode: "preserve_current" },
      expected_version: current,
      preview_digest: preview.access.preview_digest
    });

    const stored = await readFile(pagePath(), "utf8");
    expect(stored).toContain("- finance");
    expect(stored).not.toContain("- ops");
    expect(stored).toContain("# Replaced");
  });

  it("adopts the uploaded roles only when the admin explicitly asks for it", async () => {
    const markdown = "---\nallowed_roles: [ops]\n---\n# Replaced\n";
    const preview = await previewWikiUpload(projectRoot, {
      key: KEY,
      markdown,
      mode: "replace",
      access: { mode: "use_uploaded" }
    });
    expect(preview.access.final_acl).toEqual({ state: "roles", roles: ["ops"] });

    const current = (await readWiki(projectRoot, KEY)).file_version;
    await commitWikiUpload(projectRoot, {
      key: KEY,
      markdown,
      mode: "replace",
      access: { mode: "use_uploaded" },
      expected_version: current,
      preview_digest: preview.access.preview_digest
    });
    expect((await readWiki(projectRoot, KEY)).acl).toEqual({ state: "roles", roles: ["ops"] });
  });
});

describe("Spec 193 §5.4 — a corrupt uploaded declaration is refused but repairable", () => {
  it("cannot be adopted and refuses the commit", async () => {
    const preview = await previewWikiUpload(projectRoot, {
      key: KEY,
      markdown: CORRUPT_ROLES,
      mode: "replace",
      access: { mode: "use_uploaded" }
    });
    expect(preview.access.uploaded_acl.state).toBe("corrupt");
    expect(
      preview.access.issues.some((issue) => issue.code === "CONTEXT_ACL_INVALID" && issue.blocking)
    ).toBe(true);

    const current = (await readWiki(projectRoot, KEY)).file_version;
    await expect(
      commitWikiUpload(projectRoot, {
        key: KEY,
        markdown: CORRUPT_ROLES,
        mode: "replace",
        access: { mode: "use_uploaded" },
        expected_version: current,
        preview_digest: preview.access.preview_digest
      })
    ).rejects.toMatchObject({ code: "CONTEXT_ACL_INVALID", statusCode: 400 });
    // The STORED page is untouched — the corrupt declaration was in the
    // uploaded file, not in the target.
    expect(await readFile(pagePath(), "utf8")).toBe(ROLE_ROLES);
  });

  it("is repaired by an explicit `set`", async () => {
    const preview = await previewWikiUpload(projectRoot, {
      key: KEY,
      markdown: CORRUPT_ROLES,
      mode: "replace",
      access: { mode: "set", allowed_roles: ["ops"] }
    });
    expect(preview.access.issues.filter((issue) => issue.blocking)).toHaveLength(0);
    expect(preview.access.final_acl).toEqual({ state: "roles", roles: ["ops"] });

    const current = (await readWiki(projectRoot, KEY)).file_version;
    await commitWikiUpload(projectRoot, {
      key: KEY,
      markdown: CORRUPT_ROLES,
      mode: "replace",
      access: { mode: "set", allowed_roles: ["ops"] },
      expected_version: current,
      preview_digest: preview.access.preview_digest
    });

    const stored = await readFile(pagePath(), "utf8");
    expect(stored).toContain("- ops");
    expect(stored).not.toContain("*");
  });
});

describe("Spec 193 §5.2 — nobody-visible and all-roles need their own confirmation", () => {
  it("an empty final authorization is refused without `confirmed_empty`", async () => {
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/empty.md",
      markdown: EMPTY_ROLES,
      mode: "create",
      access: { mode: "use_uploaded" }
    });
    expect(preview.access.final_acl).toEqual({ state: "empty" });
    expect(preview.access.issues.map((issue) => issue.code)).toContain("confirm_empty_required");

    await expect(
      commitWikiUpload(projectRoot, {
        key: "global/empty.md",
        markdown: EMPTY_ROLES,
        mode: "create",
        access: { mode: "use_uploaded" },
        preview_digest: preview.access.preview_digest
      })
    ).rejects.toMatchObject({ code: "wiki_upload_access_required", statusCode: 400 });
    await expect(readFile(path.join(projectRoot, "wiki", "global", "empty.md"), "utf8")).rejects.toThrow();
  });

  it("an empty final authorization is accepted with `confirmed_empty`", async () => {
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/empty.md",
      markdown: EMPTY_ROLES,
      mode: "create",
      access: { mode: "use_uploaded" }
    });
    await commitWikiUpload(projectRoot, {
      key: "global/empty.md",
      markdown: EMPTY_ROLES,
      mode: "create",
      access: { mode: "use_uploaded" },
      confirmed_empty: true,
      preview_digest: preview.access.preview_digest
    });
    expect((await readWiki(projectRoot, "global/empty.md")).acl).toEqual({ state: "empty" });
  });

  it("an all-roles final authorization is refused without `confirmed_all`", async () => {
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/all.md",
      markdown: ALL_ROLES,
      mode: "create",
      access: { mode: "use_uploaded" }
    });
    expect(preview.access.final_acl).toEqual({ state: "all" });
    expect(preview.access.issues.map((issue) => issue.code)).toContain("confirm_all_required");

    await expect(
      commitWikiUpload(projectRoot, {
        key: "global/all.md",
        markdown: ALL_ROLES,
        mode: "create",
        access: { mode: "use_uploaded" },
        preview_digest: preview.access.preview_digest
      })
    ).rejects.toMatchObject({ code: "wiki_upload_access_required", statusCode: 400 });
    await expect(readFile(path.join(projectRoot, "wiki", "global", "all.md"), "utf8")).rejects.toThrow();
  });

  it("an all-roles final authorization is accepted with `confirmed_all`", async () => {
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/all.md",
      markdown: ALL_ROLES,
      mode: "create",
      access: { mode: "use_uploaded" }
    });
    await commitWikiUpload(projectRoot, {
      key: "global/all.md",
      markdown: ALL_ROLES,
      mode: "create",
      access: { mode: "use_uploaded" },
      confirmed_all: true,
      preview_digest: preview.access.preview_digest
    });
    expect((await readWiki(projectRoot, "global/all.md")).acl).toEqual({ state: "all" });
  });

  it("a missing declaration is reported as nobody-visible", async () => {
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/none.md",
      markdown: NO_ROLES,
      mode: "create",
      access: { mode: "use_uploaded" }
    });
    expect(preview.access.uploaded_acl).toEqual({ state: "missing" });
    expect(preview.access.final_acl).toEqual({ state: "missing" });
    expect(preview.access.issues.map((issue) => issue.code)).toContain("confirm_empty_required");
  });
});

describe("Spec 193 §5.4 — the commit is bound to the original Markdown, the selection and the digest", () => {
  it("refuses a commit without an explicit access selection", async () => {
    await expect(
      commitWikiUpload(projectRoot, { key: "global/plain.md", markdown: NO_ROLES, mode: "create" })
    ).rejects.toMatchObject({ code: "wiki_upload_access_required", statusCode: 400 });
    await expect(readFile(path.join(projectRoot, "wiki", "global", "plain.md"), "utf8")).rejects.toThrow();
  });

  it("refuses a commit without the preview digest", async () => {
    await expect(
      commitWikiUpload(projectRoot, {
        key: "global/plain.md",
        markdown: NO_ROLES,
        mode: "create",
        access: { mode: "set", allowed_roles: ["finance"] }
      })
    ).rejects.toMatchObject({ code: "wiki_upload_preview_stale", statusCode: 409 });
    await expect(readFile(path.join(projectRoot, "wiki", "global", "plain.md"), "utf8")).rejects.toThrow();
  });

  it("refuses a stale digest and writes nothing", async () => {
    const markdown = "---\nallowed_roles: [finance]\n---\n# New\n";
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/stale.md",
      markdown,
      mode: "create",
      access: { mode: "use_uploaded" }
    });

    await expect(
      commitWikiUpload(projectRoot, {
        key: "global/stale.md",
        markdown,
        mode: "create",
        access: { mode: "use_uploaded" },
        preview_digest: "wac-00000000000000000000000000000000"
      })
    ).rejects.toMatchObject({ code: "wiki_upload_preview_stale", statusCode: 409 });
    await expect(readFile(path.join(projectRoot, "wiki", "global", "stale.md"), "utf8")).rejects.toThrow();
  });

  it("refuses a selection that differs from the previewed one", async () => {
    const markdown = "---\nallowed_roles: [finance]\n---\n# New\n";
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/other-selection.md",
      markdown,
      mode: "create",
      access: { mode: "use_uploaded" }
    });

    await expect(
      commitWikiUpload(projectRoot, {
        key: "global/other-selection.md",
        markdown,
        mode: "create",
        access: { mode: "set", allowed_roles: ["ops"] },
        preview_digest: preview.access.preview_digest
      })
    ).rejects.toMatchObject({ code: "wiki_upload_preview_stale", statusCode: 409 });
    await expect(
      readFile(path.join(projectRoot, "wiki", "global", "other-selection.md"), "utf8")
    ).rejects.toThrow();
  });

  it("never accepts the preview's `proposedMarkdown` as the write source", async () => {
    const markdown = "---\nallowed_roles: [finance]\n---\n# New\n";
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/proposed.md",
      markdown,
      mode: "create",
      access: { mode: "use_uploaded" }
    });

    // The preview canonicalizes the declaration, so `proposedMarkdown` is NOT
    // the original file text. The digest binds the ORIGINAL content hash.
    expect(preview.proposedMarkdown).not.toBe(markdown);

    await expect(
      commitWikiUpload(projectRoot, {
        key: "global/proposed.md",
        markdown: preview.proposedMarkdown,
        mode: "create",
        access: { mode: "use_uploaded" },
        preview_digest: preview.access.preview_digest
      })
    ).rejects.toMatchObject({ code: "wiki_upload_preview_stale", statusCode: 409 });
    await expect(readFile(path.join(projectRoot, "wiki", "global", "proposed.md"), "utf8")).rejects.toThrow();

    // The original Markdown is the accepted source.
    await commitWikiUpload(projectRoot, {
      key: "global/proposed.md",
      markdown,
      mode: "create",
      access: { mode: "use_uploaded" },
      preview_digest: preview.access.preview_digest
    });
    expect(await readFile(path.join(projectRoot, "wiki", "global", "proposed.md"), "utf8")).toContain("# New");
  });
});

describe("Spec 193 §5.4 — a changed target or role graph writes nothing", () => {
  it("a stale target version refuses the commit", async () => {
    const markdown = "---\nallowed_roles: [ops]\n---\n# Replaced\n";
    const preview = await previewWikiUpload(projectRoot, {
      key: KEY,
      markdown,
      mode: "replace",
      access: { mode: "use_uploaded" }
    });

    await expect(
      commitWikiUpload(projectRoot, {
        key: KEY,
        markdown,
        mode: "replace",
        access: { mode: "use_uploaded" },
        expected_version: "sha256:stale",
        preview_digest: preview.access.preview_digest
      })
    ).rejects.toMatchObject({ code: "wiki_write_conflict", statusCode: 409 });
    expect(await readFile(pagePath(), "utf8")).toBe(ROLE_ROLES);
  });

  it("a target that appeared after the preview refuses the create", async () => {
    const markdown = "---\nallowed_roles: [finance]\n---\n# New\n";
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/appeared.md",
      markdown,
      mode: "create",
      access: { mode: "use_uploaded" }
    });
    // Somebody else created the target in the meantime.
    await writeFile(path.join(projectRoot, "wiki", "global", "appeared.md"), "---\n---\n# Other\n", "utf8");

    await expect(
      commitWikiUpload(projectRoot, {
        key: "global/appeared.md",
        markdown,
        mode: "create",
        access: { mode: "use_uploaded" },
        preview_digest: preview.access.preview_digest
      })
    ).rejects.toMatchObject({ code: "wiki_write_conflict", statusCode: 409 });
    expect(await readFile(path.join(projectRoot, "wiki", "global", "appeared.md"), "utf8")).toBe(
      "---\n---\n# Other\n"
    );
  });

  it("a changed role_channel_version refuses the commit", async () => {
    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      "roles:\n  finance:\n    allow:\n      tools: [wiki_search, wiki_read]\nusers: []\n",
      "utf8"
    );

    const markdown = "---\nallowed_roles: [finance]\n---\n# New\n";
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/channel.md",
      markdown,
      mode: "create",
      access: { mode: "use_uploaded" }
    });

    // The Role graph changed after the preview.
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      "roles:\n  finance:\n    allow:\n      tools: [wiki_search]\nusers: []\n",
      "utf8"
    );

    await expect(
      commitWikiUpload(projectRoot, {
        key: "global/channel.md",
        markdown,
        mode: "create",
        access: { mode: "use_uploaded" },
        preview_digest: preview.access.preview_digest
      })
    ).rejects.toMatchObject({ code: "wiki_upload_preview_stale", statusCode: 409 });
    await expect(readFile(path.join(projectRoot, "wiki", "global", "channel.md"), "utf8")).rejects.toThrow();
  });
});

describe("Spec 193 §5.4 — the mode is never silently converted", () => {
  it("a create on an existing target is refused and reported by the preview", async () => {
    const preview = await previewWikiUpload(projectRoot, {
      key: KEY,
      markdown: "---\nallowed_roles: [ops]\n---\n# Replaced\n",
      mode: "create",
      access: { mode: "use_uploaded" }
    });
    expect(preview.warnings.join(" ")).toContain("目标文档已存在");

    await expect(
      commitWikiUpload(projectRoot, {
        key: KEY,
        markdown: "---\nallowed_roles: [ops]\n---\n# Replaced\n",
        mode: "create",
        access: { mode: "use_uploaded" },
        expected_version: (await readWiki(projectRoot, KEY)).file_version,
        preview_digest: preview.access.preview_digest
      })
    ).rejects.toMatchObject({ code: "wiki_write_conflict", statusCode: 409 });
    expect(await readFile(pagePath(), "utf8")).toBe(ROLE_ROLES);
  });

  it("a replace on a missing target is refused and reported by the preview", async () => {
    const preview = await previewWikiUpload(projectRoot, {
      key: "global/missing.md",
      markdown: "---\nallowed_roles: [ops]\n---\n# Replaced\n",
      mode: "replace",
      access: { mode: "use_uploaded" }
    });
    expect(preview.warnings.join(" ")).toContain("覆盖模式下目标文档不存在");

    await expect(
      commitWikiUpload(projectRoot, {
        key: "global/missing.md",
        markdown: "---\nallowed_roles: [ops]\n---\n# Replaced\n",
        mode: "replace",
        access: { mode: "use_uploaded" },
        preview_digest: preview.access.preview_digest
      })
    ).rejects.toMatchObject({ code: "wiki_write_conflict", statusCode: 409 });
    await expect(readFile(path.join(projectRoot, "wiki", "global", "missing.md"), "utf8")).rejects.toThrow();
  });
});
