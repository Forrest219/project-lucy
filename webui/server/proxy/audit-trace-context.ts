/**
 * P1-36 — 请求级 trace 上下文（AsyncLocalStorage）。
 *
 * 让 `forwardToUpstream` / 握手 / 审计出口这些模块级函数能拿到当前请求的
 * `TraceRecorder`，而不必给 60 多个调用点逐一传参。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { ServerResponse } from "node:http";
import { TraceRecorder, type SpanHandle } from "./audit-trace-span.js";

const SETTLE_SAFETY_MS = 5 * 60_000;

export class TraceRequestContext {
  claimed = false;
  rpcMethod?: string;
  ipSource?: string;
  trustedSource?: string;
  /** P1-37 U2：规范化后的工具入参与下游会话作用域，仅供被拒请求指纹使用，不入库。 */
  rejection?: { identityId: string; tool: string; args: unknown; sessionScope: string; fingerprint?: string };
  private responseSpan: SpanHandle | null = null;
  private settledResolve!: () => void;
  readonly settled: Promise<void> = new Promise<void>((resolve) => { this.settledResolve = resolve; });

  constructor(readonly recorder: TraceRecorder) {}

  /** 一个请求只允许一行审计行认领 span（防止额外行复用 trace_id）。 */
  claim(traceId?: string): boolean {
    if (this.claimed) return false;
    if (traceId !== undefined && traceId !== this.recorder.traceId) return false;
    this.claimed = true;
    return true;
  }

  private safetyTimer: NodeJS.Timeout | null = null;

  settle(): void {
    if (this.safetyTimer) clearTimeout(this.safetyTimer);
    this.safetyTimer = null;
    this.settledResolve();
  }

  /**
   * 钩住响应：`response_serialize` 从首次 `writeHead`（或 `end`）起，到 `end` 调用返回止；
   * `end` 返回或连接 `close` 后，审计行才收尾（审计仍在响应之后异步写入）。
   */
  instrumentResponse(res: ServerResponse): void {
    const beginSpan = () => {
      this.responseSpan ??= this.recorder.start("response_serialize");
    };
    const originalWriteHead = res.writeHead.bind(res) as (...args: unknown[]) => ServerResponse;
    const originalEnd = res.end.bind(res) as (...args: unknown[]) => ServerResponse;
    (res as { writeHead: unknown }).writeHead = (...args: unknown[]) => {
      beginSpan();
      return originalWriteHead(...args);
    };
    (res as { end: unknown }).end = (...args: unknown[]) => {
      beginSpan();
      try {
        return originalEnd(...args);
      } finally {
        this.responseSpan?.end({ status: "ok" });
        this.settle();
      }
    };
    res.once("close", () => this.settle());
    // 兜底：响应既不 end 也不 close（异常挂起）时，审计行仍须收尾，不让 pending 永久不归零。
    this.safetyTimer = setTimeout(() => this.settle(), SETTLE_SAFETY_MS);
    this.safetyTimer.unref();
  }
}

const storage = new AsyncLocalStorage<TraceRequestContext>();

export function runWithTrace<T>(context: TraceRequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function currentTraceContext(): TraceRequestContext | undefined {
  return storage.getStore();
}

export function currentTrace(): TraceRecorder | undefined {
  return storage.getStore()?.recorder;
}
