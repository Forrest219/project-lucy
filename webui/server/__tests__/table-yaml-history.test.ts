import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TABLE_YAML_VERSION_RETENTION_LIMIT,
  createTableYamlVersionSnapshot,
  listTableYamlVersions,
  readTableYamlVersion,
  restoreTableYamlVersionDraft
} from "../table-yaml-history";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-table-yaml-history-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("table YAML version history", () => {
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
