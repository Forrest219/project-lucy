// Live demo Playwright config — drives an already-running Lucy (default :55176).
// No webServer, no API mocks. Secrets stay in external files / process memory only.
// Trace / screenshot / video are OFF so credentials cannot land in artifacts.

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.LUCY_E2E_BASE_URL ?? "http://127.0.0.1:55176";

export default defineConfig({
  testDir: "./tests/live-e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "off",
    screenshot: "off",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    viewport: { width: 1440, height: 900 }
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }
    }
  ]
});
