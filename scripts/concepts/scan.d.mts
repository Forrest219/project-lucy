import type { ConceptDocument, ConceptScanPlan } from "./contracts.mjs";

export function planScan(input: { contentRoot: string; whitelistPath?: string }): ConceptScanPlan;
export function summarizeConcept(concept: ConceptDocument, contentRoot: string): {
  id: string;
  label: string | undefined;
  canonical: string | null | undefined;
  candidates: number;
  rejected: number;
  conflicts: Array<Record<string, unknown>>;
  conflicts_status: "ok" | "degraded";
  stale: number;
};
