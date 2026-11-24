/**
 * P0-2 / REQ-030-023 — Catalog 业务语义暴露
 *
 * 覆盖 Spec SC-01–SC-17（O3＝8192）。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateContentPathsCache } from "../paths";
import {
  check,
  commitEffectivePolicy,
  extractSourceRefs,
  getPolicyRuntimeStatus,
  lucyCatalog,
  resetEffectivePolicyForTests
} from "../proxy/acl";
import type { Identity } from "../proxy/identity";
import { formatVisibleScopeSourceLine } from "../proxy/mcp-proxy";
import {
  MAX_TOTAL_DESCRIPTION_CHARS,
  assembleCatalogSources,
  assembleSourceEntry,
  bindingsMatch,
  boundPhysicalTableFromOverlay,
  descriptionIndexKey,
  enrichCatalogSources,
  loadDescriptionIndexes,
  overlayBindingsMatch,
  type CatalogSourceIdentity,
  type ManifestDescEntry,
  type OverlayDescEntry
} from "../proxy/source-descriptions";

const TOKEN = "catalog-semantics-token";
const CONNECTION = "demo-mysql";
const SCHEMA = "dataforai";
const VISIBLE = "orders_visible";
const HIDDEN = "orders_hidden";
const MARKER_HIDDEN = "__DESC_MARKER_HIDDEN_ONLY_xyz__";
const MARKER_AI = "__AI_SECRET_NEVER_IN_CATALOG__";
const MARKER_OPS = "__DESC_MARKER_OPS_NOT_READY_xyz__";
const MARKER_NEW = "__DESC_MARKER_M_NEW_only__";
const GRAIN_NEW = "__GRAIN_G_NEW_only__";
const MCP_PROXY_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../proxy/mcp-proxy.ts");

function identity(userId: string): Identity {
  return { userId, tokenLabel: "catalog-semantics", tokenHashPrefix: "catalog-semantics" };
}

function accessYaml(visibleTables: string[]): string {
  return `users:
  - id: catalog_agent
    name: Catalog Agent
    enabled: true
    tokens:
      - hash: "sha256:${TOKEN}"
        label: catalog-semantics
        created: 2026-11-08
    allow:
      tables:
${visibleTables.map((t) => `        - ${t}`).join("\n")}
      tools:
        - lucy_catalog
        - lucy_read_source
        - connection_list
`;
}

async function writeProject(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, body, "utf-8");
  }
}

describe("catalog business semantics — pure assemble (SC-01/03/04/05/08/10/14/15/16/17)", () => {
  const source: CatalogSourceIdentity = {
    connectionId: CONNECTION,
    schema: SCHEMA,
    sourceName: VISIBLE,
    table: `${SCHEMA}.${VISIBLE}`
  };

  function manifest(overrides: Partial<ManifestDescEntry> = {}): ManifestDescEntry {
    return {
      physicalTable: `${SCHEMA}.${VISIBLE}`,
      descriptionDb: "可见订单表业务描述",
      contentRoot: "/tmp",
      ...overrides
    };
  }

  function overlay(overrides: Partial<OverlayDescEntry> = {}): OverlayDescEntry {
    return {
      grain: ["order_id", "order_date"],
      boundPhysicalTable: `${SCHEMA}.${VISIBLE}`,
      contentRoot: "/tmp",
      ...overrides
    };
  }

  it("SC-01/SC-03: present description returns raw value", () => {
    const budget = { remaining: 8192 };
    const entry = assembleSourceEntry(source, manifest(), overlay(), budget);
    expect(entry.description).toBe("可见订单表业务描述");
    expect(entry.descriptionState).toBe("present");
    expect(entry.grain).toEqual(["order_id", "order_date"]);
  });

  it("SC-02 shape keys: four identity fields retained first", () => {
    const entry = assembleSourceEntry(source, manifest(), overlay(), { remaining: 100 });
    expect(Object.keys(entry).slice(0, 4)).toEqual([
      "connectionId",
      "schema",
      "sourceName",
      "table"
    ]);
    expect(entry.connectionId).toBe(CONNECTION);
    expect(entry.schema).toBe(SCHEMA);
    expect(entry.sourceName).toBe(VISIBLE);
    expect(entry.table).toBe(`${SCHEMA}.${VISIBLE}`);
  });

  it("SC-04: missing / blank db → missing", () => {
    for (const descriptionDb of [undefined, "", "   ", 42 as unknown]) {
      const entry = assembleSourceEntry(
        source,
        manifest({ descriptionDb }),
        overlay(),
        { remaining: 100 }
      );
      expect(entry.description).toBeNull();
      expect(entry.descriptionState).toBe("missing");
    }
  });

  it("SC-05: descriptions.ai never enters assemble/JSON", () => {
    const m = {
      physicalTable: `${SCHEMA}.${VISIBLE}`,
      descriptionDb: "db-only",
      contentRoot: "/tmp",
      // 误塞 ai 字段／嵌套 descriptions.ai，装配器仍只读 descriptionDb
      descriptionAi: MARKER_AI,
      descriptions: { ai: MARKER_AI, db: "db-only" }
    } as ManifestDescEntry;
    const entry = assembleSourceEntry(source, m, overlay(), { remaining: 100 });
    expect(entry).not.toHaveProperty("descriptions");
    expect(entry).not.toHaveProperty("descriptionAi");
    expect(JSON.stringify(entry)).not.toContain(MARKER_AI);
    expect(entry.description).toBe("db-only");
  });

  it("SC-08: budget truncates then zeros subsequent; entry count unchanged", () => {
    const a: CatalogSourceIdentity = { ...source, sourceName: "a_src", table: "t.a" };
    const b: CatalogSourceIdentity = { ...source, sourceName: "b_src", table: "t.b" };
    const c: CatalogSourceIdentity = { ...source, sourceName: "c_src", table: "t.c" };
    const longA = "A".repeat(10);
    const longB = "B".repeat(10);
    const longC = "C".repeat(10);
    const manifestIndex = new Map<string, ManifestDescEntry>([
      [descriptionIndexKey(a.connectionId, a.schema, a.sourceName), { physicalTable: "t.a", descriptionDb: longA, contentRoot: "/" }],
      [descriptionIndexKey(b.connectionId, b.schema, b.sourceName), { physicalTable: "t.b", descriptionDb: longB, contentRoot: "/" }],
      [descriptionIndexKey(c.connectionId, c.schema, c.sourceName), { physicalTable: "t.c", descriptionDb: longC, contentRoot: "/" }]
    ]);
    const entries = assembleCatalogSources([c, a, b], manifestIndex, new Map(), {
      maxTotalDescriptionChars: 15
    });
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.sourceName)).toEqual(["a_src", "b_src", "c_src"]); // SC-10 sort
    expect(entries[0]!.description).toBe(longA);
    expect(entries[0]!.descriptionState).toBe("present");
    expect(entries[1]!.description).toBe("BBBBB"); // remaining 5
    expect(entries[1]!.descriptionState).toBe("truncated");
    expect(entries[2]!.description).toBeNull();
    expect(entries[2]!.descriptionState).toBe("truncated");
    const totalChars = entries
      .map((e) => (typeof e.description === "string" ? e.description.length : 0))
      .reduce((s, n) => s + n, 0);
    expect(totalChars).toBeLessThanOrEqual(15);
    expect(MAX_TOTAL_DESCRIPTION_CHARS).toBe(8192);
  });

  it("SC-10: assembleCatalogSources sorts by sourceName.localeCompare", () => {
    const z = { ...source, sourceName: "zebra" };
    const a = { ...source, sourceName: "alpha" };
    const entries = assembleCatalogSources([z, a], new Map(), new Map(), {
      maxTotalDescriptionChars: 100
    });
    expect(entries.map((e) => e.sourceName)).toEqual(["alpha", "zebra"]);
  });

  it("SC-14: grain from overlay only when bindings match; omit otherwise", () => {
    const ok = assembleSourceEntry(source, manifest(), overlay(), { remaining: 100 });
    expect(ok.grain).toEqual(["order_id", "order_date"]);

    const noOverlay = assembleSourceEntry(source, manifest(), null, { remaining: 100 });
    expect(noOverlay.grain).toBeUndefined();

    const badStamp = assembleSourceEntry(
      source,
      manifest(),
      overlay({ boundPhysicalTable: "other.table", grain: ["should_not_appear"] }),
      { remaining: 100 }
    );
    expect(badStamp.grain).toBeUndefined();
    expect(badStamp.descriptionState).toBe("present"); // description unaffected
  });

  it("SC-15: leading/trailing spaces preserved when present", () => {
    const entry = assembleSourceEntry(
      source,
      manifest({ descriptionDb: "  x  " }),
      overlay(),
      { remaining: 100 }
    );
    expect(entry.description).toBe("  x  ");
    expect(entry.descriptionState).toBe("present");
  });

  it("SC-16: snapshot table T_old must not pick up rebound M_new", () => {
    const snapshot: CatalogSourceIdentity = {
      ...source,
      table: "dataforai.t_old"
    };
    const reboundManifest = manifest({
      physicalTable: "dataforai.t_new",
      descriptionDb: MARKER_NEW
    });
    const reboundOverlay = overlay({
      boundPhysicalTable: "dataforai.t_new",
      grain: [GRAIN_NEW]
    });
    expect(bindingsMatch(snapshot, reboundManifest)).toBe(false);
    const entry = assembleSourceEntry(snapshot, reboundManifest, reboundOverlay, {
      remaining: 1000
    });
    expect(entry.table).toBe("dataforai.t_old");
    expect(entry.descriptionState).toBe("missing");
    expect(entry.description).toBeNull();
    expect(JSON.stringify(entry)).not.toContain(MARKER_NEW);
    expect(entry.grain).toBeUndefined();

    // 对照：绑定一致时可出现
    const matched = assembleSourceEntry(
      { ...snapshot, table: "dataforai.t_new" },
      reboundManifest,
      reboundOverlay,
      { remaining: 1000 }
    );
    expect(matched.description).toBe(MARKER_NEW);
    expect(matched.grain).toEqual([GRAIN_NEW]);
  });

  it("SC-17(1): rebind between reads — old snapshot must not get G_new", () => {
    const snapshot: CatalogSourceIdentity = {
      ...source,
      table: "dataforai.t_old"
    };
    const oldManifest = manifest({
      physicalTable: "dataforai.t_old",
      descriptionDb: "old-desc"
    });
    // 先读旧 manifest 已通过；之后 overlay 改绑
    const newOverlay = overlay({
      boundPhysicalTable: "dataforai.t_new",
      grain: [GRAIN_NEW]
    });
    expect(overlayBindingsMatch(snapshot, oldManifest, newOverlay)).toBe(false);
    const entry = assembleSourceEntry(snapshot, oldManifest, newOverlay, { remaining: 100 });
    expect(entry.table).toBe("dataforai.t_old");
    expect(entry.description).toBe("old-desc");
    expect(entry.descriptionState).toBe("present");
    expect(entry.grain).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain(GRAIN_NEW);
  });

  it("SC-17(2): new overlay on disk, old manifest — must not stamp G_new via old manifest", () => {
    const snapshot: CatalogSourceIdentity = {
      ...source,
      table: "dataforai.t_old"
    };
    const oldManifest = manifest({
      physicalTable: "dataforai.t_old",
      descriptionDb: "still-old"
    });
    // 禁止：用后读旧 manifest.table 给新 overlay 盖戳
    const forbiddenStampFromManifest = boundPhysicalTableFromOverlay({
      table: undefined
    });
    expect(forbiddenStampFromManifest).toBeNull();

    const newOverlayOnly = overlay({
      boundPhysicalTable: boundPhysicalTableFromOverlay({ table: "dataforai.t_new" }),
      grain: [GRAIN_NEW]
    });
    expect(newOverlayOnly.boundPhysicalTable).toBe("dataforai.t_new");
    expect(overlayBindingsMatch(snapshot, oldManifest, newOverlayOnly)).toBe(false);
    const entry = assembleSourceEntry(snapshot, oldManifest, newOverlayOnly, { remaining: 100 });
    expect(entry.grain).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain(GRAIN_NEW);
    expect(entry.description).toBe("still-old");
  });

  it("SC-17(3): aligned overlay/manifest/source may write grain", () => {
    const entry = assembleSourceEntry(source, manifest(), overlay(), { remaining: 100 });
    expect(entry.grain).toEqual(["order_id", "order_date"]);
  });
});

describe("catalog business semantics — disk index + D4a isolation", () => {
  let root = "";
  const prevProjectRoot = process.env.KTX_PROJECT_ROOT;
  const prevContentRoot = process.env.LUCY_CONTENT_ROOT;
  const prevAuditDb = process.env.LUCY_AUDIT_DB;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "lucy-catalog-sem-"));
    process.env.KTX_PROJECT_ROOT = root;
    process.env.LUCY_CONTENT_ROOT = ".";
    delete process.env.LUCY_AUDIT_DB;
    invalidateContentPathsCache();
    resetEffectivePolicyForTests();
  });

  afterEach(async () => {
    if (prevProjectRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = prevProjectRoot;
    if (prevContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
    else process.env.LUCY_CONTENT_ROOT = prevContentRoot;
    if (prevAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
    else process.env.LUCY_AUDIT_DB = prevAuditDb;
    invalidateContentPathsCache();
    resetEffectivePolicyForTests();
    await rm(root, { recursive: true, force: true });
  });

  async function seedDualSourceProject(): Promise<void> {
    await writeProject(root, {
      "ktx.yaml": `connections:
  ${CONNECTION}:
    driver: mysql
    schemas:
      - ${SCHEMA}
    enabled_tables:
      - ${SCHEMA}.${VISIBLE}
      - ${SCHEMA}.${HIDDEN}
`,
      "webui/config/access.yaml": accessYaml([`${SCHEMA}.${VISIBLE}`]),
      [`semantic-layer/${CONNECTION}/_schema/${SCHEMA}.yaml`]: `tables:
  ${VISIBLE}:
    table: ${SCHEMA}.${VISIBLE}
    descriptions:
      db: "可见订单 ODS"
      ai: "${MARKER_AI}"
  ${HIDDEN}:
    table: ${SCHEMA}.${HIDDEN}
    descriptions:
      db: "${MARKER_HIDDEN}"
      ai: "${MARKER_AI}_hidden"
`,
      [`semantic-layer/${CONNECTION}/${VISIBLE}.yaml`]: `name: ${VISIBLE}
table: ${SCHEMA}.${VISIBLE}
grain:
  - order_id
`,
      [`semantic-layer/${CONNECTION}/${HIDDEN}.yaml`]: `name: ${HIDDEN}
table: ${SCHEMA}.${HIDDEN}
grain:
  - secret_grain
`
    });
  }

  it("SC-06: invisible source marker never assembled into visible entries", async () => {
    await seedDualSourceProject();
    const catalog = await lucyCatalog(identity("catalog_agent"));
    // D4a／SC-06：条目不含不可见 sourceName（避免全 JSON not.toContain(HIDDEN) 与 D4b 张力）
    expect(catalog.sources.map((s) => s.sourceName)).toEqual([VISIBLE]);
    expect(catalog.sources).toHaveLength(1);
    expect(catalog.sources.every((s) => s.sourceName !== HIDDEN)).toBe(true);
    const json = JSON.stringify(catalog);
    expect(json).not.toContain(MARKER_HIDDEN);
    expect(json).not.toContain("secret_grain");
    expect(json).not.toContain(MARKER_AI);
    expect(catalog.sources[0]!.description).toBe("可见订单 ODS");
    expect(catalog.sources[0]!.descriptionState).toBe("present");
    expect(catalog.sources[0]!.grain).toEqual(["order_id"]);
  });

  it("SC-05 disk: manifest descriptions.ai never appears in indexes or catalog JSON", async () => {
    await seedDualSourceProject();
    const indexes = await loadDescriptionIndexes(path.join(root, "semantic-layer"), [CONNECTION]);
    const key = descriptionIndexKey(CONNECTION, SCHEMA, VISIBLE);
    const manifestEntry = indexes.manifestIndex.get(key);
    expect(manifestEntry?.descriptionDb).toBe("可见订单 ODS");
    expect(JSON.stringify(manifestEntry)).not.toContain(MARKER_AI);
    const catalog = await lucyCatalog(identity("catalog_agent"));
    expect(JSON.stringify(catalog)).not.toContain(MARKER_AI);
  });

  it("SC-07: member set equals D0 final; degradedGlobal empties without LKG descriptions", async () => {
    await seedDualSourceProject();
    const before = await lucyCatalog(identity("catalog_agent"));
    expect(before.sources.map((s) => s.sourceName)).toEqual([VISIBLE]);
    expect(before.sources).toHaveLength(1);
    expect(before.sources[0]!.description).toBe("可见订单 ODS");

    // 全局降级：空目录，不得把 LKG 权限上的描述装回来
    await writeFile(path.join(root, "webui/config/access.yaml"), "{ not: valid access\n", "utf-8");
    const status = await commitEffectivePolicy();
    expect(status.degradedGlobal).toBe(true);
    expect(getPolicyRuntimeStatus().degradedGlobal).toBe(true);

    const degraded = await lucyCatalog(identity("catalog_agent"));
    expect(degraded.connections).toEqual([]);
    expect(degraded.sources).toEqual([]);
    expect(degraded.examples).toEqual([]);
    const json = JSON.stringify(degraded);
    expect(json).not.toContain("可见订单 ODS");
    expect(json).not.toContain(MARKER_HIDDEN);
    expect(json).not.toContain(MARKER_AI);
  });

  it("SC-07: unreadiness filter member set = D0 (ops connection excluded)", async () => {
    const auditDbPath = path.join(root, ".ktx-ui", "audit.sqlite");
    await mkdir(path.dirname(auditDbPath), { recursive: true });
    await writeProject(root, {
      "ktx.yaml": `connections:
  ${CONNECTION}:
    driver: mysql
    schemas:
      - ${SCHEMA}
    enabled_tables:
      - ${SCHEMA}.${VISIBLE}
  lucy-ops:
    driver: sqlite
    readonly: true
    path: ${auditDbPath}
    schemas:
      - main
    enabled_tables:
      - ops_calls
`,
      "webui/config/access.yaml": `roles:
  catalog_with_ops:
    description: demo + ops
    permission_model_version: 2
    allow:
      connections:
        - ${CONNECTION}
        - lucy-ops
      tableSelectors:
        - connection: ${CONNECTION}
          schema: ${SCHEMA}
          names:
            - ${VISIBLE}
          row_access: all
        - connection: lucy-ops
          schema: main
          names:
            - ops_calls
          row_access: all
      tools:
        - lucy_catalog
        - lucy_read_source
        - connection_list
users:
  - id: catalog_agent
    name: Catalog Agent
    enabled: true
    role: catalog_with_ops
    tokens:
      - hash: "sha256:${TOKEN}"
        label: catalog-semantics
        created: 2026-11-08
defaults:
  deny_tools: []
`,
      [`semantic-layer/${CONNECTION}/_schema/${SCHEMA}.yaml`]: `tables:
  ${VISIBLE}:
    table: ${SCHEMA}.${VISIBLE}
    descriptions:
      db: "可见订单 ODS"
`,
      [`semantic-layer/${CONNECTION}/${VISIBLE}.yaml`]: `name: ${VISIBLE}
table: ${SCHEMA}.${VISIBLE}
grain:
  - order_id
`,
      "semantic-layer/lucy-ops/_schema/main.yaml": `tables:
  ops_calls:
    table: ops_calls
    descriptions:
      db: "${MARKER_OPS}"
`,
      "semantic-layer/lucy-ops/ops_calls.yaml": `name: ops_calls
table: ops_calls
grain:
  - call_id
`
    });
    process.env.LUCY_AUDIT_DB = auditDbPath;
    resetEffectivePolicyForTests();
    invalidateContentPathsCache();

    // 未写 readiness stamp → lucy-ops 未就绪；D0 成员集仅剩 demo
    const catalog = await lucyCatalog(identity("catalog_agent"));
    expect(catalog.connections).toEqual([CONNECTION]);
    expect(catalog.connections).not.toContain("lucy-ops");
    expect(catalog.sources.map((s) => s.sourceName)).toEqual([VISIBLE]);
    expect(catalog.sources.some((s) => s.connectionId === "lucy-ops")).toBe(false);
    expect(JSON.stringify(catalog)).not.toContain(MARKER_OPS);
    expect(JSON.stringify(catalog)).not.toContain("call_id");
  });

  it("SC-09: corrupt single file does not wipe others; missing root → missing", async () => {
    await seedDualSourceProject();
    await writeFile(
      path.join(root, `semantic-layer/${CONNECTION}/_schema/broken.yaml`),
      "tables:\n  [[[not yaml",
      "utf-8"
    );
    const catalog = await lucyCatalog(identity("catalog_agent"));
    expect(catalog.sources).toHaveLength(1);
    expect(catalog.sources[0]!.descriptionState).toBe("present");

    // 整根缺失
    await rm(path.join(root, "semantic-layer"), { recursive: true, force: true });
    resetEffectivePolicyForTests();
    invalidateContentPathsCache();
    // sourceMap 也会空，可能导致空目录；改用纯 enrich 路径验证
    const enriched = await enrichCatalogSources(
      [
        {
          connectionId: CONNECTION,
          schema: SCHEMA,
          sourceName: VISIBLE,
          table: `${SCHEMA}.${VISIBLE}`
        }
      ],
      {
        semanticLayerRoot: path.join(root, "semantic-layer-absent"),
        connectionScope: [CONNECTION]
      }
    );
    expect(enriched).toHaveLength(1);
    expect(enriched[0]!.descriptionState).toBe("missing");
    expect(enriched[0]!.sourceName).toBe(VISIBLE);
  });

  it("SC-12: production Visible Scope formatter omits description fields", async () => {
    // 锁定 mcp-proxy 真实拼装接线，禁止手写行假绿
    const mcpSrc = await readFile(MCP_PROXY_SRC, "utf-8");
    expect(mcpSrc).toMatch(/catalog\.sources\.map\(\s*formatVisibleScopeSourceLine\s*\)/);

    const fatSource = {
      connectionId: CONNECTION,
      schema: SCHEMA,
      sourceName: VISIBLE,
      table: `${SCHEMA}.${VISIBLE}`,
      description: "must-not-appear-in-scope-line",
      descriptionState: "present" as const,
      grain: ["order_id"]
    };
    const line = formatVisibleScopeSourceLine(fatSource);
    expect(line).toBe(
      `- ${CONNECTION}.${SCHEMA}.${VISIBLE} -> ${SCHEMA}.${VISIBLE}`
    );
    expect(line).not.toContain("must-not-appear");
    expect(line).not.toContain("descriptionState");
    expect(line).not.toContain("order_id");
    expect(line).not.toContain("description");
  });

  it("SC-16 disk: rebound assets after snapshot do not attach M_new", async () => {
    await seedDualSourceProject();
    const indexesBefore = await loadDescriptionIndexes(
      path.join(root, "semantic-layer"),
      [CONNECTION]
    );
    const snapshot: CatalogSourceIdentity = {
      connectionId: CONNECTION,
      schema: SCHEMA,
      sourceName: VISIBLE,
      table: `${SCHEMA}.${VISIBLE}`
    };
    // 改绑
    await writeFile(
      path.join(root, `semantic-layer/${CONNECTION}/_schema/${SCHEMA}.yaml`),
      `tables:
  ${VISIBLE}:
    table: ${SCHEMA}.t_new
    descriptions:
      db: "${MARKER_NEW}"
`,
      "utf-8"
    );
    await writeFile(
      path.join(root, `semantic-layer/${CONNECTION}/${VISIBLE}.yaml`),
      `name: ${VISIBLE}
table: ${SCHEMA}.t_new
grain:
  - ${GRAIN_NEW}
`,
      "utf-8"
    );
    // 继续用改绑前索引装配快照（模拟「取得最终集合后同键改绑再读」）
    const entry = assembleSourceEntry(
      snapshot,
      indexesBefore.manifestIndex.get(descriptionIndexKey(CONNECTION, SCHEMA, VISIBLE)),
      indexesBefore.overlayIndex.get(descriptionIndexKey(CONNECTION, SCHEMA, VISIBLE)),
      { remaining: 8192 }
    );
    expect(entry.table).toBe(`${SCHEMA}.${VISIBLE}`);
    expect(entry.descriptionState).toBe("present");
    expect(JSON.stringify(entry)).not.toContain(MARKER_NEW);

    // 用新索引装配旧快照 → missing（物理表失配）
    const indexesAfter = await loadDescriptionIndexes(
      path.join(root, "semantic-layer"),
      [CONNECTION]
    );
    const rebound = assembleSourceEntry(
      snapshot,
      indexesAfter.manifestIndex.get(descriptionIndexKey(CONNECTION, SCHEMA, VISIBLE)),
      indexesAfter.overlayIndex.get(descriptionIndexKey(CONNECTION, SCHEMA, VISIBLE)),
      { remaining: 8192 }
    );
    expect(rebound.descriptionState).toBe("missing");
    expect(JSON.stringify(rebound)).not.toContain(MARKER_NEW);
    expect(rebound.grain).toBeUndefined();
  });

  it("SC-17 disk: overlay ahead of manifest must not write G_new on old table", async () => {
    await writeProject(root, {
      "ktx.yaml": `connections:
  ${CONNECTION}:
    driver: mysql
    schemas:
      - ${SCHEMA}
`,
      "webui/config/access.yaml": accessYaml([`${SCHEMA}.t_old`]),
      [`semantic-layer/${CONNECTION}/_schema/${SCHEMA}.yaml`]: `tables:
  ${VISIBLE}:
    table: ${SCHEMA}.t_old
    descriptions:
      db: "old still"
`,
      [`semantic-layer/${CONNECTION}/${VISIBLE}.yaml`]: `name: ${VISIBLE}
table: ${SCHEMA}.t_new
grain:
  - ${GRAIN_NEW}
`
    });
    const indexes = await loadDescriptionIndexes(path.join(root, "semantic-layer"), [CONNECTION]);
    const key = descriptionIndexKey(CONNECTION, SCHEMA, VISIBLE);
    const overlay = indexes.overlayIndex.get(key);
    expect(overlay?.boundPhysicalTable).toBe(`${SCHEMA}.t_new`);
    expect(overlay?.grain).toEqual([GRAIN_NEW]);

    const entry = assembleSourceEntry(
      {
        connectionId: CONNECTION,
        schema: SCHEMA,
        sourceName: VISIBLE,
        table: `${SCHEMA}.t_old`
      },
      indexes.manifestIndex.get(key),
      overlay,
      { remaining: 8192 }
    );
    expect(entry.description).toBe("old still");
    expect(entry.grain).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain(GRAIN_NEW);
  });

  it("case-insensitive index key match", async () => {
    await writeProject(root, {
      "ktx.yaml": "project:\n  name: catalog-sem\n",
      [`semantic-layer/${CONNECTION}/_schema/${SCHEMA}.yaml`]: `tables:
  Orders_Visible:
    table: ${SCHEMA}.Orders_Visible
    descriptions:
      db: "Case Key"
`,
      [`semantic-layer/${CONNECTION}/Orders_Visible.yaml`]: `name: Orders_Visible
table: ${SCHEMA}.Orders_Visible
grain:
  - pk
`
    });
    const indexes = await loadDescriptionIndexes(path.join(root, "semantic-layer"), [CONNECTION]);
    const key = descriptionIndexKey(CONNECTION, SCHEMA, "orders_visible");
    expect(indexes.manifestIndex.get(key)?.descriptionDb).toBe("Case Key");
    expect(indexes.overlayIndex.get(key)?.grain).toEqual(["pk"]);
  });
});

describe("catalog business semantics — SC-11 regression surface", () => {
  let root = "";
  const prevProjectRoot = process.env.KTX_PROJECT_ROOT;
  const prevContentRoot = process.env.LUCY_CONTENT_ROOT;
  const prevAuditDb = process.env.LUCY_AUDIT_DB;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "lucy-catalog-sem-sc11-"));
    process.env.KTX_PROJECT_ROOT = root;
    process.env.LUCY_CONTENT_ROOT = ".";
    delete process.env.LUCY_AUDIT_DB;
    invalidateContentPathsCache();
    resetEffectivePolicyForTests();
  });

  afterEach(async () => {
    if (prevProjectRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = prevProjectRoot;
    if (prevContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
    else process.env.LUCY_CONTENT_ROOT = prevContentRoot;
    if (prevAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
    else process.env.LUCY_AUDIT_DB = prevAuditDb;
    invalidateContentPathsCache();
    resetEffectivePolicyForTests();
    await rm(root, { recursive: true, force: true });
  });

  it("assemble does not mutate identity fields of input sources", () => {
    const source: CatalogSourceIdentity = {
      connectionId: "c",
      schema: "s",
      sourceName: "n",
      table: "s.n"
    };
    const frozen = { ...source };
    assembleSourceEntry(
      source,
      {
        physicalTable: "s.n",
        descriptionDb: "d",
        contentRoot: "/"
      },
      {
        grain: ["g"],
        boundPhysicalTable: "s.n",
        contentRoot: "/"
      },
      { remaining: 10 }
    );
    expect(source).toEqual(frozen);
  });

  it("SC-11: lucy_read_source identity fields still resolve (thin ACL regression)", async () => {
    await writeProject(root, {
      "ktx.yaml": `connections:
  ${CONNECTION}:
    driver: mysql
    schemas:
      - ${SCHEMA}
    enabled_tables:
      - ${SCHEMA}.${VISIBLE}
`,
      "webui/config/access.yaml": accessYaml([`${SCHEMA}.${VISIBLE}`]),
      [`semantic-layer/${CONNECTION}/_schema/${SCHEMA}.yaml`]: `tables:
  ${VISIBLE}:
    table: ${SCHEMA}.${VISIBLE}
    descriptions:
      db: "可见订单 ODS"
`,
      [`semantic-layer/${CONNECTION}/${VISIBLE}.yaml`]: `name: ${VISIBLE}
table: ${SCHEMA}.${VISIBLE}
grain:
  - order_id
`
    });

    await expect(
      check(identity("catalog_agent"), "lucy_read_source", {
        connectionId: CONNECTION,
        sourceName: VISIBLE
      })
    ).resolves.toEqual({ allowed: true });

    const refs = await extractSourceRefs("lucy_read_source", {
      connectionId: CONNECTION,
      sourceName: VISIBLE
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      connectionId: CONNECTION,
      schema: SCHEMA,
      sourceName: VISIBLE,
      physicalTable: `${SCHEMA}.${VISIBLE}`
    });
  });
});
