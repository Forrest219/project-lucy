# Audit Query Artifact Cold Store Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Audit Query Artifact Cold Store Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-20 |
| 撰写人 | Auto |
| 委托人 | xingchen |
| 基于材料 | `webui/docs/62-trace-evidence-kernel-spec.md`；`docs/SYSTEM_HANDBOOK.md` §3.5 热/冷库；已批准生产溯源 MVP |
| 适用范围 | MCP Proxy 查询原文加密冷存、Admin 受控解密查看、热库仅存引用 |
| 输出位置 | `webui/docs/124-audit-query-artifact-cold-store-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 124 |
| 关联页面 | `/admin/audit` |
| 关联域 | Access Control / Audit |
| 状态 | Implemented |
| 日期 | 2026-08-20 |

## 1. 背景

审计热库（`.ktx-ui/audit.sqlite`）禁止存完整 SQL / SQL AST 原文，导致生产事故难以按 `requestId` / `query_hash` 还原「当时跑了什么」。业务需要受控生产溯源，且不得打穿热库红线。

## 2. 目标

1. Proxy 在工具调用时把查询原文（raw SQL、生成 SQL 或规范化语义查询）写入**加密冷存**。
2. 热库 `access_log` 仅增加 `query_artifact_ref` 指针；列表与默认 API 不返回明文。
3. Admin 通过受控 API 解密查看；每次查看写入 forensic 访问审计。
4. 缺密钥时 MCP 不失败；冷写跳过。

## 3. 非目标

- 对象存储 / S3 归档流水线（同一 artifact 格式可二期搬迁）
- 结果行明文冷存
- 削弱 `raw_query_forbidden`
- Security Eval 从日志自动生成 AST 断言
- 在 `/admin/audit` 列表默认展示全文

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- Query Artifact: UI 主术语为「查询原文（加密）」；指冷存中的加密查询载荷
- Query Artifact Ref: UI 主术语为「查询原文引用」；热库指针，不是明文
- View Query Artifact: UI 主术语为「查看查询原文」；受控解密动作

Forbidden terms:
- 冷库明文 SQL、热库 SQL 原文、随意「解密」无授权语境

## 5. 存储边界

| 层 | 路径 / 表 | 允许 | 禁止 |
|---|---|---|---|
| 热库 | `.ktx-ui/audit.sqlite` `access_log` | `query_hash`、`query_preview`、`query_artifact_ref` | 完整 SQL、结果行、Token 明文 |
| 冷存 | `.ktx-ui/audit-cold/query-artifacts/*.json`（`LUCY_AUDIT_COLD_DIR` 可覆盖） | AES-256-GCM 密文 + 元数据 | 明文 SQL 落盘 |
| Forensic 审计 | `query_artifact_access_log` | 谁在何时查看了哪条 ref | 不把明文写入该表 |

## 6. 加密与密钥

- 环境变量：`LUCY_AUDIT_QUERY_KEY`（32 字节 raw / base64 / hex 均可；实现归一化为 32 bytes）
- 算法：AES-256-GCM；每条 artifact 独立 12-byte nonce
- 无密钥：不写冷存、不注入 `include:["sql"]` 额外要求以外的行为变更；热库照常
- 密钥不得写入 git、audit sqlite、API 默认响应

## 7. 捕获规则

| 场景 | `kind` | 载荷 |
|---|---|---|
| args 含 raw `sql`/`query`（含 deny） | `raw_sql` | 原文字符串 |
| `lucy_query` / 上游 `sl_query` 结果含 `sql` | `generated_sql` | 生成 SQL |
| 仅有语义参数 | `semantic_query` | 规范化 measures/dimensions/filters/segments/order_by/limit |

当密钥可用且工具为 `lucy_query` 时，Proxy 向上游合并 `include` 含 `sql`，以便拿到 `generated_sql`；若上游仍无 SQL，回退 `semantic_query`。

冷写失败不得阻断 MCP 响应。

## 8. API

### `GET /api/admin/audit/query-artifacts?requestId=` 或 `?ref=`

- 成功：返回 `{ kind, plaintext, queryHash, tool, createdAt, requestId, traceId }`
- 缺密钥：`503` + `ERR_QUERY_ARTIFACT_KEY_MISSING`
- 未找到：`404`
- 副作用：写入 `query_artifact_access_log`

默认 `GET /api/admin/audit` 列表仅暴露 `queryArtifactRef`（有则），不暴露 plaintext。

## 9. UI

`/admin/audit` 调用流水展开行：若存在 `queryArtifactRef`，显示「查看查询原文」；确认后请求 API 并在只读区域展示。不在列表列默认渲染全文。

## 10. Acceptance Criteria

1. 热库与 Admin 默认列表无完整 SQL。
2. 密钥可用时，`lucy_query` 成功可按 `requestId` 解密得到 SQL 或 semantic payload。
3. deny 的 raw query 可溯源。
4. 缺密钥时 MCP 成功路径不受影响。
5. 每次解密查看有 forensic 审计行。
6. hot-store blacklist / release evidence 红线测试保持通过。

## 11. Design System Compliance

引用 Foundations / Components（Drawer / Button / code 块）。本功能不新增视觉模式；沿用现有 Audit 展开行与 ghost button。
