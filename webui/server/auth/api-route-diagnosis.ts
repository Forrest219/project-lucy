import { METHODS } from "node:http";
import type { FastifyInstance } from "fastify";

/**
 * D3 — match `/api/*` with the live Fastify router (find-my-way).
 * Dynamic params, query stripping and automatic HEAD come from that router.
 * This is not a second route inventory and it does not parse `printRoutes()`.
 */
const METHOD_ORDER = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

export type ApiRouteDiagnosis =
  | { kind: "match" }
  | { kind: "none" }
  | { kind: "method_not_allowed"; allowedMethods: string[] };

function pathOnly(url: string): string {
  const raw = url.split("?")[0] ?? url;
  return raw.split("#")[0] || "/";
}

function routerHas(app: FastifyInstance, method: string, url: string): boolean {
  try {
    return app.findRoute({ method, url }) != null;
  } catch {
    return false;
  }
}

function byRouterOrder(left: string, right: string): number {
  const leftRank = METHOD_ORDER.indexOf(left);
  const rightRank = METHOD_ORDER.indexOf(right);
  const leftScore = leftRank === -1 ? METHOD_ORDER.length : leftRank;
  const rightScore = rightRank === -1 ? METHOD_ORDER.length : rightRank;
  if (leftScore !== rightScore) return leftScore - rightScore;
  return left.localeCompare(right);
}

export function diagnoseApiRoute(app: FastifyInstance, method: string, url: string): ApiRouteDiagnosis {
  const normalized = method.toUpperCase();
  const urlPath = pathOnly(url);
  if (routerHas(app, normalized, urlPath)) return { kind: "match" };

  const allowedMethods: string[] = [];
  for (const candidate of METHODS) {
    if (candidate === normalized) continue;
    if (routerHas(app, candidate, urlPath)) allowedMethods.push(candidate);
  }
  if (allowedMethods.length === 0) return { kind: "none" };
  allowedMethods.sort(byRouterOrder);
  return { kind: "method_not_allowed", allowedMethods };
}
