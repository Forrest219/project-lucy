/** Typed boundary for the concept CLI modules consumed by the WebUI adapters. */
export interface ConceptDocument {
  id: string;
  label?: string;
  canonical?: string | null;
  aliases?: string[];
  bindings?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ConceptPlanTarget {
  conceptId: string;
  beforeBytes: Buffer | null;
  afterBytes: Buffer;
  beforeFingerprint: string;
  afterFingerprint: string;
}

export interface ConceptMutationPlan {
  conceptsDir: string;
  targets: ConceptPlanTarget[];
  resultConcept: ConceptDocument;
}

export interface ConceptScanStats {
  concepts: number;
  added: number;
  merged: number;
  preserved_rejected: number;
  conflicts: number;
  degraded: number;
}

export interface ConceptScanPlan {
  contentRoot: string;
  conceptsDir: string;
  whitelistPath: string;
  targets: ConceptPlanTarget[];
  stats: ConceptScanStats;
}
