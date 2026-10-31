// Release UX structure suite. Spec lucy-20261030-webui-release-ux-review.
// Separate from playwright.config.ts so e2e:contract:release does not collect it.

import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const BASE_URL = process.env.LUCY_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const PROJECT_DIR = process.env.LUCY_E2E_PROJECT_DIR ?? "/tmp/lucy-e2e-fixture";
const BACKEND_URL = process.env.LUCY_E2E_BACKEND_URL ?? BASE_URL;
const E2E_BIN = resolve(import.meta.dirname, "tests/e2e/fixtures/bin");
const REAL_PROJECT_DIR = resolve(import.meta.dirname, "..");

if (resolve(PROJECT_DIR) === REAL_PROJECT_DIR) {
  throw new Error(
    `Refusing to run E2E against real project dir. Set LUCY_E2E_PROJECT_DIR=/tmp/lucy-e2e-fixture`
  );
}

export default defineConfig({
  testDir: "./tests/release-ux",
  testMatch: "structure.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 10_000,
    navigationTimeout: 30_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } }
    }
  ],
  webServer: {
    command: "npm run dev",
    // Vite answers on 5173 before the API on 5174 is up. Wait for the API.
    url: "http://127.0.0.1:5174/api/auth/status",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      KTX_PROJECT_ROOT: PROJECT_DIR,
      LUCY_PROJECT_DIR: PROJECT_DIR,
      LUCY_E2E_PROJECT_DIR: PROJECT_DIR,
      LUCY_E2E_BACKEND_URL: BACKEND_URL,
      PATH: `${E2E_BIN}:${process.env.PATH ?? ""}`,
      LUCY_DEPLOYMENT_MODE: "development",
      LUCY_WEBUI_AUTH: "off",
      LUCY_WEBUI_HOST: "127.0.0.1",
      LUCY_CONTENT_ROOT: process.env.LUCY_E2E_CONTENT_ROOT ?? `${PROJECT_DIR}/config`
    },
    stdout: "pipe",
    stderr: "pipe"
  }
});
