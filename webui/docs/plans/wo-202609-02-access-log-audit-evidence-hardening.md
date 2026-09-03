# WO-202609-02：访问日志审计证据硬化

| 元数据 | 内容 |
|---|---|
| 文档类型 | Plan / Work Order |
| 版本 | v1.1（审阅修订） |
| 日期 | 2026-09-02 |
| 权威契约 | [Spec 137](../137-access-log-audit-evidence-hardening-spec.md) |
| 适用范围 | Wave 1–3 实现、迁移、验证与放行 |

## 交付原则与顺序

1. W1a「停止新增自然语言副本」独立优先交付；不得等待证据包。
2. W1b 历史 scrub 只有在事务留痕、dry-run 和幂等测试通过后才允许 apply。
3. W2 完成真实 initialize Session 绑定与最小证据包；不得用手填 `writeLog` 验收。
4. W3 完成完整性缺口报告和真实 `lucy_query` UAT 后，UI 才使用「导出审计证据包」。
5. SHA-256 仅为完整性自检；本 WO 不交付 CA 签名、WORM 或法律取证级防篡改。

## Wave 1 — 隐私与裁决证据（P0）

| 任务 | 实现文件 | 验证 |
|---|---|---|
| access_log 不保存 `question` / `questionPreview` / `intentSummary` | `webui/server/proxy/audit-privacy.ts`、`webui/server/proxy/mcp-proxy.ts` | `audit-privacy.test.ts` + 真实 begin_question Proxy smoke |
| allow/deny 写 `policy_version` / `capability_digest` | `webui/server/proxy/audit-meta.ts`、`mcp-proxy.ts` | 真实 Proxy allow/deny 后查 SQLite；helper 单测仅作补充 |
| scrub dry-run / apply / 幂等 | `webui/server/proxy/audit.ts` | `mcp-proxy-audit-meta.test.ts` |
| scrub 变更留痕 | `audit_maintenance_log`；actor/reason/requestId/算法版本/计数/前后 digest | apply 与 maintenance insert 同事务；失败不得部分更新 |
| CLI/Admin 入口 | `webui/scripts/scrub-access-log-args-summary.ts`、`webui/server/admin/audit.ts` | apply 缺 reason 返回 400；CLI 默认 dry-run |

验收：AC-W1-01..03。回滚时只回滚代码；已 scrub 的自然语言不得恢复，maintenance 事件保留。

## Wave 2 — Session、SQL Guard 与最小证据包

| 任务 | 实现文件 | 验证 |
|---|---|---|
| initialize 响应 Session 绑定 clientInfo | `webui/server/proxy/mcp-proxy.ts`、`identity.ts` | mock upstream 返回 `mcp-session-id`，后续真实调用查 client/version |
| statement-leading `looksLikeSql` | `webui/server/proxy/audit-privacy.ts` | SQL 正例；“table list”与“please select … from …”负例 |
| export-pack + 标准化 Manifest | `webui/server/admin/audit.ts` | ZIP 内容、SHA、有效过滤、逐文件 filterScope |
| 共享 ZIP writer | `webui/server/proxy/zip-store.ts`、`webui/server/semantic-asset-export.ts` | 单测解析 + 交付时 `unzip -t` |
| 安全响应与权威版本 | `webui/server/admin/audit.ts`、`webui/server/lucy-version.ts` | `private, no-store`；Manifest 为产品 VERSION |

验收：AC-W2-01..03。

## Wave 3 — 完整证据与真实 UAT

| 任务 | 实现文件 | 验证 |
|---|---|---|
| 包含 sources / snapshots / auth_failure / maintenance | `webui/server/admin/audit.ts` | 各文件 rowCount/SHA 与筛选范围一致 |
| 完整性缺口 | Manifest `completeness` | 缺 snapshot/source 时显式列 ID/hash，`complete=false` |
| 有界导出 | `LUCY_AUDIT_EXPORT_MAX_ROWS` / `LUCY_AUDIT_EXPORT_MAX_BYTES`；400-key 分批查询 | 超限 413；不得触发 SQLite 参数上限 |
| Admin 双入口术语 | `webui/src/pages/admin/Audit.tsx` | 调用流水与审计证据包不得混称；Manifest 防浏览器翻译 |
| 成功查询 UAT | `mcp-proxy-smoke.test.ts` + `verify-audit-hardening-w3-uat.ts` | 真实 `POST /mcp`：generated SQL、sources、行列数、policy/digest 闭环 |

验收：AC-W3-01..02。只有 Manifest `complete=true` 的 UAT 包可用于客户正式审计验收。

## 失败、发布与回滚

- export 超限：HTTP 413 / `ERR_AUDIT_EXPORT_TOO_LARGE`；管理员缩小时间或身份筛选后重试。
- scrub apply 缺原因：HTTP 400 / `ERR_SCRUB_REASON_REQUIRED`。
- snapshot/source 缺口：允许导出但 Manifest 标记 incomplete；不得按正式审计包放行。
- 发布顺序：Proxy 隐私修复 → scrub dry-run → 人工确认计数 → scrub apply → export-pack → Admin 入口。
- 回滚：API/UI/Proxy 可回滚；数据库新增表为兼容性保留；不得恢复已清除的问句副本。

## 验证命令

```bash
cd webui
npm test -- --run \
  server/__tests__/mcp-proxy-smoke.test.ts \
  server/__tests__/mcp-proxy-instructions.test.ts \
  server/__tests__/mcp-proxy-audit-meta.test.ts \
  server/__tests__/admin-audit.test.ts \
  server/__tests__/audit-privacy.test.ts

npx tsx scripts/verify-audit-hardening-w1.ts
npx tsx scripts/verify-audit-hardening-w2.ts
npx tsx scripts/verify-audit-hardening-w3-uat.ts

npm run lint:spec
npm run lint:terminology
```

## Definition of Done

- AC-W1..W3 均由真实路径或明确的 unit 边界验证，没有 seed 行冒充 Proxy/UAT。
- Manifest 可复现筛选、逐文件作用域、产品版本、容量上限及完整性缺口。
- scrub 可追责但不保存被删除原文。
- 修复报告记录测试结果、遗留限制以及 SHA 非防篡改签名的边界。
