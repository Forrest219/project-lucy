import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  vi.unstubAllEnvs();
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
    host: 10.0.0.8
    port: 9030
    database: mart
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
      host: "10.0.0.8",
      port: "9030",
      database: "mart",
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

  it("recognizes explicit StarRocks R1 target profiles without auto-promoting all StarRocks connections", async () => {
    const root = await writeProject(`
connections:
  starrocks-r1:
    driver: mysql
    engine: starrocks
    wire_protocol: mysql
    readonly: true
    r1_target: true
    password: file:/tmp/starrocks-password
    enabled_tables:
      - mart.ceo_metric_snapshot
  analytics-starrocks:
    driver: starrocks
    enabled_tables:
      - ads.sales_daily
`);

    const project = await readProject(root);

    expect(project.connections[0]).toMatchObject({
      id: "starrocks-r1",
      driver: "mysql",
      engine: "starrocks",
      wireProtocol: "mysql",
      r1Target: true,
      readOnlyExpected: true,
      passwordSource: "file",
      schemas: ["mart"],
      enabledTables: ["mart.ceo_metric_snapshot"]
    });
    expect(project.connections[0]).not.toHaveProperty("password");
    expect(JSON.stringify(project.connections[0])).not.toContain("starrocks-password");
    expect(project.connections[1]).toMatchObject({
      id: "analytics-starrocks",
      driver: "starrocks",
      engine: "starrocks",
      wireProtocol: "mysql",
      r1Target: false,
      readOnlyExpected: true,
      schemas: ["ads"]
    });
  });

  it("exposes the local development fallback when LUCY_PUBLIC_MCP_URL is unset", async () => {
    vi.stubEnv("LUCY_PUBLIC_MCP_URL", "");
    const root = await writeProject(`
connections:
  doris-r1:
    driver: doris
    enabled_tables:
      - mart.ceo_metric_snapshot
`);

    const project = await readProject(root);

    expect(project.mcpEndpoint).toMatchObject({
      url: "http://127.0.0.1:7879/mcp",
      status: "fallback",
      source: "fallback",
      configured: false
    });
    expect(project.mcpEndpoint.diagnostics.map((d) => d.code)).toContain("MISSING_PUBLIC_MCP_URL");
  });

  it("exposes the configured public endpoint when LUCY_PUBLIC_MCP_URL is set", async () => {
    vi.stubEnv("LUCY_PUBLIC_MCP_URL", "https://lucy.example.com/mcp");
    const root = await writeProject(`
connections:
  doris-r1:
    driver: doris
    enabled_tables:
      - mart.ceo_metric_snapshot
`);

    const project = await readProject(root);

    expect(project.mcpEndpoint).toMatchObject({
      url: "https://lucy.example.com/mcp",
      status: "configured",
      source: "env",
      configured: true
    });
    expect(project.mcpEndpoint.diagnostics).toEqual([]);
  });
});
