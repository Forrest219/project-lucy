import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const file = process.env.LUCY_REAL_E2E_RUN;
if (!file) throw new Error("LUCY_REAL_E2E_RUN must identify a prepared upgrade run");
const run = JSON.parse(readFileSync(file, "utf8"));
if (run.contract !== "lucy-e2e-run-v1" || !run.upgrade || run.executionMode !== "local" || run.instance.startedBy !== "runner" || run.releaseEligible !== false || run.paths.project !== path.join(run.paths.runDir, "project")) throw new Error("not an upgrade fixture run");

export default defineConfig({
  testDir: "./tests/upgrade-e2e",
  globalSetup: "./tests/real-e2e/helpers/global-setup.ts",
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: true,
  timeout: 90_000, expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: path.join(run.paths.runDir, "results/upgrade-playwright.json") }]],
  outputDir: path.join(run.paths.runDir, "results/upgrade-output"),
  use: { baseURL: run.instance.baseUrl, viewport: { width: 1440, height: 900 }, trace: "off", screenshot: "off", video: "off" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }]
});
