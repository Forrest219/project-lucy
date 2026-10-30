// Lucy v0.25 — N30: the release sidecar must be written ATOMICALLY.
//
// The idempotent-replay path reads the release sidecar
// (readSemanticAssetRelease → readSidecar) while the asynchronous reindex
// updates it (updateReleaseRecord is a read-modify-write on the same file).
//
// A plain `writeFile` truncates the sidecar before the new content lands, so a
// reader that arrives in that window parses a half-written file. `JSON.parse`
// then throws a SyntaxError — which is NOT a SemanticAssetValidationError, so
// it escapes the publish route and the replay answers HTTP 500 instead of the
// same release id.
//
// This was Linux-only: on the CI runner the reindex's write landed between the
// replay's read and the parse. On macOS the window was never hit, so the defect
// stayed invisible in local development.
//
// The test drives the window deterministically. The mocked `writeFile`
// truncates its target and then suspends on a gate the test controls, so the
// test can read the real sidecar path while the write is half-done:
//
//  - before the fix the write targets the sidecar itself → the reader sees a
//    truncated file → JSON.parse throws;
//  - after the fix the write targets a temp file and is swapped in by
//    `rename` → the sidecar on disk is still the previous complete file → the
//    reader parses it fine.

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsState = vi.hoisted(() => ({
  /** Suspend every writeFile after it truncated its target. */
  splitWrites: false,
  /** Resolves once a write has truncated its target. */
  truncated: null as null | (() => void),
  /** Released to let the suspended write finish. */
  release: null as null | (() => void),
  /** The paths the module asked to write. */
  written: [] as string[]
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (file: unknown, data: unknown, options?: unknown) => {
      const abs = typeof file === "string" ? file : file instanceof URL ? file.pathname : "";
      if (!fsState.splitWrites) {
        return actual.writeFile(file as never, data as never, options as never);
      }
      fsState.written.push(abs);
      // Truncate first — this is the destructive half of a non-atomic overwrite.
      await actual.writeFile(abs, "", "utf8");
      // Let the test observe the half-written state before the content lands.
      await new Promise<void>((resolve) => {
        fsState.truncated = resolve;
        fsState.release = () => resolve();
      });
      await actual.writeFile(abs, typeof data === "string" ? data : String(data), "utf8");
    }
  };
});

const SIDECAR_RELEASES_REL = ".ktx-ui/semantic-asset-releases.json";

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

const INITIAL_SIDECAR = {
  version: 1,
  records: [{ id: "rel_before", status: "published", createdAt: "2026-10-28T00:00:00.000Z" }]
};

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-sidecar-atomic-"));
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  await writeFile(
    path.join(root, SIDECAR_RELEASES_REL),
    `${JSON.stringify(INITIAL_SIDECAR, null, 2)}\n`,
    "utf8"
  );
  return root;
}

function newRecord(id: string): Parameters<
  NonNullable<typeof import("../semantic-assets").__test>["appendReleaseRecord"]
>[1] {
  return {
    id,
    createdAt: new Date().toISOString(),
    status: "published",
    trigger: "webui_publish",
    files: [],
    changedSources: [],
    diff: { added: [], modified: [], removed: [] },
    validation: { ok: true, results: [] },
    recoveryRequired: false,
    activationStatus: "confirmed"
  } as never;
}

beforeEach(() => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  fsState.splitWrites = false;
  fsState.truncated = null;
  fsState.release = null;
  fsState.written = [];
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("N30 — the release sidecar is written atomically", () => {
  it("the sidecar on disk stays complete while the reindex rewrites it", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";

    vi.resetModules();
    const semanticAssets = await import("../semantic-assets");

    fsState.splitWrites = true;

    // The reindex's read-modify-write, suspended half-way through its write.
    const rewriting = semanticAssets.__test.appendReleaseRecord(projectRoot, newRecord("rel_after"));
    await new Promise<void>((resolve) => {
      const tick = () => (fsState.truncated ? resolve() : setImmediate(tick));
      tick();
    });

    // The write is now suspended: its target has been truncated but not refilled.
    // The sidecar the replay path reads must still be complete JSON.
    const onDisk = await readFile(path.join(projectRoot, SIDECAR_RELEASES_REL), "utf8");
    const parsed = JSON.parse(onDisk) as { version: number; records: Array<{ id: string }> };

    // Before the fix this threw `SyntaxError: Unexpected end of JSON input` and
    // the publish route answered HTTP 500 instead of the replayed release.
    expect(parsed.version).toBe(1);
    expect(parsed.records.map((r) => r.id)).toContain("rel_before");

    // Let the write finish and clean up.
    fsState.release?.();
    await rewriting;
  });

  it("the write targets a temp file that is swapped in, never the sidecar itself", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";

    vi.resetModules();
    const semanticAssets = await import("../semantic-assets");

    fsState.splitWrites = true;
    const rewriting = semanticAssets.__test.appendReleaseRecord(projectRoot, newRecord("rel_after"));
    await new Promise<void>((resolve) => {
      const tick = () => (fsState.truncated ? resolve() : setImmediate(tick));
      tick();
    });

    // The module must NOT have opened the sidecar path for writing.
    const sidecarAbs = path.join(projectRoot, SIDECAR_RELEASES_REL);
    expect(fsState.written).not.toContain(sidecarAbs);
    expect(fsState.written.some((p) => p.includes(".tmp-"))).toBe(true);

    fsState.release?.();
    await rewriting;
  });

  it("the atomic swap leaves no temp file behind", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";

    vi.resetModules();
    const semanticAssets = await import("../semantic-assets");

    await semanticAssets.__test.appendReleaseRecord(projectRoot, newRecord("rel_after"));

    const entries = await readdir(path.join(projectRoot, ".ktx-ui"));
    expect(entries.filter((name) => name.includes(".tmp-"))).toHaveLength(0);
    const raw = await readFile(path.join(projectRoot, SIDECAR_RELEASES_REL), "utf8");
    const parsed = JSON.parse(raw) as { records: Array<{ id: string }> };
    expect(parsed.records.map((r) => r.id)).toContain("rel_after");
  });
});
