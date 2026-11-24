import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  assertAuthorityInvariant,
  assertValidConceptId,
  CONCEPT_ID_RE,
  loadWhitelist,
  unionEvidence,
  maxConfidence,
  bindingIdFor,
  sameRef,
  deriveConflicts,
} from "./model.mjs";
import { conceptsDir } from "./content-root.mjs";

export function defaultWhitelistPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "seed-whitelist.yaml");
}

/**
 * D18 / P1-10 D20: conceptsDir must not be a symlink; prefer realpath when present.
 */
export function resolveFencedConceptsDir(contentRootOrDir, { create = false } = {}) {
  const dir = path.isAbsolute(contentRootOrDir) && path.basename(contentRootOrDir) === "concepts"
    ? contentRootOrDir
    : conceptsDir(contentRootOrDir);
  if (fs.existsSync(dir)) {
    if (fs.lstatSync(dir).isSymbolicLink()) {
      throw new Error(`conceptsDir must not be a symlink: ${dir}`);
    }
    return fs.realpathSync(dir);
  }
  if (create) {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.lstatSync(dir).isSymbolicLink()) {
      throw new Error(`conceptsDir must not be a symlink: ${dir}`);
    }
    return fs.realpathSync(dir);
  }
  return path.resolve(dir);
}

export function ensureConceptsDir(contentRoot) {
  return resolveFencedConceptsDir(contentRoot, { create: true });
}

function conceptPath(dir, id) {
  assertValidConceptId(id);
  return path.join(dir, `${id}.yaml`);
}

/** Reject path escape + symlink: realpath must stay under conceptsDir (D18). */
export function safeConceptPath(dir, id) {
  assertValidConceptId(id);
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) {
    throw new Error(`conceptsDir must not be a symlink: ${dir}`);
  }
  const absDir = fs.existsSync(dir) ? fs.realpathSync(dir) : path.resolve(dir);
  const lexical = path.resolve(absDir, `${id}.yaml`);
  if (!lexical.startsWith(absDir + path.sep) && lexical !== absDir) {
    throw new Error(`path escape blocked for concept id: ${id}`);
  }
  if (path.basename(lexical) !== `${id}.yaml`) {
    throw new Error(`path escape blocked for concept id: ${id}`);
  }
  if (fs.existsSync(lexical)) {
    if (fs.lstatSync(lexical).isSymbolicLink()) {
      throw new Error(`concept file must not be a symlink: ${id}`);
    }
    const realFile = fs.realpathSync(lexical);
    if (!realFile.startsWith(absDir + path.sep)) {
      throw new Error(`path escape blocked for concept id: ${id}`);
    }
    if (path.basename(realFile) !== `${id}.yaml`) {
      throw new Error(`path escape blocked for concept id: ${id}`);
    }
    return realFile;
  }
  return lexical;
}

/** Raw UTF-8 bytes for recoverable before-image; null if absent. */
export function readConceptBytes(dir, id) {
  const file = safeConceptPath(dir, id);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file);
}

export function readConcept(dir, id) {
  const file = safeConceptPath(dir, id);
  if (!fs.existsSync(file)) return null;
  const doc = parseYaml(fs.readFileSync(file, "utf8"));
  if (!doc || doc.id !== id) {
    throw new Error(`concept id mismatch: file ${id}.yaml has id=${JSON.stringify(doc?.id)}`);
  }
  assertAuthorityInvariant(doc);
  return doc;
}

export function listConceptIds(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.slice(0, -5))
    .filter((id) => CONCEPT_ID_RE.test(id))
    .sort();
}

/**
 * Atomic write: temp in same dir → fsync → rename → fsync dir (best-effort).
 */
export function writeConceptAtomic(dir, concept) {
  assertValidConceptId(concept.id);
  assertAuthorityInvariant(concept);
  fs.mkdirSync(dir, { recursive: true });
  const target = safeConceptPath(dir, concept.id);
  const tmp = path.join(dir, `.${concept.id}.${process.pid}.${Date.now()}.tmp`);
  const body = stringifyYaml(concept, { lineWidth: 120 });
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, body, undefined, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
  try {
    const dfd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(dfd);
    } finally {
      fs.closeSync(dfd);
    }
  } catch {
    // best-effort on platforms that cannot fsync directories
  }
  return target;
}

export function emptyConceptFromWhitelist(entry) {
  return {
    id: entry.id,
    label: entry.label || entry.id,
    aliases: [...entry.aliases],
    domain: entry.domain || null,
    canonical: null,
    bindings: [],
    updated_at: new Date().toISOString(),
  };
}

export function seedFromWhitelist(dir, whitelistDoc) {
  const entries = loadWhitelist(whitelistDoc);
  const created = [];
  for (const entry of entries) {
    const existing = readConcept(dir, entry.id);
    if (existing) continue;
    const concept = emptyConceptFromWhitelist(entry);
    writeConceptAtomic(dir, concept);
    created.push(entry.id);
  }
  return created;
}

export function loadWhitelistFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return parseYaml(raw);
}

/**
 * Merge discovered binding into concept respecting authority rules.
 * Returns {concept, changed, action}.
 */
export function mergeBinding(concept, discovered) {
  const next = structuredClone(concept);
  const existing = (next.bindings || []).find((b) => b.bindingId === discovered.bindingId);
  const now = new Date().toISOString();

  if (!existing) {
    // New binding
    if (discovered.role === "candidate") {
      if (!discovered.evidence?.length) {
        return { concept, changed: false, action: "skip_empty_evidence" };
      }
    }
    next.bindings = [...(next.bindings || []), { ...discovered, updated_at: now }];
    next.updated_at = now;
    return { concept: next, changed: true, action: "add" };
  }

  if (existing.role === "rejected") {
    return { concept, changed: false, action: "preserve_rejected" };
  }

  if (existing.role === "canonical") {
    // Keep role/summary/canonical; evidence append-only
    const evidence = unionEvidence(existing.evidence, discovered.evidence);
    const confidence = maxConfidence(evidence, existing.confidence);
    if (evidence.length === (existing.evidence || []).length && confidence === existing.confidence) {
      return { concept, changed: false, action: "canonical_unchanged" };
    }
    const refreshed = {
      ...existing,
      evidence,
      confidence,
      role: "canonical",
      updated_at: now,
      matched_at: discovered.matched_at || existing.matched_at,
    };
    next.bindings = next.bindings.map((b) => (b.bindingId === existing.bindingId ? refreshed : b));
    // concept.summary and concept.canonical must stay untouched
    next.updated_at = now;
    return { concept: next, changed: true, action: "refresh_canonical_meta" };
  }

  // existing candidate: union evidence, bump confidence
  const evidence = unionEvidence(existing.evidence, discovered.evidence);
  const confidence = maxConfidence(evidence, existing.confidence || discovered.confidence);
  const refreshed = {
    ...existing,
    evidence,
    confidence,
    role: "candidate",
    updated_at: now,
    matched_at: discovered.matched_at || existing.matched_at,
  };
  next.bindings = next.bindings.map((b) => (b.bindingId === existing.bindingId ? refreshed : b));
  next.updated_at = now;
  return { concept: next, changed: true, action: "merge_candidate" };
}

export function computeSetCanonical(concept, bindingId, summary) {
  if (!concept) throw new Error("concept not found");
  const binding = (concept.bindings || []).find((b) => b.bindingId === bindingId);
  if (!binding) throw new Error(`binding not found: ${bindingId}`);
  if (binding.role === "rejected") throw new Error(`cannot promote rejected binding: ${bindingId}`);
  if (typeof summary !== "string" || !summary.trim()) {
    throw new Error("set-canonical requires non-empty --summary");
  }

  const next = structuredClone(concept);
  next.bindings = next.bindings.map((b) => {
    if (b.bindingId === bindingId) return { ...b, role: "canonical" };
    if (b.role === "canonical") return { ...b, role: "candidate" };
    return b;
  });
  next.canonical = bindingId;
  next.summary = summary.trim();
  next.updated_at = new Date().toISOString();
  assertAuthorityInvariant(next);
  return next;
}

export function computeRejectBinding(concept, bindingId) {
  if (!concept) throw new Error("concept not found");
  const binding = (concept.bindings || []).find((b) => b.bindingId === bindingId);
  if (!binding) throw new Error(`binding not found: ${bindingId}`);

  const next = structuredClone(concept);
  if (next.canonical === bindingId) {
    next.canonical = null;
  }
  next.bindings = next.bindings.map((b) => {
    if (b.bindingId !== bindingId) return b;
    return { ...b, role: "rejected", updated_at: new Date().toISOString() };
  });
  next.updated_at = new Date().toISOString();
  assertAuthorityInvariant(next);
  return next;
}

export function conceptToYamlBytes(concept) {
  assertValidConceptId(concept.id);
  assertAuthorityInvariant(concept);
  return Buffer.from(stringifyYaml(concept, { lineWidth: 120 }), "utf8");
}

export function setCanonical(dir, conceptId, bindingId, summary) {
  const concept = readConcept(dir, conceptId);
  if (!concept) throw new Error(`concept not found: ${conceptId}`);
  const next = computeSetCanonical(concept, bindingId, summary);
  writeConceptAtomic(dir, next);
  return next;
}

export function rejectBinding(dir, conceptId, bindingId) {
  const concept = readConcept(dir, conceptId);
  if (!concept) throw new Error(`concept not found: ${conceptId}`);
  const next = computeRejectBinding(concept, bindingId);
  writeConceptAtomic(dir, next);
  return next;
}

export { deriveConflicts, bindingIdFor, sameRef, parseYaml };
