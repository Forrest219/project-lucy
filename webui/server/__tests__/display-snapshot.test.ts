import { mkdir, mkdtemp, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginDisplayWrite,
  displayGenerations,
  endDisplayWrite,
  resetDisplayGenerationsForTests,
  scopesForPath,
  withDisplayWriteBarrier
} from "../display-generation";
import {
  displayCacheVerified,
  displaySnapshotDiagnostics,
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
    stopDisplayReconciler();
    await startDisplayReconciler({ metadataIntervalMs: 60_000, fullDigestIntervalMs: 60_000 });
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

  it("bypasses the cache when the reconciler is stopped", async () => {
    stopDisplayReconciler();
    expect(displayCacheVerified()).toBe(false);
    let builds = 0;
    await getDisplaySnapshot("b", ["D"], async () => String(++builds));
    const second = await getDisplaySnapshot("b", ["D"], async () => String(++builds));
    expect(second.cache).toBe("bypass");
    expect(builds).toBe(2);
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

  it("finds same-size, same-mtime rewrites in the full digest", async () => {
    const before = await stat(manifestPath());
    await writeFile(manifestPath(), "tables:\n  fin_ledgeR:\n    table: fin.fin_ledger\n", "utf8");
    await utimes(manifestPath(), before.atime, before.mtime);
    await reconcileMetadata();
    const afterMeta = displayGenerations().D;
    await reconcileFullDigest();
    expect(displayGenerations().D).toBeGreaterThan(afterMeta);
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
});
