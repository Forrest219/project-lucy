import type { ConceptMutationPlan } from "./contracts.mjs";

export function planSetCanonical(input: { conceptsDir: string; conceptId: string; bindingId: string; summary: string }): ConceptMutationPlan;
export function planReject(input: { conceptsDir: string; conceptId: string; bindingId: string }): ConceptMutationPlan;
export { fingerprintBytes } from "./apply.mjs";
