# UAT-SUITE-PAGE-DOM-SCALE — WebUI 页面 DOM/渲染规模横向评估

| 元数据 | 内容 |
|---|---|
| Suite ID | UAT-SUITE-PAGE-DOM-SCALE |
| 文档版本 | v1.0；2026-11-20 委托人批准执行（[评估计划](../../../../plans/lucy-20261120-page-dom-scale-assessment-plan.md)，审批点 A/B/C/D 全按推荐） |
| 总账 | 横向评估；方法学回链 P1-58／P1-59（`UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE` 三档验证）；各页结果回链对应功能套件 |
| 目标 | 回答：WebUI 各列表/图谱页面在用户数据规模增长下是否存在 DOM/渲染性能风险；产出逐页风险矩阵与整改建议 |
| 环境 | 本机 demo Docker（共享栈，非隔离卷；造数前缀 `uat_pds_<batch>_`，逐批清理 verify）；系统 Chrome headed 前台 1920×1080 |
| 当前执行状态 | **PASS WITH GAP（三批跑完）**：T1 六页 4 PASS／2 BLOCKED（发布记录、评测历史=环境缺口），T2 冒烟全过线；发现 F-1 分页良性／F-2 tokens 看守阈值／F-3 语义层三副本／R-5 待归因 404。回答：当前规模对 WebUI 无影响。最近：[batch3 汇总](runs/2026-11-20-kimi-batch3-page-dom-scale.md)、[batch2](runs/2026-11-20-kimi-batch2-page-dom-scale.md)、[batch1](runs/2026-11-20-kimi-batch1-page-dom-scale.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md)（参照线、造数与清理规则唯一真源） |
| runs | [runs/](runs/) |
| 最近定向跑次 | [2026-11-22 kscc 5,000／10,000 条审计复测](runs/2026-11-22-kscc-token-audit-5k-10k.md) · [前次审计对照](runs/2026-11-22-kscc-token-audit-history.md) · [凭据规模复测](runs/2026-11-22-codex-token-foreground-retest.md)，判定见 [INDEX](../../INDEX.md) |

## 边界与判定

- 遵守 [CONVENTIONS](../../CONVENTIONS.md)：全真；前台浏览器＋即时计时与 API 耗时分列（AGENTS.md 浏览器测试约束）；禁止只验后端 HTTP 却主张页面通过。
- **不在本套件出口**：页面功能正确性（各功能套件负责）；roles/agents 页（已收口结论，见 RACS 套件）；移动窄屏；后端 API 压力。
- **预算参照（观测口径，不新立合同）**：primaryReady 参照 [fixtures §1](fixtures.md#1-参照线观测口径不新立合同) 的 ≤1000 ms；longtask>200 ms 记观察；consoleErrors>0 记观察。超线页面判 FAIL 观察并建议立项；阈值变更须具名评审。
- 每页结果回链对应功能套件（audit→trace-ledger、catalog→catalog-scan、eval→eval 套件、access-map→sankey 套件），本套件只做横向规模风险，不重复功能合同验收。

## 方法

1. 泛化探针 `scripts/uat/page-dom-probe.mjs`（页面清单参数化：导航 href／就绪表达式／行数门槛；协议同 RACS 三档：侧栏 SPA 点击 → 就绪 → `performance.now()` 差；longtask 点击前布防；逐轮断言 visibilityState=visible）。
2. 每页流程：基线测量（现状数据）→ 真实造数 → 加压测量 → 清理 → verify 还原。
3. 判定：参照线 + longtask/consoleErrors 观察 + 线性外推；输出每页"基线→加压→外推→判定→建议"。
4. 交叉复测 Token 凭据页时，执行 [UAT-PDS-01](cases.md#uat-pds-01--token-凭据页admintokens) 完整剧本，参照 [WebUI 性能复测指南](../../webui-performance-retest.md) 交付证据。DOM 探针可辅助采样。
