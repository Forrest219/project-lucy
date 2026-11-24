import { execFileSync } from "node:child_process";
import type { APIRequestContext, Page } from "@playwright/test";

export type ExecutionSlice = {
  activation?: string;
  reload?: { state?: string; requestId?: string };
  verification?: { state?: string };
  unknownConnections?: string[];
  missingConnections?: string[];
  loadedConnectionIds?: string[];
};

export type RuntimeStatusBody = {
  ok?: boolean;
  data?: {
    execution?: ExecutionSlice;
    config?: { connectionIds?: string[]; ktxYamlDigest?: string };
  };
};

const CONTAINER = process.env.LUCY_E2E_LUCY_CONTAINER ?? "compose-lucy-1";

export async function loginViaUi(
  page: Page,
  login: { adminId: string; password: string }
): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("例：lucy").fill(login.adminId);
  await page.locator("#login-password").fill(login.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

export async function fetchRuntimeStatus(request: APIRequestContext): Promise<RuntimeStatusBody> {
  const res = await request.get("/api/admin/mcp-runtime/status");
  if (!res.ok()) {
    throw new Error(`mcp-runtime/status HTTP ${res.status()}`);
  }
  return (await res.json()) as RuntimeStatusBody;
}

export function executionOf(body: RuntimeStatusBody): ExecutionSlice {
  return body.data?.execution ?? {};
}

/** Force digest mismatch so UI shows reload_required (live container only). */
export function bumpKtxYamlDigestInContainer(): void {
  execFileSync(
    "docker",
    [
      "exec",
      CONTAINER,
      "sh",
      "-c",
      'printf "\\n# live-e2e-reload-bump %s\\n" "$(date -u +%Y%m%dT%H%M%SZ)" >> /data/lucy/ktx.yaml'
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
}

export async function waitForActivationCurrent(
  request: APIRequestContext,
  opts: {
    connectionId?: string;
    timeoutMs?: number;
    intervalMs?: number;
  } = {}
): Promise<ExecutionSlice> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  let last: ExecutionSlice = {};
  while (Date.now() < deadline) {
    const body = await fetchRuntimeStatus(request);
    last = executionOf(body);
    const unknown = last.unknownConnections ?? [];
    const missing = last.missingConnections ?? [];
    const idOk =
      !opts.connectionId ||
      (!unknown.includes(opts.connectionId) && !missing.includes(opts.connectionId));
    if (last.activation === "current" && idOk) {
      return last;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `timeout waiting activation=current` +
      (opts.connectionId ? ` for ${opts.connectionId}` : "") +
      `; last=${JSON.stringify(last)}`
  );
}

export async function removeConnection(
  request: APIRequestContext,
  connectionId: string
): Promise<void> {
  const res = await request.post(`/api/connections/${encodeURIComponent(connectionId)}/remove`, {
    data: { dryRun: false, deleteSecret: true }
  });
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`remove ${connectionId} failed HTTP ${res.status()}: ${text.slice(0, 200)}`);
  }
}
