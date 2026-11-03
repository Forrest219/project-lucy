import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetAuditDbForTests } from "../admin/audit";
import { buildServer } from "../index";
import {
  FrontmatterEngineForbiddenError,
  parseMarkdownFrontmatter,
  stringifyMarkdownFrontmatter
} from "../markdown-frontmatter";
import { wikiContentHash } from "../wiki-hash";

// V-08 / SEC-15-FM-01～06 — only YAML frontmatter is accepted; every other
// engine is rejected with zero server-side execution and no disk write.
// Synthetic payloads only: each one sets an in-process flag and nothing else.

const PROBE_KEY = "__LUCY_FM_PROBE";
const probeGlobal = globalThis as unknown as Record<string, unknown>;

const LANGUAGE_TAGS = ["---js", "---javascript", "---JS", "--- js", "---json"] as const;

function payloadFor(languageTag: string, probeTag: string): string {
  const body = languageTag.toLowerCase().includes("json")
    ? `{ "summary": "json-${probeTag}" }`
    : `{ summary: (globalThis.${PROBE_KEY} = "${probeTag}", "x") }`;
  return `${languageTag}\n${body}\n---\n# probe\n`;
}

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let app: FastifyInstance;
let caseSeq = 0;

function uniqueTag(languageTag: string): string {
  caseSeq += 1;
  // Unique payload per case so no parser cache can mask a regression.
  return `${languageTag.replace(/[^a-zA-Z]/g, "")}-${caseSeq}-${Date.now()}`;
}

function wikiFile(...segments: string[]): string {
  return path.join(projectRoot, "wiki", ...segments);
}

async function absent(filePath: string): Promise<void> {
  await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-fm-safety-"));
  await mkdir(path.join(projectRoot, "wiki", "global"), { recursive: true });
  await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  resetAuditDbForTests();
  delete probeGlobal[PROBE_KEY];
  app = buildServer();
});

afterEach(async () => {
  await app.close();
  resetAuditDbForTests();
  delete probeGlobal[PROBE_KEY];
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

function expectRejected(res: { statusCode: number; json: () => unknown }, status: 400 | 422): void {
  expect(probeGlobal[PROBE_KEY]).toBeUndefined();
  expect(res.statusCode).toBe(status);
  expect(res.json()).toMatchObject({
    ok: false,
    error: { code: "WIKI_FRONTMATTER_UNSUPPORTED" }
  });
}

describe.each(LANGUAGE_TAGS)("V-08 frontmatter engine %s", (languageTag) => {
  it("SEC-15-FM-01 upload preview", async () => {
    const tag = uniqueTag(languageTag);
    const res = await app.inject({
      method: "POST",
      url: "/api/wiki/upload/preview",
      payload: { key: "global/fm-preview.md", markdown: payloadFor(languageTag, tag) }
    });
    expectRejected(res, 400);
    await absent(wikiFile("global", "fm-preview.md"));
  });

  it("SEC-15-FM-02 upload commit", async () => {
    const tag = uniqueTag(languageTag);
    const res = await app.inject({
      method: "POST",
      url: "/api/wiki/upload/commit",
      payload: { key: "global/fm-commit.md", markdown: payloadFor(languageTag, tag) }
    });
    expectRejected(res, 400);
    await absent(wikiFile("global", "fm-commit.md"));
  });

  it.each([true, false])("SEC-15-FM-03 PUT edit (dryRun=%s)", async (dryRun) => {
    const tag = uniqueTag(languageTag);
    const res = await app.inject({
      method: "PUT",
      url: "/api/wiki/global%2Ffm-put.md",
      payload: { dryRun, content: payloadFor(languageTag, tag) }
    });
    expectRejected(res, 400);
    await absent(wikiFile("global", "fm-put.md"));
  });

  it("SEC-15-FM-04 GET on-disk file", async () => {
    const tag = uniqueTag(languageTag);
    const markdown = payloadFor(languageTag, tag);
    await writeFile(wikiFile("global", "fm-disk.md"), markdown, "utf8");
    const res = await app.inject({ method: "GET", url: "/api/wiki/global%2Ffm-disk.md" });
    expectRejected(res, 422);
    await expect(readFile(wikiFile("global", "fm-disk.md"), "utf8")).resolves.toBe(markdown);
  });

  it("SEC-15-FM-05 version restore", async () => {
    const seeded = await app.inject({
      method: "PUT",
      url: "/api/wiki/global%2Ffm-restore.md",
      payload: { dryRun: false, content: "# Seed\n" }
    });
    expect(seeded.statusCode).toBe(200);
    const index = JSON.parse(await readFile(wikiFile(".lucy-history", "index.json"), "utf8"));
    const version = index.documents["global/fm-restore.md"].versions[0];
    const tag = uniqueTag(languageTag);
    await writeFile(path.join(projectRoot, version.snapshotPath), payloadFor(languageTag, tag), "utf8");
    const before = await readFile(wikiFile("global", "fm-restore.md"), "utf8");

    const preview = await app.inject({
      method: "POST",
      url: `/api/wiki/global%2Ffm-restore.md/versions/${version.versionId}/restore/preview`
    });
    expectRejected(preview, 400);
    const res = await app.inject({
      method: "POST",
      url: `/api/wiki/global%2Ffm-restore.md/versions/${version.versionId}/restore`
    });
    expectRejected(res, 400);
    await expect(readFile(wikiFile("global", "fm-restore.md"), "utf8")).resolves.toBe(before);
  });

  it("SEC-15-FM-06 config package import (reuses upload commit per file)", async () => {
    const tag = uniqueTag(languageTag);
    const res = await app.inject({
      method: "POST",
      url: "/api/wiki/upload/commit",
      payload: {
        key: "global/fm-package.md",
        markdown: payloadFor(languageTag, tag),
        sourceFileName: "fm-package.md",
        mode: "create"
      }
    });
    expectRejected(res, 400);
    await absent(wikiFile("global", "fm-package.md"));
  });

  it("move of an on-disk non-YAML page writes nothing", async () => {
    const tag = uniqueTag(languageTag);
    const markdown = payloadFor(languageTag, tag);
    await writeFile(wikiFile("global", "fm-move.md"), markdown, "utf8");
    const res = await app.inject({
      method: "POST",
      url: "/api/wiki/global%2Ffm-move.md/move",
      payload: { targetDirectory: "ops", expected_version: wikiContentHash(markdown) }
    });
    expectRejected(res, 400);
    await absent(wikiFile("ops", "fm-move.md"));
  });
});

describe("V-08 valid YAML control", () => {
  const YAML_DOC = "---\nsummary: Control note\ntags:\n  - finance\nsl_refs:\n  - mysql/schema/table\n---\n# Control\n";

  it.each(["---", "---yaml", "--- yaml", "---YAML"])("accepts %s frontmatter on upload and read", async (opener) => {
    const markdown = YAML_DOC.replace(/^---/, opener);
    // Spec 193 §5.4 — the commit carries the original Markdown, an explicit
    // authorization selection and the preview digest.
    const access = { mode: "set", allowed_roles: [] } as const;
    const preview = await app.inject({
      method: "POST",
      url: "/api/wiki/upload/preview",
      payload: { key: "global/fm-control.md", markdown, mode: "create", access }
    });
    expect(preview.statusCode).toBe(200);
    const commit = await app.inject({
      method: "POST",
      url: "/api/wiki/upload/commit",
      payload: {
        key: "global/fm-control.md",
        markdown,
        mode: "create",
        access,
        confirmed_empty: true,
        preview_digest: preview.json().data.access.preview_digest
      }
    });
    expect(commit.statusCode).toBe(200);
    expect(commit.json().data.title).toBe("Control note");
    const read = await app.inject({ method: "GET", url: "/api/wiki/global%2Ffm-control.md" });
    expect(read.statusCode).toBe(200);
    expect(read.json().data.frontmatter).toMatchObject({
      summary: "Control note",
      tags: ["finance"],
      sl_refs: ["mysql/schema/table"]
    });
    expect(probeGlobal[PROBE_KEY]).toBeUndefined();
  });

  it("round-trips PUT edits on valid YAML", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/wiki/global%2Ffm-put-control.md",
      payload: { dryRun: false, frontmatter: { summary: "Saved" }, content: "# Saved\n" }
    });
    expect(res.statusCode).toBe(200);
    await expect(readFile(wikiFile("global", "fm-put-control.md"), "utf8")).resolves.toBe(
      "---\nsummary: Saved\n---\n# Saved\n"
    );
  });
});

describe("parseMarkdownFrontmatter", () => {
  it("returns the body untouched when there is no frontmatter", () => {
    expect(parseMarkdownFrontmatter("# Title\n")).toEqual({ data: {}, content: "# Title\n" });
    expect(parseMarkdownFrontmatter("----\nnot frontmatter\n")).toMatchObject({ data: {} });
  });

  it("handles CRLF openers and closing delimiters like wiki-acl", () => {
    expect(parseMarkdownFrontmatter("---\r\nsummary: x\r\n---\r\n# T\r\n")).toEqual({
      data: { summary: "x" },
      content: "# T\r\n"
    });
  });

  it("rejects every non-YAML engine tag, including stringify's re-parse", () => {
    for (const tag of LANGUAGE_TAGS) {
      const text = `${tag}\n{}\n---\nbody\n`;
      expect(() => parseMarkdownFrontmatter(text)).toThrow(FrontmatterEngineForbiddenError);
      expect(() => stringifyMarkdownFrontmatter(text, { a: 1 })).toThrow(FrontmatterEngineForbiddenError);
    }
    expect(probeGlobal[PROBE_KEY]).toBeUndefined();
  });
});
