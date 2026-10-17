export type DeploymentMode = "customer" | "development";

/**
 * Spec §3.1 item 1: `LUCY_DEPLOYMENT_MODE=customer|development`, default `customer`.
 * Any other value is a startup error so a typo can never silently relax auth.
 */
export function resolveDeploymentMode(): DeploymentMode {
  const raw = (process.env.LUCY_DEPLOYMENT_MODE ?? "").trim().toLowerCase();
  if (raw === "") return "customer";
  if (raw === "customer" || raw === "development") return raw;
  throw new Error(
    `Invalid LUCY_DEPLOYMENT_MODE=${JSON.stringify(process.env.LUCY_DEPLOYMENT_MODE)}; expected "customer" or "development"`
  );
}

export type CookiePolicy = {
  /** Whether the session cookie carries `Secure` (and HSTS is sent). */
  secure: boolean;
  /** True only for the explicit customer-mode test profile running without Secure cookies. */
  insecureTestProfile: boolean;
};

function parseFlag(name: string): boolean | undefined {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (raw === "") return undefined;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  throw new Error(`Invalid ${name}=${JSON.stringify(process.env[name])}; expected 1 or 0`);
}

/**
 * Spec §3.1 item 8. `customer` defaults to Secure cookies; `LUCY_WEBUI_COOKIE_SECURE=0`
 * is a startup error unless the explicit test profile (`LUCY_WEBUI_TEST_PROFILE=1`:
 * HTTP-only compose demo / k3s test Chart) is declared. `development` stays opt-in.
 */
export function resolveCookieSecure(): CookiePolicy {
  const explicit = parseFlag("LUCY_WEBUI_COOKIE_SECURE");
  if (resolveDeploymentMode() === "development") {
    return { secure: explicit ?? false, insecureTestProfile: false };
  }
  if (explicit !== false) return { secure: true, insecureTestProfile: false };
  if (parseFlag("LUCY_WEBUI_TEST_PROFILE") === true) return { secure: false, insecureTestProfile: true };
  throw new Error(
    "LUCY_WEBUI_COOKIE_SECURE=0 is not allowed when LUCY_DEPLOYMENT_MODE=customer (default); " +
      "only the explicit test profile (LUCY_WEBUI_TEST_PROFILE=1) may serve HTTP"
  );
}

/**
 * Startup preflight (Spec §3.1 items 1, 8; Plan T02 step 7). Throws so the process
 * refuses to start when the effective mode contradicts what the Chart pinned
 * (e.g. an `extraEnvFrom` Secret that supplies LUCY_DEPLOYMENT_MODE=development)
 * or the cookie policy is unsafe.
 */
export function assertStartupPolicy(): void {
  const effective = resolveDeploymentMode();
  const pinned = (process.env.LUCY_CHART_DEPLOYMENT_MODE ?? "").trim().toLowerCase();
  if (pinned !== "" && pinned !== effective) {
    throw new Error(
      `LUCY_DEPLOYMENT_MODE=${effective} contradicts the Chart-pinned mode ${pinned}; ` +
        "remove the override (for example from extraEnvFrom)"
    );
  }
  resolveCookieSecure();
}
