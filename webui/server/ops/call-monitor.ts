import type { FastifyInstance } from "fastify";
import {
  readCallMonitorSnapshot,
  type CallMonitorRange
} from "../proxy/audit.js";

function parseRange(raw: string | undefined): CallMonitorRange {
  return raw === "1h" ? "1h" : "24h";
}

export function registerCallMonitorRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { range?: string; hours?: string; slowMs?: string };
  }>("/api/ops/call-monitor", async (request) => {
    const range = parseRange(request.query.range);
    const hoursFromQuery = request.query.hours
      ? Math.min(Math.max(parseInt(request.query.hours, 10) || (range === "1h" ? 1 : 24), 1), 24 * 90)
      : range === "1h"
        ? 1
        : 24;
    const slowMs = Math.max(
      parseInt(
        request.query.slowMs ?? String(process.env.LUCY_OBSERVABILITY_SLOW_MS ?? 30_000),
        10
      ) || 30_000,
      1
    );

    const data = await readCallMonitorSnapshot({
      range,
      hours: hoursFromQuery,
      slowMs
    });

    return { ok: true, data };
  });
}
