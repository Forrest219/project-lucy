export const queryKeys = {
  project: ["project"] as const,
  sources: ["sources"] as const,
  source: (conn: string, schema: string, table: string) => ["sources", conn, schema, table] as const,
  diff: ["diff"] as const,
  wiki: ["wiki"] as const,
  wikiPage: (key: string) => ["wiki", key] as const,
  joinCandidates: ["joins", "candidates"] as const,
  connections: ["connections"] as const,
  connectionTables: (connId: string) => ["connections", connId, "tables"] as const,
  // M13 Ingest sidecar (`.ktx-ui/ingest-runs.json`) shared between the
  // connection overview, the table whitelist, and Add Schema drawer.
  ingestRuns: ["connections", "ingest-runs"] as const
};
