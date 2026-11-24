/**
 * REQ-030-052 / P1-31 — page-by-page event-loop sweep (read-only).
 *
 *   npm run sweep:event-loop            # prepare (docker cp + vite build) + measure
 *   SWEEP_GATE=1 npm run sweep:event-loop   # exit 1 on regression vs page-event-loop-sweep.baseline.json
 *   SWEEP_STRICT=1 SWEEP_GATE=1 ...         # also exit 1 while tracked findings remain
 *   SWEEP_CONTAINER=compose-lucy-1 SWEEP_WORK=/tmp/lucy-sweep SWEEP_KEEP=1   # prepare knobs
 *
 * Layer 1: every registered GET route, sequential samples + hammered with a
 *          concurrent `/api/livez` poller.
 * Layer 2: every WebUI page loaded in Chromium; records the `/api/*` calls the
 *          page actually makes and `/api/livez` latency during the load.
 * Only GET requests. Uses a copied project root, never the live demo volume.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { chromium } from "@playwright/test";
import { fork, execFileSync, type ChildProcess } from "node:child_process";
import { AUDIT_SCALE } from "../tests/performance/fixtures/audit-scale-fixture.ts";

const WORK = process.env.SWEEP_WORK ?? "/tmp/lucy-sweep";
const ROOT = process.env.SWEEP_ROOT ?? path.join(WORK, "root");
const DIST = process.env.SWEEP_DIST ?? path.join(WORK, "dist");
const CONTAINER = process.env.SWEEP_CONTAINER ?? "compose-lucy-1";
const GATE = process.env.SWEEP_GATE === "1";
const STRICT = process.env.SWEEP_STRICT === "1";
const BASELINE_FILE = process.env.SWEEP_BASELINE ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "page-event-loop-sweep.baseline.json");
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../inbox");
const HAMMER_MS = Number(process.env.SWEEP_HAMMER_MS ?? 5000);
const SLOW_SEQ_MS = 40;
const HEAVY_MS = 5000;
const HEAVY_TIMEOUT_MS = 300_000;
const REQ_TIMEOUT_MS = 30_000;
const LIVEZ_P99_BAR = 400;
const LIVEZ_MAX_BAR = 1000;
const ROUTE_P95_BAR = 3000;

const EXTRA_QUERY: Array<[RegExp, (ids: Ids) => string]> = [
  [/audit\/query-artifacts$/, () => "requestId=scale-1"],
  [/row-policy\/views\/table$/, (i) => `connectionId=${i.conn}&schema=${i.schema}&sourceName=${i.table}`],
  [/trace\/events$/, () => "turnId=reported-0"],
  [/live-tables$|table-structure-diff$|table-diff$|live-schemas$/, (i) => `schema=${i.schema}`]
];
const ONLY = process.env.SWEEP_ONLY ? new RegExp(process.env.SWEEP_ONLY) : null;
const ONLY_PAGES = process.env.SWEEP_ONLY_PAGES ? new RegExp(process.env.SWEEP_ONLY_PAGES) : null;
const OUT_NAME = process.env.SWEEP_OUT ?? "page-event-loop-sweep.json";
const RESEED = process.env.SWEEP_RESEED !== "0";

const SKIP_ROUTE = /oidc\/callback|\/stream$|\/auth\//;

type Req = { status: number; ms: number; bytes: number; busy: boolean; timedOut: boolean; connError?: boolean; sqlVars?: boolean };

function pct(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

async function get(base: string, url: string, timeoutMs = REQ_TIMEOUT_MS): Promise<Req> {
  const started = performance.now();
  try {
    const res = await fetch(base + url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    return { status: res.status, ms: performance.now() - started, bytes: text.length, busy: text.includes("DISPLAY_SNAPSHOT_BUSY"), timedOut: false, sqlVars: res.status !== 200 && text.includes("too many SQL variables") };
  } catch (error) {
    const timedOut = (error as Error)?.name === "TimeoutError";
    return { status: 0, ms: performance.now() - started, bytes: 0, busy: false, timedOut, connError: !timedOut };
  }
}

/** Polls /api/livez until `stop()` resolves. */
function pollLivez(base: string): { stop: () => Promise<number[]> } {
  const samples: number[] = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      samples.push((await get(base, "/api/livez")).ms);
      await new Promise((r) => setTimeout(r, 10));
    }
  })();
  return { stop: async () => { running = false; await loop; return samples; } };
}

async function prepareRoot(): Promise<void> {
  const accessPath = path.join(ROOT, "webui/config/access.yaml");
  const access = parse(await readFile(accessPath, "utf8")) as { users: Array<Record<string, unknown>> } & Record<string, unknown>;
  const existing = new Set(access.users.map((u) => String(u.id)));
  for (let i = 0; i < AUDIT_SCALE.users; i += 1) {
    const id = `scale-user-${String(i).padStart(2, "0")}`;
    if (existing.has(id)) continue;
    access.users.push({
      id, name: `Scale ${i}`, enabled: true, role: "demo_readonly",
      tokens: [{ hash: `sha256:${i.toString(16).padStart(64, "0")}`, label: `t${i}`, created: "2026-06-21" }]
    });
  }
  await writeFile(accessPath, stringify(access), "utf8");
}


type Server = { base: string; child: ChildProcess; exited?: string; peakRssMb: number; routes: string[] };
let server: Server | undefined;

function rssMb(pid: number): number {
  try { return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim()) / 1024; } catch { return 0; }
}

async function startServer(seed: boolean): Promise<Server> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const child = fork(path.join(here, "page-event-loop-sweep-server.mts"), [], {
    execArgv: ["--import", "tsx"],
    env: { ...process.env, SWEEP_SEED: seed ? "1" : "0", SWEEP_SEED_UI: seed ? (process.env.SWEEP_SEED_UI ?? "1") : "0" },
    stdio: ["ignore", "ignore", "ignore", "ipc"]
  });
  const entry: Server = { base: "", child, peakRssMb: 0, routes: [] };
  child.on("exit", (code, signal) => { entry.exited = signal ? `signal ${signal}` : `exit ${code}`; });
  entry.base = await new Promise<string>((resolve, reject) => {
    child.on("message", (m) => {
      const msg = m as { ready?: string; routes?: string[] };
      if (!msg.ready) return;
      entry.routes = msg.routes ?? [];
      resolve(msg.ready);
    });
    child.on("exit", () => reject(new Error("server exited before ready")));
  });
  return entry;
}

async function ensureServer(): Promise<Server> {
  if (!server || server.exited) server = await startServer(false);
  return server;
}

function watchRss(entry: Server): () => number {
  const timer = setInterval(() => { if (entry.child.pid) entry.peakRssMb = Math.max(entry.peakRssMb, rssMb(entry.child.pid)); }, 250);
  return () => { clearInterval(timer); return Math.round(entry.peakRssMb); };
}

type Ids = Record<string, string | undefined>;

async function discoverIds(base: string): Promise<Ids> {
  const j = async (u: string) => { try { return (await (await fetch(base + u)).json()) as any; } catch { return null; } };
  const ids: Ids = { userId: "scale-user-00", roleId: "demo_readonly", turnId: "reported-0" };
  const sources = await j("/api/sources");
  const t0 = sources?.data?.tables?.[0];
  if (t0) { ids.conn = t0.conn; ids.schema = t0.schema; ids.table = t0.table; }
  const conns = await j("/api/connections");
  const c0 = (conns?.data?.connections ?? conns?.data ?? [])[0];
  ids.connId = c0?.id ?? c0?.connectionId ?? ids.conn;
  ids.conn ??= ids.connId;
  const domains = await j("/api/eval/domains");
  const d0 = (domains?.data?.domains ?? domains?.data ?? [])[0];
  ids.domain = typeof d0 === "string" ? d0 : d0?.domain ?? d0?.id;
  if (ids.domain) {
    const cases = await j(`/api/eval/cases/${encodeURIComponent(ids.domain)}`);
    const k0 = (cases?.data?.cases ?? cases?.data ?? [])[0];
    ids.caseId = k0?.id ?? k0?.caseId;
  }
  const runs = await j("/api/eval/runs");
  const r0 = (runs?.data?.runs ?? [])[0];
  ids.runId = r0?.id ?? r0?.runId;
  const wiki = await j("/api/wiki");
  ids.key = wiki?.data?.pages?.[0]?.key;
  const skills = await j("/api/skills");
  const s0 = skills?.skills?.[0];
  if (s0) { ids.skillDomain = s0.domain; ids.skillName = s0.name; }
  ids.id = "1";
  return ids;
}

function fillParams(route: string, ids: Ids): string | null {
  let missing = false;
  const out = route.split("|")[0].replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    const map: Record<string, string | undefined> = {
      userId: ids.userId, roleId: ids.roleId, turnId: ids.turnId, conn: ids.conn, connId: ids.connId, connectionId: ids.connId,
      schema: ids.schema, table: ids.table, domain: ids.domain, caseId: ids.caseId, runId: ids.runId, key: ids.key, id: ids.id
    };
    if (/skills\/:domain\/:name/.test(route) || route.includes("/skills/")) { map.domain = ids.skillDomain; map.name = ids.skillName; }
    const v = map[name];
    if (v === undefined) missing = true;
    return encodeURIComponent(v ?? "x");
  });
  return missing ? null : out;
}

type RouteRow = {
  route: string; url: string | null; status: number[]; seqMs: number[]; seqMaxMs: number;
  hammered: boolean; underLoadP95Ms?: number; livezMaxMs?: number; livezP99Ms?: number; busy: number;
  peakRssMb?: number; flaky?: boolean; verdict: string;
};

const blank = (route: string, verdict: string): RouteRow => ({ route, url: null, status: [], seqMs: [], seqMaxMs: 0, hammered: false, busy: 0, verdict });


const livezOver = (p99: number | undefined, max: number | undefined) => (p99 ?? 0) > LIVEZ_P99_BAR || (max ?? 0) > LIVEZ_MAX_BAR;

/** 5 seconds of 2 concurrent clients on one URL while a poller times `/api/livez`. */
async function hammer(srv: Server, url: string): Promise<{ underLoadP95Ms: number; livezMaxMs: number; livezP99Ms: number; busyCount: number }> {
  const poller = pollLivez(srv.base);
  const deadline = Date.now() + HAMMER_MS;
  const loadSamples: Req[] = [];
  await Promise.all([0, 1].map(async () => { while (Date.now() < deadline && !srv.exited) { const r = await get(srv.base, url); loadSamples.push(r); if (r.timedOut) break; } }));
  const livez = await poller.stop();
  return {
    underLoadP95Ms: Math.round(pct(loadSamples.map((x) => x.ms), 95)),
    livezMaxMs: Math.round(Math.max(0, ...livez)),
    livezP99Ms: Math.round(pct(livez, 99)),
    busyCount: loadSamples.filter((x) => x.busy).length
  };
}

async function loadTracked(): Promise<Set<string>> {
  try { return new Set(Object.keys((JSON.parse(await readFile(BASELINE_FILE, "utf8")) as Baseline).tracked)); } catch { return new Set(); }
}

async function sweepRoutes(ids: Ids): Promise<RouteRow[]> {
  const tracked = await loadTracked();
  const routes = (await ensureServer()).routes.map((r) => r.replace(/:connId\|:connectionId/, ":connId"));
  const query = "hours=168&range=7d&days=30&source=all";
  const rows: RouteRow[] = [];
  for (const route of routes) {
    if (ONLY && !ONLY.test(route)) continue;
    if (SKIP_ROUTE.test(route)) { rows.push(blank(route, "SKIP(excluded)")); continue; }
    const filled = fillParams(route, ids);
    if (!filled) { rows.push(blank(route, "NOT MEASURED(no fixture id)")); continue; }
    const srv = await ensureServer();
    const stopRss = watchRss(srv);
    const extra = EXTRA_QUERY.filter(([re]) => re.test(route)).map(([, f]) => f(ids)).join("&");
    const url = `${filled}${filled.includes("?") ? "&" : "?"}${query}${extra ? `&${extra}` : ""}`;
    const warmPoller = pollLivez(srv.base);
    const warm = await get(srv.base, url, HEAVY_TIMEOUT_MS);
    const warmLivez = await warmPoller.stop();
    if (warm.status === 200 && warm.ms > HEAVY_MS && !srv.exited) {
      const row: RouteRow = {
        route, url: filled, status: [warm.status], seqMs: [Math.round(warm.ms)], seqMaxMs: Math.round(warm.ms), hammered: false, busy: warm.busy ? 1 : 0,
        livezMaxMs: Math.round(Math.max(0, ...warmLivez)), livezP99Ms: Math.round(pct(warmLivez, 99)), peakRssMb: stopRss(), verdict: ""
      };
      row.verdict = "OVER(route+livez; single sample, heavy)";
      rows.push(row);
      process.stdout.write(`${row.verdict.padEnd(30)} ${String(row.seqMaxMs).padStart(6)}ms rss ${row.peakRssMb}MB livez(during) p99 ${row.livezP99Ms} max ${row.livezMaxMs} n=${warmLivez.length}  ${route}\n`);
      continue;
    }
    const seq: Req[] = [];
    for (let i = 0; i < 5 && !srv.exited; i += 1) {
      const r = await get(srv.base, url);
      seq.push(r);
      if (r.timedOut) break;
    }
    const row: RouteRow = {
      route, url: filled, status: seq.map((s) => s.status), seqMs: seq.map((s) => Math.round(s.ms)),
      seqMaxMs: Math.round(Math.max(0, ...seq.map((s) => s.ms))), hammered: false, busy: seq.filter((s) => s.busy).length, verdict: ""
    };
    const ok = seq.length === 5 && seq.every((s) => s.status === 200);
    if (ok && row.seqMaxMs >= SLOW_SEQ_MS && !srv.exited) {
      row.hammered = true;
      const { busyCount, ...first } = await hammer(srv, url);
      Object.assign(row, first);
      row.busy += busyCount;
      // A route that is not already registered must stay over the bar twice in a row; one noisy 5s window is not a regression.
      if (livezOver(row.livezP99Ms, row.livezMaxMs) && !tracked.has(route) && !srv.exited) {
        const { busyCount: busy2, ...second } = await hammer(srv, url);
        if (!livezOver(second.livezP99Ms, second.livezMaxMs)) { Object.assign(row, second); row.busy += busy2; row.flaky = true; }
      }
    }
    row.peakRssMb = stopRss();
    const st = new Set(row.status);
    if (srv.exited) row.verdict = `FAIL(server died: ${srv.exited}; peak RSS ${row.peakRssMb}MB)`;
    else if (seq.some((s) => s.timedOut)) { row.verdict = `FAIL(timeout ${REQ_TIMEOUT_MS / 1000}s)`; srv.child.kill("SIGKILL"); }
    else if (seq.some((s) => s.sqlVars)) row.verdict = "FAIL(too many SQL variables)"; // functional defect at scale, not a fixture gap
    else if ([...st].some((s) => s >= 500)) row.verdict = "FAIL(5xx)";
    else if (!ok) row.verdict = `NOT MEASURED(HTTP ${[...st].join("/")})`;
    else if (row.busy > 0) row.verdict = "FAIL(DISPLAY_SNAPSHOT_BUSY)";
    else if (livezOver(row.livezP99Ms, row.livezMaxMs)) row.verdict = "OVER(livez)";
    else if (row.seqMaxMs > ROUTE_P95_BAR) row.verdict = "OVER(route)";
    else row.verdict = row.flaky ? "OK(flaky: re-measured under bar)" : "OK";
    rows.push(row);
    process.stdout.write(`${row.verdict.padEnd(30)} ${String(row.seqMaxMs).padStart(6)}ms rss ${row.peakRssMb}MB ${row.hammered ? `livez p99 ${row.livezP99Ms} max ${row.livezMaxMs}` : ""}  ${route}\n`);
  }
  return rows;
}

type PageRow = {
  page: string; url: string | null; apiCalls: number; apiBad: string[]; slowestApi?: { path: string; ms: number };
  sumApiMs: number; livezMaxMs: number; livezP99Ms: number; livezN?: number; noKtx?: boolean; errorBanner: boolean; verdict: string;
};

function pageList(ids: Ids): Array<[string, string | null]> {
  const need = (p: string, ...k: Array<string | undefined>) => (k.every(Boolean) ? p : null);
  const e = encodeURIComponent;
  return [
    ["/overview", "/overview"], ["/ops/calls", "/ops/calls"], ["/connections", "/connections"],
    ["/connections/enabled-tables", "/connections/enabled-tables"], ["/connections/test", "/connections/test"],
    ["/catalog", "/catalog"],
    ["/catalog/:conn/:schema/:table", need(`/catalog/${e(ids.conn ?? "")}/${e(ids.schema ?? "")}/${e(ids.table ?? "")}`, ids.conn, ids.schema, ids.table)],
    ["/joins/:conn/:schema/:table", need(`/joins/${e(ids.conn ?? "")}/${e(ids.schema ?? "")}/${e(ids.table ?? "")}`, ids.conn, ids.schema, ids.table)],
    ["/publish/workbench", "/publish/workbench"], ["/publish/history", "/publish/history"],
    ["/wiki", "/wiki"], ["/skills", "/skills"],
    ["/admin/usage", "/admin/usage"], ["/admin/agents", "/admin/agents"],
    ["/admin/agents/:userId", `/admin/agents/${e(ids.userId ?? "")}`],
    ["/admin/agents/:userId/tokens/new", `/admin/agents/${e(ids.userId ?? "")}/tokens/new`],
    ["/admin/tokens", "/admin/tokens"], ["/admin/tokens/new", "/admin/tokens/new"],
    ["/admin/roles", "/admin/roles"], ["/admin/roles/new", "/admin/roles/new"],
    ["/admin/roles/:roleId", `/admin/roles/${e(ids.roleId ?? "")}`],
    ["/admin/row-policies", "/admin/row-policies"], ["/admin/row-policy-templates", "/admin/row-policy-templates"],
    ["/admin/access-map", "/admin/access-map"], ["/admin/authorization-summary", "/admin/authorization-summary"],
    ["/admin/audit?range=7d", "/admin/audit?range=7d"], ["/admin/audit-reconciliation", "/admin/audit-reconciliation"],
    ["/admin/audit-sources", "/admin/audit-sources"], ["/admin/mcp-playground", "/admin/mcp-playground"],
    ["/admin/config-audit", "/admin/config-audit"], ["/admin/branding", "/admin/branding"],
    ["/admin/accounts", "/admin/accounts"], ["/admin/version", "/admin/version"],
    ["/eval/cases", "/eval/cases"], ["/eval/cases/:domain", need(`/eval/cases/${e(ids.domain ?? "")}`, ids.domain)],
    ["/eval/cases/:domain/new", need(`/eval/cases/${e(ids.domain ?? "")}/new`, ids.domain)],
    ["/eval/cases/:domain/:caseId", need(`/eval/cases/${e(ids.domain ?? "")}/${e(ids.caseId ?? "")}`, ids.domain, ids.caseId)],
    ["/eval/runs", "/eval/runs"], ["/eval/runs/:runId", need(`/eval/runs/${e(ids.runId ?? "")}`, ids.runId)],
    ["/eval/monitor", "/eval/monitor"], ["/eval/field-questions", "/eval/field-questions"],
    ["/eval/security-candidates", "/eval/security-candidates"], ["/help", "/help"]
  ];
}

async function sweepPages(ids: Ids): Promise<PageRow[]> {
  const browser = await chromium.launch();
  const rows: PageRow[] = [];
  try {
    for (const [name, url] of pageList(ids)) {
      if (ONLY_PAGES && !ONLY_PAGES.test(name)) continue;
      if (!url) { rows.push({ page: name, url: null, apiCalls: 0, apiBad: [], sumApiMs: 0, livezMaxMs: 0, livezP99Ms: 0, errorBanner: false, verdict: "NOT MEASURED(no fixture id)" }); continue; }
      const srv = await ensureServer();
      const base = srv.base;
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const starts = new Map<unknown, number>();
      const calls: Array<{ path: string; ms: number; status: number; ktxMissing?: boolean }> = [];
      page.on("request", (r) => { if (r.url().includes("/api/")) starts.set(r, performance.now()); });
      page.on("requestfinished", async (r) => {
        const s = starts.get(r); if (s === undefined) return;
        const res = await r.response().catch(() => null);
        const status = res?.status() ?? 0;
        const ktxMissing = status >= 500 ? /ktx CLI was not found/.test(await res!.text().catch(() => "")) : false;
        calls.push({ path: new URL(r.url()).pathname + (new URL(r.url()).search ? "?…" : ""), ms: performance.now() - s, status, ktxMissing });
      });
      page.on("requestfailed", (r) => { const s = starts.get(r); if (s !== undefined) calls.push({ path: new URL(r.url()).pathname, ms: performance.now() - s, status: 0 }); });
      const poller = pollLivez(base);
      try { await page.goto(base + url, { waitUntil: "networkidle", timeout: 60_000 }); await page.waitForTimeout(1200); } catch { /* recorded via verdict */ }
      const livez = await poller.stop();
      const body = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
      const apis = calls.filter((c) => !/\/api\/(livez|auth\/|branding)/.test(c.path));
      const bad = [...new Set(apis.filter((c) => c.status === 0 || c.status >= 400).map((c) => `${c.status} ${c.path}`))];
      const slowest = apis.reduce<{ path: string; ms: number } | undefined>((m, c) => (!m || c.ms > m.ms ? { path: c.path, ms: Math.round(c.ms) } : m), undefined);
      const row: PageRow = {
        page: name, url, apiCalls: apis.length, apiBad: bad, slowestApi: slowest,
        sumApiMs: Math.round(apis.reduce((a, c) => a + c.ms, 0)), livezMaxMs: Math.round(Math.max(0, ...livez)), livezP99Ms: Math.round(pct(livez, 99)), livezN: livez.length,
        noKtx: apis.some((c) => c.ktxMissing),
        errorBanner: /暂时无法完成刷新|DISPLAY_SNAPSHOT_BUSY/.test(body), verdict: ""
      };
      if (srv.exited) { row.verdict = `FAIL(server died: ${srv.exited})`; }
      else if (row.errorBanner) row.verdict = "FAIL(banner)";
      // A page load yields few livez samples; p99 of <200 samples is just the max, so only the max bar applies then.
      else if (row.livezMaxMs > LIVEZ_MAX_BAR || ((row.livezN ?? 0) >= 200 && row.livezP99Ms > LIVEZ_P99_BAR)) row.verdict = "OVER(livez)";
      else if (row.noKtx) row.verdict = "NOT MEASURED(host has no ktx CLI)";
      else if (apis.some((c) => c.status >= 500)) row.verdict = "FAIL(5xx)";
      else if (bad.length) row.verdict = "PARTIAL(4xx/failed calls)";
      else if (row.apiCalls === 0) row.verdict = "NOT MEASURED(no api calls)";
      else row.verdict = "OK";
      rows.push(row);
      process.stdout.write(`${row.verdict.padEnd(28)} api=${String(row.apiCalls).padStart(2)} slowest=${String(slowest?.ms ?? 0).padStart(5)}ms livez p99 ${row.livezP99Ms} max ${row.livezMaxMs}  ${name}\n`);
      await context.close();
    }
  } finally { await browser.close(); }
  return rows;
}

let createdRoot = false;

/** docker cp the demo project (Docker-aligned) and build the SPA once; both are throw-away copies. */
async function prepareWork(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (!existsSync(path.join(ROOT, "webui/config/access.yaml"))) {
    await mkdir(WORK, { recursive: true, mode: 0o700 });
    await rm(ROOT, { recursive: true, force: true });
    execFileSync("docker", ["cp", `${CONTAINER}:/data/lucy`, ROOT], { stdio: "ignore" });
    createdRoot = true;
  }
  if (!existsSync(path.join(DIST, "index.html"))) {
    execFileSync("npx", ["vite", "build", "--outDir", DIST, "--emptyOutDir"], { cwd: path.resolve(here, ".."), stdio: "ignore" });
  }
}

type Baseline = { tracked: Record<string, { ref: string; note: string }>; unmeasuredRoutes: string[]; unmeasuredPages: string[] };
type GateResult = { regressions: string[]; trackedOpen: string[]; staleBaseline: string[]; unmeasuredRoutes: number; unmeasuredPages: number };

/** Compares verdicts with the registered baseline; the baseline may only shrink. */
async function evaluateGate(routes: RouteRow[], pages: PageRow[]): Promise<GateResult> {
  const base = JSON.parse(await readFile(BASELINE_FILE, "utf8")) as Baseline;
  const bad = (v: string) => /^(OVER|FAIL|PARTIAL)/.test(v);
  const unmeasured = (v: string) => v.startsWith("NOT MEASURED");
  const out: GateResult = { regressions: [], trackedOpen: [], staleBaseline: [], unmeasuredRoutes: 0, unmeasuredPages: 0 };
  for (const r of routes) {
    const key = r.route;
    if (bad(r.verdict)) {
      if (base.tracked[key]) out.trackedOpen.push(`${key} [${base.tracked[key].ref}] ${r.verdict}`);
      else out.regressions.push(`route ${key}: ${r.verdict}`);
    } else if (base.tracked[key] && r.verdict === "OK") out.staleBaseline.push(`tracked route now OK: ${key}`);
    if (unmeasured(r.verdict)) {
      out.unmeasuredRoutes += 1;
      if (!base.unmeasuredRoutes.includes(key)) out.regressions.push(`route ${key}: newly unmeasured (${r.verdict})`);
    } else if (base.unmeasuredRoutes.includes(key)) out.staleBaseline.push(`unmeasured route now measured: ${key}`);
  }
  for (const p of pages) {
    const key = p.page;
    if (bad(p.verdict)) {
      if (base.tracked[key]) out.trackedOpen.push(`${key} [${base.tracked[key].ref}] ${p.verdict}`);
      else out.regressions.push(`page ${key}: ${p.verdict}`);
    }
    if (unmeasured(p.verdict)) {
      out.unmeasuredPages += 1;
      if (!base.unmeasuredPages.includes(key)) out.regressions.push(`page ${key}: newly unmeasured (${p.verdict})`);
    } else if (base.unmeasuredPages.includes(key)) out.staleBaseline.push(`unmeasured page now measured: ${key}`);
  }
  return out;
}

/** Prints the gate section and returns the process exit code. */
function reportGate(gate: GateResult | null): number {
  if (!gate) return 0;
  console.log(`\n=== Gate (${path.basename(BASELINE_FILE)}) ===`);
  console.log(`regressions=${gate.regressions.length} tracked-open=${gate.trackedOpen.length} unmeasured routes=${gate.unmeasuredRoutes} pages=${gate.unmeasuredPages}`);
  for (const line of gate.regressions) console.log(`  REGRESSION  ${line}`);
  for (const line of gate.trackedOpen) console.log(`  tracked     ${line}`);
  for (const line of gate.staleBaseline) console.log(`  shrink-me   ${line}`);
  if (GATE && gate.regressions.length > 0) return 1;
  if (GATE && STRICT && gate.trackedOpen.length > 0) return 1;
  return 0;
}

/** SWEEP_REPLAY=<report.json>: judge an existing report against the baseline without measuring. */
async function replay(file: string): Promise<void> {
  const report = JSON.parse(await readFile(file, "utf8")) as { routes: RouteRow[]; pages: PageRow[] };
  process.exit(reportGate(await evaluateGate(report.routes, report.pages)));
}

async function main(): Promise<void> {
  if (process.env.SWEEP_REPLAY) return replay(process.env.SWEEP_REPLAY);
  await prepareWork();
  await prepareRoot();
  server = await startServer(RESEED);
  const ids = await discoverIds(server.base);
  console.log("ids", JSON.stringify(ids));
  const idle: number[] = [];
  for (let i = 0; i < 100; i += 1) idle.push((await get(server.base, "/api/livez")).ms);
  const idleLivezP99 = pct(idle, 99);
  console.log(`idle livez p99=${Math.round(idleLivezP99)}ms`);

  console.log("\n=== Layer 1: GET routes ===");
  const routes = await sweepRoutes(ids);
  console.log("\n=== Layer 2: pages ===");
  const pages = await sweepPages(ids);

  const gate = await evaluateGate(routes, pages).catch(() => null);
  const report = { measuredAt: new Date().toISOString(), fixture: AUDIT_SCALE, thresholds: { LIVEZ_P99_BAR, LIVEZ_MAX_BAR, ROUTE_P95_BAR }, ids, idleLivezP99Ms: Math.round(idleLivezP99), gate, routes, pages };
  await mkdir(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, OUT_NAME);
  await writeFile(out, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nwrote ${out}`);
  server?.child.kill("SIGTERM");
  const code = reportGate(gate);
  await cleanup();
  process.exit(code);
}

/** The copied project holds the demo's secrets: remove it unless asked to keep it. */
async function cleanup(): Promise<void> {
  if (createdRoot && process.env.SWEEP_KEEP !== "1") await rm(WORK, { recursive: true, force: true });
}

main().catch(async (e) => { console.error(e); server?.child.kill("SIGKILL"); await cleanup(); process.exit(1); });
