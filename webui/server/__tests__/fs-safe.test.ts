import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertReadable, ForbiddenPathError, resolveWritable, safeWrite } from "../fs-safe";

let projectRoot: string;

async function makeProjectRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-fs-safe-"));
  await mkdir(path.join(root, "semantic-layer"), { recursive: true });
  await mkdir(path.join(root, "knowledge"), { recursive: true });
  await mkdir(path.join(root, "skills"), { recursive: true });
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  await mkdir(path.join(root, ".ktx", "secrets"), { recursive: true });
  await mkdir(path.join(root, "raw-sources"), { recursive: true });
  await mkdir(path.join(root, ".git"), { recursive: true });
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

describe("fs-safe writable paths", () => {
  it("allows writes under semantic-layer, knowledge, skills, and .ktx-ui", async () => {
    await safeWrite(projectRoot, "semantic-layer/x.yaml", "a: 1\n");
    await safeWrite(projectRoot, "knowledge/a.md", "# A\n");
    await safeWrite(projectRoot, "skills/warehouse/SKILL.md", "# S\n");
    await safeWrite(projectRoot, ".ktx-ui/b.json", "{}\n");

    await expect(readFile(path.join(projectRoot, "semantic-layer/x.yaml"), "utf8")).resolves.toBe("a: 1\n");
    await expect(readFile(path.join(projectRoot, "knowledge/a.md"), "utf8")).resolves.toBe("# A\n");
    await expect(readFile(path.join(projectRoot, "skills/warehouse/SKILL.md"), "utf8")).resolves.toBe("# S\n");
    await expect(readFile(path.join(projectRoot, ".ktx-ui/b.json"), "utf8")).resolves.toBe("{}\n");
  });

  it("rejects denied directories before writing", async () => {
    await expectForbidden(() => safeWrite(projectRoot, ".ktx/secrets/p", "secret"));
    await expectForbidden(() => safeWrite(projectRoot, "raw-sources/r", "raw"));
    await expectForbidden(() => safeWrite(projectRoot, ".git/c", "git"));
  });

  it("rejects path traversal into denied directories", async () => {
    await expectForbidden(() => safeWrite(projectRoot, "semantic-layer/../.ktx/secrets/p", "secret"));
  });

  it("rejects symlinks that resolve into denied directories", async () => {
    await symlink(path.join(projectRoot, ".ktx", "secrets"), path.join(projectRoot, "semantic-layer", "secret-link"));

    await expectForbidden(() => resolveWritable(projectRoot, "semantic-layer/secret-link/p"));
  });
});

describe("fs-safe readable paths", () => {
  it("rejects reads from .ktx/secrets", async () => {
    await expectForbidden(() => assertReadable(projectRoot, ".ktx/secrets/p"));
  });

  it("rejects symlink reads that resolve into .ktx/secrets", async () => {
    await symlink(path.join(projectRoot, ".ktx", "secrets"), path.join(projectRoot, "knowledge", "secret-link"));

    await expectForbidden(() => assertReadable(projectRoot, "knowledge/secret-link/p"));
  });
});
