# 访问日志 CSV 可读性与字段元数据 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 访问日志 CSV 可读性与字段元数据 |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-09-03 |
| 撰写人 | Codex |
| 委托人 | 张星晨 |
| 基于材料 | 用户反馈：`audit-20260903.csv` 时间不利于阅读和 Excel 解析、缺字段元数据、文件名无法精确区分版本；Spec 137 / 140；当前 `server/admin/audit.ts` 与 `Audit.tsx` |
| 适用范围 | `/admin/audit` 调用流水 CSV、问询记录 CSV、字段说明元数据、Help 说明 |
| 输出位置 | `webui/docs/141-admin-audit-csv-readability-metadata-spec.md` |

---

## 1. 背景与问题

Spec 140 已把访问日志拆成两种 CSV 能力：

- 「导出问询记录」：一问一行，当前文件名 `audit-turns-YYYYMMDD.csv`。
- 「导出调用流水」：一调用一行，当前文件名 `audit-YYYYMMDD.csv`。

这解决了导出粒度问题，但单 CSV 仍有三类可用性缺口：

1. `ts`、`开始时间`、`结束时间` 等时间字段是 ISO/UTC 字符串，人工阅读和 Excel 默认解析不够友好。
2. 调用流水字段多且偏审计内核，例如 `turn_attribution_mode`、`capability_digest`、`generated_sql`，缺少字段含义和触发条件说明。
3. 文件名只有日期，浏览器会生成 `audit-20260903 (1).csv`，不利于版本对账。

## 2. 目标与 Non-Goals

### 目标

| ID | 目标 |
|---|---|
| G1 | 单 CSV 文件名精确到时分秒并带流水号 |
| G2 | CSV 增加 Excel 友好的本地时间列，同时保留 UTC 原始值 |
| G3 | 提供调用流水与问询记录字段说明元数据 |
| G4 | 页面和 Help 说明字段说明入口及 UTC / 本地时间双轨口径 |

### Non-Goals

- 不删除现有机器对账字段，例如 `ts`、`request_id`、`trace_id`。
- 不把 CSV 单文件升级为唯一交付形态；正式审计仍优先使用「导出审计证据包」。
- 不修改审计证据包 zip 的完整性算法。
- 不做 Docker 重建，不做浏览器验证。

## 3. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms（登记于 §4.7）：

| Canonical Term | UI 主术语 | 说明 |
|---|---|---|
| Audit CSV Field Metadata | 字段说明 | 解释访问日志 CSV 字段含义、格式、触发条件 |
| Local Audit Timestamp | 本地时间 | Asia/Shanghai 的 `YYYY-MM-DD HH:mm:ss` 可读时间 |

Existing terms：

| Canonical Term | UI 主术语 | 说明 |
|---|---|---|
| Access Call Log CSV Export | 导出调用流水 | 一调用一行 |
| Turn Inquiry CSV Export | 导出问询记录 | 一问一行 |
| Audit Evidence Pack | 导出审计证据包 | 正式审计闭环包 |
| Export Manifest | Manifest | 证据包完整性元数据 |

Protected DOM：`Agent`、`CSV`、`SQL`、`UTC`、`Manifest`、URL、文件名、数据库表名、ID 类字段。

## 4. 产品口径

| 项 | 旧口径 | 新口径 |
|---|---|---|
| 调用流水文件名 | `audit-20260903.csv` | `audit-calls-YYYYMMDD-HHmmss-000001.csv` |
| 问询记录文件名 | `audit-turns-20260903.csv` | `audit-turns-YYYYMMDD-HHmmss-000001.csv` |
| 调用流水时间 | `ts` ISO/UTC | 新增 `ts_local`，保留 `ts` |
| 问询记录时间 | `开始时间` / `结束时间` ISO/UTC | `开始时间` / `结束时间` 改为本地时间，新增 `开始时间 UTC` / `结束时间 UTC` |
| 字段解释 | 无 | `/api/admin/audit/export-metadata?kind=calls|turns` |

本地时间统一使用 `Asia/Shanghai`，格式为：

```text
YYYY-MM-DD HH:mm:ss
```

该格式优先服务人工阅读和 Excel 解析；UTC 原始字段保留用于跨时区、机器对账、证据包哈希复核。

## 5. 核心流程（伪代码）

```text
GLOBAL auditExportSequence = 0

FUNCTION nextAuditExportFilename(kind, ext, now):
  stamp = format now in Asia/Shanghai as YYYYMMDD-HHmmss
  seq = increment auditExportSequence, pad to 6 digits
  RETURN "audit-" + kind + "-" + stamp + "-" + seq + "." + ext

FUNCTION formatLocalAuditTimestamp(iso):
  IF iso is invalid:
    RETURN iso
  RETURN date in Asia/Shanghai as YYYY-MM-DD HH:mm:ss

FUNCTION renderAccessLogCsv(rows):
  headers = ["id", "ts", "ts_local", ...existing access_log headers after ts]
  FOR row IN rows:
    csv row keeps row.ts
    csv row adds formatLocalAuditTimestamp(row.ts)
    preserve formula escaping and sensitive redaction

FUNCTION renderTurnCsv(entries):
  headers = [
    "问询 ID", "来源", "Agent",
    "开始时间", "开始时间 UTC",
    "结束时间", "结束时间 UTC",
    ...
  ]
  FOR entry IN entries:
    local start/end columns use formatLocalAuditTimestamp
    UTC columns keep original startedAt/endedAt

FUNCTION buildAuditCsvFieldMetadata(kind):
  IF kind == "calls":
    RETURN schemaVersion, kind, timezone, filenamePattern, fields for access log CSV
  IF kind == "turns":
    RETURN schemaVersion, kind, timezone, filenamePattern, fields for turn CSV
  ELSE:
    RETURN 400 ERR_INVALID_AUDIT_METADATA_KIND

ROUTE GET /api/admin/audit/export-metadata:
  kind = calls unless kind == turns
  body = buildAuditCsvFieldMetadata(kind)
  filename = nextAuditExportFilename(kind + "-fields", "json")
  RETURN JSON attachment, no-store
```

## 6. API 契约

| Method | Path | 说明 |
|---|---|---|
| `GET` | `/api/admin/audit/export` | 调用流水 CSV；文件名升级；新增 `ts_local` |
| `GET` | `/api/admin/audit/turns/export` | 问询记录 CSV；文件名升级；本地时间 + UTC 原始时间 |
| `GET` | `/api/admin/audit/export-metadata?kind=calls` | 调用流水字段说明 JSON |
| `GET` | `/api/admin/audit/export-metadata?kind=turns` | 问询记录字段说明 JSON |

### 6.1 字段说明 JSON

```json
{
  "schemaVersion": "audit-csv-field-metadata/v1",
  "kind": "calls",
  "title": "调用流水 CSV 字段说明",
  "timezone": "Asia/Shanghai",
  "filenamePattern": "audit-calls-YYYYMMDD-HHmmss-000001.csv",
  "generatedAt": "2026-09-03T06:30:00.000Z",
  "fields": [
    {
      "name": "ts_local",
      "label": "本地时间",
      "format": "YYYY-MM-DD HH:mm:ss",
      "description": "按 Asia/Shanghai 转换后的访问事件时间，便于人工阅读和 Excel 解析。",
      "trigger": "每条 access_log 行均输出。"
    }
  ]
}
```

## 7. UI / Help

`/admin/audit` 页签说明区增加当前页签「字段说明」下载入口：

| 当前页签 | 字段说明链接 |
|---|---|
| 问询记录 | `/api/admin/audit/export-metadata?kind=turns` |
| 调用流水 | `/api/admin/audit/export-metadata?kind=calls` |

Help 的「问询记录与调用流水怎么选、怎么导出」补充：

- CSV 文件名带秒级时间戳和流水号。
- 本地时间用于阅读和 Excel，UTC 字段用于机器对账。
- 「字段说明」解释每列含义、格式、触发条件。

## 8. 验收标准

| ID | 验收 |
|---|---|
| AC-1 | `/api/admin/audit/export` 文件名匹配 `audit-calls-YYYYMMDD-HHmmss-000001.csv` |
| AC-2 | `/api/admin/audit/export` CSV 含 `ts_local`，且保留 `ts` |
| AC-3 | `/api/admin/audit/turns/export` 文件名匹配 `audit-turns-YYYYMMDD-HHmmss-000001.csv` |
| AC-4 | `/api/admin/audit/turns/export` CSV 含本地时间列和 UTC 原始时间列 |
| AC-5 | `/api/admin/audit/export-metadata?kind=calls|turns` 返回字段说明 JSON attachment |
| AC-6 | `/admin/audit` 提供当前页签字段说明下载入口 |
| AC-7 | Help 说明本地时间 / UTC 双轨、字段说明和新文件名 |

## 9. 验证策略

本轮按用户约束：

- 不做 Docker 重建。
- 不做浏览器验证。

必须执行：

- `cd webui && npm run lint:terminology`
- `cd webui && npm test -- admin-audit.test.ts`
- `cd webui && npm test -- admin-audit-turns.test.tsx help-center.test.tsx`
- `cd webui && npm test -- server/__tests__/help.test.ts`
- `cd webui && npm run build`
