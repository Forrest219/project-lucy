import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LEGACY_TABLE_YAML_HISTORY_ROOT,
  TABLE_YAML_HISTORY_ROOT,
  TABLE_YAML_VERSION_RETENTION_LIMIT,
  createTableYamlVersionSnapshot,
  listTableYamlVersions,
  readTableYamlVersion,
  relocateTableYamlHistoryOutOfSemanticLayer,
  restoreTableYamlVersionDraft
} from "../table-yaml-history";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-table-yaml-history-"));
  await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer"), { recursive: true });
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("table YAML version history", () => {
  it("stores snapshots under .ktx-ui rather than semantic-layer", async () => {
    const version = await createTableYamlVersionSnapshot(
      projectRoot,
      "mysql-aliyun",
      "dataforai",
      "superstore_orders",
      "table: dataforai.superstore_orders\nversion: 1\n",
      { operation: "save" }
    );
    expect(version).toBeTruthy();
    const indexPath = path.join(projectRoot, ...TABLE_YAML_HISTORY_ROOT.split("/"), "table-yaml-index.json");
    await expect(readFile(indexPath, "utf8")).resolves.toContain(version!.versionId);
    await expect(access(path.join(projectRoot, ...LEGACY_TABLE_YAML_HISTORY_ROOT.split("/")))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("relocates legacy semantic-layer/.lucy-history before KTX walks the tree", async () => {
    const legacyRoot = path.join(projectRoot, ...LEGACY_TABLE_YAML_HISTORY_ROOT.split("/"));
    await mkdir(path.join(legacyRoot, "snapshots"), { recursive: true });
    await writeFile(path.join(legacyRoot, "table-yaml-index.json"), JSON.stringify({
      schemaVersion: 1,
      tables: {
        "mysql-aliyun/dataforai/superstore_orders": {
          key: "mysql-aliyun/dataforai/superstore_orders",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          versions: []
        }
      }
    }), "utf8");

    const result = await relocateTableYamlHistoryOutOfSemanticLayer(projectRoot);
    expect(result).toEqual({ relocated: true, removedLegacy: true });
    await expect(access(legacyRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(path.join(projectRoot, ...TABLE_YAML_HISTORY_ROOT.split("/"), "table-yaml-index.json"), "utf8")
    ).resolves.toContain("superstore_orders");
  });

  it("deduplicates unchanged YAML and keeps only the latest five snapshots", async () => {
    const first = await createTableYamlVersionSnapshot(
      projectRoot,
      "mysql-aliyun",
      "dataforai",
      "superstore_orders",
      "table: dataforai.superstore_orders\nversion: 1\n",
      { operation: "save", affectedFiles: ["semantic-layer/mysql-aliyun/_schema/dataforai.yaml"] }
    );
    expect(first).toBeTruthy();

    const duplicate = await createTableYamlVersionSnapshot(
      projectRoot,
      "mysql-aliyun",
      "dataforai",
      "superstore_orders",
      "table: dataforai.superstore_orders\nversion: 1\n",
      { operation: "save" }
    );
    expect(duplicate).toBeNull();

    const versionIds = [first!.versionId];
    for (let index = 2; index <= 6; index += 1) {
      const version = await createTableYamlVersionSnapshot(
        projectRoot,
        "mysql-aliyun",
        "dataforai",
        "superstore_orders",
        `table: dataforai.superstore_orders\nversion: ${index}\n`,
        { operation: "save" }
      );
      versionIds.push(version!.versionId);
    }

    const list = await listTableYamlVersions(projectRoot, "mysql-aliyun", "dataforai", "superstore_orders");
    expect(list.retentionLimit).toBe(TABLE_YAML_VERSION_RETENTION_LIMIT);
    expect(list.versions).toHaveLength(5);
    expect(list.versions.map((version) => version.versionId)).not.toContain(versionIds[0]);
    expect(list.versions[0].versionId).toBe(versionIds.at(-1));

    await expect(
      readTableYamlVersion(
        projectRoot,
        "mysql-aliyun",
        "dataforai",
        "superstore_orders",
        versionIds[0],
        "table: dataforai.superstore_orders\nversion: current\n"
      )
    ).rejects.toThrow("版本记录不存在");
  });

  it("returns readable details and restores a selected version as a draft", async () => {
    const version = await createTableYamlVersionSnapshot(
      projectRoot,
      "mysql-aliyun",
      "dataforai",
      "superstore_orders",
      "table: dataforai.superstore_orders\nversion: baseline\n",
      { operation: "import", sourceFileName: "baseline.yaml" }
    );

    const detail = await readTableYamlVersion(
      projectRoot,
      "mysql-aliyun",
      "dataforai",
      "superstore_orders",
      version!.versionId,
      "table: dataforai.superstore_orders\nversion: current\n"
    );
    expect(detail.operation).toBe("import");
    expect(detail.sourceFileName).toBe("baseline.yaml");
    expect(detail.rawYaml).toContain("version: baseline");
    expect(detail.diffFromCurrent).toContain("version: baseline");

    const draft = await restoreTableYamlVersionDraft(
      projectRoot,
      "mysql-aliyun",
      "dataforai",
      "superstore_orders",
      version!.versionId,
      "table: dataforai.superstore_orders\nversion: current\n"
    );
    expect(draft.restoredFromVersionId).toBe(version!.versionId);
    expect(draft.rawYaml).toBe(detail.rawYaml);
    expect(draft.diff).toBe(detail.diffFromCurrent);
  });
});
