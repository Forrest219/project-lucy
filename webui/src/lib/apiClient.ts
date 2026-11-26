import {
  clearDisplayInfo,
  parseDisplayEnvelope,
  parseDisplayHeaders,
  setDisplayInfo,
  type DisplayInfo
} from "./displayState";

type ApiSuccess<T> = {
  ok: true;
  data: T;
};

type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    detail?: unknown;
  };
  data?: unknown;
};

type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export class ApiError extends Error {
  code: string;
  detail?: unknown;
  data?: unknown;
  httpStatus?: number;
  requestId?: string;
  serverTiming?: string;
  retryAfterSeconds?: number;
  /** `X-Lucy-Busy-Reason` of a 503 (fixed enum, diagnostics only — never user-visible). */
  busyReason?: string;

  constructor(error: ApiFailure["error"], data?: unknown) {
    super(error.message);
    this.name = "ApiError";
    this.code = error.code;
    this.detail = error.detail;
    this.data = data;
  }
}

/**
 * P1-75 X5 — a degraded read answered 200 `pending` (`data: null`): no servable view yet.
 * Thrown so the query stays loading and the page shows its skeleton / 「正在加载…」 — `data: null`
 * is never handed to a consumer, so it can never render as an empty list.
 */
export const DISPLAY_PENDING = "DISPLAY_PENDING";

export class DisplayPendingError extends ApiError {
  info: DisplayInfo;

  constructor(info: DisplayInfo) {
    super({ code: DISPLAY_PENDING, message: "正在加载…" });
    this.name = "DisplayPendingError";
    this.info = info;
  }
}

export function isDisplayPendingError(error: unknown): error is DisplayPendingError {
  return error instanceof DisplayPendingError;
}

/** Internal code — never show verbatim in user-visible copy. */
export const GATEWAY_UNAVAILABLE = "GATEWAY_UNAVAILABLE";

const HTML_CONTENT_TYPE = /text\/html/i;
const JSON_CONTENT_TYPE = /application\/json|\+json/i;

function isHtmlContentType(contentType: string): boolean {
  return HTML_CONTENT_TYPE.test(contentType);
}

function isJsonContentType(contentType: string): boolean {
  return JSON_CONTENT_TYPE.test(contentType);
}

export function isGatewayHtmlResponse(status: number, contentType: string): boolean {
  return (status === 502 || status === 503) && isHtmlContentType(contentType);
}

function responseHeader(response: Response, name: string): string | null {
  return response.headers?.get?.(name) ?? null;
}

function readRequestId(response: Response): string | undefined {
  for (const name of ["x-request-id", "request-id", "x-lucy-request-id"]) {
    const value = responseHeader(response, name);
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

function parseRetryAfterSeconds(header: string | null): number | undefined {
  if (!header?.trim()) return undefined;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function attachResponseMeta(error: ApiError, response: Response): ApiError {
  error.httpStatus = response.status;
  error.requestId = readRequestId(response);
  error.serverTiming = responseHeader(response, "server-timing") ?? undefined;
  const retryAfter = parseRetryAfterSeconds(responseHeader(response, "retry-after"));
  if (retryAfter !== undefined) error.retryAfterSeconds = retryAfter;
  const busyReason = responseHeader(response, "x-lucy-busy-reason")?.trim();
  if (busyReason) error.busyReason = busyReason;
  return error;
}

function gatewayUnavailableError(response: Response): ApiError {
  const error = new ApiError({
    code: GATEWAY_UNAVAILABLE,
    message: "服务暂不可用，请稍后重试。"
  });
  return attachResponseMeta(error, response);
}

/** User-visible copy without internal codes or raw gateway HTML. */
export function userFacingApiErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error && error.message ? error.message : "未知错误";
  }
  const base =
    error.code === GATEWAY_UNAVAILABLE ? "服务暂不可用，请稍后重试。" : error.message.trim() || "未知错误";
  return error.requestId ? `${base}（请求编号：${error.requestId}）` : base;
}

/**
 * Bounded read retry (display lists), at most one extra attempt: HTML gateway faults and the
 * B-class `DISPLAY_SNAPSHOT_BUSY` (`write_pending`; unknown reason keeps the legacy retry).
 * A-class refusals no longer exist as 503 (P1-75: they are 200 grace/stale/pending, see
 * DisplayPendingError); C-class `DISPLAY_RECONCILIATION_FAILED` and auth/conflict/stale are never retried.
 */
export function isRetryableDisplayReadError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code === STALE_RESPONSE || error.code === WRITE_STALE_RESPONSE) return false;
  if (error.httpStatus === 401 || error.httpStatus === 403 || error.httpStatus === 409) return false;
  if (
    error.code === "AUTH_REQUIRED" ||
    error.code === "AUTH_INVALID" ||
    error.code === "FORBIDDEN" ||
    error.code === "VERSION_CONFLICT" ||
    error.code === "ROLE_ID_TAKEN"
  ) {
    return false;
  }
  if (error.code === "DISPLAY_SNAPSHOT_BUSY") return !error.busyReason || error.busyReason === "write_pending";
  return error.code === GATEWAY_UNAVAILABLE;
}

/**
 * Spec 174 §4.2 — client freshness guards.
 * authEpoch: bumped on login start / logout / identity change; any response to
 * a request that started under an older epoch is rejected (never back-filled).
 * displayWriteEpoch + pending count per scope: bumped when a display-affecting
 * write starts and settles; display reads may not start while a write is
 * pending, and reads that straddle a write are rejected (write stale). Facts
 * stay "pending" from write start until a display read completes after every
 * overlapping write settled.
 */
export type DisplayReadScope = "project" | "sources" | "agents";

let authEpoch = 0;
const displayWriteEpochs: Record<DisplayReadScope, number> = { project: 0, sources: 0, agents: 0 };
const pendingDisplayWrites: Record<DisplayReadScope, number> = { project: 0, sources: 0, agents: 0 };
const awaitingFreshRead: Record<DisplayReadScope, boolean> = { project: false, sources: false, agents: false };
const displayWriteListeners = new Set<() => void>();
let authLostHandler: (() => void) | null = null;
let displayWriteBeginHandler: ((scopes: DisplayReadScope[]) => void) | null = null;
let displayWriteSettledHandler: ((scopes: DisplayReadScope[]) => void) | null = null;

/** Response from an older authEpoch (account boundary): never retried. */
export const STALE_RESPONSE = "STALE_RESPONSE";
/** Display read that overlapped a pending write: re-read only after the write settles. */
export const WRITE_STALE_RESPONSE = "WRITE_STALE_RESPONSE";

export function currentAuthEpoch(): number {
  return authEpoch;
}

export function bumpAuthEpoch(): void {
  authEpoch += 1;
  clearDisplayInfo();
}

export function currentDisplayWriteEpoch(scope: DisplayReadScope = "sources"): number {
  return displayWriteEpochs[scope];
}

export function setAuthLostHandler(handler: (() => void) | null): void {
  authLostHandler = handler;
}

export function setDisplayWriteBeginHandler(handler: ((scopes: DisplayReadScope[]) => void) | null): void {
  displayWriteBeginHandler = handler;
}

/** Called once per scope when its last overlapping write settles (success or failure). */
export function setDisplayWriteSettledHandler(handler: ((scopes: DisplayReadScope[]) => void) | null): void {
  displayWriteSettledHandler = handler;
}

export function hasPendingDisplayWrite(scope: DisplayReadScope): boolean {
  return pendingDisplayWrites[scope] > 0;
}

/** Actions depending on this scope's facts must wait: a write is pending or no fresh read since. */
export function displayFactsPending(scope: DisplayReadScope): boolean {
  return pendingDisplayWrites[scope] > 0 || awaitingFreshRead[scope];
}

export function subscribeDisplayWrites(listener: () => void): () => void {
  displayWriteListeners.add(listener);
  return () => displayWriteListeners.delete(listener);
}

function notifyDisplayWrites(): void {
  for (const listener of [...displayWriteListeners]) listener();
}

/** Resolves once no write is pending for the scope; rejects with AbortError on abort. */
export function waitForDisplayWritesSettled(scope: DisplayReadScope, signal?: AbortSignal): Promise<void> {
  if (!hasPendingDisplayWrite(scope)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      off();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const off = subscribeDisplayWrites(() => {
      if (hasPendingDisplayWrite(scope)) return;
      off();
      signal?.removeEventListener("abort", onAbort);
      resolve();
    });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isStaleResponseError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === STALE_RESPONSE || error.code === WRITE_STALE_RESPONSE);
}

export function isWriteStaleResponseError(error: unknown): boolean {
  return error instanceof ApiError && error.code === WRITE_STALE_RESPONSE;
}

function staleResponse(): ApiError {
  return new ApiError({ code: STALE_RESPONSE, message: "响应已过期，正在重新读取。" });
}

function writeStaleResponse(): ApiError {
  return new ApiError({ code: WRITE_STALE_RESPONSE, message: "响应已过期，正在重新读取。" });
}

export type ApiRequestOptions = {
  signal?: AbortSignal;
  /** Reject the response if a write affecting this read model started or settled meanwhile. */
  displayRead?: DisplayReadScope;
  /** Extra request headers merged over the defaults (e.g. one-time bootstrap secret). */
  headers?: Record<string, string>;
};

/** Which display read models a confirmed write can change (matrix C/D/P). */
const DISPLAY_WRITE_PATHS: Array<[RegExp, DisplayReadScope[]]> = [
  [/^\/api\/sources\//, ["sources"]],
  [/^\/api\/connections(\/|$)/, ["project", "sources", "agents"]],
  [/^\/api\/catalog\/(reload|assets\/upload)/, ["project", "sources"]],
  [/^\/api\/admin\/(agents|roles)(\/|$)/, ["agents", "sources"]]
];
const NON_WRITE_SUFFIXES = /\/(test|live-schemas|live-tables|table-diff|table-structure-diff|discovery|probe|preview|validate)(\?|$)/;

function displayWriteScopes(path: string, body: unknown): DisplayReadScope[] {
  if (body && typeof body === "object" && (body as { dryRun?: unknown }).dryRun === true) return [];
  const pathname = path.split("?")[0] ?? path;
  if (NON_WRITE_SUFFIXES.test(pathname)) return [];
  return DISPLAY_WRITE_PATHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? [];
}

async function trackDisplayWrite<T>(path: string, body: unknown, run: () => Promise<T>): Promise<T> {
  const scopes = displayWriteScopes(path, body);
  if (scopes.length === 0) return run();
  for (const scope of scopes) {
    displayWriteEpochs[scope] += 1;
    pendingDisplayWrites[scope] += 1;
    awaitingFreshRead[scope] = true;
  }
  displayWriteBeginHandler?.(scopes);
  notifyDisplayWrites();
  try {
    return await run();
  } finally {
    for (const scope of scopes) {
      displayWriteEpochs[scope] += 1;
      pendingDisplayWrites[scope] = Math.max(0, pendingDisplayWrites[scope] - 1);
    }
    const settled = scopes.filter((scope) => pendingDisplayWrites[scope] === 0);
    notifyDisplayWrites();
    if (settled.length > 0) displayWriteSettledHandler?.(settled);
  }
}

function rejectIfAuthLost<T>(response: Response, envelope: ApiEnvelope<T>): void {
  if (response.status === 401 && envelope.ok === false && envelope.error.code === "AUTH_REQUIRED") {
    authLostHandler?.();
  }
}

/**
 * Shared return path for every method: a response (success, error envelope or
 * late JSON body) to a request started under an older authEpoch is stale and
 * never reaches the caller; only a current-epoch AUTH_REQUIRED 401 clears auth.
 */
async function apiRequest<T>(path: string, init: RequestInit, options: ApiRequestOptions = {}): Promise<T> {
  const startedAuthEpoch = authEpoch;
  const scope = options.displayRead;
  if (scope && hasPendingDisplayWrite(scope)) throw writeStaleResponse();
  const startedWriteEpoch = scope ? displayWriteEpochs[scope] : 0;
  const headers = options.headers
    ? { ...(init.headers as Record<string, string> | undefined), ...options.headers }
    : init.headers;
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    ...(headers ? { headers } : {}),
    ...(options.signal ? { signal: options.signal } : {})
  });
  const contentType = responseHeader(response, "content-type") ?? "";
  if (isGatewayHtmlResponse(response.status, contentType)) {
    await response.text();
    if (startedAuthEpoch !== authEpoch) throw staleResponse();
    throw gatewayUnavailableError(response);
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    if (startedAuthEpoch !== authEpoch) throw staleResponse();
    if (response.status === 502 || response.status === 503) {
      throw gatewayUnavailableError(response);
    }
    throw attachResponseMeta(
      new ApiError({ code: "INVALID_RESPONSE", message: "响应格式无效。" }),
      response
    );
  }

  if (startedAuthEpoch !== authEpoch) throw staleResponse();
  if (scope && (startedWriteEpoch !== displayWriteEpochs[scope] || hasPendingDisplayWrite(scope))) throw writeStaleResponse();
  if (envelope.ok === false) {
    rejectIfAuthLost(response, envelope);
    throw attachResponseMeta(new ApiError(envelope.error, envelope.data), response);
  }
  // P1-75 X5: record grace/stale/pending (headers first, pending body as fallback); no header = fresh.
  const display = parseDisplayHeaders(response.headers) ?? parseDisplayEnvelope((envelope as { display?: unknown }).display);
  if (scope || display) setDisplayInfo(path, display);
  if (display?.state === "pending" && (envelope.data === null || envelope.data === undefined)) {
    throw new DisplayPendingError(display);
  }
  if (scope && awaitingFreshRead[scope]) {
    awaitingFreshRead[scope] = false;
    notifyDisplayWrites();
  }

  return envelope.data;
}

/** For protected direct-fetch helpers outside this client: reject a response from an older authEpoch. */
export function assertAuthEpoch(startedAuthEpoch: number): void {
  if (startedAuthEpoch !== authEpoch) throw staleResponse();
}

function jsonBody(body: unknown): RequestInit {
  return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export async function apiGet<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequest<T>(path, {}, options);
}

export async function apiPut<T>(path: string, body: unknown, options: ApiRequestOptions = {}): Promise<T> {
  return trackDisplayWrite(path, body, () => apiRequest<T>(path, { method: "PUT", ...jsonBody(body) }, options));
}

export async function apiPost<T>(path: string, body: unknown, options: ApiRequestOptions = {}): Promise<T> {
  return trackDisplayWrite(path, body, () => apiRequest<T>(path, { method: "POST", ...jsonBody(body) }, options));
}

export async function apiPatch<T>(path: string, body: unknown, options: ApiRequestOptions = {}): Promise<T> {
  return trackDisplayWrite(path, body, () => apiRequest<T>(path, { method: "PATCH", ...jsonBody(body) }, options));
}

export async function apiDelete<T>(path: string, body?: unknown, options: ApiRequestOptions = {}): Promise<T> {
  return trackDisplayWrite(path, body, () =>
    apiRequest<T>(path, { method: "DELETE", ...(body === undefined ? {} : jsonBody(body)) }, options)
  );
}
