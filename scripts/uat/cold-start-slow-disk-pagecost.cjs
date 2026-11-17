// 诊断（非门禁）：在候选/基线镜像内，用与 `rebuildInferredTurnsUnlocked` 的 loadPage 相同的 SQL 读一个用户的 4 页（每页 LIMIT 400），打印每页同步耗时。
// 该 SQL 是 webui/server/proxy/audit.ts 在 7b882c7c 的 loadPage 的副本；改了那条查询须同步改这里。
// 由 `cold-start-slow-disk.mjs pagecost` 调用，不要手工跑。输出一行 JSON。
const D=require("/app/webui/node_modules/better-sqlite3");
const db=new D("/data/lucy/.ktx-ui/audit.sqlite",{readonly:true});
const cutoff=new Date(Date.now()-30*864e5).toISOString();
const u=process.env.U||"uat-cold-user-005";
const ceil=db.prepare("SELECT COALESCE(MAX(id),0) id FROM access_log WHERE user_id=? AND ts>=?").get(u,cutoff).id;
const q=db.prepare(`SELECT id, ts, tool, tables, args_summary, policy_version, permission_snapshot_hash, lucy_session_id, lucy_turn_id, client, client_version, user_agent FROM access_log WHERE user_id=? AND ts>=? AND id<=? AND (ts>? OR (ts=? AND id>?)) ORDER BY ts ASC, id ASC LIMIT 400`);
let cts="",cid=0;const out=[];
for(let p=0;p<4;p++){const t=process.hrtime.bigint();const page=q.all(u,cutoff,ceil,cts,cts,cid);out.push(Number(process.hrtime.bigint()-t)/1e6|0);if(!page.length)break;const l=page[page.length-1];cts=l.ts;cid=l.id;}
console.log(JSON.stringify({ user: u, rowsPerPage: 400, pageMs: out }));
