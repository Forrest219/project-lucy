import http from 'node:http';
/** Faults at a real HTTP hop: successful payloads always come from Lucy.
 * Committed payloads may be discarded and replaced by a gateway error. A complete
 * HTTP error avoids Chromium transparently retransmitting a TCP-reset request. */
export async function startRacsProxy(target, port=55290) {
  if(new URL(target).hostname!=='127.0.0.1')throw Error('loopback target only');
  const state={htmlRoles:0,htmlStatus:502,holdRolesMs:0,holdStatsMs:0,dropWrites:0,dropStatuses:0,events:[]};
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
    const route=new URL(req.url,'http://localhost').pathname;
    const isRoles=route==='/api/admin/roles'&&req.method==='GET';
    const isStats=route==='/api/admin/agents/statistics';
    const isWrite=['POST','PATCH','DELETE'].includes(req.method)&&/^\/api\/admin\/(roles|agents)(\/|$)/.test(route)&&(()=>{try{return JSON.parse(body).dryRun===false}catch{return false}})();
    if(isRoles&&state.holdRolesMs)await new Promise(r=>setTimeout(r,state.holdRolesMs));
    if(isStats&&state.holdStatsMs)await new Promise(r=>setTimeout(r,state.holdStatsMs));
    const gateway=isRoles&&state.htmlRoles>0;if(gateway)state.htmlRoles--;
    const upstream=new URL(req.url,target);if(gateway)upstream.port='9';
    const call=http.request(upstream,{method:req.method,headers:{...req.headers}},async response=>{
      const parts=[];for await(const chunk of response)parts.push(chunk);const bytes=Buffer.concat(parts);
      state.events.push({method:req.method,route,status:response.statusCode,write:isWrite});
      let committed=false;try{const j=JSON.parse(bytes);committed=response.statusCode===200&&j.data?.written===true}catch{}
      const statusDrop=route.startsWith('/api/admin/access-write-status/')&&state.dropStatuses>0;
      if(statusDrop)state.dropStatuses--;
      if(isWrite&&committed&&state.dropWrites>0){state.dropWrites--;state.events.push({method:req.method,route,event:'committed-response-dropped'});res.writeHead(502,{'content-type':'text/html','connection':'close'});res.end('<html><body>502 response lost at test gateway</body></html>');return}
      if(statusDrop){res.writeHead(502,{'content-type':'text/html','connection':'close'});res.end('<html><body>502 status response lost at test gateway</body></html>');return}
      res.writeHead(response.statusCode,response.headers);res.end(bytes);
    });
    call.on('error',error=>{state.events.push({method:req.method,route,event:'upstream-connect-failure',code:error.code,status:state.htmlStatus});if(!res.destroyed){res.writeHead(state.htmlStatus,{'content-type':'text/html'});res.end('<html><body><h1>'+state.htmlStatus+' Bad Gateway</h1></body></html>')}});
    call.end(body);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
  return{state,web:'http://127.0.0.1:'+port,close:()=>new Promise(r=>server.close(r))};
}
