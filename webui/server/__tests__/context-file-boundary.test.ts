import { mkdir, mkdtemp, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertReadable, ForbiddenPathError, readContextFile, resolveWritable } from "../fs-safe";
import type { ContentPaths } from "../paths";
import { loadAllSkills, invalidateSkillsCache } from "../skills/loader";

/**
 * Spec §4.5 / V-07 — Wiki and Skill reads refuse a symlink at any layer, traversal and encoded
 * variants, and a swap to a link between check and open. The canary lives OUTSIDE the content
 * root and is synthetic: no real secret is ever read.
 */

const CANARY = "OUTSIDE_ROOT_SYNTHETIC_CANARY";
let base: string;
let content: string;
let outside: string;

const paths = (): ContentPaths => ({
  configDir: content,
  semanticLayer: path.join(content, "semantic-layer"),
  wiki: path.join(content, "wiki"),
  evals: path.join(content, "evals"),
  skills: path.join(content, "skills"),
  source: "default"
});

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "lucy-ctx-boundary-"));
  content = path.join(base, "content");
  outside = path.join(base, "outside");
  await mkdir(path.join(content, "wiki", "global"), { recursive: true });
  await mkdir(path.join(content, "skills", "ops"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, "secret.md"), CANARY);
  await writeFile(path.join(content, "wiki", "global", "ok.md"), "# ok\n");
});

afterEach(async () => {
  invalidateSkillsCache();
  await rm(base, { recursive: true, force: true });
});

describe("readContextFile", () => {
  it("reads a regular file inside the root", async () => {
    const { content: text } = await readContextFile(path.join(content, "wiki"), "global/ok.md");
    expect(text).toBe("# ok\n");
  });

  it("rejects a symlinked entry file that points outside the root", async () => {
    await symlink(path.join(outside, "secret.md"), path.join(content, "wiki", "global", "link.md"));
    await expect(readContextFile(path.join(content, "wiki"), "global/link.md")).rejects.toBeInstanceOf(ForbiddenPathError);
  });

  it("rejects a symlinked directory at any layer, even one that stays inside the root", async () => {
    await symlink(outside, path.join(content, "wiki", "global", "linked-dir"));
    await expect(readContextFile(path.join(content, "wiki"), "global/linked-dir/secret.md")).rejects.toBeInstanceOf(ForbiddenPathError);
    await mkdir(path.join(content, "wiki", "real"), { recursive: true });
    await writeFile(path.join(content, "wiki", "real", "inner.md"), "# inner\n");
    await symlink(path.join(content, "wiki", "real"), path.join(content, "wiki", "alias"));
    await expect(readContextFile(path.join(content, "wiki"), "alias/inner.md")).rejects.toBeInstanceOf(ForbiddenPathError);
  });

  it.each([
    ["traversal", "../outside/secret.md"],
    ["nested traversal", "global/../../outside/secret.md"],
    ["encoded dot-dot", "%2e%2e/outside/secret.md"],
    ["encoded slash", "global%2f..%2f..%2foutside%2fsecret.md"],
    ["encoded backslash", "global%5c..%5csecret.md"],
    ["backslash", "global\\..\\secret.md"],
    ["NUL byte", "global/ok.md\0.png"],
    ["absolute path", "/etc/passwd"],
    ["empty segment", "global//ok.md"],
    ["empty key", ""]
  ])("rejects %s", async (_label, key) => {
    await expect(readContextFile(path.join(content, "wiki"), key)).rejects.toBeInstanceOf(ForbiddenPathError);
  });

  it("a file swapped to a symlink between checks never yields the outside canary", async () => {
    const target = path.join(content, "wiki", "global", "race.md");
    const link = path.join(content, "wiki", "global", "race.link");
    await writeFile(target, "# race\n");
    await symlink(path.join(outside, "secret.md"), link);
    let stop = false;
    const flipper = (async () => {
      while (!stop) {
        await rename(target, `${target}.bak`).catch(() => undefined);
        await rename(link, target).catch(() => undefined);
        await rename(target, link).catch(() => undefined);
        await rename(`${target}.bak`, target).catch(() => undefined);
      }
    })();
    const seen: string[] = [];
    for (let i = 0; i < 300; i += 1) {
      try {
        seen.push((await readContextFile(path.join(content, "wiki"), "global/race.md")).content);
      } catch {
        // refused or momentarily missing: both are safe outcomes
      }
    }
    stop = true;
    await flipper;
    expect(seen.some((text) => text.includes(CANARY))).toBe(false);
  });
});

describe("fs-safe read/write helpers for Wiki and Skill paths", () => {
  it("assertReadable and resolveWritable reject a symlink inside wiki/ and skills/ (both layers)", async () => {
    await symlink(path.join(outside, "secret.md"), path.join(content, "wiki", "global", "link.md"));
    await symlink(outside, path.join(content, "skills", "linked-domain"));
    await expect(assertReadable(paths(), base, "wiki/global/link.md")).rejects.toBeInstanceOf(ForbiddenPathError);
    await expect(assertReadable(paths(), base, "skills/linked-domain/x.md")).rejects.toBeInstanceOf(ForbiddenPathError);
    await expect(resolveWritable(paths(), base, "wiki/global/link.md")).rejects.toBeInstanceOf(ForbiddenPathError);
    await expect(resolveWritable(paths(), base, "skills/linked-domain/x.md")).rejects.toBeInstanceOf(ForbiddenPathError);
  });

  it("a regular Wiki path and a not-yet-existing path still resolve", async () => {
    await expect(assertReadable(paths(), base, "wiki/global/ok.md")).resolves.toContain("ok.md");
    await expect(resolveWritable(paths(), base, "wiki/global/new.md")).resolves.toContain("new.md");
  });
});

describe("Skill loader", () => {
  it("never loads a symlinked Skill entry or a Skill under a symlinked directory", async () => {
    const skillText = (name: string) => `---\nname: ${name}\ntitle: ${name}\ndomain: ops\nstatus: published\nroles_allowed: [r]\n---\n${CANARY}\n`;
    await writeFile(path.join(outside, "linked.skill.md"), skillText("linked-skill"));
    await symlink(path.join(outside, "linked.skill.md"), path.join(content, "skills", "ops", "linked.skill.md"));
    await mkdir(path.join(outside, "dir"), { recursive: true });
    await writeFile(path.join(outside, "dir", "dir.skill.md"), skillText("dir-skill"));
    await symlink(path.join(outside, "dir"), path.join(content, "skills", "dir-link"));
    await writeFile(path.join(content, "skills", "ops", "real.skill.md"), skillText("real-skill").replace(CANARY, "real body"));
    const skills = await loadAllSkills(path.join(content, "skills"));
    expect(skills.map((skill) => skill.name)).toEqual(["real-skill"]);
    await unlink(path.join(content, "skills", "ops", "linked.skill.md"));
  });
});

describe("Agent-side Wiki resolution (V-07)", () => {
  it("resolveWikiPage treats a symlinked page as not found and never exposes the canary", async () => {
    const prevRoot = process.env.KTX_PROJECT_ROOT;
    const prevContent = process.env.LUCY_CONTENT_ROOT;
    process.env.KTX_PROJECT_ROOT = base;
    process.env.LUCY_CONTENT_ROOT = content;
    await writeFile(path.join(base, "ktx.yaml"), "connections: {}\n");
    try {
      const { invalidateContentPathsCache } = await import("../paths");
      invalidateContentPathsCache();
      await symlink(path.join(outside, "secret.md"), path.join(content, "wiki", "global", "link.md"));
      const { resolveWikiPage } = await import("../proxy/wiki-acl");
      expect(await resolveWikiPage("global/link.md")).toBeUndefined();
      expect((await resolveWikiPage("global/ok.md"))?.body).toContain("# ok");
    } finally {
      if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
      else process.env.KTX_PROJECT_ROOT = prevRoot;
      if (prevContent === undefined) delete process.env.LUCY_CONTENT_ROOT;
      else process.env.LUCY_CONTENT_ROOT = prevContent;
      const { invalidateContentPathsCache } = await import("../paths");
      invalidateContentPathsCache();
    }
  });
});
