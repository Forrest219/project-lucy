import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";
import { beginDisplayWrite, endDisplayWrite, resetDisplayGenerationsForTests } from "../display-generation";
import { displaySnapshotDiagnostics, reconcileMetadata, resetDisplaySnapshotsForTests, startDisplayReconciler, stopDisplayReconciler } from "../display-snapshot";
import { invalidateContentPathsCache } from "../paths";
import { invalidateAccessConfigCache } from "../proxy/identity";
import { commitEffectivePolicy, getPolicyRuntimeStatus, resetEffectivePolicyForTests } from "../proxy/acl";
import { resetAdminsCache } from "../auth/admins-store";

const statsGate = vi.hoisted(() => ({
  entered: null as (() => void) | null,
  wait: null as Promise<void> | null
}));
/** Spec 195 §6 / SI-07 — simulate unreadable files and unreadable directories. */
const fsGate = vi.hoisted(() => ({
  blockedFiles: new Set<string>(),
  blockedDirs: new Set<string>()
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const key = (value: unknown): string => String(value);
  return {
    ...actual,
    stat: async (file: unknown, options?: unknown) => {
      if (fsGate.blockedFiles.has(key(file))) {
        throw Object.assign(new Error(`EACCES: permission denied, stat '${key(file)}'`), { code: "EACCES" });
      }
      return (actual.stat as (f: unknown, o?: unknown) => Promise<unknown>)(file, options);
    },
    readFile: async (file: unknown, options?: unknown) => {
      if (fsGate.blockedFiles.has(key(file))) {
        throw Object.assign(new Error(`EACCES: permission denied, open '${key(file)}'`), { code: "EACCES" });
      }
      return (actual.readFile as (f: unknown, o?: unknown) => Promise<unknown>)(file, options);
    },
    readdir: async (dir: unknown, options?: unknown) => {
      if (fsGate.blockedDirs.has(key(dir))) {
        throw Object.assign(new Error(`EACCES: permission denied, scandir '${key(dir)}'`), { code: "EACCES" });
      }
      return (actual.readdir as (d: unknown, o?: unknown) => Promise<unknown>)(dir, options);
    }
  };
});
vi.mock("../admin/audit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../admin/audit.js")>();
  return { ...actual, getAuditDb: async (...args: Parameters<typeof actual.getAuditDb>) => {
    if (statsGate.wait) {
      statsGate.entered?.();
      await statsGate.wait;
    }
    return actual.getAuditDb(...args);
  } };
});

/**
 * Spec 174 R3 / SC-17 — `runtimeConsistency` follows the committed runtime
 * policy state (not only display file generations), on hot hits too, and a
 * display read never commits or otherwise changes runtime policy.
 */
const KTX_YAML = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
`;
const MANIFEST = `tables:
  fin_ledger:
    table: fin.fin_ledger
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
  return { meta: res.body.data.meta, tables: res.body.data.tables, cache: String(res.headers["server-timing"] ?? "").match(/cache;desc=(\w+)/)?.[1] };
}

async function agents() {
  const res = await request(app.server).get("/api/admin/agents").expect(200);
  return res.body.data as { meta: { runtimeConsistency: string; snapshotVersion: string }; agents: Array<{ id: string; effectivePermissions?: unknown }> };
}

const accessPath = () => path.join(projectRoot, "webui", "config", "access.yaml");

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-display-runtime-"));
  await mkdir(path.join(projectRoot, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"), MANIFEST, "utf8");
  await writeFile(accessPath(), ACCESS, "utf8");
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

describe("Spec 174 R3 — runtimeConsistency follows the runtime policy (SC-17)", () => {
  for (const direction of ["unconfirmed", "matched"] as const) {
    it(`Agent response reflects ${direction} after runtime changes during audit statistics`, async () => {
      const matched = await agents();
      resetEffectivePolicyForTests();
      const unconfirmed = await agents();
      if (direction === "unconfirmed") await commitEffectivePolicy();
      const builds = displaySnapshotDiagnostics().builds;
      const before = getPolicyRuntimeStatus();
      let release!: () => void;
      const entered = new Promise<void>((resolve) => { statsGate.entered = resolve; });
      statsGate.wait = new Promise<void>((resolve) => { release = resolve; });
      const pending = agents();
      try {
        await entered;
        if (direction === "unconfirmed") resetEffectivePolicyForTests();
        else await commitEffectivePolicy();
        const current = getPolicyRuntimeStatus();
        expect(current.policyVersion).not.toBe(before.policyVersion);
        release();
        const response = await pending;
        expect(response.meta.runtimeConsistency).toBe(direction);
        expect(response.meta.snapshotVersion).toBe((direction === "matched" ? matched : unconfirmed).meta.snapshotVersion);
        expect(response.agents.map((agent) => agent.effectivePermissions)).toEqual(matched.agents.map((agent) => agent.effectivePermissions));
        expect(displaySnapshotDiagnostics().builds).toBe(builds);
        expect(getPolicyRuntimeStatus()).toEqual(current);
      } finally {
        release();
        statsGate.wait = null;
        statsGate.entered = null;
        await pending;
      }
    });
  }

  it("hot hits flip unconfirmed → matched with no file change, and the response version follows", async () => {
    const matched = await sources();
    expect(matched.meta.runtimeConsistency).toBe("matched");
    resetEffectivePolicyForTests();
    const unconfirmed = await sources();
    expect(unconfirmed.cache).toBe("hit");
    expect(unconfirmed.meta.runtimeConsistency).toBe("unconfirmed");
    expect(unconfirmed.meta.snapshotVersion).not.toBe(matched.meta.snapshotVersion);
    expect(unconfirmed.tables).toEqual(matched.tables);

    await commitEffectivePolicy();
    const recovered = await sources();
    expect(recovered.cache).toBe("hit");
    expect(recovered.meta.runtimeConsistency).toBe("matched");
    expect(recovered.meta.snapshotVersion).toBe(matched.meta.snapshotVersion);
  });

  it("the Agent list follows the runtime state on cached permission sections", async () => {
    const first = await agents();
    expect(first.meta.runtimeConsistency).toBe("matched");
    const builds = displaySnapshotDiagnostics().builds;
    resetEffectivePolicyForTests();
    const second = await agents();
    expect(second.meta.runtimeConsistency).toBe("unconfirmed");
    expect(second.meta.snapshotVersion).not.toBe(first.meta.snapshotVersion);
    const permissionsOf = (data: typeof first) => data.agents.map((agent) => ({ id: agent.id, effectivePermissions: agent.effectivePermissions }));
    expect(permissionsOf(second)).toEqual(permissionsOf(first));
    await commitEffectivePolicy();
    expect((await agents()).meta.runtimeConsistency).toBe("matched");
    expect(displaySnapshotDiagnostics().builds).toBe(builds);
  });

  it("matched → global degrade → recovery is reflected for sources and agents", async () => {
    expect((await sources()).meta.runtimeConsistency).toBe("matched");
    await writeFile(accessPath(), "users: [\n", "utf8");
    await commitEffectivePolicy();
    expect(getPolicyRuntimeStatus().degradedGlobal).toBe(true);
    await writeFile(accessPath(), ACCESS, "utf8");
    expect((await sources()).meta.runtimeConsistency).toBe("unconfirmed");
    expect((await agents()).meta.runtimeConsistency).toBe("unconfirmed");
    await commitEffectivePolicy();
    expect(getPolicyRuntimeStatus().degradedGlobal).toBe(false);
    expect((await sources()).meta.runtimeConsistency).toBe("matched");
    expect((await agents()).meta.runtimeConsistency).toBe("matched");
  });

  it("a runtime change while a request is in flight is reflected in that response", async () => {
    await sources();
    const token = beginDisplayWrite(["P"]);
    const inFlight = sources();
    setTimeout(() => {
      resetEffectivePolicyForTests();
      endDisplayWrite(token);
    }, 30);
    expect((await inFlight).meta.runtimeConsistency).toBe("unconfirmed");
  });

  it("display reads never commit policy or change runtime readiness", async () => {
    await sources();
    await agents();
    const committed = getPolicyRuntimeStatus();
    for (let i = 0; i < 3; i += 1) {
      await sources();
      await agents();
    }
    expect(getPolicyRuntimeStatus()).toEqual(committed);
    resetEffectivePolicyForTests();
    await sources();
    await agents();
    expect(getPolicyRuntimeStatus().policyVersion).toBe("");
  });
});

/**
 * Spec 195 §4 / §6 / SI-07 — the permission display depends on P/C only, so a
 * broken overlay file cannot take the Agent list down with it. A semantic
 * layer that cannot be enumerated may hide a Manifest, so it must block P too.
 */
describe("Spec 195 SI-07 — verification health is isolated per dependency scope", () => {
  // The reconciler keys watched files by their canonical id.
  const overlayPath = () => realpathSync(path.join(projectRoot, "semantic-layer", "warehouse", "fin_ledger.yaml"));
  const semanticLayerDir = () => realpathSync(path.join(projectRoot, "semantic-layer"));

  beforeEach(async () => {
    await writeFile(path.join(projectRoot, "semantic-layer", "warehouse", "fin_ledger.yaml"), "grain: [id]\n", "utf8");
    await reconcileMetadata();
  });

  afterEach(() => {
    fsGate.blockedFiles.clear();
    fsGate.blockedDirs.clear();
  });

  it("an unreadable overlay fails the semantic display while the Agent list keeps working", async () => {
    await sources();
    await agents();

    fsGate.blockedFiles.add(overlayPath());
    await reconcileMetadata();

    const busy = await request(app.server).get("/api/sources");
    expect(busy.status).toBe(503);
    expect(busy.body.error.code).toBe("DISPLAY_SNAPSHOT_BUSY");

    const list = await request(app.server).get("/api/admin/agents");
    expect(list.status).toBe(200);
    expect(list.body.data.agents.length).toBeGreaterThan(0);
  });

  it("a semantic layer that cannot be enumerated also blocks the Agent list", async () => {
    await sources();
    await agents();

    fsGate.blockedDirs.add(semanticLayerDir());
    await reconcileMetadata();

    for (const url of ["/api/sources", "/api/admin/agents"]) {
      const busy = await request(app.server).get(url);
      expect(busy.status).toBe(503);
      expect(busy.body.error.code).toBe("DISPLAY_SNAPSHOT_BUSY");
    }
  });

  /**
   * Spec 195 §4 / SI-11 — a P change while the dynamic statistics are read
   * must not splice the old permissions into the new statistics.
   */
  it("SI-11 a permission change during the statistics wait rejects the old permission result", async () => {
    await agents();
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { statsGate.entered = resolve; });
    statsGate.wait = new Promise<void>((resolve) => { release = resolve; });
    const pending = agents();
    try {
      await entered;
      // The access file changes while the statistics are still being read.
      const token = beginDisplayWrite(["P"]);
      await writeFile(accessPath(), ACCESS.replace("name: Zhang San", "name: Zhang San 9"), "utf8");
      endDisplayWrite(token);
      release();
      const response = await pending;
      const zhangsan = (response.agents as Array<{ id: string; name?: string }>).find((a) => a.id === "zhangsan");
      // The whole list was rebuilt — never the old permissions with new state.
      expect(zhangsan?.name).toBe("Zhang San 9");
    } finally {
      release();
      statsGate.wait = null;
      statsGate.entered = null;
      await pending;
    }
  }, 20_000);
});
