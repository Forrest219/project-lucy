# WO-202610-14 使用信号、来源与发布门禁

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-14 |
| 标题 | P2：慢调用与零行、鉴权时间线、客户端来源、广告日表消歧、语义发布门禁 |
| 状态 | 已实现并通过 SC-20 至 SC-24 的自动化断言。内部顺序：SC-20 → SC-21 → SC-22 → SC-23 → SC-24 |
| 来源 Spec | `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md` v0.3 |
| 来源计划 | `docs/plans/2026-10-11-customer-log-next-optimizations.md` v1.1 |
| 撰写日期 | 2026-10-11 |
| 适用范围 | 访问日志的慢调用与取消、鉴权失败查询、User-Agent 解析、语义发布校验。广告日表的别名和 join 白名单由客户发布，不入库 |

## 目标

换成能区分「用户等了很久」和「一次 1.6 秒的查询」的慢标记，把鉴权失败放进同一条时间线，在结构化客户端字段为空时解析已知 User-Agent，并为歧义列和语义契约失败提供各自独立的失败路径。

## 任务

按这个顺序做。前一条的验收未过，不开始下一条的界面改动；测试可以先写。

- [x] **T1 慢调用、零行、取消（SC-20）。** 慢的定义改为 `lucy_query` 的 `duration_ms >= 5000`，或问询墙钟 `>= 120000`。1.6 秒的成功查询不得标慢。成功且行数为 0 时 `result_empty=1`。`notifications/cancelled` 在 session 能对上问询时写入该 turn id。替换使用信号里「几乎所有往返都算慢」的标记。非目标：`wiki_read`、`discover_data` 等其它工具的单次耗时本期不按这个定义标慢；问询钻取的 `isSlowCall`（高于窗口 p95，界面主术语仍是「慢于多数请求」）和 Spec 143 调用监测的默认 30 秒阈值不在本任务替换。

- [x] **T2 鉴权失败时间线（SC-21）。** 落点是 `webui/server/admin/audit.ts` 的 `GET /api/admin/audit`。同一时间筛选合并 `access_log` 与 `auth_failure_log`，`missing_bearer`、`token_expired`、`token_unrecognized` 与工具调用用类型字段区分。不把它们写成 `lucy_query` 的失败维度，也不写进 `access_log`。证据包里的 `auth_failure_log.csv` 保持独立文件。可与 WO-202610-13 的导出分页一起发布。

- [x] **T3 客户端与来源（SC-22）。** `client` / `client_version` 为空时，从 User-Agent 解析已知家族：`kscc-code`、`codex-mcp-client`、WorkBuddy、opencode、claude-code。解析失败则保持为空。`client_ip` 仍是 socket 对端。存在转发头时写入 `client_forwarded_for`，没有头则为空。不猜测办公网地址。

- [x] **T4 广告日表消歧（SC-23）。** 独立于 T5。歧义列或歧义度量返回 ACL 内的 `source.field` 名单，不生成 join。客户若发布了物理名到语义 source 的别名，`lucy_read_source` 用别名解析；未发布时保持 source not found，并给出修复提示。仓库不提交 MJ 的广告表 YAML。本任务的测试使用 demo 夹具，不调用 T5 的发布门禁。

- [x] **T5 语义发布门禁（SC-24）。** 既有 TS/Python 契约失败（包括 `columns.0.type` 非法）时拒绝发布。豁免必须写入审计：操作者、原因、到期时间。到期后同一发布再次失败。豁免不能关闭全部检查。本任务不生成别名，也不生成 join。

## 验收口径

SC-20、SC-21、SC-22、SC-23、SC-24。SC-23 的测试在发布门禁关闭时仍然通过。

## 验证命令

```bash
cd webui
npm run lint:terminology
npm test -- --run server/__tests__/slow-call-and-empty-result.test.ts server/__tests__/auth-failure-timeline.test.ts server/__tests__/client-user-agent-parse.test.ts server/__tests__/ambiguous-source-hint.test.ts server/__tests__/semantic-publish-gate.test.ts
```

## 风险与边界

| 风险 | 处理 |
|---|---|
| 新慢定义上线后历史数字跳变 | 旧行不回填。界面标明新定义的生效时间 |
| 其它工具不再出现本定义下的慢标记 | 非目标已写在 T1。Spec 143 的调用监测阈值保持原样 |
| 转发头被伪造 | `client_forwarded_for` 只作展示，不参与 ACL |
| 消歧提示列出不可见表 | 名单函数与 Spec 162 §7.3 相同，负例与 SC-5 一致 |
| 紧急发布时关掉整个契约检查 | 只允许带到期时间的单次豁免 |
| 把广告表 join 写进发布门禁 | T4 与 T5 的测试互相不调用 |

## 回滚

- 慢定义配置回到旧阈值时，只影响新写入的标记。
- 鉴权失败从默认时间线视图隐藏，原始鉴权表保留。
- User-Agent 解析关闭后，空的 `client` 保持为空。
- 发布门禁的豁免到期即失效，不需要数据迁移。
