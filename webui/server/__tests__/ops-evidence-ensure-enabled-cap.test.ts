/**
 * Spec 20261104 §4.2 / §5 — ensure 之后的 `enabled_tables` 上限。
 *
 * 覆盖：H1（stock W0 自愈）、H2（定制 Manifest 不覆盖 + 无孤儿启用）、
 * H3（缺文件 → copied）、H4（定制 Skill／Wiki 仍 conflict）。
 *
 * 断言口径：ensure 之后 `lucy-ops.enabled_tables` ⊆ 本地 Manifest 物理表集合，
 * 且不再出现冻结表的「已启用 · 本地无 Manifest」。
 */

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPS_EVIDENCE_ENABLED_TABLES } from "../ops-evidence/contract";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "ops-evidence");
const W0_SCHEMA_FIXTURE = path.join(FIXTURE_DIR, "w0-schema-main.yaml");
const OLD_SKILL_FIXTURE = path.join(FIXTURE_DIR, "old-ops-questioning.skill.md");
const OLD_WIKI_FIXTURE = path.join(FIXTURE_DIR, "old-ops-questioning.wiki.md");

/** 定制 Manifest：只有三张表，并带一个自定义表。 */
const CUSTOM_SCHEMA = `tables:
  ops_calls:
    table: ops_calls
    columns:
      - name: event_id
        type: number
  ops_call_tables:
    table: ops_call_tables
    columns:
      - name: event_id
        type: number
  ops_agents:
    table: ops_agents
    columns:
      - name: agent_id
        type: string
`;

let projectRoot: string | undefined;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;

const ACCESS_YAML = `roles:
  lucy_ops_reader:
    description: ops evidence reader
    allow:
      connections:
        - lucy-ops
      tools:
        - lucy_query
users: []
`;

async function loadModule<T>(specifier: string): Promise<T> {
  vi.resetModules();
  return (await import(specifier)) as T;
}

async function makeProject(enabledTables: string[] | null): Promise<{ root: string; auditDbPath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-ops-enabled-cap-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  const auditDbPath = path.join(root, ".ktx-ui", "audit.sqlite");
  const block =
    enabledTables === null
      ? ""
      : `connections:
  lucy-ops:
    driver: sqlite
    readonly: true
    path: ${auditDbPath}
    database: ${auditDbPath}
    schemas:
      - main
    enabled_tables:
${enabledTables.map((table) => `      - ${table}`).join("\n")}
`;
  await writeFile(path.join(root, "ktx.yaml"), block, "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  return { root, auditDbPath };
}

/** 把内容根的 Manifest 写成给定文本（内容根 = 项目根的旧布局）。 */
async function writeSchemaText(root: string, text: string): Promise<string> {
  const dest = path.join(root, "semantic-layer", "lucy-ops", "_schema", "main.yaml");
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, text, "utf8");
  return dest;
}

/** 把内容根的 Manifest 写成夹具文件的内容。 */
async function writeSchemaFixture(root: string, fixture: string): Promise<string> {
  const dest = path.join(root, "semantic-layer", "lucy-ops", "_schema", "main.yaml");
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(fixture, dest);
  return dest;
}

async function readEnabledTablesFromKtx(root: string): Promise<string[]> {
  const raw = await readFile(path.join(root, "ktx.yaml"), "utf8");
  const { parse } = await import("yaml");
  const parsed = parse(raw) as { connections?: Record<string, { enabled_tables?: unknown }> };
  const block = parsed.connections?.["lucy-ops"];
  const tables = block?.enabled_tables;
  if (!Array.isArray(tables)) return [];
  return tables.filter((value): value is string => typeof value === "string");
}

/** Manifest 里声明的物理表集合。 */
async function readManifestPhysicalTables(root: string): Promise<string[]> {
  const { parse } = await import("yaml");
  const raw = await readFile(
    path.join(root, "semantic-layer", "lucy-ops", "_schema", "main.yaml"),
    "utf8"
  );
  const parsed = parse(raw) as { tables?: Record<string, { table?: string }> };
  return Object.values(parsed.tables ?? {})
    .map((value) => value?.table)
    .filter((value): value is string => typeof value === "string");
}

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
});

afterEach(async () => {
  const readiness = await import("../ops-evidence/readiness");
  readiness.resetOpsEvidenceEnsureState();
  const audit = await import("../proxy/audit");
  audit.closeAuditDb();
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true });
    projectRoot = undefined;
  }
  vi.resetModules();
});

describe("Spec 20261104 H1 / H3 — 官方历史资产自愈", () => {
  it("H1: 磁盘是 W0 stock Manifest → ensure 后 Manifest = 当前模板，enabled_tables = 全部冻结表", async () => {
    const { root, auditDbPath } = await makeProject(["ops_calls", "ops_call_tables"]);
    projectRoot = root;
    process.env.KTX_PROJECT_ROOT = root;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    // W0 Manifest + 旧 Skill + 旧 Wiki（都是登记在册的历史官方版本）。
    await writeSchemaFixture(root, W0_SCHEMA_FIXTURE);
    const skillDest = path.join(root, "skills", "lucy-ops", "ops-questioning.md");
    await mkdir(path.dirname(skillDest), { recursive: true });
    await copyFile(OLD_SKILL_FIXTURE, skillDest);
    const wikiDest = path.join(root, "wiki", "lucy-ops", "ops-questioning.md");
    await mkdir(path.dirname(wikiDest), { recursive: true });
    await copyFile(OLD_WIKI_FIXTURE, wikiDest);

    const { ensureOpsEvidence } = await loadModule<typeof import("../ops-evidence/ensure")>(
      "../ops-evidence/ensure"
    );
    const assets = await loadModule<typeof import("../ops-evidence/assets")>(
      "../ops-evidence/assets"
    );
    const result = await ensureOpsEvidence({ projectRoot: root, recreateViews: false });

    // Manifest 已升级为当前模板。
    const manifestDest = path.join(root, "semantic-layer", "lucy-ops", "_schema", "main.yaml");
    const templatePath = path.join(
      assets.OPS_EVIDENCE_TEMPLATE_ROOT,
      "semantic-layer",
      "lucy-ops",
      "_schema",
      "main.yaml"
    );
    expect((await readFile(manifestDest)).equals(await readFile(templatePath))).toBe(true);

    // schema / skill / wiki 都不是冲突，而是自愈升级。
    expect(result.assetConflicts.map((asset) => asset.spec.id)).toEqual([]);
    const upgradedIds = result.assetUpgrades.map((asset) => asset.spec.id).sort();
    expect(upgradedIds).toEqual(["semantic-layer/_schema", "skills/ops-questioning", "wiki/ops-questioning"]);

    // enabled_tables = 全部冻结表。
    expect(await readEnabledTablesFromKtx(root)).toEqual([...OPS_EVIDENCE_ENABLED_TABLES]);
    expect(result.connectionWrite).toBe("expanded");
  });

  it("H3: 资产全缺 → 全部 copied，enabled_tables 齐全", async () => {
    const { root, auditDbPath } = await makeProject(null);
    projectRoot = root;
    process.env.KTX_PROJECT_ROOT = root;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const { ensureOpsEvidence } = await loadModule<typeof import("../ops-evidence/ensure")>(
      "../ops-evidence/ensure"
    );
    const result = await ensureOpsEvidence({ projectRoot: root, recreateViews: false });

    expect(result.assets.length).toBeGreaterThan(0);
    expect(result.assets.every((asset) => asset.outcome === "copied")).toBe(true);
    expect(result.assetConflicts).toEqual([]);
    expect(await readEnabledTablesFromKtx(root)).toEqual([...OPS_EVIDENCE_ENABLED_TABLES]);
    expect(result.connectionWrite).toBe("inserted");
  });
});

describe("Spec 20261104 H2 / H4 — 定制资产不覆盖、启用范围不越界", () => {
  it("H2: 定制 Manifest → 不覆盖，enabled_tables ⊆ Manifest，无冻结表孤儿", async () => {
    // 旧实例留下的「盲目 union」状态：12 张冻结表全在启用范围里。
    const { root, auditDbPath } = await makeProject([...OPS_EVIDENCE_ENABLED_TABLES]);
    projectRoot = root;
    process.env.KTX_PROJECT_ROOT = root;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const manifestDest = await writeSchemaText(root, CUSTOM_SCHEMA);
    const before = await readFile(manifestDest);

    const { ensureOpsEvidence } = await loadModule<typeof import("../ops-evidence/ensure")>(
      "../ops-evidence/ensure"
    );
    const result = await ensureOpsEvidence({ projectRoot: root, recreateViews: false });

    // 定制 Manifest 不被覆盖。
    expect(await readFile(manifestDest)).toEqual(before);
    expect(result.assetConflicts.map((asset) => asset.spec.id)).toContain("semantic-layer/_schema");

    // enabled_tables ⊆ Manifest 物理表；冻结表里 Manifest 没有的全部移出。
    const manifestTables = await readManifestPhysicalTables(root);
    const enabled = await readEnabledTablesFromKtx(root);
    expect(enabled).toEqual(["ops_calls", "ops_call_tables", "ops_agents"]);
    for (const table of enabled) {
      expect(manifestTables, table).toContain(table);
    }
    // 没有「已启用 · 本地无 Manifest」的冻结表：启用的冻结表都必须在 Manifest 里。
    for (const table of enabled) {
      expect(OPS_EVIDENCE_ENABLED_TABLES.includes(table), table).toBe(true);
    }
    expect(result.connectionWrite).toBe("expanded");
  });

  it("H4: 定制 Skill／Wiki 仍 conflict；不影响 Manifest 已升级时的 enabled 上限", async () => {
    const { root, auditDbPath } = await makeProject(["ops_calls", "ops_call_tables"]);
    projectRoot = root;
    process.env.KTX_PROJECT_ROOT = root;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    await writeSchemaFixture(root, W0_SCHEMA_FIXTURE);
    const skillDest = path.join(root, "skills", "lucy-ops", "ops-questioning.md");
    await mkdir(path.dirname(skillDest), { recursive: true });
    await writeFile(skillDest, "---\nname: ops-questioning\nstatus: draft\n---\n\n定制。\n", "utf8");
    const wikiDest = path.join(root, "wiki", "lucy-ops", "ops-questioning.md");
    await mkdir(path.dirname(wikiDest), { recursive: true });
    await writeFile(wikiDest, "---\nname: ops-questioning\nstatus: draft\n---\n\n定制。\n", "utf8");

    const { ensureOpsEvidence } = await loadModule<typeof import("../ops-evidence/ensure")>(
      "../ops-evidence/ensure"
    );
    const result = await ensureOpsEvidence({ projectRoot: root, recreateViews: false });

    // 定制 Skill／Wiki 保留原样并记冲突。
    const conflictedIds = result.assetConflicts.map((asset) => asset.spec.id).sort();
    expect(conflictedIds).toEqual(["skills/ops-questioning", "wiki/ops-questioning"]);
    expect(await readFile(skillDest, "utf8")).toContain("status: draft");

    // Manifest 仍升级成功，启用范围仍受 Manifest 上限约束。
    expect(result.assetUpgrades.map((asset) => asset.spec.id)).toEqual(["semantic-layer/_schema"]);
    const enabled = await readEnabledTablesFromKtx(root);
    expect(enabled).toEqual([...OPS_EVIDENCE_ENABLED_TABLES]);
    const manifestTables = await readManifestPhysicalTables(root);
    for (const table of enabled) {
      expect(manifestTables, table).toContain(table);
    }
  });
});
