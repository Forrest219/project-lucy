/** Isolated UAT only. No diagnostic HTTP routes are added to Lucy. */
import http from "node:http";
import { unlink } from "node:fs/promises";
import { startServer } from "../../webui/server/index.js";
import * as agents from "../../webui/server/admin/agents.js";
import { bumpDisplayGeneration } from "../../webui/server/display-generation.js";
import { displaySnapshotDiagnostics } from "../../webui/server/display-snapshot.js";
const socket="/tmp/p166-control.sock";
await unlink(socket).catch(()=>{});
const state=await startServer();
http.createServer((request,response)=>{
  const counters=(agents as any).agentRosterProjectionDiagnostics;
  if(request.url==="/cold") bumpDisplayGeneration(["P"]);
  if(request.url==="/reset") counters?.reset();
  response.setHeader("content-type","application/json");
  response.end(JSON.stringify({counters:counters?.read()??null,startup:state.timings,snapshots:displaySnapshotDiagnostics()}));
}).listen(socket);
