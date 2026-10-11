# WO-202610-13 使用证据、Wiki 与查询护栏

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-13 |
| 标题 | P1：截断标记、Wiki、认证路径、内建度量、拒绝名单、失败维度、单模板试点 |
| 状态 | 依赖 WO-202610-12 的修复提示、失败分类和版本元数据。以 Spec 162 v0.1 的 SC-10 至 SC-19 为验收 |
| 来源 Spec | `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md` v0.1 |
| 来源计划 | `docs/plans/2026-10-11-customer-log-next-optimizations.md` v1.0 |
| 撰写日期 | 2026-10-11 |
| 适用范围 | Proxy 的 `lucy_query` / Wiki / 拒绝载荷、访问日志导出、使用分析默认视图。客户 YAML、Wiki 正文和角色清单不提交 |

## 目标

`lucy_query` 写明截断；Wiki 接受自然语言；失败按四个维度聚合且导出能翻页；拒绝时返回 ACL 内的名字；平台能执行一条已发布的认证路径和一个损益模板。客户现场要配的内容写在本工单末尾，不进 git。

## 任务

- [ ] **T1 截断标记。** `lucy_query` 成功时写 `response_truncated` 为 0 或 1。打到行上限时为 1，并附「改为聚合」的修复提示（SC-10）。不改 `lucy_freshness` 与 `lucy_explain_query` 已有的 0。

- [ ] **T2 Wiki。** `wiki_search` 在 `q` 为非空字符串时返回命中或空列表，不得返回 `unparseable_text`（SC-11）。问数前注入的篇目必须属于该角色可读集合，审计含篇目 id 与 Wiki 版本（SC-12）。

- [ ] **T3 认证路径机制。** 按 Spec 162 §7.8。执行仍是带角色的 `lucy_query`。结果含 `routeId` 与 source。角色看不见该 source 时走权限拒绝（SC-13）。仓库不存放客户路径清单。demo 用一条假路径做测试。

- [ ] **T4 内建度量。** 无 source 的 `count(*)` / `count(1)` 返回指向 `row_count(source)` 的修复提示。对已聚合度量再包 `sum` 时不生成 `sum(sum())`（SC-15）。完整度度量没有声明分母则拒绝编译。

- [ ] **T5 拒绝名单。** `discover_data`、`entity_details`、`dictionary_search`、`lucy_query`、`lucy_read_source` 的权限拒绝使用 §7.3 的同一名单函数（SC-14）。覆盖契约违规、物理名不存在和禁表。

- [ ] **T6 使用分析默认视图。** 协议工具不进入默认 KPI，原始行保留（SC-16）。探测连接名 `probe-`、`rds-test`、`demo-mysql` 在默认视图中分开。不凭 User-Agent 把调用标成自动化。

- [ ] **T7 失败维度与导出。** 按 §7.3 写入 `failure_dimension`。验收抽样锁定四条归类（SC-17）：`COUNT(*)` 的 `upstream_error`、`AS field`、超时、`table_forbidden`。`budget_stop` 不进入任一维度。导出游标分页，第二页能读到第 10,001 行。空 `policy_version` 计为缺失。缺权限快照时 completeness 为 false（SC-18）。

- [ ] **T8 复述范围。** 依赖 WO-202610-12 的问询原文。问询文本含指代或两个意图时，先返回复述（账户、月份、产品线），确认前不发 `lucy_query`。无原文的推断问询跳过复述，直接进入现有查询路径。

- [ ] **T9 单模板试点钩子。** 只注册 `public_cloud_pnl_quarterly`。结果带 source 与采用的版本（SC-19）。仓库内不出现客户口径 YAML。没有前后对比记录之前，代码拒绝注册第二个模板 id。

- [ ] **T10 双轨角色的审计对比。** 使用统计在 WO-202610-12 的使用人字段之上，能按角色并排看权限拒绝次数。不在本仓库改客户的 `access.yaml`。

## 客户现场（不提交）

下列条目由客户自己发布。本工单完成的标志是机制和 SC 通过，不是客户已经改完配置。

- 为访问日志里抽取次数最高的 source 发布认证路径，原表保留，答案写明 source。KSC 材料里的头部是 `dwd_cdn_pnl_detail`、`dwd_public_cloud_revenue_detail`、`dwd_cdn_bandwidth_cost_detail`。43 个摘要 token 含探测残留，不得当成授权清单。
- 发布 `public_cloud_pnl_quarterly` 的口径。试点未证明一次查询能够替下同主题的多轮试表之前，不发布下一个模板。
- 按域签发新角色，旧角色保留到双轨对比结束。对比使用 T10 的拒绝次数。

## 实现顺序

1. T1、T5、T7 依赖 P0 的修复提示和分类，先做。
2. T2、T4、T6 可并行。
3. T3 与 T9 一起做，避免模板绕过认证路径的 ACL。
4. T8 等问询原文稳定。
5. T10 只做对比查询，角色拆分留在客户现场。

## 验收口径

SC-10 至 SC-19。SC-17 的四条归类必须是自动化断言，不能只靠手工看日志。

## 验证命令

```bash
cd webui
npm run lint:terminology
npm test -- --run server/__tests__/query-truncation.test.ts server/__tests__/wiki-natural-language-search.test.ts server/__tests__/certified-route.test.ts server/__tests__/builtin-measures.test.ts server/__tests__/denial-repair-hint.test.ts server/__tests__/failure-dimension.test.ts server/__tests__/audit-export-paging.test.ts
```

## 风险与边界

| 风险 | 处理 |
|---|---|
| 截断标记改变已依赖 1,000 行的客户端 | 先写标记和修复提示，默认行上限的收紧不在本工单 |
| Wiki 注入了角色看不见的篇目 | SC-12 用角色外篇目做负例 |
| 模板口径错误成为正式财务表 | 本工单只注册 id 和元数据契约；口径在客户现场，结果必须带版本和 source |
| 把 `upstream_error` 画成平台故障 | SC-17 锁住 `COUNT(*)` 归用法与语义 |
| 客户 YAML 被提交 | 评审时拒绝任何 `semantic-layer/` 下的客户连接目录 |

## 回滚

- 认证路径与模板 id 的开关关闭后，调用方回到普通 `lucy_query`。
- Wiki 注入关闭后，检索仍按 T2 接受自然语言。
- 失败维度字段停止写入时，导出仍可按旧的 `outcome` / `decision_reason` 查看。
- 不删除已归档的审计行。
