import { mkdir, mkdtemp, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Spec 195 §6 — a verification task can be held or broken on purpose. */
const fsGate = vi.hoisted(() => ({ hold: null as Promise<void> | null }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (file: unknown, options?: unknown) => {
      if (fsGate.hold) await fsGate.hold;
      return (actual.readFile as (f: unknown, o?: unknown) => Promise<unknown>)(file, options);
    },
    stat: async (file: unknown, options?: unknown) => {
      if (fsGate.hold) await fsGate.hold;
      return (actual.stat as (f: unknown, o?: unknown) => Promise<unknown>)(file, options);
    }
  };
});

import {
  beginDisplayWrite,
  displayGenerations,
  endDisplayWrite,
  resetDisplayGenerationsForTests,
  scopesForPath,
  withDisplayWriteBarrier
} from "../display-generation";
import {
  activeCommittedView,
  captureCommittedDisplayView,
  committedViewServeValid,
  createDisplayRequestBudget,
  displayCacheVerified,
  displayBusySummary,
  displaySnapshotDiagnostics,
  DISPLAY_RECOVERY_WAIT_BUDGET_MS,
  DisplayReconciliationFailedError,
  DisplaySnapshotBusyError,
  DisplaySnapshotPendingError,
  DISPLAY_BUILD_WAIT_BUDGET_MS,
  DISPLAY_DEGRADE_MAX_MS,
  displayReadServable,
  getDisplaySnapshot,
  SOURCES_SCOPES,
  evictDisplaySnapshotSlot,
  reconcileFullDigest,
  reconcileMetadata,
  resetDisplaySnapshotsForTests,
  startDisplayReconciler,
  stopDisplayReconciler,
  MAX_CONCURRENT_DISPLAY_BUILDS,
  openCommittedViewServe,
  runWithCommittedViewServe,
  withdrawCommittedViewServe
} from "../display-snapshot";
import { invalidateContentPathsCache } from "../paths";

let projectRoot: string;
const saved = { root: process.env.KTX_PROJECT_ROOT, content: process.env.LUCY_CONTENT_ROOT };

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** P1-75 v1.4 — a request that cannot be served in time answers `pending` (200, no data), not a 503. */
const pendingError = (reason?: string) => expect.objectContaining({
  name: "DisplaySnapshotPendingError",
  display: expect.objectContaining({ state: "pending" }),
  ...(reason ? { reason } : {})
});
/** Short request budget so tests that expect `pending` do not wait the 10 s build deadline. */
const quickBudget = () => createDisplayRequestBudget(3, 1500, 50);

const manifestPath = () => path.join(projectRoot, "config", "semantic-layer", "warehouse", "_schema", "fin.yaml");
/** Spec 195 §4 — a plain table overlay only feeds D (never P). */
const overlayPath = () => path.join(projectRoot, "config", "semantic-layer", "warehouse", "fin_ledger.yaml");

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-display-snapshot-"));
  await mkdir(path.dirname(manifestPath()), { recursive: true });
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(manifestPath(), "tables:\n  fin_ledger:\n    table: fin.fin_ledger\n", "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), "users: []\n", "utf8");
  process.env.KTX_PROJECT_ROOT = projectRoot;
  delete process.env.LUCY_CONTENT_ROOT;
  invalidateContentPathsCache();
  resetDisplayGenerationsForTests();
  resetDisplaySnapshotsForTests();
  await startDisplayReconciler({ metadataIntervalMs: 60_000, fullDigestIntervalMs: 60_000 });
});

afterEach(async () => {
  stopDisplayReconciler();
  vi.restoreAllMocks();
  if (saved.root === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = saved.root;
  if (saved.content === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = saved.content;
  invalidateContentPathsCache();
  await rm(projectRoot, { recursive: true, force: true });
});

describe("Spec 174 T3 — display snapshot cache (SC-03/04/13/15)", () => {
  it("P1-66 CAS preserves a rebuilt slot even when its public key-derived version is unchanged", async () => {
    const first = await getDisplaySnapshot("pair", ["P"], async () => ({payload:"full-1",sidecar:"small-1"}));
    expect(evictDisplaySnapshotSlot("pair", first.incarnation)).toBe(true);
    const rebuilt = await getDisplaySnapshot("pair", ["P"], async () => ({payload:"full-2",sidecar:"small-2"}));
    expect(rebuilt.version).toBe(first.version);
    expect(evictDisplaySnapshotSlot("pair", first.incarnation)).toBe(false);
    const still = await getDisplaySnapshot("pair", ["P"], async () => "wrong");
    expect(still.payload).toBe("full-2"); expect(still.sidecar).toBe("small-2"); expect(still.cache).toBe("hit");
  });

  it("merges concurrent cold requests for one key and caches empty results", async () => {
    let builds = 0;
    const gate = deferred();
    const build = async () => {
      builds += 1;
      await gate.promise;
      return "[]";
    };
    const pending = Array.from({ length: 5 }, () => getDisplaySnapshot("t", ["D"], build));
    gate.resolve();
    const results = await Promise.all(pending);
    expect(builds).toBe(1);
    expect(results.every((result) => result.payload === "[]")).toBe(true);
    const again = await getDisplaySnapshot("t", ["D"], build);
    expect(again.cache).toBe("hit");
    expect(builds).toBe(1);
  });

  it("times out readers without releasing the shared build, then serves its verified result", async () => {
    const gate = deferred<string>();
    const entered = deferred();
    const build = vi.fn(() => {
      entered.resolve();
      return gate.promise;
    });
    const read = () => getDisplaySnapshot("slow", ["D"], build, { budget: createDisplayRequestBudget(3, 1500, 60) });
    const owner = read();
    await entered.promise;
    const attached = read();
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const timedOut = Promise.allSettled([owner, attached]);
      const results = await Promise.race([timedOut, new Promise<never>((_, reject) => {
        watchdog = setTimeout(() => reject(new Error("readers remained attached")), 500);
      })]);
      // v1.4: the wait budget ends in 200 `pending` (no data), never a retryable 503.
      expect(results).toEqual(Array.from({ length: 2 }, () => ({
        status: "rejected",
        reason: pendingError("build_wait_timeout")
      })));
      expect(displaySnapshotDiagnostics()).toMatchObject({ inflightBuilds: 1, busyByReason: { build_wait_timeout: 2 } });
      const summary = displayBusySummary();
      expect(summary).toMatchObject({ busy: 0, pendingServes: 2, byReason: { build_wait_timeout: 2 } });
      expect(summary.recent).toHaveLength(2);
      expect(summary.recent[0]).toMatchObject({ name: "slow", reason: "build_wait_timeout", attempts: 1 });
      expect(summary.recent[0]).toEqual(expect.objectContaining({ at: expect.any(String), uptimeS: expect.any(Number), eventLoopMaxMs: expect.any(Number), ages: expect.any(Object) }));
      expect(JSON.stringify(summary)).not.toMatch(/\/Users\/|token/i);
      expect(build).toHaveBeenCalledTimes(1);
    } finally {
      clearTimeout(watchdog);
      gate.resolve("ready");
      await Promise.allSettled([owner, attached]);
    }
    await vi.waitFor(() => expect(displaySnapshotDiagnostics().inflightBuilds).toBe(0));
    await expect(read()).resolves.toMatchObject({ payload: "ready", cache: "hit" });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("discards a detached build if a scoped write changes its generation before it finishes", async () => {
    const gate = deferred<string>();
    const build = vi.fn(() => gate.promise);
    const old = getDisplaySnapshot("changed", ["D"], build, { budget: createDisplayRequestBudget(3, 1500, 60) });
    try {
      await expect(old).rejects.toMatchObject({ reason: "build_wait_timeout" });
      const token = beginDisplayWrite(["D"]);
      endDisplayWrite(token);
    } finally {
      gate.resolve("old");
    }
    await vi.waitFor(() => expect(displaySnapshotDiagnostics().inflightBuilds).toBe(0));
    expect(displaySnapshotDiagnostics().entries.find(({ name }) => name === "changed")).toMatchObject({ hasCurrent: false, inflight: 0 });
    await expect(getDisplaySnapshot("changed", ["D"], async () => "new")).resolves.toMatchObject({ payload: "new", cache: "miss" });
  });

  it("does not cache failures, backs off for 1 s, then rebuilds", async () => {
    let builds = 0;
    let fail = true;
    const build = async () => {
      builds += 1;
      if (fail) throw new Error("broken manifest");
      return "ok";
    };
    await expect(getDisplaySnapshot("f", ["D"], build)).rejects.toThrow("broken manifest");
    await expect(getDisplaySnapshot("f", ["D"], build)).rejects.toThrow("broken manifest");
    expect(builds).toBe(1);
    fail = false;
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow + 1100);
    const result = await getDisplaySnapshot("f", ["D"], build);
    expect(result.payload).toBe("ok");
    expect(builds).toBe(2);
  });

  it("never publishes a build that overlapped a write and retries with the new generation", async () => {
    const gate = deferred();
    let builds = 0;
    const build = async () => {
      builds += 1;
      if (builds === 1) await gate.promise;
      return `build-${builds}`;
    };
    const request = getDisplaySnapshot("w", ["D"], build);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const token = beginDisplayWrite(["D"]);
    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));
    endDisplayWrite(token);
    const result = await request;
    expect(result.payload).toBe("build-2");
    expect(builds).toBe(2);
    const hit = await getDisplaySnapshot("w", ["D"], build);
    expect(hit.payload).toBe("build-2");
  });

  it("waits for a pending write before serving, and is busy if it never ends", async () => {
    const build = async () => "fresh";
    await getDisplaySnapshot("p", ["P"], build);
    const token = beginDisplayWrite(["P"]);
    const waiting = getDisplaySnapshot("p", ["P"], build);
    setTimeout(() => endDisplayWrite(token), 30);
    expect((await waiting).cache).toBe("miss");

    const stuck = beginDisplayWrite(["P"]);
    await expect(getDisplaySnapshot("p", ["P"], build)).rejects.toBeInstanceOf(DisplaySnapshotBusyError);
    endDisplayWrite(stuck);
  });

  it("caps concurrent builds and stays re-entrant for nested barriers", async () => {
    const gates = Array.from({ length: MAX_CONCURRENT_DISPLAY_BUILDS }, () => deferred());
    const running = gates.map((gate, index) => getDisplaySnapshot(`cap-${index}`, ["D"], async () => {
      await gate.promise;
      return "x";
    }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(getDisplaySnapshot("cap-extra", ["D"], async () => "y", { budget: quickBudget() })).rejects.toMatchObject({ reason: "build_capacity", display: { state: "pending" } });
    gates.forEach((gate) => gate.resolve());
    await Promise.all(running);

    await withDisplayWriteBarrier(["P"], async () => {
      await withDisplayWriteBarrier(["P"], async () => undefined);
      expect(displaySnapshotDiagnostics().reconcilerRunning).toBe(true);
      // Inner barrier ended; outer still pending.
      await expect(getDisplaySnapshot("nested", ["P"], async () => "z")).rejects.toBeInstanceOf(DisplaySnapshotBusyError);
    });
    expect((await getDisplaySnapshot("nested", ["P"], async () => "z")).payload).toBe("z");
  }, 10_000);

  it("returns immutable serialized payloads", async () => {
    await getDisplaySnapshot("m", ["D"], async () => JSON.stringify({ tables: [{ name: "a" }] }));
    const first = await getDisplaySnapshot("m", ["D"], async () => "unused");
    const parsed = JSON.parse(first.payload) as { tables: Array<{ name: string }> };
    parsed.tables.push({ name: "polluted" });
    parsed.tables[0]!.name = "changed";
    const second = await getDisplaySnapshot("m", ["D"], async () => "unused");
    expect(JSON.parse(second.payload)).toEqual({ tables: [{ name: "a" }] });
  });

  it("is pending without a payload while the reconciler is stopped, and serves again once it recovers", async () => {
    stopDisplayReconciler();
    expect(displayCacheVerified()).toBe(false);
    let builds = 0;
    await expect(getDisplaySnapshot("b", ["D"], async () => String(++builds))).rejects.toMatchObject({ reason: "reconcile_failed", display: { state: "pending" } });
    expect(builds).toBe(0);
    await startDisplayReconciler({ metadataIntervalMs: 60_000, fullDigestIntervalMs: 60_000 });
    expect((await getDisplaySnapshot("b", ["D"], async () => String(++builds))).payload).toBe("1");
  });
});

describe("Spec 174 R1 — unverified reconciliation never bypasses the safe return boundary (SC-03/04/05/15)", () => {
  it("unverified × pending write: pending, no build, no payload", async () => {
    stopDisplayReconciler();
    const token = beginDisplayWrite(["D"]);
    let builds = 0;
    await expect(getDisplaySnapshot("up", ["D"], async () => `partial-${++builds}`)).rejects.toBeInstanceOf(DisplaySnapshotPendingError);
    endDisplayWrite(token);
    expect(builds).toBe(0);
    expect(displaySnapshotDiagnostics().inflightBuilds).toBe(0);
  });

  it("unverified concurrency: no request builds, none returns data", async () => {
    stopDisplayReconciler();
    let builds = 0;
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, index) =>
      getDisplaySnapshot(`uc-${index % 2}`, ["D"], async () => String(++builds))
    ));
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(builds).toBe(0);
  });

  it("same-key and different-key concurrency never exceeds the build cap and settles to zero", async () => {
    let maxInflight = 0;
    const gate = deferred();
    const build = async () => {
      maxInflight = Math.max(maxInflight, displaySnapshotDiagnostics().inflightBuilds);
      await gate.promise;
      return "x";
    };
    const sameKey = Array.from({ length: 6 }, () => getDisplaySnapshot("same", ["D"], build));
    const otherKeys = Array.from({ length: 8 }, (_, index) => getDisplaySnapshot(`other-${index}`, ["D"], build, { budget: quickBudget() }));
    const all = Promise.allSettled([...sameKey, ...otherKeys]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(displaySnapshotDiagnostics().inflightBuilds).toBeLessThanOrEqual(MAX_CONCURRENT_DISPLAY_BUILDS);
    gate.resolve();
    const settled = await all;
    expect(maxInflight).toBeLessThanOrEqual(MAX_CONCURRENT_DISPLAY_BUILDS);
    expect(settled.slice(0, 6).every((result) => result.status === "fulfilled")).toBe(true);
    expect(settled.filter((result) => result.status === "rejected").length).toBeGreaterThan(0);
    expect(displaySnapshotDiagnostics().inflightBuilds).toBe(0);
  });

  it("verification lost during a build: owner and attached waiters are pending, nothing is published", async () => {
    const gate = deferred();
    let builds = 0;
    const build = async () => {
      builds += 1;
      await gate.promise;
      return `b-${builds}`;
    };
    const owner = getDisplaySnapshot("lost", ["D"], build);
    const attached = getDisplaySnapshot("lost", ["D"], build);
    // Attach both rejection handlers before yielding. The busy rejection fires
    // as soon as the build settles, and awaiting the owner first would leave
    // `attached` without a handler for a tick - an unhandled rejection fails
    // the whole run even when every assertion passes.
    const ownerRejects = expect(owner).rejects.toBeInstanceOf(DisplaySnapshotPendingError);
    const attachedRejects = expect(attached).rejects.toBeInstanceOf(DisplaySnapshotPendingError);
    await new Promise((resolve) => setTimeout(resolve, 5));
    stopDisplayReconciler();
    gate.resolve();
    await ownerRejects;
    await attachedRejects;
    expect(builds).toBe(1);
    expect(displaySnapshotDiagnostics().entries.find((entry) => entry.name === "lost")).toMatchObject({ hasCurrent: false, inflight: 0 });
    await startDisplayReconciler({ metadataIntervalMs: 60_000, fullDigestIntervalMs: 60_000 });
    expect((await getDisplaySnapshot("lost", ["D"], build)).payload).toBe("b-2");
  });

  it("verification lost while waiting for a pending write is pending", async () => {
    const token = beginDisplayWrite(["D"]);
    const waiting = getDisplaySnapshot("wait-lost", ["D"], async () => "data");
    // Attach the handler before yielding; see the sibling test above.
    const waitingRejects = expect(waiting).rejects.toBeInstanceOf(DisplaySnapshotPendingError);
    await new Promise((resolve) => setTimeout(resolve, 5));
    stopDisplayReconciler();
    endDisplayWrite(token);
    await waitingRejects;
  });

  it("a request during write → rollback waits for the outer barrier and returns only the final disk state", async () => {
    let disk = "v1";
    const build = async () => disk;
    await getDisplaySnapshot("rb", ["P"], build);
    const transaction = withDisplayWriteBarrier(["P"], async () => {
      disk = "v2-unacked";
      await new Promise((resolve) => setTimeout(resolve, 20));
      await withDisplayWriteBarrier(["P"], async () => {
        disk = "v1";
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const during = getDisplaySnapshot("rb", ["P"], build);
    await transaction;
    const result = await during;
    expect(result.payload).toBe("v1");
    expect(result.cache).toBe("miss");
  });

  it("a reconciler watching another project root does not verify this root's snapshots", async () => {
    const otherRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-display-snapshot-other-"));
    try {
      await writeFile(path.join(otherRoot, "ktx.yaml"), "connections: {}\n", "utf8");
      process.env.KTX_PROJECT_ROOT = otherRoot;
      invalidateContentPathsCache();
      await expect(getDisplaySnapshot("switch", ["D"], async () => "other", { budget: quickBudget() })).rejects.toMatchObject({ reason: "context_mismatch", display: { state: "pending" } });
      await startDisplayReconciler({ metadataIntervalMs: 60_000, fullDigestIntervalMs: 60_000 });
      expect((await getDisplaySnapshot("switch", ["D"], async () => "other")).payload).toBe("other");
    } finally {
      process.env.KTX_PROJECT_ROOT = projectRoot;
      invalidateContentPathsCache();
      await rm(otherRoot, { recursive: true, force: true });
    }
  });
});

describe("Spec 174 T3 — external change reconciliation (SC-05/13, DI-12/13)", () => {
  it("detects edits, deletes and atomic replaces; ignores history / tmp sidecars", async () => {
    const d0 = displayGenerations().D;
    await writeFile(manifestPath(), "tables:\n  fin_ledger:\n    table: fin.fin_ledger\n  fin_budget:\n    table: fin.fin_budget\n", "utf8");
    await reconcileMetadata();
    const d1 = displayGenerations().D;
    expect(d1).toBeGreaterThan(d0);
    expect(displayGenerations().P).toBeGreaterThan(0);

    const tmp = `${manifestPath()}.next`;
    await writeFile(tmp, "tables: {}\n", "utf8");
    await rename(tmp, manifestPath());
    await reconcileMetadata();
    const d2 = displayGenerations().D;
    expect(d2).toBeGreaterThan(d1);

    await mkdir(path.join(projectRoot, "config", "semantic-layer", ".lucy-history"), { recursive: true });
    await writeFile(path.join(projectRoot, "config", "semantic-layer", ".lucy-history", "x.yaml"), "a: 1\n", "utf8");
    await writeFile(path.join(path.dirname(manifestPath()), ".abc.upload.tmp"), "partial", "utf8");
    await reconcileMetadata();
    expect(displayGenerations().D).toBe(d2);

    await rm(manifestPath());
    await reconcileMetadata();
    expect(displayGenerations().D).toBeGreaterThan(d2);
  });

  it("finds same-size, same-mtime rewrites exactly once (Spec 195 §5.2)", async () => {
    const before = await stat(manifestPath());
    await writeFile(manifestPath(), "tables:\n  fin_ledgeR:\n    table: fin.fin_ledger\n", "utf8");
    await utimes(manifestPath(), before.atime, before.mtime);
    await reconcileMetadata();
    const afterMeta = displayGenerations().D;
    // The metadata signature moved (ctime), so the metadata pass confirmed the
    // version; the full digest must not invalidate the same version again.
    expect(afterMeta).toBeGreaterThan(0);
    await reconcileFullDigest();
    expect(displayGenerations().D).toBe(afterMeta);
  });

  it("migrates to a new content root when ktx.yaml paths.content_root changes", async () => {
    let builds = 0;
    const build = async () => String(++builds);
    await getDisplaySnapshot("root", ["D"], build);
    await mkdir(path.join(projectRoot, "other", "semantic-layer"), { recursive: true });
    await writeFile(path.join(projectRoot, "ktx.yaml"), "paths:\n  content_root: other\nconnections: {}\n", "utf8");
    await reconcileMetadata();
    const result = await getDisplaySnapshot("root", ["D"], build);
    expect(result.cache).toBe("miss");
    expect(builds).toBe(2);
    expect(displaySnapshotDiagnostics().entries.find((entry) => entry.name === "root")?.hasCurrent).toBe(true);
  });

  it("classifies write targets into display scopes", () => {
    const context = { projectRoot: "/p", semanticLayer: "/p/config/semantic-layer", accessPaths: ["/p/webui/config/access.yaml"] };
    expect(scopesForPath("/p/config/semantic-layer/c/_schema/s.yaml", context)).toEqual(["D", "P"]);
    expect(scopesForPath("/p/config/semantic-layer/c/t.yaml", context)).toEqual(["D"]);
    expect(scopesForPath("/p/config/semantic-layer/c/.x.upload.tmp", context)).toEqual([]);
    expect(scopesForPath("/p/ktx.yaml", context)).toEqual(["C", "D", "P", "L"]);
    expect(scopesForPath("/p/webui/config/access.yaml", context)).toEqual(["P"]);
    expect(scopesForPath("/p/.ktx/secrets/c-password", context)).toEqual(["C", "L"]);
    expect(scopesForPath("/p/config/wiki/x.md", context)).toEqual([]);
    expect(scopesForPath("/p/.ktx-ui/catalog-reloads.json", context)).toEqual([]);
  });

  it("stop/close releases watchers and timers", () => {
    stopDisplayReconciler();
    expect(displaySnapshotDiagnostics().reconcilerRunning).toBe(false);
    stopDisplayReconciler();
  });

  it("a restarted reconciler never serves a snapshot from before the unverified window", async () => {
    let disk = "before";
    await getDisplaySnapshot("restart", ["D"], async () => disk);
    stopDisplayReconciler();
    disk = "after";
    await startDisplayReconciler({ metadataIntervalMs: 60_000, fullDigestIntervalMs: 60_000 });
    expect((await getDisplaySnapshot("restart", ["D"], async () => disk)).payload).toBe("after");
  });

  it("the server-owned stopper only stops a reconciler it started", async () => {
    const { ensureDisplayReconciler } = await import("../display-snapshot");
    const keep = await ensureDisplayReconciler();
    keep();
    expect(displaySnapshotDiagnostics().reconcilerRunning).toBe(true);
    stopDisplayReconciler();
    const own = await ensureDisplayReconciler();
    expect(displaySnapshotDiagnostics().reconcilerRunning).toBe(true);
    own();
    expect(displaySnapshotDiagnostics().reconcilerRunning).toBe(false);
  });
});

/**
 * Spec 195 §5 — one confirmed change invalidates the derived scopes once,
 * whichever of the two reconciliations observes it first.
 */
describe("Spec 195 SI-01/SI-02 — one confirmed change, one invalidation", () => {
  async function seedOverlay(): Promise<void> {
    await writeFile(overlayPath(), "grain: [id]\n", "utf8");
    await reconcileMetadata();
  }

  it("SI-01 metadata → full: one external overlay version invalidates D exactly once", async () => {
    await seedOverlay();
    const before = displayGenerations();
    await writeFile(overlayPath(), "grain: [id, region]\n", "utf8");
    await reconcileMetadata();
    const afterMeta = displayGenerations();
    expect(afterMeta.D).toBe(before.D + 1);
    // An ordinary overlay never feeds the permission display.
    expect(afterMeta.P).toBe(before.P);
    await reconcileFullDigest();
    expect(displayGenerations().D).toBe(afterMeta.D);
  });

  it("SI-01 full → metadata: the same version is not invalidated twice", async () => {
    await seedOverlay();
    const before = displayGenerations();
    await writeFile(overlayPath(), "grain: [id, region]\n", "utf8");
    await reconcileFullDigest();
    const afterFull = displayGenerations();
    expect(afterFull.D).toBe(before.D + 1);
    await reconcileMetadata();
    expect(displayGenerations().D).toBe(afterFull.D);
  });

  it("SI-01 concurrent observation: one version invalidates D once", async () => {
    await seedOverlay();
    const before = displayGenerations();
    await writeFile(overlayPath(), "grain: [id, region]\n", "utf8");
    await Promise.all([reconcileMetadata(), reconcileFullDigest()]);
    expect(displayGenerations().D).toBe(before.D + 1);
  });

  it("SI-02 a second version, a deletion and a recreation are each confirmed once", async () => {
    await seedOverlay();
    let gens = displayGenerations();
    await writeFile(overlayPath(), "grain: [id, region]\n", "utf8");
    await reconcileMetadata();
    expect(displayGenerations().D).toBe(gens.D + 1);
    gens = displayGenerations();

    await rm(overlayPath());
    await reconcileMetadata();
    expect(displayGenerations().D).toBe(gens.D + 1);
    gens = displayGenerations();

    await writeFile(overlayPath(), "grain: [id, region, amount]\n", "utf8");
    await reconcileMetadata();
    expect(displayGenerations().D).toBe(gens.D + 1);
  });

  it("SI-02 an atomic replace is confirmed once", async () => {
    await seedOverlay();
    const before = displayGenerations();
    const tmp = `${overlayPath()}.next`;
    await writeFile(tmp, "grain: [id, region]\n", "utf8");
    await rename(tmp, overlayPath());
    await reconcileMetadata();
    const afterMeta = displayGenerations();
    expect(afterMeta.D).toBe(before.D + 1);
    await reconcileFullDigest();
    expect(displayGenerations().D).toBe(afterMeta.D);
  });

  it("SI-02 a same-content rewrite with a new mtime still moves the semantic generation once", async () => {
    await seedOverlay();
    const before = displayGenerations();
    await writeFile(overlayPath(), "grain: [id]\n", "utf8");
    await reconcileMetadata();
    const afterMeta = displayGenerations();
    expect(afterMeta.D).toBe(before.D + 1);
    await reconcileFullDigest();
    expect(displayGenerations().D).toBe(afterMeta.D);
  });
});

/**
 * Spec 195 §6 / §7 — SI-09, SI-10, SI-12: shared bounded recovery, one
 * request budget and distinguishable diagnostics.
 */
describe("Spec 195 SI-09/SI-10/SI-12 — bounded recovery and diagnostics", () => {
  afterEach(() => {
    fsGate.hold = null;
  });

  /** Push the clock past the freshness windows so the scope is overdue. */
  function makeOverdue(): () => void {
    const realNow = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(realNow + 200_000);
    return () => spy.mockRestore();
  }

  it("SI-09 an overdue verification with no committed view answers pending without a payload and recovers afterwards", async () => {
    const hold = deferred();
    fsGate.hold = hold.promise;
    const restoreClock = makeOverdue();
    const started = Date.now();
    await expect(getDisplaySnapshot("overdue", ["D"], async () => "payload", { budget: quickBudget() })).rejects.toBeInstanceOf(DisplaySnapshotPendingError);
    const waited = Date.now() - started;
    // The request waits for the shared task, but never past its own budget.
    expect(waited).toBeLessThan(DISPLAY_RECOVERY_WAIT_BUDGET_MS + 1500);
    hold.resolve();
    fsGate.hold = null;
    restoreClock();
    await reconcileMetadata();
    await reconcileFullDigest();
    const recovered = await getDisplaySnapshot("overdue", ["D"], async () => "payload");
    expect(recovered.payload).toBe("payload");
  });

  it("P0-1 an aged-but-error-free verification serves the committed slot at once and re-verifies in the background", async () => {
    const first = await getDisplaySnapshot("grace", ["D"], async () => "payload");
    expect(first.cache).toBe("miss");
    const hold = deferred();
    fsGate.hold = hold.promise;
    const realNow = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(realNow + 5_000);
    const started = performance.now();
    const served = await getDisplaySnapshot("grace", ["D"], async () => { throw new Error("must not build"); });
    expect(performance.now() - started).toBeLessThan(500);
    expect(served).toMatchObject({ payload: "payload", cache: "hit", version: first.version, degraded: { state: "grace", generation: expect.any(String) } });
    expect(served.degraded?.ageMs).toBeGreaterThanOrEqual(0);
    expect(displaySnapshotDiagnostics()).toMatchObject({ graceServes: 1 });
    hold.resolve();
    fsGate.hold = null;
    spy.mockRestore();
    await reconcileMetadata();
  });

  it("P1-75 beyond the grace limit the same-generation committed slot is served as stale (200), never as grace", async () => {
    await getDisplaySnapshot("grace-limit", ["D"], async () => "payload");
    const hold = deferred();
    fsGate.hold = hold.promise;
    const restoreClock = makeOverdue();
    const served = await getDisplaySnapshot("grace-limit", ["D"], async () => "must not build", { budget: quickBudget() });
    expect(served).toMatchObject({ payload: "payload", cache: "hit", degraded: { state: "stale", generation: expect.any(String) } });
    expect(served.degraded?.ageMs).toBeGreaterThan(150_000);
    expect(served.degraded).not.toHaveProperty("pendingMs");
    expect(displaySnapshotDiagnostics()).toMatchObject({ graceServes: 0, staleServes: 1 });
    hold.resolve();
    fsGate.hold = null;
    restoreClock();
    await reconcileMetadata();
    await reconcileFullDigest();
  });

  it("SI-09 a request that gives up does not stop the shared verification task", async () => {
    const hold = deferred();
    fsGate.hold = hold.promise;
    const restoreClock = makeOverdue();
    const shortBudget = createDisplayRequestBudget(3, 60, 50);
    await expect(getDisplaySnapshot("shared", ["D"], async () => "payload", { budget: shortBudget })).rejects.toBeInstanceOf(DisplaySnapshotPendingError);
    // The shared task is still running: the reconciler is alive and the scope
    // has no completed verification yet.
    expect(displaySnapshotDiagnostics().reconcilerRunning).toBe(true);
    expect(displaySnapshotDiagnostics().scopeHealth.D.metadataCompletedAt).toBeLessThan(Date.now());
    hold.resolve();
    fsGate.hold = null;
    restoreClock();
    await reconcileMetadata();
    const health = displaySnapshotDiagnostics().scopeHealth.D;
    expect(health.metadataError ?? null).toBeNull();
  });

  it("SI-10 one request spends at most three attempts and one recovery budget", async () => {
    const hold = deferred();
    fsGate.hold = hold.promise;
    const restoreClock = makeOverdue();
    const budget = quickBudget();
    const started = Date.now();
    await expect(getDisplaySnapshot("attempts", ["D"], async () => "payload", { budget })).rejects.toBeInstanceOf(DisplaySnapshotPendingError);
    const elapsed = Date.now() - started;
    expect(budget.attemptsLeft).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(DISPLAY_RECOVERY_WAIT_BUDGET_MS + 1500);
    const diagnostics = displaySnapshotDiagnostics();
    expect(diagnostics.lastRequest?.attempts ?? 0).toBeLessThanOrEqual(3);
    expect(diagnostics.lastRequest?.name).toBe("attempts");
    hold.resolve();
    fsGate.hold = null;
    restoreClock();
  });

  it("SI-10 concurrent readers of one scope share the verification task", async () => {
    const hold = deferred();
    fsGate.hold = hold.promise;
    const requests = Array.from({ length: 4 }, () =>
      getDisplaySnapshot("shared-scope", ["D"], async () => "payload").catch((error) => error)
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    hold.resolve();
    fsGate.hold = null;
    const results = await Promise.all(requests);
    // Every reader either got the payload or the same busy envelope — none of
    // them started a second full scan.
    expect(results.every((result) => result instanceof Error || result.payload === "payload")).toBe(true);
    expect(displaySnapshotDiagnostics().fileIoPeak).toBeLessThanOrEqual(2);
  });

  it("SI-10 the display build cap stays at four and file I/O at two", async () => {
    await getDisplaySnapshot("io-cap", ["D"], async () => "payload");
    const diagnostics = displaySnapshotDiagnostics();
    expect(diagnostics.fileIoPeak).toBeLessThanOrEqual(2);
    expect(MAX_CONCURRENT_DISPLAY_BUILDS).toBe(4);
  });

  it("SI-12 a busy request reports a distinguishable reason without sensitive content", async () => {
    const token = beginDisplayWrite(["D"]);
    await expect(
      getDisplaySnapshot("busy", ["D"], async () => "payload", { budget: createDisplayRequestBudget(3, 40) })
    ).rejects.toMatchObject({ code: "DISPLAY_SNAPSHOT_BUSY", reason: "write_pending" });
    endDisplayWrite(token);

    const diagnostics = displaySnapshotDiagnostics();
    expect(diagnostics.busyByReason.write_pending).toBeGreaterThan(0);
    // No absolute path, file content or credential may appear in diagnostics.
    expect(JSON.stringify(diagnostics)).not.toContain(projectRoot);
    expect(JSON.stringify(diagnostics)).not.toContain("ktx.yaml");
  });
});

describe("P1-75 committed view served during a single note-only write", () => {
  const SCOPES = ["P", "C"] as const;
  const quick = () => createDisplayRequestBudget(3, 30, 50);
  async function warm(payload = "old") {
    await getDisplaySnapshot("roster", SCOPES, async () => payload, { extraKey: "v1" });
    return captureCommittedDisplayView("roster", SCOPES, "v1", { raw: "old-raw", version: "v1" });
  }

  it("captures only a verified, current, complete committed slot", async () => {
    expect(await captureCommittedDisplayView("roster", SCOPES, "v1", null)).toBeNull();
    expect(await warm()).not.toBeNull();
    expect(await captureCommittedDisplayView("roster", SCOPES, "other-version", null)).toBeNull();
    const token = beginDisplayWrite(["P"]);
    expect(await captureCommittedDisplayView("roster", SCOPES, "v1", null)).toBeNull();
    endDisplayWrite(token);
  });

  it("serves the committed payload inside its own write barrier while the normal path stays busy", async () => {
    const view = await warm("old");
    await withDisplayWriteBarrier(["P"], async (token) => {
      expect(openCommittedViewServe(view!, token)).toBe(true);
      expect(activeCommittedView("roster")).toBe(view);
      const served = await getDisplaySnapshot("roster", SCOPES, async () => "live-mid-write", { extraKey: "v2", budget: quick(), committedView: view! });
      expect(served.payload).toBe("old");
      expect(served.cache).toBe("hit");
      await expect(getDisplaySnapshot("roster", SCOPES, async () => "live", { extraKey: "v2", budget: quick() }))
        .rejects.toMatchObject({ code: "DISPLAY_SNAPSHOT_BUSY", reason: "write_pending" });
    });
    // The write ended: the view is gone and a stale companion is never built from.
    expect(committedViewServeValid(view!)).toBe(false);
    expect(activeCommittedView("roster")).toBeNull();
    await expect(getDisplaySnapshot("roster", SCOPES, async () => "never", { extraKey: "v1", budget: quick(), committedView: view! }))
      .rejects.toMatchObject({ code: "DISPLAY_SNAPSHOT_BUSY", reason: "generation_changed" });
  });

  it("counts a served attempt against the shared request budget", async () => {
    const view = await warm();
    await withDisplayWriteBarrier(["P"], async (token) => {
      openCommittedViewServe(view!, token);
      const budget = createDisplayRequestBudget(2, 30);
      await getDisplaySnapshot("roster", SCOPES, async () => "x", { budget, committedView: view! });
      await getDisplaySnapshot("roster", SCOPES, async () => "x", { budget, committedView: view! });
      expect(budget.attemptsLeft).toBe(0);
      await expect(getDisplaySnapshot("roster", SCOPES, async () => "x", { budget, committedView: view! }))
        .rejects.toMatchObject({ reason: "generation_changed" });
    });
  });

  it("tolerates the write's own nested barriers but withdraws on any other generation movement", async () => {
    const view = await warm();
    await withDisplayWriteBarrier(["P"], async (token) => {
      expect(openCommittedViewServe(view!, token)).toBe(true);
      await runWithCommittedViewServe(view!, () => withDisplayWriteBarrier(["P"], async () => undefined));
      expect(committedViewServeValid(view!)).toBe(true);
      // A foreign writer (different async chain) begins: eligibility goes away synchronously.
      const foreign = beginDisplayWrite(["P"]);
      expect(committedViewServeValid(view!)).toBe(false);
      expect(activeCommittedView("roster")).toBeNull();
      endDisplayWrite(foreign);
    });
  });

  it("withdraws on an external change to the scopes and on slot eviction", async () => {
    const view = await warm();
    await withDisplayWriteBarrier(["P"], async (token) => {
      openCommittedViewServe(view!, token);
      expect(committedViewServeValid(view!)).toBe(true);
      const served = await getDisplaySnapshot("roster", SCOPES, async () => "x", { budget: quick(), committedView: view! });
      expect(evictDisplaySnapshotSlot("roster", served.incarnation)).toBe(true);
      expect(committedViewServeValid(view!)).toBe(false);
    });
  });

  it("refuses to open when another generation moved between capture and the barrier", async () => {
    const view = await warm();
    const other = beginDisplayWrite(["C"]);
    endDisplayWrite(other);
    await withDisplayWriteBarrier(["P"], async (token) => {
      expect(openCommittedViewServe(view!, token)).toBe(false);
      expect(activeCommittedView("roster")).toBeNull();
    });
  });

  it("refuses a view whose barrier does not cover its scopes and an ended barrier", async () => {
    const view = await warm();
    const unrelated = beginDisplayWrite(["D"]);
    expect(openCommittedViewServe(view!, unrelated)).toBe(false);
    endDisplayWrite(unrelated);
    const token = beginDisplayWrite(["P"]);
    endDisplayWrite(token);
    expect(openCommittedViewServe(view!, token)).toBe(false);
  });

  it("an explicit withdraw makes the readers fall back to the normal verified path", async () => {
    const view = await warm();
    await withDisplayWriteBarrier(["P"], async (token) => {
      openCommittedViewServe(view!, token);
      withdrawCommittedViewServe(view!);
      withdrawCommittedViewServe("roster");
      await expect(getDisplaySnapshot("roster", SCOPES, async () => "x", { budget: quick(), committedView: view! }))
        .rejects.toMatchObject({ reason: "generation_changed" });
    });
  });

  it("stops serving when the reconciler can no longer verify the scopes", async () => {
    const view = await warm();
    await withDisplayWriteBarrier(["P"], async (token) => {
      openCommittedViewServe(view!, token);
      stopDisplayReconciler();
      expect(committedViewServeValid(view!)).toBe(false);
    });
  });

  it("refuses and withdraws the view when the access recovery latch is closed, then serves normally once it clears", async () => {
    const recovery = await import("../access-recovery");
    const view = await warm("old");
    try {
      await withDisplayWriteBarrier(["P"], async (token) => {
        expect(openCommittedViewServe(view!, token)).toBe(true);
        expect(committedViewServeValid(view!)).toBe(true);
        recovery.setInMemoryRecoveryRequiredSync({ reason: "test_latch" });
        expect(committedViewServeValid(view!)).toBe(false);
        expect(activeCommittedView("roster")).toBeNull();
        await expect(getDisplaySnapshot("roster", SCOPES, async () => "x", { budget: quick(), committedView: view! }))
          .rejects.toMatchObject({ reason: "generation_changed" });
        // Clearing the latch does not resurrect a withdrawn view.
        recovery.clearInMemoryRecoveryRequiredSync();
        expect(committedViewServeValid(view!)).toBe(false);
      });
    } finally {
      recovery.clearInMemoryRecoveryRequiredSync();
    }
    const after = await getDisplaySnapshot("roster", SCOPES, async () => "fresh", { extraKey: "v1" });
    expect(["old", "fresh"]).toContain(after.payload);
  });

  it("bounded recovery: an unverifiable reconciler refuses, and the same process serves again once restored", async () => {
    const view = await warm("old");
    await withDisplayWriteBarrier(["P"], async (token) => {
      openCommittedViewServe(view!, token);
      stopDisplayReconciler();
      expect(committedViewServeValid(view!)).toBe(false);
    });
    const started = Date.now();
    await expect(getDisplaySnapshot("roster", SCOPES, async () => "x", { extraKey: "v1", budget: quick() }))
      .rejects.toMatchObject({ reason: "reconcile_failed", display: { state: "pending" } });
    expect(Date.now() - started).toBeLessThan(DISPLAY_RECOVERY_WAIT_BUDGET_MS + 1500);
    await startDisplayReconciler({ metadataIntervalMs: 60_000, fullDigestIntervalMs: 60_000 });
    const recovered = await getDisplaySnapshot("roster", SCOPES, async () => "recovered", { extraKey: "v1" });
    expect(["old", "recovered"]).toContain(recovered.payload);
  });

  it("rejects a view requested under another snapshot name or scope set", async () => {
    const view = await warm();
    await withDisplayWriteBarrier(["P"], async (token) => {
      openCommittedViewServe(view!, token);
      await expect(getDisplaySnapshot("other", SCOPES, async () => "x", { budget: quick(), committedView: view! })).rejects.toMatchObject({ reason: "generation_changed" });
      await expect(getDisplaySnapshot("roster", ["P"], async () => "x", { budget: quick(), committedView: view! })).rejects.toMatchObject({ reason: "generation_changed" });
    });
  });
});

/**
 * P1-75 v1.4 §2.4 / §2.5.1 / Appendix A — A-class reads answer 200 degraded states instead of 503.
 */
describe("P1-75 X3 — degraded read states (grace / stale / pending) and D_max", () => {
  const holds: Array<{ resolve: () => void }> = [];
  /** Block file reads; always released in afterEach so a failed assertion cannot wedge the shared I/O scheduler. */
  function holdFs() {
    const gate = deferred();
    holds.push(gate);
    fsGate.hold = gate.promise;
    return gate;
  }
  afterEach(() => {
    fsGate.hold = null;
    for (const gate of holds.splice(0)) gate.resolve();
  });

  /** Past the grace window (120 s / 180 s) yet error-free: the committed view is `stale`. */
  function clockAt(offsetMs: number) {
    const realNow = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(realNow + offsetMs);
    return { set: (next: number) => spy.mockReturnValue(realNow + next), restore: () => spy.mockRestore() };
  }

  it("the build/verification wait budget is 10 s and every request deadline is derived from it", () => {
    expect(DISPLAY_BUILD_WAIT_BUDGET_MS).toBe(10_000);
    expect(DISPLAY_DEGRADE_MAX_MS).toBe(180_000);
    const budget = createDisplayRequestBudget();
    const left = budget.buildDeadline - performance.now();
    expect(left).toBeGreaterThan(9_500);
    expect(left).toBeLessThanOrEqual(10_000);
  });

  it("a build that outlasts the old 4 s budget but finishes inside 10 s is fresh, not a 503", async () => {
    const gate = deferred<string>();
    const read = getDisplaySnapshot("slow-build", ["D"], () => gate.promise, { budget: createDisplayRequestBudget(3, 1500, 600) });
    setTimeout(() => gate.resolve("late"), 250);
    await expect(read).resolves.toMatchObject({ payload: "late", cache: "miss" });
  });

  it("no same-generation view: waits for verification inside the 10 s window and returns fresh when it recovers", async () => {
    const hold = holdFs();
    const clock = clockAt(200_000);
    setTimeout(() => { fsGate.hold = null; hold.resolve(); }, 1_800);
    const started = Date.now();
    const served = await getDisplaySnapshot("recover-in-wait", ["D"], async () => "payload");
    expect(served).toMatchObject({ payload: "payload", cache: "miss" });
    expect(served.degraded).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(10_000);
    clock.restore();
  }, 15_000);

  it("pending carries no payload and the error exposes only the frozen marker fields", async () => {
    stopDisplayReconciler();
    const error = await getDisplaySnapshot("pending-shape", ["D"], async () => "secret").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DisplaySnapshotPendingError);
    const pending = error as DisplaySnapshotPendingError;
    expect(pending.display).toEqual({ state: "pending", generation: expect.any(String), pendingMs: expect.any(Number) });
    expect(JSON.stringify(pending.display)).not.toContain("secret");
    expect(pending.display).not.toHaveProperty("ageMs");
    expect(displaySnapshotDiagnostics()).toMatchObject({ pendingServes: 1 });
  });

  it("write_pending stays a B-class retryable 503 (it is not degraded)", async () => {
    const token = beginDisplayWrite(["D"]);
    await expect(getDisplaySnapshot("b-class", ["D"], async () => "x", { budget: createDisplayRequestBudget(3, 40) }))
      .rejects.toMatchObject({ code: "DISPLAY_SNAPSHOT_BUSY", statusCode: 503, reason: "write_pending" });
    endDisplayWrite(token);
  });

  it("stale never serves across a pending write or a recorded verification error", async () => {
    await getDisplaySnapshot("stale-guard", ["D"], async () => "payload");
    const hold = holdFs();
    const clock = clockAt(200_000);
    const token = beginDisplayWrite(["D"]);
    // A pending write refuses the degraded view; unverified + write pending is A-class pending, never stale data.
    await expect(getDisplaySnapshot("stale-guard", ["D"], async () => "x", { budget: createDisplayRequestBudget(3, 40, 50) }))
      .rejects.toBeInstanceOf(DisplaySnapshotPendingError);
    endDisplayWrite(token);
    stopDisplayReconciler();
    await expect(getDisplaySnapshot("stale-guard", ["D"], async () => "x", { budget: quickBudget() }))
      .rejects.toMatchObject({ reason: "reconcile_failed", display: { state: "pending" } });
    clock.restore();
    hold.resolve();
  });

  it("non-error degradation past D_max keeps answering 200 and is flagged prolonged (never a 503)", async () => {
    await getDisplaySnapshot("prolonged", ["D"], async () => "payload");
    const hold = holdFs();
    const clock = clockAt(200_000);
    const first = await getDisplaySnapshot("prolonged", ["D"], async () => "x", { budget: quickBudget() });
    expect(first.degraded).toMatchObject({ state: "stale" });
    expect(first.degraded?.prolonged).toBeUndefined();
    clock.set(200_000 + DISPLAY_DEGRADE_MAX_MS + 1_000);
    const later = await getDisplaySnapshot("prolonged", ["D"], async () => "x", { budget: quickBudget() });
    expect(later).toMatchObject({ payload: "payload", degraded: { state: "stale", prolonged: true } });
    expect(displaySnapshotDiagnostics()).toMatchObject({ prolongedServes: 1, reconciliationFailed: 0 });
    clock.restore();
    hold.resolve();
  });

  it("pending past D_max without a recorded error is still 200 pending, flagged prolonged", async () => {
    const hold = holdFs();
    const clock = clockAt(200_000);
    const first = await getDisplaySnapshot("prolonged-pending", ["D"], async () => "x", { budget: quickBudget() }).catch((e: unknown) => e);
    expect((first as DisplaySnapshotPendingError).display).toMatchObject({ state: "pending" });
    clock.set(200_000 + DISPLAY_DEGRADE_MAX_MS + 1_000);
    const later = await getDisplaySnapshot("prolonged-pending", ["D"], async () => "x", { budget: quickBudget() }).catch((e: unknown) => e);
    expect(later).toBeInstanceOf(DisplaySnapshotPendingError);
    expect((later as DisplaySnapshotPendingError).display).toMatchObject({ state: "pending", prolonged: true });
    expect((later as DisplaySnapshotPendingError).display.pendingMs).toBeGreaterThan(DISPLAY_DEGRADE_MAX_MS);
    clock.restore();
    hold.resolve();
  });

  it("a fresh read clears the degradation clock of that view", async () => {
    await getDisplaySnapshot("clears", ["D"], async () => "payload");
    const hold = holdFs();
    const clock = clockAt(200_000);
    await getDisplaySnapshot("clears", ["D"], async () => "x", { budget: quickBudget() });
    clock.restore();
    fsGate.hold = null;
    hold.resolve();
    await reconcileMetadata();
    await reconcileFullDigest();
    const fresh = await getDisplaySnapshot("clears", ["D"], async () => "x");
    expect(fresh.degraded).toBeUndefined();
    const again = clockAt(200_000 + DISPLAY_DEGRADE_MAX_MS + 5_000);
    holdFs();
    const restarted = await getDisplaySnapshot("clears", ["D"], async () => "x", { budget: quickBudget() });
    expect(restarted.degraded?.prolonged).toBeUndefined();
    again.restore();
    fsGate.hold = null;
  });

  it("continuous reconcile_failed: 200 pending inside D_max, C-class 503 DISPLAY_RECONCILIATION_FAILED beyond it, cleared on recovery", async () => {
    stopDisplayReconciler();
    const clock = clockAt(0);
    await expect(getDisplaySnapshot("rf", ["D"], async () => "x", { budget: quickBudget() }))
      .rejects.toMatchObject({ reason: "reconcile_failed", display: { state: "pending" } });
    // New requests never reset the clock.
    clock.set(DISPLAY_DEGRADE_MAX_MS - 1_000);
    await expect(getDisplaySnapshot("rf", ["D"], async () => "x", { budget: quickBudget() }))
      .rejects.toBeInstanceOf(DisplaySnapshotPendingError);
    clock.set(DISPLAY_DEGRADE_MAX_MS + 1_000);
    const failure = await getDisplaySnapshot("rf", ["D"], async () => "x", { budget: quickBudget() }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(DisplayReconciliationFailedError);
    expect(failure).toMatchObject({ code: "DISPLAY_RECONCILIATION_FAILED", statusCode: 503 });
    expect(failure).not.toHaveProperty("retryAfterSeconds");
    expect((failure as Error).message).not.toMatch(/重试/);
    expect(displaySnapshotDiagnostics()).toMatchObject({ reconciliationFailed: 1 });
    // The C-class code is distinct from the retryable busy code, and it keeps no old content.
    expect(failure).not.toBeInstanceOf(DisplaySnapshotBusyError);
    clock.restore();
    // Verified again: the clock is cleared and a later failure starts a new window.
    await startDisplayReconciler({ metadataIntervalMs: 60_000, fullDigestIntervalMs: 60_000 });
    await expect(getDisplaySnapshot("rf", ["D"], async () => "ok")).resolves.toMatchObject({ payload: "ok" });
    stopDisplayReconciler();
    await expect(getDisplaySnapshot("rf", ["D"], async () => "x", { budget: quickBudget() })).rejects.toBeInstanceOf(DisplaySnapshotPendingError);
  });

  it("reconcile_failed is tracked per scope: one failing scope does not fail the others", async () => {
    stopDisplayReconciler();
    const clock = clockAt(0);
    await expect(getDisplaySnapshot("scope-d", ["D"], async () => "x", { budget: quickBudget() })).rejects.toBeInstanceOf(DisplaySnapshotPendingError);
    clock.set(DISPLAY_DEGRADE_MAX_MS + 1_000);
    await expect(getDisplaySnapshot("scope-d", ["D"], async () => "x", { budget: quickBudget() })).rejects.toBeInstanceOf(DisplayReconciliationFailedError);
    // Scope P never failed before: its first observation starts its own clock (pending, not 503).
    await expect(getDisplaySnapshot("scope-p", ["P"], async () => "x", { budget: quickBudget() })).rejects.toBeInstanceOf(DisplaySnapshotPendingError);
    clock.restore();
  });

  describe("identity isolation and write-out authorization (§2.5.1 conditions 2 and 4)", () => {
    const alice = { scope: "admin:alice", permissionVersion: "owner:1:1" };

    async function warmFor(name: string) {
      await getDisplaySnapshot(name, ["D"], async () => "alice-view", { principal: alice });
    }

    it("serves the degraded view only to an identity it was served fresh to", async () => {
      await warmFor("iso");
      const hold = holdFs();
      const clock = clockAt(200_000);
      const own = await getDisplaySnapshot("iso", ["D"], async () => "x", { budget: quickBudget(), principal: alice });
      expect(own).toMatchObject({ payload: "alice-view", degraded: { state: "stale" } });
      await expect(getDisplaySnapshot("iso", ["D"], async () => "x", { budget: quickBudget(), principal: { scope: "admin:bob", permissionVersion: "owner:1:1" } }))
        .rejects.toMatchObject({ display: { state: "pending" } });
      await expect(getDisplaySnapshot("iso", ["D"], async () => "x", { budget: quickBudget(), principal: { ...alice, permissionVersion: "owner:1:2" } }))
        .rejects.toMatchObject({ display: { state: "pending" } });
      await expect(getDisplaySnapshot("iso", ["D"], async () => "x", { budget: quickBudget() }))
        .rejects.toMatchObject({ display: { state: "pending" } });
      clock.restore();
      hold.resolve();
    }, 20_000);

    it("a fresh hit by another identity makes the same view servable to it", async () => {
      await warmFor("iso-hit");
      const bob = { scope: "admin:bob", permissionVersion: "owner:1:1" };
      await expect(getDisplaySnapshot("iso-hit", ["D"], async () => "x", { principal: bob })).resolves.toMatchObject({ cache: "hit" });
      const hold = holdFs();
      const clock = clockAt(200_000);
      await expect(getDisplaySnapshot("iso-hit", ["D"], async () => "x", { budget: quickBudget(), principal: bob }))
        .resolves.toMatchObject({ payload: "alice-view", degraded: { state: "stale" } });
      clock.restore();
      hold.resolve();
    });

    it("runs the authorization hook right before a degraded view is written out; a revoked caller gets no data", async () => {
      await warmFor("auth");
      const hold = holdFs();
      const clock = clockAt(200_000);
      const allow = vi.fn(async () => true);
      await expect(getDisplaySnapshot("auth", ["D"], async () => "x", { budget: quickBudget(), principal: alice, authorize: allow }))
        .resolves.toMatchObject({ payload: "alice-view", degraded: { state: "stale" } });
      expect(allow).toHaveBeenCalledTimes(1);
      const revoked = vi.fn(async () => false);
      const denied = await getDisplaySnapshot("auth", ["D"], async () => "x", { budget: quickBudget(), principal: alice, authorize: revoked }).catch((e: unknown) => e);
      expect(revoked).toHaveBeenCalled();
      expect(denied).toBeInstanceOf(DisplaySnapshotPendingError);
      expect(JSON.stringify((denied as DisplaySnapshotPendingError).display)).not.toContain("alice-view");
      clock.restore();
      hold.resolve();
    });

    it("authorization revoked while the hook is running abandons the degradation", async () => {
      await warmFor("overlap");
      const hold = holdFs();
      const clock = clockAt(200_000);
      let revoked = false;
      const authorize = async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return !revoked;
      };
      const reading = getDisplaySnapshot("overlap", ["D"], async () => "x", { budget: quickBudget(), principal: alice, authorize });
      revoked = true;
      await expect(reading).rejects.toBeInstanceOf(DisplaySnapshotPendingError);
      clock.restore();
      hold.resolve();
    });

    it("the budget carries identity and hook for nested snapshot reads", async () => {
      await warmFor("budget-ctx");
      const hold = holdFs();
      const clock = clockAt(200_000);
      const budget = Object.assign(quickBudget(), { principal: alice, authorize: async () => true });
      await expect(getDisplaySnapshot("budget-ctx", ["D"], async () => "x", { budget })).resolves.toMatchObject({ degraded: { state: "stale" } });
      clock.restore();
      hold.resolve();
    });
  });

  describe("P1-81 alignment: degraded reads are not healthy evidence", () => {
    it("fresh is the only healthy display read; grace, stale and pending all fail the probe", async () => {
      await getDisplaySnapshot("sources", SOURCES_SCOPES, async () => "view");
      expect(displayReadServable()).toEqual({ ok: true });
      const hold = holdFs();
      const grace = clockAt(5_000);
      expect(displayReadServable()).toMatchObject({ ok: false, degraded: "grace" });
      grace.restore();
      const stale = clockAt(200_000);
      expect(displayReadServable()).toMatchObject({ ok: false, degraded: "stale" });
      stale.restore();
      stopDisplayReconciler();
      expect(displayReadServable()).toMatchObject({ ok: false, degraded: "pending", reason: "no_reconciler" });
      hold.resolve();
    });

    it("an overdue scope with no committed view probes as pending", async () => {
      const hold = holdFs();
      const clock = clockAt(200_000);
      expect(displayReadServable()).toMatchObject({ ok: false, degraded: "pending" });
      clock.restore();
      hold.resolve();
    });
  });
});
