import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import type { YamlUser } from "./access-config.js";
import type { AgentStatsRange, MetricWindow } from "./metric-window.js";
import type { agentStatisticsQueries, TokenUsageSnapshot } from "./agents.js";

type Stats = ReturnType<typeof agentStatisticsQueries.queryAgentStatsFromDb>;
export type AgentStatisticsRead = {
  stats: Array<[string, Stats extends Map<string, infer Value> ? Value : never]>;
  globalActiveTokenCount: number | null;
  tokenUsage: Array<[string, Array<[string, TokenUsageSnapshot]>]>;
  snapshot: { ceilingId: number };
  window: MetricWindow;
  asOf: string;
};
type Input = { projectRoot: string; dbPath: string; key: string; users: YamlUser[]; range: AgentStatsRange; refresh: boolean };
type Job = { id: number; key: string; input: Input; asOf: string; background: boolean;
  resolve: (value: AgentStatisticsRead) => void; reject: (error: Error) => void };
type Slot = { worker: Worker; job?: Job; timer?: ReturnType<typeof setTimeout>;
  ready: Promise<void>; resolveReady: () => void; rejectReady: (error: Error) => void;
  bootstrapTimer?: ReturnType<typeof setTimeout> };
const cache = new Map<string, AgentStatisticsRead>();
const inflight = new Map<string, Promise<AgentStatisticsRead>>();
const cacheSequence = new Map<string, number>();
const queue: Job[] = [];
const slots: Slot[] = [];
let sequence = 0;
let closed = false;
const MAX_QUEUE = 8;
const TTL = 5000;

function workerSlot(): Slot {
  const worker = new Worker(new URL("./agent-statistics-worker.mjs", import.meta.url), { execArgv: [] });
  worker.unref();
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void ready.catch(() => {});
  const slot: Slot = { worker, ready, resolveReady, rejectReady };
  slot.bootstrapTimer = setTimeout(() => failSlot(slot), 9500);
  worker.on("message", (message) => {
    if (message.ready) { clearTimeout(slot.bootstrapTimer); slot.resolveReady(); return; }
    if (slot.job?.id !== message.id) return;
    clearTimeout(slot.timer);
    const job = slot.job!;
    slot.job = undefined;
    if (message.error) job.reject(new Error("Agent statistics unavailable"));
    else {
      const result = message.result as AgentStatisticsRead;
      if (Date.now() - Date.parse(result.asOf) < TTL && result.globalActiveTokenCount !== null
          && result.stats.every(([, stats]) => stats.metricsState === "ok")) {
        if ((cacheSequence.get(job.key) ?? 0) <= job.id) { cache.set(job.key, result); cacheSequence.set(job.key, job.id); }
        while (cache.size > 32) { const oldest = cache.keys().next().value!; cache.delete(oldest); cacheSequence.delete(oldest); }
      }
      job.resolve(result);
    }
    pump();
  });
  worker.on("error", () => failSlot(slot));
  worker.on("exit", (code) => { if (code !== 0) failSlot(slot); });
  return slot;
}
function failSlot(slot: Slot) {
  clearTimeout(slot.timer);
  clearTimeout(slot.bootstrapTimer);
  slot.rejectReady(new Error("Agent statistics worker unavailable"));
  slot.job?.reject(new Error("Agent statistics worker unavailable"));
  slot.job = undefined;
  const index = slots.indexOf(slot);
  if (index >= 0) slots.splice(index, 1);
  void slot.worker.terminate();
  if (!closed) pump();
}
/** Module loading has no database reads and completes during display startup. */
export async function warmAgentStatisticsWorkers(): Promise<void> {
  closed = false;
  while (slots.length < 2) slots.push(workerSlot());
  await Promise.all(slots.map((slot) => slot.ready));
}
function pump() {
  if (closed) return;
  while (queue.length && queue.length > slots.filter((slot) => !slot.job).length && slots.length < 2) slots.push(workerSlot());
  for (const slot of slots) {
    if (slot.job || !queue.length) continue;
    // Speculative ranges must leave capacity for an explicit user refresh.
    // Running both workers on prefetch made the next force read wait for a
    // whole unrelated range before its own SQL could start.
    if (queue[0]!.background && slots.some((candidate) => candidate.job?.background)) continue;
    const job = queue.shift()!;
    slot.job = job;
    slot.timer = setTimeout(() => failSlot(slot), 9500);
    slot.worker.postMessage({ id: job.id, dbPath: job.input.dbPath, users: job.input.users,
      range: job.input.range, asOf: job.asOf, key: job.key, refresh: job.input.refresh });
  }
}
function keyFor(input: Input) { return `${input.projectRoot}|${input.dbPath}|${input.key}|${input.range}`; }
function query(input: Input, background: boolean): Promise<AgentStatisticsRead> {
  closed = false;
  const key = keyFor(input);
  const workKey = `${key}|${input.refresh ? "force" : "read"}`;
  const existing = inflight.get(workKey);
  if (existing) return existing;
  if (queue.length >= MAX_QUEUE) return Promise.reject(new Error("Agent statistics queue busy"));
  const promise = new Promise<AgentStatisticsRead>((resolve, reject) => {
    const job: Job = { id: ++sequence, key, input, asOf: new Date().toISOString(), background, resolve, reject };
    if (background) queue.push(job); else queue.unshift(job);
    pump();
  }).finally(() => inflight.delete(workKey));
  inflight.set(workKey, promise);
  return promise;
}
function prefetch(input: Input) {
  for (const range of ["7d", "14d", "30d"] as const) {
    const sibling = { ...input, range, refresh: false };
    const cached = cache.get(keyFor(sibling));
    if (!cached || Date.now() - Date.parse(cached.asOf) >= 2000) void query(sibling, true).catch(() => {});
  }
}
export async function readAgentStatisticsInWorker(input: Input): Promise<AgentStatisticsRead> {
  // Only the visible subject set and credential metadata go to a worker. No
  // plaintext legacy token values, admin sessions or authorization decisions.
  const users = input.users.map((user) => ({ id: user.id, enabled: user.enabled,
    tokens: user.tokens.map((token) => ({ hash: token.hash, label: token.label, expires_at: token.expires_at })) })) as YamlUser[];
  const membership = createHash("sha256").update(JSON.stringify(users)).digest("hex");
  input = { ...input, key: `${input.key}|${membership}`, users };
  const cached = cache.get(keyFor(input));
  if (!input.refresh && cached && Date.now() - Date.parse(cached.asOf) < TTL) {
    prefetch(input);
    return cached;
  }
  const result = await query(input, false);
  prefetch(input);
  return result;
}
export async function closeAgentStatisticsWorkers(): Promise<void> {
  closed = true;
  cache.clear();
  cacheSequence.clear();
  for (const job of queue.splice(0)) job.reject(new Error("Agent statistics closed"));
  const closing = slots.splice(0).map((slot) => {
    clearTimeout(slot.timer);
    clearTimeout(slot.bootstrapTimer);
    slot.rejectReady(new Error("Agent statistics closed"));
    slot.job?.reject(new Error("Agent statistics closed"));
    return slot.worker.terminate();
  });
  await Promise.allSettled(closing);
  inflight.clear();
}
