import { it,expect,vi } from 'vitest';
import Fastify from 'fastify';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {makePackDb} from './fixtures/export-catchup-fixture';
function parseStoredZipEntries(zip: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = zip.subarray(nameStart, nameStart + nameLength).toString("utf8");
    entries.set(name, zip.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}
const ctx=vi.hoisted(()=>({calls:0,lagged:false,kind:"normal"}));
vi.mock('../security/instance.js',async()=>({...await vi.importActual<any>('../security/instance.js'),getSecurityStore:async()=>({ok:true,value:{maxEventSeq:()=>({ok:true,value:3})}})}));
vi.mock('../security/projector.js',async()=>({...await vi.importActual<any>('../security/projector.js'),
 projectionStatus:()=>{
  ctx.calls++;
  if(ctx.kind==='future')return {complete:false,cursor:3,latestSeq:6,lag:3,delayMs:1,reason:'projection_lag'};
  const lag=ctx.kind==='stuck'||(ctx.lagged&&ctx.calls===1)?1:0;
  return{complete:lag===0,cursor:lag?2:3,latestSeq:3,lag,delayMs:0};
 },
 triggerAuditProjection:()=>{},runProjection:()=>{}
}));
vi.mock('../admin/audit-export-v2.js',async()=>({...await vi.importActual<any>('../admin/audit-export-v2.js'),DEFAULT_CATCH_UP_DEADLINE_MS:500}));
it('complete HTTP export succeeds after the projection catches up within its deadline',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'lucy-export-recheck-'));const dbFile=path.join(root,'audit.sqlite');vi.stubEnv('LUCY_AUDIT_DB',dbFile);
 const fixture=makePackDb();await fixture.backup(dbFile);fixture.close();
 const {registerAuditRoutes,getAuditDb}=await import('../admin/audit');const app=Fastify();registerAuditRoutes(app);await getAuditDb();const observations:any[]=[];
 try{
  for(const route of ['/api/admin/audit/export-v2','/api/admin/audit/export-pack-v2']){
   for(const variant of ['complete-zero-lag','complete-caught-up','diagnostic-caught-up','complete-future','complete-stuck','diagnostic-stuck']){
    ctx.calls=0;ctx.lagged=variant!=='complete-zero-lag';ctx.kind=variant.endsWith('future')?'future':variant.endsWith('stuck')?'stuck':'normal';const mode=variant.startsWith('diagnostic')?'diagnostic':'complete';
    const response=await app.inject({method:'GET',url:route+'?mode='+mode+(mode==='diagnostic'?'&confirmDiagnostic=true':'')});
    if(route.endsWith('export-pack-v2')&&response.statusCode===200){
      const entries=parseStoredZipEntries(response.rawPayload);
      const manifest=JSON.parse(entries.get('manifest.json')!.toString('utf8'));
      expect(manifest.ledgerUpperSeq).toBe(3);
      expect(manifest.combinedComplete).toBe(variant!=='diagnostic-stuck');
      expect(manifest.projectionComplete).toBe(variant!=='diagnostic-stuck');
    }
    observations.push({route,variant,fixtureKind:ctx.kind,capturedS:3,statusReads:ctx.calls,code:response.statusCode,error:response.statusCode>=400?response.json().error:null,bytes:response.rawPayload.length});
   }
  }
  console.log('FORMAL_EXPORT_RECHECK',JSON.stringify({fixture:'Real Fastify route, real SQLite and exporter; controlled zero/caught-up/future/stuck projection scenarios',observations}));
  for(const row of observations){expect(row.code,JSON.stringify(row)).toBe(row.variant==='complete-stuck'?409:200);if(row.variant==='complete-stuck')expect(row.error).toBeTruthy();}
 }finally{await app.close();(await getAuditDb()).close();vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});}
});
