import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../index.js";

const savedUat = process.env.LUCY_OPS_STEP_UAT;

afterEach(() => {
  if (savedUat === undefined) delete process.env.LUCY_OPS_STEP_UAT;
  else process.env.LUCY_OPS_STEP_UAT = savedUat;
});

describe("ops step route registration", () => {
  it("registers the read-only admin route and keeps UAT routes absent by default", async () => {
    delete process.env.LUCY_OPS_STEP_UAT;
    const app = buildServer();
    await app.ready();
    expect(app.hasRoute({ method: "GET", url: "/api/admin/ops-steps" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/api/admin/ops-step-uat/reset" })).toBe(false);
    expect(app.hasRoute({ method: "POST", url: "/api/admin/ops-step-uat/diagnostic" })).toBe(false);
    await app.close();
  });

  it("registers UAT routes only when the guard flag is enabled", async () => {
    process.env.LUCY_OPS_STEP_UAT = "1";
    const app = buildServer();
    await app.ready();
    expect(app.hasRoute({ method: "POST", url: "/api/admin/ops-step-uat/reset" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/api/admin/ops-step-uat/diagnostic" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/api/admin/ops-step-uat/console-probe" })).toBe(true);
    const anonymous = await app.inject({ method: "POST", url: "/api/admin/ops-step-uat/console-probe", payload: {} });
    const anonymousAdmin = await app.inject({ method: "GET", url: "/api/admin/tokens" });
    expect(anonymous.statusCode).toBe(anonymousAdmin.statusCode);
    const isolated = await app.inject({
      method: "POST",
      url: "/api/admin/ops-step-uat/diagnostic",
      payload: { steps: ["read_project"], holdMs: 0, lifecycle: "isolated" }
    });
    expect(isolated.statusCode).toBe(409);
    const reset = await app.inject({ method: "POST", url: "/api/admin/ops-step-uat/reset", payload: {} });
    expect(reset.statusCode).toBe(200);
    await app.close();
  });
});
