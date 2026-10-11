# 客户日志：查数体验与使用证据（最终版）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Customer Log Next Optimizations |
| 文档类型 | Product Optimization Plan（评审通过的最终建议；实现以 Spec 162 与三份工单为准） |
| 版本 | v1.0 |
| 状态 | 立项。顺序维持 P0 → P1 → P2 |
| 撰写日期 | 2026-10-11 |
| 委托人 | xingchen |
| 评审链 | [`inbox/日志分析/2026-10-11-lucy-next-optimizations.md`](../../inbox/日志分析/2026-10-11-lucy-next-optimizations.md)、[`2026-10-11-lucy-next-optimizations-review.md`](../../inbox/日志分析/2026-10-11-lucy-next-optimizations-review.md)、[`2026-10-11-lucy-next-optimizations-review-reply.md`](../../inbox/日志分析/2026-10-11-lucy-next-optimizations-review-reply.md) |
| Spec | [`webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`](../../webui/docs/162-customer-query-experience-and-usage-evidence-spec.md) |
| 工单 | [`wo-202610-12`](../../webui/docs/plans/wo-202610-12-query-turn-budget-and-repair.md)、[`wo-202610-13`](../../webui/docs/plans/wo-202610-13-usage-evidence-and-query-guardrails.md)、[`wo-202610-14`](../../webui/docs/plans/wo-202610-14-usage-signal-and-publish-gate.md) |

两份客户审计日志（KSC：2026-09-04 至 2026-10-10，366 个问询、3,325 次调用；MJ：4,327 次调用，31 个有量日期，终于 2026-10-09）经过建议、评审和复核。本文只保留已经对齐的结论。数字以复核终稿为准。

## 结论

先让每次问询可追踪、可停、可对上口径，再改语义、Wiki 和权限。

KSC 问询时长的 pandas 中位数是 37.1 秒，工具耗时中位数 3.7 秒，`lucy_query` 中位数 1.6 秒。等待主要耗在模型来回试表。83.6% 的 KSC 问询没有用户原话。`lucy_query` 失败率 KSC 9.3%（237/2,560），MJ 7.3%（199/2,744）。

KSC 的失败主体是语义契约（123），MJ 的失败主体是权限与连接（122）。优先级不拆成两套，验收按客户分开。

`upstream_error`（KSC 194、MJ 136）是代理给 KTX / 引擎抛错贴的标签，不是平台故障。失败签名按四个一级维度统计：引擎超时与并发、过滤条件下推、用法与语义、权限拒绝。

## 落地顺序

1. P0：原话与 turn（01）、使用人 / Agent / 自动化（05）、可执行报错与过滤条件下推（03）、版本与新鲜度写进结果（04）、问询预算（02）。
2. P1：截断标记、Wiki、认证路径、内建度量、拒绝时返回可用名、按域角色双轨、复述范围、协议噪音剥离、失败签名四分、一个损益模板试点。
3. P2 内部：慢调用与零行取消（19）→ 鉴权失败并入时间线（18）→ 客户端与来源（17）→ 广告日表消歧（10，独立条目）→ 语义 YAML 发布门禁（20）。

客户自己的语义 YAML、Wiki 正文和角色清单不提交进本仓库。平台提供机制；现场配置另走客户变更。

## 基线（立项后用来看有没有变好）

| 指标 | KSC | MJ |
|---|---|---|
| 业务调用带 `lucy_turn_id` | 769/3,267（23.5%） | 885/3,505（25.2%） |
| `lucy_query` 失败率 | 237/2,560（9.3%） | 199/2,744（7.3%） |
| 问询时长 p90 | 4.6 分钟 | 无问询导出 |
| 成功查询 `query_hash` 重复率 | 评审终稿 55.4%（1,299/2,346）。按仅 `lucy_query` 且 hash 非空计为 1,297/2,322 | — |
| 带查询的问询里用过 Wiki | 16/233 | 4/229 |

业务调用的分母是去掉协议噪音之后的调用。两家分开看，不合成一个通过率。

## 已对齐的口径修正

这些句子替代初稿里的对应表述。

- 过滤条件下推：KSC 的 `error_detail` 有 12 行完整的 `STRUCT('…' AS field, '=' AS op, '…' AS val)`，引擎文本来自 MySQL 系连接。MJ 的 27 次语法错误全部含 `'…' AS field`，其中 11 行是 Doris 省略号截断后的 `...RUCT(`，字面量 `STRUCT` 在 MJ 导出里是 0 次。MJ 这些失败行的 `generated_sql` 没有留下完整 SQL。
- `sql_server`：`error_detail` 里 `Connection "sql_server" is not configured in ktx.yaml` 为 11 行，`decision_reason` 均为 `upstream_error`。另有 1 行 `decision_reason` 才是 `unknown_or_forbidden_connection:sql_server`。`args_summary` 出现该字符串 39 行，不能都算连接被拒。
- `policy_version` 非空 2 个，空字符串 3,304 行。权限快照非空 32 个，与 zip 中 32 行 jsonl 一致。空值不算一个版本。
- 「43 个表名」是问询摘要「涉及数据表」按顿号、逗号、空白切开的 43 个 token，含 `biods.v_hr_employee_latest`、两张 `rds_test.ods_*` 探测残留，以及各出现 1 次的 `dwd_pub_pnl_detail`、`dwd_pub_pub_sy_incr_project`。`finbp_lead` 单独 31 个。这不是「当前授权了 43 张表」。`effective_tables_count` 在 8 到 15 之间波动。
- 「昨天的银行流水」是 521,781 毫秒、8 次工具调用。
- 资金 Agent `finbp_nbcb_funds` 的查询失败 30/59。其中 `AS field` 形状 12、其他 SQL 语法 5、measure 不引用 source 2。这支持第 03 条，不作为第 09 条的直接证据。第 09 条的证据仍是 KSC 46 次 `count(*)` 被拒，以及原话里的填报完整度问题。
- `response_truncated` 在 `lucy_freshness` / `lucy_explain_query` 上已有值且均为 0。缺的是 `lucy_query` 的写入。
- `lucy_read_source` 失败量是 KSC 8/276、MJ 12/292，不是第二大失败源。拒绝时返回的可用名字仍要覆盖这个工具。
- KSC `lucy_begin_question` 60 次与 60 条原话一一对应。会话 ID 非空 21 行，全部来自 `kscc-code/1.3.7` 与 `codex-mcp-client/0.159.2`。字段已实现，旧客户端没传。缺了 begin 仍必须能查数。

## P0

### 01. 问询留下原话，后续调用挂到同一个 turn

- 面向：查询体验、运维分析
- 优先级：P0
- 风险：中
- 工作量：中

KSC 306/366 个问询只有推断摘要。业务调用带 turn id 的只有 23.5% / 25.2%。MJ 打了 292 次 `lucy_begin_question`，后续工具仍大量没有 turn。官方客户端默认上报原话、session 和 turn。代理按 Spec 138 做显式归属和会话补绑。没有 `lucy_begin_question` 时查询继续成功。

### 02. 问询预算用尽时返回可继续的部分结果

- 面向：查询体验
- 优先级：P0
- 风险：中
- 工作量：中

95/366 个问询超过 2 分钟，最长 11.2 分钟、242 次工具调用。成功查询里过半是同一个 `query_hash` 原样再打，单个哈希最多 24 次。预算用尽的记录不算进四个失败维度，避免污染第 15 条。用户可以继续一次。一句里的多个问题留到第 13 条，P0 不自动拆句。

### 03. 语义报错变成修复提示，并拦住过滤条件下推

- 面向：查询体验、语义与权限
- 优先级：P0
- 风险：中
- 工作量：中

KSC 有 68 次 measure 不引用 source，其中 46 次是 `COUNT(*)` / `count(*)`，另有 29 次列不存在。MJ 有 32 次 GROUP BY（约 30 次与 `avg_ltv_5y` 有关）和 8 次 `sum(sum())`。过滤条件下推按上一节的 MySQL / Doris 口径改写。修复提示只列出该角色已授权的 source 和列。引擎若只返回被截断的错误文本，审计仍要记下 `compiler_reason=filter_pushdown`；能拿到的生成 SQL 按 Spec 125 入库。

### 04. 已发布的默认版本和新鲜度写进结果

- 面向：语义与权限
- 优先级：P0
- 风险：高
- 工作量：中

60 条原话里 9 条要求最新。freshness 在带查询的问询里只有 KSC 11/233、MJ 6/229。模型去猜 `dwd_loaded_at`。问「0911 版本有哪些落库表」的那次原话问询 600 秒、17 次错误、3 次拒绝。平台只应用语义发布里声明过的默认版本，并在结果元数据里写出版本、业务日、实际或预测。没有声明默认时，不替客户发明一个版本。灰度期结果里看不见版本号，就不上这个默认。

### 05. 使用统计按使用人、Agent、自动化三层拆开

- 面向：运维分析
- 优先级：P0
- 风险：中
- 工作量：中

`user_id` 是 Agent。`finbp_lead` 占 KSC 2,890/3,325，对应 5 个 token。MJ 的 `openclaw-nyt` 占 2,282/4,327，User-Agent 为 Python-urllib。token 备注（「111」「测试2」「zxc 的macbook」）不能当人名。自动化必须有显式标记。KSC 52% 的 User-Agent 是 Python-urllib，只说明程序化调用已经很多，不单独把这些调用划成自动化。

## P1

### 06. `lucy_query` 写入截断标记，大结果提示改走聚合

- 优先级：P1。风险：中。工作量：小到中。
- KSC 成功查询有 130 次不少于 900 行，421 次响应超过 200KB，响应体 90 分位约 240KB。MJ 有 30 次打到 1,000 行上限。`lucy_query` 成功时 `response_truncated` 写 0 或 1。截断时修复提示要求改为聚合。freshness / explain 已有的 0 保持不变。

### 07. Wiki 接受自然语言，注入内容落在角色可读范围并记版本

- 优先级：P1。风险：中。工作量：中到大。
- KSC `wiki_search` 47 次里 23 次是 `unparseable_text`，查询就是「收入」「0911」「公有云损益预测」。`wiki_read` 10 次 not found，key 是模型猜的文件名。带查询的问询里用过 Wiki 的，KSC 16/233、MJ 4/229。自然语言 `q` 不得再返回 `unparseable_text`。注入的篇目写入审计，并带 Wiki 版本，避免把第 04 条的结果版本架空。

### 08. 认证路径：问题对到已发布的 source，答案写明用了哪张

- 优先级：P1。风险：高。工作量：大。
- 方向不变。43 是摘要 token，含探测残留，不是授权面。`access_log_sources` 里 `dwd_cdn_pnl_detail` 656 次、`dwd_public_cloud_revenue_detail` 296 次、`dwd_cdn_bandwidth_cost_detail` 249 次。出现过 `dwd_pub_sy_incr_project` 到 `dwd_cdn_sy` 没有 join 路径。平台提供可版本化的认证路径；客户发布哪些路径不进本仓库。第一批现场内容对准上述高频 source。原表保留。

### 09. 内建行数、去重、填报完整度和环比

- 优先级：P1。风险：中。工作量：中。
- 证据是 46 次 `count(*)` 被拒，以及原话里「销售单价、台数、计费天数填了多少」。完整度指标声明分母和粒度。`sum(sum())` 返回修复提示，不把嵌套聚合交给引擎。不把资金 Agent 的 51% 失败率算作本条的验收基线。

### 11. 拒绝时返回当前角色能用的连接和 source

- 优先级：P1。风险：中。工作量：小到中。
- kx 元数据拒绝 KSC 54、MJ 44，集中在 `discover_data`、`entity_details`、`dictionary_search`。未指定表 KSC 25、MJ 21。`dwd.dwd_cdn_sy` 被拒 4 次。`demo-mysql` 25 次。`sql_server` 按 `error_detail` 11 次未配置，另 1 次是连接拒绝。返回名单限制在该调用者的 ACL 内，并覆盖 `lucy_query` 与 `lucy_read_source`。

### 12. 按业务域签发角色，双轨期用审计对比拒绝率

- 优先级：P1。风险：高。工作量：中。
- 一个 `finbp_lead` 横跨 CDN、公有云、行业云和公司合并。专用 Agent 查询失败率：`finbp_cdn_v2` 21/85，`finbp_nbcb_funds` 30/59，`lucy-admin` 34/55。旧角色保留到新角色签发之后。对比依赖第 05 条的使用人字段。客户角色清单不进本仓库。

### 13. 执行前复述范围，再处理指代和一句多问

- 优先级：P1。风险：中。工作量：中。
- 依赖第 01 条留下的上文。原话里有「展开讲讲」、GPU 与 CDN 同句、连续两句相同的「该账户最近 5 笔流水」（其中一次 387 秒、9 次错误）。「昨天的银行流水」是 521.8 秒、8 次工具调用。执行前复述账户、月份和产品线。

### 14. 协议心跳、评测和探测不进入使用分析

- 优先级：P1。风险：低。工作量：小。可与第 05 条一起交付。
- MJ 822/4,327（19.0%）是 list、templates、cancelled、ping、discover。KSC 协议噪音 1.7%。`probe-abc`、`probe-xyz`、`rds-test` 在参数里可以确认。按工具名和连接名分开，不靠 User-Agent 猜测真人。

### 15. 失败按四个维度聚合，并能对上权限快照

- 优先级：P1。风险：低。工作量：中。
- 维度是引擎超时与并发、过滤条件下推、用法与语义、权限拒绝。`upstream_error` 不单独成平台故障列。导出按页继续，10,000 行是页大小，不是把一个月的日志截掉的上限。KSC 单日峰值 1,126。`completeness` 在缺快照时为 false。空的 `policy_version` 计为缺失。MJ 当前 4,327 行的策略版本和 capability digest 全空，要能在界面上看出来。

### 16. 先试点一个损益模板

- 优先级：P1，范围收到一个模板。风险：高。工作量：先做试点，不按多个模板排期。
- 模板 id 为「公有云损益，分季度，实际/预测」。报表类原话 9 条；超长的有原话问询是 539 秒 / 52 次、530 秒、423 秒 / 23 次，无原话的是 669 秒和 582 秒 / 242 次。结果带版本和 source。临时探索仍走普通查询。试点没有证明「一次查询替下几十次」之前，不排下一个模板。

## P2

内部顺序：19 → 18 → 17 → 10 → 20。

### 19. 慢调用、零行和取消挂到问询

慢标记目前盖住 332/366 个问询、合计 3,701 次，而 `lucy_query` 中位数只有 1.6 秒。成功但 0 行：KSC 15、MJ 25。MJ 取消 144 次（`chenqian` 88、`QualityTeam` 56）没有挂到问询。Doris 超时 4 次，最长 31 秒；并发达到 4 有 1 次。本条在 P2 里先做，否则后面的验收仍被失效标记带偏。

### 18. 鉴权失败进入同一条时间线

30 条不在调用导出里：`missing_bearer` 14、`token_expired` 11、`token_unrecognized` 5。过期集中在 2026-09-09 至 09-10 的 `kscc-code` 1.3.5 / 1.3.3，token `kscc-eval`。与第 15 条的导出一起做。

### 17. 补客户端和平台；来源地址区分对端和转发

`client` 在 KSC 空 3,304/3,325，MJ 全空。`platform` 与 `device_name` 全空。KSC 的 `client_ip` 3,325 次都是 `10.42.0.1`。结构化字段为空时，从 User-Agent 解析出 `kscc-code` 1.3.3–1.3.7、codex、WorkBuddy、opencode、claude-code。有转发头时单独入库，不把 Pod 地址改写成猜测的办公网地址。

### 10. 广告日表消歧、物理名映射、只开放确认过的 join

保持独立，不并入第 20 条。证据约 20 次且只在 MJ：歧义、物理名 source not found、无 join。`customer_agent` 42 次失败里 27 次是过滤条件下推、5 次是 GROUP BY，与这 20 次不是同一签名。歧义时返回 ACL 内的带 source 前缀的名字。不自动 join。

### 20. 语义 YAML 发布前拦住契约错误，豁免要留审计

`dm_cpu_asset_cost` 的 `columns.0.type` 契约违规 6 次，`lucy_read_source` 失败。豁免写明原因和期限，不能把检查整个关掉。物理名和消歧不放进这条门禁。
