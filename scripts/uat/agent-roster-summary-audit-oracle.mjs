/** Run over stdin inside the task-owned container; never prints credentials. */
import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';
const require=createRequire('/app/webui/package.json'),Database=require('better-sqlite3'),YAML=require('yaml');
const config=YAML.parse(readFileSync('/data/lucy/webui/config/access.yaml','utf8'));
const credentials=new Map(config.users.map(u=>[u.id,new Set((u.tokens??[]).map(t=>t.hash.slice(0,19)))]));
const db=new Database('/data/lucy/.ktx-ui/audit.sqlite',{readonly:true});
const shape=db.prepare("SELECT count(*) AS rows,min(id) AS minId,max(id) AS maxId,min(ts) AS minTs,max(ts) AS maxTs,sum(tool='server/probe') AS protocolRows,sum(outcome='denied') AS deniedRows FROM access_log").get();
const sourceAssociationErrors=db.prepare("SELECT count(*) AS n FROM access_log WHERE tables IS NOT NULL AND tables<>json_array(substr(user_id,1,6)||'.fact_000')").get().n;
const associations=db.prepare('SELECT user_id,token_hash_prefix,count(*) AS n FROM access_log GROUP BY user_id,token_hash_prefix').all();
const credentialAssociationErrors=associations.filter(r=>!credentials.get(r.user_id)?.has(r.token_hash_prefix)).reduce((n,r)=>n+r.n,0);
let window;
if(process.env.P166_WINDOW_START&&process.env.P166_WINDOW_END){
 const start=process.env.P166_WINDOW_START,end=process.env.P166_WINDOW_END;
 window={start,end,idCeiling:shape.maxId,...db.prepare("SELECT count(*) AS rows,sum(tool<>'server/probe') AS businessRows,sum(tool='server/probe') AS protocolRows,count(DISTINCT user_id) AS activeAgents,count(DISTINCT token_hash_prefix) AS activeCredentials FROM access_log WHERE ts>=? AND ts<? AND id<=?").get(start,end,shape.maxId)};
}
console.log(JSON.stringify({shape,window,sourceAssociationErrors,credentialAssociationErrors,syntheticCredentialCount:[...credentials.values()].reduce((n,t)=>n+t.size,0)}));db.close();
