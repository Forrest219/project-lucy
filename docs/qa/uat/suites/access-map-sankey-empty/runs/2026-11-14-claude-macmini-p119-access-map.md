# Run — 2026-11-14 — claude-macmini-p119-access-map

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ACCESS-MAP` |
| Agent | Claude Code（本机 Mac mini；主线 A 全真复跑） |
| Plan | [`lucy-20261114-p1-19-access-map-uat-multi-agent-plan.md`](../../../../plans/lucy-20261114-p1-19-access-map-uat-multi-agent-plan.md) Task 2 |
| Brief | `inbox/20261114-p1-19-access-map-uat-claude-brief.md` |
| 旧 FAIL 证据 | [`2026-11-13-claude-adversarial`](2026-11-13-claude-adversarial.md) 发现 **F-1** |
| 目的 | 验证 **P1-19**（`ok`／`allow` 词表对齐）已关闭 F-1：成功触表能否进入访问关系图的 usage 流带 |
| 环境 | WebUI `http://127.0.0.1:55176`；容器 `compose-lucy-1`（image `project-lucy:demo` sha256:`0ce915211e1cfa00533da2e3d49d1a380d3da9e5d64411f5e7f61c8ab64d1a35`，构建于 2026-11-14 15:15:03 +0800）；`lucyVersion=0.30.0`；`gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；`gitDirty=true`；`ktxRuntime.ready=true`；`execution.activation=current`；`execution.verification.state=verified` |
| 容器未重启 | `StartedAt=2026-11-14T07:16:15.41952696Z`／`RestartCount=0`／`healthy` —— **跑次首尾各 `docker inspect` 取证，值完全一致** |
| 执行方式 | WebUI **真实浏览器登录**（Playwright 1.62.1 自带 Chromium，非 CDP 复用）；access-map API 真实 HTTP（管理员会话 cookie）；MCP `:57881/mcp` 真实同会话调用 |
| 开始／结束 | 2026-11-14 20:21–20:26 CST |
| **总判定** | **PASS**（必做 R0／01／02／03 全 PASS；**可选 04 实跑 PASS** —— **F-1 关闭**） |

## Case 汇总

| Case ID | 必做／可选 | 结果 | 证据摘要 |
|---|---|---|---|
| UAT-R0 | 必做 | **PASS** | `docker compose ps` → `compose-lucy-1`／`compose-demo-db-1`（另 `compose-uat-mysql57-1`／`compose-uat-mysql80-1`）全 healthy；`/api/health` `ok=true`／`status=ok`；**部署镜像已含 P1-19 修复**（容器内 `access-map-outcome.ts` 允许词表 `{"ok","allow"}`）；凭据文件 `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt`（**Desktop 同名不存在**）→ `POST /api/auth/login` 200 → `me.id=xingchen`（`displayName=星辰`／`role=owner`），`/api/auth/me` `mode=required` |
| UAT-ACCESS-MAP-01 | 必做 | **PASS** | 空访问视图取 **24h 窗**（触表前 `accessPaths=0`／`rawCalls=0`／`deniedCalls=0`／23 边全 dormant，`grantPaths=27>0`）；真实 DOM：`access-map-backbone-*`=**11** 条且**几何非退化**（`d` 长 76–80、bbox 宽 284px、`stroke-width=1.25`）、`access-map-ribbon-*`=**0**、`access-map-node-table:*`=**0**（闲置表不进列）、`pageerrors=0`；**诚实空态文案**在位：「当前问询种类为「全部种类」、访问等级为「全部」时，没有进入访问路径的允许调用；授权骨架仍按当前授权显示。可调整筛选后再看。」。另 4 个空访问切片（`agent=hehe`／`agent=invest_uat`／`connection=invest-db`／`role=lucy_admin`）均 `accessPaths=0` 且 DOM 骨干随切片自适应（hehe=4 条，`d` 长 84–89、bbox 宽 284px） |
| UAT-ACCESS-MAP-02 | 必做 | **PASS** | 真实 DOM `access-map-legend`＝「流带宽度 = 访问路径数」「闲置授权 = 端点示意／无访问时的连通骨干（不撑使用刻度）」「虚线 = 需复核」「实线 = 确凿越权」；主释义仍是**流带宽度 = 访问路径数**，未把授权路径宽度写成主释义；图例恰 4 项、可读 |
| UAT-ACCESS-MAP-03 | 必做 | **PASS** | `meta.access.trust=confirmed` 恒定（全部合法请求）；DOM 图例「关联口径：已确认关联」／筛选状态「关联口径：已确认关联 · 问询种类：全部种类 · 访问等级：全部」；**17 组参数矩阵**：非法 trust 6 组（`include_candidate`／`candidate`／空串／`CONFIRMED`／`confirmed+include_candidate`／`confirmed`+`include_candidate` 重复键）→ 全 **400 `INVALID_ACCESS_MAP_PARAMETER`**；其他非法参数 4 组（`window=999h`／`layer=bogus`／`inquiryKind=bogus`／`accessGrade=bogus`，均唯一键）→ 全 400；合法 `confirmed`／`%20confirmed%20`／重复 `confirmed` → 200 且 `trust=confirmed`、`accessPaths` 不变。**candidate 未被放进分母** |
| UAT-ACCESS-MAP-04 | 可选（主线 A **必实跑**） | **PASS** | MCP 同会话 `lucy_catalog` → `lucy_begin_question` → `lucy_query` 成功（`order_count=1000`）；触表行 audit id=6022：`outcome=ok`／`authorization_status=allowed`／`execution_status=succeeded`／`usability_status=usable`／`primary_status=succeeded`／**`association_status=confirmed`**／`turn_attribution_mode=explicit`／`confidence=high`／`sources=demo-mysql/dataforai/superstore_orders`／`lucy_turn_id` 与 begin 返回的 `lucy_e0c1052d-…` 一致。**访问面消费侧**：24h 窗 `counts.accessPaths` **0 → 2**、`meta.access.rawCalls` **0 → 1**、`meta.echo.enteringAllowCallCount` **0 → 1**、`projectedAllowCallCount` **0 → 1**、边 `dormant 23 → normal 4`；**`meta.access.deniedCalls` 0 → 0（未抬）**；DOM `access-map-ribbon-*` **0 → 5**（真实几何：`d` 长 86–101、bbox 宽 284px、`fill-accent`×4 + `fill-warning`×1）、`access-map-backbone-*` 11 → 8、`access-map-node-table:*` 0 → 1（仅 `superstore_orders`）、`pageerrors=0` |

---

## UAT-R0 — 环境门禁

### 步骤与实测

```text
$ docker compose -f deploy/compose/docker-compose.demo.yml ps
NAME                    IMAGE               STATUS                  PORTS
compose-demo-db-1       mysql:8.4           Up 46 hours (healthy)   0.0.0.0:53306->3306/tcp
compose-lucy-1          project-lucy:demo   Up 5 hours (healthy)    0.0.0.0:55176->5174/tcp
                                                                     0.0.0.0:57881->7879/tcp
compose-uat-mysql57-1   mysql:5.7           Up 29 hours (healthy)   0.0.0.0:53357->3306/tcp
compose-uat-mysql80-1   mysql:8.0           Up 31 hours (healthy)   0.0.0.0:53380->3306/tcp

$ curl -sS http://127.0.0.1:55176/api/health
{"ok":true,"data":{"status":"ok","lucyVersion":"0.30.0",
 "gitSha":"9d59337de500c778a6cee773f1bdeb41c7af837e","gitDirty":true,
 "ktxRuntime":{"ready":true,...},"execution":{"activation":"current",
 "verification":{"state":"verified",...}},...}}

$ docker inspect compose-lucy-1 --format '{{.State.StartedAt}} | RestartCount={{.RestartCount}} | Health={{.State.Health.Status}}'
2026-11-14T07:16:15.41952696Z | RestartCount=0 | healthy      # 跑次首
2026-11-14T07:16:15.41952696Z | RestartCount=0 | healthy      # 跑次尾 —— 值一致，未重启
```

### 部署侧确认含 P1-19 修复（读容器内真实文件）

```text
$ docker exec compose-lucy-1 cat /app/webui/server/admin/access-map-outcome.ts
const ACCESS_MAP_ALLOWED_OUTCOMES = new Set(["ok", "allow"]);
export function isAccessMapAllowedOutcome(outcome: string | null | undefined): boolean {
  return outcome != null && ACCESS_MAP_ALLOWED_OUTCOMES.has(outcome);
}

$ docker exec compose-lucy-1 sed -n '610,640p' /app/webui/server/admin/access-map.ts
 * - `outcome` 为 `ok`（现行写入）或 `allow`（历史合同词）进入访问路径；其余单独计拒绝。
 ...
     if (!isAccessMapAllowedOutcome(row.outcome)) {
       deniedCallIds.add(row.callId);
       continue;
     }

$ docker exec compose-lucy-1 sed -n '250,256p' /app/webui/server/admin/access-map-echo.ts
     B.add(row.id);
     if (isAccessMapAllowedOutcome(row.outcome)) E.add(row.id);
     else D.add(row.id);
```

→ 部署镜像**已含** P1-19 词表修复（SC-01／SC-02 同源判定），且镜像构建时间（2026-11-14 15:15 CST）晚于修复落地（2026-11-13）。

### WebUI 登录（真实 API，密码不入库）

```text
凭据文件：/Users/forrest/Projects/config-for-agents/lucywebui logi.txt
          （Desktop /Users/forrest/Desktop/lucywebui logi.txt **不存在**，走 fixtures 里的 fallback）
文件布局：空行分隔 → 第 3 行 = adminId、第 5 行 = 邮箱、第 7 行 = 口令

$ POST /api/auth/login  {"adminId":"xingchen","password":"<from file>"}
HTTP=200  {"ok":true,"data":{"me":{"id":"xingchen","displayName":"星辰","role":"owner","enabled":true,...}}}

$ GET /api/auth/me
HTTP=200  {"ok":true,"data":{"mode":"required","me":{"id":"xingchen","role":"owner",...}}}
```

> 脚本侧踩坑（非产品缺陷）：首次按「第 3 行 = 口令」取值导致一次 401 `AUTH_INVALID`；改按第 7 行取值后 200。

---

## UAT-ACCESS-MAP-01 — 空访问闲置骨干可读

### 空访问视图的选取（重要前提说明）

跑序要求 01 先于 04。但**触表前 168h 窗已非空**（`accessPaths=5`／`rawCalls=12`，为窗口内既有 confirmed 访问），因此「无 confirmed 触表」这一前置在 168h 上不成立。可用空访问视图有两类，本跑次**两者都取**：

1. **24h 窗（顶层全量）** —— 触表前 `accessPaths=0`／`rawCalls=0`／`deniedCalls=0`／`enteringAllowCallCount=0`，23 条边**全 `dormant`**；是本次最接近「首次打开访问关系图」的干净空态，且**触表后仍在同一窗口内**，可直接做 04 的前后对照。
2. **结构空切片** —— `agent=hehe`／`agent=invest_uat`／`connection=invest-db`／`role=lucy_admin`，四者均 `accessPaths=0`，全部边 `dormant`。

### API（触表前，2026-11-14T12:24:16Z）

```text
GET /api/admin/access-map?window=24h&inquiryKind=all&accessGrade=all
  meta.counts: agents=4 roles=4 connections=3 schemas=0 tables=12 tokens=7
               edges=23 grantPaths=27 grantUsers=4 accessPaths=0 accessUsers=0
  meta.access: state=ok trust=confirmed deniedCalls=0 rawCalls=0
  meta.echo:   enteringAllowCallCount=0 enteringAllowCallCountBasis=pre_structure projectedAllowCallCount=0
  meta.signals: dormantEdges=23 needsReviewEdges=0 confirmedUnauthorizedEdges=0
  edges: 23 条全部 state=dormant（accessPaths>0 的边 = 0 条）
```

空切片（同样 `window=168h&inquiryKind=all&accessGrade=all`）：

```text
agent=hehe          → grantPaths=12 edges=16 accessPaths=0  （16 边全 dormant）
agent=invest_uat    → grantPaths=6  edges=8  accessPaths=0  （8 边全 dormant）
connection=invest-db→ grantPaths=12 edges=10 accessPaths=0  （10 边全 dormant）
role=lucy_admin     → grantPaths=12 edges=16 accessPaths=0  （16 边全 dormant）
```

### 真实 DOM（Chromium，24h 空态）

```text
access-map-backbone-*      = 11      ← 闲置授权的连通骨干带
access-map-ribbon-*        = 0       ← 无访问，故无 usage 流带（正确）
access-map-midline-*       = 0
access-map-node-table:*    = 0       ← 闲置表不进列（SC-07）
节点构成                    = agent 4 / role 4 / conn 3 / table 0
access-map-empty-access    = 「当前问询种类为「全部种类」、访问等级为「全部」时，
                              没有进入访问路径的允许调用；授权骨架仍按当前授权显示。可调整筛选后再看。」
pageerrors                  = 0
```

骨干带几何（**非退化的连通带**，不是端点 stub）：

| testid | `d` 长度 | bbox | stroke-width |
|---|---|---|---|
| `access-map-backbone-e\|agent:demo_agent\|role:demo_readonly` | 76 | x=118 w=284 h=50 | 1.25 |
| `access-map-backbone-e\|role:demo_readonly\|conn:demo-mysql` | 76 | x=418 w=284 h=50 | 1.25 |
| `access-map-backbone-e\|agent:zhangxingchen\|role:demo_readonly` | 80 | x=118 w=284 h=49 | 1.25 |
| `access-map-backbone-e\|agent:zhangxingchen\|role:chatbi-analyst` | 80 | x=118 w=284 h=85 | 1.25 |

`agent=hehe` 空切片 DOM：骨干 4 条（`d` 长 84–89、bbox 宽 284px、`stroke-width=1.25`）、ribbon 0、表节点 0、pageerrors 0 —— **骨干数随切片自适应**，非固定值。

### 结论

- `counts.grantPaths=27>0`；`counts.accessPaths==0` 时**既有骨干连通带，也有诚实空态说明** → 不以「空流带」误判失败。
- 画布上闲置授权边是**真实连通的骨干带**（bbox 宽 284px、`d` 长 76–89），非「仅端点 stub」。
- 闲置表**不进列**（表节点 0，API 侧 tables=12 仅表示授权面含 12 张表）。

---

## UAT-ACCESS-MAP-02 — 图例披露闲置骨干

真实 DOM `data-testid="access-map-legend"` 全文：

```text
流带宽度 = 访问路径数
闲置授权 = 端点示意／无访问时的连通骨干（不撑使用刻度）
虚线 = 需复核
实线 = 确凿越权
```

- 含「**连通骨干**」与「**不撑使用刻度**」披露 ✓
- 主释义仍是「**流带宽度 = 访问路径数**」，**未**把「授权路径宽度」写成主释义 ✓
- 恰 4 项、可读 ✓

---

## UAT-ACCESS-MAP-03 — 访问面仍 confirmed-only

### trust 词表矩阵（17 组，逐条真实 HTTP）

| # | 参数 | 状态码 | 结果 |
|---|---|---|---|
| 1 | `trust=confirmed` | 200 | `trust=confirmed`，`accessPaths` 不变 |
| 2 | `trust=%20confirmed%20` | 200 | `trust=confirmed`（trim 后） |
| 3 | `trust=confirmed&trust=confirmed` | 200 | `trust=confirmed` |
| 4 | `trust=confirmed&trust=include_candidate` | **400** | `INVALID_ACCESS_MAP_PARAMETER` |
| 5 | `trust=include_candidate` | **400** | `INVALID_ACCESS_MAP_PARAMETER` |
| 6 | `trust=candidate` | **400** | `INVALID_ACCESS_MAP_PARAMETER` |
| 7 | `trust=`（空串） | **400** | `INVALID_ACCESS_MAP_PARAMETER` |
| 8 | `trust=CONFIRMED` | **400** | `INVALID_ACCESS_MAP_PARAMETER` |
| 9 | `trust=confirmed+include_candidate` | **400** | `INVALID_ACCESS_MAP_PARAMETER` |
| 10 | `window=999h` | **400** | `INVALID_ACCESS_MAP_PARAMETER` |
| 11 | `layer=bogus` | **400** | `INVALID_ACCESS_MAP_PARAMETER` |
| 12 | `inquiryKind=bogus`（唯一键） | **400** | `INVALID_ACCESS_MAP_PARAMETER` |
| 13 | `accessGrade=bogus`（唯一键） | **400** | `INVALID_ACCESS_MAP_PARAMETER` |
| 14 | `inquiryKind=`（空串） | 200 | 回落缺省 |
| 15 | `accessGrade=`（空串） | 200 | 回落缺省 |
| 16 | `inquiryKind=real&accessGrade=query` | 200 | `trust=confirmed`，`accessPaths=2`（窄筛口径生效，非放开 candidate） |
| 17 | `window=24h` / `window=720h` | 200 / 200 | `trust=confirmed` 恒定 |

### 观察项（脚本陷阱，非产品缺陷）

- `trust` 用 `parseTrustParam` → `searchParams.getAll("trust")` **全量校验**，任一非法值即 400（故 #4 为 400）。
- `inquiryKind`／`accessGrade` 用 `readParam` → `searchParams.get(key)` **取首个值**：若同时写 `?inquiryKind=all&inquiryKind=bogus` 会返回 200（首个值 `all` 生效）。
  → 因此上表 #12／#13 一律用**唯一键**复测，结果为 400，与代码契约一致。（此点与旧跑次 `2026-11-13-claude-adversarial` 备注第 1 条一致。）

### 结论

- `meta.access.trust` 在所有合法请求下恒为 `confirmed`；DOM 图例「关联口径：已确认关联」。
- `trust=include_candidate` 被**拒绝**（400），**candidate 未进分母**；访问面仍硬锁 confirmed。

---

## UAT-ACCESS-MAP-04 — begin 后同会话触表进访问流带（**F-1 关闭判定**）

### 步骤

1. **MCP**：`http://127.0.0.1:57881/mcp`（本机 `lucy-local-docker`，Bearer 运行时读入内存，**未落盘**）。
   - `lucy_catalog` → 连接 `demo-mysql`／`mysql-aliyun`；源 `demo-mysql / dataforai / superstore_orders`（`descriptionState=present`）。
   - `lucy_begin_question(question="订单数是多少？")` → `turnId=**lucy_e0c1052d-132f-46a9-818a-f3012cc1bafd**`。
   - `lucy_query(connectionId="demo-mysql", measures=["superstore_orders.order_count"], segments=["superstore_orders.active_rows"])` → `rows=[[1000]]`，`sql=SELECT COUNT(DISTINCT CASE WHEN superstore_orders.is_deleted = 0 THEN superstore_orders.order_id END) AS order_count FROM dataforai.superstore_orders`。
2. **刷新 access-map API**（同会话、未重启容器、未改配置）。
3. **刷新页面 DOM**（真实 Chromium 重新登录后打开 `/admin/access-map`）。

### 触表行 audit 证据（容器内 `/data/lucy/.ktx-ui/audit.sqlite`，`node:sqlite` 只读）

```text
id=6020  lucy_catalog        outcome=ok  association_status=unassigned
id=6021  lucy_begin_question outcome=ok  association_status=confirmed
         turn_attribution_mode=explicit  confidence=high
         lucy_turn_id=lucy_e0c1052d-132f-46a9-818a-f3012cc1bafd
id=6022  lucy_query          outcome=ok
         authorization_status=allowed  execution_status=succeeded
         usability_status=usable        primary_status=succeeded
         association_status=confirmed  turn_attribution_mode=explicit  confidence=high
         lucy_turn_id=lucy_e0c1052d-132f-46a9-818a-f3012cc1bafd   ← 与 begin 返回一致
         user_id=zhangxingchen  token_label=macpro-m4-fast-20260903
         sources=demo-mysql/dataforai/superstore_orders
```

带表源行的分布（`access_log` JOIN `access_log_sources`）：

```text
触表前： confirmed + ok = 12   confirmed + error = 3
触表后： confirmed + ok = 13   confirmed + error = 3     ← +1 行（正是 id=6022）
写入侧词表仍无 'allow'： outcome ∈ {ok(5245), denied(504), error(272), budget_stop(1)}，allow=0
```

### 访问面消费侧：前后对照

**24h 窗**（触表前 `accessPaths=0`／`rawCalls=0`／`deniedCalls=0`／`enteringAllow=0`）：

| 指标 | 触表前 | 触表后 | 判定 |
|---|---|---|---|
| `counts.accessPaths` | 0 | **2** | **>0 ✓（F-1 要求）** |
| `counts.accessUsers` | 0 | 1 | ✓ |
| `meta.access.rawCalls` | 0 | **1** | **体现允许调用 ✓** |
| `meta.access.deniedCalls` | 0 | **0** | **未抬 ✓（F-1 禁止项）** |
| `meta.echo.enteringAllowCallCount` | 0 | **1** | **体现允许调用 ✓** |
| `meta.echo.projectedAllowCallCount` | 0 | 1 | ✓ |
| `meta.signals.dormantEdges` | 23 | 19 | 4 条骨干转为 usage |
| `meta.signals.needsReviewEdges` | 0 | 1 | `chatbi-analyst→demo-mysql`（grant=0，故为「需复核」档） |
| 边状态 | 23×dormant | 19×dormant + 4×normal + 1×needs_review | ✓ |

```text
触表后 24h 窗中 accessPaths>0 的边：
  e|agent:zhangxingchen|role:demo_readonly        grant=3 accessPaths=1 accessCalls=1 normal
  e|agent:zhangxingchen|role:chatbi-analyst      grant=3 accessPaths=1 accessCalls=1 normal
  e|role:demo_readonly|conn:demo-mysql            grant=6 accessPaths=1 accessCalls=1 normal
  e|conn:demo-mysql|table:...::superstore_orders grant=3 accessPaths=2 accessCalls=1 normal
  e|role:chatbi-analyst|conn:demo-mysql           grant=0 accessPaths=1 accessCalls=1 needs_review
```

**168h 窗**（含历史访问）：

| 指标 | 触表前 | 触表后 |
|---|---|---|
| `meta.access.rawCalls` | 12 | **13**（+1） |
| `meta.access.deniedCalls` | 3 | **3**（不变） |
| `meta.echo.enteringAllowCallCount` | 12 | **13**（+1） |
| `meta.echo.projectedAllowCallCount` | 12 | **13**（+1） |

> 168h 的 `accessPaths` 5 → 5：本次触表命中的路径在窗口内本已有 `accessPaths≥1`，去重后条数不变；**增量证据以 24h 窗（0 → 2）为准**。

### 真实 DOM：usage 流带出现（触表前后，24h 窗）

| DOM 指标 | 触表前 | 触表后 |
|---|---|---|
| `access-map-ribbon-*`（usage 流带） | 0 | **5** |
| `access-map-backbone-*`（闲置骨干） | 11 | 8（**3 条骨干转为 usage 流带**：`agent:zhangxingchen→role:demo_readonly`／`agent:zhangxingchen→role:chatbi-analyst`／`role:demo_readonly→conn:demo-mysql`；另 2 条 usage 带为**新增带**：`conn:demo-mysql→table:superstore_orders`（表首次入列）／`role:chatbi-analyst→conn:demo-mysql`（该边 grant=0，触表前无带）） |
| `access-map-midline-*`（需复核虚线） | 0 | 1 |
| `access-map-node-table:*` | 0 | **1**（仅 `superstore_orders` 入列，其余 11 张闲置表仍不进列） |
| 「进入允许调用」 | `进入允许调用 0` | **`进入允许调用 1`** |
| `access-map-empty-access`（诚实空态说明） | 在位 | **消失**（已有允许调用，不再宣称空） |
| `pageerrors` | 0 | 0 |

usage 流带几何（真实绘制，非空壳 testid）：

| testid | `d` 长度 | bbox | 填充 |
|---|---|---|---|
| `access-map-ribbon-e\|agent:zhangxingchen\|role:demo_readonly` | 91 | x=118 w=284 h=74.8 | `fill-accent opacity-30` |
| `access-map-ribbon-e\|agent:zhangxingchen\|role:chatbi-analyst` | 86 | x=118 w=284 h=41.8 | `fill-accent opacity-30` |
| `access-map-ribbon-e\|role:demo_readonly\|conn:demo-mysql` | 101 | x=418 w=284 h=57.5 | `fill-accent opacity-30` |
| `access-map-ribbon-e\|conn:demo-mysql\|table:...::superstore_orders` | 89 | x=718 w=284 h=65.3 | `fill-accent opacity-30` |
| `access-map-ribbon-e\|role:chatbi-analyst\|conn:demo-mysql` | 94 | x=418 w=284 h=24.5 | `fill-warning opacity-30`（需复核档） |

### 与 F-1 的逐项对照

| F-1 记载项（2026-11-13 对抗跑次实测） | 本跑次实测 | 结论 |
|---|---|---|
| 闸门用旧词表：`access-map.ts:635` `if (row.outcome !== "allow")`；`access-map-echo.ts:253` `if (row.outcome === "allow") E.add(...)` | `access-map.ts:636` `if (!isAccessMapAllowedOutcome(row.outcome))`；`access-map-echo.ts:252` 同源判定；`access-map-outcome.ts` 允许词表 `{"ok","allow"}` | **闸门已改** |
| 写入侧 `outcome` 只有 `ok/denied/error/budget_stop`；`outcome='allow'` 计数 = 0 | 同（`allow`=0，`ok`=5245）—— P1-19 D3「不回填历史行、不改审计写入词表」按设计保持 | 符合预期 |
| 成功触表后 `deniedCalls` 0→3→**4**（成功被计入「被拒绝的访问尝试」） | 触表后 24h 窗 `deniedCalls` **0 → 0**；168h 窗 **3 → 3**（均未抬） | **F-1 主症状消失** |
| `counts.accessPaths` 仍 **0** | 24h 窗 **0 → 2** | **F-1 关闭** |
| `rawCalls=0`／`enteringAllowCallCount=0` | 24h 窗 **0 → 1**／**0 → 1** | **F-1 关闭** |
| DOM `access-map-ribbon-*` 仍 **0**（usage 流带不可达） | **0 → 5** | **F-1 关闭** |
| 关联写入侧本就正常（`confirmed`／`explicit`／`high`） | 本跑次同样达成（id=6022） | 仍成立 |

### 04 判定

**PASS —— F-1 在本部署关闭。**

四条 PASS 条件逐条成立：

1. 触表行 `association_status=confirmed`（audit id=6022，`explicit`／`high`，`lucy_turn_id` 与 begin 一致）✓
2. `counts.accessPaths > 0`（0 → 2）且 `rawCalls`／`enteringAllowCallCount` 体现允许调用（0 → 1／0 → 1）✓
3. DOM 出现 usage 流带（`access-map-ribbon-*` 0 → 5，真实几何）✓
4. **不得**仅见 `deniedCalls` 上升而 `accessPaths` 仍 0 —— 实测 `deniedCalls` **未升**，`accessPaths` 已 >0 ✓

---

## 遗留观察项（不影响本波判定，另开单建议）

**F-1 影响 ③「`deniedCalls` 在页面上未呈现」仍然成立。**

- 真实 DOM 正文关键词扫描（触表后 24h 窗）：`原始调用数` = **false**、`被拒绝的访问尝试` = **false**；`进入允许调用` = true、`需复核` = true、`确凿越权` = true。
- `webui/src/components/admin/AccessMapSignalNotes.tsx` 里确有 `原始调用数 {rawCalls} 次 · 被拒绝的访问尝试 {deniedCalls} 次`，但该组件**在产品代码中无任何引用**（`webui/src/__tests__/access-map-layout.test.tsx:455` 甚至断言 layout 源码不得出现 `AccessMapSignalNotes`）。
- 影响：P1-19 修好了「成功调用被判成拒绝」这一**判据**，但用户仍看不到拒绝计数本身 —— 若将来出现真实拒绝，页面上仍无法自证。建议单独开「访问面计数可观测性」观察项，本波**不改代码**。

另记：`gitDirty=true`（部署镜像带未提交改动），按「demo 原样」约束未追查。

---

## 执行合规声明

| 项 | 状态 |
|---|---|
| 真实登录 | ✓ WebUI 表单真实登录（Playwright Chromium）+ `POST /api/auth/login` 真实调用 |
| 真实 API | ✓ 18+ 组 access-map HTTP 请求，带管理员会话 cookie |
| 真实 DOM | ✓ Playwright 1.62.1 自带 Chromium，独立干净浏览器上下文（非复用 Cursor 通道） |
| 真实 MCP | ✓ `:57881/mcp` 同会话 `lucy_catalog` → `lucy_begin_question` → `lucy_query` |
| 跑序 | ✓ R0 → 01 → 02 → 03 → 04（04 最后执行） |
| `docker restart` | **否**。`StartedAt` 全程不变、`RestartCount=0`（跑次首尾各取证） |
| 改产品代码 | **否**。仅读 `webui/server/admin/access-map*.ts` 与 `webui/src/**` 用于取证 |
| 改 INDEX／e2e-ledger | **否**（留给 T3 Cursor 验收台账） |
| vitest／CR 冒充 | **否**。本跑次所有断言均来自真实 HTTP／DOM／audit 读取 |
| 密码／token 入库 | **否**。WebUI 口令与 MCP Bearer 只在进程内存中使用；未写入本跑次、INDEX 或证据目录 |
| 清理 | ✓ 容器内临时审计脚本 `/tmp/uat-p119-audit-probe.mjs` 已 `rm`（`docker cp` 落地为 root 属主，首次删除失败，已用 `-u root` 重试并复查 `cleaned`）；**未创建任何临时连接／库／表**；audit 按 `cases.md`「无需删 audit；勿改历史 `association_status`」**只追加不清理**（新增 id 6020–6022 属本次跑次取证痕迹） |
| 证据目录 | `inbox/uat-p1-19-access-map-2026-11-14/`（gitignored，`.gitignore:59 inbox/`）；**不含任何 secret** |

### 证据文件清单（gitignored）

```text
inbox/uat-p1-19-access-map-2026-11-14/
  cookies.txt                     管理员会话 cookie（gitignored 目录内，非仓库）
  login-resp.json                 登录响应（me.id=xingchen / role=owner）
  api-01-168h-all-all.json        触表前 168h 基线
  api-01-agent-hehe.json          空切片（agent=hehe）
  api-01-agent-invest_uat.json    空切片（agent=invest_uat）
  api-01-connection-invest-db.json 空切片（connection=invest-db）
  api-01-role-lucy_admin.json     空切片（role=lucy_admin）
  api-04-pre-24h.json             04 触表前 24h 基线（accessPaths=0）
  api-04-post-24h.json            04 触表后 24h（accessPaths=2）
  api-04-post-168h.json           04 触表后 168h
  dom-baseline.json / .png        168h 全量 DOM（触表前）
  dom-empty-24h.json / .png       24h 空态 DOM（触表前）
  dom-empty-hehe.json / .png      hehe 空切片 DOM（触表前）
  dom-after-24h.json / .png       24h 触表后 DOM（ribbon=5）
  matrix-trust.json               trust 矩阵（触表前）
  matrix-trust-post04.json        trust 矩阵（触表后）
  matrix-trust.log / matrix-trust-post04.log   矩阵运行日志
  audit-before.slim.json          触表前 audit 摘要（maxId=6019）
  audit-after.json                触表后 audit（id>6019 增量，3 行）
  dom-empty-24h.err / dom-after-24h.err / audit-*.err   无输出的运行错误日志（空）
  probe-dom.mjs / matrix-trust.mjs / audit-probe.mjs   取证脚本
```
