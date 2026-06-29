# Headless Delivery Gate Evidence

- Date: 2026-06-29
- Scope: customer headless delivery local gates
- Docker: daemon started during this run after initial socket-unavailable retry
- Commands: security:baseline, smoke:p0:docker, smoke:p0:demo, smoke:p0:postgres-demo, smoke:p0:business-eval


## security:baseline

```text
$ npm run security:baseline

> project-lucy-eval@0.1.0 security:baseline
> node scripts/security-baseline.mjs

[security-baseline] PASS 0 warning(s)

(exit 0)
```

## smoke:p0:docker

```text
$ npm run smoke:p0:docker

> project-lucy-eval@0.1.0 smoke:p0:docker
> node scripts/p0-smoke.mjs --docker


[p0-smoke] $ npm run lint:spec

> project-lucy-eval@0.1.0 lint:spec
> node scripts/lint-spec.mjs

[spec-lint] PASS route-status
  routes and status table are aligned for first-batch modules
[spec-lint] PASS api-spec
  47 registered REST routes are documented
[spec-lint] PASS skill-dependency
  2 skill files have resolvable dependencies
[spec-lint] PASS eval-schema-version
  2 eval files are readable with safety_contract and valid quiz links
[spec-lint] WARN access-role-policy
  webui/config/access.yaml: disabled legacy wildcard user lisi must not be re-enabled without role
[spec-lint] PASS access-role-policy
  access role policy has no blocking errors

[p0-smoke] $ npm run build

> webui@1.0.0 build
> vite build

vite v8.0.16 building client environment for production...
[2Ktransforming...✓ 322 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.39 kB │ gzip:   0.26 kB
dist/assets/index-DCh7RwzR.css   48.37 kB │ gzip:   7.31 kB
dist/assets/index-CYieaamP.js   628.13 kB │ gzip: 183.99 kB

✓ built in 180ms
[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.

[p0-smoke] $ npm test

> webui@1.0.0 test
> vitest run --maxWorkers=1


 RUN  v4.1.9 /Users/forrest/Projects/project-lucy/webui

{"level":30,"time":1782709944267,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"GET","url":"/api/admin/audit?limit=10","host":"127.0.0.1:51302","remoteAddress":"::ffff:127.0.0.1","remotePort":51303},"msg":"incoming request"}
{"level":30,"time":1782709944270,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":2.7572079999372363,"msg":"request completed"}
{"level":30,"time":1782709944273,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-2","req":{"method":"GET","url":"/api/admin/audit?includeProtocol=true&limit=10","host":"127.0.0.1:51304","remoteAddress":"::ffff:127.0.0.1","remotePort":51305},"msg":"incoming request"}
{"level":30,"time":1782709944273,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-2","res":{"statusCode":200},"responseTime":0.3675830001011491,"msg":"request completed"}
{"level":30,"time":1782709944274,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-3","req":{"method":"GET","url":"/api/admin/audit/export","host":"127.0.0.1:51306","remoteAddress":"::ffff:127.0.0.1","remotePort":51307},"msg":"incoming request"}
{"level":30,"time":1782709944275,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-3","res":{"statusCode":200},"responseTime":0.38487499998882413,"msg":"request completed"}
{"level":30,"time":1782709944276,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-4","req":{"method":"GET","url":"/api/admin/audit?sessionId=session-1&limit=10","host":"127.0.0.1:51308","remoteAddress":"::ffff:127.0.0.1","remotePort":51309},"msg":"incoming request"}
{"level":30,"time":1782709944276,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-4","res":{"statusCode":200},"responseTime":0.2616250002756715,"msg":"request completed"}
{"level":30,"time":1782709944277,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-5","req":{"method":"GET","url":"/api/admin/audit/sources","host":"127.0.0.1:51310","remoteAddress":"::ffff:127.0.0.1","remotePort":51311},"msg":"incoming request"}
{"level":30,"time":1782709944277,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-5","res":{"statusCode":200},"responseTime":0.32670799968764186,"msg":"request completed"}
{"level":30,"time":1782709944286,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"GET","url":"/api/admin/config-audit?targetId=workhorse","host":"127.0.0.1:51312","remoteAddress":"::ffff:127.0.0.1","remotePort":51313},"msg":"incoming request"}
{"level":30,"time":1782709944286,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":0.28087500017136335,"msg":"request completed"}
{"level":30,"time":1782709944287,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-2","req":{"method":"GET","url":"/api/admin/config-audit/export.csv?targetId=workhorse","host":"127.0.0.1:51314","remoteAddress":"::ffff:127.0.0.1","remotePort":51315},"msg":"incoming request"}
{"level":30,"time":1782709944287,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-2","res":{"statusCode":200},"responseTime":0.21574999997392297,"msg":"request completed"}
{"level":30,"time":1782709944296,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"GET","url":"/api/admin/audit/1/sources","host":"127.0.0.1:51316","remoteAddress":"::ffff:127.0.0.1","remotePort":51317},"msg":"incoming request"}
{"level":30,"time":1782709944297,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":0.7532500000670552,"msg":"request completed"}
{"level":30,"time":1782709944299,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-2","req":{"method":"GET","url":"/api/admin/audit/1000/sources","host":"127.0.0.1:51318","remoteAddress":"::ffff:127.0.0.1","remotePort":51319},"msg":"incoming request"}
{"level":30,"time":1782709944299,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-2","res":{"statusCode":200},"responseTime":0.48050000006332994,"msg":"request completed"}
{"level":30,"time":1782709944300,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-3","req":{"method":"GET","url":"/api/admin/audit/not-a-number/sources","host":"127.0.0.1:51320","remoteAddress":"::ffff:127.0.0.1","remotePort":51321},"msg":"incoming request"}
{"level":30,"time":1782709944300,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-3","res":{"statusCode":400},"responseTime":0.11275000032037497,"msg":"request completed"}
{"level":30,"time":1782709944307,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"GET","url":"/api/admin/audit/turns?user=turns-user&source=inferred","host":"127.0.0.1:51322","remoteAddress":"::ffff:127.0.0.1","remotePort":51323},"msg":"incoming request"}
{"level":30,"time":1782709944309,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":1.5272500002756715,"msg":"request completed"}
{"level":30,"time":1782709944310,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-2","req":{"method":"GET","url":"/api/admin/audit/turns?user=turns-user&source=reported","host":"127.0.0.1:51324","remoteAddress":"::ffff:127.0.0.1","remotePort":51325},"msg":"incoming request"}
{"level":30,"time":1782709944310,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-2","res":{"statusCode":200},"responseTime":0.13624999998137355,"msg":"request completed"}
{"level":30,"time":1782709944311,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-3","req":{"method":"GET","url":"/api/admin/audit/turns?user=turns-user&source=all","host":"127.0.0.1:51326","remoteAddress":"::ffff:127.0.0.1","remotePort":51327},"msg":"incoming request"}
{"level":30,"time":1782709944311,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-3","res":{"statusCode":200},"responseTime":0.1825000001117587,"msg":"request completed"}
{"level":30,"time":1782709944319,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"GET","url":"/api/admin/audit/turns?user=turns-detail-user&source=inferred","host":"127.0.0.1:51328","remoteAddress":"::ffff:127.0.0.1","remotePort":51329},"msg":"incoming request"}
{"level":30,"time":1782709944320,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":1.0801249998621643,"msg":"request completed"}
{"level":30,"time":1782709944321,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-2","req":{"method":"GET","url":"/api/admin/audit/turns/inf_20260629051224312_turns-detail-user_01","host":"127.0.0.1:51330","remoteAddress":"::ffff:127.0.0.1","remotePort":51331},"msg":"incoming request"}
{"level":30,"time":1782709944321,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-2","res":{"statusCode":200},"responseTime":0.2032919996418059,"msg":"request completed"}
{"level":30,"time":1782709944322,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-3","req":{"method":"GET","url":"/api/admin/audit/turns/lucy_turns_detail_1","host":"127.0.0.1:51332","remoteAddress":"::ffff:127.0.0.1","remotePort":51333},"msg":"incoming request"}
{"level":30,"time":1782709944322,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-3","res":{"statusCode":200},"responseTime":0.12741700001060963,"msg":"request completed"}
{"level":30,"time":1782709944323,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-4","req":{"method":"GET","url":"/api/admin/audit/turns/inf_does_not_exist","host":"127.0.0.1:51334","remoteAddress":"::ffff:127.0.0.1","remotePort":51335},"msg":"incoming request"}
{"level":30,"time":1782709944323,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-4","res":{"statusCode":404},"responseTime":0.07537500001490116,"msg":"request completed"}
{"level":30,"time":1782709944323,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-5","req":{"method":"GET","url":"/api/admin/audit/turns/lucy_does_not_exist","host":"127.0.0.1:51336","remoteAddress":"::ffff:127.0.0.1","remotePort":51337},"msg":"incoming request"}
{"level":30,"time":1782709944323,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-5","res":{"statusCode":404},"responseTime":0.1512500001117587,"msg":"request completed"}
{"level":30,"time":1782709944331,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"GET","url":"/api/admin/audit/turns?user=debounce-window-user&source=inferred&lookbackHours=1","host":"127.0.0.1:51338","remoteAddress":"::ffff:127.0.0.1","remotePort":51339},"msg":"incoming request"}
{"level":30,"time":1782709944333,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":1.1142090000212193,"msg":"request completed"}
{"level":30,"time":1782709944333,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-2","req":{"method":"GET","url":"/api/admin/audit/turns?user=debounce-window-user&source=inferred&lookbackHours=24","host":"127.0.0.1:51340","remoteAddress":"::ffff:127.0.0.1","remotePort":51341},"msg":"incoming request"}
{"level":30,"time":1782709944333,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-2","res":{"statusCode":200},"responseTime":0.2501670001074672,"msg":"request completed"}
{"level":30,"time":1782709944342,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"POST","url":"/api/admin/audit/conversation-turns/purge","host":"127.0.0.1:51342","remoteAddress":"::ffff:127.0.0.1","remotePort":51343},"msg":"incoming request"}
{"level":30,"time":1782709944343,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":0.8378340001218021,"msg":"request completed"}
{"level":30,"time":1782709944343,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-2","req":{"method":"POST","url":"/api/admin/audit/conversation-turns/purge","host":"127.0.0.1:51344","remoteAddress":"::ffff:127.0.0.1","remotePort":51345},"msg":"incoming request"}
{"level":30,"time":1782709944344,"pid":39471,"hostname":"forrestdeMac-mini.local","reqId":"req-2","res":{"statusCode":200},"responseTime":0.3452920001000166,"msg":"request completed"}
{"level":30,"time":1782709945106,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"GET","url":"/api/admin/agents","host":"127.0.0.1:51374","remoteAddress":"::ffff:127.0.0.1","remotePort":51375},"msg":"incoming request"}
{"level":30,"time":1782709945117,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":10.43204199988395,"msg":"request completed"}
{"level":30,"time":1782709945124,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"GET","url":"/api/admin/agents/zhangsan","host":"127.0.0.1:51376","remoteAddress":"::ffff:127.0.0.1","remotePort":51377},"msg":"incoming request"}
{"level":30,"time":1782709945132,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":7.417916999664158,"msg":"request completed"}
{"level":30,"time":1782709945138,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"GET","url":"/api/admin/roles","host":"127.0.0.1:51378","remoteAddress":"::ffff:127.0.0.1","remotePort":51379},"msg":"incoming request"}
{"level":30,"time":1782709945145,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":7.547540999948978,"msg":"request completed"}
{"level":30,"time":1782709945147,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-2","req":{"method":"PATCH","url":"/api/admin/agents/zhangsan","host":"127.0.0.1:51380","remoteAddress":"::ffff:127.0.0.1","remotePort":51381},"msg":"incoming request"}
{"level":30,"time":1782709945153,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-2","res":{"statusCode":200},"responseTime":6.1025419998914,"msg":"request completed"}
{"level":30,"time":1782709945154,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-3","req":{"method":"GET","url":"/api/admin/agents/zhangsan/effective-permissions","host":"127.0.0.1:51382","remoteAddress":"::ffff:127.0.0.1","remotePort":51383},"msg":"incoming request"}
{"level":30,"time":1782709945155,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-3","res":{"statusCode":200},"responseTime":1.3915420002304018,"msg":"request completed"}
{"level":30,"time":1782709945161,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"POST","url":"/api/admin/agents","host":"127.0.0.1:51384","remoteAddress":"::ffff:127.0.0.1","remotePort":51385},"msg":"incoming request"}
{"level":30,"time":1782709945164,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":2.6458749999292195,"msg":"request completed"}
{"level":30,"time":1782709945171,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"POST","url":"/api/admin/agents","host":"127.0.0.1:51386","remoteAddress":"::ffff:127.0.0.1","remotePort":51387},"msg":"incoming request"}
{"level":30,"time":1782709945175,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":4.637000000104308,"msg":"request completed"}
{"level":30,"time":1782709945180,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"POST","url":"/api/admin/agents","host":"127.0.0.1:51388","remoteAddress":"::ffff:127.0.0.1","remotePort":51389},"msg":"incoming request"}
{"level":30,"time":1782709945183,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":409},"responseTime":2.4592499998398125,"msg":"request completed"}
{"level":30,"time":1782709945189,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"POST","url":"/api/admin/agents","host":"127.0.0.1:51390","remoteAddress":"::ffff:127.0.0.1","remotePort":51391},"msg":"incoming request"}
{"level":30,"time":1782709945189,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":400},"responseTime":0.5254999999888241,"msg":"request completed"}
{"level":30,"time":1782709945195,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"GET","url":"/api/admin/agents/zhangsan","host":"127.0.0.1:51392","remoteAddress":"::ffff:127.0.0.1","remotePort":51393},"msg":"incoming request"}
{"level":30,"time":1782709945197,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":1.5466249999590218,"msg":"request completed"}
{"level":30,"time":1782709945197,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-2","req":{"method":"PATCH","url":"/api/admin/agents/zhangsan","host":"127.0.0.1:51394","remoteAddress":"::ffff:127.0.0.1","remotePort":51395},"msg":"incoming request"}
{"level":30,"time":1782709945199,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-2","res":{"statusCode":200},"responseTime":2.0816250001080334,"msg":"request completed"}
{"level":30,"time":1782709945204,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"PATCH","url":"/api/admin/agents/zhangsan","host":"127.0.0.1:51396","remoteAddress":"::ffff:127.0.0.1","remotePort":51397},"msg":"incoming request"}
{"level":30,"time":1782709945205,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":409},"responseTime":0.3084999998100102,"msg":"request completed"}
{"level":30,"time":1782709945211,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"PATCH","url":"/api/admin/agents/notexist","host":"127.0.0.1:51398","remoteAddress":"::ffff:127.0.0.1","remotePort":51399},"msg":"incoming request"}
{"level":30,"time":1782709945211,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":404},"responseTime":0.8830840000882745,"msg":"request completed"}
{"level":30,"time":1782709945217,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"PATCH","url":"/api/admin/agents/zhangsan","host":"127.0.0.1:51400","remoteAddress":"::ffff:127.0.0.1","remotePort":51401},"msg":"incoming request"}
{"level":30,"time":1782709945217,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":400},"responseTime":0.767041000071913,"msg":"request completed"}
{"level":30,"time":1782709945222,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"PATCH","url":"/api/admin/agents/lisi","host":"127.0.0.1:51402","remoteAddress":"::ffff:127.0.0.1","remotePort":51403},"msg":"incoming request"}
{"level":30,"time":1782709945222,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":400},"responseTime":0.9152909996919334,"msg":"request completed"}
{"level":30,"time":1782709945229,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"PATCH","url":"/api/admin/agents/lisi","host":"127.0.0.1:51404","remoteAddress":"::ffff:127.0.0.1","remotePort":51405},"msg":"incoming request"}
{"level":30,"time":1782709945232,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":3.115207999944687,"msg":"request completed"}
{"level":30,"time":1782709945237,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"DELETE","url":"/api/admin/agents/zhangsan","host":"127.0.0.1:51406","remoteAddress":"::ffff:127.0.0.1","remotePort":51407},"msg":"incoming request"}
{"level":30,"time":1782709945238,"pid":39475,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":1.2107500000856817,"msg":"request completed"}
{"level":30,"time":1782709946852,"pid":39479,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"PUT","url":"/api/sources/mysql-aliyun/dataforai/superstore_orders","host":"127.0.0.1:51408","remoteAddress":"::ffff:127.0.0.1","remotePort":51409},"msg":"incoming request"}
{"level":30,"time":1782709946861,"pid":39479,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":8.297125000040978,"msg":"request completed"}
{"level":30,"time":1782709946869,"pid":39479,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"PUT","url":"/api/sources/mysql-aliyun/dataforai/superstore_orders","host":"127.0.0.1:51410","remoteAddress":"::ffff:127.0.0.1","remotePort":51411},"msg":"incoming request"}
{"level":30,"time":1782709946887,"pid":39479,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":17.402333999983966,"msg":"request completed"}
{"level":30,"time":1782709946893,"pid":39479,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"PUT","url":"/api/sources/bad..conn/dataforai/superstore_orders","host":"127.0.0.1:51412","remoteAddress":"::ffff:127.0.0.1","remotePort":51413},"msg":"incoming request"}
{"level":30,"time":1782709946893,"pid":39479,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":403},"responseTime":0.38395800022408366,"msg":"request completed"}
{"level":30,"time":1782709946900,"pid":39479,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"PUT","url":"/api/connections/mysql-aliyun/enabled-tables","host":"127.0.0.1:51414","remoteAddress":"::ffff:127.0.0.1","remotePort":51415},"msg":"incoming request"}
{"level":30,"time":1782709946902,"pid":39479,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":1.6856249999254942,"msg":"request completed"}
{"level":30,"time":1782709946909,"pid":39479,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"PUT","url":"/api/connections/mysql-aliyun/enabled-tables","host":"127.0.0.1:51416","remoteAddress":"::ffff:127.0.0.1","remotePort":51417},"msg":"incoming request"}
{"level":30,"time":1782709946910,"pid":39479,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":400},"responseTime":1.3117090002633631,"msg":"request completed"}
{"level":30,"time":1782709946920,"pid":39479,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"PUT","url":"/api/connections/mysql-aliyun/enabled-tables","host":"127.0.0.1:51418","remoteAddress":"::ffff:127.0.0.1","remotePort":51419},"msg":"incoming request"}
{"level":30,"time":1782709946926,"pid":39479,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":400},"responseTime":5.442332999780774,"msg":"request completed"}
{"level":30,"time":1782709946940,"pid":39479,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"PUT","url":"/api/connections/mysql-aliyun/enabled-tables","host":"127.0.0.1:51420","remoteAddress":"::ffff:127.0.0.1","remotePort":51421},"msg":"incoming request"}
{"level":30,"time":1782709946945,"pid":39479,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":4.381417000200599,"msg":"request completed"}
{"level":30,"time":1782709948141,"pid":39519,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"GET","url":"/api/admin/roles","host":"127.0.0.1:51434","remoteAddress":"::ffff:127.0.0.1","remotePort":51435},"msg":"incoming request"}
{"level":30,"time":1782709948158,"pid":39519,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":16.671500000171363,"msg":"request completed"}
{"level":30,"time":1782709948167,"pid":39519,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"GET","url":"/api/admin/roles","host":"127.0.0.1:51436","remoteAddress":"::ffff:127.0.0.1","remotePort":51437},"msg":"incoming request"}
{"level":30,"time":1782709948172,"pid":39519,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":4.723250000271946,"msg":"request completed"}
{"level":30,"time":1782709948179,"pid":39519,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"POST","url":"/api/admin/agents","host":"127.0.0.1:51438","remoteAddress":"::ffff:127.0.0.1","remotePort":51439},"msg":"incoming request"}
{"level":30,"time":1782709948182,"pid":39519,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":3.822292000055313,"msg":"request completed"}
{"level":30,"time":1782709948184,"pid":39519,"hostname":"forrestdeMac-mini.local","reqId":"req-2","req":{"method":"POST","url":"/api/admin/agents","host":"127.0.0.1:51440","remoteAddress":"::ffff:127.0.0.1","remotePort":51441},"msg":"incoming request"}
{"level":30,"time":1782709948187,"pid":39519,"hostname":"forrestdeMac-mini.local","reqId":"req-2","res":{"statusCode":200},"responseTime":3.177958999760449,"msg":"request completed"}
{"level":30,"time":1782709948356,"pid":39520,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"POST","url":"/api/admin/agents/zhangsan/tokens","host":"127.0.0.1:51442","remoteAddress":"::ffff:127.0.0.1","remotePort":51443},"msg":"incoming request"}
{"level":30,"time":1782709948364,"pid":39520,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":8.110917000100017,"msg":"request completed"}
{"level":30,"time":1782709948370,"pid":39520,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"POST","url":"/api/admin/agents/zhangsan/tokens","host":"127.0.0.1:51444","remoteAddress":"::ffff:127.0.0.1","remotePort":51445},"msg":"incoming request"}
{"level":30,"time":1782709948372,"pid":39520,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":1.5690000001341105,"msg":"request completed"}
{"level":30,"time":1782709948377,"pid":39520,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"POST","url":"/api/admin/agents/zhangsan/tokens","host":"127.0.0.1:51446","remoteAddress":"::ffff:127.0.0.1","remotePort":51447},"msg":"incoming request"}
{"level":30,"time":1782709948378,"pid":39520,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":409},"responseTime":0.7811249997466803,"msg":"request completed"}
{"level":30,"time":1782709948383,"pid":39520,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"POST","url":"/api/admin/agents/nobody/tokens","host":"127.0.0.1:51448","remoteAddress":"::ffff:127.0.0.1","remotePort":51449},"msg":"incoming request"}
{"level":30,"time":1782709948384,"pid":39520,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":404},"responseTime":0.6416670000180602,"msg":"request completed"}
{"level":30,"time":1782709948389,"pid":39520,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"DELETE","url":"/api/admin/agents/zhangsan/tokens/hermes-laptop","host":"127.0.0.1:51450","remoteAddress":"::ffff:127.0.0.1","remotePort":51451},"msg":"incoming request"}
{"level":30,"time":1782709948391,"pid":39520,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":1.6628750003874302,"msg":"request completed"}
{"level":30,"time":1782709948396,"pid":39520,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"DELETE","url":"/api/admin/agents/zhangsan/tokens/not-a-label","host":"127.0.0.1:51452","remoteAddress":"::ffff:127.0.0.1","remotePort":51453},"msg":"incoming request"}
{"level":30,"time":1782709948396,"pid":39520,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":404},"responseTime":0.5626669996418059,"msg":"request completed"}
{"level":30,"time":1782709949000,"pid":39523,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"GET","url":"/api/eval/domains","host":"127.0.0.1:51454","remoteAddress":"::ffff:127.0.0.1","remotePort":51455},"msg":"incoming request"}
{"level":30,"time":1782709949006,"pid":39523,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":5.454499999992549,"msg":"request completed"}
{"level":30,"time":1782709949015,"pid":39523,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"GET","url":"/api/eval/runs/12","host":"127.0.0.1:51456","remoteAddress":"::ffff:127.0.0.1","remotePort":51457},"msg":"incoming request"}
{"level":30,"time":1782709949016,"pid":39523,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":0.28270799992606044,"msg":"request completed"}
{"level":30,"time":1782709949017,"pid":39523,"hostname":"forrestdeMac-mini.local","reqId":"req-2","req":{"method":"GET","url":"/api/eval/runs/12/artifact?type=json","host":"127.0.0.1:51458","remoteAddress":"::ffff:127.0.0.1","remotePort":51459},"msg":"incoming request"}
{"level":30,"time":1782709949017,"pid":39523,"hostname":"forrestdeMac-mini.local","reqId":"req-2","res":{"statusCode":200},"responseTime":0.4095000000670552,"msg":"request completed"}
{"level":30,"time":1782709949018,"pid":39523,"hostname":"forrestdeMac-mini.local","reqId":"req-3","req":{"method":"GET","url":"/api/eval/runs/12/compare?with=11","host":"127.0.0.1:51460","remoteAddress":"::ffff:127.0.0.1","remotePort":51461},"msg":"incoming request"}
{"level":30,"time":1782709949018,"pid":39523,"hostname":"forrestdeMac-mini.local","reqId":"req-3","res":{"statusCode":200},"responseTime":0.26687500020489097,"msg":"request completed"}
{"level":30,"time":1782709949019,"pid":39523,"hostname":"forrestdeMac-mini.local","reqId":"req-4","req":{"method":"GET","url":"/api/eval/monitor/drift-distribution?domain=superstore&days=30","host":"127.0.0.1:51462","remoteAddress":"::ffff:127.0.0.1","remotePort":51463},"msg":"incoming request"}
{"level":30,"time":1782709949020,"pid":39523,"hostname":"forrestdeMac-mini.local","reqId":"req-4","res":{"statusCode":200},"responseTime":0.29437500005587935,"msg":"request completed"}

 Test Files  31 passed (31)
      Tests  186 passed (186)
   Start at  13:12:21
   Duration  9.19s (transform 290ms, setup 0ms, import 1.64s, tests 3.63s, environment 2.24s)


[p0-smoke] $ bash -n scripts/docker-entrypoint.sh scripts/docker-healthcheck.sh

[p0-smoke] $ docker compose config

[p0-smoke] starting local WebUI smoke server

> webui@1.0.0 start
> tsx server/index.ts

{"level":30,"time":1782709950985,"pid":39601,"hostname":"forrestdeMac-mini.local","msg":"Server listening at http://127.0.0.1:55174"}
Lucy WebUI listening on http://127.0.0.1:55174
MCP proxy listening on http://127.0.0.1:57879/mcp
{"level":30,"time":1782709951637,"pid":39601,"hostname":"forrestdeMac-mini.local","reqId":"req-1","req":{"method":"GET","url":"/api/health","host":"127.0.0.1:55174","remoteAddress":"127.0.0.1","remotePort":51466},"msg":"incoming request"}
{"level":30,"time":1782709951644,"pid":39601,"hostname":"forrestdeMac-mini.local","reqId":"req-1","res":{"statusCode":200},"responseTime":7.16904200008139,"msg":"request completed"}
{"level":30,"time":1782709951653,"pid":39601,"hostname":"forrestdeMac-mini.local","reqId":"req-2","req":{"method":"GET","url":"/","host":"127.0.0.1:55174","remoteAddress":"127.0.0.1","remotePort":51467},"msg":"incoming request"}
{"level":30,"time":1782709951656,"pid":39601,"hostname":"forrestdeMac-mini.local","reqId":"req-2","res":{"statusCode":200},"responseTime":3.198249999899417,"msg":"request completed"}
[p0-smoke] using temporary DOCKER_CONFIG=/var/folders/rk/k516h8td2qbdr20gtb2wq0cr0000gn/T/lucy-docker-config-8WTp68

[p0-smoke] $ docker info

[p0-smoke] $ docker build --build-arg KTX_VERSION=0.13.0 -t project-lucy:p0-smoke .
DEPRECATED: The legacy builder is deprecated and will be removed in a future release.
            Install the buildx component to build images with BuildKit:
            https://docs.docker.com/go/buildx/

Sending build context to Docker daemon   7.01MB
Step 1/17 : FROM node:22-bookworm-slim
 ---> 813a7480f28f
Step 2/17 : ARG KTX_VERSION=0.13.0
 ---> Using cache
 ---> 3e012fec4cee
Step 3/17 : ENV NODE_ENV=production     LUCY_BUNDLED_KTX_VERSION=${KTX_VERSION}     KTX_PROJECT_ROOT=/data/lucy     LUCY_WEBUI_HOST=0.0.0.0     LUCY_WEBUI_PORT=5174     LUCY_PROXY_HOST=0.0.0.0     LUCY_PROXY_PORT=7879     LUCY_PROXY_UPSTREAM_HOST=127.0.0.1     LUCY_PROXY_UPSTREAM_PORT=7878     KTX_TELEMETRY_DISABLED=1     POSTHOG_DISABLED=1
 ---> Using cache
 ---> d89b374b8761
Step 4/17 : WORKDIR /app
 ---> Using cache
 ---> 43fd21c31a22
Step 5/17 : RUN apt-get update   && apt-get install -y --no-install-recommends bash ca-certificates curl git tini   && rm -rf /var/lib/apt/lists/*
 ---> Using cache
 ---> e726f515f40d
Step 6/17 : RUN npm install -g "@kaelio/ktx@${KTX_VERSION}"
 ---> Using cache
 ---> 01a6c6587aee
Step 7/17 : RUN ktx admin runtime install --yes --feature core
 ---> Using cache
 ---> 75ca70cafcbb
Step 8/17 : COPY package.json package-lock.json ./
 ---> Using cache
 ---> e22b65c9d086
Step 9/17 : RUN npm ci --include=dev
 ---> Using cache
 ---> 4a6cac07ad5e
Step 10/17 : COPY webui/package.json webui/package-lock.json ./webui/
 ---> Using cache
 ---> 58cfc7ab0a14
Step 11/17 : RUN cd webui && npm ci --include=dev
 ---> Using cache
 ---> c9601b642a6b
Step 12/17 : COPY . .
 ---> a354f9b6ee0c
Step 13/17 : RUN cd webui && npm run build   && cd /app   && mkdir -p /app/project-template/webui /app/project-template/semantic-layer /app/project-template/skills /app/project-template/wiki /app/project-template/evals   && cp ktx.yaml.example /app/project-template/ktx.yaml   && cp -R webui/config /app/project-template/webui/config   && mkdir -p /data/lucy
 ---> Running in 7e74db0cfe15

> webui@1.0.0 build
> vite build

vite v8.0.16 building client environment for production...
[2Ktransforming...✓ 322 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.39 kB │ gzip:   0.26 kB
dist/assets/index-DCh7RwzR.css   48.37 kB │ gzip:   7.31 kB
dist/assets/index-CYieaamP.js   628.13 kB │ gzip: 183.99 kB

✓ built in 248ms
[91m[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
[0m ---> Removed intermediate container 7e74db0cfe15
 ---> 23f20d6b8c77
Step 14/17 : VOLUME ["/data/lucy"]
 ---> Running in 2a5bfe0c4242
 ---> Removed intermediate container 2a5bfe0c4242
 ---> 09e2b4a26333
Step 15/17 : EXPOSE 5174 7879
 ---> Running in 367aa7a5c209
 ---> Removed intermediate container 367aa7a5c209
 ---> 06d44b2af591
Step 16/17 : HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3   CMD /app/scripts/docker-healthcheck.sh
 ---> Running in 3c702ff1ab29
 ---> Removed intermediate container 3c702ff1ab29
 ---> 3f034f407523
Step 17/17 : ENTRYPOINT ["tini", "--", "/app/scripts/docker-entrypoint.sh"]
 ---> Running in 9d64538e5556
 ---> Removed intermediate container 9d64538e5556
 ---> 05a675d38fc6
Successfully built 05a675d38fc6
Successfully tagged project-lucy:p0-smoke

[p0-smoke] $ docker compose -p lucy-p0-smoke up -d --build
 Image project-lucy:local Building 
#1 [internal] load local bake definitions
#1 reading from stdin 585B done
#1 DONE 0.0s

#2 [internal] load build definition from Dockerfile
#2 transferring dockerfile: 1.67kB done
#2 DONE 0.0s

#3 [internal] load metadata for docker.io/library/node:22-bookworm-slim
#3 DONE 0.0s

#4 [internal] load .dockerignore
#4 transferring context: 179B done
#4 DONE 0.0s

#5 [ 1/11] FROM docker.io/library/node:22-bookworm-slim@sha256:813a7480f28fdadac1f7f5c824bcdad435b5bc1322a5968bbbdef8d058f9dff4
#5 resolve docker.io/library/node:22-bookworm-slim@sha256:813a7480f28fdadac1f7f5c824bcdad435b5bc1322a5968bbbdef8d058f9dff4 done
#5 DONE 0.0s

#6 [internal] load build context
#6 transferring context: 104.89kB 0.0s done
#6 DONE 0.0s

#7 [ 3/11] RUN apt-get update   && apt-get install -y --no-install-recommends bash ca-certificates curl git tini   && rm -rf /var/lib/apt/lists/*
#7 CACHED

#8 [ 8/11] COPY webui/package.json webui/package-lock.json ./webui/
#8 CACHED

#9 [ 6/11] COPY package.json package-lock.json ./
#9 CACHED

#10 [ 7/11] RUN npm ci --include=dev
#10 CACHED

#11 [ 2/11] WORKDIR /app
#11 CACHED

#12 [ 4/11] RUN npm install -g "@kaelio/ktx@0.13.0"
#12 CACHED

#13 [ 5/11] RUN ktx admin runtime install --yes --feature core
#13 CACHED

#14 [ 9/11] RUN cd webui && npm ci --include=dev
#14 CACHED

#15 [10/11] COPY . .
#15 DONE 0.1s

#16 [11/11] RUN cd webui && npm run build   && cd /app   && mkdir -p /app/project-template/webui /app/project-template/semantic-layer /app/project-template/skills /app/project-template/wiki /app/project-template/evals   && cp ktx.yaml.example /app/project-template/ktx.yaml   && cp -R webui/config /app/project-template/webui/config   && mkdir -p /data/lucy
#16 0.164 
#16 0.164 > webui@1.0.0 build
#16 0.164 > vite build
#16 0.164 
#16 0.440 vite v8.0.16 building client environment for production...
#16 0.450 [2Ktransforming...✓ 322 modules transformed.
#16 0.590 rendering chunks...
#16 0.661 computing gzip size...
#16 0.666 dist/index.html                   0.39 kB │ gzip:   0.26 kB
#16 0.666 dist/assets/index-DCh7RwzR.css   48.37 kB │ gzip:   7.31 kB
#16 0.666 dist/assets/index-CYieaamP.js   628.13 kB │ gzip: 183.99 kB
#16 0.666 
#16 0.667 [plugin builtin:vite-reporter] 
#16 0.667 (!) Some chunks are larger than 500 kB after minification. Consider:
#16 0.667 - Using dynamic import() to code-split the application
#16 0.667 - Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
#16 0.667 - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
#16 0.667 ✓ built in 226ms
#16 DONE 0.7s

#17 exporting to image
#17 exporting layers
#17 exporting layers 0.2s done
#17 exporting manifest sha256:92dc2312f4f997e392d1cf469ac0abac269f54e7d5a45a106ee90a51b0019cdc done
#17 exporting config sha256:b725a3663d6a21c61552a01a93868a13016a7f6bf2e349a1e065ef5a701673a9 done
#17 exporting attestation manifest sha256:45cd0d8c8743fd4bb0a86f556114eb01744e8623e5e9e1a6cf215992d1abaa1d done
#17 exporting manifest list sha256:a2c4026f7ae771874853039855a2c1d4dabf9dd7074609232299811185c44e74 done
#17 naming to docker.io/library/project-lucy:local done
#17 unpacking to docker.io/library/project-lucy:local 0.0s done
#17 DONE 0.3s

#18 resolving provenance for metadata file
#18 DONE 0.0s
 Image project-lucy:local Built 
 Network lucy-p0-smoke_default Creating 
 Network lucy-p0-smoke_default Created 
 Volume lucy-p0-smoke_lucy-data Creating 
 Volume lucy-p0-smoke_lucy-data Created 
 Container lucy-p0-smoke-lucy-1 Creating 
 Container lucy-p0-smoke-lucy-1 Created 
 Container lucy-p0-smoke-lucy-1 Starting 
 Container lucy-p0-smoke-lucy-1 Started 

[p0-smoke] $ docker compose -p lucy-p0-smoke exec -T lucy ktx --version

[p0-smoke] $ docker compose -p lucy-p0-smoke ps
NAME                   IMAGE                COMMAND                  SERVICE   CREATED         STATUS                            PORTS
lucy-p0-smoke-lucy-1   project-lucy:local   "tini -- /app/script…"   lucy      5 seconds ago   Up 4 seconds (health: starting)   0.0.0.0:55175->5174/tcp, [::]:55175->5174/tcp, 0.0.0.0:57880->7879/tcp, [::]:57880->7879/tcp

[p0-smoke] $ docker compose -p lucy-p0-smoke down -v

[p0-smoke] PASS

(exit 0)
```

## smoke:p0:demo

```text
$ npm run smoke:p0:demo

> project-lucy-eval@0.1.0 smoke:p0:demo
> node scripts/p0-demo-docker-smoke.mjs

[p0-demo-smoke] using temporary DOCKER_CONFIG=/var/folders/rk/k516h8td2qbdr20gtb2wq0cr0000gn/T/lucy-demo-docker-config-iQuJPE for Docker Hub pulls

[p0-demo-smoke] $ docker pull mysql:8.4
8.4: Pulling from library/mysql
Digest: sha256:d36d39a64cd12a5c1cc9e6aa2bfb5f8d4c81a2f6586e0a04a9ae13939db02209
Status: Image is up to date for mysql:8.4
docker.io/library/mysql:8.4

[p0-demo-smoke] $ docker compose -f docker-compose.demo.yml -p lucy-p0-demo up -d --build
 Image project-lucy:demo Building 
#1 [internal] load local bake definitions
#1 reading from stdin 583B done
#1 DONE 0.0s

#2 [internal] load build definition from Dockerfile
#2 transferring dockerfile: 1.67kB done
#2 DONE 0.0s

#3 [internal] load metadata for docker.io/library/node:22-bookworm-slim
#3 DONE 0.0s

#4 [internal] load .dockerignore
#4 transferring context: 179B done
#4 DONE 0.0s

#5 [internal] load build context
#5 DONE 0.0s

#6 [ 1/11] FROM docker.io/library/node:22-bookworm-slim@sha256:813a7480f28fdadac1f7f5c824bcdad435b5bc1322a5968bbbdef8d058f9dff4
#6 resolve docker.io/library/node:22-bookworm-slim@sha256:813a7480f28fdadac1f7f5c824bcdad435b5bc1322a5968bbbdef8d058f9dff4
#6 resolve docker.io/library/node:22-bookworm-slim@sha256:813a7480f28fdadac1f7f5c824bcdad435b5bc1322a5968bbbdef8d058f9dff4 done
#6 DONE 0.0s

#5 [internal] load build context
#5 transferring context: 25.19kB 0.0s done
#5 DONE 0.0s

#7 [ 9/11] RUN cd webui && npm ci --include=dev
#7 CACHED

#8 [ 8/11] COPY webui/package.json webui/package-lock.json ./webui/
#8 CACHED

#9 [ 5/11] RUN ktx admin runtime install --yes --feature core
#9 CACHED

#10 [ 2/11] WORKDIR /app
#10 CACHED

#11 [ 3/11] RUN apt-get update   && apt-get install -y --no-install-recommends bash ca-certificates curl git tini   && rm -rf /var/lib/apt/lists/*
#11 CACHED

#12 [ 4/11] RUN npm install -g "@kaelio/ktx@0.13.0"
#12 CACHED

#13 [ 6/11] COPY package.json package-lock.json ./
#13 CACHED

#14 [ 7/11] RUN npm ci --include=dev
#14 CACHED

#15 [10/11] COPY . .
#15 CACHED

#16 [11/11] RUN cd webui && npm run build   && cd /app   && mkdir -p /app/project-template/webui /app/project-template/semantic-layer /app/project-template/skills /app/project-template/wiki /app/project-template/evals   && cp ktx.yaml.example /app/project-template/ktx.yaml   && cp -R webui/config /app/project-template/webui/config   && mkdir -p /data/lucy
#16 CACHED

#17 exporting to image
#17 exporting layers done
#17 exporting manifest sha256:56584a482b8b82b6aa9a0ea2471e283aa197b8ae6d125299672cdb9f6a34ab4f done
#17 exporting config sha256:2dd388bbd85a9559676f0cf4d5a4b7122fa1f5b0f70272e64e580da68763f091 done
#17 exporting attestation manifest sha256:d73d6d509bbc22e7094ce3f962c7193b2847b9bfe0e7c92ab5f2073269b000e1 done
#17 exporting manifest list sha256:dd59565d1b029b48c61518214a9de5cd6d0a9b3472245afa5af730d61ec6becd done
#17 naming to docker.io/library/project-lucy:demo done
#17 unpacking to docker.io/library/project-lucy:demo done
#17 DONE 0.1s

#18 resolving provenance for metadata file
#18 DONE 0.0s
 Image project-lucy:demo Built 
 Network lucy-p0-demo_default Creating 
 Network lucy-p0-demo_default Created 
 Volume lucy-p0-demo_lucy-demo-data Creating 
 Volume lucy-p0-demo_lucy-demo-data Created 
 Container lucy-p0-demo-demo-db-1 Creating 
 Container lucy-p0-demo-demo-db-1 Created 
 Container lucy-p0-demo-lucy-1 Creating 
 Container lucy-p0-demo-lucy-1 Created 
 Container lucy-p0-demo-demo-db-1 Starting 
 Container lucy-p0-demo-demo-db-1 Started 
 Container lucy-p0-demo-demo-db-1 Waiting 
 Container lucy-p0-demo-demo-db-1 Healthy 
 Container lucy-p0-demo-lucy-1 Starting 
 Container lucy-p0-demo-lucy-1 Started 

[p0-demo-smoke] $ docker compose -f docker-compose.demo.yml -p lucy-p0-demo exec -T demo-db mysql -u lucy -plucy_demo -N -B dataforai -e SELECT 'orders', COUNT(*) FROM superstore_orders UNION ALL SELECT 'people', COUNT(*) FROM superstore_people UNION ALL SELECT 'returns', COUNT(*) FROM superstore_returns
[p0-demo-smoke] demo counts match baseline: orders=1000, people=4, returns=60

[p0-demo-smoke] $ docker compose -f docker-compose.demo.yml -p lucy-p0-demo exec -T lucy ktx --project-dir /data/lucy connection test demo-mysql
Project: /data/lucy
Connection test passed: demo-mysql
Driver: mysql
Status: ok

[p0-demo-smoke] $ docker compose -f docker-compose.demo.yml -p lucy-p0-demo exec -T lucy ktx --project-dir /data/lucy admin reindex --force --output json

[p0-demo-smoke] $ docker compose -f docker-compose.demo.yml -p lucy-p0-demo exec -T lucy ktx --project-dir /data/lucy sl validate superstore_orders --connection-id demo-mysql
Project: /data/lucy
Valid semantic-layer source: demo-mysql/superstore_orders

[p0-demo-smoke] $ docker compose -f docker-compose.demo.yml -p lucy-p0-demo exec -T lucy ktx --project-dir /data/lucy sl --connection-id demo-mysql query --measure superstore_orders.total_sales --dimension superstore_orders.region --segment superstore_orders.active_rows --limit 5 --execute --max-rows 5 --format json
[p0-demo-smoke] cli sl query region totals match baseline
[p0-demo-smoke] proxy tools: connection_list, kx_catalog, sl_query, sl_read_source, wiki_read, wiki_search
[p0-demo-smoke] proxy sl_read_source returned demo semantic layer content
[p0-demo-smoke] proxy sl_query returned 4 baseline-matched rows

[p0-demo-smoke] $ docker compose -f docker-compose.demo.yml -p lucy-p0-demo ps
NAME                     IMAGE               COMMAND                  SERVICE   CREATED          STATUS                    PORTS
lucy-p0-demo-demo-db-1   mysql:8.4           "docker-entrypoint.s…"   demo-db   18 seconds ago   Up 17 seconds (healthy)   0.0.0.0:53306->3306/tcp, [::]:53306->3306/tcp
lucy-p0-demo-lucy-1      project-lucy:demo   "tini -- /app/script…"   lucy      17 seconds ago   Up 7 seconds (healthy)    0.0.0.0:55176->5174/tcp, [::]:55176->5174/tcp, 0.0.0.0:57881->7879/tcp, [::]:57881->7879/tcp

[p0-demo-smoke] PASS

[p0-demo-smoke] $ docker compose -f docker-compose.demo.yml -p lucy-p0-demo down -v

(exit 0)
```

## smoke:p0:postgres-demo

```text
$ npm run smoke:p0:postgres-demo

> project-lucy-eval@0.1.0 smoke:p0:postgres-demo
> node scripts/p0-postgres-demo-smoke.mjs

[p0-postgres-demo-smoke] using temporary DOCKER_CONFIG=/var/folders/rk/k516h8td2qbdr20gtb2wq0cr0000gn/T/lucy-demo-docker-config-92hfXU for Docker Hub pulls

[p0-postgres-demo-smoke] $ docker pull postgres:16-alpine
16-alpine: Pulling from library/postgres
Digest: sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb
Status: Image is up to date for postgres:16-alpine
docker.io/library/postgres:16-alpine

[p0-postgres-demo-smoke] $ docker compose -f docker-compose.postgres-demo.yml -p lucy-p0-postgres-demo up -d --build
 Image project-lucy:postgres-demo Building 
#1 [internal] load local bake definitions
#1 reading from stdin 601B done
#1 DONE 0.0s

#2 [internal] load build definition from Dockerfile
#2 transferring dockerfile: 1.67kB done
#2 DONE 0.0s

#3 [internal] load metadata for docker.io/library/node:22-bookworm-slim
#3 DONE 0.0s

#4 [internal] load .dockerignore
#4 transferring context: 179B done
#4 DONE 0.0s

#5 [ 1/11] FROM docker.io/library/node:22-bookworm-slim@sha256:813a7480f28fdadac1f7f5c824bcdad435b5bc1322a5968bbbdef8d058f9dff4
#5 resolve docker.io/library/node:22-bookworm-slim@sha256:813a7480f28fdadac1f7f5c824bcdad435b5bc1322a5968bbbdef8d058f9dff4 done
#5 DONE 0.0s

#6 [internal] load build context
#6 transferring context: 25.19kB done
#6 DONE 0.0s

#7 [ 6/11] COPY package.json package-lock.json ./
#7 CACHED

#8 [ 7/11] RUN npm ci --include=dev
#8 CACHED

#9 [ 5/11] RUN ktx admin runtime install --yes --feature core
#9 CACHED

#10 [ 4/11] RUN npm install -g "@kaelio/ktx@0.13.0"
#10 CACHED

#11 [10/11] COPY . .
#11 CACHED

#12 [ 2/11] WORKDIR /app
#12 CACHED

#13 [ 3/11] RUN apt-get update   && apt-get install -y --no-install-recommends bash ca-certificates curl git tini   && rm -rf /var/lib/apt/lists/*
#13 CACHED

#14 [ 8/11] COPY webui/package.json webui/package-lock.json ./webui/
#14 CACHED

#15 [ 9/11] RUN cd webui && npm ci --include=dev
#15 CACHED

#16 [11/11] RUN cd webui && npm run build   && cd /app   && mkdir -p /app/project-template/webui /app/project-template/semantic-layer /app/project-template/skills /app/project-template/wiki /app/project-template/evals   && cp ktx.yaml.example /app/project-template/ktx.yaml   && cp -R webui/config /app/project-template/webui/config   && mkdir -p /data/lucy
#16 CACHED

#17 exporting to image
#17 exporting layers done
#17 exporting manifest sha256:12e5335326478f7924a766035ac1954568d9679bf2f80a9d0e2e9acec46fb967 done
#17 exporting config sha256:3913b91f7ec137fd708d4b5cd94dfc17ea4da37756df4c49c1ef3e27ffbddfcf done
#17 exporting attestation manifest sha256:7c26f28f381b98e4807fe55a97d3e17492d2b0ac60846263d4cfbd0492345984 done
#17 exporting manifest list sha256:17752cd004df7ca9013dfdd373c2f3039718dd34b5fa8d2346c7cd37e189ca31 done
#17 naming to docker.io/library/project-lucy:postgres-demo done
#17 unpacking to docker.io/library/project-lucy:postgres-demo done
#17 DONE 0.0s

#18 resolving provenance for metadata file
#18 DONE 0.0s
 Image project-lucy:postgres-demo Built 
 Network lucy-p0-postgres-demo_default Creating 
 Network lucy-p0-postgres-demo_default Created 
 Volume lucy-p0-postgres-demo_lucy-postgres-demo-data Creating 
 Volume lucy-p0-postgres-demo_lucy-postgres-demo-data Created 
 Container lucy-p0-postgres-demo-postgres-db-1 Creating 
 Container lucy-p0-postgres-demo-postgres-db-1 Created 
 Container lucy-p0-postgres-demo-lucy-1 Creating 
 Container lucy-p0-postgres-demo-lucy-1 Created 
 Container lucy-p0-postgres-demo-postgres-db-1 Starting 
 Container lucy-p0-postgres-demo-postgres-db-1 Started 
 Container lucy-p0-postgres-demo-postgres-db-1 Waiting 
 Container lucy-p0-postgres-demo-postgres-db-1 Healthy 
 Container lucy-p0-postgres-demo-lucy-1 Starting 
 Container lucy-p0-postgres-demo-lucy-1 Started 

[p0-postgres-demo-smoke] $ docker compose -f docker-compose.postgres-demo.yml -p lucy-p0-postgres-demo exec -T lucy ktx --project-dir /data/lucy connection test demo-postgres
Project: /data/lucy
Connection test passed: demo-postgres
Driver: postgres
Status: ok

[p0-postgres-demo-smoke] $ docker compose -f docker-compose.postgres-demo.yml -p lucy-p0-postgres-demo exec -T lucy ktx --project-dir /data/lucy admin reindex --force --output json

[p0-postgres-demo-smoke] $ docker compose -f docker-compose.postgres-demo.yml -p lucy-p0-postgres-demo exec -T lucy ktx --project-dir /data/lucy sl validate superstore_orders --connection-id demo-postgres
Project: /data/lucy
Valid semantic-layer source: demo-postgres/superstore_orders

[p0-postgres-demo-smoke] $ docker compose -f docker-compose.postgres-demo.yml -p lucy-p0-postgres-demo exec -T lucy ktx --project-dir /data/lucy sl --connection-id demo-postgres query --measure superstore_orders.total_sales --dimension superstore_orders.region --segment superstore_orders.active_rows --limit 5 --execute --max-rows 5
{
  "connectionId": "demo-postgres",
  "dialect": "postgres",
  "sql": "SELECT\n  superstore_orders.region AS region,\n  SUM(CASE WHEN superstore_orders.is_deleted = 0 THEN superstore_orders.sales END) AS total_sales\nFROM dataforai.superstore_orders AS superstore_orders\nGROUP BY superstore_orders.region\nORDER BY 1\nLIMIT 1000",
  "headers": [
    "region",
    "total_sales"
  ],
  "rows": [
    [
      "Central South",
      "363958.9831"
    ],
    [
      "East",
      "550670.8159"
    ],
    [
      "Northeast",
      "302200.0925"
    ],
    [
      "Southwest",
      "242646.2038"
    ]
  ],
  "totalRows": 4,
  "plan": {
    "sources_used": [
      "superstore_orders"
    ],
    "join_paths": [],
    "joins": [],
    "anchor_source": "superstore_orders",
    "anchor_grain": [
      "superstore_orders.region"
    ],
    "fan_out_description": "No fanout",
    "has_fan_out": false,
    "measure_groups": [],
    "aggregate_locality": [],
    "where_filters": [],
    "having_filters": [],
    "columns": [
      {
        "name": "region",
        "provenance": "dimension",
        "expr": "superstore_orders.region",
        "description": null,
        "granularity": null
      },
      {
        "name": "total_sales",
        "provenance": "verified",
        "expr": "SUM(superstore_orders.sales)",
        "description": "销售总额（折扣后实收金额）。",
        "granularity": null
      }
    ],
    "measures": [
      {
        "name": "total_sales",
        "expr": "SUM(superstore_orders.sales)",
        "source_name": "superstore_orders",
        "original_name": "total_sales",
        "qualified_ref": "superstore_orders.total_sales",
        "filter": "superstore_orders.is_deleted = 0",
        "provenance": "verified",
        "is_derived": false,
        "depends_on": [],
        "description": "销售总额（折扣后实收金额）。"
      }
    ],
    "dimensions": [
      {
        "field": "superstore_orders.region",
        "granularity": null
      }
    ],
    "order_by": [],
    "limit": 1000,
    "include_empty": true,
    "execution": {
      "mode": "executed",
      "driver": "postgres",
      "maxRows": 5,
      "rowCount": 4
    }
  }
}
[p0-postgres-demo-smoke] proxy tools: connection_list, kx_catalog, sl_query, sl_read_source, wiki_read, wiki_search
[p0-postgres-demo-smoke] proxy sl_read_source returned demo semantic layer content
[p0-postgres-demo-smoke] proxy sl_query returned 4 rows

[p0-postgres-demo-smoke] $ docker compose -f docker-compose.postgres-demo.yml -p lucy-p0-postgres-demo ps
NAME                                  IMAGE                        COMMAND                  SERVICE       CREATED          STATUS                    PORTS
lucy-p0-postgres-demo-lucy-1          project-lucy:postgres-demo   "tini -- /app/script…"   lucy          12 seconds ago   Up 6 seconds (healthy)    0.0.0.0:55177->5174/tcp, [::]:55177->5174/tcp, 0.0.0.0:57882->7879/tcp, [::]:57882->7879/tcp
lucy-p0-postgres-demo-postgres-db-1   postgres:16-alpine           "docker-entrypoint.s…"   postgres-db   12 seconds ago   Up 12 seconds (healthy)   0.0.0.0:55432->5432/tcp, [::]:55432->5432/tcp

[p0-postgres-demo-smoke] PASS

[p0-postgres-demo-smoke] $ docker compose -f docker-compose.postgres-demo.yml -p lucy-p0-postgres-demo down -v

(exit 0)
```

## smoke:p0:business-eval

```text
$ npm run smoke:p0:business-eval

> project-lucy-eval@0.1.0 smoke:p0:business-eval
> node scripts/p0-business-eval-smoke.mjs


[p0-business-eval-smoke] $ node scripts/eval-runner.mjs --list-cases --cases evals/superstore/eval/superstore-eval-cases.yaml
superstore-discount-001
superstore-discount-002
superstore-discount-003
superstore-ordercount-001
superstore-ordercount-002
superstore-profit-001
superstore-filter-001
superstore-discount-004
superstore-ordercount-003
superstore-ordercount-004
superstore-profit-002
superstore-filter-002
superstore-segment-001
superstore-degradation-001
superstore-join-001
superstore-join-002
superstore-multiturn-001
# loaded 17 case(s) from /Users/forrest/Projects/project-lucy/evals/superstore/eval/superstore-eval-cases.yaml

[p0-business-eval-smoke] $ node scripts/eval-runner.mjs --list-cases --cases evals/kx_financial/eval/kx_financial-eval-cases.yaml
kx-routing-001
kx-schema-001
kx-rowcount-001
kx-period-001
kx-join-001
kx-join-002
kx-balance-001
kx-balance-002
kx-routing-balance-ratio-001
kx-routing-income-monthly-001
kx-routing-income-quarter-001
kx-routing-cashflow-period-001
kx-routing-balance-layout-001
kx-routing-income-margin-001
kx-routing-fact-subject-detail-001
kx-income-001
kx-income-null-001
kx-cashflow-001
kx-amount-type-001
kx-quarter-001
kx-view-001
kx-view-gap-001
kx-filter-001
kx-null-001
kx-source-file-001
kx-multiturn-001
# loaded 26 case(s) from /Users/forrest/Projects/project-lucy/evals/kx_financial/eval/kx_financial-eval-cases.yaml

[p0-business-eval-smoke] PASS

(exit 0)
```

## Summary

Overall: PASS

## smoke:p0:customer

```text
$ npm run smoke:p0:customer

> project-lucy-eval@0.1.0 smoke:p0:customer
> node scripts/p0-customer-path-smoke.mjs


[p0-customer-smoke] $ ktx connection test mysql-aliyun
Project: /Users/forrest/Projects/project-lucy
Connection test passed: mysql-aliyun
Driver: mysql
Status: ok

[p0-customer-smoke] $ ktx sl validate superstore_orders --connection-id mysql-aliyun
Project: /Users/forrest/Projects/project-lucy
Valid semantic-layer source: mysql-aliyun/superstore_orders

[p0-customer-smoke] $ ktx sl --connection-id mysql-aliyun query --measure superstore_orders.total_sales --dimension superstore_orders.region --segment superstore_orders.active_rows --limit 3 --execute --max-rows 3
{
  "connectionId": "mysql-aliyun",
  "dialect": "mysql",
  "sql": "SELECT superstore_orders.region AS region, SUM(CASE WHEN superstore_orders.is_deleted = 0 THEN superstore_orders.sales END) AS total_sales FROM dataforai.superstore_orders AS superstore_orders GROUP BY superstore_orders.region ORDER BY 1 LIMIT 1000",
  "headers": [
    "region",
    "total_sales"
  ],
  "rows": [
    [
      "东北",
      "2088455.842300"
    ],
    [
      "中南",
      "4107724.505400"
    ],
    [
      "华东",
      "5022278.793150"
    ]
  ],
  "totalRows": 3,
  "plan": {
    "sources_used": [
      "superstore_orders"
    ],
    "join_paths": [],
    "joins": [],
    "anchor_source": "superstore_orders",
    "anchor_grain": [
      "superstore_orders.region"
    ],
    "fan_out_description": "No fanout",
    "has_fan_out": false,
    "measure_groups": [],
    "aggregate_locality": [],
    "where_filters": [],
    "having_filters": [],
    "columns": [
      {
        "name": "region",
        "provenance": "dimension",
        "expr": "superstore_orders.region",
        "description": null,
        "granularity": null
      },
      {
        "name": "total_sales",
        "provenance": "verified",
        "expr": "SUM(superstore_orders.sales)",
        "description": "销售总额（折扣后实收金额）。",
        "granularity": null
      }
    ],
    "measures": [
      {
        "name": "total_sales",
        "expr": "SUM(superstore_orders.sales)",
        "source_name": "superstore_orders",
        "original_name": "total_sales",
        "qualified_ref": "superstore_orders.total_sales",
        "filter": "superstore_orders.is_deleted = 0",
        "provenance": "verified",
        "is_derived": false,
        "depends_on": [],
        "description": "销售总额（折扣后实收金额）。"
      }
    ],
    "dimensions": [
      {
        "field": "superstore_orders.region",
        "granularity": null
      }
    ],
    "order_by": [],
    "limit": 1000,
    "include_empty": true,
    "execution": {
      "mode": "executed",
      "driver": "mysql",
      "maxRows": 3,
      "rowCount": 3
    }
  }
}

[p0-customer-smoke] starting temporary KTX MCP on 127.0.0.1:51549
Project: /Users/forrest/Projects/project-lucy
ktx MCP memory_ingest disabled: The module '/Users/forrest/.local/node-v24.14.1-darwin-arm64/lib/node_modules/@kaelio/ktx/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 137. This version of Node.js requires
NODE_MODULE_VERSION 127. Please try re-compiling or re-installing
the module (for instance, using `npm rebuild` or `npm install`).
ktx MCP server listening at http://127.0.0.1:51549/mcp
[p0-customer-smoke] MCP tools: connection_list, dictionary_search, discover_data, entity_details, sl_query, sl_read_source, sql_execution, wiki_read, wiki_search
[p0-customer-smoke] note: sl_validate is not exposed as an MCP tool in this KTX runtime; CLI validate was checked separately.
[p0-customer-smoke] agent-style MCP sl_query returned 3 rows

[p0-customer-smoke] PASS

(exit 0)
```

## Customer DB Path

Result: PASS on local configured mysql-aliyun read-only path.
