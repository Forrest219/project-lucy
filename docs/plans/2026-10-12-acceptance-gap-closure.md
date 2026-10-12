# 验收缺口修复：WO-202610-13 / 14

- 日期：2026-10-12
- 状态：已落地。护栏在转发前返回；问询墙钟由 `writeLog` 写入新行。
- 来源：WO-202610-13、WO-202610-14 落地后的验收。16 个测试文件、120 条断言通过，但有三处没有接到真实调用路径，另有一个对比开关是空的。
- 工单：[`wo-202610-15`](../../webui/docs/plans/wo-202610-15-acceptance-path-wiring.md)
- 不改 KTX 源码。客户 YAML、广告表别名正文不入库。

## 要补上的四件事

1. **内建度量进 `lucy_query`。** 无 source 的 `count(*)` / `count(1)` 在转发前返回 `row_count(source)`。对已聚合度量再包 `sum`，以及字面量 `sum(sum())`，不生成嵌套聚合。完整度没有分母则拒绝编译。
2. **消歧和物理名别名进查数路径。** 歧义列或歧义度量返回当前角色可读的 `source.field`，不生成 join。`lucy_read_source` 在 source 不在授权内时先查已发布的物理名别名；没有别名则返回 source not found 和修复提示，不猜。目录和别名从语义层文件读取，测试可以用夹具注册。
3. **问询墙钟写入审计。** 问询第一次出现时记下起点，继续一次不把起点清掉。写访问日志时把墙钟填进 `turn_wall_clock_ms`，并按「`lucy_query` ≥ 5 秒，或墙钟 ≥ 120 秒」计算慢标记。调用监测上的「慢于多数请求」保持窗口 P95。界面写明问询慢标记自 2026-10-12 起生效。
4. **第二个模板 id。** 没有前后对比记录时仍拒绝。记录对比之后允许注册下一个 id。

## 验收

沿用 Spec 162 的 SC-15、SC-20、SC-23、SC-19。新增断言必须打到代理或 `writeLog`，不能只调用未被引用的纯函数。

```bash
cd webui
npx vitest run --maxWorkers=1 \
  server/__tests__/builtin-measures.test.ts \
  server/__tests__/query-guardrails.test.ts \
  server/__tests__/ambiguous-source-hint.test.ts \
  server/__tests__/slow-call-and-empty-result.test.ts \
  server/__tests__/report-template-pilot.test.ts \
  src/__tests__/call-monitor.test.tsx
```
