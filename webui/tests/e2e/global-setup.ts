// webui/tests/e2e/global-setup.ts
// Browser contract fixture only: verify the instance we are about to drive is the disposable
// development + loopback fixture, not a reused customer/demo instance (reuseExistingServer may
// attach to whatever listens on the port). Real E2E (customer + auth required) never uses this file.

import type { FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("[contract-fixture] baseURL is not configured");

  const statusRes = await fetch(new URL("/api/auth/status", baseURL));
  const status = (await statusRes.json()) as { data?: { mode?: string } };
  if (status.data?.mode !== "open") {
    throw new Error(
      `[contract-fixture] ${baseURL} reports auth mode "${status.data?.mode ?? "unknown"}", expected "open" ` +
        `(LUCY_DEPLOYMENT_MODE=development, LUCY_WEBUI_AUTH=off, loopback). Stop the existing instance or point LUCY_E2E_BASE_URL at the fixture.`
    );
  }

  const projectRes = await fetch(new URL("/api/project", baseURL));
  const project = (await projectRes.json()) as { data?: { connections?: Array<{ id?: string }> } };
  const ids = (project.data?.connections ?? []).map((conn) => conn.id);
  if (!ids.includes("mysql-aliyun")) {
    throw new Error(
      `[contract-fixture] ${baseURL} serves connections [${ids.join(", ")}], expected the E2E fixture connection "mysql-aliyun" ` +
        `(run npm run e2e:fixture and start the server with LUCY_E2E_PROJECT_DIR).`
    );
  }
}
