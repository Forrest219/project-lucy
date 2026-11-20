import { ApiError } from "./apiClient";
import { AGENT_STATS_RANGE_HOURS, type AgentStatsRange } from "./agentStatsRange";
import type { Agent, AgentStats, AgentRosterRead, AgentRosterSummaryRow, AgentsResponseSummary, AgentsRosterSummaryResponse } from "./types";

const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const count = (v: unknown): v is number | null => v === null || (Number.isSafeInteger(v) && Number(v) >= 0);
const invalid = () => new ApiError({ code: "INVALID_ROSTER_RESPONSE", message: "Agent 名册数据暂时无法读取，请刷新重试。" });
const forbidden = ["tokens", "effectivePermissions", "allow", "constraints", "stats"];
const rowFields=new Set(["id","name","note","enabled","roles","role","roleResolutionError","declaredRole","declaredRoles","createdAt","configUpdatedAt","legacyWildcard","credentialSummary","permissionSummary","permissionWarnings"]);
const credentialFields=new Set(["state","configured","available","evaluatedAt"]);
const permissionFields=new Set(["state","sourceCount","connectionCount","toolCount","capabilityCount","snapshotHash","sourceMapVersion"]);
const onlyKeys=(value:Record<string,unknown>,keys:Set<string>)=>Object.keys(value).every(k=>keys.has(k));
let legacyReadSequence=0;
function validIdentity(v: unknown): v is Record<string, unknown> & {id:string;name:string;enabled:boolean} {
  return object(v) && typeof v.id === "string" && Boolean(v.id) && typeof v.name === "string" && typeof v.enabled === "boolean"
    && (v.roles === undefined || (Array.isArray(v.roles) && v.roles.every(x => typeof x === "string")))
    && (v.role === undefined || typeof v.role === "string");
}
function validSummaryRow(v: unknown): v is AgentRosterSummaryRow {
  if (!validIdentity(v) || !onlyKeys(v,rowFields) || forbidden.some(k => Object.hasOwn(v,k)) || typeof v.legacyWildcard !== "boolean"
    || !object(v.credentialSummary) || !object(v.permissionSummary) || !Array.isArray(v.permissionWarnings)
    || !v.permissionWarnings.every(x=>typeof x === "string")) return false;
  const c = v.credentialSummary, p = v.permissionSummary;
  return onlyKeys(c,credentialFields) && onlyKeys(p,permissionFields) && c.state === "ok" && typeof c.evaluatedAt === "string" && Number.isFinite(Date.parse(c.evaluatedAt))
    && Number.isSafeInteger(c.configured) && Number(c.configured) >= 0 && Number.isSafeInteger(c.available)
    && Number(c.available) >= 0 && Number(c.available) <= Number(c.configured)
    && ["ok","unavailable"].includes(String(p.state))
    && [p.sourceCount,p.connectionCount,p.toolCount,p.capabilityCount].every(x=>count(x) && (p.state !== "ok" || x !== null))
    && (p.state !== "unavailable" || [p.sourceCount,p.connectionCount,p.toolCount,p.capabilityCount,p.snapshotHash,p.sourceMapVersion].every(x=>x === null))
    && (p.state !== "ok" || (typeof p.snapshotHash === "string" && typeof p.sourceMapVersion === "string"));
}
function legacyRow(agent: Agent, observedAt?: string): AgentRosterSummaryRow {
  const now = observedAt ? Date.parse(observedAt) : NaN;
  const complete = Number.isFinite(now) && agent.tokens.every(t=>Object.hasOwn(t,"expires_at")
    && (t.expires_at === null || (typeof t.expires_at === "string" && Number.isFinite(Date.parse(t.expires_at)))));
  const available = !agent.enabled || agent.tokens.length === 0 ? 0 : complete
    ? agent.tokens.filter(t=>t.expires_at === null || Date.parse(t.expires_at!) > now).length : null;
  const p = agent.effectivePermissions;
  const known = p && Array.isArray(p.sources) && Array.isArray(p.connections) && Array.isArray(p.tools) && Array.isArray(p.capabilities);
  return { id:agent.id,name:agent.name,note:agent.note,enabled:agent.enabled,roles:agent.roles,role:agent.role,
    roleResolutionError:agent.roleResolutionError,declaredRole:agent.declaredRole,declaredRoles:agent.declaredRoles,
    createdAt:agent.createdAt,configUpdatedAt:agent.configUpdatedAt,
    legacyWildcard:Boolean(agent.allow?.tables?.includes("*") || agent.allow?.tools?.includes("*")),
    credentialSummary:{state:available===null?"unavailable":"ok",configured:agent.tokens.length,available,evaluatedAt:Number.isFinite(now)?observedAt!:null},
    permissionSummary:{state:known?"ok":"unavailable",sourceCount:known?p.sources.length:null,connectionCount:known?p.connections.length:null,
      toolCount:known?p.tools.length:null,capabilityCount:known?p.capabilities!.length:null,snapshotHash:known?p.snapshotHash??null:null,sourceMapVersion:known?p.sourceMapVersion??null:null},
    permissionWarnings:agent.permissionWarnings??[] };
}
export function normalizeAgentRoster(raw: unknown, range: AgentStatsRange): AgentRosterRead {
  if (!object(raw) || !Array.isArray(raw.agents) || new Set(raw.agents.map(x=>object(x)?x.id:undefined)).size !== raw.agents.length) throw invalid();
  const meta = object(raw.meta) ? raw.meta : undefined;
  if (meta && (Object.hasOwn(meta,"projection") || Object.hasOwn(meta,"projectionVersion"))) {
    if (meta.projection !== "summary" || meta.projectionVersion !== 1 || typeof raw.version !== "string" || !raw.version
      || typeof meta.snapshotVersion !== "string" || !meta.snapshotVersion || typeof meta.generatedAt !== "string"
      || !Number.isFinite(Date.parse(meta.generatedAt)) || !["ok","partial","unavailable"].includes(String(meta.permissionsState))
      || !["matched","unconfirmed"].includes(String(meta.runtimeConsistency)) || !raw.agents.every(validSummaryRow)) throw invalid();
    const data = raw as unknown as AgentsRosterSummaryResponse;
    return {kind:"summary-v1",agents:data.agents,version:data.version,meta:data.meta};
  }
  if (Object.hasOwn(raw,"version") && (typeof raw.version !== "string" || !raw.version)) throw invalid();
  if (!raw.agents.every(x=>validIdentity(x) && Array.isArray(x.tokens) && x.tokens.every(t=>object(t)))) throw invalid();
  const agents = raw.agents as Agent[];
  const summary = object(raw.summary) ? raw.summary : undefined;
  const observedAt = typeof meta?.generatedAt === "string" ? meta.generatedAt : typeof summary?.windowEnd === "string" ? summary.windowEnd : undefined;
  const inlineValid = summary && summary.range === range && typeof summary.windowStart === "string" && typeof summary.windowEnd === "string"
    && Number.isFinite(Date.parse(summary.windowStart)) && Number.isFinite(Date.parse(summary.windowEnd))
    && Date.parse(summary.windowStart)<Date.parse(summary.windowEnd) && summary.agentCount===agents.length
    && Date.parse(summary.windowEnd)-Date.parse(summary.windowStart)===AGENT_STATS_RANGE_HOURS[range]*3600000
    && agents.every(a=>object(a.stats));
  const version = typeof raw.version === "string" ? raw.version : undefined;
  // A known full envelope remains full even if its window is unusable: never start a second capability probe.
  const kind = summary ? "legacy-full" : "legacy-roster";
  if (!summary && !version) throw invalid();
  return {kind,legacyReadContext:kind==="legacy-roster"?++legacyReadSequence:undefined,agents:agents.map(a=>legacyRow(a,observedAt)),version,
    meta:meta?{snapshotVersion:typeof meta.snapshotVersion==="string"?meta.snapshotVersion:undefined,generatedAt:observedAt,runtimeConsistency:meta.runtimeConsistency==="matched"?"matched":meta.runtimeConsistency==="unconfirmed"?"unconfirmed":undefined}:undefined,
    inlineStatistics:inlineValid?{agents:agents.map(a=>({id:a.id,stats:a.stats})),summary:{...summary,
      usageCallsLast7d:count(summary.usageCallsLast7d)?summary.usageCallsLast7d:null,
      usageActiveAgentCountLast7d:count(summary.usageActiveAgentCountLast7d)?summary.usageActiveAgentCountLast7d:null
    } as unknown as AgentsResponseSummary}:undefined};
}
export function rosterConfigurationSummary(rows: AgentRosterSummaryRow[]): AgentsResponseSummary {
  const configured = rows.reduce((n,r)=>n+(r.credentialSummary.configured??0),0);
  const available = rows.every(r=>r.credentialSummary.available!==null)
    ? rows.reduce((n,r)=>n+r.credentialSummary.available!,0):undefined;
  return {agentCount:rows.length,enabledAgentCount:rows.filter(r=>r.enabled).length,configuredTokenCount:configured,
    availableTokenCount:available,activeTokenCountLast7d:null,callsLast7d:null,deniedLast7d:null,
    usageCallsLast7d:null,usageActiveAgentCountLast7d:null,businessCallsLast7d:null,protocolCallsLast7d:null,
    activeAgentCountLast7d:null,businessActiveAgentCountLast7d:null,metricsState:"unavailable"};
}

/** Aggregate verified row statistics without manufacturing a full Agent or credentials. */
export function rosterStatisticsSummary(rows: Array<AgentRosterSummaryRow & {stats?:AgentStats}>): AgentsResponseSummary {
  const sum=(field:keyof AgentStats)=>rows.every(r=>r.stats?.metricsState!=="unavailable" && typeof r.stats?.[field]==="number")
    ? rows.reduce((n,r)=>n+Number(r.stats![field]),0):null;
  const usage=sum("usageCallsLast7d"),business=sum("businessCallsLast7d");
  return {...rosterConfigurationSummary(rows),metricsState:rows.some(r=>r.stats?.metricsState==="unavailable")?"unavailable":"ok",
    usageCallsLast7d:usage,usageActiveAgentCountLast7d:usage===null?null:rows.filter(r=>(r.stats?.usageCallsLast7d??0)>0).length,
    callsLast7d:sum("callsLast7d"),deniedLast7d:sum("deniedLast7d"),businessCallsLast7d:business,protocolCallsLast7d:sum("protocolCallsLast7d"),
    activeAgentCountLast7d:business===null?null:rows.filter(r=>(r.stats?.businessCallsLast7d??0)>0).length,
    businessActiveAgentCountLast7d:business===null?null:rows.filter(r=>(r.stats?.businessCallsLast7d??0)>0).length};
}
