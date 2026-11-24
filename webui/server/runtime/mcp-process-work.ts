import { AsyncLocalStorage } from "node:async_hooks";
import type { ClientRequest, ServerResponse } from "node:http";
import { getProcessLifecyclePhase, tryAdmitBusinessWork } from "./process-drain.js";

export const EXECUTION_RUNTIME_RELOADING = "EXECUTION_RUNTIME_RELOADING";
export const EXECUTION_RUNTIME_RELOADING_MESSAGE = "执行层正在重载，请在重载完成后重试。系统不会自动重试本次请求。";

export class McpReloadInProgressError extends Error {
  readonly code = EXECUTION_RUNTIME_RELOADING;
  readonly statusCode = 503;
  readonly requestId = reloadWindow?.requestId;
  readonly deadlineAt = reloadWindow?.deadlineAt;
  readonly rejectedAt = Date.now();
  constructor() { super(EXECUTION_RUNTIME_RELOADING_MESSAGE); }
}

/** MCP-only work: the HTTP request that owns a reload must never wait for itself. */
const rpcSettles = new Set<Promise<void>>();
type ReloadWindow = { requestId: string; deadlineAt: number; acquiredAt: string };
let reloadWindow: ReloadWindow | null = null;

function instanceIsStopping(): boolean {
  return ["DRAINING", "STOPPING", "STOPPED"].includes(getProcessLifecyclePhase());
}

export function currentMcpReloadWindow(): ReloadWindow | null {
  return reloadWindow ? { ...reloadWindow } : null;
}

export function mcpRpcInFlightCount(): number { return rpcSettles.size; }

export function mcpReloadAdmissionError(): McpReloadInProgressError | null {
  return reloadWindow && !instanceIsStopping() ? new McpReloadInProgressError() : null;
}

/** A reversible admission lease, owned by the EXISTING reload controller. */
export function acquireMcpReloadWindow(requestId: string, deadlineAt: number) {
  if (instanceIsStopping()) throw new Error("服务正在停止，不能重载执行层");
  if (reloadWindow) throw new McpReloadInProgressError();
  const mine: ReloadWindow = { requestId, deadlineAt, acquiredAt: new Date().toISOString() };
  reloadWindow = mine;
  console.info("[lucy-reload]", JSON.stringify({ event: "acquire", ...mine, activeRpcCount: rpcSettles.size }));
  return {
    requestId,
    assertCanProceed() {
      if (instanceIsStopping()) throw new Error("服务正在停止，执行层重载已取消");
      if (Date.now() >= deadlineAt) throw new Error("执行层重载超过总截止");
      if (reloadWindow !== mine) throw new Error("执行层重载所有权已变化");
    },
    async waitForIdle(budgetMs = 20_000): Promise<boolean> {
      const end = Math.min(deadlineAt, Date.now() + budgetMs);
      while (rpcSettles.size > 0 && Date.now() < end) {
        if (instanceIsStopping()) throw new Error("服务正在停止，执行层重载已取消");
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(20, Math.max(1, end - Date.now()))));
      }
      return rpcSettles.size === 0;
    },
    release() {
      if (reloadWindow !== mine) return;
      console.info("[lucy-reload]", JSON.stringify({ event: "release", ...mine, releasedAt: new Date().toISOString(), activeRpcCount: rpcSettles.size }));
      reloadWindow = null; // Never changes the irreversible whole-instance phase.
    }
  };
}

export function resetMcpReloadWorkForTests(): void {
  reloadWindow = null;
  rpcSettles.clear();
}

export class McpReloadDeadlineError extends Error {
  constructor() { super("执行层重载超时（超过总截止）；请核对原请求的实际状态后重试"); }
}

export function remainingReloadMs(deadlineAt: number, cap = 60_000): number {
  const remaining = Math.min(cap, Math.floor(deadlineAt - Date.now()));
  if (remaining <= 0) throw new McpReloadDeadlineError();
  return remaining;
}

/** Bounds the CALLER only. The owner must keep its lease until pending really settles. */
export function awaitReloadDeadline<T>(pending: Promise<T>, deadlineAt: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new McpReloadDeadlineError()), Math.max(0, deadlineAt - Date.now()));
    pending.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

/** Real upstream handles belong to the accepted RPC, not the client socket. */
const activeWork = new AsyncLocalStorage<Set<Promise<void>>>();

/**
 * P1-82 — hooks that must run only once the accepted RPC has really settled: every tracked upstream
 * request closed and the (possibly asynchronous) response gate finished. Used to release execution
 * capacity on real completion instead of on the downstream socket close.
 */
const settleHooks = new WeakMap<Set<Promise<void>>, Array<(info: McpSettleInfo) => void>>();
/** Whether the RPC ever started a real upstream request (a pre-forward abort has nothing left running). */
const upstreamStartedWork = new WeakSet<Set<Promise<void>>>();

export type McpSettleInfo = { upstreamStarted: boolean };

/** Returns false outside an accepted RPC; the caller must then fall back to its own release path. */
export function onMcpWorkSettled(hook: (info: McpSettleInfo) => void): boolean {
  const work = activeWork.getStore();
  if (!work) return false;
  const hooks = settleHooks.get(work) ?? [];
  hooks.push(hook);
  settleHooks.set(work, hooks);
  return true;
}

/** Actual async response-commit work, independent of response finish/close. */
export function trackMcpResponseCommit(settled: Promise<void>): void {
  const work = activeWork.getStore();
  if (!work) return;
  work.add(settled);
  void settled.then(() => work.delete(settled));
}

export function trackMcpUpstreamWork(request: ClientRequest): void {
  const work = activeWork.getStore();
  if (!work) return; // An idle GET/SSE is not a business RPC.
  upstreamStartedWork.add(work);
  const closed = new Promise<void>((resolve) => request.once("close", resolve));
  work.add(closed);
  void closed.then(() => work.delete(closed));
}

/** Call synchronously before admission's first await. */
export function admitMcpProcessWork(res: ServerResponse) {
  const reloadError = mcpReloadAdmissionError();
  if (reloadError) return { ok: false as const, error: reloadError };
  const admitted = tryAdmitBusinessWork();
  if (!admitted.ok) return admitted;
  const work = new Set<Promise<void>>();
  let finish!: () => void;
  const settled = new Promise<void>((resolve) => { finish = resolve; });
  rpcSettles.add(settled);
  admitted.ticket.registerSettle(() => settled);
  const responseSettled = new Promise<void>((resolve) => {
    const done = () => {
      res.off("finish", done);
      res.off("close", done);
      resolve();
    };
    res.once("finish", done);
    res.once("close", done);
  });
  return {
    ok: true as const,
    run: async (handler: () => Promise<void>) => {
      try {
        await activeWork.run(work, handler);
      } finally {
        // A post-start exception / client close cannot retire accepted upstream work.
        while (work.size > 0) await Promise.all([...work]);
        await responseSettled; // Includes the asynchronous durable response gate.
        const info: McpSettleInfo = { upstreamStarted: upstreamStartedWork.has(work) };
        for (const hook of settleHooks.get(work) ?? []) {
          try { hook(info); } catch { /* a failing hook must not keep the RPC unsettled */ }
        }
        settleHooks.delete(work);
        finish();
        rpcSettles.delete(settled);
        await admitted.ticket.retireWhenSettled();
      }
    }
  };
}
