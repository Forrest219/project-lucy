import {test} from 'node:test';import assert from 'node:assert/strict';
import {agentScale,permissionSemantic,p95,validateScale,validateWidth,compiledNormalizedGraph} from './agent-roster-summary-oracle.mjs';
test('same Agent count and thin permission DTOs cannot pass R0',()=>{
 const rows=Array.from({length:71},(_,i)=>agentScale({id:`ars_00_a${String(i).padStart(2,'0')}`,roles:['one'],effectivePermissions:{capabilities:[{tool:'lucy_query',connectionId:'c',sourceName:'s'}],sources:['s'],connections:['c'],tools:['lucy_query']}}));
 const errors=validateScale({copies:1,profile:'BAL',width:'H',formalRoles:47,connections:9,manifestSources:724,enabledSources:720,auditRows:1e6,windowRows:2e5},rows);
 for(const expected of ['capability floor','permission byte floor','BAL distribution','distributed and shared Role populations','eight real personal Constraints'])assert(errors.includes(expected));
});
test('public finalRows and Constraints affect normalized graph identity',()=>{
 const agent={id:'ars_00_a00',roles:['ars_00_r00'],constraints:{sources:[{connection:'ars_00_c0',predicates:[{field:'department',value:'Finance'}]}]},effectivePermissions:{capabilities:[{tool:'lucy_query',connectionId:'ars_00_c0',sourceName:'ars_00_source_000',finalRows:{kind:'scoped',value:'Finance'}}],sources:[],connections:[],tools:[]}};
 const renamed=JSON.parse(JSON.stringify(agent).replaceAll('ars_00','ars_01'));
 assert.equal(agentScale(agent).normalizedFingerprint,agentScale(renamed).normalizedFingerprint);
 renamed.effectivePermissions.capabilities[0].finalRows.value='Sales';assert.notEqual(agentScale(agent).normalizedFingerprint,agentScale(renamed).normalizedFingerprint);
 assert.deepEqual(permissionSemantic({snapshotHash:'opaque',rowGrant:{kind:'all'}}),{rowGrant:{kind:'all'}});
});
test('nearest-rank includes the slowest of five cold samples',()=>assert.equal(p95([1,2,3,4,100]),100));
test('duplicate capabilities are rejected independently of total and bytes',()=>{
 const c={tool:'lucy_query',connectionId:'c',sourceName:'s'};
 const rows=[agentScale({id:'ars_00_a00',roles:['r'],effectivePermissions:{capabilities:[c,c],sources:['s'],connections:['c'],tools:['lucy_query']}})];
 assert(validateScale({copies:1,width:'H'},rows).includes('real nonempty duplicate-free capabilities'));
});
test('padding bytes alone cannot pass WIDTH and identity drift is rejected',()=>{
 const low={agents:71,identityDigest:'same',capabilities:100,permissionCompactBytes:1000,summaryBodyBytes:100};
 assert(validateWidth(low,{...low,permissionCompactBytes:2000}).includes('WIDTH real capabilities must at least double'));
 assert(validateWidth(low,{...low,capabilities:200,permissionCompactBytes:2000,identityDigest:'changed'}).some(x=>x.includes('identities')));
 assert.deepEqual(validateWidth(low,{...low,capabilities:200,permissionCompactBytes:2000,summaryBodyBytes:105}),[]);
});
test('full AST detects changed OR grouping even when flattened predicates are identical',()=>{
 const predicates=[{field:'region',value:'East'},{field:'region',value:'West'}],user={roles:['ars_00_r00']};
 const permission=orArms=>({tools:[],connections:[],sources:[],capabilities:[{tool:'q',connectionId:'ars_00_c0',sourceName:'ars_00_s',rowGrant:{kind:'scoped',predicates,orArms}}]});
 assert.notEqual(compiledNormalizedGraph(user,permission(predicates.map(p=>[p]))),compiledNormalizedGraph(user,permission([predicates])));
});
