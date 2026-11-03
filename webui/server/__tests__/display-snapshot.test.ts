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
  createDisplayRequestBudget,
  displayCacheVerified,
  displaySnapshotDiagnostics,
  DISPLAY_RECOVERY_WAIT_BUDGET_MS,
  DisplaySnapshotBusyError,
  getDisplaySnapshot,
  reconcileFullDigest,
  reconcileMetadata,
  resetDisplaySnapshotsForTests,
  startDisplayReconciler,
  stopDisplayReconciler,
  MAX_CONCURRENT_DISPLAY_BUILDS
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
    await expect(getDisplaySnapshot("cap-extra", ["D"], async () => "y")).rejects.toMatchObject({ code: "DISPLAY_SNAPSHOT_BUSY", statusCode: 503, retryAfterSeconds: 1 });
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

  it("is busy without a payload while the reconciler is stopped, and serves again once it recovers", async () => {
    stopDisplayReconciler();
    expect(displayCacheVerified()).toBe(false);
    let builds = 0;
    await expect(getDisplaySnapshot("b", ["D"], async () => String(++builds))).rejects.toMatchObject({ code: "DISPLAY_SNAPSHOT_BUSY", statusCode: 503, retryAfterSeconds: 1 });
    expect(builds).toBe(0);
    await startDisplayReconciler({ metadataIntervalMs: 60_000, fullDigestIntervalMs: 60_000 });
    expect((await getDisplaySnapshot("b", ["D"], async () => String(++builds))).payload).toBe("1");
  });
});

describe("Spec 174 R1 — unverified reconciliation never bypasses the safe return boundary (SC-03/04/05/15)", () => {
  it("unverified × pending write: busy, no build, no payload", async () => {
    stopDisplayReconciler();
    const token = beginDisplayWrite(["D"]);
    let builds = 0;
    await expect(getDisplaySnapshot("up", ["D"], async () => `partial-${++builds}`)).rejects.toBeInstanceOf(DisplaySnapshotBusyError);
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
    const otherKeys = Array.from({ length: 8 }, (_, index) => getDisplaySnapshot(`other-${index}`, ["D"], build));
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

  it("verification lost during a build: owner and attached waiters are busy, nothing is published", async () => {
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
    const ownerRejects = expect(owner).rejects.toBeInstanceOf(DisplaySnapshotBusyError);
    const attachedRejects = expect(attached).rejects.toBeInstanceOf(DisplaySnapshotBusyError);
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

  it("verification lost while waiting for a pending write is busy", async () => {
    const token = beginDisplayWrite(["D"]);
    const waiting = getDisplaySnapshot("wait-lost", ["D"], async () => "data");
    // Attach the handler before yielding; see the sibling test above.
    const waitingRejects = expect(waiting).rejects.toBeInstanceOf(DisplaySnapshotBusyError);
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
      await expect(getDisplaySnapshot("switch", ["D"], async () => "other")).rejects.toBeInstanceOf(DisplaySnapshotBusyError);
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
    const spy = vi.spyOn(Date, "now").mockReturnValue(realNow + 60_000);
    return () => spy.mockRestore();
  }

  it("SI-09 an overdue verification serves no payload and recovers afterwards", async () => {
    const hold = deferred();
    fsGate.hold = hold.promise;
    const restoreClock = makeOverdue();
    const started = Date.now();
    await expect(getDisplaySnapshot("overdue", ["D"], async () => "payload")).rejects.toBeInstanceOf(DisplaySnapshotBusyError);
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

  it("SI-09 a request that gives up does not stop the shared verification task", async () => {
    const hold = deferred();
    fsGate.hold = hold.promise;
    const restoreClock = makeOverdue();
    const shortBudget = createDisplayRequestBudget(3, 60);
    await expect(getDisplaySnapshot("shared", ["D"], async () => "payload", { budget: shortBudget })).rejects.toBeInstanceOf(DisplaySnapshotBusyError);
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
    const budget = createDisplayRequestBudget();
    const started = Date.now();
    await expect(getDisplaySnapshot("attempts", ["D"], async () => "payload", { budget })).rejects.toBeInstanceOf(DisplaySnapshotBusyError);
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
