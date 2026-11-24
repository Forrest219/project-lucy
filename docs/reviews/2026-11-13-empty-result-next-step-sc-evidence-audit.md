# P0-5 空结果下一步指导 · SC-01–SC-30 证据审计

| 元数据 | 内容 |
|---|---|
| 文档名称 | P0-5 SC-01–SC-30 证据审计 |
| 文档类型 | Checklist / Evidence |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-13 |
| 撰写人 | Tester (Track C) |
| 委托人 | xingchen |
| 基于材料 | Spec `docs/specs/lucy-20261107-empty-result-next-step-guidance-spec.md` §7；`empty-result-next-step*.test.ts` |
| 适用范围 | 功能合同收口证据；镜像由 parent 同次回写 |
| 输出位置 | `docs/reviews/2026-11-13-empty-result-next-step-sc-evidence-audit.md`（由 inbox 审计晋升） |

## 测试基线

命令（绕过 pretest 中与本条无关的 TableEditor `lint:terminology` 失败）：

```bash
cd webui && npx vitest run \
  server/__tests__/empty-result-next-step.test.ts \
  server/__tests__/empty-result-next-step-proxy.test.ts
```

| 项 | 结果 |
|---|---|
| Test Files | 2 passed |
| Tests | **33 passed / 0 failed** |
| 时长 | ~2.3s |
| `npm run lint:terminology`（全仓） | 失败：`TableEditor.tsx:2002` Agent 缺 `translate="no"`／`notranslate`——Spec 证据落点已声明「与本条无关」 |
| `npm run lint:spec-docs` | 失败项均为其他 Spec／Plan 基线外违规；**本条 Spec 未出现在失败列表** |

无回归：本轮未改生产／测试代码；相对既有套件为全绿。

## SC 清单（CLOSED / OPEN）

### 纯函数 · `empty-result-next-step.test.ts`

| ID | 状态 | 证据 |
|---|---|---|
| SC-01 | CLOSED | `SC-01 对 lucy_query 的 0 行返回 empty_result 指导` |
| SC-02 | CLOSED | `SC-02 有数据时不带指导` |
| SC-03 | CLOSED | `SC-03 行数未知／非有限／非严格 0 时不判空` |
| SC-04 | CLOSED | `SC-04 非 lucy_query 工具不带指导` |
| SC-05 | CLOSED | `SC-05 query 只含存在的键…` + `SC-05 filters 缺省…` + `SC-05 去值摘要形状与 summarizeFilters…` |
| SC-06 | CLOSED | `SC-06 next_tools 只含调用者可见的工具…` |
| SC-07 | CLOSED | `SC-07 行权限交集空时分流 kind…` |
| SC-08 | CLOSED | `SC-08 hint 与 summary 不含结论性判断` |
| SC-17 | CLOSED | `SC-17 next_tools 为空时 hint 明说没有可用工具` |
| SC-21 | CLOSED | `SC-21 measures/dimensions/orderBy 白名单与真实 schema 对齐` |

### Proxy · `empty-result-next-step-proxy.test.ts`

| ID | 状态 | 证据 |
|---|---|---|
| SC-09 | CLOSED | `SC-09／SC-10 空结果带 next_step…`（含 text／meta 一致 + AV 共存） |
| SC-10 | CLOSED | 同上（structured 三处一致） |
| SC-11 | CLOSED | `SC-11 非空结果无 next_step；P0-4 可核对块与业务字段共存` |
| SC-12 | CLOSED | `SC-12 text 不是 JSON 对象 → 018 不注入；skipped_reason 不被 AV 抹掉` |
| SC-13 | CLOSED | `SC-13(a)…` + `SC-13(b)…` |
| SC-14 | CLOSED | `SC-14 审计行数不被污染…`（+ 纯函数 SC-21 覆盖对象项剥键） |
| SC-18 | CLOSED | `SC-18 JSON…` + `SC-18 SSE…`（`result_is_error` + `allowedToolCalls===0`） |
| SC-19 | CLOSED | `SC-19 上游 text 已带 next_step…`（含 AV 共存） |
| SC-20 | CLOSED | `SC-20 有数据／非 lucy_query 时不触发可见性裁决（计数）` |
| SC-22 | CLOSED | `SC-22 无 structuredContent 时 text＋meta 仍注入` |
| SC-23 | CLOSED | `SC-23 structured 已有 next_step…`（含 AV 投影） |
| SC-24 | CLOSED | `SC-24 rows=[] 且截断 → repair 与 next_step 并存` |
| SC-25 | CLOSED | `SC-25 overflow/precision/underflow` 三类（token 保留 + AV + skipped_reason） |
| SC-26 | CLOSED | `SC-26／SC-27 ACL 外表／未授权表拒绝 → 无 next_step` |
| SC-27 | CLOSED | 同上（权限拒绝路径） |
| SC-28 | CLOSED | `SC-28 非 lucy_query 成功 0 行样例…`（SSE + 计数 0） |
| SC-30 | CLOSED | `SC-30 JSON／SSE：HTTP 500…`（status 实传 + 计数 0） |

### 文档／门禁

| ID | 状态 | 证据 |
|---|---|---|
| SC-15 | CLOSED | `webui/docs/00-product-terminology-standard.md` §4.8：Next Step／Empty Result／Suggestion；Scope Intersection Empty 补注；D4／D14／Repair Hint 分界已登记。本条 Spec 未触发 `lint:spec-docs` 新增失败 |
| SC-16 | CLOSED* | 本条术语已登记；全仓 `lint:terminology` 仍因 TableEditor 存量失败——与 Spec 证据落点「与本条无关」一致 |
| SC-29 | CLOSED | Spec／Plan／`docs/README.md`／`docs/plans/README.md`／清单 P0-5 **现行同句**（v0.8；功能合同已收口；本条收口不表示可上线）。2026-11-13 parent 镜像回写 |

## 计数

| | |
|---|---|
| CLOSED | **30 / 30** |
| OPEN | **0** |
| 本轮新增测试 | 无 |
| 本轮改动代码／测试文件 | **无** |

## Nits（不挡收口）

1. **SC-18 × `answer_verifiability`**：Spec SC-18 正文只要求不注入 `next_step`／`result_is_error`／`allowedToolNames` 计数＝0（JSON+SSE 已绿）。未额外断言 isError 路径上 AV 有／无。成功空结果／跳过路径的 AV 共存已由 SC-09／11／12／13／19／23／25 覆盖。若需显式锁 isError 路径 AV 行为，可由 **Track B** 补一条最小断言（夹具 `withProxyCall`／`emptyPayload` 已具备）。
2. **SC-26／SC-27** 合并为同一 ACL 拒绝夹具；足够证明「拒绝路径无 next_step」，未再拆歧义拒绝独立夹具。
3. **SC-16** 全仓术语 lint 仍被 TableEditor 挡住；不应用本条 pretest 失败否定 SC-16。

## 建议 Spec 状态句

功能合同证据侧：**SC-01–SC-30 均可标关闭**；建议 parent 将 Spec／Plan／索引／池镜像统一改为：

> **功能合同已收口**（SC-01–SC-30 证据关闭；实现已落地；复审 Approve with nits）。**本条收口不表示可上线。**

（本 Track **不**写 Spec／inventory 镜像。）
