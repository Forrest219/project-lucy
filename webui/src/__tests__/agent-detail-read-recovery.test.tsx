// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {AgentDetail} from '../pages/admin/AgentDetail';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function show(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/admin/agents/gone']}><Routes><Route path="/admin/agents/:userId" element={<AgentDetail/>}/><Route path="/admin/agents" element={<div>名册已返回</div>}/></Routes></MemoryRouter></QueryClientProvider>);}
describe('independent detail read escape and retry',()=>{
 it('verified deletion provides a usable return to roster',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>new Response(JSON.stringify(String(input).includes('/agents/gone')?{ok:false,error:{code:'AGENT_NOT_FOUND',message:'deleted'}}:{ok:true,data:{roles:[]}}),{status:String(input).includes('/agents/gone')?404:200,headers:{'content-type':'application/json'}})));
  show();expect(await screen.findByTestId('agent-detail-not-found')).toHaveTextContent('未找到该 Agent');fireEvent.click(screen.getByRole('link',{name:'返回 Agent'}));expect(await screen.findByText('名册已返回')).toBeVisible();
 });
 it('service failure remains an error and retry issues a fresh detail read',async()=>{
  let reads=0;vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const detail=String(input).includes('/agents/gone');if(detail)reads++;return new Response(JSON.stringify(detail?{ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'暂时无法读取'}}:{ok:true,data:{roles:[]}}),{status:detail?503:200,headers:{'content-type':'application/json'}});}));
  show();expect(await screen.findByTestId('agent-detail-read-error')).toBeVisible();expect(screen.queryByText('未找到该 Agent')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'重试'}));await vi.waitFor(()=>expect(reads).toBe(2));expect(screen.getByRole('link',{name:'返回 Agent'})).toBeVisible();
 });
});
