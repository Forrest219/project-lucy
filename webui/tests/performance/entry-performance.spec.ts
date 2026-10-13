// Spec 174 §8.1 — browser scenarios. Launched only by `npm run perf:entry`.
// The DOM readiness predicates are identical for baseline and after: they
// require real connection cards / table rows / agent rows plus enabled
// controls, never a skeleton, PageHeader, load or networkidle event.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test, type Browser, type BrowserContext, type Page } from "@playwright/test";

type RouteId = "connections" | "catalog" | "overview" | "agents";
type Expected = { connections: number; tables: number; enabledTables: number; agents: number; connectionIds: string[] };

const ROUTES: Record<RouteId, { path: string; nav: string }> = {
  connections: { path: "/connections", nav: "connections-overview" },
  catalog: { path: "/catalog", nav: "semantic-catalog" },
  overview: { path: "/overview", nav: "overview" },
  agents: { path: "/admin/agents", nav: "admin-agents" }
};
const PARTNER: Record<RouteId, RouteId> = { connections: "catalog", catalog: "overview", overview: "agents", agents: "connections" };

const scenario = process.env.PERF_SCENARIO ?? "";
const iterations = Number(process.env.PERF_ITERATIONS ?? "30");
const warmup = Number(process.env.PERF_WARMUP ?? "5");
const resultsFile = process.env.PERF_RESULTS_FILE ?? "";
const traceDir = process.env.PERF_TRACE_DIR ?? "";
const expected = JSON.parse(process.env.PERF_EXPECTED ?? "{}") as Expected;
const routes = (process.env.PERF_ROUTES ?? "connections,catalog,overview,agents").split(",").filter(Boolean) as RouteId[];
const OBSERVE_AFTER_READY_MS = Number(process.env.PERF_OBSERVE_AFTER_READY_MS ?? "1000");

const INIT_SCRIPT = `(() => {
  const perf = { cls: 0, shifts: [], longTasks: [], lastInput: null };
  Object.defineProperty(window, "__lucyPerf", { value: perf, configurable: false });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) { perf.cls += e.value; perf.shifts.push({ t: e.startTime, v: e.value }); }
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch (_) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const a = e.attribution && e.attribution[0];
        perf.longTasks.push({ start: e.startTime, duration: e.duration, name: e.name, container: a ? a.containerType : null });
      }
    }).observe({ type: "longtask", buffered: true });
  } catch (_) {}
  for (const type of ["pointerdown", "keydown"]) {
    document.addEventListener(type, (e) => { perf.lastInput = { type, t: e.timeStamp }; }, true);
  }
  const q = (s) => document.querySelector(s);
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const enabled = (el) => !!el && !el.disabled && el.getAttribute("aria-disabled") !== "true";
  perf.predicates = {
    shell: () => enabled(q('[data-testid="sidebar-search-trigger"]')) && qa('[data-testid^="nav-link-"]').length > 5,
    connections: (exp) => {
      const cards = qa('[data-testid^="connection-card-"]').length;
      const values = qa('[data-testid="connection-metric-value"]').map((n) => (n.textContent || "").trim());
      return cards === exp.connections && values.includes(String(exp.tables)) && enabled(q('[data-testid="create-connection-btn"]'));
    },
    catalog: (exp) => {
      const rows = qa('tr[data-testid^="catalog-row-"]').length;
      const count = q('[data-testid="catalog-result-count"]');
      return rows === exp.enabledTables && !!count && /\\d+/.test(count.textContent || "") && enabled(q("input.pl-whitelist-search-input"));
    },
    overview: () => !!(q('[data-testid="ops-service-health-summary"]') || q('[data-testid="ops-service-health-critical"]'))
      && !!(q('[data-testid="ops-action-required-count"]') || q('[data-testid="ops-action-required-empty"]'))
      && !!q('[data-testid="ops-mcp-access"]'),
    agents: (exp) => {
      const rows = qa('[data-testid^="agent-row-"]').filter((n) => !(n.getAttribute("data-testid") || "").startsWith("agent-row-index-")).length;
      return rows === exp.agents && !!q('[data-testid="agent-list-result-count"]') && enabled(q('input[placeholder="搜索显示名或用户 ID"]'));
    }
  };
  perf.waitFor = (check, timeoutMs) => new Promise((resolve) => {
    const deadline = performance.now() + (timeoutMs || 20000);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())));
    };
    const test = () => {
      if (done) return;
      let ok = false;
      try { ok = !!check(); } catch (_) { ok = false; }
      if (ok) finish();
      else if (performance.now() > deadline) { done = true; observer.disconnect(); resolve(null); }
    };
    const observer = new MutationObserver(test);
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    const poll = () => { if (!done) { test(); setTimeout(poll, 25); } };
    poll();
  });
  perf.waitRoute = (name, exp, timeoutMs) => perf.waitFor(() => perf.predicates[name](exp), timeoutMs);
  perf.waitNavActive = (navId, timeoutMs) => perf.waitFor(() => q('[data-testid="nav-link-' + navId + '"][aria-current="page"]'), timeoutMs);
  perf.armed = {};
  perf.arm = (key, kind, arg, exp, timeoutMs) => {
    perf.armed[key] = kind === "nav" ? perf.waitNavActive(arg, timeoutMs) : perf.waitRoute(arg, exp, timeoutMs);
    return true;
  };
  perf.collect = (keys) => Promise.all(keys.map((key) => perf.armed[key] || Promise.resolve(null)));
})();`;

type Sample = {
  scenario: string;
  route: string;
  iteration: number;
  warmup: boolean;
  ok: boolean;
  error?: string;
  metrics: Record<string, unknown>;
};

function record(sample: Sample): void {
  if (!resultsFile) return;
  mkdirSync(path.dirname(resultsFile), { recursive: true });
  appendFileSync(resultsFile, `${JSON.stringify(sample)}\n`, "utf8");
}

async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript({ content: INIT_SCRIPT });
  return context;
}

async function waitRoute(page: Page, route: RouteId | "shell", timeoutMs = 20_000): Promise<number | null> {
  return page.evaluate(
    ([name, exp, timeout]) => (window as unknown as { __lucyPerf: { waitRoute: (n: string, e: unknown, t: number) => Promise<number | null> } }).__lucyPerf.waitRoute(name as string, exp, timeout as number),
    [route, expected, timeoutMs] as const
  );
}

async function readObservations(page: Page, from: number, to: number) {
  return page.evaluate(([start, end]) => {
    const perf = (window as unknown as { __lucyPerf: { shifts: Array<{ t: number; v: number }>; longTasks: Array<{ start: number; duration: number; name: string; container: string | null }> } }).__lucyPerf;
    const shifts = perf.shifts.filter((s) => s.t >= start && s.t <= end);
    const longTasks = perf.longTasks.filter((t) => t.start + t.duration >= start && t.start <= end);
    return { cls: shifts.reduce((sum, s) => sum + s.v, 0), shiftCount: shifts.length, longTasks };
  }, [from, to] as const);
}

async function readResources(page: Page, until: number) {
  return page.evaluate((limit) => {
    return performance.getEntriesByType("resource")
      .map((e) => e as PerformanceResourceTiming)
      .filter((e) => /\.(js|css)(\?|$)/.test(new URL(e.name).pathname) && e.startTime <= limit)
      .map((e) => ({
        path: new URL(e.name).pathname,
        initiator: e.initiatorType,
        transferSize: e.transferSize,
        encodedBodySize: e.encodedBodySize,
        decodedBodySize: e.decodedBodySize,
        start: e.startTime,
        end: e.responseEnd
      }));
  }, until);
}

async function lastInputTime(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as unknown as { __lucyPerf: { lastInput: { t: number } | null } }).__lucyPerf.lastInput?.t ?? null);
}

async function maybeTrace<T>(browser: Browser, page: Page, name: string, enabled: boolean, fn: () => Promise<T>): Promise<T> {
  if (!enabled || !traceDir) return fn();
  mkdirSync(traceDir, { recursive: true });
  await browser.startTracing(page, { path: path.join(traceDir, `${name}.json`), screenshots: true });
  try {
    return await fn();
  } finally {
    await browser.stopTracing();
  }
}

type Armable = { arm: (key: string, kind: string, arg: string, exp: unknown, timeout: number) => boolean; collect: (keys: string[]) => Promise<Array<number | null>> };

async function arm(page: Page, entries: Array<[key: string, kind: "route" | "nav", arg: string]>, timeoutMs = 20_000): Promise<void> {
  await page.evaluate(([list, exp, timeout]) => {
    const perf = (window as unknown as { __lucyPerf: Armable }).__lucyPerf;
    for (const [key, kind, arg] of list as Array<[string, string, string]>) perf.arm(key, kind, arg, exp, timeout as number);
  }, [entries, expected, timeoutMs] as const);
}

async function collect(page: Page, keys: string[]): Promise<Array<number | null>> {
  return page.evaluate((list) => (window as unknown as { __lucyPerf: Armable }).__lucyPerf.collect(list), keys);
}

async function loadAndMeasure(page: Page, route: RouteId, action: () => Promise<unknown>) {
  await action();
  await arm(page, [["shell", "route", "shell"], ["primary", "route", route]]);
  const [shellReady, primaryReady] = await collect(page, ["shell", "primary"]);
  if (primaryReady === null) throw new Error(`primary-ready predicate not met for ${route}`);
  await page.waitForTimeout(OBSERVE_AFTER_READY_MS);
  const observed = await readObservations(page, 0, primaryReady + OBSERVE_AFTER_READY_MS);
  const resources = await readResources(page, primaryReady);
  return { shellReadyMs: shellReady, primaryReadyMs: primaryReady, ...observed, resources };
}

async function runSamples(route: string, fn: (iteration: number, isWarmup: boolean) => Promise<Record<string, unknown>>): Promise<void> {
  for (let i = 0; i < warmup + iterations; i += 1) {
    const isWarmup = i < warmup;
    try {
      const metrics = await fn(i, isWarmup);
      record({ scenario, route, iteration: i, warmup: isWarmup, ok: true, metrics });
    } catch (error) {
      record({ scenario, route, iteration: i, warmup: isWarmup, ok: false, error: error instanceof Error ? error.message.slice(0, 300) : String(error), metrics: {} });
    }
  }
}

async function clickNav(page: Page, route: RouteId): Promise<void> {
  await page.locator(`[data-testid="nav-link-${ROUTES[route].nav}"]`).click();
}

async function measureClickNavigation(page: Page, route: RouteId) {
  const resourceCountBefore = await page.evaluate(() => performance.getEntriesByType("resource").length);
  await arm(page, [["feedback", "nav", ROUTES[route].nav], ["ready", "route", route]]);
  await clickNav(page, route);
  const start = await lastInputTime(page);
  const [feedback, ready] = await collect(page, ["feedback", "ready"]);
  if (start === null || ready === null || feedback === null) throw new Error(`navigation to ${route} not ready`);
  const lazyChunks = await page.evaluate(([count, t]) => performance.getEntriesByType("resource").slice(count as number)
    .filter((e) => e.startTime >= (t as number) && /\.js(\?|$)/.test(new URL(e.name).pathname)).length, [resourceCountBefore, start] as const);
  return { start, feedback, ready, lazyChunks };
}

test.describe.configure({ mode: "serial" });

test(`entry-performance ${scenario}`, async ({ browser }) => {
  test.skip(!scenario, "PERF_SCENARIO required");

  if (scenario === "browser-cold") {
    for (const route of routes) {
      await runSamples(route, async (i, isWarmup) => {
        const context = await newContext(browser);
        const page = await context.newPage();
        try {
          return await maybeTrace(browser, page, `browser-cold-${route}`, !isWarmup && i === warmup, () =>
            loadAndMeasure(page, route, () => page.goto(ROUTES[route].path, { waitUntil: "commit" })));
        } finally {
          await context.close();
        }
      });
    }
  }

  if (scenario === "browser-warm-refresh") {
    for (const route of routes) {
      const context = await newContext(browser);
      const page = await context.newPage();
      await page.goto(ROUTES[route].path);
      await waitRoute(page, route);
      await runSamples(route, async (i, isWarmup) =>
        maybeTrace(browser, page, `browser-warm-refresh-${route}`, !isWarmup && i === warmup, () =>
          loadAndMeasure(page, route, () => page.reload({ waitUntil: "commit" }))));
      await context.close();
    }
  }

  if (scenario === "route-warm") {
    const context = await newContext(browser);
    const page = await context.newPage();
    await page.goto(ROUTES.connections.path);
    await waitRoute(page, "connections");
    for (const route of ["catalog", "overview", "agents", "connections"] as RouteId[]) {
      await clickNav(page, route);
      await waitRoute(page, route);
    }
    for (const route of routes) {
      await runSamples(route, async (i, isWarmup) => {
        await clickNav(page, PARTNER[route]);
        await waitRoute(page, PARTNER[route]);
        await page.waitForTimeout(150);
        return maybeTrace(browser, page, `route-warm-${route}`, !isWarmup && i === warmup, async () => {
          const nav = await measureClickNavigation(page, route);
          await page.waitForTimeout(500);
          const observed = await readObservations(page, nav.start, nav.ready + 500);
          return { feedbackMs: nav.feedback - nav.start, primaryReadyMs: nav.ready - nav.start, lazyChunks: nav.lazyChunks, ...observed };
        });
      });
    }
    if (routes.includes("catalog")) {
      await clickNav(page, "catalog");
      await waitRoute(page, "catalog");
      const input = page.locator("input.pl-whitelist-search-input");
      await runSamples("catalog-filter", async (i) => {
        await input.fill("");
        await page.waitForTimeout(100);
        const term = i % 2 === 0 ? "sales" : "region";
        await input.pressSequentially(term);
        const start = await lastInputTime(page);
        const done = await page.evaluate(() => (window as unknown as { __lucyPerf: { waitFor: (c: () => boolean, t: number) => Promise<number | null> } }).__lucyPerf.waitFor(() => {
          const count = document.querySelector('[data-testid="catalog-result-count"]');
          return !!count;
        }, 5000));
        await page.waitForTimeout(300);
        const observed = await readObservations(page, (start ?? 0) - 200, (done ?? 0) + 300);
        return { filterMs: done !== null && start !== null ? done - start : null, ...observed };
      });
    }
    await context.close();
  }

  if (scenario === "route-query-cold") {
    const context = await newContext(browser);
    const page = await context.newPage();
    for (const route of routes) {
      await runSamples(route, async (i, isWarmup) => {
        await page.goto("/help");
        await waitRoute(page, "shell");
        await page.waitForTimeout(150);
        return maybeTrace(browser, page, `route-query-cold-${route}`, !isWarmup && i === warmup, async () => {
          const nav = await measureClickNavigation(page, route);
          await page.waitForTimeout(500);
          const observed = await readObservations(page, nav.start, nav.ready + 500);
          return { primaryReadyMs: nav.ready - nav.start, feedbackMs: nav.feedback - nav.start, lazyChunksDownloaded: nav.lazyChunks, ...observed };
        });
      });
    }
    await context.close();
  }

  if (scenario === "login-required") {
    const password = readFileSync(process.env.PERF_LOGIN_SECRET_FILE ?? "", "utf8").trim();
    await runSamples("overview", async (i, isWarmup) => {
      const context = await newContext(browser);
      const page = await context.newPage();
      try {
        await page.goto("/overview");
        await page.locator('input[autocomplete="username"]').waitFor();
        await page.locator('input[autocomplete="username"]').fill("perf_owner");
        await page.locator('input[type="password"]').fill(password);
        return await maybeTrace(browser, page, "login-required-overview", !isWarmup && i === warmup, async () => {
          await arm(page, [["primary", "route", "overview"]]);
          await page.locator('button[type="submit"]').click();
          const submitAt = await lastInputTime(page);
          const [ready] = await collect(page, ["primary"]);
          if (ready === null || submitAt === null) throw new Error("overview not ready after login");
          const loginEnd = await page.evaluate(() => {
            const entry = performance.getEntriesByType("resource").find((e) => new URL(e.name).pathname === "/api/auth/login") as PerformanceResourceTiming | undefined;
            return entry ? entry.responseEnd : null;
          });
          if (loginEnd === null) throw new Error("login response timing missing");
          await page.waitForTimeout(OBSERVE_AFTER_READY_MS);
          const observed = await readObservations(page, loginEnd, ready + OBSERVE_AFTER_READY_MS);
          return { passwordSubmitMs: loginEnd - submitAt, loginToPrimaryReadyMs: ready - loginEnd, ...observed };
        });
      } finally {
        await context.close();
      }
    });
  }

  if (scenario === "probe-load" || scenario === "probe-load-slow") {
    for (const route of routes) {
      await runSamples(route, async (i, isWarmup) => {
        const context = await newContext(browser);
        const page = await context.newPage();
        try {
          return await maybeTrace(browser, page, `${scenario}-${route}`, !isWarmup && i === warmup, async () => {
            if (route === "connections") {
              await page.goto(ROUTES.connections.path, { waitUntil: "commit" });
              await arm(page, [["primary", "route", "connections"]]);
              const [ready] = await collect(page, ["primary"]);
              if (ready === null) throw new Error("connections not ready under probe load");
              const probes = await page.evaluate((ids) => new Promise<Record<string, number | null>>((resolve) => {
                const out: Record<string, number | null> = {};
                const deadline = performance.now() + 40_000;
                const tick = () => {
                  for (const id of ids) {
                    if (out[id] != null) continue;
                    const el = document.querySelector(`[data-testid="connection-health-${id}"]`);
                    const label = el?.getAttribute("aria-label") ?? "";
                    if (el && !label.includes("探测中")) out[id] = performance.now();
                  }
                  if (ids.every((id) => out[id] != null) || performance.now() > deadline) {
                    for (const id of ids) if (out[id] == null) out[id] = null;
                    resolve(out);
                  } else setTimeout(tick, 20);
                };
                tick();
              }), expected.connectionIds);
              const observed = await readObservations(page, 0, Math.max(ready, ...Object.values(probes).map((v) => v ?? 0)));
              return { primaryReadyMs: ready, probeDoneMs: probes, ...observed };
            }
            await page.goto(ROUTES.connections.path, { waitUntil: "commit" });
            await waitRoute(page, "shell");
            const nav = await measureClickNavigation(page, route);
            await page.waitForTimeout(500);
            const observed = await readObservations(page, nav.start, nav.ready + 500);
            return { primaryReadyMs: nav.ready - nav.start, ...observed };
          });
        } finally {
          await context.close();
        }
      });
    }
  }
});
