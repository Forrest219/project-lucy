# Run — 2026-11-20 — kimi-scale-stress

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE` |
| 选择器 | **F58-stress／F59-stress 补充观察**（超合同地板造数 + 开放式压测 + 浏览器测量）；非完整 F58／F59／R，不替代任何必做 |
| Agent | Kimi Code（UAT 测试执行） |
| 环境 | 本机 demo `http://127.0.0.1:55176`（webui）／`:57881`（MCP）；容器 `compose-lucy-1`／`compose-demo-db-1` healthy；**demo 共享栈，非 fixtures 要求的隔离卷**（造数前后备份比对，见清理节） |
| 候选 | `lucyVersion=0.30.0`；`gitSha=6208ea57…`；`gitDirty=true`；镜像 digest `sha256:9b670785…`（与 [2026-11-19-cursor-f58-f59-smoke](2026-11-19-cursor-f58-f59-smoke.md) 同候选，已含 P1-58/59 Wave1–3）；webui 为 **build 产物**（`/app/webui/dist`，非 vite dev） |
| 资源 | 容器 **无 CPU/内存上限**（fixtures 合同为 2 vCPU/4 GiB，本跑次未施加，资源口径差异如实记录）；宿主 Apple M4 Pro／24 GB；Docker 29.3.1 |
| 凭据 | 仓库外登录文件（路径不录入口令）；登录走真实 `/api/auth/login` |
| 入口 | `node scripts/uat/roles-agent-scale-stress.mjs {seed|load|burst|verify|cleanup}`（runner 落盘可复用） |
| 原始 JSON | `inbox/uat-racs-stress-2026-11-20/`（seed／load／burst／cleanup／verify + `access.yaml.bak` 备份） |
| 总判定 | **PASS WITH GAP（stress 补充跑次）**：API 读取在超 5× 规模下达企业级合同线；浏览器页面前端渲染存在全量渲染风险（后台测量 15–29 s，前台复测为 GAP）；≠ 完整 F58／F59／R PASS；≠ 功能收口；≠ 可上线 |

## Fixture（实际规模，verify 实测）

| 维度 | 计划 | 实测 | 对照 fixtures 档位 |
|---|---:|---:|---|
| 正式角色 | 300 | 304 正式（9 基线 + 295 fixture 显示口径；verify 计数 301 含 `uat_racs_probe1` 残留，见观察 O-2） | **> 5×（100）**，stress 超线 |
| Agent | 110 | 112（110 fixture + 2 基线） | B(100)–2×(200) 之间 |
| 配置凭据（token） | 1,100 | 1,100（110×10，全部 `expires_in=30d` 真实签发） | ≈5×(1,500) 的 73% |
| 审计历史行 | 未造 | 0 新增（本跑次不覆盖 RACS-02 窗口外历史维度） | 缺口如实记录 |
| 连接/来源 | 复用 demo | 1 连接（demo-mysql）×3 表 | 小于 B(8/263)——读路径授权编译规模由角色/agent 维度补足，来源维度未放大如实记录 |

造数全部走真实 API（`POST /api/admin/roles`／`POST /api/admin/agents`／`POST /api/admin/agents/:id/tokens`），0 mock、0 直改文件；seed 0 失败，耗时 448 s。

## 结果表

### S1 — 造数（真实 API，串行，发布窗口语义）

| 接口 | n | 状态 | p50 | p95 | p99 | max |
|---|---:|---|---:|---:|---:|---:|
| POST /api/admin/roles | 300 | 300×200 | 228 ms | 379 ms | 416 ms | 441 ms |
| POST /api/admin/agents | 110 | 110×200 | 425 ms | 500 ms | 513 ms | 531 ms |
| POST /api/admin/agents/:id/tokens | 1,100 | 1,100×200 | 300 ms | 382 ms | 413 ms | 467 ms |

### S2 — 读取压测（开放式 10 req/s × 60 s，5 独立同账号会话 Cookie，混合 roles 50%／agents-full 25%／roster 12.5%／statistics 12.5%，range 7d/14d/30d=50/25/25）

| 接口 | n | 状态 | p50 | p95 | p99 | max | fixtures 5× 线 |
|---|---:|---|---:|---:|---:|---:|---:|
| GET /api/admin/roles | 300 | 300×200 | 82 ms | **93 ms** | 132 ms | 143 ms | ≤500 ms ✓ |
| GET /api/admin/agents?range=7d/14d/30d | 150 | 150×200 | 88 ms | **97 ms** | 122 ms | 126 ms | ≤1,000 ms ✓ |
| GET /api/admin/agents?view=roster | 75 | 75×200 | 86 ms | **115 ms** | 159 ms | 159 ms | ≤500 ms ✓ |
| GET /api/admin/agents/statistics | 75 | 75×200 | 80 ms | **101 ms** | 144 ms | 144 ms | ≤1,000 ms ✓ |

- 计划 600／发出 600／完成 600／丢弃 0，实际 9.84 req/s；正确率 100%，零 5xx。
- 观察：写入风暴期（seed 进行中）读取返回 503 `DISPLAY_SNAPSHOT_BUSY`——合同内可解释行为（写屏障，旧结果不回填），恢复后读取全部成功。

### S3 — 并发突发（同键 roles ×50 并发，超 fixtures 07 的 25 并发设计）

| 并发 | 状态 | p50 | p95 | max | server-timing 样本 |
|---:|---|---:|---:|---:|---|
| 50 | 48×200 + 2×503 BUSY | 2,444 ms | 4,194 ms | 4,199 ms | `permissions;dur≈1,700 ms, cache;desc=hit, builds;desc=0` |

- 2/50 的 BUSY 属预期事务结果（同键构建合并 + 代次变化重试超限），不计正常窗口失败；50 并发超出设计上限 25，结果为超设计观察，不倒推 25 并发结论。

### S4 — 浏览器测量（Kimi Code Desktop 内建浏览器，1920×1080，**后台标签页**条件——面板不可用未能前台化，绝对值含渲染节流放大，见 GAP-1）

| 场景 | 轮次 | 导航→列表内容可见 |
|---|---|---:|
| /admin/roles（304 正式角色）整页导航 | 冷进（设备切换后） | 22.4 s |
| 同上 | 第 2 轮 | 25.8 s |
| /admin/agents（112 Agent）整页导航 | 第 1 轮 | 15.1 s |
| 同上 | 第 2 轮 | 28.6 s |
| /admin/connections（2 连接，轻量对照）整页导航 | 第 1/2 轮 | 15.9 s / 19.5 s |
| SPA 内部导航 connections→agents（点击侧边栏，无整页重载） | 1 轮 | 29.3 s |
| 列表 API 同窗口压测对照 | — | p95 93–115 ms |

- 排除项：JS bundle 402 KB／`immutable` 缓存头／回环 100 MB/s，**网络与缓存不是瓶颈**。
- 根因证据：`webui/src/pages/admin/RoleList.tsx:491` `filtered.map(...)` **全量渲染、无虚拟滚动**（AgentList 同模式）；行内嵌 badges／引用 Agent／权限摘要多重复合渲染。数据规模直接放大渲染时间，叠加后台标签 rAF 暂停放大到 15–29 s。
- 前端统计卡口径正确（Role 总数 304／使用中 112／未引用 192／解析异常 0），渲染结果与 API 数据一致。

## 判定对照 fixtures §5

| 指标 | 本跑次实测 | 线 | 判定 |
|---|---:|---:|---|
| 角色列表／roster API 热态 p95 | 93 ms／115 ms | ≤500 ms（5×） | **PASS**（且优于 B 线 200 ms） |
| 统计 API 热态 p95 | 101 ms | ≤1,000 ms（5×） | **PASS** |
| 默认完整列表 API 热态 p95 | 97 ms | ≤1,000 ms（5×） | **PASS** |
| 正确率／成功读取 | 100%／100% | 100% | **PASS** |
| 桌面名册 primaryReady p95 | 后台 15–29 s（节流放大） | ≤2,000 ms（5×） | **BLOCKED（前台复测缺失）**，方向性风险成立 |
| 写造数／清理丢失 | 0 | 0 | **PASS** |

## 观察（非本套件收口判据，转交对应条目）

- **O-1（前端性能缺陷候选）**：角色/Agent 列表全量渲染无虚拟滚动。300 角色规模下前台渲染预计数秒级（合同线 2 s），与"页面频繁卡顿"报告一致。建议按 P1-58 后续波次或新条目评估虚拟滚动/分页/行渲染 memo。登记人：本跑次；证据：RoleList.tsx:491 + S4。
- **O-2（API 易用性观察）**：`DELETE /api/admin/roles/:id` 默认 `dryRun=true`，响应 200+diff 但未显式标记本次为预览——脚本/调用方不带 `{dryRun:false}` 时会误判已删除（本跑次 runner 与早前 probe 均中招）。建议响应内显式 `dryRun:true` 字段或在 `03-api-spec.md` 醒目标注；不阻塞 F59，但属"保存结果不得冒充成功"家族，建议 P1-59 后续波次顺手收紧。
- **O-3**：seed 期间读取 100% 可解释 BUSY（503）且恢复后全成功——写屏障语义符合设计；建议完整 F58 runner 将"写入风暴下读取 BUSY 率"纳入报告分组。

## 明确未覆盖（GAP）

- **GAP-1**：浏览器前台测量——本跑次全部为后台标签（渲染被节流），primaryReady 绝对值不可作合同判定；需前台复测（委托人打开会话面板或授权其它前台路径）。
- fixtures B/2×/5× 完整造数（连接 8／来源 263+／审计 20 万–100 万行／慢盘／冷缓存／多账号／不同账号身份模式）仍 NOT RUN；本跑次只放大角色/Agent/凭据三维。
- RACS-02 窗口外历史、07 的 25 并发标准档、09–11 冲突矩阵、12 纯 MCP、14 故障注入、15 长稳态、16 负控、17 校准全部未跑。
- 浏览器 E1–E18／E1–E28 元素级证据未逐条采集（本跑次只做加载计时与口径核对）。

## 清理（fixtures §7）

- 删除 110 fixture Agent（连带 1,100 token 记录，第一轮完成）+ 300 个 fixture 角色（第二轮 `dryRun:false` 真删）；最终 verify：fixture 残留 0，基线还原 **roles 9／agents 2**。
- **过程发现**：`DELETE /api/admin/roles/:id` 与创建同语义默认 `dryRun=true`——不带 body 的 DELETE 返回 200+diff 但对象仍在（第一轮 cleanup 据此误报删净；`uat_racs_probe1` 残留同源）。带 `{dryRun:false}` 后真删（`status:"committed", written:true`，随后 GET 404）。已修正 runner；该默认语义响应未显式标 dryRun，调用方易误判，登记观察 O-2。
- 造数前备份 `inbox/uat-racs-stress-2026-11-20/access.yaml.bak` 与清理后容器内文件 **diff 逐字节一致**。
- 未触碰共享 demo 的既有对象（`demo_readonly`／`lucy_ops_reader`／`lucy_admin`／`demo_agent`／`demo_ops` 全程未改）；未 `down -v`；未对生产域名施压。

## 复跑

```bash
LUCY_DEMO_LOGIN_FILE=<仓库外登录文件> node scripts/uat/roles-agent-scale-stress.mjs seed --roles 300 --agents 110 --tokens-per-agent 10
LUCY_DEMO_LOGIN_FILE=<同上> node scripts/uat/roles-agent-scale-stress.mjs load --rps 10 --duration-sec 60 --sessions 5
LUCY_DEMO_LOGIN_FILE=<同上> node scripts/uat/roles-agent-scale-stress.mjs burst --concurrency 50
LUCY_DEMO_LOGIN_FILE=<同上> node scripts/uat/roles-agent-scale-stress.mjs cleanup
```
