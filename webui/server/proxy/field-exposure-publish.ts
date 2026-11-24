/**
 * REQ-030-012 — B1 publish gate: exposure reference contract (Spec §3.4).
 *
 * Only trimmed targets trigger `exposure.*` (D24／SC-29).
 */

import {
  exposureDecision,
  loadExposureSet,
  normalizeColumnName,
  parseLedgerYaml,
  sourceKey,
  type ActivatedSnapshot,
  type ExposureSet,
  type SourceRef
} from "./field-exposure.js";
import type { PublishGateViolation } from "../publish-gate.js";

export type CandidateLedger = {
  connectionId: string;
  schema: string;
  sourceName: string;
  /** YAML text; absent + expected → unavailable handled by caller. */
  text: string | null;
  expected: boolean;
};

export type CandidateSemanticSource = {
  targetPath: string;
  connectionId: string;
  schema: string;
  sourceName: string;
  /** Parsed overlay-ish content. */
  content: {
    grain?: unknown;
    measures?: unknown;
    segments?: unknown;
    joins?: unknown;
    columns?: unknown;
  };
};

export type CandidateState = {
  semanticSources: CandidateSemanticSource[];
  ledgers: CandidateLedger[];
};

export function exposureForCandidate(
  candidate: CandidateState,
  conn: string,
  schema: string,
  sourceName: string
): ExposureSet {
  const key = sourceKey(conn, schema, sourceName);
  const ledger = candidate.ledgers.find(
    (l) => sourceKey(l.connectionId, l.schema, l.sourceName) === key
  );
  const snapshotLike: Pick<ActivatedSnapshot, "expectedSetLoad" | "exposureLedgersBySource"> = {
    expectedSetLoad: {
      state: "ready",
      set: new Set(
        candidate.ledgers.filter((l) => l.expected).map((l) => sourceKey(l.connectionId, l.schema, l.sourceName))
      ),
      digest: "candidate",
      generationId: "candidate",
      expectedSetRequired: candidate.ledgers.some((l) => l.expected)
    },
    exposureLedgersBySource: new Map(
      candidate.ledgers
        .filter((l) => typeof l.text === "string")
        .map((l) => [sourceKey(l.connectionId, l.schema, l.sourceName), l.text as string])
    )
  };
  return loadExposureSet(conn, schema, sourceName, snapshotLike);
}

type RefKind = "grain" | "measure" | "segment" | "join" | "derived";

function extractColumnTokensFromExpr(expr: string): string[] {
  const out: string[] = [];
  for (const match of expr.matchAll(/\b([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\b/g)) {
    out.push(`${match[1]}.${match[2]}`);
  }
  // Also bare identifiers that look like physical columns (no dot) — treated as same-source.
  return out;
}

function enumerateRefs(src: CandidateSemanticSource): Array<{
  refKind: RefKind;
  refName: string;
  rawRefs: string[];
}> {
  const items: Array<{ refKind: RefKind; refName: string; rawRefs: string[] }> = [];
  const content = src.content;

  const grain = content.grain;
  if (Array.isArray(grain)) {
    for (const g of grain) {
      if (typeof g === "string") {
        items.push({ refKind: "grain", refName: g, rawRefs: [g.includes(".") ? g : `${src.sourceName}.${g}`] });
      }
    }
  }

  const measures = content.measures;
  if (measures && typeof measures === "object" && !Array.isArray(measures)) {
    for (const [name, def] of Object.entries(measures as Record<string, unknown>)) {
      const rawRefs: string[] = [];
      if (def && typeof def === "object" && !Array.isArray(def)) {
        const d = def as Record<string, unknown>;
        if (typeof d.expr === "string") {
          const tokens = extractColumnTokensFromExpr(d.expr);
          if (tokens.length > 0) rawRefs.push(...tokens);
          else {
            // bare column in expr
            for (const bare of d.expr.matchAll(/\b([A-Za-z_][\w]*)\b/g)) {
              const tok = bare[1]!;
              if (["sum", "count", "avg", "min", "max", "and", "or", "case", "when", "then", "else", "end"].includes(tok.toLowerCase())) {
                continue;
              }
              rawRefs.push(`${src.sourceName}.${tok}`);
            }
          }
        }
      }
      items.push({ refKind: "measure", refName: name, rawRefs });
    }
  }

  const segments = content.segments;
  if (segments && typeof segments === "object" && !Array.isArray(segments)) {
    for (const [name, def] of Object.entries(segments as Record<string, unknown>)) {
      const rawRefs: string[] = [];
      if (def && typeof def === "object" && !Array.isArray(def)) {
        const d = def as Record<string, unknown>;
        if (typeof d.expr === "string") {
          rawRefs.push(...extractColumnTokensFromExpr(d.expr));
        }
      }
      items.push({ refKind: "segment", refName: name, rawRefs });
    }
  }

  const joins = content.joins;
  if (Array.isArray(joins)) {
    joins.forEach((join, index) => {
      if (!join || typeof join !== "object") return;
      const j = join as Record<string, unknown>;
      const name = typeof j.name === "string" ? j.name : `join_${index}`;
      const rawRefs: string[] = [];
      for (const key of ["on", "sql", "expr"] as const) {
        if (typeof j[key] === "string") rawRefs.push(...extractColumnTokensFromExpr(j[key] as string));
      }
      items.push({ refKind: "join", refName: name, rawRefs });
    });
  } else if (joins && typeof joins === "object") {
    for (const [name, def] of Object.entries(joins as Record<string, unknown>)) {
      const rawRefs: string[] = [];
      if (def && typeof def === "object" && !Array.isArray(def)) {
        const d = def as Record<string, unknown>;
        for (const key of ["on", "sql", "expr"] as const) {
          if (typeof d[key] === "string") rawRefs.push(...extractColumnTokensFromExpr(d[key] as string));
        }
      }
      items.push({ refKind: "join", refName: name, rawRefs });
    }
  }

  const columns = content.columns;
  if (Array.isArray(columns)) {
    for (const col of columns) {
      if (!col || typeof col !== "object") continue;
      const c = col as Record<string, unknown>;
      if (typeof c.expr !== "string" || !c.expr.trim()) continue;
      const name = typeof c.name === "string" ? c.name : "derived";
      items.push({
        refKind: "derived",
        refName: name,
        rawRefs: extractColumnTokensFromExpr(c.expr)
      });
    }
  }

  return items;
}

function resolveCrossSourceRef(
  rawRef: string,
  src: CandidateSemanticSource,
  candidate: CandidateState
):
  | { kind: "IDENTITY_COLUMN"; conn: string; schema: string; sourceName: string; column: string }
  | { kind: "UNPARSEABLE" }
  | { kind: "AMBIGUOUS" }
  | { kind: "LEGAL_ZERO_COLUMN" } {
  const parts = rawRef.split(".");
  if (parts.length < 2) {
    return {
      kind: "IDENTITY_COLUMN",
      conn: src.connectionId,
      schema: src.schema,
      sourceName: src.sourceName,
      column: rawRef
    };
  }
  const sourceName = parts[0]!;
  const column = parts.slice(1).join(".");
  const matches = candidate.semanticSources.filter(
    (s) =>
      normalizeColumnName(s.sourceName) === normalizeColumnName(sourceName) &&
      normalizeColumnName(s.connectionId) === normalizeColumnName(src.connectionId)
  );
  if (matches.length === 0) {
    // Cross-connection same name or unknown — try any connection.
    const any = candidate.semanticSources.filter(
      (s) => normalizeColumnName(s.sourceName) === normalizeColumnName(sourceName)
    );
    if (any.length === 1) {
      return {
        kind: "IDENTITY_COLUMN",
        conn: any[0]!.connectionId,
        schema: any[0]!.schema,
        sourceName: any[0]!.sourceName,
        column
      };
    }
    if (any.length > 1) return { kind: "AMBIGUOUS" };
    // Unknown source: still attribute to declared sourceName under same conn for ledger lookup.
    return {
      kind: "IDENTITY_COLUMN",
      conn: src.connectionId,
      schema: src.schema,
      sourceName,
      column
    };
  }
  if (matches.length > 1) return { kind: "AMBIGUOUS" };
  return {
    kind: "IDENTITY_COLUMN",
    conn: matches[0]!.connectionId,
    schema: matches[0]!.schema,
    sourceName: matches[0]!.sourceName,
    column
  };
}

function closureMayTouchTrimmed(
  candidate: CandidateState,
  src: CandidateSemanticSource,
  rawRef: string
): boolean {
  const target = resolveCrossSourceRef(rawRef, src, candidate);
  if (target.kind === "IDENTITY_COLUMN") {
    const exposure = exposureForCandidate(candidate, target.conn, target.schema, target.sourceName);
    return exposure.mode === "trimmed" || exposure.state === "unavailable";
  }
  // Ambiguous / unparseable: conservative if any trimmed ledger exists.
  return candidate.ledgers.some((l) => {
    if (!l.text) return l.expected;
    const set = parseLedgerYaml(l.text, {
      connectionId: l.connectionId,
      schema: l.schema,
      sourceName: l.sourceName
    });
    return set.mode === "trimmed" || set.state === "unavailable";
  });
}

export function checkExposureReferenceContract(
  candidate: CandidateState
): PublishGateViolation[] {
  const violations: PublishGateViolation[] = [];
  for (const srcFile of candidate.semanticSources) {
    for (const { refKind, refName, rawRefs } of enumerateRefs(srcFile)) {
      for (const rawRef of rawRefs) {
        const target = resolveCrossSourceRef(rawRef, srcFile, candidate);
        if (target.kind === "LEGAL_ZERO_COLUMN") continue;
        if (target.kind === "UNPARSEABLE" || target.kind === "AMBIGUOUS") {
          if (closureMayTouchTrimmed(candidate, srcFile, rawRef)) {
            violations.push({
              checkId: `exposure.unparseable.${refKind}.${refName}`,
              filePath: srcFile.targetPath,
              connectionId: srcFile.connectionId,
              message: `${refKind} ${refName} 含无法解析／无法消歧的列引用；引用方=${srcFile.connectionId}.${srcFile.sourceName}`
            });
          }
          continue;
        }
        const exposure = exposureForCandidate(
          candidate,
          target.conn,
          target.schema,
          target.sourceName
        );
        if (exposure.state === "unavailable") {
          violations.push({
            checkId: "exposure.unavailable",
            filePath: srcFile.targetPath,
            connectionId: srcFile.connectionId,
            message: `无法校验：目标 ${target.sourceName} 暴露台账／期望集合不可用；引用方=${refKind} ${refName}`
          });
          continue;
        }
        if (exposure.mode === "unconfigured" || exposure.mode === "full_expose") {
          continue;
        }
        if (exposure.excluded.has(normalizeColumnName(target.column))) {
          violations.push({
            checkId: `exposure.${refKind}.${refName}.${target.sourceName}.${normalizeColumnName(target.column)}`,
            filePath: srcFile.targetPath,
            connectionId: srcFile.connectionId,
            message: `${refKind} ${refName} 引用了未暴露列 ${target.sourceName}.${target.column}（引用方文件=${srcFile.targetPath}；目标列=${target.column}）`
          });
        }
      }
    }
  }
  return violations;
}

/** Helper for unit tests: build a minimal configured ledger text. */
export function buildTestLedgerText(ref: SourceRef, excluded: string[]): string {
  const lines = [
    `version: 1`,
    `source:`,
    `  connectionId: ${ref.connectionId}`,
    `  schema: ${ref.schema}`,
    `  sourceName: ${ref.sourceName}`,
    `excluded_columns:`
  ];
  if (excluded.length === 0) {
    lines.push(`  []`);
  } else {
    for (const c of excluded) lines.push(`  - ${c}`);
  }
  lines.push(`updated_at: "2026-11-08T00:00:00.000Z"`);
  return `${lines.join("\n")}\n`;
}
