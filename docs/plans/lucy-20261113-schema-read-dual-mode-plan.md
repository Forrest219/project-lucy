# Schema 读法双模式（恢复 EE54 结构 diff）Implementation Plan

| 元数据 | 内容 |
|---|---|
| 状态 | **已实现（待提交）** |
| 决策 | 方案 A（2026-11-13 批准） |
| 背景 | `f6f2ee54` 结构 diff 按表隔离被 `175c5945` catalog-scan Schema 宽读法冲掉 |
| 范围 | 恢复 Spec 190 深查合同；不破坏 catalog-scan 全量 Schema 宽合同；**不**做前端 fan-out 上收（方案 C） |
| 功能编号 | 无（恢复既有 Spec 合同；不入 0.30 产品分母） |

## Goal

`readSchemaColumns` 按显式模式拆开：

| mode | 用途 | 读法 |
|---|---|---|
| `list-names` | 准备表结构·列名 | 现有表名查询（不变） |
| `schema-wide` | catalog-scan SC-06/07 全量字段 | 一条 `information_schema.columns`，10000 fail-closed |
| `per-table` | Spec 190 结构 diff；单表 preview | 有界逐表；`missing`/`permission`/…；成功表保留 |

## File map

| 文件 | 改动 |
|---|---|
| `webui/server/schema-structure.ts` | 恢复 EE54 MySQL 逐表助手；`mode` 判别联合；分支实现 |
| `webui/server/admin/live-discovery.ts` | structure-diff → `mode: "per-table"` |
| `webui/server/index.ts` / `previewSchemaStructure` | 无 tables → `list-names`；有 tables → `per-table` |
| `webui/server/__tests__/table-diff.test.ts` | mock 对齐 per-table；补 missing→`not_in_library` |
| `webui/server/__tests__/schema-structure.test.ts` | SC-06/07 改锚 `mode: "schema-wide"`；单表改断言 per-table |
| `docs/specs/lucy-20261111-catalog-scan-read-path-spec.md` | v0.4：SC-06/07 只约束 schema-wide；不覆盖 Spec 190 |

## Tasks

1. RED：修正/补齐 table-diff 与 schema-structure 测试（表达双模式合同）
2. GREEN：实现双模式 + 接线调用方
3. 文档：Spec changelog + 与 Spec 190 边界句
4. 验证：相关 vitest 全绿

## Out of scope

- 前端 `readCheckedTableColumns` fan-out（方案 C）
- `lucy-ci.yml` 加 `lucy-v0.30`（另开流程项）
- 外部目录 DESC 网关超时
- 执行层 settle/503（已绿，不碰）
