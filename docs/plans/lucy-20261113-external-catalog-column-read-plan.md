# 外部目录单表读字段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **未获委托人开发授权前不得改运行代码。**

| 元数据 | 内容 |
|---|---|
| 状态 | **方案已落盘（v0.1-draft）**；待终稿确权＋开发授权 |
| 主 Spec | [`docs/specs/lucy-20261113-external-catalog-column-read-spec.md`](../specs/lucy-20261113-external-catalog-column-read-spec.md) **v0.1-draft** |
| 总账 | **P1-20**／REQ-030-041；**不入核心分母**；事故续作（P1-16 Follow-up） |
| 授权边界 | 只改外部目录**单表字段**直连读法与直连白名单。不改 KTX、不问数、不改无点号 MySQL 字段 SQL、不改页面组件（除非测夹具）、不做浏览器测试 |
| 验收 | Spec SC-01–SC-10 |

**Goal:** 准备表结构侧边栏对 SelectDB／Doris 外部 Catalog（如 `hive-1`／`dim`）选中单表时能读到字段，不再因 KTX `DESC` 失败而固定报「没有读到字段」。

**Architecture:** 扩展现有 `runCatalogShow`（或抽出等价 catalog-meta 执行器）白名单，允许 `DESC`／`SHOW COLUMNS`／`DESCRIBE` 三段名语句；`readCatalogTableColumns` 改为经该直连按序探针，**不再**对外部目录调用 `runSql`。凭据、超时、关连接、脱敏与列库 `SHOW` 共用。

**Tech Stack:** 现有 Vitest、`mysql2` 直连适配器、既有 `catalog-database.ts` SQL 生成函数。

## Global Constraints

- 不修改 KTX 源码，不升级 KTX
- 外部目录字段探针不得进入 `runSql`／`ktx sql`
- 外部目录失败不得回退到 `information_schema`
- 密码不得进入错误文本、日志、审计和测试快照
- `chatbi` 等无点号连接读字段路径保持改前行为
- 不改 MCP／问数

---

## 1. 文件地图

| 文件 | 职责 | SC |
|---|---|---|
| `webui/server/catalog-show.ts` | 扩展 SQL 白名单；共用连接／超时／脱敏 | SC-05／07 |
| `webui/server/catalog-database.ts` | 已有 `describeCatalogTableSql`／`showColumnsSql`／`describeTableSql`；按需微调注释 | SC-01／03 |
| `webui/server/schema-structure.ts` | `readCatalogTableColumns` 改直连多探针；映射复用／恢复 Nov-10 逻辑 | SC-01–04／06／09 |
| `webui/server/__tests__/doris-external-catalog.simulation.test.ts` | 改：字段经 `runCatalogShowImpl`；`runSql` 不接 DESC；回退与中文表 | SC-01–04／09／10 |
| `webui/server/__tests__/catalog-show.test.ts` | 白名单允许／拒绝；字段语句关连接／脱敏抽测 | SC-05／07 |
| `webui/server/__tests__/schema-structure.test.ts` | 无点号路径不回归 | SC-08 |
| Spec／Plan／总账／P1-16 Follow-up | 文档镜像 | — |

不改 `webui/src` 业务组件（`prepareSchemaStructure` 已逐表调 API）。

---

## 2. 任务

### Task 0: 授权门闩

- [ ] 确认 Spec v0.1 终稿确权（Codex CLI 或委托人明示）
- [ ] 确认委托人**另发开发授权**（本 Plan 方可勾选后续 Task）
- [ ] 总账 P1-20 跟进状态改为「开发中」同句镜像

**通过标准:** 无授权则停止；不得改 `webui/server/**` 运行代码。

### Task 1: 红灯 — 替身证明「直连字段」合同

- [ ] 在 `doris-external-catalog.simulation.test.ts` 增加／改写：
  - 选中单表时 **期望**经 `runCatalogShowImpl` 收到 `DESC \`…\`.\`…\`.\`…\``
  - `runSqlImpl` 不被调用（或调用 SQL 不含字段探针）
  - `DESC` 拒绝 + `SHOW COLUMNS` 成功仍返回列
  - 三探针失败 → message 匹配「没有读到字段」
- [ ] 先跑测试：**在实现前应红**（当前仍走 `runSql`＋DESC）

```bash
cd webui && npx vitest run server/__tests__/doris-external-catalog.simulation.test.ts
```

### Task 2: 扩展直连白名单

- [ ] 更新 `catalog-show.ts` 正则：在现有 `SHOW DATABASES|TABLES` 之外允许且仅允许三段名 `DESC`／`SHOW COLUMNS FROM`／`DESCRIBE`
- [ ] `catalog-show.test.ts`：合法字段语句通过替身；`SELECT 1`／`information_schema` 仍拒
- [ ] 超时／关连接／`file:` 脱敏至少覆盖一条字段语句路径（可与现有用例参数化）

### Task 3: 接线 `readCatalogTableColumns`

- [ ] 注入／默认使用 `runCatalogShow`（非 `runSql`）
- [ ] 按 Spec 顺序探针；上一条失败或映射 0 列才试下一条
- [ ] 恢复／复用 `mapShowColumn`（若当前仅有 `mapDescribeColumn`）
- [ ] 成功返回列；全失败 → `{ rejection: { reason: "unreadable"|… } }`（timeout／permission 分类可沿用对 stderr 的既有启发式，若直连错误文本可分类）
- [ ] 跑 Task 1 测试至绿；再跑：

```bash
cd webui && npx vitest run \
  server/__tests__/catalog-show.test.ts \
  server/__tests__/doris-external-catalog.simulation.test.ts \
  server/__tests__/schema-structure.test.ts \
  server/__tests__/live-tables-wide-schema.test.ts
```

### Task 4: 文档镜像与 P1-16 指针

- [ ] catalog-scan Spec Follow-up 改为指向本 Spec／P1-20（注明 SC-10 字段侧由本条取代）
- [ ] 总账／需求池状态随实现进度更新（实现后：功能合同收口句＋证据）
- [ ] 可选：调研分析 MD 增「已知缺口→P1-20」一行

### Task 5: 收口证据（实现后）

- [ ] 撰写 `docs/reviews/YYYY-MM-DD-external-catalog-column-read-sc-evidence-audit.md`（SC-01–SC-10）
- [ ] Spec／Plan 状态改为功能合同已收口；**≠ 可上线**
- [ ] 测试台：可在 `UAT-SUITE-CATALOG-SCAN` 增可选 EXT 单表字段用例；无 live 时保持 GAP，不得写成 EXT PASS

---

## 3. 回滚

- 直连字段失败时行为回到「没有读到字段」——不静默写空列 Manifest（保持现 preview 对 rejection 抛错）。
- 若需紧急回退：恢复 `readCatalogTableColumns` 仅 `runSql`＋`DESC`（不推荐；仅事故开关级文档说明）。

## 4. 非本 Plan

- 客户 SelectDB live 必测、浏览器 UAT、整库批量超时产品策略、Hive HS2 直连晋级。
