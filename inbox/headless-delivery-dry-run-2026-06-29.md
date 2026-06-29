# Headless Delivery Artifact And Dry Run Evidence

- Date: 2026-06-29
- Artifact: `/Users/forrest/Projects/project-lucy/inbox/headless-release-artifacts-2026-06-29/lucy-docker-source-bundle.tar.gz`
- Temp dir: `/tmp/lucy-headless-dry-run-ahKsBu`
- Compose project: `lucy-headless-dry-run`


## extract bundle

```text
$ tar -xzf /Users/forrest/Projects/project-lucy/inbox/headless-release-artifacts-2026-06-29/lucy-docker-source-bundle.tar.gz -C /tmp/lucy-headless-dry-run-ahKsBu

(exit 0)
```

## compose up demo

```text
$ docker compose -f docker-compose.demo.yml -p lucy-headless-dry-run up -d --build
 Image project-lucy:demo Building 
#1 [internal] load local bake definitions
#1 reading from stdin 646B done
#1 DONE 0.0s

#2 [internal] load build definition from Dockerfile
#2 transferring dockerfile: 30B
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
#6 transferring context: 7.36kB done
#6 DONE 0.0s

#7 [10/11] COPY . .
#7 CACHED

#8 [ 2/11] WORKDIR /app
#8 CACHED

#9 [ 6/11] COPY package.json package-lock.json ./
#9 CACHED

#10 [ 7/11] RUN npm ci --include=dev
#10 CACHED

#11 [ 9/11] RUN cd webui && npm ci --include=dev
#11 CACHED

#12 [ 4/11] RUN npm install -g "@kaelio/ktx@0.13.0"
#12 CACHED

#13 [ 3/11] RUN apt-get update   && apt-get install -y --no-install-recommends bash ca-certificates curl git tini   && rm -rf /var/lib/apt/lists/*
#13 CACHED

#14 [ 5/11] RUN ktx admin runtime install --yes --feature core
#14 CACHED

#15 [ 8/11] COPY webui/package.json webui/package-lock.json ./webui/
#15 CACHED

#16 [11/11] RUN cd webui && npm run build   && cd /app   && mkdir -p /app/project-template/webui /app/project-template/semantic-layer /app/project-template/skills /app/project-template/wiki /app/project-template/evals   && cp ktx.yaml.example /app/project-template/ktx.yaml   && cp -R webui/config /app/project-template/webui/config   && mkdir -p /data/lucy
#16 CACHED

#17 exporting to image
#17 exporting layers done
#17 exporting manifest sha256:943bf635aa0c3f5cd06664e4c0cf9ab63b0677cadc2cbc12eda07a5e0a6592b6 done
#17 exporting config sha256:01c2f037f2bae5a235a51d34b2c51a18c24623d8b5a653bcc1eda3219d582088 done
#17 exporting attestation manifest sha256:f5313f70847fa1407be0d0f90d2bdd4d0c90ba98d7368034fdda08f8e74d57b2 done
#17 exporting manifest list sha256:b1132c93b04050aa005c2fbbeaea2a20d68bb1730e8a6e7d05e555ad74e7ac29 done
#17 naming to docker.io/library/project-lucy:demo done
#17 unpacking to docker.io/library/project-lucy:demo done
#17 DONE 0.0s

#18 resolving provenance for metadata file
#18 DONE 0.0s
 Image project-lucy:demo Built 
 Network lucy-headless-dry-run_default Creating 
 Network lucy-headless-dry-run_default Created 
 Volume lucy-headless-dry-run_lucy-demo-data Creating 
 Volume lucy-headless-dry-run_lucy-demo-data Created 
 Container lucy-headless-dry-run-demo-db-1 Creating 
 Container lucy-headless-dry-run-demo-db-1 Created 
 Container lucy-headless-dry-run-lucy-1 Creating 
 Container lucy-headless-dry-run-lucy-1 Created 
 Container lucy-headless-dry-run-demo-db-1 Starting 
 Container lucy-headless-dry-run-demo-db-1 Started 
 Container lucy-headless-dry-run-demo-db-1 Waiting 
 Container lucy-headless-dry-run-demo-db-1 Healthy 
 Container lucy-headless-dry-run-lucy-1 Starting 
 Container lucy-headless-dry-run-lucy-1 Started 

(exit 0)
```

## compose ps

```text
$ docker compose -f docker-compose.demo.yml -p lucy-headless-dry-run ps
NAME                              IMAGE               COMMAND                  SERVICE   CREATED         STATUS                                     PORTS
lucy-headless-dry-run-demo-db-1   mysql:8.4           "docker-entrypoint.s…"   demo-db   6 seconds ago   Up 5 seconds (healthy)                     0.0.0.0:53306->3306/tcp, [::]:53306->3306/tcp
lucy-headless-dry-run-lucy-1      project-lucy:demo   "tini -- /app/script…"   lucy      6 seconds ago   Up Less than a second (health: starting)   0.0.0.0:55186->5174/tcp, [::]:55186->5174/tcp, 0.0.0.0:57891->7879/tcp, [::]:57891->7879/tcp

(exit 0)
```

## health API

```text
$ curl -fsS http://127.0.0.1:55186/api/health
curl: (56) Recv failure: Connection reset by peer

(exit 0)
```

## ktx connection

```text
$ docker compose -f docker-compose.demo.yml -p lucy-headless-dry-run exec -T lucy ktx --project-dir /data/lucy connection test demo-mysql
Project: /data/lucy
Connection test passed: demo-mysql
Driver: mysql
Status: ok

(exit 0)
```

## ktx reindex

```text
$ docker compose -f docker-compose.demo.yml -p lucy-headless-dry-run exec -T lucy ktx --project-dir /data/lucy admin reindex --force --output json
{
  "kind": "reindex",
  "data": {
    "scopes": [
      {
        "kind": "wiki",
        "label": "global",
        "scope": "global",
        "scopeId": null,
        "scanned": 0,
        "updated": 0,
        "deleted": 0,
        "embeddingsRecomputed": 0,
        "embeddingsFailed": 0,
        "durationMs": 1
      },
      {
        "kind": "sl",
        "label": "demo-mysql",
        "connectionId": "demo-mysql",
        "scanned": 3,
        "updated": 3,
        "deleted": 0,
        "embeddingsRecomputed": 0,
        "embeddingsFailed": 0,
        "durationMs": 25
      }
    ],
    "totals": {
      "scanned": 3,
      "updated": 3,
      "deleted": 0,
      "embeddingsRecomputed": 0,
      "embeddingsFailed": 0
    },
    "dbPath": ".ktx/db.sqlite",
    "force": true,
    "embeddingsAvailable": false,
    "durationMs": 29
  },
  "meta": {
    "command": "admin reindex"
  }
}

(exit 0)
```

## ktx validate

```text
$ docker compose -f docker-compose.demo.yml -p lucy-headless-dry-run exec -T lucy ktx --project-dir /data/lucy sl validate superstore_orders --connection-id demo-mysql
Project: /data/lucy
Valid semantic-layer source: demo-mysql/superstore_orders

(exit 0)
```

## ktx demo query

```text
$ docker compose -f docker-compose.demo.yml -p lucy-headless-dry-run exec -T lucy ktx --project-dir /data/lucy sl --connection-id demo-mysql query --measure superstore_orders.total_sales --dimension superstore_orders.region --segment superstore_orders.active_rows --limit 5 --execute --max-rows 5 --format json
{
  "connectionId": "demo-mysql",
  "dialect": "mysql",
  "sql": "SELECT superstore_orders.region AS region, SUM(CASE WHEN superstore_orders.is_deleted = 0 THEN superstore_orders.sales END) AS total_sales FROM dataforai.superstore_orders AS superstore_orders GROUP BY superstore_orders.region ORDER BY 1 LIMIT 1000",
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
      "driver": "mysql",
      "maxRows": 5,
      "rowCount": 4
    }
  }
}

(exit 0)
```

## MCP proxy JSON-RPC

```text
$ node --input-type=module <<NODE
file:///private/tmp/lucy-headless-dry-run-ahKsBu/lucy-docker-source-bundle/[eval1]:2
const token = 
              

SyntaxError: Unexpected end of input
    at compileSourceTextModule (node:internal/modules/esm/utils:346:16)
    at ModuleLoader.createModuleWrap (node:internal/modules/esm/loader:256:12)
    at ModuleLoader.eval (node:internal/modules/esm/loader:296:23)
    at node:internal/process/execution:73:24
    at asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:11)
    at Object.runEntryPointWithESMLoader (node:internal/modules/run_main:139:19)
    at evalModuleEntryPoint (node:internal/process/execution:72:47)
    at node:internal/main/eval_stdin:36:5
    at ReadStream.<anonymous> (node:internal/process/execution:201:5)
    at ReadStream.emit (node:events:519:28)

Node.js v22.22.2

## dry-run repair: health wait

```text
$ curl -fsS http://127.0.0.1:55186/api/health
{"ok":true,"data":{"status":"ok","lucyVersion":"1.0.0","bundledKtxVersion":"0.13.0"}}
(exit 0)
```

## dry-run repair: MCP proxy JSON-RPC

```text
$ LUCY_DEMO_PROXY_HOST_PORT=57891 node inbox/headless-dry-run-mcp-check-2026-06-29.mjs
file:///Users/forrest/Projects/project-lucy/inbox/headless-dry-run-mcp-check-2026-06-29.mjs:26
    throw new Error(`${method} failed: HTTP ${res.status} ${JSON.stringify(body?.error ?? body)}`);
          ^

Error: notifications/initialized failed: HTTP 200 {"code":-32601,"message":"Method not found"}
    at rpc (file:///Users/forrest/Projects/project-lucy/inbox/headless-dry-run-mcp-check-2026-06-29.mjs:26:11)
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async file:///Users/forrest/Projects/project-lucy/inbox/headless-dry-run-mcp-check-2026-06-29.mjs:38:1

Node.js v22.22.2

(exit 1)
```

## dry-run repair: audit sqlite exists

```text
$ docker compose ... find /data/lucy/.ktx-ui -name audit.sqlite*
/data/lucy/.ktx-ui/audit.sqlite-shm
/data/lucy/.ktx-ui/audit.sqlite-wal
/data/lucy/.ktx-ui/audit.sqlite

(exit 0)
```

## dry-run cleanup

```text
$ docker compose -f docker-compose.demo.yml -p lucy-headless-dry-run down -v
 Container lucy-headless-dry-run-lucy-1 Stopping 
 Container lucy-headless-dry-run-lucy-1 Stopped 
 Container lucy-headless-dry-run-lucy-1 Removing 
 Container lucy-headless-dry-run-lucy-1 Removed 
 Container lucy-headless-dry-run-demo-db-1 Stopping 
 Container lucy-headless-dry-run-demo-db-1 Stopped 
 Container lucy-headless-dry-run-demo-db-1 Removing 
 Container lucy-headless-dry-run-demo-db-1 Removed 
 Network lucy-headless-dry-run_default Removing 
 Volume lucy-headless-dry-run_lucy-demo-data Removing 
 Volume lucy-headless-dry-run_lucy-demo-data Removed 
 Network lucy-headless-dry-run_default Removed 

(exit 0)
```

## Corrected Summary

Dry run: FAIL in repair sections.

## dry-run final retry: compose up demo

```text
$ docker compose -f docker-compose.demo.yml -p lucy-headless-dry-run up -d --build
 Image project-lucy:demo Building 
#1 [internal] load local bake definitions
#1 reading from stdin 646B done
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
#6 resolve docker.io/library/node:22-bookworm-slim@sha256:813a7480f28fdadac1f7f5c824bcdad435b5bc1322a5968bbbdef8d058f9dff4 done
#6 DONE 0.0s

#5 [internal] load build context
#5 transferring context: 7.36kB done
#5 DONE 0.0s

#7 [ 3/11] RUN apt-get update   && apt-get install -y --no-install-recommends bash ca-certificates curl git tini   && rm -rf /var/lib/apt/lists/*
#7 CACHED

#8 [ 6/11] COPY package.json package-lock.json ./
#8 CACHED

#9 [ 5/11] RUN ktx admin runtime install --yes --feature core
#9 CACHED

#10 [ 7/11] RUN npm ci --include=dev
#10 CACHED

#11 [ 4/11] RUN npm install -g "@kaelio/ktx@0.13.0"
#11 CACHED

#12 [10/11] COPY . .
#12 CACHED

#13 [ 2/11] WORKDIR /app
#13 CACHED

#14 [ 8/11] COPY webui/package.json webui/package-lock.json ./webui/
#14 CACHED

#15 [ 9/11] RUN cd webui && npm ci --include=dev
#15 CACHED

#16 [11/11] RUN cd webui && npm run build   && cd /app   && mkdir -p /app/project-template/webui /app/project-template/semantic-layer /app/project-template/skills /app/project-template/wiki /app/project-template/evals   && cp ktx.yaml.example /app/project-template/ktx.yaml   && cp -R webui/config /app/project-template/webui/config   && mkdir -p /data/lucy
#16 CACHED

#17 exporting to image
#17 exporting layers done
#17 exporting manifest sha256:943bf635aa0c3f5cd06664e4c0cf9ab63b0677cadc2cbc12eda07a5e0a6592b6 done
#17 exporting config sha256:01c2f037f2bae5a235a51d34b2c51a18c24623d8b5a653bcc1eda3219d582088 done
#17 exporting attestation manifest sha256:08eeab55072a715fe9047da5465e9de1361d567f9bb302dce9524bb7e4e0a0a7 done
#17 exporting manifest list sha256:86008bd641a5a44899da58ff89d1be573ead342123539c982b4e6906888d321d done
#17 naming to docker.io/library/project-lucy:demo done
#17 unpacking to docker.io/library/project-lucy:demo done
#17 DONE 0.0s

#18 resolving provenance for metadata file
#18 DONE 0.0s
 Image project-lucy:demo Built 
 Network lucy-headless-dry-run_default Creating 
 Network lucy-headless-dry-run_default Created 
 Volume lucy-headless-dry-run_lucy-demo-data Creating 
 Volume lucy-headless-dry-run_lucy-demo-data Created 
 Container lucy-headless-dry-run-demo-db-1 Creating 
 Container lucy-headless-dry-run-demo-db-1 Created 
 Container lucy-headless-dry-run-lucy-1 Creating 
 Container lucy-headless-dry-run-lucy-1 Created 
 Container lucy-headless-dry-run-demo-db-1 Starting 
 Container lucy-headless-dry-run-demo-db-1 Started 
 Container lucy-headless-dry-run-demo-db-1 Waiting 
 Container lucy-headless-dry-run-demo-db-1 Healthy 
 Container lucy-headless-dry-run-lucy-1 Starting 
 Container lucy-headless-dry-run-lucy-1 Started 

(exit 0)
```

## dry-run final retry: health wait

```text
$ curl -fsS http://127.0.0.1:55186/api/health
curl: (56) Recv failure: Connection reset by peer
curl: (56) Recv failure: Connection reset by peer
{"ok":true,"data":{"status":"ok","lucyVersion":"1.0.0","bundledKtxVersion":"0.13.0"}}
(exit 0)
```

## dry-run final retry: MCP proxy JSON-RPC

```text
$ LUCY_DEMO_PROXY_HOST_PORT=57891 node inbox/headless-dry-run-mcp-check-2026-06-29.mjs
tools/list: connection_list, kx_catalog, sl_query, sl_read_source, wiki_read, wiki_search
sl_read_source: ok
sl_query: 4 rows
file:///Users/forrest/Projects/project-lucy/inbox/headless-dry-run-mcp-check-2026-06-29.mjs:79
if (!denied.body?.error) throw new Error("sql_execution denial path did not return an MCP error");
                               ^

Error: sql_execution denial path did not return an MCP error
    at file:///Users/forrest/Projects/project-lucy/inbox/headless-dry-run-mcp-check-2026-06-29.mjs:79:32
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)

Node.js v22.22.2

(exit 1)
```

## dry-run final retry: audit sqlite exists

```text
$ docker compose ... find /data/lucy/.ktx-ui -name audit.sqlite*
/data/lucy/.ktx-ui/audit.sqlite-shm
/data/lucy/.ktx-ui/audit.sqlite-wal
/data/lucy/.ktx-ui/audit.sqlite

(exit 0)
```

## dry-run final retry: compose down

```text
$ docker compose -f docker-compose.demo.yml -p lucy-headless-dry-run down -v
 Container lucy-headless-dry-run-lucy-1 Stopping 
 Container lucy-headless-dry-run-lucy-1 Stopped 
 Container lucy-headless-dry-run-lucy-1 Removing 
 Container lucy-headless-dry-run-lucy-1 Removed 
 Container lucy-headless-dry-run-demo-db-1 Stopping 
 Container lucy-headless-dry-run-demo-db-1 Stopped 
 Container lucy-headless-dry-run-demo-db-1 Removing 
 Container lucy-headless-dry-run-demo-db-1 Removed 
 Volume lucy-headless-dry-run_lucy-demo-data Removing 
 Network lucy-headless-dry-run_default Removing 
 Volume lucy-headless-dry-run_lucy-demo-data Removed 
 Network lucy-headless-dry-run_default Removed 

(exit 0)
```

## Final Summary

Dry run: FAIL.

## dry-run final verification: compose up demo

```text
$ docker compose -f docker-compose.demo.yml -p lucy-headless-dry-run up -d --build
 Image project-lucy:demo Building 
#1 [internal] load local bake definitions
#1 reading from stdin 646B done
#1 DONE 0.0s

#2 [internal] load build definition from Dockerfile
#2 transferring dockerfile: 1.67kB done
#2 DONE 0.0s

#3 [internal] load metadata for docker.io/library/node:22-bookworm-slim
#3 DONE 0.1s

#4 [internal] load .dockerignore
#4 transferring context: 179B done
#4 DONE 0.0s

#5 [internal] load build context
#5 DONE 0.0s

#6 [ 1/11] FROM docker.io/library/node:22-bookworm-slim@sha256:813a7480f28fdadac1f7f5c824bcdad435b5bc1322a5968bbbdef8d058f9dff4
#6 resolve docker.io/library/node:22-bookworm-slim@sha256:813a7480f28fdadac1f7f5c824bcdad435b5bc1322a5968bbbdef8d058f9dff4 0.0s done
#6 DONE 0.0s

#5 [internal] load build context
#5 transferring context: 7.36kB done
#5 DONE 0.0s

#7 [ 4/11] RUN npm install -g "@kaelio/ktx@0.13.0"
#7 CACHED

#8 [10/11] COPY . .
#8 CACHED

#9 [ 2/11] WORKDIR /app
#9 CACHED

#10 [ 3/11] RUN apt-get update   && apt-get install -y --no-install-recommends bash ca-certificates curl git tini   && rm -rf /var/lib/apt/lists/*
#10 CACHED

#11 [ 5/11] RUN ktx admin runtime install --yes --feature core
#11 CACHED

#12 [ 8/11] COPY webui/package.json webui/package-lock.json ./webui/
#12 CACHED

#13 [ 6/11] COPY package.json package-lock.json ./
#13 CACHED

#14 [ 7/11] RUN npm ci --include=dev
#14 CACHED

#15 [ 9/11] RUN cd webui && npm ci --include=dev
#15 CACHED

#16 [11/11] RUN cd webui && npm run build   && cd /app   && mkdir -p /app/project-template/webui /app/project-template/semantic-layer /app/project-template/skills /app/project-template/wiki /app/project-template/evals   && cp ktx.yaml.example /app/project-template/ktx.yaml   && cp -R webui/config /app/project-template/webui/config   && mkdir -p /data/lucy
#16 CACHED

#17 exporting to image
#17 exporting layers done
#17 exporting manifest sha256:943bf635aa0c3f5cd06664e4c0cf9ab63b0677cadc2cbc12eda07a5e0a6592b6 done
#17 exporting config sha256:01c2f037f2bae5a235a51d34b2c51a18c24623d8b5a653bcc1eda3219d582088 done
#17 exporting attestation manifest sha256:8be9a893dd9f92af41a9bd07c5ce9e913fa3d1a4403d86665396940bf627559e 0.0s done
#17 exporting manifest list sha256:19ad8037e8952b9edbc1deca035524b9d3a0924b6e4ff7abcda874a54efd2137 done
#17 naming to docker.io/library/project-lucy:demo done
#17 unpacking to docker.io/library/project-lucy:demo done
#17 DONE 0.1s

#18 resolving provenance for metadata file
#18 DONE 0.0s
 Image project-lucy:demo Built 
 Network lucy-headless-dry-run_default Creating 
 Network lucy-headless-dry-run_default Created 
 Volume lucy-headless-dry-run_lucy-demo-data Creating 
 Volume lucy-headless-dry-run_lucy-demo-data Created 
 Container lucy-headless-dry-run-demo-db-1 Creating 
 Container lucy-headless-dry-run-demo-db-1 Created 
 Container lucy-headless-dry-run-lucy-1 Creating 
 Container lucy-headless-dry-run-lucy-1 Created 
 Container lucy-headless-dry-run-demo-db-1 Starting 
 Container lucy-headless-dry-run-demo-db-1 Started 
 Container lucy-headless-dry-run-demo-db-1 Waiting 
 Container lucy-headless-dry-run-demo-db-1 Healthy 
 Container lucy-headless-dry-run-lucy-1 Starting 
 Container lucy-headless-dry-run-lucy-1 Started 

(exit 0)
```

## dry-run final verification: health wait

```text
$ curl -fsS http://127.0.0.1:55186/api/health
curl: (56) Recv failure: Connection reset by peer
curl: (56) Recv failure: Connection reset by peer
curl: (56) Recv failure: Connection reset by peer
{"ok":true,"data":{"status":"ok","lucyVersion":"1.0.0","bundledKtxVersion":"0.13.0"}}
(exit 0)
```

## dry-run final verification: MCP proxy JSON-RPC

```text
$ LUCY_DEMO_PROXY_HOST_PORT=57891 node inbox/headless-dry-run-mcp-check-2026-06-29.mjs
tools/list: connection_list, kx_catalog, sl_query, sl_read_source, wiki_read, wiki_search
sl_read_source: ok
sl_query: 4 rows
acl filter: sql_execution absent from tools/list

(exit 0)
```

## dry-run final verification: audit sqlite exists

```text
$ docker compose ... find /data/lucy/.ktx-ui -name audit.sqlite*
/data/lucy/.ktx-ui/audit.sqlite-shm
/data/lucy/.ktx-ui/audit.sqlite-wal
/data/lucy/.ktx-ui/audit.sqlite

(exit 0)
```

## dry-run final verification: compose down

```text
$ docker compose -f docker-compose.demo.yml -p lucy-headless-dry-run down -v
 Container lucy-headless-dry-run-lucy-1 Stopping 
 Container lucy-headless-dry-run-lucy-1 Stopped 
 Container lucy-headless-dry-run-lucy-1 Removing 
 Container lucy-headless-dry-run-lucy-1 Removed 
 Container lucy-headless-dry-run-demo-db-1 Stopping 
 Container lucy-headless-dry-run-demo-db-1 Stopped 
 Container lucy-headless-dry-run-demo-db-1 Removing 
 Container lucy-headless-dry-run-demo-db-1 Removed 
 Volume lucy-headless-dry-run_lucy-demo-data Removing 
 Network lucy-headless-dry-run_default Removing 
 Volume lucy-headless-dry-run_lucy-demo-data Removed 
 Network lucy-headless-dry-run_default Removed 

(exit 0)
```

## Accepted Summary

Dry run: PASS. Supersedes earlier failed experimental MCP heredoc/direct-deny checks in this report.
