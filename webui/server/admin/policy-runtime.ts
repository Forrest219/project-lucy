import type { FastifyInstance } from "fastify";
import { getPolicyRuntimeStatus, isPolicyRuntimeHealthy } from "../proxy/acl.js";

/**
 * Spec 98 §8.4 — Admin policy runtime status for degrade banner + health probes.
 */
export function registerPolicyRuntimeRoutes(app: FastifyInstance): void {
  app.get("/api/admin/policy-runtime", async () => {
    const status = getPolicyRuntimeStatus();
    return {
      ok: true,
      data: {
        ...status,
        healthy: isPolicyRuntimeHealthy(status)
      }
    };
  });
}
