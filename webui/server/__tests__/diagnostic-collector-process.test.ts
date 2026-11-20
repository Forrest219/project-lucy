import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { collectDiagnosticIo } from "../runtime/diagnostic-collector.js";
import { DiagnosticSnapshotService } from "../runtime/diagnostic-snapshot.js";

const savedRoot = process.env.KTX_PROJECT_ROOT;
const savedContent = process.env.LUCY_CONTENT_ROOT;
let root: string;
afterEach(async () => {
  if (savedRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = savedRoot;
  if (savedContent === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = savedContent;
  if (root) await rm(root, { recursive: true, force: true });
});

it("terminates a real FIFO reader at deadline, recovers without releasing the old inode, and closes", async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lucy-diagnostic-cancel-"));
  process.env.KTX_PROJECT_ROOT = root;
  process.env.LUCY_CONTENT_ROOT = ".";
  await mkdir(path.join(root, ".ktx-ui"));
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n");
  const state = path.join(root, ".ktx-ui", "ktx-reload.state.json");
  execFileSync("mkfifo", [state]); // No writer: actual open/read waits in the OS.
  const service = new DiagnosticSnapshotService({
    deadlineMs: 3_000,
    intervalMs: 0,
    collect: (signal) => collectDiagnosticIo(signal, {
      observations: [], ktxRuntime: { ready: true, status: "ready" }
    })
  });
  const start = performance.now();
  service.tickForce();
  for (let i = 0; i < 10; i++) service.tickForce();
  await service.waitUntilIdle();
  expect(performance.now() - start).toBeGreaterThanOrEqual(2_900);
  expect(performance.now() - start).toBeLessThan(5_000);
  expect(service.isCollecting()).toBe(false);
  expect(service.readPublished().diagnostics.freshness).toBe("unknown");

  await rename(state, state + ".old-fifo");
  await writeFile(state, "{}");
  service.tickForce();
  await service.waitUntilIdle();
  expect(service.readPublished().diagnostics.freshness).toBe("fresh");
  const beforeClose = performance.now();
  service.tickForce();
  await service.close();
  expect(performance.now() - beforeClose).toBeLessThan(1_000);
  expect(service.isCollecting()).toBe(false);
  await service.close();
}, 15_000);
