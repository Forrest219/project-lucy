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
