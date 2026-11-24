/**
 * P1-61 — memory-probe diagnostics isolation (SC-01..07/09 unit coverage).
 * SC-08 Docker UAT is out of scope for this file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DiagnosticSnapshotService,
  bindDiagnosticSnapshotService,
  readPublishedDiagnosticMemory,
  type DiagnosticData
} from "../runtime/diagnostic-snapshot.js";

const GOLDEN_DATA_KEYS = [
  "status",
  "lucyVersion",
  "gitSha",
  "gitDirty",
  "bundledKtxVersion",
  "ktxRuntime",
  "policy",
  "execution",
  "dataQaInstructions"
] as const;

function sampleData(overrides: Partial<DiagnosticData> = {}): DiagnosticData {
  return {
    status: "ok",
    lucyVersion: "0.30.0",
    gitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    gitDirty: false,
    bundledKtxVersion: "unknown",
    ktxRuntime: { ready: true, status: "ready" },
    policy: {
      policyVersion: "pv-1",
      degradedGlobal: false,
      degradedAgents: [],
      healthy: true
    },
    execution: { status: "ok", lastCheckedAt: "2026-11-19T00:00:00.000Z" },
    dataQaInstructions: { source: "missing", length: 0, lastError: null, loadedAt: null },
    ...overrides
  };
}

describe("DiagnosticSnapshotService (SC-03/04/05/06/09)", () => {
  afterEach(() => {
    bindDiagnosticSnapshotService(null);
  });

  it("starts unknown; publishes fresh; first failure keeps observedAt and marks stale", async () => {
    let mono = 1_000;
    let wall = Date.parse("2026-11-19T12:00:00.000Z");
    let collectCount = 0;
    let shouldFail = false;
    const service = new DiagnosticSnapshotService({
      intervalMs: 10_000,
      deadlineMs: 5_000,
      staleAfterMs: 30_000,
      monotonicNow: () => mono,
      wallNow: () => new Date(wall),
      collect: async () => {
        collectCount += 1;
        if (shouldFail) throw new Error("collect failed");
        return sampleData({ status: "ok" });
      }
    });

    expect(service.readPublished()).toEqual({
      data: null,
      diagnostics: { observedAt: null, ageMs: null, freshness: "unknown" }
    });

    service.tickForce();
    await service.waitUntilIdle();
    const first = service.readPublished();
    expect(first.data?.status).toBe("ok");
    expect(first.diagnostics).toEqual({
      observedAt: "2026-11-19T12:00:00.000Z",
      ageMs: 0,
      freshness: "fresh"
    });
    const observedAt = first.diagnostics.observedAt;

    // Wall clock skews backwards; age still uses monotonic clock.
    wall = Date.parse("2026-11-19T11:00:00.000Z");
    mono = 1_500;
    expect(service.readPublished().diagnostics.ageMs).toBe(500);
    expect(service.readPublished().diagnostics.observedAt).toBe(observedAt);
    expect(service.readPublished().diagnostics.freshness).toBe("fresh");

    // First failure: immediate stale, observedAt unchanged, data.status unchanged.
    shouldFail = true;
    mono = 2_000;
    service.tickForce();
    await service.waitUntilIdle();
    const afterFail = service.readPublished();
    expect(afterFail.diagnostics.freshness).toBe("stale");
    expect(afterFail.diagnostics.observedAt).toBe(observedAt);
    expect(afterFail.data?.status).toBe("ok");
    expect(collectCount).toBe(2);

    // Continuous failures past 30s stay stale with same observedAt.
    mono = 40_000;
    expect(service.readPublished().diagnostics.freshness).toBe("stale");
    expect(service.readPublished().diagnostics.observedAt).toBe(observedAt);
    expect(service.readPublished().diagnostics.ageMs).toBe(39_000);

    // Recovery only after next full successful collect.
    shouldFail = false;
    wall = Date.parse("2026-11-19T12:05:00.000Z");
    mono = 41_000;
    service.tickForce();
    await service.waitUntilIdle();
    const recovered = service.readPublished();
    expect(recovered.diagnostics.freshness).toBe("fresh");
    expect(recovered.diagnostics.observedAt).toBe("2026-11-19T12:05:00.000Z");
    expect(recovered.data?.status).toBe("ok");

    await service.close();
  });

  it("age alone past 30s marks stale without rewriting data.status", async () => {
    let mono = 0;
    const service = new DiagnosticSnapshotService({
      intervalMs: 10_000,
      staleAfterMs: 30_000,
      monotonicNow: () => mono,
      wallNow: () => new Date("2026-11-19T12:00:00.000Z"),
      collect: async () => sampleData({ status: "degraded" })
    });
    service.tickForce();
    await service.waitUntilIdle();
    expect(service.readPublished().diagnostics.freshness).toBe("fresh");
    expect(service.readPublished().data?.status).toBe("degraded");
    mono = 30_001;
    expect(service.readPublished().diagnostics.freshness).toBe("stale");
    expect(service.readPublished().data?.status).toBe("degraded");
    await service.close();
  });

  it("continuous ticks keep a single in-flight collector (SC-05)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    let settled = 0;
    const service = new DiagnosticSnapshotService({
      intervalMs: 0,
      deadlineMs: 60_000,
      monotonicNow: () => performance.now(),
      collect: async () => {
        started += 1;
        await gate;
        settled += 1;
        return sampleData();
      }
    });

    for (let i = 0; i < 10; i += 1) service.tickForce();
    expect(started).toBe(1);
    expect(service.isCollecting()).toBe(true);
    release();
    await service.waitUntilIdle();
    expect(settled).toBe(1);
    expect(service.isCollecting()).toBe(false);
    await service.close();
  });

  it("deadline marks stale but holds permit until actual settle; late success is not published", async () => {
    let mono = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let phase: "seed" | "hang" = "seed";
    const hanging = new DiagnosticSnapshotService({
      intervalMs: 0,
      deadlineMs: 30,
      monotonicNow: () => mono,
      wallNow: () => new Date(mono < 100 ? "2026-11-19T11:00:00.000Z" : "2026-11-19T12:00:00.000Z"),
      collect: async () => {
        if (phase === "seed") return sampleData({ lucyVersion: "seed" });
        await gate;
        return sampleData({ lucyVersion: "late" });
      }
    });
    hanging.tickForce();
    await hanging.waitUntilIdle();
    expect(hanging.readPublished().data?.lucyVersion).toBe("seed");
    const seedObservedAt = hanging.readPublished().diagnostics.observedAt;

    phase = "hang";
    mono = 1_000;
    hanging.tickForce();
    expect(hanging.isCollecting()).toBe(true);
    // Wait past deadline while still holding the gate.
    await new Promise((r) => setTimeout(r, 50));
    expect(hanging.readPublished().diagnostics.freshness).toBe("stale");
    expect(hanging.readPublished().diagnostics.observedAt).toBe(seedObservedAt);
    expect(hanging.readPublished().data?.lucyVersion).toBe("seed");
    // Still in-flight — another tick must not start a second collector.
    expect(hanging.isCollecting()).toBe(true);
    hanging.tickForce();
    expect(hanging.isCollecting()).toBe(true);

    release();
    await hanging.waitUntilIdle();
    // Late success after deadline must not overwrite.
    expect(hanging.readPublished().data?.lucyVersion).toBe("seed");
    expect(hanging.readPublished().diagnostics.freshness).toBe("stale");
    await hanging.close();
  });

  it("generation bump discards late results and marks stale (SC-06)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let mono = 0;
    let collectValue = "v1";
    let useGate = false;
    const svc = new DiagnosticSnapshotService({
      intervalMs: 0,
      deadlineMs: 60_000,
      monotonicNow: () => mono,
      wallNow: () => new Date("2026-11-19T12:00:00.000Z"),
      collect: async () => {
        if (useGate) await gate;
        return sampleData({ lucyVersion: collectValue });
      }
    });
    svc.tickForce();
    await svc.waitUntilIdle();
    expect(svc.readPublished().data?.lucyVersion).toBe("v1");

    useGate = true;
    collectValue = "late-old-gen";
    svc.tickForce();
    expect(svc.isCollecting()).toBe(true);
    const newGen = svc.bumpGeneration();
    expect(newGen).toBe(1);
    expect(svc.readPublished().diagnostics.freshness).toBe("stale");

    release();
    await svc.waitUntilIdle();
    // Late old-gen result must not pollute.
    expect(svc.readPublished().data?.lucyVersion).toBe("v1");
    expect(svc.readPublished().diagnostics.freshness).toBe("stale");

    useGate = false;
    collectValue = "v2";
    mono = 100;
    svc.tickForce();
    await svc.waitUntilIdle();
    expect(svc.readPublished().data?.lucyVersion).toBe("v2");
    expect(svc.readPublished().diagnostics.freshness).toBe("fresh");
    await svc.close();
  });

  it("close is idempotent and waits for actual collector settle (SC-09)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settled = false;
    const service = new DiagnosticSnapshotService({
      intervalMs: 0,
      deadlineMs: 60_000,
      collect: async () => {
        await gate;
        settled = true;
        return sampleData();
      }
    });
    service.tickForce();
    const closing = service.close();
    // close must not resolve before settle (no Promise.race pretend).
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
    expect(closed).toBe(false);
    release();
    await closing;
    expect(settled).toBe(true);
    expect(closed).toBe(true);
    await service.close();
    await service.close();
  });
});

describe("probe routes memory path (SC-01/02/03/07/09)", () => {
  const previousEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "VITEST",
      "LUCY_DEPLOYMENT_MODE",
      "LUCY_WEBUI_COOKIE_SECURE",
      "LUCY_WEBUI_TEST_PROFILE",
      "LUCY_VERSION",
      "LUCY_GIT_SHA",
      "KTX_PROJECT_ROOT"
    ]) {
      previousEnv[key] = process.env[key];
    }
    process.env.VITEST = "true";
    process.env.LUCY_DEPLOYMENT_MODE = "development";
    process.env.LUCY_VERSION = "0.30.0";
    process.env.LUCY_GIT_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    vi.resetModules();
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    bindDiagnosticSnapshotService(null);
    vi.restoreAllMocks();
  });

  it("SC-01: livez/readyz/health handlers perform zero diagnostic I/O readers", async () => {
    const project = await import("../project.js");
    const mcpRuntime = await import("../admin/mcp-runtime.js");
    const ktxRuntime = await import("../ktx-runtime.js");
    const contentLayout = await import("../content-layout.js");

    const resolveProjectRoot = vi.spyOn(project, "resolveProjectRoot");
    const readMcpRuntimeStatus = vi.spyOn(mcpRuntime, "readMcpRuntimeStatus");
    const readKtx = vi.spyOn(ktxRuntime, "readKtxRuntimeStatus");
    const readKtxCached = vi.spyOn(ktxRuntime, "readKtxRuntimeStatusCached");
    const collectLayout = vi.spyOn(contentLayout, "collectContentLayout");

    const { buildServer } = await import("../index.js");
    const { markWebuiWarmupComplete, resetWebuiWarmupForTests } = await import("../runtime/readiness.js");

    resetWebuiWarmupForTests();
    const app = buildServer();
    await app.ready();
    // Stop background collector so request-path accounting is not interleaved.
    const svc = (app as { diagnosticSnapshot?: DiagnosticSnapshotService }).diagnosticSnapshot;
    await svc?.close();

    resolveProjectRoot.mockClear();
    readMcpRuntimeStatus.mockClear();
    readKtx.mockClear();
    readKtxCached.mockClear();
    collectLayout.mockClear();

    markWebuiWarmupComplete();
    const livez = await app.inject({ method: "GET", url: "/api/livez" });
    const readyz = await app.inject({ method: "GET", url: "/api/readyz" });
    const health = await app.inject({ method: "GET", url: "/api/health" });

    expect(livez.statusCode).toBe(200);
    expect(livez.json()).toEqual({ ok: true });
    expect(readyz.statusCode).toBe(200);
    expect(health.statusCode).toBe(200);

    expect(resolveProjectRoot).not.toHaveBeenCalled();
    expect(readMcpRuntimeStatus).not.toHaveBeenCalled();
    expect(readKtx).not.toHaveBeenCalled();
    expect(readKtxCached).not.toHaveBeenCalled();
    expect(collectLayout).not.toHaveBeenCalled();

    await app.close();
  });

  it("SC-02/03: readyz warming_up + field compatibility golden; freshness sibling", async () => {
    const { buildServer } = await import("../index.js");
    const { markWebuiWarmupComplete, resetWebuiWarmupForTests } = await import("../runtime/readiness.js");

    resetWebuiWarmupForTests();
    const app = buildServer();
    await app.ready();
    const boot = (app as { diagnosticSnapshot?: DiagnosticSnapshotService }).diagnosticSnapshot;
    await boot?.close();
    // Same service instance the routes close over — clear publish so freshness is unknown.
    boot?.resetPublishedForTests();

    const cold = await app.inject({ method: "GET", url: "/api/readyz" });
    expect(cold.statusCode).toBe(503);
    expect(cold.json().reason).toBe("warming_up");
    expect(cold.json().ok).toBe(false);
    expect(cold.json().diagnostics).toMatchObject({
      observedAt: null,
      ageMs: null,
      freshness: "unknown"
    });
    for (const key of GOLDEN_DATA_KEYS) {
      expect(cold.json().data).toHaveProperty(key);
    }
    // Freshness alone must not invent a new status vocabulary.
    expect(["ok", "degraded"]).toContain(cold.json().data.status);

    markWebuiWarmupComplete();
    const warm = await app.inject({ method: "GET", url: "/api/readyz" });
    expect(warm.statusCode).toBe(200);
    expect(warm.json().ok).toBe(true);
    expect(warm.json().diagnostics.freshness).toBe("unknown");

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json().ok).toBe(true);
    expect(health.json().data.eventLoop).toMatchObject({ windowSeconds: 60 });
    expect(health.json().diagnostics).toMatchObject({ freshness: "unknown" });
    for (const key of GOLDEN_DATA_KEYS) {
      expect(health.json().data).toHaveProperty(key);
    }
    // data.status is not rewritten by freshness alone (unknown + degraded/ok only).
    expect(["ok", "degraded"]).toContain(health.json().data.status);

    await app.close();
  });

  it("SC-07: auth classification ignores diagnostics; stale/fresh recovery stays on snapshot service", async () => {
    const diag = await import("../runtime/diagnostic-snapshot.js");
    const readSpy = vi.spyOn(diag, "readPublishedDiagnosticMemory");

    // Auth guard public-path classification must not touch diagnostics.
    const { isPublicApi } = await import("../auth/guard.js");
    expect(isPublicApi("GET", "/api/livez")).toBe(true);
    expect(isPublicApi("GET", "/api/readyz")).toBe(true);
    expect(isPublicApi("GET", "/api/health")).toBe(true);
    expect(isPublicApi("GET", "/api/admin/agents")).toBe(false);
    expect(readSpy).not.toHaveBeenCalled();

    // Guard source does not import the diagnostic snapshot module (fail-closed
    // / revoke stays on session+ACL contracts, not diagnostics freshness).
    const guardSource = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../auth/guard.ts", import.meta.url), "utf8")
    );
    expect(guardSource).not.toMatch(/diagnostic-snapshot/);
    expect(readSpy).not.toHaveBeenCalled();

    // Legitimate recovery: after failure, next successful collect returns fresh.
    let mono = 0;
    let fail = false;
    const service = new DiagnosticSnapshotService({
      intervalMs: 0,
      monotonicNow: () => mono,
      wallNow: () => new Date("2026-11-19T12:00:00.000Z"),
      collect: async () => {
        if (fail) throw new Error("down");
        return sampleData({ status: "ok" });
      }
    });
    bindDiagnosticSnapshotService(service);
    service.tickForce();
    await service.waitUntilIdle();
    fail = true;
    mono = 5;
    service.tickForce();
    await service.waitUntilIdle();
    expect(readPublishedDiagnosticMemory().diagnostics.freshness).toBe("stale");
    fail = false;
    mono = 10;
    service.tickForce();
    await service.waitUntilIdle();
    expect(readPublishedDiagnosticMemory().diagnostics.freshness).toBe("fresh");
    expect(readPublishedDiagnosticMemory().data?.status).toBe("ok");
    await service.close();
  });
});
