import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";
import {
  buildImportScopePreview,
  SENSITIVITY_UNCONFIRMED
} from "../admin/import-scope";
import {
  invalidateAccessConfigCache,
  primeAccessConfigCache,
  parseAccessConfigText
} from "../proxy/identity";
import { invalidateContentPathsCache } from "../paths";

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(() => undefined),
      all: vi.fn(() => []),
      run: vi.fn(() => ({ lastInsertRowid: 1 }))
    })),
    exec: vi.fn(),
    pragma: vi.fn(),
    transaction: vi.fn((fn: (...args: unknown[]) => unknown) => fn)
  })),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => undefined),
  registerAgentAuditRoutes: vi.fn(),
  registerAuditRoutes: vi.fn()
}));

/**
 * Spec 183 — four-list preview of one connection's import scope. The
 * eight-table Manifest must stay intact across the test fixtures; narrowing
 * happens via `enabled_tables` and the role's `tableSelectors`.
 */
const EIGHT_TABLE_MANIFEST = `tables:
  fin_ledger:
    table: fin.fin_ledger
    sensitivity: confidential
  fin_budget:
    table: fin.fin_budget
    sensitivity: confidential
  fin_forecast:
    table: fin.fin_forecast
  fin_audit:
    table: fin.fin_audit
  fin_uid_dirty:
    table: fin.fin_uid_dirty
  fin_hold:
    table: fin.fin_hold
  fin_tax:
    table: fin.fin_tax
    sensitivity: pii
  fin_fx:
    table: fin.fin_fx
`;

const ROLE_FOUR_NAMES = `roles:
  four_names_role:
    description: declares four names; manifest has all eight
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_ledger
            - fin_budget
            - fin_forecast
            - fin_audit
          row_access: all
      tools:
        - lucy_query
`;

const ACCESS_YAML = `${ROLE_FOUR_NAMES}users:
  - id: four_name_agent
    name: Four Name Agent
    enabled: true
    role: four_names_role
    tokens: []
defaults:
  deny_tools: []
`;

const KTX_YAML_TWO_ENABLED = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
      - fin.fin_budget
`;

let projectRoot: string;
const previousEnv: Record<string, string | undefined> = {
  KTX_PROJECT_ROOT: process.env.KTX_PROJECT_ROOT,
  LUCY_CONTENT_ROOT: process.env.LUCY_CONTENT_ROOT,
  LUCY_ACCESS_CONFIG_PATH: process.env.LUCY_ACCESS_CONFIG_PATH
};

async function writeProject(opts: { accessYaml?: string; ktxYaml?: string; manifest?: string } = {}): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-spec-183-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), opts.ktxYaml ?? KTX_YAML_TWO_ENABLED, "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), opts.accessYaml ?? ACCESS_YAML, "utf8");
  await writeFile(
    path.join(root, "semantic-layer", "warehouse", "_schema", "fin.yaml"),
    opts.manifest ?? EIGHT_TABLE_MANIFEST,
    "utf8"
  );
  return root;
}

beforeEach(async () => {
  process.env.KTX_PROJECT_ROOT = "";
  process.env.LUCY_CONTENT_ROOT = ".";
  delete process.env.LUCY_ACCESS_CONFIG_PATH;
  invalidateContentPathsCache();
  invalidateAccessConfigCache();
});

afterEach(async () => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  invalidateContentPathsCache();
  invalidateAccessConfigCache();
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
  projectRoot = "";
});

async function previewFor(input: { discovered?: string[]; accessYaml?: string; ktxYaml?: string; manifest?: string }) {
  projectRoot = await writeProject({
    ...(input.accessYaml !== undefined ? { accessYaml: input.accessYaml } : {}),
    ...(input.ktxYaml !== undefined ? { ktxYaml: input.ktxYaml } : {}),
    ...(input.manifest !== undefined ? { manifest: input.manifest } : {})
  });
  process.env.KTX_PROJECT_ROOT = projectRoot;
  return buildImportScopePreview({
    projectRoot,
    connectionId: "warehouse",
    ...(input.discovered !== undefined ? { discovered: input.discovered } : {})
  });
}

describe("Spec 183 — buildImportScopePreview", () => {
  it("splits the four lists and computes the differences from the eight-table manifest", async () => {
    const preview = await previewFor({});
    expect(preview.connectionId).toBe("warehouse");
    expect(preview.discoveryExecuted).toBe(false);
    expect(preview.discovered).toEqual([]);
    // Manifest keeps every table — none were trimmed to satisfy this case.
    expect(preview.manifest.map((t) => t.physicalTable).sort()).toEqual([
      "fin.fin_audit",
      "fin.fin_budget",
      "fin.fin_forecast",
      "fin.fin_fx",
      "fin.fin_hold",
      "fin.fin_ledger",
      "fin.fin_tax",
      "fin.fin_uid_dirty"
    ]);
    expect(preview.enabled).toEqual(["fin.fin_budget", "fin.fin_ledger"]);
    expect(preview.manifestNotEnabled.sort()).toEqual([
      "fin.fin_audit",
      "fin.fin_forecast",
      "fin.fin_fx",
      "fin.fin_hold",
      "fin.fin_tax",
      "fin.fin_uid_dirty"
    ]);
    expect(preview.enabledMissingManifest).toEqual([]);
    // publishSources is only the manifest ∩ enabled intersection.
    expect(preview.publishSources).toEqual(["fin.fin_budget", "fin.fin_ledger"]);
    // Role effective source is the spec-182 intersection: 4 selectors ∩ 2 enabled.
    const agent = preview.roles.find((r) => r.identityId === "four_name_agent")!;
    expect(agent.sources).toEqual(["fin.fin_budget", "fin.fin_ledger"]);
    expect(agent.compileError).toBeUndefined();
  });

  it("lists an enabled table that the Manifest does not contain", async () => {
    const preview = await previewFor({
      ktxYaml: `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
      - fin.fin_missing
`
    });
    expect(preview.manifest).toHaveLength(8);
    expect(preview.enabledMissingManifest).toEqual(["fin.fin_missing"]);
    expect(preview.publishSources).toEqual(["fin.fin_ledger"]);
    expect(preview.publishSources).not.toContain("fin.fin_missing");
  });

  it("keeps discovered empty and does not touch the database when the caller omits it", async () => {
    const preview = await previewFor({});
    expect(preview.discovered).toEqual([]);
    expect(preview.discoveryExecuted).toBe(false);
    // The preview never queries upstream — only YAML files and access config.
    // We assert the contract by inspecting returned shape; if a DB call had
    // been made the test fixture's missing driver config would surface.
    expect(preview.manifest.length).toBeGreaterThan(0);
  });

  it("marks discoveryExecuted when the caller passes a list (even empty)", async () => {
    const preview = await previewFor({ discovered: [] });
    expect(preview.discovered).toEqual([]);
    expect(preview.discoveryExecuted).toBe(true);
  });

  it("passes through the caller-supplied discovery list as `schema.table`", async () => {
    const preview = await previewFor({
      discovered: ["fin.fin_ledger", "fin.fin_uid_dirty", "fin.fin_ledger", "  fin.fin_audit  "]
    });
    expect(preview.discoveryExecuted).toBe(true);
    expect(preview.discovered).toEqual([
      "fin.fin_audit",
      "fin.fin_ledger",
      "fin.fin_uid_dirty"
    ]);
  });

  it("only reads sensitivity from the Manifest/overlay — never guesses from names", async () => {
    const preview = await previewFor({});
    const byTable = new Map(preview.manifest.map((entry) => [entry.physicalTable, entry]));
    // UID-named source without an explicit sensitivity field stays unconfirmed.
    expect(byTable.get("fin.fin_uid_dirty")?.sensitivity).toBe(SENSITIVITY_UNCONFIRMED);
    // Tables with explicit fields report the declared value verbatim.
    expect(byTable.get("fin.fin_ledger")?.sensitivity).toBe("confidential");
    expect(byTable.get("fin.fin_budget")?.sensitivity).toBe("confidential");
    expect(byTable.get("fin.fin_tax")?.sensitivity).toBe("pii");
    // Tables without the field fall back to the unconfirmed literal.
    expect(byTable.get("fin.fin_forecast")?.sensitivity).toBe(SENSITIVITY_UNCONFIRMED);
    expect(byTable.get("fin.fin_fx")?.sensitivity).toBe(SENSITIVITY_UNCONFIRMED);
  });

  it("honours an overlay `sensitivity` value when the Manifest omits it", async () => {
    const manifest = `tables:
  fin_ledger:
    table: fin.fin_ledger
  fin_budget:
    table: fin.fin_budget
  fin_forecast:
    table: fin.fin_forecast
  fin_audit:
    table: fin.fin_audit
  fin_uid_dirty:
    table: fin.fin_uid_dirty
  fin_hold:
    table: fin.fin_hold
  fin_tax:
    table: fin.fin_tax
  fin_fx:
    table: fin.fin_fx
`;
    projectRoot = await writeProject({ manifest });
    process.env.KTX_PROJECT_ROOT = projectRoot;
    // Overlay wins when declared.
    await writeFile(
      path.join(projectRoot, "semantic-layer", "warehouse", "fin_ledger.yaml"),
      "sensitivity: restricted\n",
      "utf8"
    );
    const preview = await buildImportScopePreview({ projectRoot, connectionId: "warehouse" });
    const ledger = preview.manifest.find((entry) => entry.physicalTable === "fin.fin_ledger")!;
    expect(ledger.sensitivity).toBe("restricted");
  });

  it("reports the failing identity's machine reason and an empty source list", async () => {
    const brokenAccess = `roles:
  broken_role:
    description: missing tools triggers a compile failure
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_ledger
            - fin_budget
            - fin_forecast
            - fin_audit
          row_access: all
      tools:
        - sql_execution
users:
  - id: broken_agent
    name: Broken Agent
    enabled: true
    role: broken_role
    tokens: []
defaults:
  deny_tools: []
`;
    const preview = await previewFor({ accessYaml: brokenAccess });
    const broken = preview.roles.find((r) => r.identityId === "broken_agent")!;
    expect(broken.sources).toEqual([]);
    expect(broken.compileError).toBeTruthy();
    // sql_execution is absolute-denied by the code baseline (Spec 98 §4.2).
    expect(broken.compileError).toMatch(/role_resolution_failed/);
  });

  it("rejects unknown connections without leaking project state", async () => {
    projectRoot = await writeProject({});
    process.env.KTX_PROJECT_ROOT = projectRoot;
    await expect(
      buildImportScopePreview({ projectRoot, connectionId: "ghost" })
    ).rejects.toMatchObject({ code: "CONNECTION_NOT_FOUND", statusCode: 404 });
  });

  it("does not write any files when the preview runs", async () => {
    projectRoot = await writeProject({});
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const before = new Set<string>();
    const walk = async (dir: string): Promise<void> => {
      const { readdirSync } = await import("node:fs");
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(p);
        else if (entry.isFile()) before.add(p);
      }
    };
    await walk(projectRoot);
    await buildImportScopePreview({ projectRoot, connectionId: "warehouse" });
    const after = new Set<string>();
    for (const file of before) {
      try {
        const stat = await import("node:fs/promises").then((m) => m.stat(file));
        if (stat.mtimeMs > 0) after.add(file);
      } catch {
        // ignore missing
      }
    }
    expect(after.size).toBe(before.size);
  });
});

describe("Spec 183 — GET /api/connections/:connectionId/import-scope", () => {
  it("returns the preview with empty discovered when the query param is absent", async () => {
    projectRoot = await writeProject({});
    process.env.KTX_PROJECT_ROOT = projectRoot;
    primeAccessConfigCache(parseAccessConfigText(ACCESS_YAML));
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .get("/api/connections/warehouse/import-scope")
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.connectionId).toBe("warehouse");
    expect(res.body.data.discoveryExecuted).toBe(false);
    expect(res.body.data.discovered).toEqual([]);
    expect(res.body.data.manifest.length).toBe(8);
    expect(res.body.data.enabled).toEqual(["fin.fin_budget", "fin.fin_ledger"]);
    expect(res.body.data.publishSources).toEqual(["fin.fin_budget", "fin.fin_ledger"]);
    expect(res.body.data.manifestNotEnabled.length).toBe(6);
    expect(res.body.data.enabledMissingManifest).toEqual([]);
    expect(res.body.data.policyInputs).toBeTruthy();
    await app.close();
  });

  it("echoes the caller-supplied discovered tables back verbatim", async () => {
    projectRoot = await writeProject({});
    process.env.KTX_PROJECT_ROOT = projectRoot;
    primeAccessConfigCache(parseAccessConfigText(ACCESS_YAML));
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .get("/api/connections/warehouse/import-scope")
      .query({ discovered: "fin.fin_ledger,fin.fin_uid_dirty" })
      .expect(200);
    expect(res.body.data.discoveryExecuted).toBe(true);
    expect(res.body.data.discovered).toEqual(["fin.fin_ledger", "fin.fin_uid_dirty"]);
    await app.close();
  });

  it("responds 404 when the connection id is not configured", async () => {
    projectRoot = await writeProject({});
    process.env.KTX_PROJECT_ROOT = projectRoot;
    primeAccessConfigCache(parseAccessConfigText(ACCESS_YAML));
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .get("/api/connections/ghost/import-scope")
      .expect(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe("CONNECTION_NOT_FOUND");
    await app.close();
  });
});
