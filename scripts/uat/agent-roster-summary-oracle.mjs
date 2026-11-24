/** Independent workload verdicts. Only full public API fields supply scale evidence. */
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const tuple=c=>({tool:c.tool,connectionId:c.connectionId,schema:c.schema,sourceName:c.sourceName,physicalTable:c.physicalTable});
const grantSignature=g=>!g||g==='all'||g.kind==='all'?{kind:'all'}:{kind:'scoped',digest:g.digest,predicates:g.predicates??[]};
const grantAst=g=>!g||g==='all'||g.kind==='all'?{kind:'all'}:{kind:'scoped',predicates:g.predicates,orArms:g.orArms};
export function compiledGrantProjectionFingerprint(p){
 return hash(p.capabilities.map(c=>({...tuple(c),rowGrant:grantSignature(c.rowGrant),finalRows:grantSignature(p.finalRowsBySource?.[`${c.connectionId}\u0000${c.sourceName}`]??c.rowGrant)})));
}
export function compiledNormalizedGraph(user,p){
 const graph={roles:user.roles,constraints:user.constraints,tools:p.tools,connections:p.connections,sources:p.sources,
  capabilities:p.capabilities.map(c=>({...tuple(c),rowGrant:grantAst(c.rowGrant)})),
  finalRows:Object.entries(p.finalRowsBySource??{}).map(([key,value])=>[key,grantAst(value)]),constraintsBySource:p.agentConstraintsBySource};
 return hash(JSON.parse(JSON.stringify(graph).replace(/ars_\d\d/g,'ars_XX')));
}
function stripScopedDigest(v){if(Array.isArray(v))return v.map(stripScopedDigest);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!(v.kind==='scoped'&&k==='digest')).map(([k,x])=>[k,stripScopedDigest(x)]));return v;}
export function permissionSemantic(value){
 if(Array.isArray(value))return value.map(permissionSemantic);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['snapshotHash','sourceMapVersion','capabilityDigest'].includes(key)).map(([key,v])=>[key,permissionSemantic(v)]));
 return value;
}
export function agentScale(agent){
 const p=agent.effectivePermissions;
 // Source-bound grant hashes legitimately change on replica renaming. Check them
 // exactly against the raw compiler vector, while comparing normalized predicates separately.
 const graph=JSON.stringify(stripScopedDigest(permissionSemantic({roles:agent.roles,constraints:agent.constraints,permissions:p}))).replace(/ars_\d\d/g,'ars_XX');
 return {id:agent.id,roles:agent.roles,identityDigest:hash({id:agent.id,roles:agent.roles,constraints:agent.constraints}),capabilities:p?.capabilities?.length??0,sources:p?.sources?.length??0,connections:p?.connections?.length??0,tools:p?.tools?.length??0,
  permissionBytes:Buffer.byteLength(JSON.stringify(p??null)),normalizedFingerprint:createHash('sha256').update(graph).digest('hex'),
  semanticDigest:createHash('sha256').update(JSON.stringify(permissionSemantic(p))).digest('hex'),constraints:agent.constraints,
  grantProjectionFingerprint:p?hash(p.capabilities.map(c=>({...tuple(c),rowGrant:grantSignature(c.rowGrant),finalRows:grantSignature(c.finalRows??c.rowGrant)}))):null,
  uniqueCapabilities:new Set((p?.capabilities??[]).map(c=>JSON.stringify([c.tool,c.connectionId,c.schema,c.sourceName,c.physicalTable,c.rowGrant]))).size};
}
export function validateScale(manifest,rows){
 const errors=[],check=(v,m)=>{if(!v)errors.push(m);},k=manifest.copies;
 check(rows.length===71*k,'71 Agents per replica');check(manifest.formalRoles===47*k,'47 fixture formal Roles per replica');
 check(manifest.connections>=9*k,'9 connections per replica');check(manifest.manifestSources>=263*k&&manifest.enabledSources>=259*k,'source lower bounds');
 check(manifest.auditRows>=1000000*k&&manifest.windowRows>=200000*k,'audit scale');
 check(rows.every(a=>a.capabilities>0&&a.uniqueCapabilities===a.capabilities),'real nonempty duplicate-free capabilities');
 if(manifest.perAgent)check(rows.every((a,i)=>{
  const expected=manifest.perAgent[i];return expected&&['capabilities','sources','connections','tools','grantProjectionFingerprint','identityDigest'].every(k=>a[k]===expected[k]);
 }),'frozen per-Agent compiler vector');
 if(manifest.width==='H'){
  check(rows.reduce((n,a)=>n+a.capabilities,0)>=13815*k,'capability floor');check(rows.reduce((n,a)=>n+a.permissionBytes,0)>=4740771*k,'permission byte floor');
 }
 for(let replica=0;replica<k;replica++){
  const a=rows.slice(replica*71,(replica+1)*71),total=a.reduce((n,x)=>n+x.capabilities,0),max=Math.max(...a.map(x=>x.capabilities));
  check(a.every((x,i)=>x.id===`ars_${String(replica).padStart(2,'0')}_a${String(i).padStart(2,'0')}`),'deterministic disjoint identities');
  check(a.every(x=>x.roles?.length>=1&&x.roles.length<=3),'valid role bindings');
  const counts=new Map();for(const x of a)for(const r of x.roles??[])counts.set(r,(counts.get(r)??0)+1);
  check(counts.size>=30&&Math.max(...counts.values())>=36,'distributed and shared Role populations');
  if(manifest.width==='H'){
   check(a.filter(x=>x.capabilities>=200).length>=15,'15 medium/wide Agents');
   if(manifest.profile==='BAL')check(a.filter(x=>x.capabilities>=150).length>=57&&max>=2000&&max<=total*.25,'BAL distribution');
   else check(max>=total*.25&&max<=total*.5,'SKEW distribution');
   check(a.some(x=>x.roles.length===1&&x.sources>=207&&x.connections>=9),'one wide Agent and its single wide Role');
  }
  check(a.filter(x=>x.constraints?.sources?.some(s=>s.predicates?.length)).length>=8,'eight real personal Constraints');
  for(let i=0;i<a.length;i++)check(a[i].normalizedFingerprint===rows[i].normalizedFingerprint,'replica graph including Role OR / Constraints AND / finalRows');
 }
 return errors;
}
export function p95(values){const a=values.toSorted((a,b)=>a-b);return a[Math.ceil(a.length*.95)-1]??null;}
export function validateWidth(low,high){
 const errors=[];
 if(low.agents!==71||high.agents!==71||!low.identityDigest||low.identityDigest!==high.identityDigest)errors.push('WIDTH must preserve identities, bindings, credentials and Constraints');
 if(high.capabilities<2*low.capabilities)errors.push('WIDTH real capabilities must at least double');
 if(high.permissionCompactBytes<2*low.permissionCompactBytes)errors.push('WIDTH real permission bytes must at least double');
 if(!(low.summaryBodyBytes>0)||high.summaryBodyBytes>low.summaryBodyBytes*1.05)errors.push('WIDTH summary growth exceeds 5%');
 return errors;
}
