/**
 * Spec 180 §4 — drift diagnostic and one-way sync behaviour.
 *
 * The three scenarios in the spec:
 *   1. mirror has a file the content root lacks → after sync the content root
 *      is still missing the file and the diagnostic reports it as `mirror_only`.
 *   2. content root has a file the mirror lacks → after sync the mirror
 *      catches up and the diagnostic no longer flags it as `authoring_only`.
 *   3. `LUCY_CONTENT_ROOT=.` ⇒ `mirrorActive` is false and project-root
 *      files are NOT reported as drift.
 *
 * No test asserts (or performs) any delete: sync stays one-way.
 */
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectContentLayout } from "../content-layout";
import { syncContentToProjectRoot } from "../content-mirror";
import { invalidateContentPathsCache, type ContentPaths } from "../paths";

let projectRoot: string | undefined;

function pathsWith(configDir: string): ContentPaths {
  return {
    configDir,
    semanticLayer: path.join(configDir, "semantic-layer"),
    wiki: path.join(configDir, "wiki"),
    evals: path.join(configDir, "evals"),
    skills: path.join(configDir, "skills"),
    source: "env"
  };
}

async function makeProjectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-content-layout-"));
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  return root;
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursive(absDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      const childAbs = path.join(dir, entry.name);
      const childRel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(childAbs, childRel);
        continue;
      }
      if (entry.isFile()) {
        out.push(childRel);
      }
    }
  }
  await walk(absDir, "");
  return out.sort();
}

beforeEach(() => {
  delete process.env.LUCY_CONTENT_ROOT;
  invalidateContentPathsCache();
});

afterEach(async () => {
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true });
    projectRoot = undefined;
  }
});

describe("Spec 180 §4.1 — mirror-only file is not pulled into the content root", () => {
  it("keeps the file in the mirror only and reports it as mirror_only", async () => {
    projectRoot = await makeProjectRoot();
    const configDir = path.join(projectRoot, "content");
    const paths = pathsWith(configDir);

    // Content root has one file the mirror will sync to.
    await mkdir(path.join(configDir, "semantic-layer"), { recursive: true });
    await mkdir(path.join(projectRoot, "semantic-layer"), { recursive: true });
    await writeFile(
      path.join(configDir, "semantic-layer", "shared.yaml"),
      "name: shared\n",
      "utf8"
    );
    // Mirror has an extra file the content root never had — pre-A2 customer
    // legacy, dropped on the floor, etc. Sync must not write it back to
    // the content root.
    await writeFile(
      path.join(projectRoot, "semantic-layer", "extra.yaml"),
      "name: extra\n",
      "utf8"
    );

    const result = await syncContentToProjectRoot(projectRoot, paths);
    expect(result.failed).toBe(0);

    // Content root still only has shared.yaml; no `extra.yaml` was copied in.
    const contentFiles = await listFilesRecursive(path.join(configDir, "semantic-layer"));
    expect(contentFiles).toEqual(["shared.yaml"]);
    // Mirror keeps its own `extra.yaml` untouched.
    expect(await exists(path.join(projectRoot, "semantic-layer", "extra.yaml"))).toBe(true);

    const layout = await collectContentLayout(projectRoot, paths);
    expect(layout.mirrorActive).toBe(true);
    expect(layout.drift).toEqual([
      { dir: "semantic-layer", relPath: "extra.yaml", kind: "mirror_only" }
    ]);
    expect(layout.driftTruncated).toBe(false);
  });
});

describe("Spec 180 §4.2 — authoring-only file syncs into the mirror and clears drift", () => {
  it("copies the file into the mirror and drops it from the authoring-only list", async () => {
    projectRoot = await makeProjectRoot();
    const configDir = path.join(projectRoot, "content");
    const paths = pathsWith(configDir);

    await mkdir(path.join(configDir, "semantic-layer"), { recursive: true });
    await mkdir(path.join(projectRoot, "semantic-layer"), { recursive: true });
    await writeFile(
      path.join(configDir, "semantic-layer", "new.yaml"),
      "name: new\n",
      "utf8"
    );

    // Sanity-check: before sync, the new file is reported as authoring_only.
    const before = await collectContentLayout(projectRoot, paths);
    expect(before.drift).toEqual([
      { dir: "semantic-layer", relPath: "new.yaml", kind: "authoring_only" }
    ]);

    const result = await syncContentToProjectRoot(projectRoot, paths);
    expect(result.failed).toBe(0);
    // The file is now in the mirror.
    expect(await exists(path.join(projectRoot, "semantic-layer", "new.yaml"))).toBe(true);

    const after = await collectContentLayout(projectRoot, paths);
    // No drift remains for that path; spec §3 forbids writing back, and the
    // file must NOT appear anywhere new under the content root.
    expect(after.drift).toEqual([]);
    expect(after.driftTruncated).toBe(false);

    // Sanity: the content root still owns only the file it owned before.
    const contentFiles = await listFilesRecursive(path.join(configDir, "semantic-layer"));
    expect(contentFiles).toEqual(["new.yaml"]);
  });
});

describe("Spec 180 §4.3 — LUCY_CONTENT_ROOT=. disables the diagnostic", () => {
  it("mirrorActive is false and project-root files do not appear as drift", async () => {
    projectRoot = await makeProjectRoot();
    // Legacy sibling layout: content root IS the project root.
    const paths = pathsWith(projectRoot);

    // A file lives only at <projectRoot>/semantic-layer/. With the mirror
    // disabled, this MUST NOT be reported as drift against the content root.
    await mkdir(path.join(projectRoot, "semantic-layer"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "semantic-layer", "legacy.yaml"),
      "name: legacy\n",
      "utf8"
    );

    const layout = await collectContentLayout(projectRoot, paths);
    expect(layout.mirrorActive).toBe(false);
    expect(layout.drift).toEqual([]);
    expect(layout.driftTruncated).toBe(false);
    // authoring and mirror point at the same dirs, which is the honest answer
    // for this layout — the UI should still show *where* the dirs live.
    expect(layout.authoring.semanticLayer).toBe(path.join(projectRoot, "semantic-layer"));
    expect(layout.mirror.semanticLayer).toBe(path.join(projectRoot, "semantic-layer"));
    expect(layout.contentRootSource).toBe("env");
  });

  it("an extra file under the project root still does not flip mirrorActive", async () => {
    projectRoot = await makeProjectRoot();
    const paths = pathsWith(projectRoot);

    await mkdir(path.join(projectRoot, "wiki"), { recursive: true });
    await writeFile(path.join(projectRoot, "wiki", "playbook.md"), "# Playbook\n", "utf8");

    const layout = await collectContentLayout(projectRoot, paths);
    expect(layout.mirrorActive).toBe(false);
    expect(layout.drift.some((entry) => entry.relPath === "wiki/playbook.md")).toBe(false);
  });
});
