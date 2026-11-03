// Spec 195 §8 / SI-14 — sidebar round-trips between the Agent list and the
// role-permission / semantic-asset / config-audit pages, with one overlay
// edit in the middle of the run.
//
// Measurement contract (Spec 174 §8):
//   - the clock starts at the real pointer event inside the page
//     (`performance.timeOrigin`-relative), never at the automation command;
//   - "main content visible" and "network complete" are recorded separately;
//   - failures and retries are kept — nothing is filtered;
//   - every busy response (503 DISPLAY_SNAPSHOT_BUSY) is counted, so an
//     unexplained busy fails the run instead of hiding in an average.
//
// Anonymous fixture only: no real instance, no credentials, no real agents.
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type Browser, type Page } from "@playwright/test";
import type { PerfExpected } from "./entry-performance-predicates";

type RouteId = "agents" | "roles" | "catalog" | "audit";

const ROUTES: Record<RouteId, { path: string; nav: string; group: string }> = {
  agents: { path: "/admin/agents", nav: "admin-agents", group: "governance" },
  roles: { path: "/admin/roles", nav: "admin-roles", group: "governance" },
  catalog: { path: "/catalog", nav: "semantic-catalog", group: "semantic-modeling" },
  audit: { path: "/admin/config-audit", nav: "admin-config-audit", group: "governance" }
};

/** The hub page and the three partner pages of the SI-14 round-trip. */
const PARTNERS: RouteId[] = ["roles", "catalog", "audit"];

const scenario = process.env.PERF_SCENARIO ?? "";
const iterations = Number(process.env.PERF_ITERATIONS ?? "30");
const warmup = Number(process.env.PERF_WARMUP ?? "5");
const resultsFile = process.env.PERF_RESULTS_FILE ?? "";
const fixtureDir = process.env.PERF_FIXTURE_DIR ?? "";
const expected = JSON.parse(process.env.PERF_EXPECTED ?? "{}") as PerfExpected;

const READY_TIMEOUT_MS = 20_000;

/** Records the last real pointer/keyboard event time (page clock). */
const INIT_SCRIPT = `(() => {
  try {
    window.__lucyLastInput = 0;
    for (const type of ["pointerdown", "mousedown", "keydown", "click"]) {
      window.addEventListener(type, (event) => { window.__lucyLastInput = event.timeStamp; }, true);
    }
  } catch (_) {}
})();`;

/**
 * Ready predicates: the real table / count is rendered and no loading region
 * is left. A skeleton, a PageHeader or a networkidle event is never enough.
 */
function agentsReady(exp: PerfExpected): boolean {
  const ids = Array.from(document.querySelectorAll('[data-testid^="agent-row-"]'))
    .map((n) => n.getAttribute("data-testid") || "")
    .filter((id) => id.indexOf("agent-row-index-") !== 0)
    .map((id) => id.slice("agent-row-".length));
  if (ids.length !== exp.agentIds.length) return false;
  const count = document.querySelector('[data-testid="agent-list-result-count"]');
  if (!count || (count.textContent || "").trim() !== `${exp.agentIds.length} 条结果`) return false;
  return !document.querySelector('[data-testid="async-region-pending"]');
}

function rolesReady(_exp: PerfExpected): boolean {
  if (document.querySelector('[data-testid="async-region-pending"]')) return false;
  const table = document.querySelector('[data-testid="role-list-table"]');
  if (!table) return false;
  const rows = Array.from(document.querySelectorAll('[data-testid^="role-row-"]'))
    .filter((n) => (n.getAttribute("data-testid") || "").indexOf("role-row-index-") !== 0);
  return rows.length > 0;
}

function catalogReady(exp: PerfExpected): boolean {
  if (document.querySelector('[data-testid="async-region-pending"]')) return false;
  const rows = Array.from(document.querySelectorAll('tr[data-testid^="catalog-row-"]'));
  if (rows.length !== exp.enabledTableNames.length) return false;
  const count = document.querySelector('[data-testid="catalog-result-count"]');
  if (!count || (count.textContent || "").trim() !== `${exp.enabledTableNames.length} 条结果`) return false;
  return true;
}

function auditReady(_exp: PerfExpected): boolean {
  if (document.querySelector('[data-testid="async-region-pending"]')) return false;
  return Boolean(document.querySelector('[data-testid="config-audit-table"]'));
}

const READY: Record<RouteId, (exp: PerfExpected) => boolean> = { agents: agentsReady, roles: rolesReady, catalog: catalogReady, audit: auditReady };

const READY_SOURCE: Record<RouteId, string> = {
  agents: agentsReady.toString(),
  roles: rolesReady.toString(),
  catalog: catalogReady.toString(),
  audit: auditReady.toString()
};

function record(sample: Record<string, unknown>): void {
  if (!resultsFile) return;
  mkdirSync(path.dirname(resultsFile), { recursive: true });
  appendFileSync(resultsFile, `${JSON.stringify(sample)}\n`, "utf8");
}

/** The sidebar groups start collapsed — open the group before clicking its link. */
async function ensureNavGroupOpen(page: Page, group: string): Promise<void> {
  const section = page.locator(`[data-testid="nav-group-${group}"]`);
  if ((await section.getAttribute("data-open")) === "true") return;
  await page.locator(`[data-testid="nav-group-toggle-${group}"]`).click({ timeout: 5000 });
  await page.waitForFunction(
    (id) => document.querySelector(`[data-testid="nav-group-${id}"]`)?.getAttribute("data-open") === "true",
    group,
    { timeout: 5000 }
  );
}

async function clickNav(page: Page, route: RouteId): Promise<number> {
  await ensureNavGroupOpen(page, ROUTES[route].group);
  await page.locator(`[data-testid="nav-link-${ROUTES[route].nav}"]`).click({ timeout: 8000 });
  const start = await page.evaluate(() => (window as unknown as { __lucyLastInput: number }).__lucyLastInput);
  if (!start) throw new Error(`no pointer event recorded for the navigation to ${route}`);
  return start;
}

async function waitReady(page: Page, route: RouteId): Promise<number> {
  await page.waitForFunction(READY_SOURCE[route] as never, expected as never, { timeout: READY_TIMEOUT_MS, polling: 100 });
  return page.evaluate(() => performance.now());
}

/**
 * The network completion of the read models this navigation depends on.
 *
 * Recorded separately from the visible content: a warm cache needs no
 * request at all (0 requests, 0 ms), a cold read completes when its last
 * response ended.
 */
async function networkComplete(
  page: Page,
  since: number,
  wholeDocument = false
): Promise<{ completeMs: number; requests: number }> {
  return page.evaluate(([from, all]) => {
    const entries = performance.getEntriesByType("resource")
      .map((e) => e as PerformanceResourceTiming)
      .filter((e) => /\/api\/(sources|admin\/agents|admin\/roles|admin\/config-audit)/.test(e.name));
    // After a reload the document is new, so every entry belongs to this
    // navigation; an in-page navigation only counts the entries after it.
    const scoped = all ? entries : entries.filter((e) => e.startTime >= from);
    if (scoped.length === 0) return { completeMs: 0, requests: 0 };
    const first = Math.min(...scoped.map((e) => e.startTime));
    return { completeMs: Math.max(...scoped.map((e) => e.responseEnd)) - first, requests: scoped.length };
  }, [since, wholeDocument] as const);
}

/** The overlay of the anonymous fixture — an ordinary semantic overlay (D only). */
function overlayFile(): string {
  const manifest = JSON.parse(readFileSync(path.join(fixtureDir, "fixture-manifest.json"), "utf8")) as {
    paths: { projectRoot: string };
  };
  const semanticLayer = path.join(manifest.paths.projectRoot, "config", "semantic-layer");
  const connection = readdirSync(semanticLayer).find((name) => !name.startsWith("."))!;
  const table = readdirSync(path.join(semanticLayer, connection)).find((name) => name.endsWith(".yaml"))!;
  return path.join(semanticLayer, connection, table);
}

test.describe.configure({ mode: "serial" });

test(`spec195 display round-trip ${scenario}`, async ({ browser }) => {
  test.skip(!scenario, "PERF_SCENARIO required");

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript({ content: INIT_SCRIPT });
  const page = await context.newPage();

  const busyResponses: string[] = [];
  page.on("response", (response) => {
    if (response.status() !== 503) return;
    void response
      .json()
      .then((body) => {
        if ((body as { error?: { code?: string } })?.error?.code === "DISPLAY_SNAPSHOT_BUSY") {
          busyResponses.push(new URL(response.url()).pathname);
        }
      })
      .catch(() => undefined);
  });

  // The app must be loaded before the sidebar can be used.
  await page.goto(ROUTES.agents.path);
  await page.waitForSelector('[data-testid="nav-group-governance"]', { timeout: 30_000 });

  const editIndex = Math.floor(iterations / 2);
  let overlayEdited = false;

  for (let i = 0; i < warmup + iterations; i += 1) {
    const isWarmup = i < warmup;
    const partner = PARTNERS[i % PARTNERS.length]!;
    try {
      // Agent list → partner page → Agent list: one round-trip group.
      const hubStart = await clickNav(page, "agents");
      const hubReady = await waitReady(page, "agents");
      const partnerStart = await clickNav(page, partner);
      const partnerReady = await waitReady(page, partner);
      const backStart = await clickNav(page, "agents");
      const backReady = await waitReady(page, "agents");
      const network = await networkComplete(page, hubStart);
      record({
        scenario,
        route: `roundtrip-${partner}`,
        iteration: i,
        warmup: isWarmup,
        ok: true,
        metrics: {
          hubVisibleMs: hubReady - hubStart,
          partnerVisibleMs: partnerReady - partnerStart,
          backVisibleMs: backReady - backStart,
          networkCompleteMs: network.completeMs,
          networkRequests: network.requests,
          busyResponses: busyResponses.length
        }
      });
    } catch (error) {
      record({
        scenario,
        route: `roundtrip-${partner}`,
        iteration: i,
        warmup: isWarmup,
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error),
        metrics: { busyResponses: busyResponses.length }
      });
    }

    // One overlay edit in the middle of the measured run: an ordinary overlay
    // must invalidate the semantic display without an unexplained busy.
    if (!isWarmup && !overlayEdited && i - warmup === editIndex) {
      const file = overlayFile();
      const before = readFileSync(file, "utf8");
      writeFileSync(file, `${before}\n# spec195 round-trip overlay edit\n`, "utf8");
      overlayEdited = true;
      // Read the semantic asset display again with a COLD client cache: the
      // edited overlay must be picked up and must not produce a busy answer.
      await clickNav(page, "catalog");
      await waitReady(page, "catalog");
      await page.reload({ waitUntil: "commit" });
      await page.waitForSelector('[data-testid="nav-group-governance"]', { timeout: 30_000 });
      const reloadStart = await page.evaluate(() => performance.now());
      const ready = await waitReady(page, "catalog");
      // The reload replaced the document: every API entry belongs to it.
      const network = await networkComplete(page, 0, true);
      record({
        scenario,
        route: "roundtrip-overlay-edit",
        iteration: i,
        warmup: false,
        ok: true,
        metrics: {
          visibleMs: ready - reloadStart,
          networkCompleteMs: network.completeMs,
          networkRequests: network.requests,
          busyResponses: busyResponses.length
        }
      });
    }
  }

  if (busyResponses.length > 0) {
    throw new Error(`unexplained busy responses during the round-trips: ${busyResponses.join(", ")}`);
  }
  if (!overlayEdited) throw new Error("the mid-run overlay edit did not happen");

  await context.close();
});
