/**
 * Spec 162 §7.8 / WO-202610-13 T3 + T9 — 认证路径 (Certified Route) and the
 * single P&L template pilot.
 *
 * Execution always runs through a role-scoped `lucy_query`; a route never
 * grants access on its own. A role that cannot read the route's source gets a
 * permission denial carrying only ACL-visible names.
 *
 * The repository ships no customer route list and no customer measure YAML.
 * `registerCertifiedRoute` is the hook the customer's published routes call;
 * the test suite registers one fake route, and `registerReportTemplate`
 * refuses a second template id until a before/after comparison is recorded.
 */

import { denialAllowList } from "./question-experience.js";

export type CertifiedRoute = {
  routeId: string;
  source: string;
  query: Record<string, unknown>;
  /** Adopted version when the published route declares one. */
  version?: string;
};

export type ReportTemplate = {
  templateId: string;
  source: string;
  version?: string;
};

export type RouteDenial = {
  ok: false;
  decision: "permission_denied";
  reason: string;
  repair: { connections: string[]; sources: string[] } | null;
};

export type CertifiedRouteExecution =
  | RouteDenial
  | {
    ok: false;
    decision: "not_found";
    reason: "certified_route_not_found";
  };

const routes = new Map<string, CertifiedRoute>();

/** Repo-local allow list. T9: exactly one template id until a comparison exists. */
export const PILOT_TEMPLATE_ID = "public_cloud_pnl_quarterly";
const templates = new Map<string, ReportTemplate>();
let comparisonRecorded = false;

export function certifiedRouteEnabled(): boolean {
  return process.env.LUCY_CERTIFIED_ROUTE !== "off";
}

export function pilotTemplateEnabled(): boolean {
  return process.env.LUCY_PILOT_TEMPLATE !== "off";
}

export function registerCertifiedRoute(route: CertifiedRoute): void {
  if (!route.routeId || !route.source || !route.query) {
    throw new Error("certified_route_incomplete");
  }
  routes.set(route.routeId, route);
}

export function listCertifiedRoutes(): CertifiedRoute[] {
  return [...routes.values()];
}

export function resetCertifiedRoutesForTests(): void {
  routes.clear();
  templates.clear();
  comparisonRecorded = false;
}

export function lookupCertifiedRoute(routeId: string): CertifiedRoute | undefined {
  return routes.get(routeId);
}

/**
 * §7.8 gate: the route must exist and the role must be able to read its
 * source. `roleReadsSource` is supplied by the caller from effective
 * permissions — this module never widens ACL itself.
 */
export function resolveCertifiedRoute(
  routeId: string,
  role: { readsSource: (source: string) => boolean; permissions?: Parameters<typeof denialAllowList>[0] },
): CertifiedRouteExecution | { ok: true; route: CertifiedRoute } {
  if (!certifiedRouteEnabled()) return { ok: false, decision: "not_found", reason: "certified_route_not_found" };
  const route = routes.get(routeId);
  if (!route) return { ok: false, decision: "not_found", reason: "certified_route_not_found" };
  if (!role.readsSource(route.source)) {
    return {
      ok: false,
      decision: "permission_denied",
      reason: `explicit_table_required:${route.source}`,
      repair: role.permissions ? denialAllowList(role.permissions) : null
    };
  }
  return { ok: true, route };
}

export function registerReportTemplate(template: ReportTemplate): void {
  if (!pilotTemplateEnabled()) return;
  if (template.templateId !== PILOT_TEMPLATE_ID) {
    throw new Error("pilot_template_scope_violation");
  }
  if (templates.has(template.templateId) && !comparisonRecorded) {
    throw new Error("pilot_template_already_registered");
  }
  templates.set(template.templateId, template);
}

export function lookupReportTemplate(templateId: string): ReportTemplate | undefined {
  return templates.get(templateId);
}

export function listReportTemplates(): ReportTemplate[] {
  return [...templates.values()];
}

/** T9 gate: a second template id needs a recorded before/after comparison. */
export function recordTemplateComparison(reference: string): void {
  if (!reference.trim()) throw new Error("template_comparison_reference_required");
  comparisonRecorded = true;
}

export function templateComparisonRecorded(): boolean {
  return comparisonRecorded;
}