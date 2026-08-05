export const queryKeys = {
  project: ["project"] as const,
  sources: ["sources"] as const,
  source: (conn: string, schema: string, table: string) => ["sources", conn, schema, table] as const,
  sourceVersions: (conn: string, schema: string, table: string) =>
    ["sources", conn, schema, table, "versions"] as const,
  sourceVersion: (conn: string, schema: string, table: string, versionId: string) =>
    ["sources", conn, schema, table, "versions", versionId] as const,
  diff: ["diff"] as const,
  helpHandbook: ["help", "handbook"] as const,
  helpSearch: (q: string) => ["help", "search", q] as const,
  wiki: ["wiki"] as const,
  wikiPage: (key: string) => ["wiki", key] as const,
  wikiVersions: (key: string) => ["wiki", "versions", key] as const,
  joinCandidates: ["joins", "candidates"] as const,
  connections: ["connections"] as const,
  connectionTables: (connId: string) => ["connections", connId, "tables"] as const,
  connectionLiveSchemas: (connId: string) => ["connections", connId, "live-schemas"] as const,
  /** Spec 108: per-connection connectivity probe (`POST .../test`). */
  connectionHealth: (connId: string) => ["connections", connId, "health"] as const,
  // M13 Ingest sidecar (`.ktx-ui/ingest-runs.json`) — kept for the deprecated
  // `/api/connections/:connId/ingest` alias. New UI surfaces should not use it.
  ingestRuns: ["connections", "ingest-runs"] as const,
  // M14 static catalog reload sidecar (`.ktx-ui/catalog-reloads.json`).
  catalogReloads: ["catalog", "reloads"] as const,
  // M17 controlled YAML asset upload history (`.ktx-ui/catalog-asset-uploads.json`).
  catalogAssetUploads: ["catalog", "asset-uploads"] as const,
  catalogSchemaManifest: (connId: string, schema: string) =>
    ["catalog", "schema-manifest", connId, schema] as const,
  // M19 self-service publish and sanitized export.
  semanticAssetReleases: ["semantic-assets", "releases"] as const,
  semanticAssetRelease: (releaseId: string) =>
    ["semantic-assets", "releases", releaseId] as const,
  // M36 Data Agent Ops Platform. The Onboarding page aggregates multiple
  // existing endpoints; we keep a dedicated cache key so the dashboard
  // sections can be invalidated independently from per-module queries.
  opsDashboard: ["ops", "dashboard"] as const
};
