import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type ExecutionRuntimeObservationStatus = "ok" | "stale";

export type ExecutionRuntimeObservation = {
  connectionId: string;
  configDigest: string;
  status: ExecutionRuntimeObservationStatus;
  checkedAt: string;
  detail?: string;
};

const observations = new Map<string, ExecutionRuntimeObservation>();

export async function readKtxYamlDigest(projectRoot: string): Promise<string> {
  const contents = await readFile(path.join(projectRoot, "ktx.yaml"));
  return createHash("sha256").update(contents).digest("hex");
}

export function recordExecutionRuntimeObservation(
  observation: ExecutionRuntimeObservation
): void {
  observations.set(observation.connectionId, { ...observation });
}

export function getExecutionRuntimeObservation(
  connectionId: string,
  configDigest: string
): ExecutionRuntimeObservation | undefined {
  const observation = observations.get(connectionId);
  if (!observation || observation.configDigest !== configDigest) return undefined;
  return { ...observation };
}

export function listExecutionRuntimeObservations(
  configDigest: string
): ExecutionRuntimeObservation[] {
  return [...observations.values()]
    .filter((observation) => observation.configDigest === configDigest)
    .map((observation) => ({ ...observation }));
}

export function resetExecutionRuntimeObservationsForTests(): void {
  observations.clear();
}
