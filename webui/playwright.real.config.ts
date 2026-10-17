// webui/playwright.real.config.ts
// Real-user E2E (Spec §6.1 user-e2e layer, §6.4). Drives an ALREADY VERIFIED Lucy instance in customer mode with
// auth required: no webServer, no API mocking, no KTX shim, one worker, no retries (a retry would hide a failure,
// Spec §8.1), desktop Chromium 1440x900 only (no narrow/mobile baseline for this release).
//
// Secrets (bootstrap key, passwords, Agent tokens) travel only through helpers/secret-capture.ts. Therefore
// trace, screenshots and video are OFF for every test; evidence comes from assertions and server-side records.
// scripts/e2e/__tests__/real-e2e-guard.test.mjs fails if any of these guarantees is weakened.

import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const runJsonPath = process.env.LUCY_REAL_E2E_RUN;
if (!runJsonPath) {
  throw new Error("LUCY_REAL_E2E_RUN must point at <runDir>/run.json (see scripts/e2e/prepare-environment.mjs)");
}
const run = JSON.parse(readFileSync(runJsonPath, "utf8")) as {
  contract: string;
  paths: { runDir: string };
  instance: { baseUrl: string };
};
if (run.contract !== "lucy-e2e-run-v1") {
  throw new Error(`${runJsonPath} is not a lucy-e2e-run-v1 file`);
}

export default defineConfig({
  testDir: "./tests/real-e2e",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./tests/real-e2e/helpers/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(run.paths.runDir, "results", "management-playwright.json") }]
  ],
  outputDir: path.join(run.paths.runDir, "results", "playwright-output"),
  use: {
    baseURL: run.instance.baseUrl,
    trace: "off",
    screenshot: "off",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    viewport: { width: 1440, height: 900 }
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }
  ]
});
