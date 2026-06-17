import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { listWiki, previewWikiWrite, readWiki, writeWiki } from "../wiki";
import { ForbiddenPathError } from "../fs-safe";

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
});
