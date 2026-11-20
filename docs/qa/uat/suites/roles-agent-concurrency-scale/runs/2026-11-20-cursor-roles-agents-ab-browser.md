# Run — 2026-11-20 — cursor-roles-agents-ab-browser

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE` |
| 选择器 | **F58-browser-timing A/B**（同样本规模；前台浏览器＋API 分列） |
| Agent | Cursor |
| A | 本机 demo `http://127.0.0.1:55176`；候选 `gitSha=1fb73f72…`／`gitDirty=true`（含 P1-58／59） |
| B | 远程测环 `http://124.222.172.229:5174`；候选 `gitSha=6208ea57…`／`gitDirty=false`（自称与生产一致版本） |
| 样本 | 目标对齐：**223 roles／82 agents**（B 实测 API 223／82；UI Roles 表行 217 正式口径） |
| 视口 | 两侧 1920×1080；前台 `visibilityState=visible` |
| 原始 | `inbox/uat-racs-ab-2026-11-20/ab-browser-timing.json`；B 造数／清理摘要同目录 |
| 总判定 | **A/B 对照完成（PASS WITH GAP）** — 同规模下 B 的列表 API 显著慢于 A；页面 SPA 热路径两侧均亚秒；≠ 完整 F58；≠ 可上线 |

## 版本差（必须披露）

| | A 本机 | B 远程测环 |
|---|---|---|
| gitSha | `1fb73f72…` dirty | `6208ea57…` clean |
| 相对 | 含 F58 smoke／browser 后提交 | 早于 A；`/agents/statistics` **404** |
| 含义 | 非同比特构建；AB 比较的是「同规模用户路径」，**不能**归因单点 commit |

## 样本构造

- A：既有本地夹具（见 [browser-timing](2026-11-20-cursor-roles-agents-browser-timing.md)）。
- B：真实 API 造数 `uat_racs_ab_20261120031821`（连接 `mysql-aliyun`／`dataforai.superstore_*`）；测后 **cleanup leftover=0**，恢复 10 roles／2 agents。

## API 对照（同规模，分列）

| 路径 | A ms | B ms | B/A |
|---|---:|---:|---:|
| GET `/api/admin/roles`（n≈223） | **69** | **2103** | ~30× |
| GET `/api/admin/agents?view=roster`（n=82） | **51** | **526** | ~10× |
| GET `/api/admin/agents?range=7d` | **41** | **2403** | ~59× |
| GET `/api/admin/agents/statistics?range=7d` | **35** | **404** | B 无此路由（版本差） |

## 前台 SPA primaryReady（点击→表行门槛）

定义：侧栏进入；Roles 等 `role-list-table` ≥100 行；Agents 等 `agent-list-table` ≥50 行。

| 轮次 | A Roles | B Roles | A Agents | B Agents |
|---:|---:|---:|---:|---:|
| 1（自 overview） | 95 ms | **653 ms** | 42 ms | 28 ms |
| 2 | 36 ms | 37 ms | 33 ms | 26 ms |
| 3 | 26 ms | 33 ms | 32 ms | 26 ms |

补充：A 更冷一轮 Roles **189 ms**（1× longtask 75 ms，DOM~6.1k）；B Roles round1 longtask 71 ms，DOM~6.0k。

说明：B Agents 热轮 primaryReady≪同窗 API 耗时 → **客户端缓存／保留表** 可能提前满足行数门槛；冷 API 仍以表格「API 对照」为准。Roles round1 更能反映跨页进入成本。

## 结论（A/B）

1. **同样本下 B 后端读路径明显更慢**（roles API ~30×，agents full ~59×）——压力差首先在服务端／网络／数据距离，不是「有无虚拟滚动」单点能解释的数量级。
2. **两侧前台热 SPA 进入名册均为亚秒**，均优于 fixtures B≤1000 ms；B 首轮 Roles 653 ms 仍过 B 线，但差于 A。
3. **无虚拟滚动**在两侧仍成立（全量 `map`／DOM~6k＠~220 行）；本 AB **未**复现 15–29 s 前台；该量级仍更像后台节流／其他环境因素。
4. 版本不对齐（statistics 缺失）→ 不得把 B 的慢 API 直接写成「P1-58 未合入的唯一因果」，但可作生产同款构建的规模体感证据。

## GAP

- A／B 非同一 gitSha；无改前改后同构对照。
- B Agents 热路径可能偏缓存；缺强制硬刷新（禁用缓存）轮。
- 未跑完整 E1–E18／2×／5×／R。

## 备注

- 遵守 WebUI 浏览器＋计时强制；凭据不入库。
- 远程夹具已清理；未对生产域名施压（本地址为用户指定测环）。
