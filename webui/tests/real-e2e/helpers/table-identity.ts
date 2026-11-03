// Canonical table identity shared by the three admin views that must agree on
// "the same table": the access map, the authorization summary and the row-policy
// reverse lookup.
//
// The three views carry DIFFERENT key formats:
//   access map node id      table:<connectionId>::<schema>::<sourceName>
//   authorization summary   <connectionId>|<schema>|<sourceName>|<physicalTable>
//   row-policy view entry   { connectionId, schema, sourceName }
//
// A substring comparison across those formats can never match (the separators
// differ), so every view is parsed into ONE canonical form:
//
//   <connectionId>::<schema>::<sourceName>
//
// The source NAME is the common denominator: the access map builds its table
// node from the source name (webui/server/admin/access-map.ts) and the
// authorization summary's four-tuple carries the source name in its third slot
// (webui/server/admin/authorization-summary.ts).

/** The canonical key of one table. */
export type CanonicalTableKey = string;

/** Builds the canonical key from its three parts. */
export function canonicalTableKey(parts: {
  connectionId?: string | null;
  schema?: string | null;
  sourceName?: string | null;
}): CanonicalTableKey {
  return [parts.connectionId ?? "", parts.schema ?? "", parts.sourceName ?? ""].join("::");
}

/**
 * Parses an access-map table node id (`table:<conn>::<schema>::<source>`).
 * Returns null for a node id that is not a table node.
 */
export function accessMapTableKey(nodeId: string): CanonicalTableKey | null {
  const match = /^table:([^:]*)::([^:]*)::([^:]*)$/.exec(nodeId ?? "");
  if (!match) return null;
  return canonicalTableKey({ connectionId: match[1], schema: match[2], sourceName: match[3] });
}

/**
 * Parses an authorization-summary source key
 * (`<conn>|<schema>|<source>|<physicalTable>`). The physical table is the fourth
 * slot and is deliberately NOT part of the canonical form: the access map keys
 * its table nodes by source name.
 */
export function authorizationSummaryTableKey(sourceKey: string): CanonicalTableKey | null {
  const parts = (sourceKey ?? "").split("|");
  if (parts.length < 3) return null;
  return canonicalTableKey({ connectionId: parts[0], schema: parts[1], sourceName: parts[2] });
}

/**
 * The canonical keys of a set of row-policy view table entries.
 */
export function rowPolicyViewTableKeys(
  tables: Array<{ connectionId?: string; schema?: string; sourceName?: string }>
): Set<CanonicalTableKey> {
  return new Set(tables.map((t) => canonicalTableKey(t)));
}

/** The canonical keys of a set of access-map table node ids. */
export function accessMapTableKeys(nodeIds: string[]): Set<CanonicalTableKey> {
  const keys = new Set<CanonicalTableKey>();
  for (const id of nodeIds) {
    const key = accessMapTableKey(id);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * The three parts of an access-map table node id.
 *
 * The node id carries NO path separator, so a spec cannot cut a "tail" out of it
 * the way it could with a path-like id — it has to be PARSED.
 */
export function accessMapTableParts(nodeId: string): {
  connectionId: string;
  schema: string;
  sourceName: string;
} | null {
  const match = /^table:([^:]*)::([^:]*)::([^:]*)$/.exec(nodeId ?? "");
  if (!match) return null;
  return { connectionId: match[1], schema: match[2], sourceName: match[3] };
}
