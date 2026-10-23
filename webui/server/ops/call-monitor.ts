import type { FastifyInstance } from "fastify";
import { parseCallMonitorRange } from "../../src/lib/callMonitorWindow.js";
import { readCallMonitorSnapshot } from "../proxy/audit.js";

export function registerCallMonitorRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { range?: string; hours?: string; slowMs?: string };
  }>("/api/ops/call-monitor", async (request) => {
    const range = parseCallMonitorRange(request.query.range, request.query.hours);
    const slowMs = Math.max(
      parseInt(
        request.query.slowMs ?? String(process.env.LUCY_OBSERVABILITY_SLOW_MS ?? 30_000),
        10
      ) || 30_000,
      1
    );

    const data = await readCallMonitorSnapshot({ range, slowMs });
    return { ok: true, data };
  });
}
