import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConnectionIdInvalidError,
  ConnectionNotFoundError,
  ConnectionReplacementInvalidError,
  planConnectionReplacement,
  probeConnection,
  type ConnectionReplacementPlan
} from "../project";
import { invalidateContentPathsCache } from "../paths";
import { invalidateAccessConfigCache } from "../proxy/identity";
import type { ConnectionTestResult } from "../ktx";

let projectRoot: string | undefined;
const previousEnv: { root?: string; content?: string; access?: string } = {};

const KTX_YAML = `connections:
  mysql-aliyun:
    driver: mysql
    host: db.internal
    port: 3306
    database: dataforai
    username: sc
    password: inline-password
    schemas:
      - dataforai
      - dataforai_aux
    enabled_tables:
      - dataforai.superstore_orders
      - dataforai.invoices
      - dataforai_aux.audit_log
  keep-me:
    driver: mysql
    host: db.other
    port: 3306
    database: other
    username: sc
    password: inline-other
    schemas: []
    enabled_tables: []
setup:
  database_connection_ids:
    - mysql-aliyun
    - keep-me
`;

const ACCESS_YAML = `roles:
  finance_readonly:
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
            - superstore_orders
          row_access: all
        - connection: mysql-aliyun
          schema: dataforai_aux
          names:
            - audit_log
          row_access: all
      tools:
        - lucy_query
users:
  - id: agent-finance
    name: Finance Agent
    enabled: true
    role: finance_readonly
    tokens: []
`;

async function makeProject(opts: {
  ktx?: string;
  access?: string;
  semanticFiles?: Record<string, string>;
  wiki?: Array<{ key: string; markdown: string }>;
}): Promise<string> {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-conn-replacement-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), opts.ktx ?? KTX_YAML, "utf8");

  if (opts.access !== undefined || opts.access === undefined) {
    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), opts.access ?? ACCESS_YAML, "utf8");
  }

  if (opts.semanticFiles) {
    const dir = path.join(projectRoot, "semantic-layer", "mysql-aliyun");
    await mkdir(dir, { recursive: true });
    for (const [rel, content] of Object.entries(opts.semanticFiles)) {
      const abs = path.join(dir, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
    }
  }

  if (opts.wiki) {
    for (const page of opts.wiki) {
      const abs = path.join(projectRoot, "wiki", page.key);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, page.markdown, "utf8");
    }
  }

  previousEnv.root = process.env.KTX_PROJECT_ROOT;
  previousEnv.content = process.env.LUCY_CONTENT_ROOT;
  previousEnv.access = process.env.LUCY_ACCESS_CONFIG_PATH;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  delete process.env.LUCY_ACCESS_CONFIG_PATH;
  invalidateContentPathsCache();
  invalidateAccessConfigCache();
  return projectRoot;
}

function wikiMarkdown(refs: string[]): string {
  return [
    "---",
    "summary: Test page",
    "tags: []",
    "sl_refs:",
    ...refs.map((r) => `  - ${r}`),
    "---",
    "",
    "# Body",
    ""
  ].join("\n");
}

beforeEach(() => {
  previousEnv.root = process.env.KTX_PROJECT_ROOT;
  previousEnv.content = process.env.LUCY_CONTENT_ROOT;
  previousEnv.access = process.env.LUCY_ACCESS_CONFIG_PATH;
});

afterEach(async () => {
  invalidateContentPathsCache();
  invalidateAccessConfigCache();
  if (previousEnv.root === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousEnv.root;
  if (previousEnv.content === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousEnv.content;
  if (previousEnv.access === undefined) delete process.env.LUCY_ACCESS_CONFIG_PATH;
  else process.env.LUCY_ACCESS_CONFIG_PATH = previousEnv.access;
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true });
    projectRoot = undefined;
  }
});

describe("planConnectionReplacement — input validation", () => {
  it("rejects candidates that include a password field", async () => {
    const root = await makeProject({});
    await expect(
      planConnectionReplacement(root, "mysql-aliyun", {
        database: "dataforai",
        schemas: ["dataforai"],
        enabledTables: ["dataforai.superstore_orders"],
        password: "shiny-new-secret"
      })
    ).rejects.toBeInstanceOf(ConnectionReplacementInvalidError);

    await expect(
      planConnectionReplacement(root, "mysql-aliyun", {
        database: "dataforai",
        schemas: ["dataforai"],
        enabledTables: ["dataforai.superstore_orders"],
        // unknown field, not a password but a host — still rejected
        host: "evil.example"
      })
    ).rejects.toBeInstanceOf(ConnectionReplacementInvalidError);
  });

  it("rejects illegal connection ids and unknown fromId", async () => {
    const root = await makeProject({});
    await expect(
      planConnectionReplacement(root, "Bad Id", {
        database: "x",
        schemas: [],
        enabledTables: []
      })
    ).rejects.toBeInstanceOf(ConnectionIdInvalidError);
    await expect(
      planConnectionReplacement(root, "does-not-exist", {
        database: "x",
        schemas: [],
        enabledTables: []
      })
    ).rejects.toBeInstanceOf(ConnectionNotFoundError);
  });
});

describe("planConnectionReplacement — preview content", () => {
  it("reports sameHost but not sameObject when the database name changes", async () => {
    const root = await makeProject({
      semanticFiles: { "_schema/dataforai.yaml": "tables: {}\n" },
      wiki: [{ key: "global/playbook.md", markdown: wikiMarkdown(["mysql-aliyun"]) }]
    });
    const originalKtx = await readFile(path.join(root, "ktx.yaml"), "utf8");

    const plan = await planConnectionReplacement(root, "mysql-aliyun", {
      database: "dataforai_v2",
      schemas: ["dataforai", "dataforai_aux"],
      enabledTables: ["dataforai.superstore_orders", "dataforai.invoices", "dataforai_aux.audit_log"]
    });

    // Host is preserved by the candidate; sameObject must be false because the database name changed.
    expect(plan.sameHost).toBe(true);
    expect(plan.sameObject).toBe(false);
    expect(plan.database).toEqual({ before: "dataforai", after: "dataforai_v2" });
    expect(plan.schemas.before.sort()).toEqual(["dataforai", "dataforai_aux"]);
    expect(plan.schemas.after).toEqual(["dataforai", "dataforai_aux"]);
    expect(plan.enabledTables.before).toEqual([
      "dataforai.invoices",
      "dataforai.superstore_orders",
      "dataforai_aux.audit_log"
    ]);
    expect(plan.enabledTables.after).toEqual([
      "dataforai.invoices",
      "dataforai.superstore_orders",
      "dataforai_aux.audit_log"
    ]);

    // Connection id and host are preserved in the manifest and wiki reports.
    expect(plan.manifest.stillPointsToConnection).toBe(true);
    expect(plan.manifest.files.some((f) => f.endsWith("_schema/dataforai.yaml"))).toBe(true);
    expect(plan.wiki.stillPointsToConnection).toBe(true);
    expect(plan.wiki.pages.some((p) => p.key === "global/playbook.md")).toBe(true);

    // Live project is not mutated.
    expect(await readFile(path.join(root, "ktx.yaml"), "utf8")).toBe(originalKtx);
  });

  it("marks sameObject only when database, schemas, and enabled_tables all match", async () => {
    const root = await makeProject({});
    const plan = await planConnectionReplacement(root, "mysql-aliyun", {
      database: "dataforai",
      schemas: ["dataforai", "dataforai_aux"],
      enabledTables: [
        "dataforai.superstore_orders",
        "dataforai.invoices",
        "dataforai_aux.audit_log"
      ]
    });
    expect(plan.sameObject).toBe(true);
    expect(plan.sameHost).toBe(true);

    // A single change in enabled_tables flips sameObject to false.
    const narrowed = await planConnectionReplacement(root, "mysql-aliyun", {
      database: "dataforai",
      schemas: ["dataforai", "dataforai_aux"],
      enabledTables: ["dataforai.superstore_orders"]
    });
    expect(narrowed.sameObject).toBe(false);
    expect(narrowed.enabledTables.after).toEqual(["dataforai.superstore_orders"]);
  });
});

describe("planConnectionReplacement — secret redaction", () => {
  it("never returns the existing password in the preview", async () => {
    const root = await makeProject({});
    const plan: ConnectionReplacementPlan = await planConnectionReplacement(root, "mysql-aliyun", {
      database: "dataforai",
      schemas: ["dataforai"],
      enabledTables: ["dataforai.superstore_orders"]
    });
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain("inline-password");
    expect(serialized).not.toContain("inline-other");
    expect(plan.diff).not.toContain("inline-password");
    expect(plan.proposedYaml).not.toContain("inline-password");
  });
});

describe("planConnectionReplacement — capability diff on temp copy", () => {
  it("emits a removed source key when enabled_tables is narrowed", async () => {
    const root = await makeProject({});

    const plan = await planConnectionReplacement(
      root,
      "mysql-aliyun",
      {
        database: "dataforai",
        schemas: ["dataforai"],
        enabledTables: ["dataforai.superstore_orders"]
      },
      {
        compileIdentities: async (compileRoot, _contentRoot, userIds) => {
          const ktx = await readFile(path.join(compileRoot, "ktx.yaml"), "utf8");
          const enabled = [...ktx.matchAll(/^\s*-\s*(dataforai(?:_aux)?\.\S+)\s*$/gm)].map((match) => match[1]!);
          const sourceKeys = enabled.map((table) => {
            const [schema, name] = table.split(".");
            return `mysql-aliyun/${schema}/${name}`;
          });
          return userIds.map((userId) => ({
            userId,
            compile: "compiled" as const,
            before: sourceKeys,
            after: sourceKeys,
            added: [],
            removed: []
          }));
        }
      }
    );

    expect(plan.capabilityDiff).toHaveLength(1);
    const entry = plan.capabilityDiff[0]!;
    expect(entry.userId).toBe("agent-finance");
    expect(entry.compile).toBe("compiled");
    expect(entry.before).toEqual([
      "mysql-aliyun/dataforai/superstore_orders",
      "mysql-aliyun/dataforai/invoices",
      "mysql-aliyun/dataforai_aux/audit_log"
    ]);
    expect(entry.after).toEqual(["mysql-aliyun/dataforai/superstore_orders"]);
    expect(entry.removed).toEqual([
      "mysql-aliyun/dataforai/invoices",
      "mysql-aliyun/dataforai_aux/audit_log"
    ]);

    // Live project is never mutated by the compile run. The compile run
    // materialises a temp copy; the project root and its `semantic-layer`
    // dir, if any, are unchanged on the way back.
    const liveSemanticEntries = await readdir(path.join(root, "semantic-layer")).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [] as string[];
      throw error;
    });
    expect(liveSemanticEntries).toEqual([]);
  });

  it("carries a machine reason for identities that fail to compile and does not count them as authorization widening", async () => {
    const root = await makeProject({
      access: `roles:
  finance_readonly:
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
            - superstore_orders
          row_access: all
      tools:
        - lucy_query
users:
  - id: agent-broken
    name: Broken
    enabled: true
    role: finance_readonly
    tokens: []
  - id: agent-ok
    name: Ok
    enabled: true
    role: finance_readonly
    tokens: []
`
    });

    const plan = await planConnectionReplacement(root, "mysql-aliyun", {
      database: "dataforai",
      schemas: ["dataforai"],
      enabledTables: ["dataforai.superstore_orders"]
    }, {
      compileIdentities: async (_projectRoot, _contentRoot, userIds) => {
        return userIds.map((userId) => {
          if (userId === "agent-broken") {
            return {
              userId,
              compile: "failed" as const,
              reason: "role_resolution_failed:finance_readonly",
              before: [],
              after: [],
              added: [],
              removed: []
            };
          }
          return {
            userId,
            compile: "compiled" as const,
            before: ["mysql-aliyun/dataforai/superstore_orders"],
            after: ["mysql-aliyun/dataforai/superstore_orders"],
            added: [],
            removed: []
          };
        });
      }
    });

    const broken = plan.capabilityDiff.find((row) => row.userId === "agent-broken");
    const ok = plan.capabilityDiff.find((row) => row.userId === "agent-ok");
    expect(broken?.compile).toBe("failed");
    expect(broken?.reason).toBe("role_resolution_failed:finance_readonly");
    expect(broken?.added).toEqual([]);
    expect(broken?.removed).toEqual([]);
    expect(ok?.compile).toBe("compiled");
  });
});

describe("probeConnection — connectivity-test text", () => {
  // Spec 184 T11 §3: the success message describes the connectivity test itself.
  // Lock the wording so a future change cannot turn it into an authorization
  // restoration ("权限已恢复" / "问数已恢复").
  it("keeps the success message as a connectivity-test wording", async () => {
    const probeInput = {
      driver: "mysql" as const,
      host: "db.internal",
      port: 3306,
      database: "analytics",
      username: "lucy_ro",
      password: "s3cret"
    };

    const probeRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-probe-text-"));
    const previousProbe = {
      root: process.env.KTX_PROJECT_ROOT,
      content: process.env.LUCY_CONTENT_ROOT
    };
    process.env.KTX_PROJECT_ROOT = probeRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    invalidateContentPathsCache();
    invalidateAccessConfigCache();

    try {
      const result = await probeConnection(probeInput, {
        testConnectionFn: async () => ({
          status: "ok",
          latencyMs: 5,
          detail: "ok",
          stdout: "Status: ok\n",
          stderr: "",
          exitCode: 0,
          command: "ktx connection test probe",
          args: ["connection", "test", "probe"]
        } as ConnectionTestResult)
      });
      expect(result.status).toBe("ok");
      expect(result.message).toBe("连接成功");
      // Hard lock: the success wording must not claim an authorization restoration.
      expect(result.message).not.toContain("权限已恢复");
      expect(result.message).not.toContain("问数已恢复");
      expect(result.message).not.toMatch(/权限.*恢复|问数.*恢复/);
    } finally {
      if (previousProbe.root === undefined) delete process.env.KTX_PROJECT_ROOT;
      else process.env.KTX_PROJECT_ROOT = previousProbe.root;
      if (previousProbe.content === undefined) delete process.env.LUCY_CONTENT_ROOT;
      else process.env.LUCY_CONTENT_ROOT = previousProbe.content;
      invalidateContentPathsCache();
      invalidateAccessConfigCache();
      await rm(probeRoot, { recursive: true, force: true });
    }
  });
});