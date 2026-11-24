# P0-4 答复可核对 · Code Review（Cursor Agent）

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实现 code review（**不是** Spec） |
| 日期 | 2026-11-13 |
| 评审人 | Cursor Agent（Wave A Task 3） |
| 实现主体 | Cursor coder（R4，2026-11-09） |
| 实现 commit | `bcdeb624`（`answer-verifiability.ts`、`mcp-proxy.ts` 接线；与 P0-5 `next_step` 同提交） |
| 对象 | Spec／Plan **v0.4**；SC 夹具以 `webui/server/__tests__/answer-verifiability*.ts` 为主 |
| 复测 | `cd webui && npx vitest run answer-verifiability --reporter=dot` → **26 passed / 0 failed**（2026-11-13 Cursor 复核） |

## 结论

**PASS（实现层）** —— 主路径对齐 Spec v0.4 D1–D10 与 AV-01：纳入 `lucy_query` 成功查数强制 `answer_verifiability` 三载体投影；`cutoff.status` 首期一律 `not_checked`；与 P0-5 `next_step` 双键共存（SC-18）；装配／解析失败走 B-RESOLVE／B-ASSEMBLE，**禁止静默 success 无块**。本轮复测 26/26。残余仅为验收债／nits（见 Findings）。**本 CR 不表示可上线**／不做发布取证。

> **说明**：Spec／Plan 曾写「独立复审 Approve with nits（C1／C2／M5 已闭）」但 **inbox／docs 无对应实现 CR 附件**；本轮重新审查，**不**沿用 C1／C2／M5 编号。下列 Findings 以 **F-R*** 为本轮唯一可追溯结论。

## 已对齐（摘要）

| 项 | 证据 |
|---|---|
| D6／AV-01 成功路径必有块 | `applyAnswerVerifiabilityToLucyQuery`（`answer-verifiability.ts`）；成功路径三载体写入；`isError` 与无块互斥 |
| D3 诚实 `not_checked` | `buildDefaultCutoff()` → `status: "not_checked"`；SC-05 夹具：注入 mtime／businessDate 不改变 cutoff |
| D2 一次构造、三处投影 | text JSON／`structuredContent`／`_meta.lucy`；SC-01／06b |
| D9 保真／B-ASSEMBLE | 大整数与超长小数 wire 夹具（SC-14／23／25）；键冲突／text 非对象 → `answer_verifiability_assemble_failed` |
| D7 来源权威全集 | `sources[]` 多源 identity；不完整 → `answer_verifiability_source_unresolved`（SC-02／13） |
| D8／P0-1 pin 证据 | 请求携带 caliber 快照；缺失／非法 digest → `answer_verifiability_caliber_evidence_missing`（SC-22） |
| P0-5 共存 | SC-18、`applyAnswerVerifiabilityToLucyQuery` 在 enriched 含 `next_step` 时双键保留（`empty-result-next-step-proxy.test.ts` 交叉断言） |
| §4.1 生产点／排除 | `ANSWER_VERIFIABILITY_IN_SCOPE_TOOLS`＝`lucy_query`；SC-16 排除 read_source／explain 等；SC-17 Hive；SC-21 SSE 写回 |
| Spec 162 字段保护 | SC-01 断言 `contract`／`provenance` 等既有 `_meta.lucy` 键保留 |
| 模型 instructions | `data-qa-instructions.md` 强制 surfacing `answer_verifiability`；`answer-verifiability-instructions.test.ts` |

## Findings

### F-R1 [nit] 既有「C1／C2／M5 已闭」无落盘 CR — **本 CR 消分叉**

inbox 与 `docs/reviews/` 未见独立实现 CR 或原始 Finding 正文。本轮以 F-R* 为唯一实现层结论；Spec／Plan／清单状态句已回链本文件。

### F-R2 [nit] vitest 主 glob 26 条，部分 SC 证据在邻接套件

SC-16／17／21／22 等以 `answer-verifiability.test.ts` 为主；与 P0-5 共存、Proxy 级空结果路径在 `empty-result-next-step-proxy.test.ts`；口径闸序在 `caliber-binding-proxy.test.ts`。不挡本轮 PASS；功能验收时按 Spec SC 表跨文件核对。

### F-R3 [nit] commit `bcdeb624` 与 P0-5 共享差分

本条审查范围以 `answer-verifiability.ts` 与 `answer-verifiability*.test.ts` 为主；`mcp-proxy.ts` 中 `applyAnswerVerifiabilityToLucyQuery` 调用链已 spot-check，不替代 Task 4 对 `next_step` 的独立实现 CR。

### F-R4 [nit] 夹具内测例名「M5」≠ 历史 CR ID

`answer-verifiability.test.ts` 中 `begun_bound` 残缺用例标题含「M5」，仅为夹具标签，**不是** Spec 状态曾引用的独立复审 Finding 编号。

## 对 Spec D／SC 的裁定

| 范围 | 裁定 |
|---|---|
| 成功路径强制块（D6／SC-01） | **接受** |
| cutoff `not_checked`（D3／SC-04／05） | **接受** |
| 与 P0-5 共存（SC-18） | **接受** |
| 失败 fail-closed 无静默成功（SC-13／14／22） | **接受** |
| Hive／SSE／排除路径（SC-16／17／21） | **接受**（以本轮夹具为准） |
| SC-01–SC-23 自动化 | **接受**（主模块 26/26；邻接 Proxy 测补充，见 F-R2） |

## 下一步

1. Wave A Task 4：P0-5 独立实现 CR 落盘。  
2. 可选：跨文件 SC 登记表与 Task 5 索引自检对齐。  
3. **不得**宣称可上线。
