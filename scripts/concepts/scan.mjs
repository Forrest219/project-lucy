import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  matchField,
  bindingIdFor,
  rejectEmptyEvidence,
  currentlyMatches,
  deriveConflicts,
  normalizeAlias,
} from "./model.mjs";
import {
  ensureConceptsDir,
  readConcept,
  writeConceptAtomic,
  seedFromWhitelist,
  loadWhitelistFile,
  defaultWhitelistPath,
  mergeBinding,
  listConceptIds,
} from "./store.mjs";

function walkYamlFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        stack.push(full);
      } else if (ent.isFile() && /\.ya?ml$/i.test(ent.name)) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

function walkMarkdown(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && /\.md$/i.test(ent.name)) out.push(full);
    }
  }
  return out.sort();
}

function safeReadYaml(file) {
  try {
    return parseYaml(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Discover measure / source / wiki candidates for one concept's aliases.
 */
export function discoverForAliases(contentRoot, aliases) {
  const discoveries = [];
  const now = new Date().toISOString();
  const slRoot = path.join(contentRoot, "semantic-layer");
  const wikiRoot = path.join(contentRoot, "wiki");

  // Schema manifests: connectionId/schema.manifest.yaml
  if (fs.existsSync(slRoot)) {
    let connections = [];
    try {
      connections = fs.readdirSync(slRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      connections = [];
    }
    for (const conn of connections) {
      const connectionId = conn.name;
      const connDir = path.join(slRoot, connectionId);
      const files = walkYamlFiles(connDir);
      for (const file of files) {
        const base = path.basename(file);
        const doc = safeReadYaml(file);
        if (!doc) continue;

        // Source overlay: <source>.yaml with measures[]
        if (Array.isArray(doc.measures)) {
          const sourceName = doc.name || path.basename(file, path.extname(file));
          for (const m of doc.measures) {
            const measureKey = m.name || m.key;
            if (!measureKey) continue;
            const fields = [
              { value: measureKey, kind: "measure_key" },
              { value: m.description, kind: "measure_description" },
            ];
            const evidence = [];
            let bestConf = null;
            for (const alias of aliases) {
              for (const f of fields) {
                const hit = matchField(alias, f.value, f.kind);
                if (!hit) continue;
                evidence.push({
                  type: "semantic",
                  path: path.relative(contentRoot, file),
                  alias,
                  field: f.kind,
                  snippet: String(f.value).slice(0, 120),
                  confidence: hit.confidence,
                });
                if (!bestConf || hit.confidence === "high") bestConf = hit.confidence;
                else if (bestConf !== "high") bestConf = hit.confidence;
              }
            }
            if (evidence.length === 0) continue;
            const ref = { connectionId, sourceName, measureKey };
            discoveries.push({
              bindingId: bindingIdFor("measure", ref),
              kind: "measure",
              ref,
              role: "candidate",
              confidence: bestConf || "medium",
              evidence,
              matched_at: now,
            });
          }

          // Source-level name match
          const sourceFields = [
            { value: sourceName, kind: "source_name" },
            { value: doc.description?.db || doc.descriptions?.db, kind: "table_description_db" },
          ];
          const srcEvidence = [];
          let srcConf = null;
          for (const alias of aliases) {
            for (const f of sourceFields) {
              const hit = matchField(alias, f.value, f.kind);
              if (!hit) continue;
              srcEvidence.push({
                type: "semantic",
                path: path.relative(contentRoot, file),
                alias,
                field: f.kind,
                snippet: String(f.value).slice(0, 120),
                confidence: hit.confidence,
              });
              srcConf = hit.confidence === "high" ? "high" : srcConf || hit.confidence;
            }
          }
          if (srcEvidence.length) {
            const ref = { connectionId, sourceName };
            discoveries.push({
              bindingId: bindingIdFor("source", ref),
              kind: "source",
              ref,
              role: "candidate",
              confidence: srcConf || "medium",
              evidence: srcEvidence,
              matched_at: now,
            });
          }
        }

        // Schema manifest tables
        if (Array.isArray(doc.tables)) {
          for (const t of doc.tables) {
            const sourceName = t.name || t.source;
            if (!sourceName) continue;
            const fields = [
              { value: sourceName, kind: "source_name" },
              { value: t.description?.db || t.descriptions?.db, kind: "table_description_db" },
            ];
            const evidence = [];
            let bestConf = null;
            for (const alias of aliases) {
              for (const f of fields) {
                const hit = matchField(alias, f.value, f.kind);
                if (!hit) continue;
                evidence.push({
                  type: "semantic",
                  path: path.relative(contentRoot, file),
                  alias,
                  field: f.kind,
                  snippet: String(f.value).slice(0, 120),
                  confidence: hit.confidence,
                });
                bestConf = hit.confidence === "high" ? "high" : bestConf || hit.confidence;
              }
            }
            if (!evidence.length) continue;
            const ref = { connectionId, sourceName };
            discoveries.push({
              bindingId: bindingIdFor("source", ref),
              kind: "source",
              ref,
              role: "candidate",
              confidence: bestConf || "medium",
              evidence,
              matched_at: now,
            });
          }
        }
      }
    }
  }

  // Wiki: title / H1 only
  for (const file of walkMarkdown(wikiRoot)) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const relPath = path.relative(contentRoot, file);
    const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || "";
    const title = firstLine.replace(/^#\s*/, "").trim();
    const evidence = [];
    let bestConf = null;
    for (const alias of aliases) {
      const hit = matchField(alias, title, "wiki_title");
      if (!hit) continue;
      evidence.push({
        type: "wiki",
        path: relPath,
        alias,
        field: "wiki_title",
        snippet: title.slice(0, 120),
        confidence: hit.confidence,
      });
      bestConf = "high";
    }
    if (!evidence.length) continue;
    const ref = { relPath };
    discoveries.push({
      bindingId: bindingIdFor("wiki", ref),
      kind: "wiki",
      ref,
      role: "candidate",
      confidence: bestConf || "high",
      evidence,
      matched_at: now,
    });
  }

  return discoveries;
}

function assetExists(contentRoot, binding) {
  try {
    if (binding.kind === "measure" || binding.kind === "source") {
      const { connectionId, sourceName } = binding.ref;
      const overlay = path.join(contentRoot, "semantic-layer", connectionId, `${sourceName}.yaml`);
      if (fs.existsSync(overlay)) return "present";
      // also accept schema.manifest presence for source-only
      const manifest = path.join(contentRoot, "semantic-layer", connectionId, "schema.manifest.yaml");
      if (binding.kind === "source" && fs.existsSync(manifest)) {
        const doc = safeReadYaml(manifest);
        const tables = doc?.tables || [];
        if (tables.some((t) => (t.name || t.source) === sourceName)) return "present";
      }
      return fs.existsSync(overlay) ? "present" : "absent";
    }
    if (binding.kind === "wiki") {
      const full = path.join(contentRoot, binding.ref.relPath);
      return fs.existsSync(full) ? "present" : "absent";
    }
  } catch {
    return "unknown";
  }
  return "unknown";
}

function readAssetFields(contentRoot, binding) {
  const st = assetExists(contentRoot, binding);
  if (st === "absent") return null;
  if (st === "unknown") return undefined;
  try {
    if (binding.kind === "measure") {
      const file = path.join(
        contentRoot,
        "semantic-layer",
        binding.ref.connectionId,
        `${binding.ref.sourceName}.yaml`,
      );
      const doc = safeReadYaml(file);
      if (!doc) return undefined;
      const m = (doc.measures || []).find((x) => (x.name || x.key) === binding.ref.measureKey);
      if (!m) return null;
      return [
        { value: m.name || m.key, kind: "measure_key" },
        { value: m.description, kind: "measure_description" },
      ];
    }
    if (binding.kind === "source") {
      const file = path.join(
        contentRoot,
        "semantic-layer",
        binding.ref.connectionId,
        `${binding.ref.sourceName}.yaml`,
      );
      if (fs.existsSync(file)) {
        const doc = safeReadYaml(file);
        return [
          { value: doc?.name || binding.ref.sourceName, kind: "source_name" },
          { value: doc?.description?.db || doc?.descriptions?.db, kind: "table_description_db" },
        ];
      }
      return [{ value: binding.ref.sourceName, kind: "source_name" }];
    }
    if (binding.kind === "wiki") {
      const full = path.join(contentRoot, binding.ref.relPath);
      const text = fs.readFileSync(full, "utf8");
      const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || "";
      const title = firstLine.replace(/^#\s*/, "").trim();
      return [{ value: title, kind: "wiki_title" }];
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function runScan({ contentRoot, whitelistPath = defaultWhitelistPath() }) {
  const dir = ensureConceptsDir(contentRoot);
  const whitelistDoc = loadWhitelistFile(whitelistPath);
  seedFromWhitelist(dir, whitelistDoc);

  const stats = { concepts: 0, added: 0, merged: 0, preserved_rejected: 0, conflicts: 0, degraded: 0 };
  const ids = listConceptIds(dir);

  for (const id of ids) {
    const concept = readConcept(dir, id);
    if (!concept) continue;
    stats.concepts += 1;
    const discoveries = discoverForAliases(contentRoot, concept.aliases || []);
    let next = concept;
    let dirty = false;
    for (const d of discoveries) {
      try {
        rejectEmptyEvidence(d);
      } catch {
        continue;
      }
      const result = mergeBinding(next, d);
      if (result.changed) {
        next = result.concept;
        dirty = true;
        if (result.action === "add") stats.added += 1;
        else if (result.action === "preserve_rejected") stats.preserved_rejected += 1;
        else stats.merged += 1;
      } else if (result.action === "preserve_rejected") {
        stats.preserved_rejected += 1;
      }
    }

    // Mark stale candidates: still on disk but no longer match
    const aliases = next.aliases || [];
    next.bindings = (next.bindings || []).map((b) => {
      if (b.role !== "candidate") return b;
      const match = currentlyMatches(b, aliases, (binding) => readAssetFields(contentRoot, binding));
      if (match === false) {
        dirty = true;
        return { ...b, stale: true };
      }
      if (match === true && b.stale) {
        dirty = true;
        const { stale, ...rest } = b;
        return rest;
      }
      return b;
    });

    if (dirty) {
      next.updated_at = new Date().toISOString();
      writeConceptAtomic(dir, next);
    }

    const { conflicts, conflicts_status } = deriveConflicts(next, {
      assetStatus: (b) => assetExists(contentRoot, b),
      rematch: (b, als) => currentlyMatches(b, als, (binding) => readAssetFields(contentRoot, binding)),
    });
    if (conflicts.length) stats.conflicts += conflicts.length;
    if (conflicts_status === "degraded") stats.degraded += 1;
  }

  return { dir, stats };
}

export function summarizeConcept(concept, contentRoot) {
  const { conflicts, conflicts_status } = deriveConflicts(concept, {
    assetStatus: (b) => assetExists(contentRoot, b),
    rematch: (b, als) =>
      currentlyMatches(b, als, (binding) => readAssetFields(contentRoot, binding)),
  });
  const bindings = concept.bindings || [];
  return {
    id: concept.id,
    label: concept.label,
    canonical: concept.canonical,
    candidates: bindings.filter((b) => b.role === "candidate").length,
    rejected: bindings.filter((b) => b.role === "rejected").length,
    conflicts,
    conflicts_status,
    stale: bindings.filter((b) => b.stale).length,
  };
}

export { assetExists, readAssetFields, normalizeAlias };
