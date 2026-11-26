import { useSyncExternalStore } from "react";
import type { QueryFunctionContext } from "@tanstack/react-query";
import {
  apiGet,
  ApiError,
  displayFactsPending,
  hasPendingDisplayWrite,
  isDisplayPendingError,
  isRetryableDisplayReadError,
  isWriteStaleResponseError,
  subscribeDisplayWrites,
  userFacingApiErrorMessage,
  waitForDisplayWritesSettled,
  type DisplayReadScope
} from "./apiClient";
import { normalizeAgentRoster } from "./agentRosterSummary";
import { displayPollInterval } from "./displayState";
import { queryKeys } from "./queryKeys";
import type { AgentStatsRange } from "./agentStatsRange";
import type {
  Agent,
  AgentRosterRead,
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
const displayReadJourneys = new WeakMap<AbortSignal, number>();

/**
 * Per-request read deadline. Must stay above the server's in-request build wait
 * (`DISPLAY_BUILD_WAIT_BUDGET_MS` = 10 s in webui/server/display-snapshot.ts) plus network margin,
 * otherwise a persistent `pending` (answered at ~10 s) races the abort and becomes a timeout error
 * instead of "正在加载…".
 */
export const DISPLAY_READ_REQUEST_TIMEOUT_MS = 13_000;
const DISPLAY_READ_JOURNEY_MS = 15_000;

async function displayRead<T>(path: string, scope: DisplayReadScope, signal: AbortSignal | undefined): Promise<T> {
  const started = signal ? displayReadJourneys.get(signal) ?? Date.now() : Date.now();
  if (signal) displayReadJourneys.set(signal, started);
  const remaining = Math.min(DISPLAY_READ_REQUEST_TIMEOUT_MS, DISPLAY_READ_JOURNEY_MS - (Date.now() - started));
  const timeout = () => new ApiError({ code: "DISPLAY_READ_TIMEOUT", message: "页面数据读取超时，请重试。" });
  if (remaining <= 0) throw timeout();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, remaining);
  try {
    for (let attempt = 1; ; attempt += 1) {
      if (hasPendingDisplayWrite(scope)) await waitForDisplayWritesSettled(scope, controller.signal);
      try {
        return await apiGet<T>(path, { signal: controller.signal, displayRead: scope });
      } catch (error) {
        if (!isWriteStaleResponseError(error) || controller.signal.aborted || attempt >= MAX_DISPLAY_READ_ATTEMPTS) throw error;
      }
    }
  } catch (error) {
    if (timedOut) throw timeout();
    // `pending` is not a failure: the next poll starts its own journey budget, so a long
    // pending never turns into DISPLAY_READ_TIMEOUT (contract: prolonged stays non-error).
    if (isDisplayPendingError(error) && signal) displayReadJourneys.delete(signal);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/** True while a write affecting the scope is pending or its facts were not re-read since. */
export function useDisplayFactsPending(scope: DisplayReadScope): boolean {
  return useSyncExternalStore(subscribeDisplayWrites, () => displayFactsPending(scope));
}

/** P1-58 — extra automatic read retry + backoff must stay within this budget. */
export const DISPLAY_READ_RETRY_BUDGET_MS = 5000;

/**
 * `pending` (200, no servable view) keeps the query loading and re-reads until a view exists —
 * never an error, never `data: null`. Other failures: at most one automatic retry, only for the
 * B-class write-pending BUSY or HTML gateway faults (A-class is 200 now; see isRetryableDisplayReadError).
 */
function retryDisplayReadOnce(failureCount: number, error: unknown): boolean {
  if (isDisplayPendingError(error)) return true;
  return failureCount < 1 && isRetryableDisplayReadError(error);
}

function retryDisplayReadDelay(failureCount: number, error: unknown): number {
  if (isDisplayPendingError(error)) {
    // 2–5 s (contract §3), growing slowly with the attempt count.
    return Math.min(2000 + failureCount * 500 + Math.floor(Math.random() * 250), 5000);
  }
  const retryAfter =
    typeof (error as { retryAfterSeconds?: unknown })?.retryAfterSeconds === "number"
      ? (error as { retryAfterSeconds: number }).retryAfterSeconds * 1000
      : 1000;
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(retryAfter + jitter, DISPLAY_READ_RETRY_BUDGET_MS);
}

/** Region keys of the display reads (request pathname) — what DisplayDegradedNotice subscribes to. */
export const DISPLAY_REGION_PATHS = {
  project: "/api/project",
  sources: "/api/sources",
  roles: "/api/admin/roles",
  agents: "/api/admin/agents",
  agentStatistics: "/api/admin/agents/statistics"
} as const;

/** Retry policy plus self-polling while the region is `stale` / `pending` (stops once fresh). */
function displayRetryFor(regionPath: string) {
  return { retry: retryDisplayReadOnce, retryDelay: retryDisplayReadDelay, refetchInterval: displayPollInterval(regionPath) };
}

export function formatListLoadError(error: unknown): string {
  return userFacingApiErrorMessage(error);
}

export function projectQueryOptions() {
  return {
    queryKey: queryKeys.project,
    queryFn: ({ signal }: QueryFunctionContext) => displayRead<ProjectInfo>("/api/project", "project", signal),
    staleTime: DISPLAY_STALE_TIME_MS,
    gcTime: DISPLAY_GC_TIME_MS,
    ...displayRetryFor(DISPLAY_REGION_PATHS.project)
  };
}

export function sourcesQueryOptions() {
  return {
    queryKey: queryKeys.sources,
    queryFn: ({ signal }: QueryFunctionContext) => displayRead<SourcesResponse>("/api/sources", "sources", signal),
    staleTime: DISPLAY_STALE_TIME_MS,
    gcTime: DISPLAY_GC_TIME_MS,
    ...displayRetryFor(DISPLAY_REGION_PATHS.sources)
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
    ...displayRetryFor(DISPLAY_REGION_PATHS.agents)
  };
}

/** P1-58 — verified roster without audit statistics. */
export function adminAgentsRosterQueryOptions() {
  return {
    queryKey: [...queryKeys.adminAgents, "roster"] as const,
    queryFn: ({ signal }: QueryFunctionContext) =>
      displayRead<AgentsRosterResponse>("/api/admin/agents?view=roster", "agents", signal),
    ...displayRetryFor(DISPLAY_REGION_PATHS.agents)
  };
}

const rosterReadJourneys = new WeakMap<AbortSignal,{startedAt:number}>();
async function boundedRosterRead<T>(path:string, signal?:AbortSignal, deadline?:number):Promise<T> {
  let journey=signal?rosterReadJourneys.get(signal):undefined;
  if(!journey) {journey={startedAt:Date.now()};if(signal) rosterReadJourneys.set(signal,journey);}
  const remaining=Math.min(15000-(Date.now()-journey.startedAt),deadline===undefined?Infinity:deadline-Date.now());
  const timeoutError=()=>new ApiError({code:"ROSTER_READ_TIMEOUT",message:"页面数据读取超时，请重试。"});
  if(remaining<=0) throw timeoutError();
  const controller=new AbortController();
  const abort=()=>controller.abort(signal?.reason);
  signal?.addEventListener("abort",abort,{once:true});
  if(signal?.aborted) abort();
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},Math.min(DISPLAY_READ_REQUEST_TIMEOUT_MS,remaining));
  try{return await displayRead<T>(path,"agents",controller.signal);}
  catch(error){
    if(timedOut) throw timeoutError();
    // pending is not a failure: the next poll gets a fresh 15 s journey (see displayRead).
    if(isDisplayPendingError(error) && signal) rosterReadJourneys.delete(signal);
    throw error;
  }
  finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}

/** Explicit P1-66 projection; range also preserves ignored-parameter legacy full responses. */
export function adminAgentsSummaryQueryOptions(range: AgentStatsRange, deadline?:()=>number|undefined) {
  return {queryKey:[...queryKeys.adminAgents,"roster","summary","v1",range] as const,
    queryFn:async ({signal}:QueryFunctionContext)=>normalizeAgentRoster(
      await boundedRosterRead<unknown>(`/api/admin/agents?view=roster&projection=summary&range=${range}`,signal,deadline?.()),range),...displayRetryFor(DISPLAY_REGION_PATHS.agents)};
}
/**
 * P1-75 增量 F：只需 Agent 身份（id／名称／启用／Role）的页面（下拉、过滤、引导）用摘要投影，
 * 不再拉含 tokens／约束／完整权限的整份名册。
 */
export type AgentIdentity = Pick<Agent, "id" | "name" | "enabled" | "role" | "roles"> & { legacyWildcard: boolean };
export function adminAgentsIdentityQueryOptions() {
  return {queryKey:[...queryKeys.adminAgents,"roster","summary","v1","identity"] as const,
    queryFn:async ({signal}:QueryFunctionContext)=>{
      const raw=await boundedRosterRead<{agents?:Array<Agent&{legacyWildcard?:boolean}>}>("/api/admin/agents?view=roster&projection=summary",signal);
      // 只取身份字段：即使旧服务忽略 projection 返回整份，也不把 tokens／约束带进缓存。
      const agents: AgentIdentity[]=(Array.isArray(raw?.agents)?raw.agents:[]).map(a=>({
        id:a.id,name:a.name,enabled:a.enabled,role:a.role,roles:a.roles,
        legacyWildcard:typeof a.legacyWildcard==="boolean"?a.legacyWildcard:Boolean(a.allow?.tables?.includes("*")||a.allow?.tools?.includes("*"))
      }));
      return {agents};
    },...displayRetryFor(DISPLAY_REGION_PATHS.agents)};
}
export function adminAgentDrawerQueryOptions(id:string) {
  const validate=(data:{agent:Agent;version:string})=>{
    if(!data || data.agent?.id!==id || !Array.isArray(data.agent.tokens) || typeof data.version!=="string")
      throw new ApiError({code:"INVALID_AGENT_RESPONSE",message:"Agent 详情数据不完整，请重试。"});
    return data;
  };
  return {queryKey:[...queryKeys.adminAgents,"detail",id,"7d"] as const,
    queryFn:async ({signal}:QueryFunctionContext)=> {
      const data=await boundedRosterRead<{agent:Agent;version:string}>(`/api/admin/agents/${encodeURIComponent(id)}?range=7d`,signal);
      return validate(data);
    },
    // React Query select validates cached data too, including accidental DTO pollution.
    select:validate,
    ...displayRetryFor(`${DISPLAY_REGION_PATHS.agents}/${encodeURIComponent(id)}`)};
}
export function adminAgentsCompatibleStatisticsQueryOptions(range:AgentStatsRange, legacy:boolean, refresh=false, deadline?:()=>number|undefined, roster?:AgentRosterRead) {
  const base=adminAgentsStatisticsQueryOptions(range,refresh);
  return {...base,queryKey:[...base.queryKey,legacy?"legacy-roster":"summary-v1",roster?.version??null,roster?.meta?.snapshotVersion??null,...(legacy?[roster?.legacyReadContext??null]:[])],queryFn:async (ctx:QueryFunctionContext)=>{
    try {return await boundedRosterRead<AgentsStatisticsResponse>(`/api/admin/agents/statistics?range=${range}${refresh?"&refresh=true":""}`,ctx.signal,deadline?.());} catch(error) {
      if(legacy && error instanceof ApiError && error.httpStatus===404 && ["NOT_FOUND","AGENT_NOT_FOUND"].includes(error.code)) return null;
      throw error;
    }
  }};
}

/** P1-58 — dynamic statistics; server may reuse completed results for ≤5s unless refresh=true. */
export function adminAgentsStatisticsQueryOptions(range: AgentStatsRange, refresh = false) {
  const params = new URLSearchParams({ range });
  if (refresh) params.set("refresh", "true");
  return {
    queryKey: [...queryKeys.adminAgents, "statistics", range] as const,
    queryFn: ({ signal }: QueryFunctionContext) =>
      displayRead<AgentsStatisticsResponse>(`/api/admin/agents/statistics?${params.toString()}`, "agents", signal),
    ...displayRetryFor(DISPLAY_REGION_PATHS.agentStatistics)
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
    ...displayRetryFor(DISPLAY_REGION_PATHS.roles)
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
