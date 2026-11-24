export const CONCEPT_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;

const CONF_RANK = { high: 3, medium: 2, low: 1 };

export function assertValidConceptId(id) {
  if (typeof id !== "string" || !CONCEPT_ID_RE.test(id)) {
    throw new Error(`invalid concept id: ${JSON.stringify(id)}`);
  }
}

export function normalizeAlias(s) {
  return String(s ?? "").trim().toLowerCase();
}

/** Left/right boundary: start/end or non letter/number/CJK */
function isBoundaryChar(ch) {
  if (!ch) return true;
  return !/[\p{L}\p{N}\u4e00-\u9fff]/u.test(ch);
}

export function exactField(alias, field) {
  return normalizeAlias(alias) === normalizeAlias(field);
}

export function boundedField(alias, field) {
  const a = normalizeAlias(alias);
  const f = normalizeAlias(field);
  if (!a || !f) return false;
  let idx = 0;
  while ((idx = f.indexOf(a, idx)) !== -1) {
    const before = idx === 0 ? "" : f[idx - 1];
    const after = idx + a.length >= f.length ? "" : f[idx + a.length];
    if (isBoundaryChar(before) && isBoundaryChar(after)) return true;
    idx += 1;
  }
  return false;
}

export function identifierTokenMatch(alias, field) {
  const a = normalizeAlias(alias);
  const tokens = normalizeAlias(field)
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .filter(Boolean);
  return tokens.includes(a);
}

export function bindingIdFor(kind, ref) {
  if (kind === "measure") {
    return `measure:${ref.connectionId}/${ref.sourceName}/${ref.measureKey}`;
  }
  if (kind === "source") {
    return `source:${ref.connectionId}/${ref.sourceName}`;
  }
  if (kind === "wiki") {
    return `wiki:${ref.relPath}`;
  }
  throw new Error(`unsupported kind: ${kind}`);
}

export function sameRef(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "measure") {
    return (
      a.ref.connectionId === b.ref.connectionId
      && a.ref.sourceName === b.ref.sourceName
      && a.ref.measureKey === b.ref.measureKey
    );
  }
  if (a.kind === "source") {
    return a.ref.connectionId === b.ref.connectionId && a.ref.sourceName === b.ref.sourceName;
  }
  if (a.kind === "wiki") {
    return a.ref.relPath === b.ref.relPath;
  }
  return false;
}

export function assertAuthorityInvariant(concept) {
  const canonicalRoles = (concept.bindings || []).filter((b) => b.role === "canonical");
  if (concept.canonical == null || concept.canonical === "") {
    if (canonicalRoles.length !== 0) {
      throw new Error(`authority invariant broken: canonical=null but ${canonicalRoles.length} canonical roles`);
    }
    return;
  }
  if (canonicalRoles.length !== 1) {
    throw new Error(`authority invariant broken: expected 1 canonical role, got ${canonicalRoles.length}`);
  }
  if (canonicalRoles[0].bindingId !== concept.canonical) {
    throw new Error(
      `authority invariant broken: pointer ${concept.canonical} != role ${canonicalRoles[0].bindingId}`,
    );
  }
}

export function assertSingleCanonical(concept) {
  assertAuthorityInvariant(concept);
}

export function rejectEmptyEvidence(binding) {
  if (!Array.isArray(binding.evidence) || binding.evidence.length === 0) {
    throw new Error("empty evidence cannot become candidate");
  }
}

export function maxConfidence(evidences, fallback) {
  let best = fallback || "low";
  for (const e of evidences || []) {
    const c = e.confidence || fallback;
    if ((CONF_RANK[c] || 0) > (CONF_RANK[best] || 0)) best = c;
  }
  return best;
}

/**
 * Deterministic match of alias against a labeled field.
 * Returns {confidence, role} or null.
 */
export function matchField(alias, fieldValue, fieldKind) {
  if (fieldValue == null || fieldValue === "") return null;
  const exact = exactField(alias, fieldValue) || identifierTokenMatch(alias, fieldValue);
  const bounded = !exact && boundedField(alias, fieldValue);

  if (fieldKind === "measure_key" || fieldKind === "source_name" || fieldKind === "wiki_title") {
    if (exact) return { confidence: "high", role: "candidate" };
    return null;
  }
  if (fieldKind === "measure_description" || fieldKind === "table_description_db") {
    if (exact || bounded) return { confidence: "medium", role: "candidate" };
    return null;
  }
  // wiki body: ignore
  return null;
}

export function currentlyMatches(binding, conceptAliases, readAssetFields) {
  if (!binding || binding.role === "rejected") return false;
  let fields;
  try {
    fields = readAssetFields(binding);
  } catch {
    return "unknown";
  }
  if (fields === null) return false; // absent
  if (fields === undefined) return "unknown";

  for (const alias of conceptAliases) {
    for (const { value, kind } of fields) {
      const hit = matchField(alias, value, kind);
      if (!hit) continue;
      if (hit.role === "candidate") {
        const rankHit = CONF_RANK[hit.confidence] || 0;
        const rankDisk = CONF_RANK[binding.confidence] || 0;
        if (rankHit >= rankDisk && rankHit >= CONF_RANK.high) return true;
        if (binding.confidence === "medium" && rankHit >= CONF_RANK.medium) return true;
        if (rankHit >= CONF_RANK.high) return true;
      }
    }
  }
  // For high candidates require high rematch; for medium require medium+
  for (const alias of conceptAliases) {
    for (const { value, kind } of fields) {
      const hit = matchField(alias, value, kind);
      if (!hit) continue;
      if (binding.confidence === "high" && hit.confidence === "high") return true;
      if (binding.confidence === "medium" && (hit.confidence === "medium" || hit.confidence === "high")) {
        return true;
      }
    }
  }
  return false;
}

export function deriveConflicts(concept, { assetStatus, rematch } = {}) {
  const conflicts = [];
  let degraded = false;
  const aliases = concept.aliases || [];

  const liveHigh = [];
  for (const b of concept.bindings || []) {
    if (b.role !== "candidate" || b.confidence !== "high") continue;
    const st = assetStatus?.(b);
    if (st === "unknown") {
      degraded = true;
      continue;
    }
    if (st === "absent") continue;
    const match = rematch ? rematch(b, aliases) : true;
    if (match === "unknown") {
      degraded = true;
      continue;
    }
    if (match) liveHigh.push(b);
  }

  if ((concept.canonical == null || concept.canonical === "") && liveHigh.length >= 2) {
    conflicts.push({ code: "needs_authority", bindingIds: liveHigh.map((b) => b.bindingId) });
  }

  if (concept.canonical) {
    const canon = (concept.bindings || []).find((b) => b.bindingId === concept.canonical);
    if (!canon) {
      conflicts.push({ code: "broken_canonical", bindingId: concept.canonical });
    } else {
      const st = assetStatus?.(canon);
      if (st === "absent") {
        conflicts.push({ code: "broken_canonical", bindingId: concept.canonical });
      } else if (st === "unknown") {
        degraded = true;
      }
    }
  }

  return { conflicts, conflicts_status: degraded ? "degraded" : "ok" };
}

export function loadWhitelist(doc) {
  const concepts = doc?.concepts;
  if (!Array.isArray(concepts) || concepts.length === 0) {
    throw new Error("whitelist missing concepts[]");
  }
  for (const c of concepts) {
    assertValidConceptId(c.id);
    if (!Array.isArray(c.aliases) || c.aliases.length === 0) {
      throw new Error(`whitelist ${c.id} missing aliases`);
    }
  }
  return concepts;
}

export function unionEvidence(existing = [], incoming = []) {
  const out = [...existing];
  const key = (e) => `${e.type}|${e.path}|${e.alias}|${e.field}|${e.snippet}`;
  const seen = new Set(out.map(key));
  for (const e of incoming) {
    const k = key(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}
