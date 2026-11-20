// P1-58 D6: no schema migration, writes, runtime policy or request actor here.
import { statSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import Database from "better-sqlite3";
import { register } from "tsx/esm/api";
register();
const queries = await import("./agent-statistics-queries.ts");
const { buildAgentStatsWindow } = await import("./metric-window.ts");
let database;
let databasePath;
let databaseIdentity;
const observations = new Map();
parentPort.postMessage({ ready: true });
parentPort.on("message", (job) => {
  try {
    const stat = statSync(job.dbPath);
    const identity = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    if (!database || databasePath !== job.dbPath || databaseIdentity !== identity) {
      database?.close();
      database = undefined;
      databasePath = undefined;
      databaseIdentity = undefined;
      observations.clear();
      database = new Database(job.dbPath, { readonly: true, fileMustExist: true, timeout: 9000 });
      database.pragma("temp_store = MEMORY");
      database.pragma("cache_size = -16384");
      databasePath = job.dbPath;
      databaseIdentity = identity;
      observations.clear();
    }
    const window = buildAgentStatsWindow(job.range, new Date(job.asOf));
    let observedVersion;
    const result = database.transaction(() => {
      // The first SELECT pins this read transaction. A read-only connection's
      // data_version detects every external commit, including UPDATE/DELETE.
      const snapshot = queries.captureAgentAuditReadSnapshot(database);
      const version = database.pragma("data_version", { simple: true });
      observedVersion = version;
      const previous = observations.get(job.key);
      if (!job.refresh && previous && previous.version === version
          && previous.result.snapshot.ceilingId === snapshot.ceilingId
          && previous.result.window.startIso <= window.startIso
          && previous.result.window.endIso <= window.endIso) {
        // Exact zero-delta evaluation of the moving window. This is a new
        // database observation, never a re-stamped unverified display cache.
        const edge = database.prepare(`SELECT 1 FROM access_log WHERE
          (ts>=? AND ts<?) OR (ts>=? AND ts<?) OR (ts>=? AND ts<?) LIMIT 1`).get(
          previous.result.window.startIso, window.startIso, previous.result.window.endIso, window.endIso,
          new Date(Date.parse(previous.result.window.endIso)-7*86400000).toISOString(), new Date(Date.parse(window.endIso)-7*86400000).toISOString());
        if (!edge) {
          const stats = previous.result.stats.map(([id, value]) => {
            const user = job.users.find((candidate) => candidate.id === id);
            const availableTokens = user ? queries.availableTokenCount(user, Date.parse(window.endIso)) : 0;
            return [id, { ...value, availableTokens, windowStart: window.startIso, windowEnd: window.endIso }];
          });
          return { ...previous.result, snapshot, stats, window };
        }
      }
      return { snapshot, stats: [...queries.queryAgentStatsFromDb(database, job.users, window, snapshot)],
        globalActiveTokenCount: queries.queryGlobalActiveTokenCount(database, window, snapshot), window,
        tokenUsage: [...queries.queryLastUsedMapFromDb(database, job.users.map((user) => user.id), snapshot, job.users, Date.parse(window.endIso))]
          .map(([id, tokens]) => [id, [...tokens]]) };
    })();
    // Keep the original source observation for delta validation; only a fresh
    // transaction with unchanged version + empty boundary intervals advances it.
    if (result.globalActiveTokenCount !== null && result.stats.every(([, value]) => value.metricsState === "ok")) {
      observations.set(job.key, { version: observedVersion, result });
      while (observations.size > 32) observations.delete(observations.keys().next().value);
    }
    parentPort.postMessage({ id: job.id, result: { ...result, asOf: job.asOf } });
  } catch (error) {
    parentPort.postMessage({ id: job.id, error: { code: "AGENT_STATISTICS_UNAVAILABLE", message: String(error?.message ?? error) } });
  }
});
