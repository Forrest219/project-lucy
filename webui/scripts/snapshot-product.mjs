#!/usr/bin/env node
import { chromium } from "playwright";
import ts from "typescript";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEBUI_ROOT = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(WEBUI_ROOT, "..");
const APP_TSX = join(WEBUI_ROOT, "src/app/App.tsx");
const FIXTURES_FILE = join(SCRIPT_DIR, "snapshot-product.fixtures.json");
const BLACKLIST_FILE = join(SCRIPT_DIR, "snapshot-product.blacklist.json");
const DEFAULT_BASE_URL = "http://localhost:5174";
const VIEWPORT = { width: 1440, height: 900 };
const TIMEOUT_MS = Number.parseInt(process.env.LUCY_SNAPSHOT_TIMEOUT_MS || "30000", 10);
const BASE_URL = trimTrailingSlash(process.env.LUCY_SNAPSHOT_BASE_URL || DEFAULT_BASE_URL);
const OUTPUT_ROOT = resolve(REPO_ROOT, process.env.LUCY_SNAPSHOT_OUTPUT_DIR || "var/screenshots");
const LOG_DIR = resolve(REPO_ROOT, "var/logs");
const DRY_RUN = process.env.LUCY_SNAPSHOT_DRY_RUN === "1";

const DEFAULT_BLACKLIST = [
  { kind: "text", pattern: "删除" },
  { kind: "text", pattern: "移除" },
  { kind: "text", pattern: "重置" },
  { kind: "regex", pattern: "登出|退出登录|注销" },
  { kind: "text", pattern: "取消" },
  { kind: "text", pattern: "关闭" },
  { kind: "aria-regex", pattern: "close", flags: "i" },
  { kind: "aria-regex", pattern: "dismiss", flags: "i" }
];

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function main() {
  await mkdir(LOG_DIR, { recursive: true });

  if (process.argv.includes("--healthcheck")) {
    await runHealthcheck();
    return;
  }

  const startedAt = new Date();
  const warnings = [];
  const skipped = [];
  const errors = [];
  const appText = await readFile(APP_TSX, "utf8");
  const appHash = sha256(appText);
  const appHashShort = appHash.slice(0, 8);
  const routes = parseRoutes(appText).filter((route) => route.path !== "*");
  const fixtures = await readOptionalJson(FIXTURES_FILE, {});
  const customBlacklist = await readOptionalJson(BLACKLIST_FILE, []);
  const blacklist = [...DEFAULT_BLACKLIST, ...(Array.isArray(customBlacklist) ? customBlacklist : [])];
  const capturedAt = startedAt.toISOString();
  const runStamp = formatRunStamp(startedAt);
  const runDir = join(OUTPUT_ROOT, appHashShort, runStamp);

  await mkdir(runDir, { recursive: true });

  let browser;
  let routesSucceeded = 0;
  let buttonsTotal = 0;
  let buttonsClicked = 0;
  let buttonsSkippedBlacklist = 0;
  let buttonsFailed = 0;
  let routesSkipped = 0;
  let routesFailed = 0;

  try {
    const health = await checkHealth();
    if (!health.ok) {
      throw new Error(`Healthcheck failed for ${BASE_URL}/overview: ${health.status || health.error}`);
    }

    browser = await chromium.launch(getChromiumLaunchOptions());

    let routeIndex = 0;
    for (const route of routes) {
      const instances = instantiateRoute(route, fixtures, skipped);
      if (instances.length === 0) {
        routesSkipped += 1;
        continue;
      }

      for (const instance of instances) {
        routeIndex += 1;
        const routeSlug = slugRoute(instance.path || route.path) || `route-${routeIndex}`;
        const routeDir = join(runDir, `${pad2(routeIndex)}-${routeSlug}`);
        await mkdir(routeDir, { recursive: true });

        const routeMeta = {
          route: instance.path,
          source_route: route.path,
          component: route.component,
          captured_at: capturedAt,
          viewport: VIEWPORT,
          dry_run: DRY_RUN,
          steps: []
        };

        const context = await browser.newContext({
          viewport: VIEWPORT,
          deviceScaleFactor: 1,
          locale: "zh-CN",
          timezoneId: "Asia/Shanghai"
        });

        let mutationsBlocked = 0;
        await context.route("**/*", async (playwrightRoute) => {
          const request = playwrightRoute.request();
          if (!SAFE_HTTP_METHODS.has(request.method())) {
            mutationsBlocked += 1;
            warnings.push(
              `${request.method()} ${request.url()} blocked while capturing ${instance.path}`
            );
            await playwrightRoute.fulfill({
              status: 204,
              contentType: "application/json",
              body: "{}"
            });
            return;
          }
          await playwrightRoute.continue();
        });

        const page = await context.newPage();
        page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

        try {
          const url = `${BASE_URL}${instance.path}`;
          const response = await gotoStable(page, url);
          const routeFile = `01-${routeSlug}.png`;
          if (!DRY_RUN) {
            await page.screenshot({ path: join(routeDir, routeFile), fullPage: false });
          }
          routeMeta.steps.push({
            file: routeFile,
            kind: "route",
            selector: null,
            status: "ok",
            http_status: response ? response.status() : null
          });

          const buttons = await scanButtons(page);
          let localButtonIndex = 1;
          for (const button of buttons) {
            buttonsTotal += 1;
            const skipReason = getBlacklistReason(button, blacklist);
            if (skipReason) {
              buttonsSkippedBlacklist += 1;
              routeMeta.steps.push({
                kind: "button",
                selector: button.selector,
                label_cn: button.label,
                status: "skipped_blacklist",
                reason: skipReason
              });
              continue;
            }

            if (DRY_RUN) {
              routeMeta.steps.push({
                kind: "button",
                selector: button.selector,
                label_cn: button.label,
                status: "dry_run"
              });
              continue;
            }

            localButtonIndex += 1;
            const buttonFile = `${pad2(localButtonIndex)}-click-${slugButton(button, localButtonIndex)}.png`;
            try {
              await page.locator(button.selector).first().click({ timeout: TIMEOUT_MS });
              await waitForStable(page);
              await page.screenshot({ path: join(routeDir, buttonFile), fullPage: false });
              buttonsClicked += 1;
              routeMeta.steps.push({
                file: buttonFile,
                kind: "button",
                selector: button.selector,
                label_cn: button.label,
                status: "ok"
              });
            } catch (err) {
              buttonsFailed += 1;
              errors.push({
                route: instance.path,
                kind: "button",
                selector: button.selector,
                label_cn: button.label,
                error: String(err.message || err)
              });
              routeMeta.steps.push({
                file: buttonFile,
                kind: "button",
                selector: button.selector,
                label_cn: button.label,
                status: "failed",
                error: String(err.message || err)
              });
            } finally {
              await gotoStable(page, `${BASE_URL}${instance.path}`).catch((err) => {
                warnings.push(`Failed to reset ${instance.path}: ${err.message || err}`);
              });
            }
          }

          if (mutationsBlocked > 0) {
            routeMeta.mutations_blocked = mutationsBlocked;
          }
          routesSucceeded += 1;
        } catch (err) {
          routesFailed += 1;
          errors.push({ route: instance.path, kind: "route", error: String(err.message || err) });
        } finally {
          await writeJson(join(routeDir, "_meta.json"), routeMeta);
          await context.close();
        }
      }
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  const manifest = {
    app_tsx_sha256: appHash,
    git_sha: await getGitSha(),
    base_url: BASE_URL,
    captured_at: capturedAt,
    viewport: VIEWPORT,
    dry_run: DRY_RUN,
    routes_total: routes.length,
    routes_succeeded: routesSucceeded,
    routes_skipped: routesSkipped,
    routes_failed: routesFailed,
    buttons_total: buttonsTotal,
    buttons_clicked: buttonsClicked,
    buttons_skipped_blacklist: buttonsSkippedBlacklist,
    buttons_failed: buttonsFailed,
    duration_ms: Date.now() - startedAt.getTime()
  };

  await writeJson(join(runDir, "_manifest.json"), manifest);
  if (errors.length > 0) {
    await writeJson(join(runDir, "_errors.json"), errors);
  }
  if (warnings.length > 0) {
    await writeFile(join(runDir, "_warnings.log"), `${warnings.join("\n")}\n`, "utf8");
  }
  if (skipped.length > 0) {
    await writeFile(join(runDir, "_skipped.log"), `${skipped.join("\n")}\n`, "utf8");
  }

  console.log(`snapshot-product complete: ${relative(REPO_ROOT, runDir)}`);
  console.log(JSON.stringify(manifest, null, 2));

  if (routesFailed > 0 || buttonsFailed > 0) {
    process.exitCode = 1;
  }
}

function parseRoutes(appText) {
  const sourceFile = ts.createSourceFile(APP_TSX, appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const routes = [];

  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tagName = jsxNameToString(node.tagName);
      if (tagName === "Route") {
        const path = getStringJsxAttr(node, "path");
        const isIndex = getBooleanJsxAttr(node, "index");
        if (path && path !== "*" && !isIndex) {
          routes.push({ path, component: getRouteComponent(node) });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return routes;
}

function getRouteComponent(node) {
  const attr = getJsxAttr(node, "element");
  if (!attr || !attr.initializer || !ts.isJsxExpression(attr.initializer)) {
    return null;
  }
  return getJsxExpressionComponent(attr.initializer.expression);
}

function getJsxExpressionComponent(expression) {
  if (!expression) {
    return null;
  }
  if (ts.isJsxSelfClosingElement(expression) || ts.isJsxElement(expression)) {
    return jsxNameToString(
      ts.isJsxElement(expression) ? expression.openingElement.tagName : expression.tagName
    );
  }
  return expression.getText();
}

function jsxNameToString(name) {
  if (!name) {
    return "";
  }
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  return name.getText();
}

function getJsxAttr(node, name) {
  return node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.text === name);
}

function getStringJsxAttr(node, name) {
  const attr = getJsxAttr(node, name);
  if (!attr || !attr.initializer) {
    return null;
  }
  if (ts.isStringLiteral(attr.initializer)) {
    return attr.initializer.text;
  }
  return null;
}

function getBooleanJsxAttr(node, name) {
  return Boolean(getJsxAttr(node, name));
}

function instantiateRoute(route, fixtures, skipped) {
  const params = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  if (params.length === 0) {
    return [{ path: route.path, params: {} }];
  }

  const records = fixtures[route.path];
  if (!Array.isArray(records) || records.length === 0) {
    skipped.push(`${route.path} skipped: missing fixture records`);
    return [];
  }

  return records.flatMap((record, index) => {
    const missing = params.filter((param) => record[param] === undefined || record[param] === null);
    if (missing.length > 0) {
      skipped.push(`${route.path} fixture ${index} skipped: missing ${missing.join(", ")}`);
      return [];
    }
    let path = route.path;
    for (const param of params) {
      path = path.replace(`:${param}`, encodeURIComponent(String(record[param])));
    }
    return [{ path, params: record }];
  });
}

async function runHealthcheck() {
  const health = await checkHealth();
  if (health.ok) {
    console.log(`OK: ${BASE_URL}/overview returns 200`);
    return;
  }
  console.error(`FAIL: ${BASE_URL}/overview returned ${health.status || health.error}`);
  process.exit(1);
}

async function checkHealth() {
  try {
    const response = await fetch(`${BASE_URL}/overview`, {
      method: "GET",
      signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, 10000))
    });
    return { ok: response.status === 200, status: response.status };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function gotoStable(page, url) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await waitForStable(page);
  await page.waitForSelector(".pl-workspace, main, body", { timeout: 5000 }).catch(() => {});
  return response;
}

async function waitForStable(page) {
  await page.waitForLoadState("networkidle", { timeout: Math.min(TIMEOUT_MS, 10000) }).catch(() => {});
  await page.waitForTimeout(800);
}

async function scanButtons(page) {
  const candidates = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll(
        'button, a[href], input[type="button"], input[type="submit"], [role="button"], [data-snapshot-target="true"]'
      )
    );
    const seen = new Set();

    function isVisible(element) {
      if (typeof element.checkVisibility === "function") {
        try {
          if (!element.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) {
            return false;
          }
        } catch {
          if (!element.checkVisibility()) {
            return false;
          }
        }
      }

      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE) {
        if (current.hidden || current.getAttribute("aria-hidden") === "true") {
          return false;
        }
        const currentStyle = window.getComputedStyle(current);
        if (currentStyle.visibility === "hidden" || currentStyle.display === "none") {
          return false;
        }
        current = current.parentElement;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        (element.offsetParent !== null || style.position === "fixed") &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    function cssString(value) {
      if (window.CSS && typeof window.CSS.escape === "function") {
        return window.CSS.escape(value);
      }
      return value.replace(/["\\]/g, "\\$&");
    }

    function cssPath(element) {
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
        const testId = current.getAttribute("data-testid");
        if (testId) {
          parts.unshift(`[data-testid="${cssString(testId)}"]`);
          break;
        }
        const tag = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (!parent) {
          parts.unshift(tag);
          break;
        }
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        const index = siblings.indexOf(current) + 1;
        parts.unshift(`${tag}:nth-of-type(${index})`);
        current = parent;
      }
      return parts.join(" > ");
    }

    return nodes.flatMap((element) => {
      if (seen.has(element) || !isVisible(element)) {
        return [];
      }
      seen.add(element);

      if (element.disabled || element.getAttribute("aria-disabled") === "true") {
        return [];
      }

      const tag = element.tagName.toLowerCase();
      const href = element.getAttribute("href") || "";
      if (tag === "a" && href && !href.startsWith("#")) {
        return [];
      }

      const label = (
        element.getAttribute("aria-label") ||
        element.innerText ||
        element.getAttribute("value") ||
        element.getAttribute("title") ||
        element.getAttribute("data-testid") ||
        ""
      ).replace(/\s+/g, " ").trim();

      if (!label && element.getAttribute("data-snapshot-target") !== "true") {
        return [];
      }

      return [
        {
          selector: cssPath(element),
          label,
          tag,
          href,
          testId: element.getAttribute("data-testid") || null,
          ariaLabel: element.getAttribute("aria-label") || null,
          snapshotTarget: element.getAttribute("data-snapshot-target") === "true"
        }
      ];
    });
  });

  return dedupeBySelector(candidates);
}

function getBlacklistReason(button, blacklist) {
  if (button.tag === "a" && button.href && !button.href.startsWith("#")) {
    return "link_navigation";
  }

  for (const rule of blacklist) {
    const target = rule.kind && rule.kind.startsWith("aria") ? button.ariaLabel || "" : button.label || "";
    if (rule.kind === "text" && target.includes(rule.pattern)) {
      return `text:${rule.pattern}`;
    }
    if ((rule.kind === "regex" || rule.kind === "aria-regex") && new RegExp(rule.pattern, rule.flags || "").test(target)) {
      return `regex:${rule.pattern}`;
    }
  }
  return null;
}

function dedupeBySelector(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.selector)) {
      return false;
    }
    seen.add(candidate.selector);
    return true;
  });
}

function slugRoute(pathname) {
  const cleaned = pathname
    .replace(/^\/+/, "")
    .replace(/\/+$/g, "")
    .replace(/[:]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return cleaned || "root";
}

function slugButton(button, index) {
  const source = button.testId || button.ariaLabel || button.label || `button-${index}`;
  const ascii = source
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return ascii || `button-${pad2(index)}`;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/g, "");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function formatRunStamp(date) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  return `${year}-${month}-${day}-${hour}${minute}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

async function readOptionalJson(file, fallback) {
  if (!existsSync(file)) {
    return fallback;
  }
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function getGitSha() {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT });
    return stdout.trim();
  } catch {
    return null;
  }
}

function getChromiumLaunchOptions() {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (executablePath && existsSync(executablePath)) {
    return { headless: true, executablePath };
  }
  return { headless: true };
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
