/**
 * Spec 190 / WO-202610-26 T2 — the live table list runs on its own probe
 * queue.
 *
 * The table query is a real database round trip, so it must never eat the
 * concurrency budget of the connectivity probe (`test`) or the Schema-level
 * catalog (`live-schemas`): SC-32 requires a separate quota.
 *
 * The scheduler also carries the two extra failure reasons Spec 190 §7.1 needs
 * — a queue deadline that expired (`PROBE_QUEUE_TIMEOUT`) and a result whose
 * connection configuration generation went stale (`GENERATION_INVALIDATED`).
 */
import {
  ProbeGenerationInvalidatedError,
  ProbeQueueFullError,
  ProbeQueueTimeoutError,
  ProbeScheduler,
  type ProbeSchedulerOptions
} from "./background-probes";
import { displayGenerations } from "./display-generation";
import type { LiveTableFailureReason } from "./live-tables";

/** One table query at a time: the library must not be hammered by polling. */
export const LIVE_TABLE_PROBE_CONCURRENCY = 1;

/** Distinct queued table queries; beyond this the caller gets `PROBE_QUEUE_FULL`. */
export const LIVE_TABLE_PROBE_MAX_QUEUED = 16;

/**
 * `L` is the generation of the live-schemas / health task config. A `ktx.yaml`
 * write bumps it, so a table query started before a configuration change never
 * reaches the new configuration.
 */
export function createLiveTableProbeScheduler(
  options: ProbeSchedulerOptions = {}
): ProbeScheduler {
  return new ProbeScheduler({
    concurrency: LIVE_TABLE_PROBE_CONCURRENCY,
    maxQueued: LIVE_TABLE_PROBE_MAX_QUEUED,
    currentGeneration: () => displayGenerations().L,
    staleError: () => new ProbeGenerationInvalidatedError(),
    queueTimeoutError: () => new ProbeQueueTimeoutError(),
    ...options
  });
}

export const liveTableProbeScheduler = createLiveTableProbeScheduler();

/**
 * Map a probe scheduler failure onto the closed reason vocabulary
 * (Spec 190 §7.1). `null` means the error is not a scheduler failure.
 *
 * Both the manual read and the background poll go through this queue, so both
 * can report a full queue, a queue deadline and a stale generation.
 */
export function liveTableProbeFailureReason(err: unknown): LiveTableFailureReason | null {
  if (err instanceof ProbeQueueFullError) return "PROBE_QUEUE_FULL";
  if (err instanceof ProbeQueueTimeoutError) return "PROBE_QUEUE_TIMEOUT";
  if (err instanceof ProbeGenerationInvalidatedError) return "GENERATION_INVALIDATED";
  return null;
}

/** Separator between the key parts — a NUL byte cannot occur in an identifier. */
const KEY_SEPARATOR = String.fromCharCode(0);

/**
 * The queue key of one table query. `purpose` is part of the key so a manual
 * read and the background poll never share one task (Spec 190 §6.4).
 */
export function liveTableProbeKey(input: {
  projectRoot: string;
  connectionId: string;
  schema: string;
  generation: number;
  purpose: "manual" | "automatic";
}): string {
  return [
    input.projectRoot,
    `L${input.generation}`,
    input.connectionId,
    input.schema,
    input.purpose,
    "live-tables"
  ].join(KEY_SEPARATOR);
}
