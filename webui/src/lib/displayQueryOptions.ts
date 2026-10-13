import type { QueryFunctionContext } from "@tanstack/react-query";
import { ApiError, apiGet, isStaleResponseError, type DisplayReadScope } from "./apiClient";
import { queryKeys } from "./queryKeys";
import type { ProjectInfo, SourcesResponse } from "./types";

/** Spec 174 §4.2 — shared freshness for the project / sources display reads. */
export const DISPLAY_STALE_TIME_MS = 30_000;
export const DISPLAY_GC_TIME_MS = 300_000;

/**
 * Display read: passes React Query's AbortSignal to fetch and re-reads once
 * when the response straddled a display-affecting write (never surfaces the
 * pre-write payload). Auth-epoch staleness and aborts are not retried.
 */
const MAX_DISPLAY_READ_ATTEMPTS = 3;

async function displayRead<T>(path: string, scope: DisplayReadScope, signal: AbortSignal | undefined): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await apiGet<T>(path, { signal, displayRead: scope });
    } catch (error) {
      if (!isStaleResponseError(error) || signal?.aborted || attempt >= MAX_DISPLAY_READ_ATTEMPTS) throw error;
    }
  }
}

/** Read-only retry: at most once, only for the retryable busy envelope, honouring Retry-After: 1. */
function retryBusyOnce(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && error instanceof ApiError && error.code === "DISPLAY_SNAPSHOT_BUSY";
}

const displayRetry = { retry: retryBusyOnce, retryDelay: 1000 };

export function projectQueryOptions() {
  return {
    queryKey: queryKeys.project,
    queryFn: ({ signal }: QueryFunctionContext) => displayRead<ProjectInfo>("/api/project", "project", signal),
    staleTime: DISPLAY_STALE_TIME_MS,
    gcTime: DISPLAY_GC_TIME_MS,
    ...displayRetry
  };
}

export function sourcesQueryOptions() {
  return {
    queryKey: queryKeys.sources,
    queryFn: ({ signal }: QueryFunctionContext) => displayRead<SourcesResponse>("/api/sources", "sources", signal),
    staleTime: DISPLAY_STALE_TIME_MS,
    gcTime: DISPLAY_GC_TIME_MS,
    ...displayRetry
  };
}

/** Agent list carries dynamic audit statistics: keep staleTime 0 (only server-side permission caching). */
export function adminAgentsQueryOptions<T>() {
  return {
    queryKey: queryKeys.adminAgents,
    queryFn: ({ signal }: QueryFunctionContext) => displayRead<T>("/api/admin/agents", "agents", signal),
    ...displayRetry
  };
}

/** Public, unauthenticated reads that survive an identity change. */
export function isPublicQueryKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === "help" || queryKey[0] === "branding";
}

/** Query key for each display read model a write can affect. */
export const DISPLAY_SCOPE_QUERY_KEYS: Record<DisplayReadScope, readonly unknown[]> = {
  project: queryKeys.project,
  sources: queryKeys.sources,
  agents: queryKeys.adminAgents
};
