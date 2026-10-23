import type { ServerResponse } from "node:http";
import {
  digestBody,
  type PreparedResponseSummary,
  type ReleaseLedger,
  type ReleaseOperationContext
} from "./ledger.js";

/**
 * T07 / Spec §5.1 — "durable first, release after".
 *
 * `beginGatedResponse` records `request_admitted`, then replaces the response's
 * send points (`writeHead` / `write` / `end`, which also covers `pipe` and every
 * SSE chunk) with a bounded buffer. Once the handler calls `end`:
 *
 *   authorization re-check → durable `response_prepared` → flush (one write)
 *
 * Nothing reaches the client before `response_prepared` is durable, so an audit
 * or ledger failure can only produce a sanitized 503 `AUDIT_UNAVAILABLE`, never
 * content. Streams are therefore delivered as a finite, fully-buffered body
 * (Spec: "采用有界缓冲后输出协议 SSE"); exceeding the byte or wall-clock limit is
 * an explicit error, never a silent truncation.
 *
 * Install order matters: this gate must wrap *after* the revocation barrier
 * (`beginGuardedRequest`), so the flush still passes through the barrier's own
 * send-time check.
 */

export const AUDIT_UNAVAILABLE_CODE = "AUDIT_UNAVAILABLE";
export const RESPONSE_TOO_LARGE_CODE = "RESPONSE_TOO_LARGE";
export const RESPONSE_TIMEOUT_CODE = "RESPONSE_TIMEOUT";

/** Spec §5.1 draft ceilings. Config may tighten; loosening needs a frozen release profile. */
export const DEFAULT_RESPONSE_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_RESPONSE_WALL_CLOCK_MS = 30_000;

export type ResponseCommitConfig = {
  maxBufferBytes: number;
  /** From the first byte the handler produces until `end`. */
  wallClockMs: number;
};

function tightenOnly(raw: string | undefined, ceiling: number): number {
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed) || parsed <= 0) return ceiling;
  return Math.min(Math.floor(parsed), ceiling);
}

/** Environment can only tighten the defaults; a larger value is ignored. */
export function resolveResponseCommitConfig(env: NodeJS.ProcessEnv = process.env): ResponseCommitConfig {
  return {
    maxBufferBytes: tightenOnly(env.LUCY_RESPONSE_BUFFER_MAX_BYTES, DEFAULT_RESPONSE_BUFFER_MAX_BYTES),
    wallClockMs: tightenOnly(env.LUCY_RESPONSE_WALL_CLOCK_MS, DEFAULT_RESPONSE_WALL_CLOCK_MS)
  };
}

type SendMethods = {
  writeHead: (...args: unknown[]) => unknown;
  write: (...args: unknown[]) => boolean;
  end: (...args: unknown[]) => unknown;
};

export type GatedResponseInput = {
  ledger: ReleaseLedger;
  context: ReleaseOperationContext;
  /** JSON-RPC id echoed in gate-generated errors; `null` when unknown. */
  requestId?: string | number | null;
  /** False once a narrowing committed after admission (T04-3 barrier). */
  isCurrent: () => boolean;
  config?: ResponseCommitConfig;
  /** Called once the operation reached a terminal state (e.g. to schedule projection). */
  onSettled?: () => void;
};

function errorBody(
  requestId: string | number | null | undefined,
  rpcCode: number,
  message: string,
  code: string
): Buffer {
  return Buffer.from(
    JSON.stringify({ jsonrpc: "2.0", id: requestId ?? null, error: { code: rpcCode, message, data: { code } } })
  );
}

function sendError(
  send: SendMethods,
  res: ServerResponse,
  status: number,
  body: Buffer,
  extraHeaders: Record<string, string> = {}
): void {
  if (res.writableEnded || res.destroyed || res.headersSent) {
    if (!res.writableEnded && !res.destroyed) res.destroy();
    return;
  }
  send.writeHead(status, { "content-type": "application/json", "content-length": body.byteLength, ...extraHeaders });
  send.end(body);
}

function toBuffer(chunk: unknown, encoding: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return Buffer.from(String(chunk), typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8");
}

function trailingCallback(args: unknown[]): (() => void) | undefined {
  const last = args[args.length - 1];
  return typeof last === "function" ? (last as () => void) : undefined;
}

/** Sanitized 503 for a request that was never admitted into the ledger. */
export function writeAuditUnavailable(res: ServerResponse, requestId?: string | number | null): void {
  const body = errorBody(requestId, -32004, "Audit unavailable; no content was released", AUDIT_UNAVAILABLE_CODE);
  if (res.writableEnded || res.destroyed || res.headersSent) return;
  res.writeHead(503, {
    "content-type": "application/json",
    "content-length": body.byteLength,
    "cache-control": "no-store",
    "retry-after": "1"
  });
  res.end(body);
}

/**
 * Admit the request into the ledger and gate its response. Returns false (after
 * answering 503 `AUDIT_UNAVAILABLE`) when the request could not be admitted;
 * the handler must then not run.
 */
export async function beginGatedResponse(res: ServerResponse, input: GatedResponseInput): Promise<boolean> {
  const admitted = await input.ledger.admit(input.context);
  if (!admitted.ok) {
    console.error(`[lucy-proxy] audit admit failed op=${input.context.operationId} reason=${admitted.code}`);
    writeAuditUnavailable(res, input.requestId);
    return false;
  }
  new ResponseGate(res, input);
  return true;
}

class ResponseGate {
  private readonly send: SendMethods;
  private readonly config: ResponseCommitConfig;
  private head: unknown[] | undefined;
  private chunks: Buffer[] = [];
  private bytes = 0;
  private ended = false;
  /** True once a terminal path was taken; later handler writes are ignored. */
  private settled = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly res: ServerResponse,
    private readonly input: GatedResponseInput
  ) {
    this.config = input.config ?? resolveResponseCommitConfig();
    const target = res as unknown as SendMethods & { flushHeaders: () => void };
    this.send = {
      writeHead: target.writeHead.bind(res),
      write: target.write.bind(res),
      end: target.end.bind(res)
    };
    target.writeHead = (...args: unknown[]) => {
      if (this.settled || this.ended) return res;
      // A later writeHead (e.g. the server's error path) replaces what was buffered.
      this.head = args;
      this.chunks = [];
      this.bytes = 0;
      this.startClock();
      return res;
    };
    target.write = (...args: unknown[]) => {
      if (this.settled || this.ended) return true;
      this.startClock();
      this.append(toBuffer(args[0], args[1]));
      trailingCallback(args)?.();
      return true;
    };
    target.end = (...args: unknown[]) => {
      if (this.settled || this.ended) return res;
      if (typeof args[0] !== "function" && args[0] !== undefined && args[0] !== null) {
        this.append(toBuffer(args[0], args[1]));
      }
      if (this.settled) return res;
      this.ended = true;
      trailingCallback(args)?.();
      void this.commit();
      return res;
    };
    // Early header flushes would bypass the gate.
    target.flushHeaders = () => undefined;
    res.once("close", () => this.onClose());
  }

  private startClock(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.fail("response_timeout", 504, errorBody(
        this.input.requestId,
        -32006,
        "Response did not complete within the time limit; no content was released",
        RESPONSE_TIMEOUT_CODE
      ));
    }, this.config.wallClockMs);
    this.timer.unref();
  }

  private stopClock(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private append(chunk: Buffer): void {
    if (this.bytes + chunk.byteLength > this.config.maxBufferBytes) {
      this.fail("response_too_large", 502, errorBody(
        this.input.requestId,
        -32005,
        "Response exceeds the buffer limit; no content was released",
        RESPONSE_TOO_LARGE_CODE
      ));
      return;
    }
    this.chunks.push(chunk);
    this.bytes += chunk.byteLength;
  }

  /** Discard buffered content, answer with a content-free error, close the operation. */
  private fail(reason: string, status: number, body: Buffer): void {
    if (this.settled) return;
    this.settled = true;
    this.stopClock();
    this.discard();
    sendError(this.send, this.res, status, body);
    void this.terminal("failed", reason);
  }

  private discard(): void {
    this.chunks = [];
    this.bytes = 0;
    this.head = undefined;
  }

  private onClose(): void {
    if (this.settled) return;
    this.settled = true;
    this.stopClock();
    this.discard();
    // Someone else (the revocation barrier) may already have answered and finished the response.
    const reason = this.res.writableFinished
      ? this.input.isCurrent() ? "response_ended_externally" : "authorization_revoked"
      : this.ended ? "client_closed_before_send" : "client_closed";
    void this.terminal("failed", reason);
  }

  private async commit(): Promise<void> {
    this.stopClock();
    const body = Buffer.concat(this.chunks);
    const head = this.head;
    const status = typeof head?.[0] === "number" ? head[0] : 200;
    const summary: PreparedResponseSummary = { status, bytes: body.byteLength, sha256: digestBody(body) };

    if (!this.input.isCurrent()) {
      // The barrier already answered (or will, through the wrapped send). Never prepare for it.
      this.settled = true;
      this.discard();
      sendError(this.send, this.res, 403, errorBody(this.input.requestId, -32003, "Access denied: authorization_revoked", "authorization_revoked"));
      void this.terminal("failed", "authorization_revoked");
      return;
    }

    const prepared = await this.input.ledger.prepare(this.input.context, summary);
    if (this.settled) return; // closed while the record was being written
    this.settled = true;
    if (!prepared.ok) {
      console.error(`[lucy-proxy] audit prepare failed op=${this.input.context.operationId} reason=${prepared.code}`);
      this.discard();
      sendError(this.send, this.res, 503, errorBody(
        this.input.requestId,
        -32004,
        "Audit unavailable; no content was released",
        AUDIT_UNAVAILABLE_CODE
      ), { "cache-control": "no-store", "retry-after": "1" });
      void this.terminal("failed", "audit_prepare_failed");
      return;
    }

    // Synchronous from here: recheck, then flush, with nothing in between.
    if (this.res.destroyed || this.res.writableEnded) {
      this.discard();
      void this.terminal("failed", "client_closed_before_send");
      return;
    }
    if (!this.input.isCurrent()) {
      this.discard();
      sendError(this.send, this.res, 403, errorBody(this.input.requestId, -32003, "Access denied: authorization_revoked", "authorization_revoked"));
      void this.terminal("failed", "authorization_revoked_after_prepare");
      return;
    }
    this.watchDelivery();
    if (head) this.send.writeHead(...head);
    this.send.end(body);
    this.discard();
  }

  /** `finish` = fully handed to the transport. Not a client acknowledgement. */
  private watchDelivery(): void {
    this.res.once("finish", () => void this.terminal("delivered"));
    this.res.once("close", () => {
      if (!this.res.writableFinished) void this.terminal("failed", "client_closed_before_finish");
    });
  }

  private terminalWritten = false;

  private async terminal(kind: "delivered" | "failed", reason?: string): Promise<void> {
    if (this.terminalWritten) return;
    this.terminalWritten = true;
    try {
      const result = kind === "delivered"
        ? await this.input.ledger.delivered(this.input.context)
        : await this.input.ledger.failed(this.input.context, reason ?? "failed");
      // A lost terminal event is closed as `interrupted` at the next boot.
      if (!result.ok) console.error(`[lucy-proxy] audit terminal not recorded op=${this.input.context.operationId} reason=${result.code}`);
    } catch (error) {
      console.error("[lucy-proxy] audit terminal threw", error instanceof Error ? error.message : "unknown");
    } finally {
      this.input.onSettled?.();
    }
  }
}
