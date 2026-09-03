# 访问日志审计证据硬化 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 访问日志审计证据硬化 |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-09-02 |
| 撰写人 | Composer |
| 委托人 | 张星晨 |
| 基于材料 | `inbox/2026-09-02-access-log-csv-audit-review.md`、样本 `audit-20260902.csv`、Spec 07/08/98、代码复核 |
| 适用范围 | Lucy MCP Proxy 访问日志写入、脱敏、策略证据字段、Session/客户端归因、表名提取、调用流水 CSV 与正式审计证据包导出 |
| 输出位置 | `webui/docs/137-access-log-audit-evidence-hardening-spec.md` |

---

## 1. 背景与问题

2026-09-02 对访问日志「导出 CSV」样本审阅结论：当前导出能支撑内部排障流水，**不能**作为正式审计证据。根因包括：

1. `lucy_begin_question` 的 `access_log.args_summary` 旁路保存原始 `question`，绕过 `conversation_turns.question_preview` 脱敏。
2. `auditMeta()` 未把 `permissionSnapshot()` 已有的 `policyVersion` / `capabilityDigest` 写入 `access_log`（违反 Spec 07 写序与 Spec 98 §10.3）。
3. Session / 客户端归因不足；NL 文本被 SQL 表名正则误抽；单 CSV 无法自证导出范围；缺少可离线复核的证据包。

## 2. 目标与 Non-Goals

### 目标

| Wave | 目标 |
|---|---|
| W1 | 堵住问句旁路；每条 allow/deny 写入策略版本证据；历史 `args_summary` 可 scrub；真实 Proxy 回归 |
| W2 | Session 兜底、客户端字段回归、`looksLikeSql` 防误抽、最小 `export-pack`（CSV + Manifest） |
| W3 | 完整审计证据包（sources / snapshots / auth_failure）；Admin 术语区分；成功查询 UAT |

### Non-Goals

- 不修改 Hermes / 外部 MCP 客户端。
- 不把自然语言问句作为 ACL 裁决输入。
- 不破坏既有 `GET /api/admin/audit/export` 的「一行 access_log = 一行 CSV」语义；证据包走新端点。
- 不在本 Spec 实现防篡改签名 CA / 外部 WORM 存储（Manifest SHA-256 为完整性自检，非密码学签名）。

## 3. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms（已登记 §4.7）：

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Access Call Log CSV Export | 导出调用流水 | 审计证据导出（指单文件 CSV） | 现有 `/api/admin/audit/export` |
| Audit Evidence Pack | 导出审计证据包 | 把单 CSV 称为审计证据包 | `/api/admin/audit/export-pack` zip |
| Export Manifest | Manifest | 舱单、清单（浏览器译） | `manifest.json`；DOM `translate="no"` |

Protected DOM：`Manifest`、`policyVersion`、`capabilityDigest`、`trace_id`、文件名、SHA-256。

## 4. 分波验收门槛

| ID | Wave | 门槛 |
|---|---|---|
| AC-W1-01 | 1 | `lucy_begin_question` 的 `args_summary` 不含 `question` / `questionPreview` / `intentSummary`；自然语言只进入有 retention 的 `conversation_turns` |
| AC-W1-02 | 1 | 真实 Proxy allow/deny 行在 runtime 健康时 `policy_version` 非空，并与 snapshot 一致 |
| AC-W1-03 | 1 | 测试不得仅手填 `writeLog({policyVersion})` 冒充 Proxy 路径通过 |
| AC-W2-01 | 2 | Proxy 从 initialize **响应**取得 `mcp-session-id` 并绑定请求 `clientInfo`；后续调用有 `lucy_session_id` / `client` / `client_version` |
| AC-W2-02 | 2 | NL「table list」不再写入 `tables=["list"]` |
| AC-W2-03 | 2 | `export-pack` 含 `access_log.csv` + `manifest.json`（筛选、行数、SHA-256） |
| AC-W3-01 | 3 | 证据包含 sources、permission_snapshots（按 hash 去重）、auth_failure、maintenance；Manifest 报告逐文件筛选和完整性缺口，可离线对账 |
| AC-W3-02 | 3 | 至少一次成功 `lucy_query` UAT：`generated_sql`、sources、行列数、策略字段闭环 |

**放行规则**：W1 未完成 → 不得称「审计证据」；W3 + UAT 绿 → 才允许客户场景使用「审计证据包」名称。

## 5. 核心流程（伪代码）

```text
FUNCTION summarizeArgsForAudit(tool, args) -> summary:
  base = filterKeys(args, drop=SENSITIVE_ARG_KEY_RE, maxKeys=8)
  IF tool == "lucy_begin_question" OR base has keys {question, intentSummary}:
    RETURN base WITHOUT {question, questionPreview, intentSummary}
    # natural language belongs only in conversation_turns, where retention applies
  RETURN base

FUNCTION auditMeta(identity, decisionReason) -> fields:
  fields = { decisionReason, tokenLabel, tokenHashPrefix, clientVersion }
  runtimePv = getPolicyRuntimeStatus().policyVersion   # may be ""
  snap = permissionSnapshot(identity) CATCH undefined
  IF snap:
    fields += roleIds, permissionSnapshotHash, effectiveTablesCount
    fields.policyVersion = snap.policyVersion
    fields.capabilityDigest = snap.capabilityDigest
    fields.permissionSnapshot = {
      hash, rolesJson, resolvedJson,
      capabilityDigest, toolClassificationVersion
    }
  ELSE:
    fields.policyVersion = runtimePv   # still write when snapshot fails
  RETURN fields

FUNCTION correlationMeta(headers) -> corr:
  corr.lucyTurnId = normalize(header("x-lucy-turn-id"))
  corr.lucyPlatform = normalize(header("x-lucy-platform"))
  corr.lucySessionId = normalize(header("x-lucy-session-id"))
    OR normalize(header("mcp-session-id"))
  RETURN corr

FUNCTION bindInitializeClient(request, upstreamResponse, identity):
  clientInfo = request.params.clientInfo
  responseSessionId = normalize(upstreamResponse.header("mcp-session-id"))
  IF responseSessionId exists:
    audit.lucySessionId = responseSessionId
    IF clientInfo.name exists:
      setSessionClient(responseSessionId, identity, clientInfo.name, clientInfo.version)
  RETURN audit

FUNCTION looksLikeSql(text) -> bool:
  t = strip(text)
  RETURN t matches /^(with|select|describe|explain)\b/i
     OR t matches /^show\s+(tables|columns|databases|create|indexes?|status|variables)\b/i

FUNCTION extractQueryTables(query) -> tables:
  IF NOT looksLikeSql(query): RETURN []
  RETURN unique captures of QUERY_TABLE_RE on query

FUNCTION scrubArgsSummaryRow(jsonText) -> { changed, nextJson }:
  obj = JSON.parse(jsonText) CATCH return unchanged
  DELETE obj.question, obj.questionPreview, obj.intentSummary
  RETURN { changed: true, nextJson: JSON.stringify(obj) }

FUNCTION applyScrub(actor, reason, requestId):
  REQUIRE non-empty reason
  rows = all access_log rows with args_summary
  updates = changed scrubArgsSummaryRow(rows)
  beforeDigest = sha256(stable(id + oldValue))
  afterDigest = sha256(stable(id + newValue))
  TRANSACTION:
    update rows
    append audit_maintenance_log(actor, reason, requestId, counts, algorithmVersion,
                                 beforeDigest, afterDigest)
  RETURN counts + digests + maintenanceEventId

FUNCTION buildExportManifest(normalizedFilter, files[], completeness, limits, appVersion) -> manifest:
  RETURN {
    schemaVersion: "audit-export-manifest/v1",
    generatedAt: nowISO8601(),
    timezone: "UTC",
    appVersion,
    filter: normalizedFilter,
    includeProtocol: normalizedFilter.includeProtocol == true,
    completeness,
    limits,
    files: [{ name, rowCount, filterScope, sha256 } for each file]
  }

FUNCTION buildEvidencePack(filter) -> zip:
  accessCsv = renderAccessLogCsv(filter)           # UTF-8 BOM
  sourcesCsv = renderSourcesCsv(filter)            # W3
  snapshotsJsonl = renderSnapshotsJsonl(filter)    # W3, dedupe by hash
  authFailCsv = renderAuthFailureCsv(time + user + clientIp)
  maintenanceJsonl = renderMaintenanceJsonl(time)
  files = [accessCsv, sourcesCsv, snapshotsJsonl, authFailCsv, maintenanceJsonl]
  completeness = find missing snapshot hashes, rows without snapshot, successful lucy_query without sources
  REQUIRE access rows <= MAX_ROWS AND uncompressed bytes <= MAX_BYTES ELSE HTTP 413
  manifest = buildExportManifest(normalizeEffectiveFilter(filter), files, completeness, limits,
                                 resolveLucyVersion())
  RETURN zip named audit-pack-YYYYMMDDTHHMMSSZ-<8hex>.zip
```

## 6. 数据与 API 契约

### 6.1 写入契约

| 字段 | 规则 |
|---|---|
| `access_log.args_summary` | 禁止 `question` / `questionPreview` / `intentSummary`；不复制任何自然语言问句 |
| `access_log.policy_version` | `auditMeta` 必写；snapshot 失败时写 runtime `policyVersion` |
| `access_log.capability_digest` | snapshot 成功时写入；与 `permission_snapshots.capability_digest` 一致 |
| `access_log.lucy_session_id` | 普通请求：`x-lucy-session-id` ∨ 请求 `mcp-session-id`；initialize：优先响应 `mcp-session-id` |
| `access_log.tables` via query extract | 仅 `looksLikeSql` 为真时跑 `QUERY_TABLE_RE` |

### 6.2 API

| Method | Path | 说明 |
|---|---|---|
| `GET` | `/api/admin/audit/export` | **调用流水 CSV**（既有；可选 `bom=1`） |
| `GET` | `/api/admin/audit/export-pack` | **审计证据包** zip；W2 最少含 `access_log.csv` + `manifest.json`；W3 扩展 |
| `POST` | `/api/admin/audit/args-summary/scrub` | body: `{ dryRun?: boolean, reason?: string }`；默认 dry-run；apply 时 `reason` 必填 |

### 6.3 Manifest schema

```jsonc
{
  "schemaVersion": "audit-export-manifest/v1",
  "generatedAt": "2026-09-02T12:00:00.000Z",
  "timezone": "UTC",
  "appVersion": "string",
  "filter": { "user": null, "since": null, "until": null, "callSource": null, "includeProtocol": false },
  "includeProtocol": false,
  "limits": { "maxRows": 10000, "maxBytes": 67108864, "exportedUncompressedBytes": 1234 },
  "completeness": {
    "rowsWithoutPermissionSnapshot": 0,
    "missingPermissionSnapshotHashes": [],
    "missingSourceAccessLogIds": [],
    "complete": true
  },
  "files": [
    { "name": "access_log.csv", "rowCount": 42, "filterScope": "normalized_access_log_filter", "sha256": "hex" }
  ]
}
```

### 6.4 可信代理 IP

部署侧通过环境变量 `LUCY_TRUST_PROXY=true`（见 `extractRequestClientMeta` / `trustProxyEnabled`）启用 `X-Forwarded-For` / `X-Real-IP`。默认关闭以防伪造。Demo Docker 网关 IP（如 `10.42.0.1`）不视为产品缺陷；生产须在反向代理后显式开启并限制入口。

## 7. 历史清理

- CLI：`webui/scripts/scrub-access-log-args-summary.ts`（`--dry-run` 默认；`--apply` 落盘）。
- Admin：`POST /api/admin/audit/args-summary/scrub`。
- 算法：§5 `applyScrub`；移除三种自然语言副本；幂等；保留行与其它列。
- apply 必须在同一事务追加 `audit_maintenance_log`，记录 actor/reason/requestId、算法版本、计数与前后聚合 digest；不得记录被清理原文。

## 8. 测试与验证脚本

| 层级 | 要求 |
|---|---|
| unit | `looksLikeSql` / `summarizeArgsForAudit` / `scrubArgsSummaryRow` / Manifest SHA |
| integration | 启动真实 Proxy + mock upstream；真实 allow/deny 写策略字段；initialize 响应 Session 绑定；begin_question 无自然语言副本 |
| UAT | 成功 `lucy_query` 必须经 `POST /mcp`，断言 generated SQL、行列数、sources、策略字段；不得直接 seed access_log |
| scripts | `webui/scripts/verify-audit-hardening-w{1,2}.ts`、`webui/scripts/verify-audit-hardening-w3-uat.ts` |

禁止：仅调用 `writeLog({ policyVersion })` 即判定 AC-W1-02 通过。

## 8.1 非功能与失败契约

- 架构：有界内存构包；调用流水默认最多 `LUCY_AUDIT_EXPORT_MAX_ROWS=10000` 行，未压缩内容默认最多 `LUCY_AUDIT_EXPORT_MAX_BYTES=67108864` 字节。
- sources / snapshots 查询按最多 400 个 key 分批，禁止为全量 ID 构造单条无界 `IN (...)`。
- 超限返回 HTTP `413` + `ERR_AUDIT_EXPORT_TOO_LARGE`；调用方缩小筛选范围后重试。
- CSV 与 zip 响应必须带 `Cache-Control: private, no-store`。
- `appVersion` 必须来自 `resolveLucyVersion()`（`LUCY_VERSION` / 仓库 `VERSION`），不得读取 `webui/package.json`。
- Manifest `complete=false` 不阻止导出，但不得对外宣称该包已完成正式审计闭环；缺口必须可离线读取。
- ZIP writer 为共享基础实现；现有 semantic asset export 与 audit pack 复用同一实现，并用标准 `unzip -t` 做交付验证。

## 9. 与既有 Spec 关系

| Spec | 关系 |
|---|---|
| 08 §10 | 本 Spec 收紧：`args_summary` 与 `question_preview` 同脱敏，禁止原文旁路 |
| 08 §15 #5 | 主 CSV 仍不含 sources；独立证据包端点兑现「未来离线分析」 |
| 07 写序 | `auditMeta` 必须落实 `access_log.policy_version` |
| 98 §10.3 | `policy_version` 入 access_log；digest 入 snapshot，并冗余入 access_log 以支撑离线 CSV |
| 124 | auth_failure 写入契约不变；W3 增加导出 |

## 10. 实施波次

见 [`plans/wo-202609-02-access-log-audit-evidence-hardening.md`](plans/wo-202609-02-access-log-audit-evidence-hardening.md)。
