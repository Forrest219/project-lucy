import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyConnectionIdChange,
  ConnectionAlreadyExistsError,
  ConnectionIdInvalidError,
  ConnectionNotFoundError,
  KtxYamlParseError,
  planConnectionIdChange
} from "../project";
import { invalidateContentPathsCache } from "../paths";
import { invalidateAccessConfigCache } from "../proxy/identity";

let projectRoot: string | undefined;
const previousEnv: { root?: string; content?: string; access?: string } = {};

const KTX_YAML = `connections:
  mysql-aliyun:
    driver: mysql
    host: localhost
    port: 3306
    database: dataforai
    username: sc
    password: inline-password
    schemas:
      - dataforai
    enabled_tables:
      - dataforai.superstore_orders
  keep-me:
    driver: mysql
    host: localhost
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
      tools:
        - lucy_query
  unrelated:
    allow:
      connections:
        - keep-me
      tools:
        - lucy_query
users:
  - id: agent-finance
    name: Finance Agent
    enabled: true
    role: finance_readonly
    tokens: []
  - id: agent-other
    name: Other Agent
    enabled: true
    role: unrelated
    tokens: []
`;

async function makeProject(opts: {
  ktx?: string;
  access?: string;
  semanticFiles?: Record<string, string>;
  wiki?: Array<{ key: string; markdown: string }>;
}): Promise<string> {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-conn-id-rename-"));
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

describe("planConnectionIdChange — id conflict", () => {
  it("returns ok:false / connection_id_taken without mutating any file", async () => {
    const root = await makeProject({});
    const originalKtx = await readFile(path.join(root, "ktx.yaml"), "utf8");
    const originalAccess = await readFile(path.join(root, "webui", "config", "access.yaml"), "utf8");

    const plan = await planConnectionIdChange(root, "mysql-aliyun", "keep-me");

    expect(plan.ok).toBe(false);
    if (plan.ok) throw new Error("expected plan to be ok:false");
    expect(plan.code).toBe("connection_id_taken");
    expect(plan.fromId).toBe("mysql-aliyun");
    expect(plan.toId).toBe("keep-me");

    // No file is mutated.
    expect(await readFile(path.join(root, "ktx.yaml"), "utf8")).toBe(originalKtx);
    expect(await readFile(path.join(root, "webui", "config", "access.yaml"), "utf8")).toBe(originalAccess);
  });

  it("rejects illegal connection ids and unknown fromId", async () => {
    const root = await makeProject({});
    await expect(planConnectionIdChange(root, "Bad Id", "renamed")).rejects.toBeInstanceOf(
      ConnectionIdInvalidError
    );
    await expect(planConnectionIdChange(root, "mysql-aliyun", "mysql-aliyun")).rejects.toBeInstanceOf(
      ConnectionIdInvalidError
    );
    await expect(planConnectionIdChange(root, "does-not-exist", "renamed")).rejects.toBeInstanceOf(
      ConnectionNotFoundError
    );
  });

  it("surfaces parse errors as KtxYamlParseError", async () => {
    const root = await makeProject({ ktx: "connections: { :: invalid\n" });
    await expect(planConnectionIdChange(root, "mysql-aliyun", "renamed")).rejects.toBeInstanceOf(
      KtxYamlParseError
    );
  });
});

describe("planConnectionIdChange — preview content", () => {
  it("lists affected roles, semantic dir, and wiki pages without writing", async () => {
    const root = await makeProject({
      semanticFiles: {
        "superstore_orders.yaml": "grain: []\n",
        "_schema/dataforai.yaml": "tables: {}\n"
      },
      wiki: [
        { key: "global/playbook.md", markdown: wikiMarkdown(["mysql-aliyun", "keep-me"]) },
        { key: "global/other.md", markdown: wikiMarkdown(["keep-me"]) }
      ]
    });
    const originalKtx = await readFile(path.join(root, "ktx.yaml"), "utf8");
    const originalAccess = await readFile(path.join(root, "webui", "config", "access.yaml"), "utf8");
    const originalSemantic = (await readdir(path.join(root, "semantic-layer"))).sort();

    const plan = await planConnectionIdChange(root, "mysql-aliyun", "renamed");

    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("expected plan to be ok:true");
    expect(plan.fromId).toBe("mysql-aliyun");
    expect(plan.toId).toBe("renamed");
    expect(plan.ktx.fromKey).toBe("mysql-aliyun");
    expect(plan.ktx.toKey).toBe("renamed");
    expect(plan.ktx.schemas).toEqual(["dataforai"]);
    expect(plan.ktx.enabledTables).toEqual(["dataforai.superstore_orders"]);
    expect(plan.access.affectedRoles.map((r) => r.roleId)).toEqual(["finance_readonly"]);
    expect(plan.access.affectedUsers).toEqual(["agent-finance"]);
    expect(plan.semanticLayer.fromDir).toBe("semantic-layer/mysql-aliyun");
    expect(plan.semanticLayer.toDir).toBe("semantic-layer/renamed");
    expect(plan.semanticLayer.exists).toBe(true);
    expect(plan.semanticLayer.fileCount).toBeGreaterThanOrEqual(2);
    expect(plan.wiki.pages).toHaveLength(1);
    expect(plan.wiki.pages[0]?.key).toBe("global/playbook.md");
    expect(plan.wiki.pages[0]?.refsChanged).toBe(1);
    expect(plan.wiki.pages[0]?.after).toEqual(["renamed", "keep-me"]);

    // Plan must not write, including the semantic-layer directory name.
    expect(await readFile(path.join(root, "ktx.yaml"), "utf8")).toBe(originalKtx);
    expect(await readFile(path.join(root, "webui", "config", "access.yaml"), "utf8")).toBe(originalAccess);
    expect((await readdir(path.join(root, "semantic-layer"))).sort()).toEqual(originalSemantic);
    expect(plan.diff).not.toContain("inline-password");
    expect(plan.diff).not.toContain("inline-other");
  });
});

describe("planConnectionIdChange — capability diff", () => {
  it("emits added/removed source-name sets around the renamed connection id", async () => {
    const root = await makeProject({
      access: `roles:
  ledger_all:
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
  - id: agent-finance
    name: Finance Agent
    enabled: true
    role: ledger_all
    tokens: []
`,
      semanticFiles: {
        "_schema/dataforai.yaml": "tables: {}\n"
      }
    });

    const seenSemanticDirs: string[][] = [];
    const plan = await planConnectionIdChange(root, "mysql-aliyun", "renamed", {
      compileIdentities: async (_projectRoot, contentRoot, userIds) => {
        const names = (await readdir(path.join(contentRoot, "semantic-layer"))).sort();
        seenSemanticDirs.push(names);
        const conn = names.includes("renamed") ? "renamed" : "mysql-aliyun";
        const sourceKeys = [`${conn}/dataforai/superstore_orders`];
        return userIds.map((userId) => ({
          userId,
          compile: "compiled" as const,
          before: sourceKeys,
          after: sourceKeys,
          added: [],
          removed: []
        }));
      }
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("expected plan to be ok:true");

    expect(seenSemanticDirs[0]).toContain("mysql-aliyun");
    expect(seenSemanticDirs[0]).not.toContain("renamed");
    expect(seenSemanticDirs[1]).toContain("renamed");
    expect(seenSemanticDirs[1]).not.toContain("mysql-aliyun");
    expect((await readdir(path.join(root, "semantic-layer"))).sort()).toEqual(["mysql-aliyun"]);

    const entry = plan.capabilityDiff.find((row) => row.userId === "agent-finance");
    expect(entry?.compile).toBe("compiled");
    expect(entry?.before).toEqual(["mysql-aliyun/dataforai/superstore_orders"]);
    expect(entry?.after).toEqual(["renamed/dataforai/superstore_orders"]);
    expect(entry?.added).toEqual(["renamed/dataforai/superstore_orders"]);
    expect(entry?.removed).toEqual(["mysql-aliyun/dataforai/superstore_orders"]);
  });
});

describe("applyConnectionIdChange — happy path", () => {
  it("rewrites ktx.yaml, access.yaml, semantic dir, and wiki sl_refs", async () => {
    const root = await makeProject({
      semanticFiles: { "superstore_orders.yaml": "grain: []\n" },
      wiki: [
        { key: "global/playbook.md", markdown: wikiMarkdown(["mysql-aliyun", "keep-me"]) }
      ]
    });

    const result = await applyConnectionIdChange(root, "mysql-aliyun", "renamed", {
      write: true
    });

    expect(result.written).toBe(true);
    expect(result.fromId).toBe("mysql-aliyun");
    expect(result.toId).toBe("renamed");
    expect(result.renamedSemanticDir).toBe(true);
    expect(result.updatedWikiPages).toEqual(["global/playbook.md"]);

    // ktx.yaml: connection key renamed, setup id renamed.
    const ktx = await readFile(path.join(root, "ktx.yaml"), "utf8");
    expect(ktx).not.toMatch(/^\s*mysql-aliyun:/m);
    expect(ktx).toMatch(/^\s*renamed:/m);
    expect(ktx).toMatch(/database_connection_ids:\s*\n\s*-\s*renamed\b/);
    expect(ktx).toMatch(/^\s*keep-me:/m);

    // access.yaml: role allow.connections and tableSelectors[].connection updated.
    const access = await readFile(path.join(root, "webui", "config", "access.yaml"), "utf8");
    expect(access).toMatch(/connections:\s*\n\s*-\s*renamed\b/);
    expect(access).toMatch(/connection:\s*renamed\b/);
    expect(access).toMatch(/-\s*keep-me\b/);

    // semantic-layer: dir renamed, old name gone.
    const semanticLayer = path.join(root, "semantic-layer");
    const dirs = await readdir(semanticLayer);
    expect(dirs).toContain("renamed");
    expect(dirs).not.toContain("mysql-aliyun");

    // wiki: sl_refs rewritten, body preserved.
    const wiki = await readFile(path.join(root, "wiki", "global", "playbook.md"), "utf8");
    expect(wiki).toMatch(/sl_refs:\s*\n\s*-\s*renamed\b/);
    expect(wiki).toMatch(/-\s*keep-me\b/);
    expect(wiki).toContain("# Body");
  });

  it("refuses the write when toId already exists", async () => {
    const root = await makeProject({});
    const originalKtx = await readFile(path.join(root, "ktx.yaml"), "utf8");
    await expect(
      applyConnectionIdChange(root, "mysql-aliyun", "keep-me", { write: true })
    ).rejects.toBeInstanceOf(ConnectionAlreadyExistsError);
    expect(await readFile(path.join(root, "ktx.yaml"), "utf8")).toBe(originalKtx);
  });
});

describe("applyConnectionIdChange — rollback", () => {
  it("restores every file when a post-rename step throws", async () => {
    const root = await makeProject({
      semanticFiles: { "superstore_orders.yaml": "grain: []\n" },
      wiki: [
        { key: "global/playbook.md", markdown: wikiMarkdown(["mysql-aliyun", "keep-me"]) }
      ]
    });

    const originalKtx = await readFile(path.join(root, "ktx.yaml"), "utf8");
    const originalAccess = await readFile(path.join(root, "webui", "config", "access.yaml"), "utf8");
    const originalWiki = await readFile(path.join(root, "wiki", "global", "playbook.md"), "utf8");
    const originalSemantic = (await readdir(path.join(root, "semantic-layer"))).sort();

    // Force the post-write audit hook to throw so the rollback path runs after
    // access.yaml / semantic dir / wiki / ktx.yaml have all been touched.
    await expect(
      applyConnectionIdChange(root, "mysql-aliyun", "renamed", {
        write: true,
        recordConfigChange: async () => {
          throw new Error("simulated post-write failure");
        }
      })
    ).rejects.toThrow("simulated post-write failure");

    // Every file/dir returned to its pre-rename state.
    expect(await readFile(path.join(root, "ktx.yaml"), "utf8")).toBe(originalKtx);
    expect(await readFile(path.join(root, "webui", "config", "access.yaml"), "utf8")).toBe(originalAccess);
    expect(await readFile(path.join(root, "wiki", "global", "playbook.md"), "utf8")).toBe(originalWiki);
    expect((await readdir(path.join(root, "semantic-layer"))).sort()).toEqual(originalSemantic);
  });

  it("restores access.yaml and the semantic directory when wiki write is not reached", async () => {
    const root = await makeProject({
      semanticFiles: { "superstore_orders.yaml": "grain: []\n" },
      wiki: [
        { key: "global/playbook.md", markdown: wikiMarkdown(["mysql-aliyun", "keep-me"]) }
      ]
    });

    const originalKtx = await readFile(path.join(root, "ktx.yaml"), "utf8");
    const originalAccess = await readFile(path.join(root, "webui", "config", "access.yaml"), "utf8");
    const originalWiki = await readFile(path.join(root, "wiki", "global", "playbook.md"), "utf8");
    const originalSemantic = (await readdir(path.join(root, "semantic-layer"))).sort();

    await expect(
      applyConnectionIdChange(root, "mysql-aliyun", "renamed", {
        write: true,
        injectFailure: "before_wiki"
      })
    ).rejects.toThrow("injected failure before wiki write");

    expect(await readFile(path.join(root, "ktx.yaml"), "utf8")).toBe(originalKtx);
    expect(await readFile(path.join(root, "webui", "config", "access.yaml"), "utf8")).toBe(originalAccess);
    expect(await readFile(path.join(root, "wiki", "global", "playbook.md"), "utf8")).toBe(originalWiki);
    expect((await readdir(path.join(root, "semantic-layer"))).sort()).toEqual(originalSemantic);
  });
});
