# Admin Config Audit Unified Write Scope Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Config Audit Unified Write Scope Spec |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `/admin/config-audit` 能力评估；`webui/server/fs-safe.ts`；`webui/server/admin/audit.ts`；`governance-observability.ts`；`release-readiness-package.ts`；交叉审阅阻塞意见 |
| 适用范围 | 将 WebUI 治理资产写入纳入可信审计，明确审计触发边界、幂等约束与一致性策略 |
| 输出位置 | `webui/docs/90-admin-config-audit-unified-scope-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 90 |
| 关联工单 | `webui/docs/plans/wo-202608-23-admin-config-audit-unified-scope.md` |
| 关联页面 | `/admin/config-audit` |
| 状态 | Draft |
| 日期 | 2026-08-05 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.1 | 响应阻塞审阅：收窄 safeWrite 触发边界；新增幂等唯一键；补一致性语义；新增 actor_type/source；补端到端对齐与验收证据矩阵 |
| v1.0 | 初稿：定义一视同仁的 WebUI 写审计范围与落地方案 |

## 1. 背景与问题定义

本机部署下 `actor=local-admin` 可接受，但当前配置审计存在可信性缺口：

1. 审计触发边界过宽，容易把工程中间态写入当成治理审计事件。
2. 无数据库层幂等约束，请求重试可能重复入库。
3. 落盘与审计为独立步骤，缺少一致性语义和故障补偿口径。
4. `asset_kind` / `operation` 仅在 spec 层提出，尚未形成 API → 类型 → UI → 导出的闭环定义。

本 Spec 目标是把“审计范围扩大”升级为“可运营、可校验、可复核”的可信审计契约。

## 2. 目标

1. **范围一视同仁但有边界**：只审计“治理语义上的资产变更”，不把运行中间态写入噪音化入审计主视图。
2. **强幂等**：同一幂等键的重试写入只产生一条有效审计记录。
3. **一致性可解释**：定义落盘与审计的状态机，避免“看起来成功但不可追溯”。
4. **端到端一致**：`asset_kind`、`operation`、`actor_type`、`source` 在 DB/API/Type/UI/CSV 全链路透传。
5. **可验真**：每类资产提供最小“触发-查询-导出”证据用例。

## 3. 非目标

- 不覆盖 git / CLI / Agent 直改文件。
- 不实现 SSO 身份映射（`actor` 仍可为 `local-admin`）。
- 不替代 Spec 62 的 append-only 证据链设计。

## 4. 术语与字段

| 字段 | 说明 |
|---|---|
| `actor` | 操作者标识；当前可为 `local-admin` |
| `actor_type` | `ui_admin` \| `batch_job` \| `system` |
| `source` | 来源组件，如 `admin_agents_api`、`wiki_api`、`publish_workbench` |
| `asset_kind` | `governance` \| `semantic` \| `wiki` \| `eval` \| `publish` |
| `operation` | 领域动作，如 `edit_save`、`restore`、`publish` |
| `idempotency_key` | 幂等键，见 §6.2 |
| `write_status` | `pending` \| `committed` \| `failed` |

> `actor` 与 `actor_type/source` 并行存在：前者保留本机占位兼容性，后者用于“人工/脚本/系统”复核区分。

## 5. 审计触发边界（阻塞修订）

### 5.1 双通道模型

不再使用“凡经 `fs-safe` 写入都审计”的口径，改为双通道：

1. **主审计通道（必须入配置审计）**  
   面向治理语义资产：`webui/config/access.yaml`、`ktx.yaml`、`semantic-layer/**/*.yaml`（用户资产）、`wiki/**/*.md`、`evals/**`、发布批次汇总事件。
2. **排除通道（默认不入配置审计）**  
   运行中间态与实现副产物：`**/.lucy-history/**`、`wiki/.lucy-directories.json`、`.ktx-ui/**`（除明确声明）、staging 临时文件、内部 sidecar。

### 5.2 触发条件

仅当同时满足以下条件才写入 `config_change_log`：

1. 请求为 `dryRun:false` 且落盘动作成功；
2. 调用方传入 `auditIntent.enabled=true`；
3. 目标路径属于主审计通道；
4. `change_type` 与 `asset_kind` 显式提供（不做隐式猜测）。

> `safeWrite` 继续作为落盘工具，不自动推断“是否审计”。审计由上层业务显式声明。

## 6. 数据模型与幂等约束

### 6.1 `config_change_log` 新增列

| 列 | 类型 | 说明 |
|---|---|---|
| `asset_kind` | `TEXT NOT NULL DEFAULT 'governance'` | 资产域 |
| `operation` | `TEXT` | 动作 |
| `actor_type` | `TEXT NOT NULL DEFAULT 'ui_admin'` | 操作者类型 |
| `source` | `TEXT` | 来源组件 |
| `idempotency_key` | `TEXT` | 幂等键 |
| `write_status` | `TEXT NOT NULL DEFAULT 'committed'` | 写入状态 |
| `error_reason` | `TEXT` | `failed` 状态时原因 |

### 6.2 幂等唯一键（阻塞修订）

新增唯一索引：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_ccl_idempotency
ON config_change_log(idempotency_key);
```

规则：

- 所有写审计请求必须生成 `idempotency_key`（推荐：`request_id + ":" + file_path + ":" + change_type` 的稳定哈希）。
- 若命中重复键，`recordConfigChange` 返回既有记录 ID，不重复插入。

## 7. 一致性语义与故障策略（阻塞修订）

### 7.1 状态机

采用“审计意图 + 提交确认”两阶段语义：

1. **intent**：插入 `write_status='pending'`（含幂等键与关键元数据）。
2. **write**：执行文件落盘。
3. **finalize**：落盘成功则更新为 `committed` 并写入 diff/summary；失败则更新为 `failed` + `error_reason`。

### 7.2 查询口径

- `/api/admin/config-audit` 默认只返回 `write_status='committed'`。
- 管理员可通过调试参数查看 `failed` 记录用于排障（默认 UI 不展示）。

### 7.3 补偿机制

- 若进程崩溃导致 `pending` 长时间未结束，后台 reconciliation 任务按 `idempotency_key` 扫描并补记 `failed_timeout`。
- `pending` 超时阈值（如 5 分钟）需在实现中配置化。

## 8. API / 类型 / UI 端到端一致性

### 8.1 API

`GET /api/admin/config-audit` 与 `export.csv` 均新增并透传：

- `asset_kind`
- `operation`
- `actor_type`
- `source`
- `write_status`（CSV 全量；JSON 默认 committed）

新增过滤参数：

- `assetKind`
- `changeType`
- `source`

### 8.2 前端类型

`webui/src/lib/types.ts` 的 `ConfigAuditEntry` 必须新增同名字段，禁止使用可选“软约束”掩盖后端缺列。

### 8.3 UI

`ConfigAudit.tsx` 至少支持：

- 资产域筛选；
- 来源筛选；
- 详情展示 `operation`、`actor_type`、`source`；
- 导出 CSV 与表格字段一致。

> **澄清（Spec 97）：** 「与表格字段一致」指主表可见 7 列及中文业务 label，非全量 DB 列 dump；详见 `97-admin-config-audit-header-export-parity-spec.md`。

## 9. 资产覆盖矩阵（主审计通道）

| asset_kind | 路径模式 | change_type 示例 |
|---|---|---|
| governance | `webui/config/access.yaml`、`ktx.yaml` | `agent_*`、`role_*`、`token_*`、`enabled_tables_update`、`schema_add` |
| semantic | `semantic-layer/**/*.yaml`（排除 `.lucy-history`） | `semantic_table_save`、`semantic_table_import`、`semantic_table_restore`、`schema_manifest_upload` |
| wiki | `wiki/**/*.md` | `wiki_create`、`wiki_edit_save`、`wiki_move`、`wiki_restore` |
| eval | `evals/**` | `eval_case_save`、`eval_suite_import` |
| publish | 发布批次汇总事件 | `semantic_publish` |

## 10. 治理聚合联动（阻塞修订）

下列聚合必须显式按 `asset_kind` 提供分布，避免“全量计数误导”：

1. `governance-observability.ts`：新增按资产域分组计数与趋势。
2. `release-readiness-package.ts`：新增 `byAssetKind` 与异常域提示。

## 11. 验收标准（新增证据矩阵）

### 11.1 每类资产最少 3 条验证用例

每个 `asset_kind` 至少完成三步：

1. **触发**：执行一次 `dryRun:false` 写入；
2. **查询**：`GET /api/admin/config-audit` 精确过滤命中；
3. **导出**：CSV 可见同一记录且字段一致。

### 11.2 全局阻塞项验收

1. 重试同一请求（相同 `idempotency_key`）不重复插入；
2. 强制制造落盘失败，记录状态为 `failed`，且默认列表不可见；
3. `asset_kind`/`operation`/`actor_type`/`source` 在 DB、JSON、CSV、前端详情一致；
4. 中间态文件写入不进入配置审计主视图。

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 审计噪音 | 双通道边界 + 显式 `auditIntent.enabled` |
| 重试膨胀 | `idempotency_key` 唯一索引 + upsert 语义 |
| 半成功状态 | `pending/committed/failed` 状态机 + reconciliation |
| 口径冲突 | `actor` + `actor_type/source` 并行展示 |
