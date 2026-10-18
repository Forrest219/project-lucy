import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T9 — `loadDataQaInstructions` must:
 *   1. prefer the project file when present and non-empty;
 *   2. fall back to a configurable mirror path (no hardcoded `/app` in tests);
 *   3. retry on the next call after a read failure (no permanent failure cache);
 *   4. surface availability via `getDataQaInstructionsStatus()` for liveness detail,
 *      without affecting the ACL or denying liveness checks.
 */

let projectRoot: string;
let mirrorRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-dqi-project-"));
  mirrorRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-dqi-mirror-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(mirrorRoot, { recursive: true });
  // `resolveProjectRoot` requires ktx.yaml at the project root.
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  await rm(projectRoot, { recursive: true, force: true });
  await rm(mirrorRoot, { recursive: true, force: true });
  vi.resetModules();
});

const PROJECT_TEXT = "# Project guidance\n\nThe project override applies first.\n";
const MIRROR_TEXT = "# Mirror guidance\n\nBundled default content.\n";

async function importLoader() {
  // Re-import so module-level cache resets between tests.
  const mcp = await import("../proxy/mcp-proxy");
  // Point the bundled mirror at the test fixture (do not bind tests to /app).
  mcp.setDataQaInstructionsMirrorPath(path.join(mirrorRoot, "data-qa-instructions.md"));
  // Reset the cache because the mirror path changed.
  mcp.invalidateDataQaInstructionsCache();
  return mcp;
}

describe("T9 data-qa-instructions loader", () => {
  it("prefers the project file when present and non-empty", async () => {
    await writeFile(path.join(projectRoot, "webui", "config", "data-qa-instructions.md"), PROJECT_TEXT, "utf8");
    await writeFile(path.join(mirrorRoot, "data-qa-instructions.md"), MIRROR_TEXT, "utf8");

    const mcp = await importLoader();
    const text = await mcp.loadDataQaInstructions();
    expect(text).toBe(PROJECT_TEXT.trim());
    const status = mcp.getDataQaInstructionsStatus();
    expect(status.source).toBe("project");
    expect(status.lastError).toBeNull();
    expect(status.length).toBe(PROJECT_TEXT.trim().length);
    expect(status.loadedAt).not.toBeNull();
  });

  it("falls back to the mirror path when the project file is missing", async () => {
    await writeFile(path.join(mirrorRoot, "data-qa-instructions.md"), MIRROR_TEXT, "utf8");

    const mcp = await importLoader();
    const before = mcp.getDataQaInstructionsStatus();
    expect(before.loadedAt).toBeNull();
    const text = await mcp.loadDataQaInstructions();
    expect(text).toBe(MIRROR_TEXT.trim());
    const after = mcp.getDataQaInstructionsStatus();
    expect(after.source).toBe("mirror");
    expect(after.length).toBe(MIRROR_TEXT.trim().length);
    expect(after.loadedAt).not.toBeNull();
  });

  it("retries after a missing-file failure: project file appears, next call picks it up", async () => {
    await writeFile(path.join(mirrorRoot, "data-qa-instructions.md"), MIRROR_TEXT, "utf8");

    const mcp = await importLoader();
    // First: no project file → mirror.
    const first = await mcp.loadDataQaInstructions();
    expect(first).toBe(MIRROR_TEXT.trim());
    expect(mcp.getDataQaInstructionsStatus().source).toBe("mirror");

    // Now drop a project file and invalidate the cache.
    await writeFile(path.join(projectRoot, "webui", "config", "data-qa-instructions.md"), PROJECT_TEXT, "utf8");
    mcp.invalidateDataQaInstructionsCache();
    const second = await mcp.loadDataQaInstructions();
    expect(second).toBe(PROJECT_TEXT.trim());
    expect(mcp.getDataQaInstructionsStatus().source).toBe("project");
  });

  it("does not permanently cache a read failure: next call retries the project file", async () => {
    // Make the project path a directory so readFile fails with EISDIR.
    const projectFilePath = path.join(projectRoot, "webui", "config", "data-qa-instructions.md");
    await mkdir(projectFilePath, { recursive: true });
    await writeFile(path.join(mirrorRoot, "data-qa-instructions.md"), MIRROR_TEXT, "utf8");

    const mcp = await importLoader();
    const first = await mcp.loadDataQaInstructions();
    expect(first).toBe(MIRROR_TEXT.trim());
    expect(mcp.getDataQaInstructionsStatus().source).toBe("mirror");
    expect(mcp.getDataQaInstructionsStatus().lastError).not.toBeNull();

    // Replace the bad path with a real file and invalidate; the next call must
    // retry, not return the previously cached fallback.
    await rm(projectFilePath, { recursive: true, force: true });
    await writeFile(projectFilePath, PROJECT_TEXT, "utf8");
    mcp.invalidateDataQaInstructionsCache();
    const second = await mcp.loadDataQaInstructions();
    expect(second).toBe(PROJECT_TEXT.trim());
    expect(mcp.getDataQaInstructionsStatus().source).toBe("project");
  });

  it("returns undefined and surfaces the failure when both project and mirror are unreadable", async () => {
    const mcp = await importLoader();
    const text = await mcp.loadDataQaInstructions();
    expect(text).toBeUndefined();
    const status = mcp.getDataQaInstructionsStatus();
    expect(status.source).toBe("missing");
    expect(status.length).toBe(0);
    expect(status.lastError).not.toBeNull();
    expect(status.loadedAt).toBeNull();
  });

  it("rejects an empty project file and falls through to the mirror", async () => {
    await writeFile(path.join(projectRoot, "webui", "config", "data-qa-instructions.md"), "   \n", "utf8");
    await writeFile(path.join(mirrorRoot, "data-qa-instructions.md"), MIRROR_TEXT, "utf8");

    const mcp = await importLoader();
    const text = await mcp.loadDataQaInstructions();
    expect(text).toBe(MIRROR_TEXT.trim());
    expect(mcp.getDataQaInstructionsStatus().source).toBe("mirror");
  });
});
