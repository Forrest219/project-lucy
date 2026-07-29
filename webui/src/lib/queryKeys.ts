export const queryKeys = {
  project: ["project"] as const,
  sources: ["sources"] as const,
  source: (conn: string, schema: string, table: string) => ["sources", conn, schema, table] as const,
  diff: ["diff"] as const,
  helpHandbook: ["help", "handbook"] as const,
  wiki: ["wiki"] as const,
  wikiPage: (key: string) => ["wiki", key] as const,
  joinCandidates: ["joins", "candidates"] as const,
  connections: ["connections"] as const,
  connectionTables: (connId: string) => ["connections", connId, "tables"] as const,
  // M13 Ingest sidecar (`.ktx-ui/ingest-runs.json`) — kept for the deprecated
  // `/api/connections/:connId/ingest` alias. New UI surfaces should not use it.
  ingestRuns: ["connections", "ingest-runs"] as const,
  // M14 static catalog reload sidecar (`.ktx-ui/catalog-reloads.json`).
  catalogReloads: ["catalog", "reloads"] as const
};
