/**
 * Pure plan helpers for set_canonical / reject (no disk writes).
 * Scan planning lives in scan.mjs (`planScan`) to avoid circular imports with discovery.
 */
import {
  readConcept,
  readConceptBytes,
  computeSetCanonical,
  computeRejectBinding,
  conceptToYamlBytes,
  resolveFencedConceptsDir,
} from "./store.mjs";
import { fingerprintBytes } from "./apply.mjs";

function conceptTarget(dir, conceptId, beforeBytes, afterConcept) {
  const afterBytes = conceptToYamlBytes(afterConcept);
  return {
    conceptId,
    beforeBytes,
    afterBytes,
    beforeFingerprint: fingerprintBytes(beforeBytes),
    afterFingerprint: fingerprintBytes(afterBytes),
  };
}

export function planSetCanonical({ conceptsDir, conceptId, bindingId, summary }) {
  const dir = resolveFencedConceptsDir(conceptsDir);
  const beforeBytes = readConceptBytes(dir, conceptId);
  const concept = readConcept(dir, conceptId);
  if (!concept) throw new Error(`concept not found: ${conceptId}`);
  const next = computeSetCanonical(concept, bindingId, summary);
  return {
    conceptsDir: dir,
    targets: [conceptTarget(dir, conceptId, beforeBytes, next)],
    resultConcept: next,
  };
}

export function planReject({ conceptsDir, conceptId, bindingId }) {
  const dir = resolveFencedConceptsDir(conceptsDir);
  const beforeBytes = readConceptBytes(dir, conceptId);
  const concept = readConcept(dir, conceptId);
  if (!concept) throw new Error(`concept not found: ${conceptId}`);
  const next = computeRejectBinding(concept, bindingId);
  return {
    conceptsDir: dir,
    targets: [conceptTarget(dir, conceptId, beforeBytes, next)],
    resultConcept: next,
  };
}

export { conceptTarget, fingerprintBytes };
