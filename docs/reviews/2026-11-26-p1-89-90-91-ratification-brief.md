# P1-89／P1-90／P1-91 开放裁定项拍板与终稿确权材料

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-89／P1-90／P1-91 开放裁定项拍板与终稿确权材料 |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-26 |
| 撰写人 | Cursor Auto |
| 委托人 | xingchen |
| 基于材料 | P1-89／P1-90／P1-91 Spec／Plan v0.2-draft；跨 Spec MECE 边界（2026-11-25）；委托人 2026-11-26 明示「对剩余开放裁定项逐项拍板，完成终稿确权（S1 → S2）」；P1-88 定稿先例 |
| 适用范围 | 记录三份 Spec 开放项裁定结论，并作为委托人明示终稿确权的同批材料；**≠ 开发授权**；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 输出位置 | `docs/reviews/2026-11-26-p1-89-90-91-ratification-brief.md` |

## 0. 性质与结论

- 性质：委托人明示授权下的终稿确权材料（无 Codex CLI 复审；额度恢复后可补审，若有阻断按版本升级处理）。
- **结论：三份 Spec 一并升 v1.0、阶段 S2**；开放裁定项全部闭合；开发未授权；测试台仍 `not_registered`（确权后另立套件）。
- 落地序不变：**P1-89 → P1-90 → P1-91**。
- P1-91 原 Plan「Task 0 前置于确权」：本轮按委托人「完成 S1→S2」明示，**设计冻结方案 A**，Task 0 实证改挂 **开发授权（S3）前置**；若实证推翻方案 A，升版改判后再授权，不带病改运行代码。

## 1. P1-89／REQ-030-110 裁定

| ID | 问题 | 裁定 |
|---|---|---|
| D1–D2／D4–D8 | 功能需求提案 | **全部冻结为 Spec §2.1 原文**（含 D8 统一信封） |
| **D3** | D3a 表级 `descriptions` 豁免 vs D3b 维持全丢弃 | **D3a**：业务 source 导入同时含表级 `descriptions` 时合并入 Manifest；`columns`／`joins` 仍按 P0 丢弃并告警 |
| OQ-1 | GET `?format=manifest` 是否 D2 式报错 | **仅文档注明未消费**；不报错（GET 幂等只读） |
| OQ-2 | `validate→publish` 单表描述示例 | **随 D6 交叉引用关闭**；不新增接口 |

## 2. P1-90／REQ-030-111 裁定

| ID | 问题 | 裁定 |
|---|---|---|
| OQ-1 | 新建 create-only 端点 vs 扩展 import upsert | **新建** `POST /api/schema-manifests/:conn/:schema/tables`（create-only）；import 保持 update-only |
| OQ-2 | 是否同批 WebUI「新增表」入口 | **不在本条**；涉导航 IA，另案独立确认 |
| OQ-3 | 物理表名末尾段与 `body.table` 是否大小写不敏感 | **大小写不敏感匹配**（兼容 SQL Server）；正文原「待 OQ-4」笔误并入本条 |

## 3. P1-91／REQ-030-112 裁定

| ID | 问题 | 裁定 |
|---|---|---|
| OQ-1 | 三段名 standalone 运行时实证 | **设计冻结方案 A**；Task 0 实证＝**开发授权前置**（推翻则升版改判，不带病进 S3） |
| OQ-2 | 存量冲突盘点是否另附启动日志／CLI | **以 `GET /api/semantic-assets/overlays` 为主**；启动日志／CLI／自动处置另案 |
| OQ-3 | `lucy_explain_query` 冲突可见性 | **另案**；本条不触碰 `webui/server/proxy/**` |
| OQ-4 | D1 方案 A／B／C | **方案 A**：overlay `table:` 放开两段或三段；共享 `parseTableRef` 不动；D2 护栏兜底 |
| OQ-5 | 冲突信号级别、确认参数名、batch 作用面 | validate：**warnings** 报告冲突（不因该冲突单独置 `valid:false`）；确认参数名 **`allowManifestShadow`**；护栏硬阻断仅非 batch zip；**batch 不阻断**，validate 仍报 warnings |
| OQ-6 | 删除端点形态／snapshot TTL／客户 payload | **`DELETE /api/semantic-assets/overlay/:conn/:sourceName`**；snapshot 沿用既有 opportunistic prune；客户 `confirmOverwrite` 原始 payload 随验证阶段取证闭环 |

## 4. 同批改动清单（已执行）

1. 三份 Spec → v1.0、阶段 S2；开放项表改为「裁定结论」；Changelog 记终稿确权。
2. 三份 Plan → v1.0；状态镜像 S2；P1-91 Task 0／完成定义改挂开发授权前置。
3. 镜像：`docs/backlog/README.md`、`docs/README.md`、`docs/plans/README.md`、`docs/governance/e2e-ledger.md`。
4. 本材料落盘。

## 5. 确权之后仍然有效的限制

- **开发未授权。** 改 `webui/server/`／`webui/src/` 运行代码须另发开发授权。
- 测试台套件尚未立；`e2e-ledger` 仍 `not_registered`／NOT RUN。
- **≠ 功能合同收口；≠ UAT PASS；≠ 可上线。**
- P1-91 Task 0 未完成前，不得对 P1-91 发开发授权。
