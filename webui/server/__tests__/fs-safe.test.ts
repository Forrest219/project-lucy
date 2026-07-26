import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertReadable, ForbiddenPathError, resolveWritable, safeWrite } from "../fs-safe";

let projectRoot: string;

async function makeProjectRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-fs-safe-"));
  await mkdir(path.join(root, "semantic-layer"), { recursive: true });
  await mkdir(path.join(root, "evals"), { recursive: true });
  await mkdir(path.join(root, "skills"), { recursive: true });
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  await mkdir(path.join(root, ".ktx", "secrets"), { recursive: true });
  await mkdir(path.join(root, "raw-sources"), { recursive: true });
  await mkdir(path.join(root, ".git"), { recursive: true });
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
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
  it("allows writes under semantic-layer, evals, skills, .ktx-ui, and webui/config", async () => {
    await safeWrite(projectRoot, "semantic-layer/x.yaml", "a: 1\n");
    await safeWrite(projectRoot, "evals/a.md", "# A\n");
    await safeWrite(projectRoot, "skills/warehouse/SKILL.md", "# S\n");
    await safeWrite(projectRoot, ".ktx-ui/b.json", "{}\n");
    await safeWrite(projectRoot, "webui/config/access.yaml", "users: []\n");

    await expect(readFile(path.join(projectRoot, "semantic-layer/x.yaml"), "utf8")).resolves.toBe("a: 1\n");
    await expect(readFile(path.join(projectRoot, "evals/a.md"), "utf8")).resolves.toBe("# A\n");
    await expect(readFile(path.join(projectRoot, "skills/warehouse/SKILL.md"), "utf8")).resolves.toBe("# S\n");
    await expect(readFile(path.join(projectRoot, ".ktx-ui/b.json"), "utf8")).resolves.toBe("{}\n");
    await expect(readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8")).resolves.toBe("users: []\n");
  });

  it("rejects denied directories before writing", async () => {
    await expectForbidden(() => safeWrite(projectRoot, ".ktx/secrets/p", "secret"));
    await expectForbidden(() => safeWrite(projectRoot, "raw-sources/r", "raw"));
    await expectForbidden(() => safeWrite(projectRoot, ".git/c", "git"));
  });

  it("rejects path traversal into denied directories", async () => {
    await expectForbidden(() => safeWrite(projectRoot, "semantic-layer/../.ktx/secrets/p", "secret"));
  });

  it("rejects webui/config path traversal to outside allowed dirs", async () => {
    await expectForbidden(() => safeWrite(projectRoot, "webui/config/../../../secrets", "secret"));
  });

  it("rejects symlinks that resolve into denied directories", async () => {
    await symlink(path.join(projectRoot, ".ktx", "secrets"), path.join(projectRoot, "semantic-layer", "secret-link"));

    await expectForbidden(() => resolveWritable(projectRoot, "semantic-layer/secret-link/p"));
  });

  it("allows ktx.yaml through the ALLOW_FILES channel for the M6 add-schema flow", async () => {
    await safeWrite(projectRoot, "ktx.yaml", "connections: {}\n");
    await expect(readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).resolves.toBe("connections: {}\n");
  });

  it("rejects writes to other root-level files (e.g. README.md, package.json, .env)", async () => {
    await expectForbidden(() => safeWrite(projectRoot, "README.md", "# nope"));
    await expectForbidden(() => safeWrite(projectRoot, "package.json", "{}"));
    await expectForbidden(() => safeWrite(projectRoot, ".env", "SECRET=x"));
  });

  it("rejects writing into a path that symlinks into .ktx/secrets even when ALLOW_FILES matches", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-fs-safe-outside-"));
    try {
      const outsideFile = path.join(outside, "stolen.yaml");
      await writeFile(outsideFile, "original\n", "utf8");
      await symlink(outsideFile, path.join(projectRoot, "ktx.yaml"));

      await expectForbidden(() => safeWrite(projectRoot, "ktx.yaml", "overwritten\n"));
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("original\n");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects ktx.yaml when it is a symlink to an external directory", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-fs-safe-outside-dir-"));
    try {
      await symlink(outside, path.join(projectRoot, "ktx.yaml"));
      await expectForbidden(() => safeWrite(projectRoot, "ktx.yaml", "connections: {}\n"));
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a dangling ktx.yaml symlink before it can create an external file", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-fs-safe-dangling-"));
    try {
      const outsideFile = path.join(outside, "not-created.yaml");
      await symlink(outsideFile, path.join(projectRoot, "ktx.yaml"));

      await expectForbidden(() => safeWrite(projectRoot, "ktx.yaml", "connections: {}\n"));
      await expect(readFile(outsideFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("fs-safe readable paths", () => {
  it("rejects reads from .ktx/secrets", async () => {
    await expectForbidden(() => assertReadable(projectRoot, ".ktx/secrets/p"));
  });

  it("rejects symlink reads that resolve into .ktx/secrets", async () => {
    await symlink(path.join(projectRoot, ".ktx", "secrets"), path.join(projectRoot, "evals", "secret-link"));

    await expectForbidden(() => assertReadable(projectRoot, "evals/secret-link/p"));
  });
});
