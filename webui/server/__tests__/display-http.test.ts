import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  automaticProbeFallback,
  displayBudgetFor,
  displayEnvelope,
  rememberProbeResult,
  replyIfDegradedRead,
  resetProbeFallbackForTests
} from "../display-http";
import { displayGenerations, resetDisplayGenerationsForTests, bumpDisplayGeneration } from "../display-generation";
import {
  DisplayReconciliationFailedError,
  DisplaySnapshotBusyError,
  DisplaySnapshotPendingError,
  createDisplayPending
} from "../display-snapshot";
import { ProbeQueueFullError, ProbeQueueTimeoutError } from "../background-probes";
import { markDisplayDegraded, registerEntryPerformanceTiming, withRequestTiming } from "../entry-performance-timing";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  resetProbeFallbackForTests();
  resetDisplayGenerationsForTests();
});

function build(handler: (request: FastifyRequest) => Promise<unknown>) {
  const instance = Fastify();
  registerEntryPerformanceTiming(instance);
  instance.setErrorHandler((error, request, reply) => {
    if (replyIfDegradedRead(error, request, reply)) return;
    reply.status((error as { statusCode?: number }).statusCode ?? 500).send({ ok: false, error: { code: (error as { code?: string }).code ?? "INTERNAL" } });
  });
  instance.get("/api/x", async (request) => handler(request));
  app = instance;
  return instance;
}

describe("P1-75 X3 — HTTP carrier of the degraded read", () => {
  it("pending answers 200 with data: null and the display envelope; never an empty list", async () => {
    const instance = build(async (request) => withRequestTiming(request, async () => {
      throw createDisplayPending("sources", ["D", "P", "C"], "build_capacity");
    }));
    const res = await instance.inject({ method: "GET", url: "/api/x" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; data: unknown; display: Record<string, unknown> };
    expect(body).toMatchObject({ ok: true, data: null, display: { state: "pending", generation: expect.any(String), pendingMs: expect.any(Number) } });
    expect(body).not.toHaveProperty("data.agents");
    expect(body.display).not.toHaveProperty("ageMs");
    expect(res.headers["x-lucy-display-state"]).toBe("pending");
    expect(res.headers["x-lucy-display-generation"]).toBeTruthy();
    expect(res.headers["x-lucy-display-pending-ms"]).toBeDefined();
    expect(res.headers["x-lucy-display-age-ms"]).toBeUndefined();
    expect(res.headers["x-lucy-busy-reason"]).toBe("build_capacity");
    expect(String(res.headers["server-timing"])).toContain("degraded;desc=pending");
  });

  it("a route-level A-class busy error (generation kept moving) is answered as pending, not 503", async () => {
    const instance = build(async () => {
      throw new DisplaySnapshotBusyError("generation_changed");
    });
    const res = await instance.inject({ method: "GET", url: "/api/x" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, data: null, display: { state: "pending" } });
    expect(res.headers["x-lucy-busy-reason"]).toBe("generation_changed");
    expect(res.headers["retry-after"]).toBeUndefined();
  });

  it("B class write_pending keeps the retryable 503", async () => {
    const instance = build(async () => {
      throw new DisplaySnapshotBusyError("write_pending");
    });
    const res = await instance.inject({ method: "GET", url: "/api/x" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: "DISPLAY_SNAPSHOT_BUSY" } });
  });

  it("C class DISPLAY_RECONCILIATION_FAILED keeps 503 with the stable code and no stale body", async () => {
    const instance = build(async () => {
      throw new DisplayReconciliationFailedError(190_000);
    });
    const res = await instance.inject({ method: "GET", url: "/api/x" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: { code: "DISPLAY_RECONCILIATION_FAILED" } });
    expect(res.headers["x-lucy-display-state"]).toBeUndefined();
  });

  it("a stale/grace read keeps its normal body and carries the marker only in headers", async () => {
    const instance = build(async (request) => withRequestTiming(request, async () => {
      markDisplayDegraded({ state: "stale", ageMs: 190_000, generation: "D2.P3", prolonged: true });
      return { ok: true, data: { agents: [{ id: "a" }] } };
    }));
    const res = await instance.inject({ method: "GET", url: "/api/x" });
    expect(res.json()).toEqual({ ok: true, data: { agents: [{ id: "a" }] } });
    expect(res.headers["x-lucy-display-state"]).toBe("stale");
    expect(res.headers["x-lucy-display-age-ms"]).toBe("190000");
    expect(res.headers["x-lucy-display-generation"]).toBe("D2.P3");
    expect(res.headers["x-lucy-display-prolonged"]).toBe("1");
  });

  it("the envelope only carries the frozen fields", () => {
    expect(displayEnvelope({ state: "stale", ageMs: 1234.6, generation: "D1" })).toEqual({ state: "stale", generation: "D1", ageMs: 1235 });
    expect(displayEnvelope({ state: "pending", generation: "D1", pendingMs: 9, ageMs: 7 })).toEqual({ state: "pending", generation: "D1", pendingMs: 9 });
  });

  it("the request budget carries the requester identity and an authorization hook", async () => {
    const open = { lucyAdmin: { session: null, admin: null, stateUnavailable: false, authMode: "open" } } as never;
    const budget = displayBudgetFor(open);
    expect(budget.principal).toEqual({ scope: "open:local-admin", permissionVersion: "open" });
    await expect(budget.authorize!()).resolves.toBe(true);
    const anonymous = { lucyAdmin: { session: null, admin: null, stateUnavailable: false, authMode: "required" } } as never;
    const anon = displayBudgetFor(anonymous);
    expect(anon.principal?.scope).toBe("anonymous");
    await expect(anon.authorize!()).resolves.toBe(false);
    const admin = { id: "a1", account_uid: "uid-1", role: "owner", enabled: true } as never;
    const signedIn = displayBudgetFor({ lucyAdmin: { session: { ep: 4 }, admin, stateUnavailable: false, authMode: "required" } } as never);
    expect(signedIn.principal).toEqual({ scope: "admin:uid-1", permissionVersion: "owner:1:4" });
  });
});

describe("P1-75 X4 — automatic probes never answer 503", () => {
  const fakeRequest = () => ({}) as never;

  it("purpose=automatic: a refused probe returns the latest result with its age, or pending", () => {
    resetDisplayGenerationsForTests();
    const instance = build(async (request) => {
      const full = automaticProbeFallback(new ProbeQueueFullError(), "automatic", "test", "/p", "c1", request);
      return full;
    });
    return instance.inject({ method: "GET", url: "/api/x" }).then((res) => {
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, data: null, display: { state: "pending" } });
      expect(res.headers["x-lucy-display-state"]).toBe("pending");
    });
  });

  it("returns the remembered result for the same connection and configuration generation", () => {
    rememberProbeResult("test", "/p", "c1", { status: "ok", latencyMs: 12 });
    const out = automaticProbeFallback(new ProbeQueueTimeoutError(), "automatic", "test", "/p", "c1", fakeRequest());
    expect(out).toMatchObject({ ok: true, data: { status: "ok", latencyMs: 12 }, display: { state: "stale", ageMs: expect.any(Number) } });
    // another connection or kind has no result of its own
    expect(automaticProbeFallback(new ProbeQueueFullError(), "automatic", "test", "/p", "c2", fakeRequest())).toMatchObject({ data: null, display: { state: "pending" } });
    expect(automaticProbeFallback(new ProbeQueueFullError(), "automatic", "live-schemas", "/p", "c1", fakeRequest())).toMatchObject({ data: null, display: { state: "pending" } });
  });

  it("never shows a result that belongs to an older connection configuration", () => {
    rememberProbeResult("live-schemas", "/p", "c1", { schemas: ["old"] });
    bumpDisplayGeneration(["L"]);
    expect(displayGenerations().L).toBeGreaterThan(0);
    const out = automaticProbeFallback(new ProbeQueueFullError(), "automatic", "live-schemas", "/p", "c1", fakeRequest());
    expect(out).toMatchObject({ data: null, display: { state: "pending" } });
  });

  it("purpose=manual keeps the 503 (D class), and unrelated failures are not swallowed", () => {
    rememberProbeResult("test", "/p", "c1", { status: "ok" });
    expect(automaticProbeFallback(new ProbeQueueFullError(), "manual", "test", "/p", "c1", fakeRequest())).toBeNull();
    expect(automaticProbeFallback(new ProbeQueueTimeoutError(), "manual", "test", "/p", "c1", fakeRequest())).toBeNull();
    expect(automaticProbeFallback(new Error("boom"), "automatic", "test", "/p", "c1", fakeRequest())).toBeNull();
  });

  it("the envelope of a pending error is data-free", () => {
    const error = createDisplayPending("x", ["D"], "reconcile_failed");
    expect(error).toBeInstanceOf(DisplaySnapshotPendingError);
    expect(JSON.stringify(displayEnvelope(error.display))).not.toMatch(/payload|rows|agents/);
  });
});
