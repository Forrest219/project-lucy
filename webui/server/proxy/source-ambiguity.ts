/**
 * Spec 162 §7.3 / WO-14 T4 / SC-23 — 广告日表消歧.
 *
 * An ambiguous column or measure resolves to an ACL-scoped list of qualified
 * `source.field` names. It never auto-joins: the caller chooses the source.
 * The name list uses the same function as every other permission denial
 * (Spec 162 §7.3), so a source outside the caller's ACL can never appear.
 *
 * Independent of the semantic publish gate (WO-14 T5): disambiguation is a
 * query-time hint, publishing is a write-time contract check. The alias
 * resolution below reads whatever the customer has already published; this
 * module never creates an alias and never emits a join.
 */

export type QualifiedName = {
  /** Qualified `source.field`, or the bare measure name when unqualified. */
  name: string;
  connectionId?: string;
  schema?: string;
  sourceName: string;
  field: string;
};

export type AmbiguityCandidateInput = {
  connectionId?: string;
  schema?: string;
  sourceName: string;
  columns?: ReadonlyArray<{ name?: string } | string>;
  measures?: ReadonlyArray<{ name?: string } | string>;
};

function fieldNameOf(item: { name?: string } | string): string {
  return typeof item === "string" ? item.trim() : (item?.name ?? "").trim();
}

export function qualifiedName(input: {
  connectionId?: string;
  schema?: string;
  sourceName: string;
  field: string;
}): QualifiedName {
  return {
    name: `${input.sourceName}.${input.field}`,
    connectionId: input.connectionId,
    schema: input.schema,
    sourceName: input.sourceName,
    field: input.field
  };
}

/**
 * Collect every `source.field` a role can see that could answer the
 * unqualified name. Sources already carry the ACL decision: this function
 * only reads sources the caller was granted.
 */
export function ambiguousFieldCandidates(
  sources: ReadonlyArray<AmbiguityCandidateInput>,
  unqualifiedField: string
): QualifiedName[] {
  const field = unqualifiedField.trim();
  if (!field) return [];
  const seen = new Set<string>();
  const candidates: QualifiedName[] = [];
  for (const source of sources) {
    if (!source.sourceName) continue;
    const names = [...(source.columns ?? []), ...(source.measures ?? [])];
    if (!names.some((item) => fieldNameOf(item) === field)) continue;
    const qualified = qualifiedName({
      connectionId: source.connectionId,
      schema: source.schema,
      sourceName: source.sourceName,
      field
    });
    if (seen.has(qualified.name)) continue;
    seen.add(qualified.name);
    candidates.push(qualified);
  }
  return candidates.sort((a, b) => a.name.localeCompare(b.name));
}

export type AmbiguousFieldHint = {
  /** Dimension of the question that was ambiguous. */
  kind: "column" | "measure";
  field: string;
  /** ACL-scoped qualified names. Empty when nothing readable matches. */
  candidates: QualifiedName[];
  repair: string;
  /** SC-23 / Spec 162 §4: never generate a join. */
  autoJoinGenerated: false;
};

/**
 * SC-23 — the repair hint is a list of ACL-scoped qualified names. When the
 * name is not ambiguous across the readable set there is no hint at all, so a
 * resolvable query is never answered with a disambiguation prompt.
 */
export function ambiguousFieldHint(input: {
  kind: "column" | "measure";
  field: string;
  sources: ReadonlyArray<AmbiguityCandidateInput>;
}): AmbiguousFieldHint | null {
  const field = input.field.trim();
  if (!field) return null;
  const candidates = ambiguousFieldCandidates(input.sources, field);
  if (candidates.length < 2) return null;
  const label = input.kind === "measure" ? "度量" : "列";
  return {
    kind: input.kind,
    field,
    candidates,
    repair: `${label} ${field} 在多个来源中存在。请改用限定名：${candidates.map((c) => c.name).join("、")}。`,
    autoJoinGenerated: false
  };
}

/**
 * Physical-name alias resolution for `lucy_read_source`.
 *
 * When the customer has published a physical-table → semantic-source alias,
 * the alias resolves. When nothing is published the source stays not found and
 * the caller gets a repair hint — the proxy never invents a binding.
 */
export type SourceAlias = {
  physicalTable: string;
  sourceName: string;
  connectionId?: string;
  schema?: string;
};

export type AliasResolution =
  | { status: "resolved"; sourceName: string; connectionId?: string; schema?: string }
  | { status: "not_found"; repair: string };

export function resolveSourceAlias(
  requested: string,
  aliases: readonly SourceAlias[],
  readableSourceNames: ReadonlySet<string>
): AliasResolution {
  const raw = requested.trim();
  if (!raw) return { status: "not_found", repair: "请提供 source 名称或物理表名。" };

  // A published alias only helps when the target is readable by this role.
  const match = aliases.find((alias) => alias.physicalTable === raw);
  if (match) {
    if (!readableSourceNames.has(match.sourceName)) {
      return {
        status: "not_found",
        repair: `别名 ${match.physicalTable} 指向的来源当前角色无权读取。请改用当前角色已授权的来源。`
      };
    }
    return {
      status: "resolved",
      sourceName: match.sourceName,
      connectionId: match.connectionId,
      schema: match.schema
    };
  }

  // No alias published: the source stays not found rather than being guessed.
  return {
    status: "not_found",
    repair: `未找到来源 ${raw}。若它由物理表别名提供，请先在语义层发布别名后重试。`
  };
}