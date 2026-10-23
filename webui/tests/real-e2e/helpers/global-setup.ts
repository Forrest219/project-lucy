// Refuses to drive anything but a verified customer-mode, auth-required Lucy instance of the prepared run.
// Real E2E never attaches to a development/open instance, never runs with the contract-fixture KTX shim on PATH,
// and never points at a different base URL than run.json records.

import type { FullConfig } from "@playwright/test";
import { runContext } from "./run-context";

export default async function globalSetup(config: FullConfig): Promise<void> {
  const run = runContext();
  const baseURL = config.projects[0]?.use.baseURL;
  if (baseURL !== run.instance.baseUrl) {
    throw new Error(`[real-e2e] baseURL ${baseURL} does not match run.json ${run.instance.baseUrl}`);
  }
  if (process.env.LUCY_E2E_BASE_URL || process.env.LUCY_E2E_PROJECT_DIR) {
    throw new Error("[real-e2e] contract-fixture variables (LUCY_E2E_*) are set; refusing to mix fixture and real runs");
  }
  if ((process.env.PATH ?? "").split(":").some((entry) => entry.endsWith("tests/e2e/fixtures/bin"))) {
    throw new Error("[real-e2e] the contract-fixture KTX shim is on PATH; real E2E must use the real ktx");
  }

  const statusRes = await fetch(new URL("/api/auth/status", baseURL));
  const status = (await statusRes.json()) as { data?: { mode?: string } };
  const mode = status.data?.mode;
  if (mode !== "bootstrap" && mode !== "required") {
    throw new Error(`[real-e2e] ${baseURL} reports auth mode "${mode ?? "unknown"}"; real E2E requires customer mode with auth required`);
  }
}
