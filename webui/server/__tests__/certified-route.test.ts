/**
 * WO-202610-13 T3 / SC-13 — 认证路径.
 *
 * A published route runs through a role-scoped `lucy_query`; the answer names
 * the route and its source. A role that cannot read the source gets a
 * permission denial whose allow list stays inside that role's ACL. The
 * repository ships no customer route list — the test registers one fake route.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  certifiedRouteEnabled,
  listCertifiedRoutes,
  lookupCertifiedRoute,
  registerCertifiedRoute,
  resetCertifiedRoutesForTests,
  resolveCertifiedRoute,
} from "../proxy/certified-route.js";

const ROUTE = {
  routeId: "cdn_pnl_weekly",
  source: "demo.cdn_pnl",
  query: { measures: ["demo.cdn_pnl.revenue"], dimensions: [{ field: "demo.cdn_pnl.month" }] },
  version: "2026Q3"
};

const ANALYST_PERMISSIONS = {
  connections: ["demo"],
  sources: [{ sourceName: "cdn_pnl" }]
};

beforeEach(() => {
  resetCertifiedRoutesForTests();
});

describe("certified route", () => {
  it("returns the route and its source for a role that can read the source", () => {
    registerCertifiedRoute(ROUTE);
    const resolved = resolveCertifiedRoute(ROUTE.routeId, {
      readsSource: (source) => source === "demo.cdn_pnl",
      permissions: ANALYST_PERMISSIONS
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.route.routeId).toBe(ROUTE.routeId);
    expect(resolved.route.source).toBe("demo.cdn_pnl");
    expect(resolved.route.version).toBe("2026Q3");
  });

  it("denies with a permission reason when the role cannot read the source", () => {
    registerCertifiedRoute(ROUTE);
    const resolved = resolveCertifiedRoute(ROUTE.routeId, {
      readsSource: () => false,
      permissions: ANALYST_PERMISSIONS
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.decision).toBe("permission_denied");
    expect(resolved.reason).toBe("explicit_table_required:demo.cdn_pnl");
  });

  it("never puts a source outside the caller's ACL into the denial repair list", () => {
    registerCertifiedRoute(ROUTE);
    const resolved = resolveCertifiedRoute(ROUTE.routeId, {
      readsSource: () => false,
      permissions: ANALYST_PERMISSIONS
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.repair?.sources).toEqual(["cdn_pnl"]);
    expect(resolved.repair?.connections).toEqual(["demo"]);
    // The requested-but-forbidden source is not an "allowed" name.
    expect(resolved.repair?.sources).not.toContain("cdn_pnl_detail");
    expect(JSON.stringify(resolved.repair)).not.toContain("secret");
  });

  it("reports not_found for an unregistered route id", () => {
    const resolved = resolveCertifiedRoute("never_published", { readsSource: () => true });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.decision).toBe("not_found");
  });

  it("holds no customer route list in the repository by default", () => {
    expect(listCertifiedRoutes()).toEqual([]);
    expect(lookupCertifiedRoute("cdn_pnl_weekly")).toBeUndefined();
  });

  it("can be switched off, falling callers back to plain lucy_query", () => {
    registerCertifiedRoute(ROUTE);
    const previous = process.env.LUCY_CERTIFIED_ROUTE;
    process.env.LUCY_CERTIFIED_ROUTE = "off";
    const resolved = resolveCertifiedRoute(ROUTE.routeId, { readsSource: () => true });
    expect(certifiedRouteEnabled()).toBe(false);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.decision).toBe("not_found");
    if (previous === undefined) delete process.env.LUCY_CERTIFIED_ROUTE;
    else process.env.LUCY_CERTIFIED_ROUTE = previous;
  });
});