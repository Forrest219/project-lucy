// Spec 174 §8 — production-build performance + behaviour config.
// Only `npm run perf:entry` may launch this config: it supplies the fixture
// server URL and token. There is no Vite dev / webServer fallback.
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PERF_BASE_URL;
if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL) || process.env.PERF_RUNNER !== "entry-performance") {
  throw new Error("entry-performance.config.ts must be launched by `npm run perf:entry` (fixture server URL missing).");
}

export default defineConfig({
  testDir: "..",
  testMatch: ["performance/entry-performance.spec.ts", "e2e/specs/entry-performance-behavior.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60 * 60 * 1000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: process.env.PERF_PLAYWRIGHT_JSON ?? "perf-playwright-results.json" }]],
  use: {
    baseURL: BASE_URL,
    trace: "off",
    screenshot: "off",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }
    }
  ]
});
