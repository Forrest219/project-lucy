# Run — 2026-11-20 — kimi-batch3-page-dom-scale（T2 冒烟 + 风险矩阵汇总）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-PAGE-DOM-SCALE` |
| 选择器 | UAT-PDS-07（T2 冒烟）＋套件汇总判定 |
| Agent | Kimi Code |
| 环境 | 同 Batch 1/2 |
| 原始 JSON | `inbox/uat-pds-batch1-2026-11-20/t2-smoke-timing.json` |
| 总判定 | **套件当前总判定：PASS WITH GAP**（T1 六页 4 页 PASS、2 页 BLOCKED；T2 冒烟全过线；1 项观察）；≠ 各页功能合同验收；≠ 可上线 |

## T2 冒烟（每页 colder + 1×SPA；不造数）

| 页面 | colder | SPA | DOM | longtask |
|---|---:|---:|---:|---:|
| /connections 连接概览 | 141 ms | 145 ms | 569 | 0 |
| /wiki 业务 Wiki | 31 ms | 21 ms | 387 | 0 |
| /skills 业务 Skill | 41 ms | 21 ms | 533 | 0 |
| /admin/accounts | 31 ms | 26 ms | 359 | 0 |
| /admin/config-audit | 25 ms | 34 ms | 615 | 0 |
| /admin/usage 使用概况 | 145 ms | 134 ms | 608 | 0 |
| /publish/workbench | 26 ms | 29 ms | 1447 | 0 |
| /eval/cases | 26 ms | 15 ms | 473 | 0 |

**观察 R-5**：consoleErrors=3，均为 `Failed to load resource: 404`（探针未按页归因/未捕获 URL）。全部页面计时正常，疑似非关键静态资源（如 favicon）或某页次要请求；需带 URL 捕获的跟进断言定性，暂记观察不判 FAIL。

## 风险矩阵汇总（T1 六页）

| 页面 | 数据规模实测 | DOM 形态 | primaryReady | 判定 | 建议 |
|---|---|---|---|---|---|
| /admin/roles | 463 行（RACS 套件） | 全量 ~26.6 nodes/行 线性 | SPA 161–184 ms | PASS（另有结论） | 1,000 行看守复测 |
| /admin/agents | 172 行 | 全量 | SPA 82–104 ms | PASS（另有结论） | 同上 |
| /admin/tokens | 213 tokens（×16） | 全量 ~32 nodes/行 | 平稳 ~150 ms | PASS | 1,000 tokens 看守（外推 DOM ~33k） |
| /ops/calls | 345 audit 行 | **分页有界（9 行/页）** | 平稳 ~155 ms | PASS | 无需虚拟滚动（F-1） |
| /publish/history | 0（BLOCKED） | 未知 | 空态 12–50 ms | **BLOCKED** | 专用夹具项目复测 |
| /eval/runs | 0（BLOCKED） | 未知 | 空态 13–38 ms | **BLOCKED** | 补 runner CLI 环境后复测 |
| /connections/enabled-tables | 203 启用表 | **页面上限 52 行** | SPA 151–171 ms | PASS | 无需（F-1 同类） |
| /admin/access-map | 345 audit＋203 表 | **聚合有界** | 33–42 ms | PASS | 无需 |

## 发现登记

- **F-1（良性）**：调用流水、启用表范围两页**分页/上限生效**，数据 ×16–×86 下 DOM 平稳——WebUI 列表页多数已有有界渲染，"全量渲染"风险集中于 roles/agents/tokens 三个治理页（且实测线性温和）。
- **F-2**：tokens 页 ~32 nodes/行外推——1,000 tokens ≈ DOM 33k 时建议看守复测。
- **F-3（环境机制）**：语义层内容三副本（`config/` 内容根为权威、`semantic-layer/` 为源、`runtime/` 为启动镜像），scanned catalog 校验读内容根；运维文档建议显式化（本次逐层试错定位，已备份还原）。
- **R-5**：T2 冒烟 3×404 资源错误未归因，跟进断言定性。

## 回答委托问题：扩展到其它页面，是否对 WebUI 有影响？

**当前规模下没有**。六页 T1 全部远低于参照线（最慢 171 ms vs 1000 ms），无 longtask 失控、无控制台错误（除 R-5 待查）；两个无界数据页（调用流水/启用表）靠分页天然有界；三个全量渲染页线性温和且有明确看守阈值。剩余风险集中在两个 BLOCKED 页（发布记录/评测历史未测规模）与 R-5 观察。

## GAP

- PDS-03／PDS-04 BLOCKED（见 Batch 1/2）；R-5 未归因 404；tokens 1,000+ 未实测（外推）。
- 本套件未测页面交互深度（筛选/翻页/详情抽屉），仅首屏就绪；如后续某页 FAIL-OBSERVE 再补交互级探针。
