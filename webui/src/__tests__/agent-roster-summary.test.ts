import { describe, expect, it } from "vitest";
import { normalizeAgentRoster, rosterConfigurationSummary } from "../lib/agentRosterSummary";
const row={id:"a",name:"Agent A",enabled:true,legacyWildcard:false,
  credentialSummary:{state:"ok",configured:2,available:0,evaluatedAt:"2026-11-20T00:00:00Z"},
  permissionSummary:{state:"ok",sourceCount:207,connectionCount:9,toolCount:19,capabilityCount:2000,snapshotHash:"hash",sourceMapVersion:"map"},permissionWarnings:[]};
const native=()=>({agents:[structuredClone(row)],version:"config",meta:{projection:"summary",projectionVersion:1,snapshotVersion:"snapshot",generatedAt:"2026-11-20T00:00:00Z",permissionsState:"ok",runtimeConsistency:"matched"}});
describe("P1-66 response modes and data isolation",()=>{
  it("keeps native summary distinct and rejects a leaked full permission object",()=>{
    const value=native();expect(normalizeAgentRoster(value,"30d").kind).toBe("summary-v1");
    Object.assign(value.agents[0],{effectivePermissions:{capabilities:[]}});
    expect(()=>normalizeAgentRoster(value,"30d")).toThrow();
  });
  it("rejects direct capability leakage and contradictory projection markers",()=>{
    const leaked=native();Object.assign(leaked.agents[0],{capabilities:[]});expect(()=>normalizeAgentRoster(leaked,"30d")).toThrow();
    expect(()=>normalizeAgentRoster({version:"v",agents:[{id:"a",name:"A",enabled:true,tokens:[]}],meta:{projectionVersion:1}},"30d")).toThrow();
  });
  it("does not reinterpret unknown projection versions or missing markers as a legacy Agent",()=>{
    const value=native();value.meta.projectionVersion=2;expect(()=>normalizeAgentRoster(value,"30d")).toThrow();
    expect(()=>normalizeAgentRoster({agents:[row],version:"config"},"30d")).toThrow();
    expect(()=>normalizeAgentRoster({agents:[],meta:{projection:"summary"}},"30d")).toThrow();
  });
  it("uses inline legacy-full statistics without inventing snapshot versions",()=>{
    const body={agents:[{id:"a",name:"A",enabled:true,tokens:[],stats:{usageCallsLast7d:4}}],
      summary:{agentCount:1,range:"30d",windowStart:"2026-10-21T00:00:00Z",windowEnd:"2026-11-20T00:00:00Z"}};
    const result=normalizeAgentRoster(body,"30d");expect(result.kind).toBe("legacy-full");
    expect(result.inlineStatistics?.agents[0].stats?.usageCallsLast7d).toBe(4);expect(result.meta?.snapshotVersion).toBeUndefined();
    expect(result.inlineStatistics?.summary.usageCallsLast7d).toBeNull();
    expect(normalizeAgentRoster(body,"7d").inlineStatistics).toBeUndefined();
    expect(normalizeAgentRoster(body,"7d").kind).toBe("legacy-full");
    expect(normalizeAgentRoster({...body,summary:{...body.summary,windowStart:"2026-11-13T00:00:00Z"}},"30d").inlineStatistics).toBeUndefined();
  });
  it("scopes a legacy capability conclusion to its actual read, without fabricating server versions",()=>{
    const body={version:"old",agents:[{id:"a",name:"A",enabled:true,tokens:[]}],meta:{snapshotVersion:"real-old-snapshot"}};
    const first=normalizeAgentRoster(body,"7d"),next=normalizeAgentRoster(body,"7d");
    expect(first.legacyReadContext).not.toBe(next.legacyReadContext);
    expect(first.version).toBe("old");expect(next.meta?.snapshotVersion).toBe("real-old-snapshot");
  });
  it("keeps unknown legacy credential validity null, not configured-as-available",()=>{
    const result=normalizeAgentRoster({version:"old",agents:[{id:"a",name:"A",enabled:true,tokens:[{label:"x"}]}]},"7d");
    expect(result.kind).toBe("legacy-roster");expect(result.agents[0].credentialSummary).toMatchObject({configured:1,available:null,state:"unavailable"});
    expect(rosterConfigurationSummary(result.agents).availableTokenCount).toBeUndefined();
  });
  it("rejects duplicate identities and success counters missing in a native summary",()=>{
    const value=native();value.agents.push({...row});expect(()=>normalizeAgentRoster(value,"30d")).toThrow();
    const broken=native();Object.assign(broken.agents[0].permissionSummary,{sourceCount:null});expect(()=>normalizeAgentRoster(broken,"30d")).toThrow();
  });
  it("configuration aggregation remains independent from late audit counts",()=>{
    const result=normalizeAgentRoster(native(),"30d");expect(rosterConfigurationSummary(result.agents).availableTokenCount).toBe(0);
    expect(rosterConfigurationSummary(result.agents).usageCallsLast7d).toBeNull();
  });
});
