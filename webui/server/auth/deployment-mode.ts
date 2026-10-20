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

/** Customer access mode from the instance config. Empty means the Secure default. */
export function resolveWebAccess(): "http" | "https" | undefined {
  const raw = (process.env.LUCY_WEBUI_ACCESS ?? "").trim().toLowerCase();
  if (raw === "") return undefined;
  if (raw === "http" || raw === "https") return raw;
  throw new Error(`Invalid LUCY_WEBUI_ACCESS=${JSON.stringify(process.env.LUCY_WEBUI_ACCESS)}; expected http or https`);
}

/**
 * Spec §3.1 item 8. `customer` defaults to Secure cookies.
 * `LUCY_WEBUI_ACCESS=http` is the explicit intranet HTTP customer mode and serves
 * non-Secure cookies without the test-profile marker.
 * `LUCY_WEBUI_COOKIE_SECURE=0` is otherwise a startup error unless the lab test
 * profile (`LUCY_WEBUI_TEST_PROFILE=1`) is declared. `development` stays opt-in.
 */
export function resolveCookieSecure(): CookiePolicy {
  const explicit = parseFlag("LUCY_WEBUI_COOKIE_SECURE");
  const access = resolveWebAccess();
  const testProfile = parseFlag("LUCY_WEBUI_TEST_PROFILE") === true;
  if (resolveDeploymentMode() === "development") {
    return { secure: explicit ?? false, insecureTestProfile: false };
  }
  if (testProfile && access === "http") {
    throw new Error("LUCY_WEBUI_ACCESS=http cannot be combined with LUCY_WEBUI_TEST_PROFILE");
  }
  if (access === "http") {
    if (explicit === true) {
      throw new Error("LUCY_WEBUI_COOKIE_SECURE=1 contradicts LUCY_WEBUI_ACCESS=http");
    }
    return { secure: false, insecureTestProfile: false };
  }
  if (explicit !== false) return { secure: true, insecureTestProfile: false };
  if (testProfile) return { secure: false, insecureTestProfile: true };
  throw new Error(
    "LUCY_WEBUI_COOKIE_SECURE=0 is not allowed when LUCY_DEPLOYMENT_MODE=customer (default); " +
      "set LUCY_WEBUI_ACCESS=http for intranet HTTP, or LUCY_WEBUI_TEST_PROFILE=1 for a lab test profile"
  );
}

export function skillsPassthroughRequested(): boolean {
  return ["1", "true", "yes"].includes((process.env.LUCY_PROXY_SKILLS_PASSTHROUGH ?? "").trim().toLowerCase());
}

/**
 * Spec §3.3 / Plan T04 step 5: the legacy `/mcp/skills` passthrough has no
 * per-object ACL, so customer mode must keep it closed. Enabling it there is a
 * startup error rather than a silently ignored setting.
 */
export function assertSkillsPassthroughPolicy(): void {
  if (resolveDeploymentMode() === "customer" && skillsPassthroughRequested()) {
    throw new Error(
      "LUCY_PROXY_SKILLS_PASSTHROUGH is not allowed when LUCY_DEPLOYMENT_MODE=customer (default); " +
        "the legacy /mcp/skills passthrough has no per-object ACL"
    );
  }
}

/**
 * Startup preflight (Spec §3.1 items 1, 8; Plan T02 step 7, T04 step 5). Throws so the process
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
  assertSkillsPassthroughPolicy();
}
