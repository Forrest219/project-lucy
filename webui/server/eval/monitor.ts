import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { resolveProjectRoot } from "../project.js";
import { safeWrite } from "../fs-safe.js";
import { getEvalDb } from "./db.js";

export type MonitorThreshold = {
  domain: string;
  minPassRate: number;
};

export type MonitorConfig = {
  domains: Record<string, {
    passRateYellow: number;
    passRateRed: number;
    consecutiveFailThreshold: number;
  }>;
};

const CONFIG_REL = ".ktx-ui/eval/monitor-config.json";

async function readMonitorConfig(projectRoot: string): Promise<MonitorConfig> {
  const absPath = path.join(projectRoot, CONFIG_REL);
  try {
    const text = await readFile(absPath, "utf8");
    return JSON.parse(text) as MonitorConfig;
  } catch {
    return { domains: {} };
  }
}

async function writeMonitorConfig(projectRoot: string, config: MonitorConfig): Promise<void> {
  await safeWrite(projectRoot, CONFIG_REL, JSON.stringify(config, null, 2));
}

export function registerMonitorRoutes(app: FastifyInstance) {
  // GET /api/eval/monitor/trend
  app.get<{
    Querystring: { domain?: string; days?: string };
  }>("/api/eval/monitor/trend", async (request) => {
    const db = await getEvalDb();
    const projectRoot = await resolveProjectRoot();
    const { domain, days: daysStr = "30" } = request.query;
    const days = Math.min(parseInt(daysStr, 10) || 30, 365);
    const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

    const config = await readMonitorConfig(projectRoot);

    let rows: Array<{ date: string; pass_count: number; fail_count: number; runs: number; lowest_pass_rate: number }>;
    if (domain) {
      rows = db.prepare(`
        SELECT DATE(started_at) AS date,
               SUM(pass_count)  AS pass_count,
               SUM(fail_count)  AS fail_count,
               COUNT(*)         AS runs,
               MIN(CASE WHEN total_cases > 0 THEN CAST(pass_count AS REAL) / total_cases ELSE 0 END) AS lowest_pass_rate
        FROM eval_run
        WHERE domain = ? AND DATE(started_at) >= ? AND status = 'succeeded'
        GROUP BY DATE(started_at)
        ORDER BY date ASC
      `).all(domain, since) as typeof rows;
    } else {
      rows = db.prepare(`
        SELECT DATE(started_at) AS date,
               SUM(pass_count)  AS pass_count,
               SUM(fail_count)  AS fail_count,
               COUNT(*)         AS runs,
               MIN(CASE WHEN total_cases > 0 THEN CAST(pass_count AS REAL) / total_cases ELSE 0 END) AS lowest_pass_rate
        FROM eval_run
        WHERE DATE(started_at) >= ? AND status = 'succeeded'
        GROUP BY DATE(started_at)
        ORDER BY date ASC
      `).all(since) as typeof rows;
    }

    const points = rows.map((r) => {
      const total = r.pass_count + r.fail_count;
      return {
        date: r.date,
        passRate: total > 0 ? r.pass_count / total : 0,
        runs: r.runs,
        lowestPassRate: r.lowest_pass_rate,
        totalRuns: r.runs
      };
    });

    const domainConfig = domain ? config.domains[domain] : undefined;
    const thresholds = {
      yellow: domainConfig?.passRateYellow ?? 0.9,
      red: domainConfig?.passRateRed ?? 0.8
    };

    return { ok: true, data: { points, thresholds } };
  });

  // GET /api/eval/monitor/top-failures
  app.get<{
    Querystring: { domain?: string; days?: string; limit?: string };
  }>("/api/eval/monitor/top-failures", async (request) => {
    const db = await getEvalDb();
    const { domain, days: daysStr = "30", limit: limitStr = "10" } = request.query;
    const days = parseInt(daysStr, 10) || 30;
    const limit = parseInt(limitStr, 10) || 10;
    const since = new Date(Date.now() - days * 86400_000).toISOString();

    let rows: Array<{ case_id: string; fail_count: number; last_fail_at: string }>;
    if (domain) {
      rows = db.prepare(`
        SELECT erc.case_id,
               COUNT(*) AS fail_count,
               MAX(er.started_at) AS last_fail_at
        FROM eval_run_case erc
        JOIN eval_run er ON er.id = erc.run_id
        WHERE erc.status = 'FAIL' AND er.domain = ? AND er.started_at >= ?
        GROUP BY erc.case_id
        ORDER BY fail_count DESC
        LIMIT ?
      `).all(domain, since, limit) as typeof rows;
    } else {
      rows = db.prepare(`
        SELECT erc.case_id,
               COUNT(*) AS fail_count,
               MAX(er.started_at) AS last_fail_at
        FROM eval_run_case erc
        JOIN eval_run er ON er.id = erc.run_id
        WHERE erc.status = 'FAIL' AND er.started_at >= ?
        GROUP BY erc.case_id
        ORDER BY fail_count DESC
        LIMIT ?
      `).all(since, limit) as typeof rows;
    }

    const items = rows.map((r) => ({
      caseId: r.case_id,
      failCount: r.fail_count,
      lastFailAt: r.last_fail_at
    }));

    return { ok: true, data: { items } };
  });

  // GET /api/eval/monitor/drift-distribution
  app.get<{
    Querystring: { domain?: string; days?: string };
  }>("/api/eval/monitor/drift-distribution", async (request) => {
    const db = await getEvalDb();
    const { domain, days: daysStr = "7" } = request.query;
    const days = parseInt(daysStr, 10) || 7;
    const since = new Date(Date.now() - days * 86400_000).toISOString();

    let rows: Array<{ drift: string | null; count: number }>;
    if (domain) {
      rows = db.prepare(`
        SELECT COALESCE(erc.drift, CASE WHEN erc.status = 'PASS' THEN 'pass' ELSE 'data_drift' END) AS drift,
               COUNT(*) AS count
        FROM eval_run_case erc
        JOIN eval_run er ON er.id = erc.run_id
        WHERE er.domain = ? AND er.started_at >= ? AND er.status = 'succeeded'
        GROUP BY COALESCE(erc.drift, CASE WHEN erc.status = 'PASS' THEN 'pass' ELSE 'data_drift' END)
        ORDER BY count DESC
      `).all(domain, since) as typeof rows;
    } else {
      rows = db.prepare(`
        SELECT COALESCE(erc.drift, CASE WHEN erc.status = 'PASS' THEN 'pass' ELSE 'data_drift' END) AS drift,
               COUNT(*) AS count
        FROM eval_run_case erc
        JOIN eval_run er ON er.id = erc.run_id
        WHERE er.started_at >= ? AND er.status = 'succeeded'
        GROUP BY COALESCE(erc.drift, CASE WHEN erc.status = 'PASS' THEN 'pass' ELSE 'data_drift' END)
        ORDER BY count DESC
      `).all(since) as typeof rows;
    }

    return {
      ok: true,
      data: {
        items: rows.map((row) => ({
          drift: row.drift ?? "data_drift",
          count: row.count
        }))
      }
    };
  });

  // GET /api/eval/monitor/config
  app.get("/api/eval/monitor/config", async () => {
    const projectRoot = await resolveProjectRoot();
    const config = await readMonitorConfig(projectRoot);
    return { ok: true, data: { config } };
  });

  // PUT /api/eval/monitor/config
  app.put<{
    Body: { config: MonitorConfig };
  }>("/api/eval/monitor/config", async (request) => {
    const projectRoot = await resolveProjectRoot();
    await writeMonitorConfig(projectRoot, request.body.config);
    return { ok: true, data: { written: true } };
  });

  // GET /api/eval/monitor/threshold (simple single-domain helper)
  app.get<{ Querystring: { domain?: string } }>("/api/eval/monitor/threshold", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const config = await readMonitorConfig(projectRoot);
    const domain = request.query.domain ?? "";
    const domainConfig = config.domains[domain];
    const threshold: MonitorThreshold = {
      domain,
      minPassRate: domainConfig?.passRateRed ?? 0.8
    };
    return { ok: true, data: { threshold } };
  });

  // PUT /api/eval/monitor/threshold
  app.put<{
    Body: MonitorThreshold;
  }>("/api/eval/monitor/threshold", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const config = await readMonitorConfig(projectRoot);
    const { domain, minPassRate } = request.body;
    config.domains[domain] = {
      passRateYellow: minPassRate,
      passRateRed: Math.max(0, minPassRate - 0.1),
      consecutiveFailThreshold: config.domains[domain]?.consecutiveFailThreshold ?? 3
    };
    await writeMonitorConfig(projectRoot, config);
    return { ok: true, data: { written: true } };
  });
}
