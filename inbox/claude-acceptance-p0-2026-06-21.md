I've completed a thorough static review of both commits and all listed files plus the test suite. (Note: I could not execute `npm test`/`npm run build` — Bash is denied in this session — so the verdict below is from code/test reading, not a live run.)

---

## 验收结论：未发现 P0/P1 阻断

P0-1 ~ P0-4 全部落地，且实现范围已超出 P0（顺带完成了 P1-5 actor 语义标注、P1-6 query 审计、P2-7 config-audit 页面、P2-8 correlation、P2-9 sources、P2-10 返回规模）。两个重点提交均正确。下面按 severity 列出 findings。

---

## Findings

### P2 — `denied` 记录的「裁决原因」未做视觉突出（P0-1 部分未达成「突出显示」）
`webui/src/pages/admin/Audit.tsx:53` — 裁决原因列对所有 outcome 一律用 `text-fg-muted` 渲染 `{entry.decisionReason ?? "—"}`，denied 行只有状态徽章（`pl-status-validation_failed`，行 42-43）是红色，**reason 文本本身不随 denied 高亮**。
- 验收口径「打开 `?outcome=denied` 即可看到为什么拒绝」**已满足**（列 + 详情展开都展示 `decisionReason`/`roleIds`/`permissionSnapshotHash`/`effectiveTablesCount`，行 87-107），但 TODO 里「对 denied 记录突出显示拒绝原因」这一条只达成到「可见」，未达成「突出」。建议 denied 时给该 cell 加 danger 色。非阻断。

### P2 — summary 计数受 `outcome` 等过滤器联动，标签语义可能误导
`webui/server/admin/audit.ts:380-387` — summary 用 `baseWhere`（不含协议过滤，但**含** user/tool/outcome/since/until/tableSearch/session/turn/platform）。
- 好处：`protocolCalls/businessCalls/deniedCalls/dataBearingCalls` 不受 `includeProtocol` toggle 与分页影响，**计数本身可信、稳定**（这正是 P0-2 的核心诉求，已满足；`admin-audit.test.ts:109-114` 覆盖）。
- 但若用户加了 `outcome=ok`，「拒绝」卡片会显示 0；加了 `tool=sl_query`，「协议调用」显示 0。卡片标签（「业务调用/默认展示」「拒绝/ACL 拒绝」，`Audit.tsx:296-299`）是全局语态，与「当前过滤子集」的真实含义有落差。非阻断，建议在标题处标注「当前筛选范围内」。

### P2 — schema 迁移逻辑在两个模块重复，存在漂移风险
`webui/server/proxy/audit.ts:43-61` 与 `webui/server/admin/audit.ts:8-26` 各维护一份**完全相同**的 `ACCESS_LOG_COLUMNS`（17 项）+ `ensureColumn` + 新索引创建。两个模块各开一个 better-sqlite3 连接指向同一文件。
- 当前正确：两份数组逐字一致；`ensureColumn` 在新索引（`idx_al_user_token_ts` 引用 `token_hash_prefix`、`idx_al_session_ts` 引用 `lucy_session_id`）创建**之前**执行（proxy `:122-128`、admin `:141-147`），顺序安全；`proxy-audit.test.ts:33-80` 正是验证「旧表 → 补列 → 建索引」这条路径，覆盖到位。
- 风险：未来若只改一处数组/顺序，另一处会静默落后。建议抽到单一 migration 模块。非阻断。

### P2 — export 与 tools/call 响应缓冲无上限
- `webui/server/admin/audit.ts:478-480`：`SELECT * ... ORDER BY ts DESC`（导出无 LIMIT，list 有 500 上限），全量进内存拼大字符串。
- `webui/server/proxy/mcp-proxy.ts:507-513`：tools/call 一边 `res.write` 一边 `chunks.push` 全量缓冲以做 sniff，无响应大小上限（请求侧有 `MAX_BODY_BYTES`）。
- 大表/大结果集下有内存压力，但属预期内的「全量审计导出/响应嗅探」，且为既有设计。非阻断。

---

## 重点验收项逐条核对（均通过）

**1. Audit UI 解释 denied / decisionReason / roleIds / permissionSnapshotHash / effectiveTablesCount** ✅
`Audit.tsx:53`（列）+ `:87-107`（详情展开全部字段）；denied 路径在 `mcp-proxy.ts:432-447` 经 `...meta`（`auditMeta`，`:86-106`）带上 `decisionReason=acl.reason`、`tokenLabel`、`tokenHashPrefix`、`roleIds`、`permissionSnapshotHash`、`effectiveTablesCount`。`decisionReason` 直接携带如 `table_forbidden:...` 文本，满足「页面上可直接解释」。

**2. 协议调用默认隐藏 + 可切换 + summary 可信** ✅
`audit.ts:370-374`（默认 `tool NOT IN (protocol)`，`includeProtocol=true` 时显示）；前端 toggle `Audit.tsx:279-286`，导出同样透传 `includeProtocol`（`:475`）。summary 见上（计数稳定可信）。

**3. token_label / token_hash_prefix 端到端、不记明文、支撑 per-token last used** ✅
- 写入：`identity.ts:136-141` 仅存 `tokenHashPrefix = hash.slice(0,19)`（`sha256:`+12 hex），**从不记原始 token**；proxy 全部 recordAudit 路径（denied/kx_catalog/tools/list/tools/call/passthrough）都经 `auditMeta` 带 token 归因 → **无新审计盲区**。
- per-token last used：`agents.ts:142-183` 用 `ROW_NUMBER() OVER (PARTITION BY user_id, token_hash_prefix)` 取每 token 最新；`userToAgent` 以 `t.hash.slice(0,19)` 关联（`:201-203`），与 identity 前缀切法一致，键能对上。前端 `AgentDetail.tsx:236-240` 展示 last_used/last_tool/last_outcome。历史行 `token_hash_prefix IS NULL` 被自然排除（无法回填，符合预期）。
- smoke 测试 `mcp-proxy-smoke.test.ts:176-177` 校验 `token_hash_prefix === tokenHash(TOKEN).slice(0,19)`。

**4. CSV 补齐字段且不泄漏** ✅
`audit.ts:483-545` 含全部审计字段（token_label/hash_prefix/session/query_*/response_*/role_ids/permission_snapshot_hash/decision_reason）。脱敏：`args_summary`/`error_detail` 经 `redactJsonString`，CSV 公式注入经 `csvCell`（`^[=+\-@]` 前置 `'`）。`admin-audit.test.ts:144-159` 验证 CSV 不含 `super-secret`/`private123`/`hunter2`/`leaked`，且 `'=hermes` 被转义。**无明文 token 列**。多层防御：写入侧 `summarizeArgs`（`mcp-proxy.ts:108-114`）已先过滤敏感 key，读出/导出侧再 redact。

**5. MCP proxy upstream header 修复正确、兼容性低风险** ✅
`mcp-proxy.ts:56-64`：从「黑名单（仅去 authorization/host）」改为「白名单（仅放行 content-type / mcp-session-id / mcp-protocol-version）」并强制 `accept: application/json, text/event-stream` + 注入内部 token。
- 关键 MCP streamable-HTTP 头（session-id、protocol-version）在白名单内，未丢。
- 副作用是**正向的**：旧逻辑会透传客户端 `accept-encoding: gzip`，可能导致上游 gzip 响应、proxy 端 `JSON.parse` 失败；新逻辑丢弃 accept-encoding，消除该隐患。`x-lucy-*` correlation 头本就只供 proxy 自身审计（`correlationMeta` 直接读 `req.headers`，`:116-122`），无需转发上游。
- `mcp-proxy-smoke.test.ts:168` 锁定 `accept` 值。未见兼容性回归。

**6. 旧 SQLite schema 迁移可靠** ✅
顺序正确（补列先于建新索引），幂等（`db` 单例 + `IF NOT EXISTS` + `ensureColumn`），`proxy-audit.test.ts:33-80` 直接以「无新列的 legacy 表」回归，验证 `lucy_session_id`/`response_bytes` 补列且数据可写可读。唯一保留意见见上面 P2（双份重复定义）。

---

## Remaining risks / P2 建议（汇总，非阻断）
1. denied 行的 `decisionReason` 文本加 danger 配色，真正「突出」拒绝原因。
2. summary 卡片标注「当前筛选范围内」，避免 `outcome`/`tool` 过滤时计数被误读为全量。
3. 把 `access_log` migration（`ACCESS_LOG_COLUMNS` + 索引顺序）抽成单一共享模块，消除 proxy/admin 两份漂移风险。
4. export 与 tools/call 响应缓冲设上限或分页/流式，防止超大结果集内存压力。
5. `error_detail` 仅按 `key=value` 模式 redact 上游错误串；若上游把敏感值放在非敏感 key 的自由文本里，仍可能残留——可对 error_detail 也走结构化 redact。

如需我把上述 P2 整理成可执行的 todo/issue 文本，或针对某条 finding 给出最小补丁建议，告诉我即可（当前仅做了只读验收，未改任何文件）。
