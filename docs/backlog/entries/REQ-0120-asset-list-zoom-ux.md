# REQ-0120：资产列表 Zoom 交互（连接／启用表／Catalog／角色·Agent）

| 元数据 | 内容 |
|---|---|
| 文档类型 | 常青需求池单条正文（一需一档）。**不是**功能 Spec，**不构成**开发授权 |
| 稳定 ID | `REQ-0120` |
| 类型 | `需求`（WebUI 治理体验） |
| 优先级 | `P1` |
| 阶段 | `S2`（Spec v1.0 终稿已确权；Plan／UAT 已登记；未获开发授权） |
| 目标版本 | `v0.35.0`（可调） |
| 授权边界 | **入池 ≠ 立项 ≠ 终稿确权 ≠ 开发授权**。进入开发前须：对抗评审闭合 → 终稿确权 → 配对 Plan → 委托人另发开发授权 |

## 来源与背景

- 提出日期／来源：2026-11-27／委托人（xingchen）。
- 问题：连接、启用表、授权表等页默认把 Schema／表清单摊开，长清单既拖慢体感也让治理方不知所措；不符合企业级 zoom 心智。浏览器 Ctrl+F 不是系统能力。
- 裁定：对象定深度；启用表与 Catalog 同家族（单 Schema 组 + 默认 5 表 + 显示更多）；角色／Agent 另家族（约 50 行／页分页）；搜索优先于滚动。

## 期望方向（非实现承诺）

- 管连接页默认到 Schema 摘要；管表页直接到表但有界曝光。
- 系统内搜索为长清单主定位路径。
- 不改 ACL／启用表后端语义；不改访问关系图 Sankey 主契约。

## 非目标与边界

- 本轮落 Spec + 对抗评审；未授权改运行代码。
- 不以虚拟滚动代替有界曝光与搜索。

## 关联

- Spec：[docs/specs/lucy-20261127-asset-list-zoom-ux-spec.md](../../specs/lucy-20261127-asset-list-zoom-ux-spec.md)（v1.0 终稿已确权）
- Plan：[docs/plans/lucy-20261127-asset-list-zoom-ux-plan.md](../../plans/lucy-20261127-asset-list-zoom-ux-plan.md)
- UAT：[docs/qa/uat/suites/asset-list-zoom/suite.md](../../qa/uat/suites/asset-list-zoom/suite.md) · INDEX `UAT-SUITE-ASSET-LIST-ZOOM`
- 评审：[Spec 过程对抗](../../reviews/2026-11-27-asset-list-zoom-ux-adversarial-review.md) · [Plan／UAT 对抗](../../reviews/2026-11-27-asset-list-zoom-plan-uat-adversarial-review.md)
- 常青需求池：[docs/backlog/README.md](../README.md)
