import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeLegacyLicenseFile } from "../remove-legacy-license-file.js";

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("removeLegacyLicenseFile", () => {
  it("deletes .ktx-ui/license.yaml and leaves the directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lucy-license-file-"));
    roots.push(root);
    await mkdir(path.join(root, ".ktx-ui"));
    const file = path.join(root, ".ktx-ui", "license.yaml");
    await writeFile(file, "version: \"1\"\n", "utf8");
    await removeLegacyLicenseFile(root);
    await expect(readFile(file, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does nothing when the file is absent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lucy-license-file-"));
    roots.push(root);
    await expect(removeLegacyLicenseFile(root)).resolves.toBeUndefined();
  });
});
