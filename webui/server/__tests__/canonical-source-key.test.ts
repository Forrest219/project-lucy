import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let previousRoot: string | undefined;

async function makeProject(options: {
  connA?: string;
  connB?: string;
  duplicateInConnA?: boolean;
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-canonical-key-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "conn-a", "_schema"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "conn-b", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(
    path.join(root, "webui", "config", "access.yaml"),
    `users: []\ndefaults:\n  deny_tools: []\n`,
    "utf8"
  );

  const schemaA = options.duplicateInConnA
    ? `tables:
  shared_source:
    table: schema_a.shared_source
`
    : `tables:
  shared_source:
    table: schema_a.shared_source
  only_a:
    table: schema_a.only_a
`;

  // Second schema file under same connection with duplicate sourceName (U-KEY-02)
  const schemaADup = `tables:
  shared_source:
    table: schema_a.shared_source_alt
`;

  const schemaB = `tables:
  shared_source:
    table: schema_b.shared_source
  only_b:
    table: schema_b.only_b
  same_physical:
    table: shared.phys_table
`;

  const schemaASamePhysical = `tables:
  other_name:
    table: shared.phys_table
`;

  await writeFile(
    path.join(root, "semantic-layer", "conn-a", "_schema", "schema_a.yaml"),
    options.connA ?? schemaA,
    "utf8"
  );
  if (options.duplicateInConnA) {
    await writeFile(
      path.join(root, "semantic-layer", "conn-a", "_schema", "schema_a_alt.yaml"),
      schemaADup,
      "utf8"
    );
  }
  await writeFile(
    path.join(root, "semantic-layer", "conn-b", "_schema", "schema_b.yaml"),
    options.connB ?? schemaB,
    "utf8"
  );
  if (!options.duplicateInConnA) {
    await writeFile(
      path.join(root, "semantic-layer", "conn-a", "_schema", "schema_a_phys.yaml"),
      schemaASamePhysical,
      "utf8"
    );
  }
  return root;
}

async function loadAcl() {
  vi.resetModules();
  return import("../proxy/acl");
}

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("WP-I1 Canonical Source Key", () => {
  it("U-KEY-01: same sourceName on different connections coexist", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { getSourceMapDiagnostics, extractTables } = await loadAcl();

    const diag = await getSourceMapDiagnostics({ fresh: true });
    expect(diag.compileError).toBeUndefined();
    const shared = diag.entries.filter((e) => e.sourceName === "shared_source");
    expect(shared).toHaveLength(2);
    expect(shared.map((e) => e.connectionId).sort()).toEqual(["conn-a", "conn-b"]);

    await expect(
      extractTables("lucy_read_source", {
        connectionId: "conn-a",
        sourceName: "shared_source"
      })
    ).resolves.toEqual(["schema_a.shared_source"]);

    await expect(
      extractTables("lucy_read_source", {
        connectionId: "conn-b",
        sourceName: "shared_source"
      })
    ).resolves.toEqual(["schema_b.shared_source"]);
  });

  it("U-KEY-02: duplicate sourceName within one connection → compile error", async () => {
    projectRoot = await makeProject({ duplicateInConnA: true });
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { getSourceMapDiagnostics } = await loadAcl();

    const diag = await getSourceMapDiagnostics({ fresh: true });
    expect(diag.compileError).toMatch(/^duplicate_source_name:conn-a:shared_source$/);
  });

  it("U-KEY-03: reverse map attributes same physicalTable per connection", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const { resolveSourceRefsForTables } = await loadAcl();

    await expect(
      resolveSourceRefsForTables(["shared.phys_table"], { connectionId: "conn-a" })
    ).resolves.toEqual([
      expect.objectContaining({
        connectionId: "conn-a",
        sourceName: "other_name",
        physicalTable: "shared.phys_table"
      })
    ]);

    await expect(
      resolveSourceRefsForTables(["shared.phys_table"], { connectionId: "conn-b" })
    ).resolves.toEqual([
      expect.objectContaining({
        connectionId: "conn-b",
        sourceName: "same_physical",
        physicalTable: "shared.phys_table"
      })
    ]);

    // Bare physical with multiple connections → ambiguous, no false attribution
    await expect(resolveSourceRefsForTables(["shared.phys_table"])).resolves.toEqual([
      {
        physicalTable: "shared.phys_table",
        extractionMethod: "source_map_reverse",
        confidence: "medium"
      }
    ]);
  });
});
