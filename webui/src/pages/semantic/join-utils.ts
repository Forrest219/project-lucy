import type { Join, JoinCandidate, SourceDetail } from "../../lib/types";

export const RELATIONSHIP_LABELS: Record<Join["relationship"], string> = {
  many_to_one: "多对一",
  one_to_many: "一对多",
  one_to_one: "一对一"
};

/**
 * Heuristic candidate joins inferred from `*_id` columns. Each match points
 * from the current table to a like-named table (singular stem pluralised to
 * its surface form) using a many_to_one relationship.
 *
 * The note is "字段名匹配" so users see a consistent label whether the
 * candidate comes from the live suggestion or the sidecar.
 */
export function suggestedJoins(source?: SourceDetail): JoinCandidate[] {
  if (!source) {
    return [];
  }
  return source.model.columns
    .filter((column) => column.name.endsWith("_id"))
    .map((column) => {
      const stem = column.name.replace(/_id$/, "");
      const to = stem.endsWith("s") ? stem : `${stem}s`;
      return {
        conn: source.model.conn,
        schema: source.model.schema,
        fromTable: source.model.table,
        join: {
          to,
          on: `${source.model.table}.${column.name} = ${to}.${column.name}`,
          relationship: "many_to_one",
          source: "candidate"
        },
        confidence: "candidate",
        note: "字段名匹配"
      };
    });
}

function joinKey(candidate: JoinCandidate): string {
  return [
    candidate.conn,
    candidate.schema,
    candidate.fromTable,
    candidate.join.to,
    candidate.join.on
  ].join("|");
}

function isAlreadyFormal(source: SourceDetail | undefined, candidate: JoinCandidate): boolean {
  if (!source) return false;
  return (source.model.joins ?? []).some(
    (join) => join.to === candidate.join.to && join.on === candidate.join.on
  );
}

function isCurrentSource(source: SourceDetail | undefined, candidate: JoinCandidate): boolean {
  if (!source) return false;
  return (
    candidate.conn === source.model.conn &&
    candidate.schema === source.model.schema &&
    candidate.fromTable === source.model.table
  );
}

/**
 * Combine live suggestions with sidecar-stored candidates, drop:
 *  - entries already confirmed in source.model.joins (by to + on);
 *  - entries with confidence === "rejected" (the prominent banner is for
 *    actionable items only; rejected entries stay in the sidecar but are
 *    filtered out here so the banner is honest).
 *
 * The result is de-duplicated by (conn, schema, fromTable, to, on) so the
 * TableEditor banner and the JoinEditor list stay aligned.
 */
export function tableJoinCandidates(params: {
  source?: SourceDetail;
  sidecarCandidates: JoinCandidate[];
}): JoinCandidate[] {
  const { source, sidecarCandidates } = params;

  const currentSidecar = sidecarCandidates.filter((candidate) => isCurrentSource(source, candidate));
  const rejectedKeys = new Set(
    currentSidecar
      .filter((candidate) => candidate.confidence === "rejected")
      .map(joinKey)
  );
  const sidecarActive = currentSidecar.filter(
    (candidate) => candidate.confidence !== "rejected"
  );

  const live = suggestedJoins(source).filter((candidate) => !rejectedKeys.has(joinKey(candidate)));
  const merged = [...sidecarActive, ...live];

  const seen = new Set<string>();
  const result: JoinCandidate[] = [];

  for (const candidate of merged) {
    if (isAlreadyFormal(source, candidate)) {
      continue;
    }
    const key = joinKey(candidate);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(candidate);
  }

  return result;
}
