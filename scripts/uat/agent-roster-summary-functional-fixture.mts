/** Functional faults/boundaries are isolated from all six performance seeds. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {parse,stringify} from '../../webui/node_modules/yaml/dist/index.js';
const root=path.resolve(new URL('../..',import.meta.url).pathname),out=path.join(root,'inbox/p166-implementation-20261120');
const folder=path.join(out,'BAL-1-FUNCTIONAL'),project=path.join(folder,'project');
const configPath=path.join(project,'webui/config/access.yaml');
const config=JSON.parse(JSON.stringify(parse(await readFile(configPath,'utf8'))));
const ktx=parse(await readFile(path.join(project,'ktx.yaml'),'utf8'));for(const conn of Object.values(ktx.connections) as any[])conn.host='p166-functional-db';await writeFile(path.join(project,'ktx.yaml'),stringify(ktx));
const overlay={name:'ars_00_source_000',grain:['id'],measures:[{name:'row_count',expr:'count(distinct id)'}]};
await writeFile(path.join(project,'config/semantic-layer/ars_00_c0/ars_00_source_000.yaml'),stringify(overlay));
config.roles.ars_zero={description:'Valid empty authorization',permission_model_version:2,allow:{tools:['lucy_read_source'],connections:[],tableSelectors:[]}};
const edgeTokens:Record<string,string>={};
for(const kind of ['expired','disabled','revoked','conflict','zero','missing','legacy']){
 const token=`ars-functional-${kind}`;edgeTokens[kind]=token;
 config.users.push({id:`ars_edge_${kind}`,name:`ARS edge ${kind}`,enabled:kind!=='disabled'&&kind!=='legacy',
  ...(kind==='conflict'?{role:'ars_00_r01',roles:['ars_00_r17']}:kind==='legacy'?{allow:{tables:['*'],tools:['*']}}:{roles:[kind==='zero'?'ars_zero':kind==='missing'?'ars_no_such_role':'ars_00_r01']}),
  tokens:kind==='revoked'?[]:[{hash:'sha256:'+createHash('sha256').update(token).digest('hex'),label:'edge',created:new Date().toISOString(),expires_at:kind==='expired'?'2020-01-01T00:00:00Z':'2027-02-01T00:00:00Z'}]});
}
await writeFile(configPath,stringify(config));await writeFile('/private/tmp/lucy-p166-private-20261120/edge-tokens.json',JSON.stringify(edgeTokens),{mode:0o600});
const seed=JSON.parse(await readFile(path.join(out,'BAL-1/fixture-manifest.json'),'utf8'));
await writeFile(path.join(folder,'fixture-manifest.json'),JSON.stringify({...seed,kind:'functional-boundaries',agents:config.users.length,normalPerformance:false,physicalOracle:[{id:1,region:'East',department:'Finance'},{id:2,region:'West',department:'Finance'},{id:3,region:'East',department:'Sales'},{id:4,region:'North',department:'Finance'}]},null,2));
const sql=(await readFile(path.join(out,'BAL-1/mysql-fixture.sql'),'utf8')).replace("(3,'East','Sales');","(3,'East','Sales'),(4,'North','Finance');");
await writeFile(path.join(folder,'mysql-fixture.sql'),sql);
console.log(JSON.stringify({functionalAgents:config.users.length,extraCases:Object.keys(edgeTokens),separateDatabase:'p166-functional-db',performanceSeedUnchanged:true}));
