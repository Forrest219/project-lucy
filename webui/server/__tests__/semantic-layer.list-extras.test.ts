import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSources } from "../semantic-layer";

let projectRoot: string;
let prevRoot: string | undefined;

const ACCESS_YAML = `roles:
  analyst:
    description: Analyst role
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
            - superstore_orders
            - superstore_returns
      tools:
        - sl_query
  readonly:
    description: Readonly role
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          prefix: superstore_
      tools:
        - sl_query
users:
  - id: alice
    name: Alice
    enabled: true
    role: analyst
    tokens: []
  - id: bob
    name: Bob
    enabled: true
    role: readonly
    tokens: []
  - id: carol
    name: Carol
    enabled: true
    role: analyst
    tokens: []
  - id: dave
    name: Dave
    enabled: false
    role: analyst
    tokens: []
defaults: {}
`;

async function writeSchema(root: string, schemaName: string, tableNames: string[]) {
  const tablesYaml = tableNames
    .map((t) => `  ${t}:\n    table: ${schemaName}.${t}\n    descriptions:\n      ai: Generated.\n    columns:\n      - name: id\n        type: number\n        pk: true\n        descriptions:\n          ai: id column\n`)
    .join("");
  await writeFile(
    path.join(root, "semantic-layer", "mysql-aliyun", "_schema", `${schemaName}.yaml`),
    `tables:\n${tablesYaml}`,
    "utf8"
  );
}

async function writeOverlay(root: string, table: string, body: string) {
  await writeFile(path.join(root, "semantic-layer", "mysql-aliyun", `${table}.yaml`), body, "utf8");
}

async function setMtime(file: string, ts: Date) {
  await utimes(file, ts, ts);
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-sl-extras-"));
  await mkdir(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  prevRoot = process.env.KTX_PROJECT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
});

afterEach(async () => {
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

function findSummary(tables: { table: string }[], table: string) {
  const summary = tables.find((t) => t.table === table);
  if (!summary) throw new Error(`table ${table} not found`);
  return summary;
}

describe("listSources — authorizedAgentCount", () => {
  it("returns 0 for tables when access.yaml is absent", async () => {
    await rm(path.join(projectRoot, "webui", "config", "access.yaml"), { force: true });
    await writeSchema(projectRoot, "dataforai", ["superstore_orders"]);
    const summaries = await listSources(projectRoot);
    expect(findSummary(summaries, "superstore_orders").authorizedAgentCount).toBe(0);
  });

  it("counts enabled Agents whose effective permissions include the source", async () => {
    await writeSchema(projectRoot, "dataforai", ["superstore_orders", "superstore_returns", "openclaw_orders"]);
    const summaries = await listSources(projectRoot);
    // analyst role covers superstore_orders + superstore_returns via `names`
    // alice + carol are enabled analysts → 2
    // bob is enabled readonly covering all `superstore_*` (prefix) → 3
    // dave is disabled → not counted
    expect(findSummary(summaries, "superstore_orders").authorizedAgentCount).toBe(3);
    expect(findSummary(summaries, "superstore_returns").authorizedAgentCount).toBe(3);
    // openclaw_orders matches no role → 0
    expect(findSummary(summaries, "openclaw_orders").authorizedAgentCount).toBe(0);
  });

  it("does not count disabled Agents", async () => {
    await writeSchema(projectRoot, "dataforai", ["superstore_orders"]);
    const summaries = await listSources(projectRoot);
    // dave (disabled) must never be in the count even though he would have analyst role
    expect(findSummary(summaries, "superstore_orders").authorizedAgentCount).toBe(3);
  });

  it("returns 0 when access.yaml is malformed", async () => {
    await writeSchema(projectRoot, "dataforai", ["superstore_orders"]);
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), "this: is: not: valid: yaml: : :", "utf8");
    const summaries = await listSources(projectRoot);
    expect(findSummary(summaries, "superstore_orders").authorizedAgentCount).toBe(0);
  });
});

describe("listSources — semanticUpdatedAt", () => {
  it("falls back to manifest mtime when overlay is absent", async () => {
    await writeSchema(projectRoot, "dataforai", ["superstore_orders"]);
    const manifestPath = path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml");
    const manifestTime = new Date("2026-06-01T08:00:00.000Z");
    await setMtime(manifestPath, manifestTime);

    const summaries = await listSources(projectRoot);
    const summary = findSummary(summaries, "superstore_orders");
    expect(summary.semanticUpdatedAt).toBe(manifestTime.toISOString());
    expect(summary.semanticUpdatedAtSource).toBe("manifest");
  });

  it("takes overlay mtime when overlay is newer than manifest", async () => {
    await writeSchema(projectRoot, "dataforai", ["superstore_orders"]);
    const manifestPath = path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml");
    const overlayPath = path.join(projectRoot, "semantic-layer", "mysql-aliyun", "superstore_orders.yaml");

    const manifestTime = new Date("2026-06-01T08:00:00.000Z");
    const overlayTime = new Date("2026-07-01T10:30:00.000Z");
    await setMtime(manifestPath, manifestTime);
    await writeOverlay(projectRoot, "superstore_orders", "name: superstore_orders\ngrain: [id]\n");
    await setMtime(overlayPath, overlayTime);

    const summaries = await listSources(projectRoot);
    const summary = findSummary(summaries, "superstore_orders");
    expect(summary.semanticUpdatedAt).toBe(overlayTime.toISOString());
    expect(summary.semanticUpdatedAtSource).toBe("overlay");
  });

  it("keeps manifest mtime when overlay is older than manifest", async () => {
    await writeSchema(projectRoot, "dataforai", ["superstore_orders"]);
    const manifestPath = path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml");
    const overlayPath = path.join(projectRoot, "semantic-layer", "mysql-aliyun", "superstore_orders.yaml");

    const manifestTime = new Date("2026-06-15T08:00:00.000Z");
    const overlayTime = new Date("2026-05-01T08:00:00.000Z");
    await setMtime(manifestPath, manifestTime);
    await writeOverlay(projectRoot, "superstore_orders", "name: superstore_orders\ngrain: [id]\n");
    await setMtime(overlayPath, overlayTime);

    const summaries = await listSources(projectRoot);
    const summary = findSummary(summaries, "superstore_orders");
    expect(summary.semanticUpdatedAt).toBe(manifestTime.toISOString());
    expect(summary.semanticUpdatedAtSource).toBe("manifest");
  });
});