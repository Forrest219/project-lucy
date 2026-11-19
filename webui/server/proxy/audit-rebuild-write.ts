/**
 * P1-47 W1: off-thread inferred-turn write_slice + PASSIVE checkpoint.
 * Keeps better-sqlite3 sync I/O off the Fastify event loop so livez can answer.
 */
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

export type RebuildTurnWrite = {
  id: string;
  inquiryNo: number;
  userId: string;
  startedAt: string;
  endedAt: string;
  callCount: number;
  businessCallCount: number;
  toolSummary: string;
  sourceSummary: string;
  questionSummary: string;
  confidence: string;
  evidenceJson: string;
  client: string | null;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  accessLogIds: number[];
};

export type WriteSliceOffThreadResult = {
  written: number;
  writeMs: number;
  checkpointMs: number;
  busy: number;
  log: number;
  checkpointed: number;
};

type Pending = {
  resolve: (value: WriteSliceOffThreadResult) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function workerFile(): string {
  return fileURLToPath(new URL("./audit-rebuild-write-worker.mjs", import.meta.url));
}

function rejectAll(error: Error): void {
  for (const [, entry] of pending) entry.reject(error);
  pending.clear();
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(workerFile());
  worker.on("message", (msg: {
    id?: number;
    ok?: boolean;
    error?: string;
    written?: number;
    writeMs?: number;
    checkpointMs?: number;
    busy?: number;
    log?: number;
    checkpointed?: number;
  }) => {
    if (msg?.id == null) return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (!msg.ok) {
      entry.reject(new Error(msg.error ?? "rebuild write worker failed"));
      return;
    }
    entry.resolve({
      written: msg.written ?? 0,
      writeMs: msg.writeMs ?? 0,
      checkpointMs: msg.checkpointMs ?? 0,
      busy: msg.busy ?? 0,
      log: msg.log ?? -1,
      checkpointed: msg.checkpointed ?? -1
    });
  });
  worker.on("error", (error) => {
    rejectAll(error instanceof Error ? error : new Error(String(error)));
    worker = null;
  });
  worker.on("exit", (code) => {
    if (pending.size > 0) {
      rejectAll(new Error(`rebuild write worker exited with code ${code}`));
    }
    worker = null;
  });
  return worker;
}

function postWorkerJob(
  payload: Record<string, unknown>
): Promise<WriteSliceOffThreadResult> {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      ensureWorker().postMessage({ id, ...payload });
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Delete a chunk of inferred turns off the request event loop. */
export function runDeleteWindowOffThread(
  dbPath: string,
  turnIds: string[]
): Promise<WriteSliceOffThreadResult> {
  return postWorkerJob({ type: "delete_window", dbPath, turnIds });
}

/** Write turns then PASSIVE checkpoint inside the worker thread. */
export function runWriteSliceOffThread(
  dbPath: string,
  turns: RebuildTurnWrite[]
): Promise<WriteSliceOffThreadResult> {
  return postWorkerJob({ type: "write_slice", dbPath, turns });
}

export async function closeRebuildWriteWorker(): Promise<void> {
  if (!worker) return;
  const current = worker;
  worker = null;
  const id = nextId;
  nextId += 1;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      void current.terminate().finally(resolve);
    }, 2000);
    const onMessage = (msg: { id?: number; ok?: boolean }) => {
      if (msg?.id !== id) return;
      clearTimeout(timer);
      current.off("message", onMessage);
      void current.terminate().finally(resolve);
    };
    current.on("message", onMessage);
    try {
      current.postMessage({ id, type: "close" });
    } catch {
      clearTimeout(timer);
      void current.terminate().finally(resolve);
    }
  });
}
