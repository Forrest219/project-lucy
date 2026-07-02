import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readProject } from "../project";

let tempRoot: string | undefined;

async function writeProject(yaml: string) {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-project-"));
  await writeFile(path.join(tempRoot, "ktx.yaml"), yaml, "utf8");
  return tempRoot;
}

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("readProject", () => {
  it("derives the Doris R1 target profile from ktx.yaml", async () => {
    const root = await writeProject(`
connections:
  doris-r1:
    driver: mysql
    engine: doris
    wire_protocol: mysql
    readonly: true
    r1_target: true
    password: file:/tmp/doris-password
    enabled_tables:
      - mart.ceo_metric_snapshot
`);

    const project = await readProject(root);

    expect(project.connections).toHaveLength(1);
    expect(project.connections[0]).toMatchObject({
      id: "doris-r1",
      driver: "mysql",
      engine: "doris",
      wireProtocol: "mysql",
      r1Target: true,
      readOnlyExpected: true,
      passwordSource: "file",
      schemas: ["mart"],
      enabledTables: ["mart.ceo_metric_snapshot"]
    });
  });

  it("defaults Doris-like drivers to MySQL wire and R1 target", async () => {
    const root = await writeProject(`
connections:
  analytics-doris:
    driver: doris
    enabled_tables:
      - ads.sales_daily
`);

    const project = await readProject(root);

    expect(project.connections[0]).toMatchObject({
      id: "analytics-doris",
      driver: "doris",
      engine: "doris",
      wireProtocol: "mysql",
      r1Target: true,
      readOnlyExpected: true,
      schemas: ["ads"]
    });
  });
});
