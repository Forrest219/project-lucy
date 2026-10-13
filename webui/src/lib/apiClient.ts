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

  constructor(error: ApiFailure["error"], data?: unknown) {
    super(error.message);
    this.name = "ApiError";
    this.code = error.code;
    this.detail = error.detail;
    this.data = data;
  }
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
};

/** Which display read models a confirmed write can change (matrix C/D/P). */
const DISPLAY_WRITE_PATHS: Array<[RegExp, DisplayReadScope[]]> = [
  [/^\/api\/sources\//, ["sources"]],
  [/^\/api\/connections(\/|$)/, ["project", "sources", "agents"]],
  [/^\/api\/catalog\/(reload|assets\/upload)/, ["project", "sources"]],
  [/^\/api\/admin\/(agents|roles)(\/|$)/, ["agents", "sources"]]
];
const NON_WRITE_SUFFIXES = /\/(test|live-schemas|probe|preview|validate)(\?|$)/;

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
  const response = await fetch(path, { credentials: "same-origin", ...init, ...(options.signal ? { signal: options.signal } : {}) });
  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch (error) {
    if (startedAuthEpoch !== authEpoch) throw staleResponse();
    throw error;
  }

  if (startedAuthEpoch !== authEpoch) throw staleResponse();
  if (scope && (startedWriteEpoch !== displayWriteEpochs[scope] || hasPendingDisplayWrite(scope))) throw writeStaleResponse();
  if (envelope.ok === false) {
    rejectIfAuthLost(response, envelope);
    throw new ApiError(envelope.error, envelope.data);
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
