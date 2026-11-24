/** Rebuild only oracle manifests, using the frozen A compiler. Never rewrites inputs/audit. */
import {readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
import {compiledGrantProjectionFingerprint,compiledNormalizedGraph} from './agent-roster-summary-oracle.mjs';
const root=path.resolve(new URL('../..',import.meta.url).pathname),out=path.join(root,'inbox/p166-implementation-20261120'),name=process.argv[2];
if(!/^(BAL|SKEW)-(1|2|5)(-L)?$/.test(name??''))throw Error('task-owned named fixture required');
const folder=path.join(out,name),project=path.join(folder,'project');process.env.KTX_PROJECT_ROOT=project;process.env.LUCY_CONTENT_ROOT=path.join(project,'config');
const frozen=path.join(out,'baseline-context');const {parseAccessConfigText}=await import(pathToFileURL(path.join(frozen,'webui/server/proxy/identity.ts')).href);
const {buildAdminPermissionContext,resolveEffectivePermissionsBatchForAdmin}=await import(pathToFileURL(path.join(frozen,'webui/server/proxy/acl.ts')).href);
const raw=await readFile(path.join(project,'webui/config/access.yaml'),'utf8'),config=parseAccessConfigText(raw);const manifest=JSON.parse(await readFile(path.join(folder,'fixture-manifest.json'),'utf8'));
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');if(digest(raw)!==manifest.configDigest)throw Error('frozen access inputs changed');
const started=Date.now(),context=await buildAdminPermissionContext(config),compiled=await resolveEffectivePermissionsBatchForAdmin(config.users.map((u:any)=>u.id),context);
const rows=config.users.map((user:any,i:number)=>{const result=compiled.get(user.id);if(!result?.ok)throw Error(user.id+' compiler failed');const p=result.permissions,old=manifest.perAgent[i];
 const actual={id:user.id,roles:user.roles,identityDigest:createHash("sha256").update(JSON.stringify({id:user.id,roles:user.roles,constraints:user.constraints})).digest("hex"),capabilities:p.capabilities.length,sources:p.sources.length,connections:p.connections.length,tools:p.tools.length,
  normalizedFingerprint:compiledNormalizedGraph(user,p),grantProjectionFingerprint:compiledGrantProjectionFingerprint(p)};
 if(['id','capabilities','sources','connections','tools'].some(k=>(actual as any)[k]!==old[k]))throw Error('compiler cardinality drift '+user.id);return actual;
});
for(let i=71;i<rows.length;i++)if(rows[i].normalizedFingerprint!==rows[i%71].normalizedFingerprint)throw Error('AST replica mismatch '+rows[i].id);
if(digest(await readFile(path.join(project,'webui/config/access.yaml'),'utf8'))!==manifest.configDigest)throw Error('oracle modified input');
manifest.perAgent=rows;manifest.fingerprintVersion=2;manifest.oracleCompiler='frozen A source; full Role OR / FinalRows AND AST with nested source renaming, source-bound digests checked separately';
manifest.oracleCompileMs=Date.now()-started;await writeFile(path.join(folder,'fixture-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({name,agents:rows.length,capabilities:manifest.capabilities,astReplicaMismatches:0,compileMs:manifest.oracleCompileMs,inputsUnchanged:true}));
