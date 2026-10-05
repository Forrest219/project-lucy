/**
 * A2: cover fs-safe behaviour under the post-A2 default layout
 * (`configDir = <projectRoot>/config/`). See `./paths.ts` for resolution
 * rules. The pre-A2 legacy sibling layout is covered by `fs-safe.test.ts`.
 */
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ContentPaths } from "../paths";
import { assertReadable, ForbiddenPathError, resolveWritable, safeWrite } from "../fs-safe";

let projectRoot: string;

function configRootPaths(): ContentPaths {
  const configDir = path.join(projectRoot, "config");
  return {
    configDir,
    semanticLayer: path.join(configDir, "semantic-layer"),
    wiki: path.join(configDir, "wiki"),
    evals: path.join(configDir, "evals"),
    skills: path.join(configDir, "skills"),
    source: "default"
  };
}

async function makeProjectRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-fs-safe-cfg-"));
  // Legacy sibling layout: content dirs at projectRoot (so the resolver
  // would still find them under `LUCY_CONTENT_ROOT=.`). The new layout
  // does NOT need them — fs-safe creates them on demand via mkdir -p.
  await mkdir(path.join(root, "semantic-layer"), { recursive: true });
  await mkdir(path.join(root, "evals"), { recursive: true });
  await mkdir(path.join(root, "skills"), { recursive: true });
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  await mkdir(path.join(root, ".ktx", "secrets"), { recursive: true });
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  // Pre-create config/ so the resolveWritable path exists from the start
  await mkdir(path.join(root, "config"), { recursive: true });
  return root;
}

async function expectForbidden(action: () => Promise<unknown>) {
  await expect(action()).rejects.toBeInstanceOf(ForbiddenPathError);
}

beforeEach(async () => {
  projectRoot = await makeProjectRoot();
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("fs-safe writable paths — config/ subdir layout", () => {
  it("writes content files to <configDir>/<prefix>/..., not projectRoot siblings", async () => {
    const paths = configRootPaths();
    await safeWrite(paths, projectRoot, "semantic-layer/x.yaml", "a: 1\n");
    await safeWrite(paths, projectRoot, "evals/a.md", "# A\n");
    await safeWrite(paths, projectRoot, "skills/warehouse/SKILL.md", "# S\n");

    // New layout: writes land under config/
    await expect(readFile(path.join(projectRoot, "config", "semantic-layer", "x.yaml"), "utf8")).resolves.toBe("a: 1\n");
    await expect(readFile(path.join(projectRoot, "config", "evals", "a.md"), "utf8")).resolves.toBe("# A\n");
    await expect(readFile(path.join(projectRoot, "config", "skills", "warehouse", "SKILL.md"), "utf8")).resolves.toBe("# S\n");

    // Legacy sibling paths MUST NOT exist — proving the resolver actually controls visibility
    await expect(readFile(path.join(projectRoot, "semantic-layer", "x.yaml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates missing content subdirs on demand (mkdir -p)", async () => {
    const paths = configRootPaths();
    // config/ is empty; semantic-layer/ doesn't exist yet
    await safeWrite(paths, projectRoot, "semantic-layer/nested/deep/leaf.yaml", "deep\n");

    const leaf = path.join(projectRoot, "config", "semantic-layer", "nested", "deep", "leaf.yaml");
    await expect(readFile(leaf, "utf8")).resolves.toBe("deep\n");
  });

  it("resolves root-only paths (webui/config, .ktx-ui, ktx.yaml) against projectRoot, NOT configDir", async () => {
    const paths = configRootPaths();
    await safeWrite(paths, projectRoot, ".ktx-ui/b.json", "{}\n");
    await safeWrite(paths, projectRoot, "webui/config/access.yaml", "users: []\n");
    await safeWrite(paths, projectRoot, "ktx.yaml", "connections: {}\n");

    // Root-only paths stay at projectRoot even with configDir = projectRoot/config
    await expect(readFile(path.join(projectRoot, ".ktx-ui/b.json"), "utf8")).resolves.toBe("{}\n");
    await expect(readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8")).resolves.toBe("users: []\n");
    await expect(readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).resolves.toBe("connections: {}\n");

    // NOT under config/
    await expect(readFile(path.join(projectRoot, "config", "ktx.yaml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(projectRoot, "config", ".ktx-ui", "b.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects denied directories before writing", async () => {
    const paths = configRootPaths();
    await expectForbidden(() => safeWrite(paths, projectRoot, ".ktx/secrets/p", "secret"));
    await expectForbidden(() => safeWrite(paths, projectRoot, "raw-sources/r", "raw"));
    await expectForbidden(() => safeWrite(paths, projectRoot, ".git/c", "git"));
  });

  it("rejects traversal via content prefix that escapes configDir", async () => {
    const paths = configRootPaths();
    await expectForbidden(() => safeWrite(paths, projectRoot, "semantic-layer/../.ktx/secrets/p", "secret"));
    await expectForbidden(() => safeWrite(paths, projectRoot, "semantic-layer/../../escape.yaml", "x"));
  });

  it("rejects a symlink under config/semantic-layer that points at .ktx/secrets", async () => {
    const paths = configRootPaths();
    // Make sure target exists, then create the symlink under the new layout
    await mkdir(path.join(projectRoot, "config", "semantic-layer"), { recursive: true });
    await symlink(
      path.join(projectRoot, ".ktx", "secrets"),
      path.join(projectRoot, "config", "semantic-layer", "secret-link")
    );

    await expectForbidden(() => resolveWritable(paths, projectRoot, "semantic-layer/secret-link/p"));
  });

  it("rejects root-level content paths when only config/ content subdirs exist", async () => {
    // contentDir === projectRoot would accept "semantic-layer/...".
    // contentDir === projectRoot/config should NOT accept the same path.
    const paths = configRootPaths();
    await expectForbidden(() => resolveWritable(paths, projectRoot, "semantic-layer/at-root.yaml"));
    await expectForbidden(() => resolveWritable(paths, projectRoot, "wiki/page.md"));
    await expectForbidden(() => resolveWritable(paths, projectRoot, "evals/q.yaml"));
    await expectForbidden(() => resolveWritable(paths, projectRoot, "skills/foo/SKILL.md"));
  });
});

describe("fs-safe readable paths — config/ subdir layout", () => {
  it("reads content files from <configDir>/<prefix>/...", async () => {
    const paths = configRootPaths();
    await mkdir(path.join(projectRoot, "config", "wiki"), { recursive: true });
    await writeFile(path.join(projectRoot, "config", "wiki", "page.md"), "# Page\n", "utf8");

    const target = await assertReadable(paths, projectRoot, "wiki/page.md");
    await expect(readFile(target, "utf8")).resolves.toBe("# Page\n");
  });

  it("reads root-only files from projectRoot", async () => {
    const paths = configRootPaths();
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    const target = await assertReadable(paths, projectRoot, "ktx.yaml");
    await expect(readFile(target, "utf8")).resolves.toBe("connections: {}\n");
  });

  it("rejects reads from .ktx/secrets regardless of layout", async () => {
    const paths = configRootPaths();
    await expectForbidden(() => assertReadable(paths, projectRoot, ".ktx/secrets/p"));
  });

  it("rejects symlink reads under config/ that point at .ktx/secrets", async () => {
    const paths = configRootPaths();
    await mkdir(path.join(projectRoot, "config", "evals"), { recursive: true });
    await symlink(
      path.join(projectRoot, ".ktx", "secrets"),
      path.join(projectRoot, "config", "evals", "secret-link")
    );

    await expectForbidden(() => assertReadable(paths, projectRoot, "evals/secret-link/p"));
  });
});