# Module 1 UAT 用例集 — Agent 权限管控

| 元数据 | 内容 |
|---|---|
| 文档名称 | Module 1 UAT 用例集 — Agent 权限管控 |
| 文档类型 | Test Report |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-19 |
| 撰写人 | Claude |
| 委托人 | zhangxingchen |
| 基于材料 | project-lucy/docs/design-agent-permissions.md v1.0，commit 5e6f6e2 |
| 适用范围 | 人工 UAT 验收，需 dev server 在本机运行 |
| 输出位置 | project-lucy/docs/uat-agent-permissions.md |

---

## 前置条件（全局）

- `pnpm dev` 已启动，WebUI 在 `http://localhost:5173`，MCP Proxy 在 `:7879`
- `webui/config/access.yaml` 存在，包含至少 1 个已有 user（如 `zhangsan`）
- `.ktx-ui/audit.sqlite` 存在（含 `access_log` / `revoked_tokens` 表）

---

## P1 — Agent 实例列表 `/admin/agents`

| ID | 标题 | 操作步骤 | 期望结果 |
|---|---|---|---|
| TC-01 | 导航显示「访问治理」分组 | 打开任意页面，观察左侧导航 | 导航中出现「访问治理」分组，含「Agent 实例」和「访问日志」两条链接 |
| TC-02 | 列表正常展示 | 访问 `/admin/agents` | 显示卡片列表；每张卡含 userId、显示名、启用徽章、token 数/表数/工具数摘要、最近访问时间 |
| TC-03 | 统计数据从 audit.sqlite 派生 | 对比卡片上「调用次数」与 `SELECT COUNT(*) FROM access_log WHERE user_id='zhangsan' AND ts >= datetime('now','-7 days')` | 数值一致（±0） |
| TC-04 | 搜索过滤 | 在搜索框输入 `zhang` | 列表只显示 id 或 name 包含 `zhang` 的 Agent |
| TC-05 | 状态过滤 | 下拉选「已禁用」 | 列表只显示 `enabled: false` 的 Agent |
| TC-06 | 空态显示 | 临时备份 `access.yaml`，清空 users 数组，刷新页面 | 显示空态文案 + 「新建第一个 Agent」按钮；操作完成后还原 yaml |
| TC-07 | 「查看日志」跳转 | 点击某 Agent 卡片的「查看日志」 | 跳转到 `/admin/audit?user=<userId>`，日志自动过滤该用户 |

---

## P2 — 新建 Agent（含 dryRun 预览）

| ID | 标题 | 操作步骤 | 期望结果 |
|---|---|---|---|
| TC-08 | 打开新建表单 | 在列表页点「新建 Agent」 | 弹出/跳转新建表单，含 id、显示名、备注、工具权限、表权限字段 |
| TC-09 | 正常新建 Happy Path | 填 id=`uat-test-01`、name=`UAT测试Agent`、工具选 `sl_query`+`wiki_search`、表选 `dataforai.superstore_orders`；点「预览」 | 显示 unified diff，包含新增的 yaml 段，`enabled: true`，tokens 为空 |
| TC-10 | 确认保存后写入 yaml | 在 diff 页点「保存」 | toast 提示「保存成功」；`git diff webui/config/access.yaml` 或直接查看文件，出现 `id: uat-test-01` 段 |
| TC-11 | id 重复拒绝 | 再次新建，id 填 `uat-test-01` | 返回错误 `409 AGENT_ID_TAKEN`；UI 显示错误提示，不写入 yaml |
| TC-12 | id 格式校验 | id 填 `ua test!` | 前端校验报错（正则 `^[A-Za-z0-9_-]{1,32}$`），不发请求 |
| TC-13 | id 字段不可改 | 新建成功后进入详情页 | 基本信息 Tab 中 userId 显示为只读，不可编辑 |
| TC-14 | 工具通配选项 | 在工具权限勾选「通配 (*)」 | 具体工具 checkbox 置灰；yaml diff 里 tools 为 `['*']` |
| TC-15 | 全局 deny 工具不可选 | 工具列表中 `sql_execution` / `memory_ingest` | 显示「全局禁用」标签，checkbox 置灰无法勾选 |

---

## P3 — Agent 详情 / 编辑 ACL

| ID | 标题 | 操作步骤 | 期望结果 |
|---|---|---|---|
| TC-16 | 详情页 5 个 Tab 显示 | 进入 `/admin/agents/uat-test-01` | 出现「基本信息 / Token / 工具权限 / 表权限 / 变更预览」5 个 Tab |
| TC-17 | 修改显示名 | 基本信息 Tab 改 name 为 `UAT测试Agent-改`，点「预览」 | 变更预览 Tab 显示 diff，name 字段有变更 |
| TC-18 | 启用/禁用 Toggle | 点击「禁用」按钮 | 进入变更预览 Tab（不立即写盘）；diff 显示 `enabled: false` |
| TC-19 | 确认禁用写入 | 在变更预览 Tab 点「保存」 | yaml 中 `enabled: false`；Agent 列表徽章变为「已禁用」 |
| TC-20 | 禁用后 proxy 拒绝请求 | 使用 uat-test-01 的 Bearer token 调用 `:7879/mcp`（需等 ≤30s TTL） | 收到 `401 Unauthorized` |
| TC-21 | ACL 并发保护 | 手动编辑 yaml 改 name（模拟外部修改），再在 UI 提交 PATCH | 返回 `409`，提示「yaml 已被其他来源修改，请刷新」 |
| TC-22 | 删除 Agent | 在详情页点「删除」，确认弹框 | yaml 中 `uat-test-01` 段消失；返回列表页；`SELECT * FROM revoked_tokens WHERE reason='agent_deleted'` 有对应 hash 记录 |

---

## P4 — Token 生命周期

| ID | 标题 | 操作步骤 | 期望结果 |
|---|---|---|---|
| TC-23 | 创建 Token Happy Path | 进入 `/admin/agents/uat-test-01/tokens/new`，填 label=`cursor-mac`，点「生成 Token」 | 同页面切换为「Token 已生成」视图，展示 64 字符 hex 明文 + 复制按钮 + `.mcp.json` 配置示例 |
| TC-24 | Token 明文仅出现一次 | 生成成功后点「我已保存，关闭」，回到详情页 Token Tab | Token 列表只显示 `sha256:xxxx...` 前缀，无明文；没有「查看明文」按钮 |
| TC-25 | yaml 只写 hash | 查看 `webui/config/access.yaml` | `tokens` 里 hash 字段有值（`sha256:...`），无 token 明文 |
| TC-26 | label 唯一性 | 再次新建 token，label 仍填 `cursor-mac` | 返回 `409 TOKEN_LABEL_TAKEN`，token 未生成 |
| TC-27 | 生成的 token 可用于 proxy | 用明文 token 配 `Authorization: Bearer <token>` 调用 `:7879/mcp`（工具+表在 ACL 内） | 正常响应；`/admin/audit` 可见该调用记录 |
| TC-28 | 撤销 Token | 在 Token Tab 点「撤销」→ 确认 | yaml 中该 label 消失；`SELECT * FROM revoked_tokens WHERE reason='manual_revoke'` 有该 hash |
| TC-29 | 撤销后 ≤30s 内 toast 提示 | 撤销成功后观察 toast 内容 | 提示「已撤销。代理可能在 30 秒内仍接受该 token。」 |
| TC-30 | 撤销 30s 后 proxy 拒绝 | 等待 30s 后用旧 token 访问 proxy | 返回 `401`（revoked_tokens 命中） |

---

## P5 — 访问日志 `/admin/audit`

| ID | 标题 | 操作步骤 | 期望结果 |
|---|---|---|---|
| TC-31 | 日志列表默认视图 | 访问 `/admin/audit` | 显示最近 24h 调用，分页 20 条，含时间/用户/工具/状态列 |
| TC-32 | 展开查看详情 | 点击某行 | 展开显示 args JSON、`duration_ms`、`error_detail`（如有） |
| TC-33 | 按用户过滤 | 下拉选 `uat-test-01` | 只显示该用户的记录；`total` 数量变化 |
| TC-34 | 按状态过滤 | 下拉选「denied」 | 只显示 `outcome=denied` 的记录 |
| TC-35 | 按工具过滤 | 下拉选 `sl_query` | 只显示 `sl_query` 调用 |
| TC-36 | 搜索表名 | 表名输入框填 `superstore` | 只显示 tables 字段包含 `superstore` 的记录 |
| TC-37 | 分页 | 数据 > 20 条时点「下一页」 | offset 移动，显示下一批；URL 或状态不丢失过滤条件 |
| TC-38 | CSV 导出 | 点「导出 CSV」 | 浏览器下载 `audit-YYYYMMDD.csv`，内容与当前过滤条件一致，不含 token/密码字段 |
| TC-39 | `?user=` query 参数 | 直接访问 `/admin/audit?user=zhangsan` | 用户过滤器预设为 `zhangsan`，日志自动过滤 |

---

## P6 — 安全与边界

| ID | 标题 | 操作步骤 | 期望结果 |
|---|---|---|---|
| TC-40 | fs-safe 路径穿越拦截 | `curl -X PATCH http://localhost:5173/api/admin/agents/uat-test-01` body 中伪造相对路径，或用 Burp 改请求写 `../../secrets` | 返回 `403 FORBIDDEN_PATH` |
| TC-41 | DENY 目录写入拦截 | 尝试写 `.ktx/secrets/` 路径 | 同上 403 |
| TC-42 | audit 日志不含明文 token | 在 audit 日志页或 `audit.sqlite` 中搜索任何 64 字符 hex | 无命中（token 明文不写入日志） |
| TC-43 | 无效 userId 404 | `GET /api/admin/agents/nonexistent` | 返回 `{ ok: false, error: "AGENT_NOT_FOUND" }` |

---

## P7 — 回归

| ID | 标题 | 操作步骤 | 期望结果 |
|---|---|---|---|
| TC-44 | 语义层维护正常 | 访问 `/`（表目录），进入任意表的 TableEditor | 加载正常，保存功能可用 |
| TC-45 | Wiki 编辑正常 | 访问 `/wiki`，编辑并保存一个文档 | 保存成功 |
| TC-46 | 变更审阅正常 | 访问 `/review` | 页面加载无报错 |
| TC-47 | TypeScript 无报错 | `npx tsc --noEmit` | 0 errors |
| TC-48 | 单测全绿 | `npm test` | 0 failed |

---

## 关键风险用例（必测，不可跳过）

TC-22、TC-24、TC-25、TC-28、TC-30、TC-40、TC-42 — 对应设计文档 §6.4 安全约束和 Reviewer 两条 P1 问题。
