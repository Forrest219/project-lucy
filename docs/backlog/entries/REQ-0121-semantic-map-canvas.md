# REQ-0121：语义地图（只读 Canvas）— 多连接／多 Schema／近三千表的表级语义宏观定位

| 元数据 | 内容 |
|---|---|
| 文档类型 | 常青需求池单条正文（一需一档）。**不是**功能 Spec，**不构成**开发授权 |
| 稳定 ID | `REQ-0121` |
| 类型 | `需求`（治理方体验／语义层可视化） |
| 优先级 | `P1` |
| 阶段 | `S2`（Spec v1.0 终稿已确权；**开发未授权**） |
| 目标版本 | `—`（可调；尚未强制挂发版列车） |
| 授权边界 | **终稿确权 ≠ 开发授权**。未获委托人另发开发授权前禁止改运行代码。正式挂导航另须 **IA 独立确认** |

## 来源与背景

- 提出日期／来源：2026-11-27／委托人（xingchen）；受 Cursor Canvas 启发；明确不做重度知识图谱，YAML 为权威。
- 规模：约 10 连接、多 Schema、合计约 2600～3500 表；需按 Schema／库宏观定位。
- 设计 v1.2 经 Claude Code 三轮对抗 ACCEPT WITH GAPS；委托人 2026-11-27 授权 Spec 定稿。

## 期望方向（非实现承诺）

- 独立只读语义地图：连接 → Schema 岛 → formal-join 连通团＋孤立区 → 表侧栏 → 钻取工作台。
- Manifest∪overlay formal 并集边；筛选／降级／节点预算；无写盘。

## 非目标与边界

- 不做 KG、画布编辑、与访问关系图合并；不依赖 REQ-0118 入库完成。
- 入池／定稿不授权改运行代码。

## 关联

- 设计稿：[docs/design/design-2026-11-27-semantic-map-canvas.md](../../design/design-2026-11-27-semantic-map-canvas.md)（v1.2）
- Spec：[docs/specs/lucy-20261127-semantic-map-canvas-spec.md](../../specs/lucy-20261127-semantic-map-canvas-spec.md)
- Plan：[docs/plans/lucy-20261127-semantic-map-canvas-plan.md](../../plans/lucy-20261127-semantic-map-canvas-plan.md)
- UAT：[docs/qa/uat/suites/semantic-map/suite.md](../../qa/uat/suites/semantic-map/suite.md)
- 设计对抗：[docs/reviews/2026-11-27-semantic-map-canvas-adversarial-review.md](../../reviews/2026-11-27-semantic-map-canvas-adversarial-review.md)
- Plan／UAT 对抗：[docs/reviews/2026-11-27-semantic-map-plan-uat-adversarial-review.md](../../reviews/2026-11-27-semantic-map-plan-uat-adversarial-review.md)
- 相邻：REQ-0116 · REQ-0118
- 常青需求池：[docs/backlog/README.md](../README.md)
