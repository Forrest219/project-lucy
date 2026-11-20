# Run — 2026-11-20 — cursor-roles-agents-browser-timing

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE` |
| 选择器 | **F58-browser-timing**（前台浏览器＋即时计时；Roles／Agents 页） |
| Agent | Cursor（cursor-ide-browser，前台可视） |
| 环境 | WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881`；`compose-lucy-1` healthy |
| 候选 | `lucyVersion=0.30.0`；`gitSha=1fb73f72…`；`gitDirty=true` |
| 视口 | 1920×1080；`document.hidden=false`；`visibilityState=visible`（前台，非后台节流） |
| 规模 | API：229 roles／82 agents；UI 表行：Roles **223**／Agents **82**（正式 Role 口径） |
| 凭据 | 管理员经真实登录；口令不入库 |
| 原始 JSON | `inbox/uat-racs-browser-2026-11-20/browser-timing.json`；`api-baseline.json` |
| 截图 | Cursor 会话截图 `page-2026-11-20T03-01-32-731Z.png`（roles）、`page-2026-11-20T03-01-52-288Z.png`（agents） |
| 总判定 | **PASS WITH GAP（浏览器计时）** — 本规模前台 primaryReady 远优于 fixtures B≤1000 ms；≠ 完整 F58／R；≠ 可上线 |

## 方法

1. 真实 API 造数（`uat_racs_br_*` 前缀）；造数中途曾因写风暴导致 Lucy 进程短暂不可达，重启后保留约 220+ roles。
2. 前台浏览器登录后，从概览／侧栏 SPA 点击进入 `/admin/roles`、`/admin/agents`。
3. 计时定义：点击导航 → `[data-testid=*-list-table] tbody tr` 达规模门槛（roles≥100／agents≥50）的 `performance.now()` 差，记为 **primaryReadyMs**。
4. 同步记录 DOM 节点数、longtask、同窗口 API 基线；与 API 耗时**分列**。

## API 基线（同规模，非页面）

| 路径 | status | ms | n |
|---|---:|---:|---:|
| GET `/api/admin/roles` | 200 | 69 | 229 |
| GET `/api/admin/agents?view=roster` | 200 | 51 | 82 |
| GET `/api/admin/agents?range=7d` | 200 | 41 | 82 |
| GET `/api/admin/agents/statistics?range=7d` | 200 | 35 | 82 |

## 前台 SPA primaryReady（3 轮）

| 轮次 | Roles → 表可见 | Agents → 表可见 | Roles 行／DOM | Agents 行／DOM |
|---:|---:|---:|---|---|
| 1 | **95 ms** | **42 ms** | 223／6124 | 82／2707 |
| 2 | 36 ms | 33 ms | 223／6124 | 82／2707 |
| 3 | 26 ms | 32 ms | 223／6124 | 82／2707 |

补充（更早一轮从 overview 冷进 roles）：**189 ms** primaryReady；1× longtask **75 ms**；DOM ≈6116。

筛选输入 `uat_racs`：215 ms 后仍见 220 行（过滤生效不完全／异步，记观察，非本选择器 FAIL）。

对照轻量页「连接概览」：`/connections` 侧栏点击 ~1 ms 路径切换（非列表压力对照）。

## 对照 fixtures §5

| 指标 | 本跑次 | 线（B／5×） | 判定 |
|---|---:|---|---|
| 桌面名册 primaryReady（Roles，前台） | 26–189 ms | ≤1000／≤2000 ms | **PASS**（本规模） |
| 桌面名册 primaryReady（Agents，前台） | 32–109 ms | ≤1000／≤2000 ms | **PASS**（本规模） |
| 列表 API | 35–69 ms | ≤200–1000 ms | **PASS** |

## 与既有 kimi 后台 15–29 s 主张

- 本跑次为**前台**可视会话；同候选、~223 roles 全量 DOM（无虚拟滚动仍成立：`RoleList.tsx` `filtered.map`）。
- 前台 primaryReady **亚秒级**，**不支持**将「15–29 s」归因于本规模全量渲染的唯一根因；后台标签节流放大仍是更可能解释（见原 stress GAP-1）。
- 「无虚拟滚动」仍是规模风险（DOM 6k+＠223 行）；未测到 300+ 正式角色前台稳态（追加造数再次打挂 Lucy，记 GAP）。

## GAP

- 未达 fixtures 5× 角色地板（100）之上的稳定 300 角色前台复测（写路径稳定性）。
- 未跑完整 E1–E18 元素矩阵；未跑 2×／5× 联合 R。
- 筛选交互断言未收紧。
- 造数写风暴导致进程重启：环境干扰已记录，计时在 healthy 后执行。

## 备注

- 遵守 CONVENTIONS「WebUI：浏览器＋计时强制」：本选择器含前台浏览器＋计时，API 仅对照。
- ≠ 功能收口；≠ 完整 F58 PASS；≠ 可上线。

## 复核（2026-11-20 Kimi，不改变原判定）

复核方式：独立重放证据链，不改跑次判定。

| 主张 | 复核结果 |
|---|---|
| 规模 229 roles／82 agents | **确认**。当前容器实测 API roles=229／agents=82；access.yaml 含 `uat_racs_br_`×80＋`uat_racs_br2_`×140 fixture＋基线，与正文口径自洽 |
| API 基线 35–69 ms | **确认同量级**。独立 5 次采样：roles p50=33 ms／roster p50=34 ms／agents-full p50=38 ms（热态，均远优于 B 线 200 ms） |
| 前台 primaryReady 亚秒 | **可信**。方法学（SPA 点击→`performance.now()`→表行门槛）与 AGENTS.md「前台浏览器＋即时计时」一致；原始 JSON `browser-timing.json` 与正文逐值一致（95/42、36/33、26/32、DOM 6124/2707、visibilityState=visible） |
| 崩溃—重建叙事 | **自洽**。docker inspect：当前进程 StartedAt=03:00:53Z、OOMKilled=false、ExitCode=0——即"写风暴打挂旧进程→重建后计时"；br2_ 140 roles 有落盘、agents 未写（第二次 seed 在 role 阶段中断），与 GAP"追加造数再次打挂"一致 |
| 后台 15–29 s 归因修正 | **接受**。同候选、同量级、前台亚秒 vs 后台 15–29 s，rAF 暂停解释成立；本规模下"全量渲染为唯一根因"不成立。"无虚拟滚动仍是规模风险"的保留意见合理（DOM ≈27 nodes/row，外推 300 行 ≈8.2k nodes 未稳测） |

复核发现（不阻断本跑次判定，转交跟进）：

- **R-1**：跑次无清理节——fixture 220 个（`uat_racs_br_*`/`br2_*`）仍占共享 demo 卷，未按 fixtures §7 清理、也未声明"具名保留作 300+ 复测夹具"。需委托人决定：补保留声明或安排清理。
- **R-2**：两次 seed 中断（第一次致进程不可达→重建；第二次 role 阶段断、agents 未落盘）。对照 kimi stress 单会话串行 1,510 写 0 失败，写路径在高频连续写下存在不稳定信号；因 seed 客户端速率/并发未记录，暂不定性产品缺陷，建议完整 F58 runner 记录写速率并纳入报告分组。
- **R-3**：筛选输入 `uat_racs` 后 215 ms 仍见 220 行——可能为防抖窗口内采样，也可能过滤未生效；需一条带等待收敛的断言收口。
