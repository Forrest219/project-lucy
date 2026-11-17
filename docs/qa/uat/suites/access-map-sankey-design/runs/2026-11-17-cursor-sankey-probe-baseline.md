# Run — 2026-11-17 — cursor-sankey-probe-baseline

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ACCESS-MAP-SANKEY` |
| Agent | Cursor（Claude） |
| 性质 | **改前基线探查**。目标行为尚未开发，所以对 Spec v0.1 验收线判 FAIL 是预期结果，用来固定「改前」画面 |
| 环境 | 宿主隔离沙箱（关闭鉴权，不碰 demo 容器与 `lucy-demo-data`）。HEAD＝`65f40847`；旧码＝`git archive 6d2664b3`（线上 `/api/health` 的 `gitSha`）。前端均为各自源码的 `vite build` 产物 |
| 线上实例 | `http://10.69.95.109:8276`：`/api/health` 返回 `lucyVersion=0.25.0`、`gitSha=6d2664b3…`、`gitDirty=false`；页面要求登录，**未登录核对** |
| 总判定 | **FAIL**（必做 R0 PASS、01 PASS、02／04／05 FAIL；03 FAIL 仅对 D0＝C 成立；07 BLOCKED） |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-SANKEY-R0 | **PASS** | HEAD 五个 profile 的 `grantPaths`／`accessPaths`／`rawCalls`／`deniedCalls` 全部等于 [fixtures 期望值](../fixtures.md#profile-与期望值)：grants-only 188／0／0／0；sparse 188／4／55／0；rich 188／20／173／2；candidate-only 188／0／0／0；dense 524／146／1455／2 |
| UAT-SANKEY-01 | **PASS**（HEAD） | `rich`：流带 25、柱 28、零高柱 0、表节点 14；API 边状态 normal 23／dormant 132／overflow 1／needs_review 1；页面「进入允许调用 173」。图：[head-rich](evidence/2026-11-17-head-rich.png) |
| UAT-SANKEY-02 | **FAIL**（对 SC-B1） | `grants-only`：流带 **0**；14 个柱全为 3px；12 条骨干；**无表节点**（label：agent 6／role 4／conn 4）。图：[head-grants-only](evidence/2026-11-17-head-grants-only.png) |
| UAT-SANKEY-03 | **FAIL**（对 SC-B2–B6；仅 D0＝C 时计入） | `sparse`：4 条访问路径可读；无聚合节点、无幽灵带；其余 Agent 为发丝 stub；步骤 2 无对象可点。图：[head-sparse](evidence/2026-11-17-head-sparse.png) |
| UAT-SANKEY-04 | **FAIL**（对 SC-A5／A6） | `candidate-only`：播种 175 次，API `access` 只有 `state／trust／rawCalls／deniedCalls`，**无 `unconfirmedCalls`**；`trust=include_candidate` → **400**（守卫成立）。页面说明：API 状态与 `grants-only` 相同，沿用其「没有进入访问路径的允许调用…可调整筛选后再看」；本形态未单独截图 |
| UAT-SANKEY-05 | **FAIL**（对 SC-A2／A4） | `dense`：柱 77、**零高柱 76**（唯一 3px 为闲置 stub）、流带 75 条但不可见；Agent 列 42 个标签（> 25）；SVG 高 1350，容器 `overflow-y:auto` 但 `clientHeight=scrollHeight=1350`，无高度上限。图：[head-dense](evidence/2026-11-17-head-dense.png) |
| UAT-SANKEY-06 | **PASS** | 同一份 `rich`：旧码 `accessPaths=0`、`rawCalls=0`、`deniedCalls=175`、156 条边全 `dormant`，页面只有文字标签；HEAD 为 20／173／2。图：[old-6d2664b3-rich](evidence/2026-11-17-old-6d2664b3-rich.png) |
| UAT-SANKEY-07 | **BLOCKED** | 无线上凭据；线上实例未升级（`gitSha=6d2664b3`，不含 `f3f88837`、`e2ca2ca7`）。**SC-A1 在线上当前为不满足**，该结论只来自 health＋git 祖先关系，不来自页面 |

## 备注

- 是否使用 `docker restart`：**否**（未涉及容器）。
- 沙箱实现偏差：访问面需要 `outcome=ok`；旧码把 `ok` 记为拒绝是 F-1 本身，不是种子问题。
- 种子曾两次修正（不影响结论）：`access.yaml` 缺 `defaults.table_touching_tools`；语义层清单 `table:` 须写成 `schema.table` 才能与 `enabled_tables` 求交。两处均已写进种子模块。
- 线上页面渲染、线上活跃 Agent 数、线上 `association_status` 分布均未取得；F3／F5 在线上的触发程度待 SANKEY-07。
- 清理：沙箱落在 `/tmp/lucy-sankey/`，进程在测后按端口 PID 结束，未留 demo 侧状态。
