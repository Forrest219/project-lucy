# Lucy 0.30 — WebUI 全页面 DOM/渲染规模风险评估 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 测试执行计划 / v0.1-draft（**待委托人审批；审批前不执行**） |
| 日期 | 2026-11-20 |
| 关联 | `UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE` 已验证方法（roles/agents 三档：stress 463 行前台 p95=184 ms、DOM ~26.6 nodes/行线性）；复核发现 R-1/R-2/R-3 |
| 产出归属 | 测试台证据；不改运行代码；不新立性能合同 |

## 1. 目标与问题

已验证角色/Agent 页在 463 行规模 DOM 12.3k 前台 primaryReady p95=184 ms（余量 5×）。**未知**：WebUI 其余页面在用户数据增长下是否存在同类或更严重的 DOM/渲染风险（部分页面数据无界增长：调用流水、发布记录、评测历史、Token 清单）。本计划将同一方法横向扩展，产出**逐页风险矩阵**，回答"是否对 WebUI 有影响"。

## 2. 范围

**在内**：所有用户可达的列表/表格/图谱类页面（DOM 风险载体）的前台计时 + DOM 规模 + longtask + 控制台错误 + API 基线（分列）。

**不在内**：页面功能正确性（既有套件负责）；roles/agents 页（已有结论，不重复）；移动窄屏（AGENTS.md 默认不做）；后端 API 压力测试（已覆盖）。

**预算参照线（观测用）**：沿用 fixtures §5 的 B≤1000 ms primaryReady 参照线 + longtask>200 ms 记观察 + consoleErrors=0。**不新立合同**；某页超线记 FAIL 观察并建议立项，阈值变更须具名评审（沿用 RPB 先例）。

## 3. 页面分级（按数据增长性 × 用户影响面）

| 层级 | 页面 | 风险来源 | 数据策略 |
|---|---|---|---|
| T1 | /admin/tokens（Token 凭据） | 随 agent/token 签发线性增长 | 现成 82 agents；再按需签发 |
| T1 | 调用监控/调用流水（/admin/audit） | 调用流水**无界增长**（P1-36 关联） | demo 既有真实审计行；无 API 造数 → 观测现状，不够则 BLOCKED 不 mock |
| T1 | 发布记录（/publish/history） | 随发布次数增长 | 真实发布动作造数（走现有发布流程） |
| T1 | 评测运行历史（/eval/runs） | 随评测执行增长 | demo 既有数据；必要时真实跑评测造数 |
| T1 | 启用表范围（连接表级 whitelist） | 随来源表数增长（263+ 表先例） | 复用 catalog-scan/large-schema 既有夹具优先 |
| T1 | 访问关系图（/admin/access-map） | sankey/canvas 渲染，DOM 风险形态不同 | 现有 demo 数据 + 可选造 agent 引用 |
| T2 | 连接概览、语义资产、业务 Wiki、业务 Skill、AdminAccounts、ConfigAudit、GovernanceOverview、使用概况 | 中低增长 | 现状数据测量，不造数 |
| T3 | 其余页面（McpPlayground、VersionInfo 等） | 固定开销 | 仅冒烟计时（一轮 primaryReady） |

## 4. 方法

1. **泛化探针**：`scripts/uat/racs-browser-dom-probe.mjs` → `scripts/uat/page-dom-probe.mjs`。页面配置化（URL／导航选择器／行选择器／行数门槛／造数命令指针），核心协议不变：系统 Chrome headed 前台 1920×1080、SPA 侧栏点击、`performance.now()` 差、longtask 点击前布防、逐轮断言 visibilityState=visible、API 与页面耗时分列。
2. **每页流程**：基线测量（现状数据）→ 加压测量（造数后，若适用）→ 清理 → 跑次文件记录前后对照。
3. **造数纪律**：真实 API／真实动作，禁 mock；单会话串行、写间隔 ≥500 ms（R-2 教训）；health 每 30 s 探测，进程异常即停表并记观察；严格 `uat_pds_<date>_` 前缀，逐页清理并 verify 还原（fixtures §7）。
4. **判定**：primaryReady 参照 B≤1000 ms（标注观测口径）；longtask>200 ms 与 consoleErrors>0 记观察；输出每页"基线→加压→线性外推→判定→建议"。

## 5. 套件登记（审批点 A）

建议新建 **`UAT-SUITE-PAGE-DOM-SCALE`**（横向探针套件）：本评估跨页面、不属任何单一功能合同；各页结果在跑次中回链对应功能套件（如 access-map 回链 `UAT-SUITE-ACCESS-MAP-SANKEY`、audit 回链 `UAT-SUITE-TRACE-LEDGER`）。备选：不建套件、跑次分散挂各页既有套件（勾连碎、横向对照难）。

## 6. 批次与工作量

| 批次 | 内容 | 预估 |
|---|---|---|
| Batch 1 | T1 前 3 页（tokens／audit／publish-history）：泛化探针开发 + 三页前后对照 | 半天 |
| Batch 2 | T1 后 3 页（eval-runs／whitelist／access-map） | 半天 |
| Batch 3 | T2 全页冒烟 + T3 + 风险矩阵汇总 + 台账登记 | 半天 |

## 7. 风险与边界

- **写路径稳定性（R-2）**：单会话限速已在本轮 330 写验证未复现中断；仍按"崩溃即停表"处理，不强行续跑。
- **共享 demo 卷**：逐页清理 + verify；遗留 fixture（`uat_racs_br_*`/`br2_*` 220 个，复核 R-1）建议本计划首批顺手清理或转为具名保留，审批点 D。
- **audit 无造数 API**：只观测现状规模，主张受"现值非上限"限制，报告如实标注。
- **headless 替代**：仅当 headed 在用户环境不可用时降级，且跑次标注（本轮 headed 已验证可行）。

## 8. 交付物

1. `scripts/uat/page-dom-probe.mjs`（可复用，参数化页面清单）
2. `docs/qa/uat/suites/page-dom-scale/runs/2026-11-2X-kimi-batch{1,2,3}.md` + 风险矩阵汇总
3. 套件目录（suite/cases/fixtures，若审批点 A 选新建）
4. INDEX／e2e-ledger 镜像 + lint 通过

## 9. 审批点

- **A 套件形态**：新建 `UAT-SUITE-PAGE-DOM-SCALE`（推荐） vs 散挂既有套件
- **B 范围**：T1 六页（推荐） vs T1+T2 一次做全 vs 仅 T1 前三页
- **C 造数授权**：允许在 demo 为 publish/eval/whitelist 造数（真实流程）vs 仅观测现状
- **D 遗留 fixture**：顺手清理 `uat_racs_br_*`/`br2_*` vs 转具名保留
