/**
 * P1-64 / REQ-030-085 Wave B — final-set sourceName uniqueness on catalog validate/upload (SC-03–05).
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CatalogAssetValidationError,
  uploadCatalogAsset,
  validateCatalogAsset,
  __test as catalogAssetTest
} from "../catalog-assets";

const CONN = "demo-mysql";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function weatherCityYaml(): string {
  return "tables:\n  city:\n    table: weather.city\n";
}

function odsBareCityYaml(): string {
  return "tables:\n  city:\n    table: ods.city\n";
}

function odsPrefixedCityYaml(): string {
  return "tables:\n  ods_city:\n    table: ods.city\n";
}

function odsQuotedCityYaml(): string {
  return 'tables:\n  "City":\n    table: ods.city\n';
}

function odsCity2Yaml(): string {
  return "tables:\n  ods_city_2:\n    table: ods.city\n";
}

function conflictPairYaml(schemaA: string, schemaB: string, bare: string): {
  a: string;
  b: string;
} {
  return {
    a: `tables:\n  ${bare}:\n    table: ${schemaA}.${bare}\n`,
    b: `tables:\n  ${bare}:\n    table: ${schemaB}.${bare}\n`
  };
}

async function makeProject(manifestFiles: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-snc-catalog-"));
  const yaml = `connections:
  ${CONN}:
    driver: mysql
    schemas:
      - weather
      - ods
      - dim
      - legacy_a
      - legacy_b
      - fix_a
      - fix_b
    enabled_tables: []
`;
  await writeFile(path.join(root, "ktx.yaml"), yaml, "utf8");
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  const dir = path.join(root, "config", "semantic-layer", CONN, "_schema");
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(manifestFiles)) {
    await writeFile(path.join(dir, `${name}.yaml`), content, "utf8");
  }
  return root;
}

function manifestAbs(root: string, schema: string): string {
  return path.join(root, "config", "semantic-layer", CONN, "_schema", `${schema}.yaml`);
}

async function listReleaseIds(root: string): Promise<string[]> {
  const sidecar = path.join(root, ".ktx-ui", "semantic-asset-releases.json");
  try {
    const raw = JSON.parse(await readFile(sidecar, "utf8")) as {
      releases?: Array<{ releaseId?: string }>;
    };
    return (raw.releases ?? [])
      .map((r) => r.releaseId)
      .filter((id): id is string => typeof id === "string");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function listJournalFiles(root: string): Promise<string[]> {
  const dir = path.join(root, ".ktx-ui", "semantic-recovery-journals");
  try {
    return (await readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function listUploadRecords(root: string): Promise<unknown[]> {
  const sidecar = path.join(root, ".ktx-ui", "catalog-asset-uploads.json");
  try {
    const raw = JSON.parse(await readFile(sidecar, "utf8")) as { records?: unknown[] };
    return raw.records ?? [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

describe("catalog sourceName final-set uniqueness (SC-03/05)", () => {
  let projectRoot: string | undefined;

  beforeEach(() => {
    catalogAssetTest.beforePublishLock = null;
  });

  afterEach(async () => {
    catalogAssetTest.beforePublishLock = null;
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
      projectRoot = undefined;
    }
  });

  it("SC-03: weather city blocks ods bare city validate/upload with DUPLICATE_SOURCE_NAME", async () => {
    projectRoot = await makeProject({ weather: weatherCityYaml() });
    const content = odsBareCityYaml();

    const validation = await validateCatalogAsset(projectRoot, {
      connectionId: CONN,
      schema: "ods",
      assetKind: "schema_manifest",
      filename: "ods.yaml",
      content
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.code === "DUPLICATE_SOURCE_NAME")).toBe(true);
    const dup = validation.errors.find((e) => e.code === "DUPLICATE_SOURCE_NAME");
    expect(dup?.message).toMatch(/weather\.city/i);
    expect(dup?.message).toMatch(/ods\.city/i);
    expect(dup?.message).toMatch(/ods_city|重扫|重新扫描/i);

    expect(validation.sourceNameConflicts.length).toBeGreaterThanOrEqual(1);
    const cityConflict = validation.sourceNameConflicts.find((c) => c.sourceName === "city");
    expect(cityConflict?.involvesCandidate).toBe(true);
    expect(cityConflict?.suggestedSourceName).toBe("ods_city");
    const physicals = (cityConflict?.entries ?? []).map((e) => e.physicalTable).sort();
    expect(physicals).toEqual(["ods.city", "weather.city"]);

    const beforeHash = sha256(await readFile(manifestAbs(projectRoot, "weather"), "utf8"));
    const beforeUploads = await listUploadRecords(projectRoot);
    const beforeReleases = await listReleaseIds(projectRoot);
    const beforeJournals = await listJournalFiles(projectRoot);

    await expect(
      uploadCatalogAsset(projectRoot, {
        connectionId: CONN,
        schema: "ods",
        assetKind: "schema_manifest",
        filename: "ods.yaml",
        content
      })
    ).rejects.toMatchObject({
      name: "CatalogAssetValidationError",
      code: "DUPLICATE_SOURCE_NAME",
      statusCode: 400
    });

    await expect(readFile(manifestAbs(projectRoot, "ods"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(sha256(await readFile(manifestAbs(projectRoot, "weather"), "utf8"))).toBe(beforeHash);
    expect(await listUploadRecords(projectRoot)).toEqual(beforeUploads);
    expect(await listReleaseIds(projectRoot)).toEqual(beforeReleases);
    expect(await listJournalFiles(projectRoot)).toEqual(beforeJournals);
  });

  it("accepts unique ods_city; normalizes case/quote; secondary prefix collision", async () => {
    projectRoot = await makeProject({ weather: weatherCityYaml() });

    const ok = await validateCatalogAsset(projectRoot, {
      connectionId: CONN,
      schema: "ods",
      assetKind: "schema_manifest",
      filename: "ods.yaml",
      content: odsPrefixedCityYaml()
    });
    expect(ok.valid).toBe(true);
    expect(ok.errors).toEqual([]);
    expect(ok.sourceNameConflicts).toEqual([]);

    const caseClash = await validateCatalogAsset(projectRoot, {
      connectionId: CONN,
      schema: "ods",
      assetKind: "schema_manifest",
      filename: "ods.yaml",
      content: odsQuotedCityYaml()
    });
    expect(caseClash.valid).toBe(false);
    expect(caseClash.errors.some((e) => e.code === "DUPLICATE_SOURCE_NAME")).toBe(true);

    await writeFile(
      manifestAbs(projectRoot, "dim"),
      "tables:\n  ods_city:\n    table: dim.ods_city\n",
      "utf8"
    );

    const prefixClash = await validateCatalogAsset(projectRoot, {
      connectionId: CONN,
      schema: "ods",
      assetKind: "schema_manifest",
      filename: "ods.yaml",
      content: odsPrefixedCityYaml()
    });
    expect(prefixClash.valid).toBe(false);
    const conflict = prefixClash.sourceNameConflicts.find((c) => c.sourceName === "ods_city");
    expect(conflict?.involvesCandidate).toBe(true);
    expect(conflict?.suggestedSourceName).toBe("ods_city_2");

    const suffixOk = await validateCatalogAsset(projectRoot, {
      connectionId: CONN,
      schema: "ods",
      assetKind: "schema_manifest",
      filename: "ods.yaml",
      content: odsCity2Yaml()
    });
    expect(suffixOk.valid).toBe(true);
  });

  it("replaces target old file instead of double-counting it", async () => {
    projectRoot = await makeProject({
      weather: weatherCityYaml(),
      ods: odsBareCityYaml()
    });

    const validation = await validateCatalogAsset(projectRoot, {
      connectionId: CONN,
      schema: "ods",
      assetKind: "schema_manifest",
      filename: "ods.yaml",
      content: odsPrefixedCityYaml()
    });
    expect(validation.valid).toBe(true);
    expect(validation.exists).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.sourceNameConflicts.filter((c) => c.sourceName === "city")).toEqual([]);
  });

  it("SC-05: unrelated old conflicts warn; stepwise unique uploads ok; candidate clash cannot use D6", async () => {
    const pair1 = conflictPairYaml("legacy_a", "legacy_b", "widget");
    const pair2 = conflictPairYaml("fix_a", "fix_b", "gadget");
    projectRoot = await makeProject({
      weather: weatherCityYaml(),
      legacy_a: pair1.a,
      legacy_b: pair1.b,
      fix_a: pair2.a,
      fix_b: pair2.b
    });

    const stillClashing = await validateCatalogAsset(projectRoot, {
      connectionId: CONN,
      schema: "ods",
      assetKind: "schema_manifest",
      filename: "ods.yaml",
      content: odsBareCityYaml()
    });
    expect(stillClashing.valid).toBe(false);
    expect(stillClashing.errors.some((e) => e.code === "DUPLICATE_SOURCE_NAME")).toBe(true);
    expect(
      stillClashing.warnings.filter((w) => w.code === "PREEXISTING_SOURCE_NAME_CONFLICT").length
    ).toBeGreaterThanOrEqual(2);
    expect(stillClashing.sourceNameConflicts.some((c) => c.sourceName === "widget")).toBe(true);
    expect(stillClashing.sourceNameConflicts.some((c) => c.sourceName === "gadget")).toBe(true);

    const fixLegacyB = await validateCatalogAsset(projectRoot, {
      connectionId: CONN,
      schema: "legacy_b",
      assetKind: "schema_manifest",
      filename: "legacy_b.yaml",
      content: "tables:\n  legacy_b_widget:\n    table: legacy_b.widget\n"
    });
    expect(fixLegacyB.valid).toBe(true);
    expect(
      fixLegacyB.warnings.some((w) => w.code === "PREEXISTING_SOURCE_NAME_CONFLICT")
    ).toBe(true);
    expect(fixLegacyB.sourceNameConflicts.some((c) => c.sourceName === "gadget")).toBe(true);
    expect(fixLegacyB.sourceNameConflicts.some((c) => c.involvesCandidate)).toBe(false);

    await uploadCatalogAsset(projectRoot, {
      connectionId: CONN,
      schema: "legacy_b",
      assetKind: "schema_manifest",
      filename: "legacy_b.yaml",
      content: "tables:\n  legacy_b_widget:\n    table: legacy_b.widget\n",
      confirmOverwrite: true
    });

    // Unrelated candidate still sees the remaining gadget pair as D6 warnings.
    const afterFirst = await validateCatalogAsset(projectRoot, {
      connectionId: CONN,
      schema: "ods",
      assetKind: "schema_manifest",
      filename: "ods.yaml",
      content: odsPrefixedCityYaml()
    });
    expect(afterFirst.valid).toBe(true);
    expect(afterFirst.sourceNameConflicts.some((c) => c.sourceName === "widget")).toBe(false);
    expect(afterFirst.sourceNameConflicts.some((c) => c.sourceName === "gadget")).toBe(true);
    expect(
      afterFirst.warnings.some((w) => w.code === "PREEXISTING_SOURCE_NAME_CONFLICT")
    ).toBe(true);

    await uploadCatalogAsset(projectRoot, {
      connectionId: CONN,
      schema: "fix_b",
      assetKind: "schema_manifest",
      filename: "fix_b.yaml",
      content: "tables:\n  fix_b_gadget:\n    table: fix_b.gadget\n",
      confirmOverwrite: true
    });

    const clean = await validateCatalogAsset(projectRoot, {
      connectionId: CONN,
      schema: "ods",
      assetKind: "schema_manifest",
      filename: "ods.yaml",
      content: odsPrefixedCityYaml()
    });
    expect(clean.valid).toBe(true);
    expect(clean.sourceNameConflicts).toEqual([]);
    expect(clean.warnings.filter((w) => w.code === "PREEXISTING_SOURCE_NAME_CONFLICT")).toEqual([]);
  });

  it("fail-closed: unreadable sibling manifest is not treated as no-conflict", async () => {
    projectRoot = await makeProject({ weather: weatherCityYaml() });
    await writeFile(manifestAbs(projectRoot, "broken"), "tables: [\n  not: valid:::", "utf8");

    const validation = await validateCatalogAsset(projectRoot, {
      connectionId: CONN,
      schema: "ods",
      assetKind: "schema_manifest",
      filename: "ods.yaml",
      content: odsPrefixedCityYaml()
    });
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(validation.errors.some((e) => e.code === "DUPLICATE_SOURCE_NAME")).toBe(false);
  });
});

describe("catalog sourceName publish-lock race (SC-04 / D7)", () => {
  let projectRoot: string | undefined;

  beforeEach(() => {
    catalogAssetTest.beforePublishLock = null;
  });

  afterEach(async () => {
    catalogAssetTest.beforePublishLock = null;
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
      projectRoot = undefined;
    }
  });

  it("two bare-city candidates: both pass early validate; in-lock revalidate admits exactly one", async () => {
    projectRoot = await makeProject();

    const weatherReq = {
      connectionId: CONN,
      schema: "weather",
      assetKind: "schema_manifest" as const,
      filename: "weather.yaml",
      content: weatherCityYaml()
    };
    const odsReq = {
      connectionId: CONN,
      schema: "ods",
      assetKind: "schema_manifest" as const,
      filename: "ods.yaml",
      content: odsBareCityYaml()
    };

    const earlyWeather = await validateCatalogAsset(projectRoot, weatherReq);
    const earlyOds = await validateCatalogAsset(projectRoot, odsReq);
    expect(earlyWeather.valid).toBe(true);
    expect(earlyOds.valid).toBe(true);

    // Barrier: both uploads pass early validate on the empty final-set, then
    // weather enters the lock first; ods waits until weather finishes so the
    // loser runs real in-lock revalidate (not publish-busy / mocked early-only).
    let weatherAtLock = false;
    let odsAtLock = false;
    let weatherUploadFinished!: () => void;
    const weatherDone = new Promise<void>((resolve) => {
      weatherUploadFinished = resolve;
    });

    catalogAssetTest.beforePublishLock = async (request) => {
      if (request.schema === "weather") {
        weatherAtLock = true;
        while (!odsAtLock) {
          await new Promise((r) => setTimeout(r, 5));
        }
        return;
      }
      if (request.schema === "ods") {
        odsAtLock = true;
        while (!weatherAtLock) {
          await new Promise((r) => setTimeout(r, 5));
        }
        await weatherDone;
      }
    };

    const weatherUpload = uploadCatalogAsset(projectRoot, weatherReq).then((result) => {
      weatherUploadFinished();
      return result;
    });
    const odsUpload = uploadCatalogAsset(projectRoot, odsReq);

    const settled = await Promise.allSettled([weatherUpload, odsUpload]);
    catalogAssetTest.beforePublishLock = null;

    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    const rejected = settled.filter((s) => s.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(CatalogAssetValidationError);
    expect(err).toMatchObject({ code: "DUPLICATE_SOURCE_NAME", statusCode: 400 });
    expect((err as CatalogAssetValidationError).validation.valid).toBe(false);

    const weatherOnDisk = await readFile(manifestAbs(projectRoot, "weather"), "utf8");
    expect(weatherOnDisk).toContain("weather.city");
    await expect(readFile(manifestAbs(projectRoot, "ods"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    expect(await listUploadRecords(projectRoot)).toHaveLength(1);
    expect(await listJournalFiles(projectRoot)).toHaveLength(1);
  });
});
