# 答复可核对性 实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | v0.2-draft / 2026-11-07 |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。；不执行任何实现 Task |
| 授权边界 | **不授权改代码**。须清单池 §2.2 R1–R4 |
| 验收 | Spec SC 有证据；lint:spec-docs 0。**不表示可上线** |
| 目标分支 / 产品线 | `lucy-v0.30` / `0.30.0` |
| Spec | [lucy-20261107-answer-verifiability-spec.md](../specs/lucy-20261107-answer-verifiability-spec.md) |
| 需求来源 | P0-4；REQ-030-022 |
| 落位依据 | DEVELOPMENT.md |

## 1. 目标

把 provenance／截止期披露从 `_meta` 提升为强制可见可核对块。

## 2. 开工前置

Spec 评审；O1／O2；开发授权；与 018 落点策略对齐。

## 3. 文件结构

| 文件 | 动作 |
|---|---|
| `webui/server/proxy/mcp-proxy.ts` | 装配可核对块（三落点同生同灭，见 Spec D2） |
| `webui/server/proxy/audit-privacy.ts` | **去值来源**：filter 级 `summarizeFilters`（`:171`）——⚠️ 当前**未导出**，本条须导出；已导出的 `summarizeArgsForAudit`（`:187`）是 **args 级**、口径不同，不能直接顶替 |
| `webui/config/data-qa-instructions.md` | 修订隐藏条款 |
| 测试 | 新建 |

## 4. 任务分解

S0 决策 → S1 纯函数构造块 → S2 装配可见落点 → S3 instructions → S4 测试回写

## 5. 验收

SC 证据齐全；不表示可上线。

## 6. 完成定义

可核对块强制可见可测。

## 7. 风险

eval JSON；伪造 freshness。
