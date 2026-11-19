import { useSyncExternalStore } from "react";
import type { QueryFunctionContext } from "@tanstack/react-query";
import {
  apiGet,
  displayFactsPending,
  hasPendingDisplayWrite,
  isRetryableDisplayReadError,
  isWriteStaleResponseError,
  subscribeDisplayWrites,
  userFacingApiErrorMessage,
  waitForDisplayWritesSettled,
  type DisplayReadScope
} from "./apiClient";
import { queryKeys } from "./queryKeys";
import type { AgentStatsRange } from "./agentStatsRange";
import type {
  AgentsRosterResponse,
  AgentsStatisticsResponse,
  CatalogReloadsResponse,
  McpRuntimeStatus,
  ProjectInfo,
  SourcesResponse
} from "./types";

/** Spec 174 §4.2 — shared freshness for the project / sources display reads. */
export const DISPLAY_STALE_TIME_MS = 30_000;
export const DISPLAY_GC_TIME_MS = 300_000;

/**
 * Display read: passes React Query's AbortSignal to fetch, never starts while
 * an affecting write is pending, and re-reads (bounded) after the write
 * settles when the response straddled it (never surfaces the pre-write
 * payload). Auth-epoch staleness and aborts are not retried.
 */
const MAX_DISPLAY_READ_ATTEMPTS = 3;

async function displayRead<T>(path: string, scope: DisplayReadScope, signal: AbortSignal | undefined): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    if (hasPendingDisplayWrite(scope)) await waitForDisplayWritesSettled(scope, signal);
    try {
      return await apiGet<T>(path, { signal, displayRead: scope });
    } catch (error) {
      if (!isWriteStaleResponseError(error) || signal?.aborted || attempt >= MAX_DISPLAY_READ_ATTEMPTS) throw error;
    }
  }
}

/** True while a write affecting the scope is pending or its facts were not re-read since. */
export function useDisplayFactsPending(scope: DisplayReadScope): boolean {
  return useSyncExternalStore(subscribeDisplayWrites, () => displayFactsPending(scope));
}

/** P1-58 — extra automatic read retry + backoff must stay within this budget. */
export const DISPLAY_READ_RETRY_BUDGET_MS = 5000;

/** At most one automatic retry for DISPLAY_SNAPSHOT_BUSY or HTML gateway faults. */
function retryDisplayReadOnce(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && isRetryableDisplayReadError(error);
}

function retryDisplayReadDelay(_failureCount: number, error: unknown): number {
  const retryAfter =
    typeof (error as { retryAfterSeconds?: unknown })?.retryAfterSeconds === "number"
      ? (error as { retryAfterSeconds: number }).retryAfterSeconds * 1000
      : 1000;
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(retryAfter + jitter, DISPLAY_READ_RETRY_BUDGET_MS);
}

const displayRetry = { retry: retryDisplayReadOnce, retryDelay: retryDisplayReadDelay };

export function formatListLoadError(error: unknown): string {
  return userFacingApiErrorMessage(error);
}

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

/** MCP runtime status (Spec 163 notice); default freshness, shared by the page and its entry prefetch. */
export function mcpRuntimeStatusQueryOptions() {
  return {
    queryKey: queryKeys.mcpRuntime,
    queryFn: ({ signal }: QueryFunctionContext) => apiGet<McpRuntimeStatus>("/api/admin/mcp-runtime/status", { signal })
  };
}

/** Catalog reload history (card header timestamps); default freshness, shared with the entry prefetch. */
export function catalogReloadsQueryOptions() {
  return {
    queryKey: queryKeys.catalogReloads,
    queryFn: ({ signal }: QueryFunctionContext) => apiGet<CatalogReloadsResponse>("/api/catalog/reloads", { signal })
  };
}

/** Legacy full list (compatibility); Agent UI uses roster + statistics partitions. */
export function adminAgentsQueryOptions<T>(range?: AgentStatsRange) {
  const path = range ? `/api/admin/agents?range=${range}` : "/api/admin/agents";
  return {
    queryKey: range ? [...queryKeys.adminAgents, range] : queryKeys.adminAgents,
    queryFn: ({ signal }: QueryFunctionContext) => displayRead<T>(path, "agents", signal),
    ...displayRetry
  };
}

/** P1-58 — verified roster without audit statistics. */
export function adminAgentsRosterQueryOptions() {
  return {
    queryKey: [...queryKeys.adminAgents, "roster"] as const,
    queryFn: ({ signal }: QueryFunctionContext) =>
      displayRead<AgentsRosterResponse>("/api/admin/agents?view=roster", "agents", signal),
    ...displayRetry
  };
}

/** P1-58 — dynamic statistics; server may reuse completed results for ≤5s unless refresh=true. */
export function adminAgentsStatisticsQueryOptions(range: AgentStatsRange, refresh = false) {
  const params = new URLSearchParams({ range });
  if (refresh) params.set("refresh", "true");
  return {
    queryKey: [...queryKeys.adminAgents, "statistics", range] as const,
    queryFn: ({ signal }: QueryFunctionContext) =>
      displayRead<AgentsStatisticsResponse>(`/api/admin/agents/statistics?${params.toString()}`, "agents", signal),
    ...displayRetry
  };
}

export function adminRolesQueryOptions<T>(params?: { includeTemplates?: boolean }) {
  const includeTemplates = params?.includeTemplates ?? true;
  const path = includeTemplates ? "/api/admin/roles" : "/api/admin/roles?includeTemplates=false";
  const queryKey = includeTemplates
    ? (["admin", "roles"] as const)
    : (["admin", "roles", { includeTemplates: false }] as const);
  return {
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext) => displayRead<T>(path, "sources", signal),
    staleTime: DISPLAY_STALE_TIME_MS,
    gcTime: DISPLAY_GC_TIME_MS,
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
