// webui/playwright.config.ts
// 关联主文档：docs/qa/lucy-webui-e2e-test-suite.md §2.3
// 真实可跑配置；所有 selector 引用必须与 docs/qa/selector-contract.md 一致
// 真实项目仓库只读：WebUI 进程通过 LUCY_PROJECT_DIR 指向 /tmp/lucy-e2e-fixture

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.LUCY_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const PROJECT_DIR = process.env.LUCY_E2E_PROJECT_DIR ?? "/tmp/lucy-e2e-fixture";
const BACKEND_URL = process.env.LUCY_E2E_BACKEND_URL ?? BASE_URL;

if (PROJECT_DIR === "/Users/zhangxingchen/Projects/project-lucy") {
  throw new Error(
    `Refusing to run E2E against real project dir. Set LUCY_E2E_PROJECT_DIR=/tmp/lucy-e2e-fixture`
  );
}

export default defineConfig({
  testDir: "./tests/e2e/specs",
  // L3 跑 L1+L2+L3；L1 单独用 --grep @pr-smoke
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["json", { outputFile: "results.json" }],
  ],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    extraHTTPHeaders: {
      "x-e2e-run": process.env.LUCY_E2E_RUN_ID ?? "manual",
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "chromium-narrow", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // 同时设 KTX_PROJECT_ROOT（server resolveProjectRoot 读这个）和 LUCY_PROJECT_DIR
      KTX_PROJECT_ROOT: PROJECT_DIR,
      LUCY_PROJECT_DIR: PROJECT_DIR,
      LUCY_E2E_PROJECT_DIR: PROJECT_DIR,
      LUCY_E2E_BACKEND_URL: BACKEND_URL,
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
