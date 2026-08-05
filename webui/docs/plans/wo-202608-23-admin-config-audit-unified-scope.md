# Admin Config Audit Unified Scope Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Config Audit Unified Scope Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/90-admin-config-audit-unified-scope-spec.md`（v1.1） |
| 适用范围 | 落地 Spec 90：写审计统一管道、扩展 `config_change_log`、补齐语义/Wiki/评测/发布写路径、`/admin/config-audit` UI 与 API |
| 输出位置 | `webui/docs/plans/wo-202608-23-admin-config-audit-unified-scope.md` |

**Goal:** WebUI 对治理语义资产写入一视同仁审计，并具备幂等去重、一致性状态机和可复验证据。

**Architecture:** 先做调用点全量盘点与分类 → 引入审计意图通道 + 幂等键 + 状态机 → 迁移主审计通道调用点 → 扩展 API/UI/聚合。

**Tech Stack:** Fastify、better-sqlite3、React、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.1 | 响应阻塞审阅：新增双通道边界、强幂等、状态机一致性、调用点盘点前置、资产域证据矩阵 |
| v1.0 | 初稿 |

---

## Non-Negotiable Boundaries

- actor 保持 `local-admin`；新增 `actor_type/source`，但不实现 SSO。
- 不替代 Wiki / 表语义 `.lucy-history`；不删除 `/publish/history`。
- 不审计 git / CLI / Agent 直改文件。
- `.lucy-history`、`.ktx-ui/audit.sqlite`、staging 暂存和内部 sidecar **不得**进入配置审计主视图。
- `dryRun:true` 不得 INSERT。
- Token 明文、secrets 不得进入 diff / summary。
- 不做浏览器验证；Gate 以 Vitest + `lint:terminology` + `build` 为准。

## File Ownership

| 区域 | 主要文件 |
|---|---|
| 审计核心 | `webui/server/admin/audit.ts` |
| 写钩子 | `webui/server/fs-safe.ts` |
| 治理写 | `webui/server/admin/{agents,roles,tokens}.ts`、`webui/server/index.ts`、`webui/server/project.ts` |
| 语义写 | `webui/server/semantic-layer.ts`、`webui/server/table-yaml-history.ts` |
| Wiki 写 | `webui/server/wiki.ts` |
| 评测写 | `webui/server/eval/{cases,suite-import}.ts` |
| 发布写 | `webui/server/semantic-assets.ts`、`webui/server/index.ts`（publish 路由） |
| 类型 | `webui/src/lib/types.ts` |
| UI | `webui/src/pages/admin/ConfigAudit.tsx` |
| 聚合 | `webui/server/admin/governance-observability.ts`、`release-readiness-package.ts` |
| 文档 | `webui/docs/03-api-spec.md`、`04-data-model.md`、`00-product-terminology-standard.md` |

---

## Phase 0: 调用点盘点与分类（新增，阻塞前置）

**目标：** 在改代码前拿到“完整写入清单”，避免漏项和误纳入。

### Tasks

1. 盘点所有 `safeWrite`、`safeRemove`、`recordConfigChange` 调用点（含 `project.ts`、`admin/access-config.ts`、`joins-sidecar.ts`、`eval/security-candidates.ts` 等）。
2. 对每个调用点标注：`主审计通道` / `排除通道` / `待确认`。
3. 形成清单文档 `inbox/config-audit-callsite-inventory-20260823.md`，每项含 owner、目标 `asset_kind`、`change_type`、`source`。
4. 未完成分类不得进入后续 phase。

### 验证

```bash
rg "safeWrite\\(|safeRemove\\(|recordConfigChange\\(" webui/server
```

---

## Phase 1: Schema & audit core（阻塞修订）

**目标：** 落地强幂等和一致性状态字段。

### Tasks

1. `audit.ts` 迁移 `config_change_log`：新增 `actor_type`、`source`、`idempotency_key`、`write_status`、`error_reason`。
2. 新增唯一索引 `uq_ccl_idempotency(idempotency_key)`。
3. `recordConfigChange` 支持幂等 upsert：重复键返回已有记录 ID。
4. 扩展 API/CSV 输出新字段。
5. 单测：重复请求不重复插入；唯一索引回归。

### 验证

```bash
cd webui
npm test -- src/__tests__/admin-audit.test.ts
```

---

## Phase 2: 审计触发双通道与一致性状态机（阻塞修订）

**目标：** 不再“凡经 safeWrite 都审计”；改为显式审计意图 + pending/committed/failed。

### Tasks

1. `safeWrite` 仅接收 `auditIntent`，不做隐式路径推断。
2. 上层业务仅在“主审计通道”传入 `auditIntent.enabled=true`。
3. 写流程改为：`pending -> write -> committed/failed`。
4. 增加 reconciliation 任务：超时 pending 标记 `failed_timeout`。
5. `fs-safe.test.ts` / `admin-audit.test.ts` 增加状态机用例。

### 验证

```bash
cd webui
npm test -- src/__tests__/fs-safe.test.ts src/__tests__/admin-audit.test.ts
```

---

## Phase 3: 迁移治理路径并去双写

**目标：** `agents`/`roles`/`tokens`/`enabled-tables`/`schema_add` 走统一意图通道，移除重复插入。

### Tasks

1. 治理相关模块移除直接 `recordConfigChange` 双写。
2. 每个入口明确 `actor_type=ui_admin`、`source=*api`。
3. 请求级幂等键生成与透传。
4. 用例：同请求重放不新增行。

### 验证

```bash
cd webui
npm test -- src/__tests__/admin-agents.test.ts src/__tests__/admin-roles.test.ts src/__tests__/admin-tokens.test.ts src/__tests__/api.add-schema.test.ts src/__tests__/project.add-schema.test.ts
```

---

## Phase 4: 扩展到 semantic/wiki/eval/publish 主审计通道

**目标：** 用户治理语义资产全覆盖，内部副产物全排除。

### Tasks

1. `semantic-layer.ts` / `table-yaml-history.ts`：仅用户资产写入记审计。
2. `wiki.ts`：`.md` 用户文件动作记审计，`.lucy-history` 与目录元数据排除。
3. `eval/cases.ts` / `eval/suite-import.ts`：纳入审计。
4. `semantic-assets publish`：`semantic_publish` 单条汇总。
5. 对照 Phase 0 清单逐项勾选 closed。

### 验证

```bash
cd webui
npm test -- src/__tests__/wiki.test.ts src/__tests__/table-yaml-history.test.ts src/__tests__/semantic-layer.roundtrip.test.ts src/__tests__/eval-suite-import.test.ts src/__tests__/semantic-assets.validate-gate.test.ts
```

---

## Phase 5: API/Type/UI 端到端对齐（高优先）

**目标：** 新字段不是“文档存在、产品不可见”。

### Tasks

1. 后端 list/export 同步透传：`asset_kind`/`operation`/`actor_type`/`source`/`write_status`。
2. `types.ts` 强类型同步，禁止遗漏。
3. `ConfigAudit.tsx` 增加 `assetKind`、`source` 筛选与详情展示。
4. 增加 API-UI 一致性回归测试（JSON 与 CSV 字段一致）。

### 验证

```bash
cd webui
npm test -- src/__tests__/admin-config-audit.test.tsx src/__tests__/admin-audit.test.ts
```

---

## Phase 6: 聚合口径迁移（中优先阻塞）

### Tasks

1. `governance-observability.ts` 输出 `byAssetKind`（计数、近7天趋势）。
2. `release-readiness-package.ts` 输出 `byAssetKind` 与异常域标记。
3. UI 文案明确“包含哪些资产域”。
4. 更新 spec/api/data-model/terminology 文档。

---

## Phase 7: 证据化验收（新增）

**目标：** 证明“何时、何人（类型/来源）被修改”可复核。

### Tasks

1. 每个资产域至少 3 条用例：触发 -> 查询 -> 导出。
2. 每条用例记录：`ts`、`actor`、`actor_type`、`source`、`file_path`、`change_type`、`idempotency_key`。
3. 形成验收文档：`inbox/config-audit-verification-matrix-20260823.md`。

---

## Phase 8: Gate

```bash
cd webui
npm test -- \
  src/__tests__/admin-audit.test.ts \
  src/__tests__/admin-config-audit.test.ts \
  src/__tests__/fs-safe.test.ts \
  src/__tests__/admin-agents.test.ts \
  src/__tests__/admin-roles.test.ts \
  src/__tests__/admin-tokens.test.ts \
  src/__tests__/wiki.test.ts \
  src/__tests__/semantic-layer.roundtrip.test.ts
npm run lint:terminology
npm run build
```

---

## 建议实施顺序与并行

```text
Phase 0 → Phase 1 → Phase 2 → Phase 3 ─┐
                                        ├→ Phase 5 → Phase 6 → Phase 7 → Phase 8
                    Phase 4 ────────────┘
```

- Phase 4 可在 Phase 3 后并行，但不得跳过 Phase 0 分类清单。
- Phase 2 的状态机实现先于 UI 开发，避免前端接到不稳定口径。

## 完成定义 (DoD)

- [ ] Phase 0 调用点分类清单完成并签字
- [ ] 幂等唯一键与状态机用例通过
- [ ] 资产域 3×N 验证矩阵完成（触发-查询-导出）
- [ ] `/admin/config-audit` 可筛选并展示 `asset_kind/actor_type/source`
- [ ] 聚合端具备 `byAssetKind` 统计输出
- [ ] `lint:terminology` / `build` 绿
