# WO-202610-15 验收缺口：把护栏接到查数路径

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-15 |
| 标题 | 补上 WO-13 / WO-14 验收里没接到调用路径的四项 |
| 状态 | 已实现。SC-15、SC-19、SC-20、SC-23 的自动化断言打到护栏、writeLog 和调用监测 |
| 来源 | 2026-10-12 验收。计划 `docs/plans/2026-10-12-acceptance-gap-closure.md` |
| 来源 Spec | `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md` v0.3 |
| 撰写日期 | 2026-10-12 |
| 适用范围 | Proxy 的 `lucy_query` / `lucy_read_source`、访问日志写入、调用监测上的问询慢标记说明 |

## 任务

- [x] **T1 内建度量。** `lucy_query` 转发前调用度量护栏（SC-15）。无 source 的 `count(*)` 返回修复提示。`sum(已聚合度量)` 和 `sum(sum())` 不转发。完整度缺分母则拒绝。

- [x] **T2 消歧与别名。** 歧义字段在转发前返回 ACL 内的限定名，不生成 join（SC-23）。`lucy_read_source` 对未授权的名字先解析已发布物理名别名；没有别名则返回修复提示。语义层是目录来源，仓库不提交客户广告表 YAML。

- [x] **T3 问询墙钟。** 问询起点只记一次。`writeLog` 写入 `turn_wall_clock_ms`，慢标记同时看 `lucy_query` 耗时和问询墙钟（SC-20）。调用监测注明问询慢标记自 2026-10-12 起生效，不改「慢于多数请求」。

- [x] **T4 第二个模板。** 对比记录存在之后，`registerReportTemplate` 接受下一个模板 id。对比记录不存在时仍然拒绝。

## 验收口径

SC-15、SC-19、SC-20、SC-23。T1 / T2 的测试要断言代理源码在转发前调用护栏，并直接断言护栏对夹具的裁决。T3 的测试要经过 `writeLog` 读回墙钟。

## 验证命令

```bash
cd webui
npx vitest run --maxWorkers=1 server/__tests__/builtin-measures.test.ts server/__tests__/query-guardrails.test.ts server/__tests__/ambiguous-source-hint.test.ts server/__tests__/slow-call-and-empty-result.test.ts server/__tests__/report-template-pilot.test.ts src/__tests__/call-monitor.test.tsx
```

## 回滚

- 度量护栏、消歧和别名都在转发前返回，关掉对应环境开关后回到直接转发。
- 问询墙钟只影响新写入的行，旧行不回填。
- 模板注册回到「只接受试点 id」时，已登记的第二个 id 留在进程内，重启即消失。
