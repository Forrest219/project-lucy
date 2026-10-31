import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ktx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ktx")>();
  return {
    ...actual,
    validateSource: vi.fn(async () => ({ ok: true, exitCode: 0, stdout: "", stderr: "", issues: [] }))
  };
});

import { buildServer } from "../index";
import {
  beginDisplayWrite,
  displayGenerations,
  endDisplayWrite,
  hasPendingDisplayWrite,
  onDisplayGenerationChange,
  resetDisplayGenerationsForTests,
  withDisplayWriteBarrier
} from "../display-generation";
import { resetDisplaySnapshotsForTests, startDisplayReconciler, stopDisplayReconciler, displaySnapshotDiagnostics } from "../display-snapshot";
import { auditedWriteFile } from "../admin/config-audit-write";
import { reloadCatalog } from "../catalog-reload";
import { removeConnection } from "../project";
import { invalidateContentPathsCache } from "../paths";
import { invalidateAccessConfigCache } from "../proxy/identity";
import { commitEffectivePolicy, resetEffectivePolicyForTests } from "../proxy/acl";
import { resetAdminsCache } from "../auth/admins-store";

const KTX_YAML = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
      - fin.fin_budget
  spare:
    driver: mysql
    enabled_tables: []
`;
const MANIFEST = `tables:
  fin_ledger:
    table: fin.fin_ledger
    columns:
      - name: id
        type: number
      - name: region
        type: string
  fin_budget:
    table: fin.fin_budget
    columns:
      - name: id
        type: number
`;
const ACCESS = `roles:
  ledger_all:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: all
      tools: [lucy_query, lucy_catalog]
users:
  - id: zhangsan
    name: Zhang San
    enabled: true
    roles: [ledger_all]
    tokens:
      - hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111"
        label: laptop
        created: "2026-10-01"
  - id: lisi
    name: Li Si
    enabled: true
    roles: [ledger_all]
    tokens: []
defaults:
  known_tools: [lucy_query, lucy_catalog]
  table_touching_tools: [lucy_query]
`;

let projectRoot: string;
const savedEnv = { ...process.env };
let app: ReturnType<typeof buildServer>;

async function sources() {
  const res = await request(app.server).get("/api/sources").expect(200);
  return { body: res.body, cache: String(res.headers["server-timing"] ?? "").match(/cache;desc=(\w+)/)?.[1] };
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-display-inval-"));
  await mkdir(path.join(projectRoot, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"), MANIFEST, "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS, "utf8");
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_PROXY_UPSTREAM_PORT = "9";
  process.env.LUCY_MCP_RUNTIME_PROBE_TIMEOUT_MS = "50";
  process.env.LUCY_WEBUI_AUTH = "off";
  process.env.LUCY_ADMINS_CONFIG_PATH = path.join(projectRoot, "no-admins.yaml");
  delete process.env.LUCY_ACCESS_CONFIG_PATH;
  invalidateContentPathsCache();
  invalidateAccessConfigCache();
  resetEffectivePolicyForTests();
  resetAdminsCache();
  resetDisplayGenerationsForTests();
  resetDisplaySnapshotsForTests();
  await commitEffectivePolicy();
  await startDisplayReconciler({ metadataIntervalMs: 60_000, fullDigestIntervalMs: 60_000 });
  app = buildServer();
  await app.ready();
});

afterEach(async () => {
  await app.close();
  stopDisplayReconciler();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  invalidateContentPathsCache();
  invalidateAccessConfigCache();
  resetEffectivePolicyForTests();
  resetAdminsCache();
  await rm(projectRoot, { recursive: true, force: true });
});

describe("Spec 174 T3 — invalidation matrix (DI-01..15/18)", () => {
  it("serves hot reads from the versioned snapshot without re-reading YAML", async () => {
    expect((await sources()).cache).toBe("miss");
    const hot = await sources();
    expect(hot.cache).toBe("hit");
    expect(hot.body.data.meta.authorizedCountsState).toBe("ok");
    expect(hot.body.data.tables.map((t: { table: string; authorizedAgentCount: number }) => `${t.table}:${t.authorizedAgentCount}`)).toEqual(["fin_budget:0", "fin_ledger:2"]);
  });

  it("DI-01 barriers open before the write and close after it, with or without audit; wiki writes do not touch D/P", async () => {
    // The reconciler's file watcher bumps the D generation asynchronously, so
    // the delta would depend on whether the watcher had fired before the
    // measurement. This case is about the write barriers, not the watcher.
    stopDisplayReconciler();
    const seen: Array<{ pending: boolean }> = [];
    const off = onDisplayGenerationChange(() => seen.push({ pending: hasPendingDisplayWrite(["D"]) }));
    const before = displayGenerations();
    await auditedWriteFile(projectRoot, "semantic-layer/warehouse/_schema/fin.yaml", MANIFEST.replace("fin_budget", "fin_plan"));
    await auditedWriteFile(projectRoot, "semantic-layer/warehouse/fin_ledger.yaml", "grain: [id]\n", {
      enabled: true, changeType: "semantic_table_save", assetKind: "semantic"
    });
    await mkdir(path.join(projectRoot, "wiki"), { recursive: true });
    const mid = displayGenerations();
    await auditedWriteFile(projectRoot, "wiki/note.md", "# note\n");
    off();
    expect(mid.D).toBe(before.D + 4);
    expect(mid.P).toBe(before.P + 2);
    expect(displayGenerations()).toEqual(mid);
    expect(seen[0]).toEqual({ pending: true });
    expect(hasPendingDisplayWrite()).toBe(false);
  });

  it("DI-01/02 partial failure after touching disk still invalidates and releases", async () => {
    await sources();
    await expect(withDisplayWriteBarrier(["D", "P"], async () => {
      await writeFile(path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"), MANIFEST.replace("fin_budget", "fin_partial"), "utf8");
      throw new Error("second file failed");
    })).rejects.toThrow("second file failed");
    expect(hasPendingDisplayWrite()).toBe(false);
    const after = await sources();
    expect(after.cache).toBe("miss");
    expect(after.body.data.tables.map((t: { table: string }) => t.table)).toContain("fin_partial");
  });

  it("DI-03 dryRun never invalidates; a confirmed save is visible on the next request", async () => {
    const first = await sources();
    const gens = displayGenerations();
    await request(app.server).put("/api/sources/warehouse/fin/fin_ledger").send({ dryRun: true, patch: { grain: ["id"] } }).expect(200);
    expect(displayGenerations()).toEqual(gens);
    expect((await sources()).cache).toBe("hit");
    await request(app.server).put("/api/sources/warehouse/fin/fin_ledger").send({ dryRun: false, patch: { grain: ["id"] } }).expect(200);
    const next = await sources();
    expect(next.cache).toBe("miss");
    expect(next.body.data.meta.snapshotVersion).not.toBe(first.body.data.meta.snapshotVersion);
    expect(next.body.data.tables.find((t: { table: string }) => t.table === "fin_ledger").hasGrain).toBe(true);
  });

  it("DI-05/16 enabled_tables writes refresh sources and catalog_bound facts", async () => {
    await sources();
    await request(app.server).put("/api/connections/warehouse/enabled-tables").send({ dryRun: false, enabledTables: ["fin.fin_ledger"] }).expect(200);
    const next = await sources();
    expect(next.cache).toBe("miss");
    expect(next.body.data.tables.find((t: { table: string }) => t.table === "fin_budget").enabled).toBe(false);
  });

  it("DI-06 confirmed connection removal invalidates C; dryRun does not", async () => {
    const gens = displayGenerations();
    await removeConnection(projectRoot, "spare", true);
    expect(displayGenerations().C).toBe(gens.C);
    await removeConnection(projectRoot, "spare", false);
    expect(displayGenerations().C).toBeGreaterThan(gens.C);
    expect(hasPendingDisplayWrite()).toBe(false);
  });

  it("DI-07/15 Agent writes hold P pending through commit, and the list rebuilds from one snapshot", async () => {
    const list = await request(app.server).get("/api/admin/agents").expect(200);
    expect(list.body.data.meta.permissionsState).toBe("ok");
    expect(list.body.data.agents.find((a: { id: string }) => a.id === "lisi").effectivePermissions).toBeTruthy();
    const pendingDuringWrite: boolean[] = [];
    const off = onDisplayGenerationChange(() => pendingDuringWrite.push(hasPendingDisplayWrite(["P"])));
    await request(app.server).patch("/api/admin/agents/lisi").send({ dryRun: false, patch: { enabled: false } }).expect(200);
    off();
    expect(pendingDuringWrite.filter(Boolean).length).toBeGreaterThanOrEqual(2);
    expect(hasPendingDisplayWrite()).toBe(false);
    const after = await request(app.server).get("/api/admin/agents").expect(200);
    const lisi = after.body.data.agents.find((a: { id: string }) => a.id === "lisi");
    expect(lisi.enabled).toBe(false);
    expect(lisi.permissionWarnings).toEqual(["agent_disabled"]);
    expect(after.body.data.version).not.toBe(list.body.data.version);
    expect((await sources()).body.data.tables.find((t: { table: string }) => t.table === "fin_ledger").authorizedAgentCount).toBe(1);
  });

  it("DI-15 a list request during a pending access write waits and returns the new state", async () => {
    await request(app.server).get("/api/admin/agents").expect(200);
    const token = beginDisplayWrite(["P"]);
    const pendingList = request(app.server).get("/api/admin/agents");
    setTimeout(() => {
      void writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS.replace("name: Li Si", "name: Li Si 2"), "utf8")
        .then(() => endDisplayWrite(token));
    }, 30);
    const res = await pendingList;
    expect(res.status).toBe(200);
    expect(res.body.data.agents.find((a: { id: string }) => a.id === "lisi").name).toBe("Li Si 2");
  });

  it("DI-09 token revoke invalidates P", async () => {
    const gens = displayGenerations();
    await request(app.server).delete("/api/admin/agents/zhangsan/tokens/laptop").expect(200);
    expect(displayGenerations().P).toBeGreaterThan(gens.P);
    expect(hasPendingDisplayWrite()).toBe(false);
  });

  it("DI-10 catalog reload invalidates D; DI-11 restore draft preview is read-only", async () => {
    const gens = displayGenerations();
    await reloadCatalog(projectRoot);
    expect(displayGenerations().D).toBeGreaterThan(gens.D);
    const afterReload = displayGenerations();
    await request(app.server).get("/api/sources/warehouse/fin/fin_ledger/versions");
    expect(displayGenerations()).toEqual(afterReload);
  });

  it("DI-13 external edits invalidate through the reconciler", async () => {
    await sources();
    await writeFile(path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"), MANIFEST.replace("fin_budget", "fin_external"), "utf8");
    const { reconcileMetadata } = await import("../display-snapshot");
    await reconcileMetadata();
    const next = await sources();
    expect(next.cache).toBe("miss");
    expect(next.body.data.tables.map((t: { table: string }) => t.table)).toContain("fin_external");
  });

  it("DI-18 a warm cache never answers an unauthenticated request", async () => {
    await sources();
    expect((await sources()).cache).toBe("hit");
    const { hashPassword } = await import("../auth/password");
    await writeFile(process.env.LUCY_ADMINS_CONFIG_PATH!, `version: "1"\nadmins:\n  - id: owner\n    display_name: Owner\n    password_hash: "${await hashPassword("perf-owner-pass-1")}"\n    role: owner\n    enabled: true\n`, "utf8");
    process.env.LUCY_WEBUI_AUTH = "required";
    resetAdminsCache();
    const denied = await request(app.server).get("/api/sources");
    expect(denied.status).toBe(401);
    expect(JSON.stringify(denied.body)).not.toContain("fin_ledger");
    const deniedAgents = await request(app.server).get("/api/admin/agents");
    expect(deniedAgents.status).toBe(401);
  });

  it("R1 unverified reconciliation: sources and agents are busy with no data, then serve the final disk state", async () => {
    await sources();
    await request(app.server).get("/api/admin/agents").expect(200);
    stopDisplayReconciler();
    await writeFile(path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"), MANIFEST.replace("fin_budget", "fin_unverified"), "utf8");
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS.replace("name: Li Si", "name: Li Si 3"), "utf8");
    for (const url of ["/api/sources", "/api/admin/agents"]) {
      const busy = await request(app.server).get(url);
      expect(busy.status).toBe(503);
      expect(busy.headers["retry-after"]).toBe("1");
      expect(busy.body).toEqual({ ok: false, error: { code: "DISPLAY_SNAPSHOT_BUSY", message: "页面数据暂时无法完成刷新，请稍后重试。" } });
    }
    await startDisplayReconciler({ metadataIntervalMs: 60_000, fullDigestIntervalMs: 60_000 });
    const recovered = await sources();
    expect(recovered.body.data.tables.map((t: { table: string }) => t.table)).toContain("fin_unverified");
    const agents = await request(app.server).get("/api/admin/agents").expect(200);
    expect(agents.body.data.agents.find((a: { id: string }) => a.id === "lisi").name).toBe("Li Si 3");
  });

  it("R1 busy while unverified still runs RequireAuth first", async () => {
    stopDisplayReconciler();
    const { hashPassword } = await import("../auth/password");
    await writeFile(process.env.LUCY_ADMINS_CONFIG_PATH!, `version: "1"\nadmins:\n  - id: owner\n    display_name: Owner\n    password_hash: "${await hashPassword("perf-owner-pass-1")}"\n    role: owner\n    enabled: true\n`, "utf8");
    process.env.LUCY_WEBUI_AUTH = "required";
    resetAdminsCache();
    expect((await request(app.server).get("/api/sources")).status).toBe(401);
  });

  it("returns DISPLAY_SNAPSHOT_BUSY with Retry-After when writes never settle", async () => {
    const token = beginDisplayWrite(["D"]);
    const res = await request(app.server).get("/api/sources");
    endDisplayWrite(token);
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("1");
    expect(res.body.error.code).toBe("DISPLAY_SNAPSHOT_BUSY");
    expect(res.body.error.message).toBe("页面数据暂时无法完成刷新，请稍后重试。");
  });

  /**
   * Spec 195 §4 / SI-04 — an overlay-only save touches D only. The Agent
   * permission display depends on P/C, so it must neither be invalidated nor
   * rebuilt by a plain overlay change.
   */
  it("SI-04 an overlay-only save advances D but not P/C and does not rebuild the Agent permissions", async () => {
    await sources();
    await request(app.server).get("/api/admin/agents").expect(200);
    const gens = displayGenerations();
    const builds = displaySnapshotDiagnostics().builds;

    await request(app.server).put("/api/sources/warehouse/fin/fin_ledger").send({ dryRun: false, patch: { grain: ["id"] } }).expect(200);

    const after = displayGenerations();
    expect(after.D).toBeGreaterThan(gens.D);
    expect(after.P).toBe(gens.P);
    expect(after.C).toBe(gens.C);
    // The write itself builds nothing.
    expect(displaySnapshotDiagnostics().builds).toBe(builds);

    // The Agent list still serves the cached permission section.
    await request(app.server).get("/api/admin/agents").expect(200);
    expect(displaySnapshotDiagnostics().builds).toBe(builds);

    // The semantic asset display does rebuild, exactly once.
    const next = await sources();
    expect(next.cache).toBe("miss");
    expect(displaySnapshotDiagnostics().builds).toBe(builds + 1);
  });

  /**
   * Spec 195 §4 / SI-08 — a Manifest write still feeds the permission
   * display, so the Agent list must be invalidated and rebuilt.
   */
  it("SI-08 a Manifest write still invalidates and rebuilds the Agent permissions", async () => {
    await sources();
    await request(app.server).get("/api/admin/agents").expect(200);
    const gens = displayGenerations();
    const builds = displaySnapshotDiagnostics().builds;

    // A schema patch writes the Manifest, which feeds D and P.
    await request(app.server).put("/api/sources/warehouse/fin/fin_ledger")
      .send({ dryRun: false, patch: { tableDescription: "ledger table" } })
      .expect(200);

    const after = displayGenerations();
    expect(after.P).toBeGreaterThan(gens.P);
    await request(app.server).get("/api/admin/agents").expect(200);
    expect(displaySnapshotDiagnostics().builds).toBe(builds + 1);
  });

  /**
   * Spec 195 §4 / SI-08 — a connection-scope change (ktx.yaml) still
   * invalidates the Agent permissions.
   */
  it("SI-08 a connection-scope change still invalidates the Agent permissions", async () => {
    await sources();
    await request(app.server).get("/api/admin/agents").expect(200);
    const gens = displayGenerations();
    const builds = displaySnapshotDiagnostics().builds;

    await request(app.server).put("/api/connections/warehouse/enabled-tables")
      .send({ dryRun: false, enabledTables: ["fin.fin_ledger"] })
      .expect(200);

    const after = displayGenerations();
    expect(after.C).toBeGreaterThan(gens.C);
    await request(app.server).get("/api/admin/agents").expect(200);
    expect(displaySnapshotDiagnostics().builds).toBe(builds + 1);
  });
});
