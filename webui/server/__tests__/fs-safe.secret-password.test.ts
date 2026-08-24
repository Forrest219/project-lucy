import { access, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertReadable,
  ForbiddenPathError,
  safeRemoveSecretPasswordIfExists,
  safeWrite,
  safeWriteNewSecretPassword,
  SecretAlreadyExistsError
} from "../fs-safe";

let projectRoot: string;

async function makeProjectRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-fs-safe-secret-"));
  await mkdir(path.join(root, "semantic-layer"), { recursive: true });
  await mkdir(path.join(root, ".ktx", "secrets"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
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

describe("safeWriteNewSecretPassword (Spec 124 Phase A)", () => {
  it("writes only the allowed password filename with mode 0600", async () => {
    const relPath = ".ktx/secrets/demo-mysql-password";
    await safeWriteNewSecretPassword(projectRoot, relPath, "s3cret-value");

    const abs = path.join(projectRoot, relPath);
    await expect(readFile(abs, "utf8")).resolves.toBe("s3cret-value");
    const mode = (await stat(abs)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("still rejects generic safeWrite into .ktx/secrets", async () => {
    await expectForbidden(() => safeWrite(projectRoot, ".ktx/secrets/demo-mysql-password", "x"));
  });

  it("still rejects assertReadable on the written secret", async () => {
    const relPath = ".ktx/secrets/demo-mysql-password";
    await safeWriteNewSecretPassword(projectRoot, relPath, "s3cret-value");
    await expectForbidden(() => assertReadable(projectRoot, relPath));
  });

  it("refuses overwrite when the password file already exists", async () => {
    const relPath = ".ktx/secrets/demo-mysql-password";
    await safeWriteNewSecretPassword(projectRoot, relPath, "first");
    await expect(safeWriteNewSecretPassword(projectRoot, relPath, "second")).rejects.toBeInstanceOf(
      SecretAlreadyExistsError
    );
    await expect(readFile(path.join(projectRoot, relPath), "utf8")).resolves.toBe("first");
  });

  it("rejects non-conforming secret paths", async () => {
    await expectForbidden(() =>
      safeWriteNewSecretPassword(projectRoot, ".ktx/secrets/NotValid-password", "x")
    );
    await expectForbidden(() =>
      safeWriteNewSecretPassword(projectRoot, ".ktx/secrets/demo-mysql", "x")
    );
    await expectForbidden(() =>
      safeWriteNewSecretPassword(projectRoot, ".ktx/secrets/../secrets/demo-mysql-password", "x")
    );
    await expectForbidden(() =>
      safeWriteNewSecretPassword(projectRoot, "semantic-layer/demo-mysql-password", "x")
    );
  });

  it("rejects empty password", async () => {
    await expectForbidden(() =>
      safeWriteNewSecretPassword(projectRoot, ".ktx/secrets/demo-mysql-password", "")
    );
  });

  it("refuses writing when .ktx/secrets is a symlink outside the project", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "ktx-secret-outside-"));
    try {
      await rm(path.join(projectRoot, ".ktx", "secrets"), { recursive: true, force: true });
      await symlink(outside, path.join(projectRoot, ".ktx", "secrets"));
      await expectForbidden(() =>
        safeWriteNewSecretPassword(projectRoot, ".ktx/secrets/demo-mysql-password", "x")
      );
      await expect(access(path.join(outside, "demo-mysql-password"))).rejects.toMatchObject({
        code: "ENOENT"
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("safeRemoveSecretPasswordIfExists", () => {
  it("removes a previously written password file and no-ops when missing", async () => {
    const relPath = ".ktx/secrets/demo-mysql-password";
    await safeWriteNewSecretPassword(projectRoot, relPath, "to-remove");
    await safeRemoveSecretPasswordIfExists(projectRoot, relPath);
    await expect(access(path.join(projectRoot, relPath))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(safeRemoveSecretPasswordIfExists(projectRoot, relPath)).resolves.toBeUndefined();
  });

  it("rejects removing non-conforming paths", async () => {
    await expectForbidden(() =>
      safeRemoveSecretPasswordIfExists(projectRoot, ".ktx/secrets/other-file")
    );
  });
});
