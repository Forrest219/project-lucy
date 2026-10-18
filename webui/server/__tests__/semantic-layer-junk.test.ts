import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateContentPathsCache } from "../paths";
import { isSemanticLayerJunkName, scrubSemanticLayerJunk } from "../semantic-layer-junk";

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-junk-scrub-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await mkdir(path.join(projectRoot, "semantic-layer", "demo-mysql", "_schema"), { recursive: true });
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  invalidateContentPathsCache();
});

afterEach(async () => {
  invalidateContentPathsCache();
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("semantic-layer junk scrub", () => {
  it("detects AppleDouble and .DS_Store names", () => {
    expect(isSemanticLayerJunkName("._dataforai.yaml")).toBe(true);
    expect(isSemanticLayerJunkName(".DS_Store")).toBe(true);
    expect(isSemanticLayerJunkName("dataforai.yaml")).toBe(false);
    expect(isSemanticLayerJunkName("chatbi.yaml")).toBe(false);
  });

  it("removes junk under semantic-layer while keeping real YAML", async () => {
    const schemaDir = path.join(projectRoot, "semantic-layer", "demo-mysql", "_schema");
    const goodRel = "semantic-layer/demo-mysql/_schema/dataforai.yaml";
    const junkRel = "semantic-layer/demo-mysql/_schema/._dataforai.yaml";
    const dsRel = "semantic-layer/demo-mysql/.DS_Store";

    await writeFile(path.join(projectRoot, goodRel), "tables: {}\n", "utf8");
    await writeFile(path.join(projectRoot, junkRel), "not-an-object", "utf8");
    await writeFile(path.join(projectRoot, dsRel), "junk", "utf8");

    const removed = await scrubSemanticLayerJunk(projectRoot);
    expect(removed.sort()).toEqual([dsRel, junkRel].sort());
    await expect(readFile(path.join(projectRoot, goodRel), "utf8")).resolves.toContain("tables:");
    await expect(readFile(path.join(schemaDir, "._dataforai.yaml"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
