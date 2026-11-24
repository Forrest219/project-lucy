import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyOpsStepReadFaultForUat,
  registerOpsStepUatRoutes,
  resetOpsStepUatStateForTests,
  type OpsStepUatDependencies
} from "../admin/ops-step-uat.js";
import { resetOpsStepJournalForTests } from "../runtime/ops-step-journal.js";

const savedUat = process.env.LUCY_OPS_STEP_UAT;
const routes = [
  "/api/admin/ops-step-uat/reset",
  "/api/admin/ops-step-uat/diagnostic",
  "/api/admin/ops-step-uat/sync-section",
  "/api/admin/ops-step-uat/background",
  "/api/admin/ops-step-uat/stdout-failure",
  "/api/admin/ops-step-uat/read-failure",
  "/api/admin/ops-step-uat/console-probe"
];

afterEach(() => {
  if (savedUat === undefined) delete process.env.LUCY_OPS_STEP_UAT;
  else process.env.LUCY_OPS_STEP_UAT = savedUat;
  resetOpsStepUatStateForTests();
  resetOpsStepJournalForTests();
});

function dependencies(): OpsStepUatDependencies {
  return {
    startDiagnostic: vi.fn(() => ({ opId: "ops_0123456789abcdef0123456789abcdef" })),
    setBackgroundEnabled: vi.fn()
  };
}

async function build(enabled: boolean, deps = dependencies()): Promise<FastifyInstance> {
  process.env.LUCY_OPS_STEP_UAT = enabled ? "1" : "0";
  const app = Fastify();
  registerOpsStepUatRoutes(app, deps);
  await app.ready();
  return app;
}

describe("ops step UAT guard", () => {
  it("does not register any guarded route when disabled", async () => {
    const deps = dependencies();
    const app = await build(false, deps);
    for (const url of routes) {
      const response = await app.inject({ method: "POST", url, payload: {} });
      expect(response.statusCode).toBe(404);
    }
    expect(deps.startDiagnostic).not.toHaveBeenCalled();
    await app.close();
  });

  it("starts the selected real diagnostic lifecycle and rejects invalid steps", async () => {
    const deps = dependencies();
    const app = await build(true, deps);
    const accepted = await app.inject({
      method: "POST",
      url: "/api/admin/ops-step-uat/diagnostic",
      payload: { steps: ["read_project", "read_ktx_yaml"], holdMs: 2000, lifecycle: "production" }
    });
    expect(accepted.statusCode).toBe(202);
    expect(deps.startDiagnostic).toHaveBeenCalledWith({
      steps: ["read_project", "read_ktx_yaml"], holdMs: 2000, lifecycle: "production"
    });
    const rejected = await app.inject({
      method: "POST",
      url: "/api/admin/ops-step-uat/diagnostic",
      payload: { steps: ["uat_sync_section"], holdMs: 2000 }
    });
    expect(rejected.statusCode).toBe(400);
    await app.close();
  });

  it("keeps background and stdout controls behind the enabled registration", async () => {
    const deps = dependencies();
    const app = await build(true, deps);
    const background = await app.inject({
      method: "POST", url: "/api/admin/ops-step-uat/background", payload: { enabled: false }
    });
    expect(background.statusCode).toBe(200);
    expect(deps.setBackgroundEnabled).toHaveBeenCalledWith(false);
    for (const mode of ["error", "short"] as const) {
      const response = await app.inject({
        method: "POST", url: "/api/admin/ops-step-uat/stdout-failure", payload: { mode }
      });
      expect(response.statusCode).toBe(200);
    }
    await app.close();
  });

  it("answers the sync-section request before the event loop is blocked", async () => {
    const deps = dependencies();
    const app = await build(true, deps);
    const started = Date.now();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/ops-step-uat/sync-section",
      payload: { holdMs: 2000 }
    });
    expect(response.statusCode).toBe(202);
    expect(Date.now() - started).toBeLessThan(1500);
    await app.close();
  });

  it("applies delay and error once without affecting the default read", async () => {
    process.env.LUCY_OPS_STEP_UAT = "1";
    const deps = dependencies();
    const app = await build(true, deps);
    const delayed = await app.inject({
      method: "POST",
      url: "/api/admin/ops-step-uat/read-failure",
      payload: { mode: "delay", delayMs: 1 }
    });
    expect(delayed.statusCode).toBe(200);
    const delayToken = delayed.json().data.token as string;
    await applyOpsStepReadFaultForUat(delayToken);
    await applyOpsStepReadFaultForUat(delayToken);
    await applyOpsStepReadFaultForUat("wrong-token");

    const failed = await app.inject({
      method: "POST",
      url: "/api/admin/ops-step-uat/read-failure",
      payload: { mode: "error" }
    });
    const errorToken = failed.json().data.token as string;
    await expect(applyOpsStepReadFaultForUat(errorToken)).rejects.toMatchObject({ code: "OPS_STEP_READ_FAILED" });
    await expect(applyOpsStepReadFaultForUat(errorToken)).resolves.toBeUndefined();
    await app.close();
  });
});
