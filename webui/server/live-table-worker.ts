/**
 * Spec 190 §8.2 — the continuous discovery worker.
 *
 * A single in-process loop wakes up on a short tick, asks the persisted
 * discovery config which connections are due, and runs one reconciliation
 * round for each of them. Nothing is connected to a database unless the
 * operator enabled continuous discovery for that connection (SC-22).
 *
 * Single replica by contract (Spec 190 §9.4): no leader election, no
 * distributed coordination. Every piece of state lives in the sidecar files, so
 * a restart resumes with the same configuration and failure counters.
 */
import { readConnections, resolveProjectRoot } from "./project";
import {
  loadDiscoveryConfigs,
  reconcileConnection,
  type DiscoveryConfig
} from "./live-table-discovery";
import { recordDiscoveryAudit } from "./admin/discovery-audit";
import { displayGenerations } from "./display-generation";

/** How often the worker looks for due connections. */
export const DISCOVERY_TICK_MS = 30_000;

/** Delay before the first tick after boot, so startup is not blocked by a poll. */
const FIRST_TICK_DELAY_MS = 10_000;

let timer: NodeJS.Timeout | null = null;
let firstTick: NodeJS.Timeout | null = null;
let running = false;
/** How many servers share the worker loop. */
let consumers = 0;

/**
 * Is this connection due for a round?
 *
 * A Schema is due when its backoff window elapsed (`nextAttemptAt`), when it
 * was never attempted, or when one polling interval passed since its last
 * attempt. Paused Schemas are never due — they need a human.
 *
 * `configuredSchemas` is the Schema list of the connection in `ktx.yaml`. It
 * matters for the first round: the persisted config has no Schema state yet,
 * and without this list the connection would never be picked up at all.
 */
export function isConnectionDue(
  config: DiscoveryConfig,
  now: number,
  configuredSchemas: string[] = Object.keys(config.schemas)
): boolean {
  for (const schema of configuredSchemas) {
    const state = config.schemas[schema];
    if (!state) return true; // never attempted
    if (state.status === "paused") continue;
    if (state.nextAttemptAt) {
      if (Date.parse(state.nextAttemptAt) <= now) return true;
      continue;
    }
    if (!state.lastAttemptAt) return true;
    if (Date.parse(state.lastAttemptAt) + config.intervalMs <= now) return true;
  }
  return false;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const projectRoot = await resolveProjectRoot();
    const [configs, connections] = await Promise.all([
      loadDiscoveryConfigs(projectRoot),
      readConnections(projectRoot).catch(() => [])
    ]);
    const schemasByConnection = new Map(
      connections.map((connection) => [connection.id, connection.schemas] as const)
    );
    const now = Date.now();
    for (const config of Object.values(configs)) {
      if (!config.enabled) continue;
      const configuredSchemas = schemasByConnection.get(config.connectionId);
      // A connection that disappeared from `ktx.yaml` is not polled any more.
      if (!configuredSchemas) continue;
      if (!isConnectionDue(config, now, configuredSchemas)) continue;
      try {
        await reconcileConnection(projectRoot, config.connectionId, {
          currentGeneration: () => displayGenerations().L,
          onAudit: async (event) => {
            await recordDiscoveryAudit({
              actor: "system",
              connectionId: event.connectionId,
              schema: event.schema,
              action: event.action,
              outcome: event.outcome,
              reason: event.reason,
              latencyMs: event.latencyMs,
              tableCount: event.tableCount
            });
          }
        });
      } catch (err) {
        console.error("[live-table-discovery] round failed", {
          connectionId: config.connectionId,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  } catch (err) {
    console.error("[live-table-discovery] worker tick failed", err);
  } finally {
    running = false;
  }
}

/** Start the worker. Returns a stop function (idempotent per consumer). */
export function startDiscoveryWorker(): () => void {
  consumers += 1;
  if (!timer) {
    timer = setInterval(() => {
      void tick();
    }, DISCOVERY_TICK_MS);
    timer.unref?.();
    firstTick = setTimeout(() => {
      void tick();
    }, FIRST_TICK_DELAY_MS);
    firstTick.unref?.();
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    consumers = Math.max(0, consumers - 1);
    if (consumers > 0) return;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (firstTick) {
      clearTimeout(firstTick);
      firstTick = null;
    }
  };
}

export function stopDiscoveryWorker(): void {
  consumers = 0;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (firstTick) {
    clearTimeout(firstTick);
    firstTick = null;
  }
}
