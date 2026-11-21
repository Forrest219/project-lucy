import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpsStepName } from "../runtime/ops-step-journal.js";

vi.mock("../catalog-reload.js", () => ({
  readCatalogReloads: vi.fn(async () => {
    throw Object.assign(new Error("catalog reload state unreadable"), { code: "EIO" });
  })
}));

let projectRoot: string;
let previousRoot: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-mcp-runtime-ops-step-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "ktx.yaml"),
    "connections:\n  demo:\n    host: db.example.test\n    schemas: [finance]\n",
    "utf8"
  );
  await writeFile(
    path.join(projectRoot, "webui", "config", "access.yaml"),
    "roles: {}\nusers: []\ndefaults:\n  deny_tools: []\n",
    "utf8"
  );
  previousRoot = process.env.KTX_PROJECT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("readMcpRuntimeStatus diagnostic steps", () => {
  it("records a failed catalog read instead of reporting it as a successful step", async () => {
    const { readMcpRuntimeStatus } = await import("../admin/mcp-runtime.js");
    const { opsStepReasonFromError } = await import("../runtime/ops-step-journal.js");
    const observed: Array<{ step: string; phase: "leave" | "fail"; reasonCode?: string }> = [];
    const result = await readMcpRuntimeStatus(
      async () => ({ status: "reachable", checkedAt: new Date().toISOString() }),
      {
        runStep: async <T>(step: OpsStepName, body: () => Promise<T>): Promise<T> => {
          try {
            const value = await body();
            observed.push({ step, phase: "leave" });
            return value;
          } catch (error) {
            observed.push({ step, phase: "fail", reasonCode: opsStepReasonFromError(error) });
            throw error;
          }
        }
      }
    );
    const catalog = observed.find((entry) => entry.step === "read_catalog_reloads");
    expect(catalog).toEqual({ step: "read_catalog_reloads", phase: "fail", reasonCode: "io_error" });
    expect(result.execution.status).toBeDefined();
  });
});
