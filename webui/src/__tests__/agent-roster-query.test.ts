import {QueryClient} from '@tanstack/react-query';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {adminAgentDrawerQueryOptions,adminAgentsCompatibleStatisticsQueryOptions,adminAgentsSummaryQueryOptions} from '../lib/displayQueryOptions';
const failure=(status:number,code:string)=>new Response(JSON.stringify({ok:false,error:{code,message:'读取失败'}}),{status});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('P1-66 compatibility probes and bounded reads',()=>{
 it('a cached legacy 404 cannot poison native or another legacy read context',async()=>{
  const legacy={kind:'legacy-roster' as const,agents:[],version:'v',legacyReadContext:1,meta:{snapshotVersion:'s'}};
  const old=adminAgentsCompatibleStatisticsQueryOptions('30d',true,false,undefined,legacy);
  const client=new QueryClient();client.setQueryData(old.queryKey,null);
  const native=adminAgentsCompatibleStatisticsQueryOptions('30d',false,false,undefined,{...legacy,kind:'summary-v1'});
  const next=adminAgentsCompatibleStatisticsQueryOptions('30d',true,false,undefined,{...legacy,legacyReadContext:2});
  expect(client.getQueryData(native.queryKey)).toBeUndefined();expect(client.getQueryData(next.queryKey)).toBeUndefined();
 });
 it('only an identified legacy roster can treat the exact JSON statistics 404 as unsupported',async()=>{
  const fetch=vi.fn(async()=>failure(404,'AGENT_NOT_FOUND'));vi.stubGlobal('fetch',fetch);
  const client=new QueryClient();
  expect(await client.fetchQuery({...adminAgentsCompatibleStatisticsQueryOptions('7d',true),retry:false})).toBeNull();
  await expect(client.fetchQuery({...adminAgentsCompatibleStatisticsQueryOptions('14d',false),retry:false})).rejects.toMatchObject({code:'AGENT_NOT_FOUND'});
  expect(fetch.mock.calls.length).toBe(2);
 });
 it('does not reinterpret HTML gateway, auth, parameter, or server errors as missing capabilities',async()=>{
  const client=new QueryClient();
  for(const response of [new Response('<html>not found</html>',{status:404,headers:{'content-type':'text/html'}}),failure(403,'FORBIDDEN'),failure(400,'BAD_REQUEST'),failure(503,'UNAVAILABLE')]){
   vi.stubGlobal('fetch',vi.fn(async()=>response));
   await expect(client.fetchQuery({...adminAgentsCompatibleStatisticsQueryOptions('30d',true),retry:false})).rejects.toBeDefined();
  }
 });
 it('a version repair cannot start another read after its shared deadline',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(new QueryClient().fetchQuery({...adminAgentsSummaryQueryOptions('30d',()=>Date.now()-1),retry:false})).rejects.toMatchObject({code:'ROSTER_READ_TIMEOUT'});
  expect(fetch).not.toHaveBeenCalled();
 });
 it('never starts an Agent drawer request without its ID and fixed 7d window',async()=>{
  const fetch=vi.fn(async(_input:RequestInfo|URL)=>new Response(JSON.stringify({ok:true,data:{version:'v',agent:{id:'a/b',tokens:[]}}})));vi.stubGlobal('fetch',fetch);
  const options=adminAgentDrawerQueryOptions('a/b');await new QueryClient().fetchQuery(options);
  expect(String(fetch.mock.calls[0]?.[0])).toBe('/api/admin/agents/a%2Fb?range=7d');
  expect(options.queryKey).toEqual(['admin','agents','detail','a/b','7d']);
 });
});
