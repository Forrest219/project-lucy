# Run — 2026-11-13 — claude-adversarial

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ACCESS-MAP` |
| Agent | Claude（对抗性全真复测；相对 Cursor 跑次另造路径） |
| 环境 | WebUI `http://127.0.0.1:55176`；容器 `compose-lucy-1`（image `project-lucy:demo` sha256:25f505e0a946）；`lucyVersion=0.30.0`；`gitSha=ea4ef839195ac4e1b053977dd3a4bccdcd545f96`；`gitDirty=false`；`ktxRuntime.ready=true`；`execution.activation=current` |
| 容器未重启 | `StartedAt=2026-11-13T04:00:12.439734509Z`／`RestartCount=0`／`healthy` —— **跑次首尾各 `docker inspect` 取证，值一致** |
| 开始／结束 | 2026-11-13 14:25–14:36 CST |
| 总判定 | **PASS WITH GAP**（必做 R0／01／02／03 全 PASS；**可选 04 实测 FAIL**——见「分叉说明」与「发现 F-1」） |

| Case ID | 必做／可选 | 结果 | 证据摘要 |
|---|---|---|---|
| UAT-R0 | 必做 | **PASS** | `docker compose ps` → `compose-lucy-1`／`compose-demo-db-1` healthy；`/api/health` `ok=true`；凭据文件 `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt`（Desktop 同名**不存在**）登录 → `me.id=xingchen`（owner，星辰） |
| UAT-ACCESS-MAP-01 | 必做 | **PASS** | API 18 组参数全空（`grantPaths=27`／`accessPaths=0`／`rawCalls=0`／23 边全 dormant）；**真实 Chromium DOM**：5 组全图 URL 各 **11** 条 `access-map-backbone-*`，且**几何非退化**（`d` 长 76–86、bbox 宽 284px、`stroke-width=1.25`）；`access-map-ribbon-*`=0；**表节点=0**（闲置表不进列）；canvas 仅 4 agent + 4 role + 3 conn |
| UAT-ACCESS-MAP-02 | 必做 | **PASS** | `access-map-legend`＝「流带宽度 = 访问路径数／**闲置授权 = 端点示意／无访问时的连通骨干（不撑使用刻度）**／虚线 = 需复核／实线 = 确凿越权」；主释义仍是「流带宽度 = 访问路径数」，未把授权路径宽度写成主释义 |
| UAT-ACCESS-MAP-03 | 必做 | **PASS** | `meta.access.trust=confirmed` 恒定；图例「关联口径：已确认关联」；**10 组 trust 变体**：`include_candidate`／`candidate`／空串／`CONFIRMED`／`confirmed+include_candidate` → **400 `INVALID_ACCESS_MAP_PARAMETER`**（param=trust，「关联口径只接受已确认关联」）；`confirmed`／`%20confirmed%20`／重复 confirmed → 200 且 `trust=confirmed`；另 6 类非法参数（window/layer/view/table/inquiryKind/accessGrade）→ 全 400 |
| UAT-ACCESS-MAP-04 | **可选** | **FAIL** | MCP 可用（不再是 SKIPPED）。**关联写入侧 PASS**：`lucy_begin_question` → 同会话 `lucy_query`/`lucy_read_source` → `association_status=confirmed`／`turn_attribution_mode=explicit`／`confidence=high`，并落 `access_log_sources`（`demo-mysql/dataforai/superstore_orders`）。**但访问面消费侧 FAIL**：`counts.accessPaths` 仍 **0**、`rawCalls=0`、`enteringAllowCallCount=0`，DOM `access-map-ribbon-*` 仍 **0**（usage 流带不出现）；反而 `deniedCalls` 0→3→**4**（成功的触表被计入「被拒绝的访问尝试」）。根因见「发现 F-1」 |

## 对抗加码（相对 Cursor 跑次新造，均全真执行）

| # | 对抗动作 | 期望 | 实测 | 结果 |
|---|---|---|---|---|
| A1 | **换统计窗口**：24h／168h／720h（Cursor 只跑 168h） | 访问面仍空、骨架仍在 | 3 窗全部 `grantPaths=27`／`accessPaths=0`／`rawCalls=0`／23 边全 dormant；DOM 各 **11** 条骨干 | PASS |
| A2 | **默认筛 vs all/all vs 窄筛**：无参／`management+exclude_connect`／`inquiryKind=real`／`accessGrade=query`／`accessGrade=connect` | 空态不因筛选口径翻转 | 5 组全部 `accessPaths=0`；DOM 骨干恒 11 条；空态说明随筛选**改写措辞**（「全部种类/全部」vs「管理相关/排除连接」），未套同一句文案 | PASS |
| A3 | **7 个结构切片**：`agent=demo_agent`／`invest_uat`／`hehe`、`role=lucy_admin`、`connection=invest-db`、`table=demo-mysql::dataforai::superstore_orders` | 切片内访问面同样为空 | 各切片 `accessPaths=0`；切片 DOM 骨干数 = 该切片两端均在画布的闲置边数（invest_uat→2、hehe→4），**随切片自适应**，非固定 11 | PASS |
| A4 | **非法 trust / 非法参数 16 组**（Cursor 只试 1 组 `include_candidate`） | confirmed-only 硬锁不放开 | trust 非法值 5 组 + 其他参数非法 6 组 + 重复键 4 组 → 全部 400 `INVALID_ACCESS_MAP_PARAMETER`；合法 `confirmed` 三种写法 → 200 且 `accessPaths` 不变 | PASS |
| A5 | **audit.sqlite 直查 `association_status`**（容器内 `/data/lucy/.ktx-ui/audit.sqlite`，`node:sqlite` 只读；Cursor 未做） | confirmed-only 口径可复核 | 触表前全库 5797 行：`NULL=5688`／`unassigned=91`／`candidate=15`／`confirmed=3`，且 3 条 confirmed 全是 `lucy_begin_question`、**无 `access_log_sources`**；**带表源的行 `confirmed=0`**（NULL=485／unassigned=43／candidate=10）；168h 窗内 confirmed=0。candidate 触达过 `demo-mysql::dataforai::*` 却**未进访问面** → confirmed-only 硬锁生效 | PASS |
| A6 | **真实 Chromium DOM 二次取证**（Cursor 用 CDP；本跑次用 Playwright 1.62.1 自带 Chromium，另起干净浏览器上下文，非复用 Cursor 通道） | 骨干是**真画出来的连通带**，不是 testid 空壳 | 11 条骨干 `path`：`d` 长 76–86、bbox 宽 284px（例：`M118,42 C212.7,42 307.3,89 402,89 …`）、`stroke-width=1.25`；**几何退化条数 = 0**；`pageerrors=0`；截图 `inbox/.../dom-empty.png` 目视：Agent→角色→连接 骨架连续可读，非「仅端点 stub」 | PASS |
| A7 | **DOM 断言「闲置表不进列」**（SC-07） | 画布无表柱 | `access-map-node-table:*` 计数 **0**；canvas 节点 = 4 agent + 4 role + 3 conn；**无 conn→table 骨干**（12 条 conn→table 闲置边因表不在画布而不成带） | PASS |
| A8 | **MCP 同会话 begin→触表**（Cursor 记 SKIPPED；本机 MCP `lucy-local-docker` 可用） | confirmed 后 `accessPaths>0` 且出现 usage 流带 | 关联写入侧达成（confirmed/explicit/high + 落 source）；**访问面 `accessPaths=0`、`rawCalls=0`、DOM ribbon=0**；`deniedCalls` 0→3→4 | **FAIL** |
| A9 | **裸 JSON-RPC MCP 对照实验**（不经宿主 MCP，直接手写 `initialize`→`tools/call`，验证因果而非巧合） | 无 begin 的触表**不得**升 confirmed | 全新会话：**begin 之前**的 `lucy_read_source` → `candidate`／`identity_inferred`／`low`／`lucy_session_id=null`（SC-02 ✓）；同会话 `lucy_begin_question` 后再读 → `confirmed`／`explicit`／`high`（SC-01 ✓）。因果可证：confirmed 由 begin 带来 | PASS（关联侧） |

## 发现 F-1（新增缺陷，可开单；非本次空桑基修复引入）

**访问面 band E 闸门仍用旧 `outcome` 词表，当前部署的 usage 流带不可达。**

| 项 | 事实（均为本次实测，非读代码推断） |
|---|---|
| 闸门位置 | `webui/server/admin/access-map.ts:635` `if (row.outcome !== "allow") { deniedCallIds.add(...); continue; }`；`webui/server/admin/access-map-echo.ts:253` `if (row.outcome === "allow") E.add(row.id); else D.add(row.id);`（band E＝允许，非 allow 一律进 band D＝被拒绝） |
| 写入侧词表 | `webui/server/proxy/audit.ts:119` `outcome: "ok" \| "error" \| "denied" \| "budget_stop"` —— **成功调用写 `outcome='ok'`**，并另写 `authorization_status='allowed'`／`execution_status='succeeded'`／`usability_status='usable'`／`primary_status='succeeded'`；`legacy_outcome` 同为 ok/denied/error |
| 实测词表 | 全库 5802 行 `access_log.outcome` 去重值仅 `ok`／`denied`／`error`／`budget_stop`；**`outcome='allow'` 计数 = 0**，`legacy_outcome='allow'` 计数 = 0 |
| 因果链 | 我在同会话真实触表后：`deniedCalls` 0 → 3（3 条 confirmed 带表源：2 成功 + 1 上游错误）→ 4；同期 `counts.accessPaths=0`／`rawCalls=0`／`enteringAllowCallCount=0`／DOM `access-map-ribbon-*=0` |
| 排除其他归因 | 新行 `role_ids=["demo_readonly","chatbi-analyst"]`（`attributeRoles` 走 `role_ids` 兜底）、`permission_snapshot_hash` 命中 `permission_snapshots`（16 条）、`effective_tables_count=6`；Agent `zhangxingchen` 对 `demo-mysql::dataforai::superstore_orders` **有** grantPaths → **只差 `outcome` 词表这一道闸** |
| 合同侧同源 | `webui/docs/187-access-relation-sankey-spec.md:191/325/461/493` 与 `docs/specs/lucy-20261102-access-map-audit-echo-spec.md:122`（D8）都把 band E 写成 `outcome='allow'` —— **合同与写入器词表已漂移**，不是实现单点漏改 |
| 时间线 | 审计状态模型（`authorization_status` 等四轴 + `legacy_outcome`）落地于 `21de5168`（2026-10-25）；访问关系图合同 `556fdc30`（2026-11-05）仍用旧词表；空桑基修复 `f3f88837`（2026-11-13）沿用同一闸门 |
| 影响 | ① SC-06／SC-10 与 UAT-ACCESS-MAP-04 期望「confirmed 后 accessPaths>0 且出现 usage 流带」在当前部署**不可达**；②「进入允许调用」恒为 0；③ **成功的触表被静默计入「被拒绝的访问尝试」**，且 `deniedCalls` 在页面上**未呈现**（`AccessMap.tsx` 无该字段引用）→ 用户看不到真相 |
| 与错题本关系 | [`docs/lessons/2026-11-13-access-map-sankey-empty.md`](../../../lessons/2026-11-13-access-map-sankey-empty.md) §3 把空访问面归因于 confirmed-only 硬锁（原因 1）与 usage-first 几何（原因 2）；本跑次实测表明**还有第三个独立阻塞**：即使 confirmed 关联已成功写入，访问面仍不会出 usage 流带 |

> **注**：本次空桑基修复（`f3f88837`）自身的必做范围 **SC-04／SC-05／SC-07／SC-08／SC-11 均在本部署实测通过**；F-1 属**上游合同词表漂移**，非本次修复引入的回归，但会使「空态修复已收口 ⇒ 有访问时也能画流带」这一整体承诺在部署侧不成立。

## 备注

- **与 Cursor 跑次的分叉（总判定不同项）**：Cursor 跑次 `UAT-ACCESS-MAP-04` 记 **SKIPPED**（MCP 发现失败），因此其总判定为 PASS WITH GAP；本跑次该 MCP 路径**可用且实跑**，实测 **FAIL**。分叉原因不是环境差异，而是 Cursor 未触达这条路径——同环境下「begin→触表→访问面出流带」并不成立（见 F-1）。必做三项（01／02／03）本跑次与 Cursor **同判 PASS**（Cursor 结论在本跑次被独立复现并加宽到 18 组 API + 7 组 DOM）。
- 是否使用 `docker restart`：**否**。`StartedAt` 全程不变、`RestartCount=0`（跑次首尾各 `docker inspect` 取证）。
- 未使用 `npm run demo:upgrade -- --fresh`；未触碰 compose 定义；未改任何容器内配置。
- 清理是否完成：**是**。容器内 `/tmp/audit-*.mjs` 临时审计脚本已 `rm`（以 root 执行，落地文件属 root 故首次删除失败，已复查 `cleaned`）；**未创建任何临时连接／临时库／临时表**；audit 表按 `cases.md`「无需删 audit；勿改历史 association_status」**只追加不清理**（新增 id 5798–5805 属本次跑次取证痕迹）。
- 凭据处理：WebUI 口令只从 `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt` 读入进程内存，**未**写入仓库／本跑次／日志／截图说明；MCP Bearer 运行时从 `~/.claude.json` 的 `lucy-local-docker` 配置读入内存，**未**落盘。截图与原始日志在 gitignored 的 `inbox/uat-claude-access-map-2026-11-13/`。
- 本跑次自身的脚本缺陷（先排除自身、再判定产品）：
  1. 首轮 trust/参数矩阵的 `inquiryKind=bogus`／`accessGrade=bogus` 两行被 URL 重复键污染（`URLSearchParams.get` 取首个值 `all`）而误报 200 → 改用唯一键重测 → **400 `INVALID_ACCESS_MAP_PARAMETER`**（与代码契约一致）。重复键行为另记：首个值生效。
  2. 首次 `lucy_query` 因 measures 形态写错（用了 `{expr,name}` 而非 source-qualified 字符串）→ 上游 `ParseError` → 产生 1 条 `outcome=error` 的 confirmed 行（audit id 5800）；改用 `superstore_orders.total_sales` 后成功。**该 error 行属本跑次脚本缺陷，非产品缺陷**，但它同时证明错误调用也会被计入 `deniedCalls`。
- 原始日志（gitignored `inbox/uat-claude-access-map-2026-11-13/`）：`api-matrix.log`、`trust-matrix.log`、`api-168h-all-all.json`、`api-after-168h.json`、`audit-probe*.log`、`audit-pre4.log`、`audit-post5.log`、`audit-outcome6.log`、`audit-legacy7.log`、`audit-ctrl8.log`、`audit-roles.log`、`dom-empty.log`／`dom-empty.json`／`dom-empty.png`、`dom-after.log`／`dom-after.json`、`mcp-control.log`／`mcp-control-result.json`、`cookies.txt`

## API 摘录（无密钥）

```text
# 触表前（本跑次 18 组参数，均一致）
GET /api/admin/access-map?window=168h&inquiryKind=all&accessGrade=all
  meta.counts.grantPaths=27  accessPaths=0  edges=23  tables=12  agents=4  roles=4  connections=3
  meta.access.state=ok  trust=confirmed  rawCalls=0  deniedCalls=0
  meta.echo.enteringAllowCallCount=0
  edges: 23 条全部 state=dormant

GET ...&layer=schema            → edges=26 nodes=33（accessPaths 仍 0）
GET ...&window=24h / 720h       → 同上
GET ...&agent=demo_agent        → grant=3  edges=5  nodes=7   accessPaths=0
GET ...&agent=invest_uat        → grant=6  edges=8  nodes=12  accessPaths=0
GET ...&agent=hehe              → grant=12 edges=16 nodes=18  accessPaths=0
GET ...&trust=include_candidate → 400 INVALID_ACCESS_MAP_PARAMETER (param=trust)
GET ...&trust=CONFIRMED         → 400 INVALID_ACCESS_MAP_PARAMETER (param=trust)
GET ...&trust=%20confirmed%20   → 200 trust=confirmed accessPaths=0
GET ...&inquiryKind=bogus       → 400 INVALID_ACCESS_MAP_PARAMETER (param=inquiryKind)

# 同会话 MCP 触表后（同参再取）
  meta.counts.accessPaths=0     ← 用例 04 期望 >0，未达成
  meta.access.rawCalls=0  deniedCalls=4   ← 成功的触表被计入「被拒绝」
  meta.echo.enteringAllowCallCount=0
  DOM: access-map-ribbon-* = 0；access-map-backbone-* = 11（不变）
```

## 审计行摘录（容器内 audit.sqlite，只读）

```text
id=5803  lucy_read_source  dataforai.superstore_people  outcome=ok
         association_status=candidate  mode=identity_inferred  conf=low   session=null   ← 无 begin（SC-02）
id=5804  lucy_begin_question                                    outcome=ok
         association_status=confirmed  mode=explicit           conf=high  turn=lucy_265d938d-…
id=5805  lucy_read_source  dataforai.superstore_people  outcome=ok
         association_status=confirmed  mode=explicit           conf=high  session=d0cb5e9b-…  ← 有 begin（SC-01）
id=5802  lucy_query        dataforai.superstore_orders   outcome=ok
         association_status=confirmed  mode=explicit           conf=high
         authorization_status=allowed  execution_status=succeeded  usability_status=usable  primary_status=succeeded
         ↑ outcome≠'allow' → 被判入 band D（被拒绝），未进访问路径

access_log.outcome 去重值：ok / denied / error / budget_stop（无 allow）
outcome='allow' 计数 = 0 ；legacy_outcome='allow' 计数 = 0
```
