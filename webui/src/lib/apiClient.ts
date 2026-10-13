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
 * displayWriteEpoch: bumped when a display-affecting write starts and settles;
 * display reads that straddle a write are rejected and re-read.
 */
export type DisplayReadScope = "project" | "sources" | "agents";

let authEpoch = 0;
const displayWriteEpochs: Record<DisplayReadScope, number> = { project: 0, sources: 0, agents: 0 };
let authLostHandler: (() => void) | null = null;
let displayWriteSettledHandler: ((scopes: DisplayReadScope[]) => void) | null = null;

export const STALE_RESPONSE = "STALE_RESPONSE";

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

export function setDisplayWriteSettledHandler(handler: ((scopes: DisplayReadScope[]) => void) | null): void {
  displayWriteSettledHandler = handler;
}

export function isStaleResponseError(error: unknown): boolean {
  return error instanceof ApiError && error.code === STALE_RESPONSE;
}

function staleResponse(): ApiError {
  return new ApiError({ code: STALE_RESPONSE, message: "响应已过期，正在重新读取。" });
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
  for (const scope of scopes) displayWriteEpochs[scope] += 1;
  try {
    return await run();
  } finally {
    for (const scope of scopes) displayWriteEpochs[scope] += 1;
    displayWriteSettledHandler?.(scopes);
  }
}

function rejectIfAuthLost<T>(response: Response, envelope: ApiEnvelope<T>): void {
  if (response.status === 401 && envelope.ok === false && envelope.error.code === "AUTH_REQUIRED") {
    authLostHandler?.();
  }
}

export async function apiGet<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const startedAuthEpoch = authEpoch;
  const startedWriteEpoch = options.displayRead ? displayWriteEpochs[options.displayRead] : 0;
  const response = await fetch(path, { credentials: "same-origin", ...(options.signal ? { signal: options.signal } : {}) });
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (startedAuthEpoch !== authEpoch) throw staleResponse();
  if (options.displayRead && startedWriteEpoch !== displayWriteEpochs[options.displayRead]) throw staleResponse();
  if (envelope.ok === false) {
    rejectIfAuthLost(response, envelope);
    throw new ApiError(envelope.error, envelope.data);
  }

  return envelope.data;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return trackDisplayWrite(path, body, () => apiPutUntracked<T>(path, body));
}

async function apiPutUntracked<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (envelope.ok === false) {
    throw new ApiError(envelope.error, envelope.data);
  }

  return envelope.data;
}

export async function apiPost<T>(path: string, body: unknown, options: ApiRequestOptions = {}): Promise<T> {
  return trackDisplayWrite(path, body, () => apiPostUntracked<T>(path, body, options));
}

async function apiPostUntracked<T>(path: string, body: unknown, options: ApiRequestOptions): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {})
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (envelope.ok === false) {
    throw new ApiError(envelope.error, envelope.data);
  }

  return envelope.data;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return trackDisplayWrite(path, body, () => apiPatchUntracked<T>(path, body));
}

async function apiPatchUntracked<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (envelope.ok === false) {
    throw new ApiError(envelope.error, envelope.data);
  }

  return envelope.data;
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  return trackDisplayWrite(path, body, () => apiDeleteUntracked<T>(path, body));
}

async function apiDeleteUntracked<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "DELETE",
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        })
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (envelope.ok === false) {
    throw new ApiError(envelope.error, envelope.data);
  }

  return envelope.data;
}
