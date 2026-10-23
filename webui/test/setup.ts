// Global polyfills for jsdom environment used by Vitest.
// Radix UI primitives (Tooltip / Select / etc.) call ResizeObserver
// during mount via @radix-ui/react-use-size; jsdom doesn't ship one.

import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest runs every test file through this setup file, but the suites share a
// process. A suite that sets process.env without cleaning up leaks it into the
// next suite, and the next suite then sees a different project root / access
// config - which shows up as routes answering 404 on perfectly ordinary
// endpoints. Restore the environment the worker started with before each file
// so a suite can only observe what it set itself.
const PRISTINE_ENV = Symbol.for("lucy.vitest.pristineEnv");
type EnvSnapshot = Record<string, string | undefined>;
const globalStore = globalThis as unknown as { [PRISTINE_ENV]?: EnvSnapshot };
const pristine = globalStore[PRISTINE_ENV];
if (pristine) {
  for (const key of Object.keys(process.env)) {
    if (!(key in pristine)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(pristine)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
} else {
  globalStore[PRISTINE_ENV] = { ...process.env };
}

// V-01 (T0A-2): production defaults to customer mode where auth can never be
// open. The suite predates that and relies on open mode, so default to
// development + auth off unless a suite/CI explicitly sets them.
if (!process.env.LUCY_DEPLOYMENT_MODE || process.env.LUCY_DEPLOYMENT_MODE.trim().length === 0) {
  process.env.LUCY_DEPLOYMENT_MODE = "development";
}
if (process.env.LUCY_WEBUI_AUTH === undefined) {
  process.env.LUCY_WEBUI_AUTH = "off";
}

// Many server tests call auditedWriteFile → getAuditDb without setting
// KTX_PROJECT_ROOT / creating ktx.yaml (gitignored in CI). Provide a
// process-wide default audit sqlite so those paths do not depend on a
// resolvable project root. Individual suites may still override
// LUCY_AUDIT_DB and reset modules as needed.
if (!process.env.LUCY_AUDIT_DB || process.env.LUCY_AUDIT_DB.trim().length === 0) {
  const auditDir = mkdtempSync(path.join(os.tmpdir(), "lucy-vitest-audit-"));
  process.env.LUCY_AUDIT_DB = path.join(auditDir, "audit.sqlite");
}

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class IntersectionObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  root = null;
  rootMargin = "";
  thresholds: ReadonlyArray<number> = [];
}

if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (globalThis as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver =
    ResizeObserverMock;
}

if (typeof (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver === "undefined") {
  (globalThis as { IntersectionObserver: typeof IntersectionObserverMock }).IntersectionObserver =
    IntersectionObserverMock;
}

// React Testing Library's automatic cleanup is not reliable across all our
// test files (some have no `afterEach`, some run in vitest workers where the
// default registration is missed). Run it globally so every jsdom test
// starts with an empty document body and no leftover portals from previous
// renders (e.g. sonner <Toaster />).
afterEach(() => {
  cleanup();
});
