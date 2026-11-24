import type { ConceptPlanTarget } from "./contracts.mjs";

export function fingerprintBytes(buf: Buffer | null | undefined): string;
export function applyConceptPlan(conceptsDir: string, targets: readonly Pick<ConceptPlanTarget, "conceptId" | "beforeBytes" | "afterBytes">[]): { applied: number };
export function verifyConceptPlanAfterImages(conceptsDir: string, targets: readonly Pick<ConceptPlanTarget, "conceptId" | "beforeBytes" | "afterBytes">[]): {
  members: Array<{ id: string; state: "succeeded" | "failed" }>;
};
