# 访问日志双粒度 CSV 导出 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 访问日志双粒度 CSV 导出 |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-09-03 |
| 撰写人 | Codex |
| 委托人 | 张星晨 |
| 基于材料 | 用户确认：问询记录与调用流水都需要导出；Spec 08 / 89 / 94 / 106 / 125 / 137；当前 `Audit.tsx` 与 `server/admin/audit.ts` |
| 适用范围 | `/admin/audit` 问询记录、调用流水、CSV 导出、Help Center 访问治理说明 |
| 输出位置 | `webui/docs/140-admin-audit-dual-csv-export-spec.md` |

---

## 1. 背景与问题

`/admin/audit` 已拆成「问询记录」与「调用流水」两个页签：前者按一次用户问询聚合，后者按一次工具调用展开。当前页面只有「导出调用流水」能力，且历史方案曾要求导出按钮在两个页签都固定指向 `/api/admin/audit/export`。这会造成两个问题：

1. 管理员在「问询记录」页签需要导出问询级汇总时，没有可用入口。
2. 单个导出按钮跨页签固定导出调用流水，容易让用户误以为它导出当前页签。

## 2. 目标与 Non-Goals

### 目标

| ID | 目标 |
|---|---|
| G1 | `/admin/audit` 同时提供「导出问询记录」和「导出调用流水」两种 CSV 能力 |
| G2 | 问询导出与问询记录列表共用筛选、来源、推断/上报、结果、慢调用口径 |
| G3 | 调用流水导出保持既有 `/api/admin/audit/export` 语义，避免破坏旧脚本 |
| G4 | 页面与 Help 明确说明：一条问询记录可对应多条调用流水，通过「问询 ID」关联 |

### Non-Goals

- 不重命名「问询记录」「调用流水」页签。
- 不把既有 `/api/admin/audit/export` 改成随 `view` 参数切换语义。
- 不修改审计证据包 `/api/admin/audit/export-pack` 的文件结构。
- 不做 Docker 重建，不做浏览器验证。

## 3. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms（登记于 §4.7）：

| Canonical Term | UI 主术语 | 说明 |
|---|---|---|
| Turn Inquiry CSV Export | 导出问询记录 | 新增 `/api/admin/audit/turns/export` |

Existing terms：

| Canonical Term | UI 主术语 | 说明 |
|---|---|---|
| Turn Inquiry Tab | 问询记录 | 一行代表一次用户问询 |
| Call Log Tab | 调用流水 | 一行代表一次工具调用 |
| Access Call Log CSV Export | 导出调用流水 | 既有 `/api/admin/audit/export` |
| Audit Evidence Pack | 导出审计证据包 | 既有 `/api/admin/audit/export-pack` |
| Turn ID | 问询 ID | 两种粒度的关联键 |

Protected DOM：`Agent`、`MCP`、`CSV`、`SQL`、`Manifest`、URL、文件名、数据库表名、ID 类字段。

## 4. 产品口径

| 页签 | 粒度 | 典型问题 | 导出按钮 |
|---|---|---|---|
| 问询记录 | 一次用户问询 / 一个 Turn | 用户问了什么、整体是否成功、涉及哪些表、是否含慢调用 | 导出问询记录 |
| 调用流水 | 一次工具调用 / 一个 `access_log` 事件 | 哪个工具被拒、哪个 SQL 慢、裁决原因是什么、访问上下文是什么 | 导出调用流水 |

关系：

```text
1 条问询记录 -> N 条调用流水
```

两者通过「问询 ID」关联。调用流水中没有 `lucy_turn_id` 的历史行仍可存在；此类行只进入调用流水导出，不强行伪造成问询记录。

## 5. 核心流程（伪代码）

```text
FUNCTION buildTurnExportFilter(uiState):
  RETURN {
    user: resolvedAgentId(uiState.user),
    source: uiState.turnSource in {"reported", "inferred"} ? uiState.turnSource : "all",
    hours: uiState.range == "24h" ? 24 : 168,
    since: uiState.sinceIso,
    until: uiState.untilIso,
    tableSearch: uiState.tableSearch,
    turnId: uiState.keySearch,
    outcome: uiState.outcome,
    q: uiState.turnSearch
  }

FUNCTION buildCallExportFilter(uiState):
  RETURN {
    user: resolvedAgentId(uiState.user) OR uiState.user,
    tool: uiState.tool,
    outcome: uiState.outcome,
    since: uiState.sinceIso,
    until: uiState.untilIso,
    tableSearch: uiState.tableSearch,
    sessionId: uiState.sessionId,
    clientIp: uiState.clientIp,
    deviceName: uiState.deviceName,
    key: uiState.keySearch,
    platform: uiState.platform,
    callSource: uiState.callSource,
    includeProtocol: uiState.includeProtocol
  }

FUNCTION listTurnEntries(q, paginate):
  source = normalizeSource(q.source)
  windowHours = parseWindowHours(q.hours)
  p95Ms = queryP95LatencyMs(windowHours)
  IF source != "reported":
    rebuild inferred turns for target users and lookback window
  entries = []
  IF source includes inferred:
    entries += inferred_turns filtered by user/time
  IF source includes reported:
    entries += conversation_turns filtered by user/time
  enriched = enrich each entry with linked access_log metrics
  filtered = apply turnId/table/q/outcome filters
  sorted = startedAt DESC
  IF paginate:
    RETURN sorted[offset:offset+limit] + totals
  RETURN all sorted + totals

FUNCTION renderTurnCsv(entries):
  header = Chinese turn export headers
  FOR entry IN entries:
    row = [
      entry.id,
      entry.source label,
      entry.userId,
      entry.startedAt,
      entry.endedAt,
      entry.turnSpanMs,
      entry.questionPreview OR entry.questionSummary,
      entry.businessCallCount,
      join(entry.tools),
      join(entry.sources.physicalTable),
      entry.totalCallDurationMs,
      entry.maxCallDurationMs,
      entry.slowCallCount,
      entry.outcomeSummary.ok,
      entry.outcomeSummary.denied,
      entry.outcomeSummary.error
    ]
    csvCell every text-like value to prevent formula injection
  RETURN UTF-8 CSV, optional BOM when q.bom == 1 OR true

FUNCTION renderAuditHeaderActions(tab):
  primary = tab == "turns" ? turnExportUrl : callExportUrl
  secondary = tab == "turns" ? callExportUrl : turnExportUrl
  SHOW primary button with tab-specific label
  SHOW secondary button with alternate label
  SHOW export-pack button unchanged
```

## 6. API 契约

| Method | Path | 说明 |
|---|---|---|
| `GET` | `/api/admin/audit/turns/export` | 问询记录 CSV；一行代表一次问询；支持 `bom=1` |
| `GET` | `/api/admin/audit/export` | 调用流水 CSV；一行代表一次工具调用；既有兼容端点 |
| `GET` | `/api/admin/audit/export-pack` | 审计证据包 zip；不变 |

### 6.1 问询导出查询参数

| 参数 | 说明 |
|---|---|
| `user` | Agent 用户 ID |
| `source` | `all` / `reported` / `inferred` |
| `hours` | `24` / `168`；默认 `168` |
| `since` / `until` | ISO 时间范围；优先于默认窗口 |
| `tableSearch` | 涉及数据表模糊匹配 |
| `turnId` | 问询 ID 模糊匹配；页面由统一搜索中的 ID 输入映射 |
| `outcome` | `ok` / `denied` / `error` |
| `q` | 问询摘要、预览、Agent、表名搜索 |
| `bom` | `1` / `true` 时加 UTF-8 BOM |

### 6.2 问询 CSV 字段

```text
问询 ID,来源,Agent,开始时间,结束时间,问询时长,问询摘要,工具调用数,涉及工具,涉及数据表,总调用耗时,最大调用耗时,慢调用数,成功次数,拒绝次数,错误次数
```

调用流水 CSV 字段沿用 Spec 137 的 `access_log` 导出字段，保留 `generated_sql` 与策略证据列，保障历史脚本兼容。

## 7. UI / Help

### 7.1 Header actions

Header action 顺序：

1. 统计时间
2. 统计窗口 segmented control
3. 当前页签主导出按钮
4. 另一个粒度的次级导出按钮
5. 导出审计证据包

文案：

| 当前页签 | 主按钮 | 次级按钮 |
|---|---|---|
| 问询记录 | 导出问询记录 | 导出调用流水 |
| 调用流水 | 导出调用流水 | 导出问询记录 |

### 7.2 页签口径说明

页签下方展示一行 `pl-notice` 风格轻说明：

| 页签 | 文案 |
|---|---|
| 问询记录 | `问询记录按一次用户问询聚合，适合查看整体结果、涉及数据表和慢调用概况。` |
| 调用流水 | `调用流水按一次工具调用展开，适合排查权限裁决、生成 SQL、访问上下文和单次耗时。` |

同一区域提供 `查看审计口径` 链接到 `/help?section=admin-audit-turns-vs-calls`。

### 7.3 Help

在 `docs/SYSTEM_HANDBOOK.md` 的 `3.5 访问治理 Admin` 增加：

```md
#### 问询记录与调用流水怎么选、怎么导出
```

必须说明：

- 一条问询记录对应多条调用流水。
- 「导出问询记录」是一问一行。
- 「导出调用流水」是一调用一行。
- 两者通过「问询 ID」关联。
- 「导出审计证据包」用于离线审计闭环，不替代两个日常 CSV。

`webui/server/help.ts` 增加稳定锚点：`admin-audit-turns-vs-calls`。

## 8. 验收标准

| ID | 验收 |
|---|---|
| AC-1 | 问询记录页签主按钮为「导出问询记录」，href 指向 `/api/admin/audit/turns/export` |
| AC-2 | 调用流水页签主按钮为「导出调用流水」，href 指向 `/api/admin/audit/export` |
| AC-3 | 两个页签均能看到另一个粒度的导出入口 |
| AC-4 | `/api/admin/audit/turns/export` 返回问询记录 CSV，含中文列头、公式注入防护、来源标记 |
| AC-5 | 问询导出与 `/api/admin/audit/turns` 在同筛选下返回同一组问询 |
| AC-6 | 既有 `/api/admin/audit/export` 与 `/api/admin/audit/export-pack` 行为不回归 |
| AC-7 | Help 可通过 `/help?section=admin-audit-turns-vs-calls` 深链定位，并可搜索「问询记录」「调用流水」「导出问询记录」 |

## 9. 验证策略

本轮按用户约束：

- 不做 Docker 重建。
- 不做浏览器验证。

必须执行：

- `cd webui && npm run lint:terminology`
- `cd webui && npm test -- admin-audit.test.ts`
- `cd webui && npm test -- admin-audit-turns.test.tsx audit.test.tsx help-center.test.tsx`
- `cd webui && npm run build`

如现有工作区非本轮改动导致无关失败，交付时必须说明失败边界与证据。
