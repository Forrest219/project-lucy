# P0-5 空结果 next_step · Code Review（Cursor Agent）

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实现 code review（**不是** Spec） |
| 日期 | 2026-11-13 |
| 评审人 | Cursor Agent（Wave A Task 4） |
| 实现主体 | Cursor coder（R4，2026-11-09） |
| 实现 commit | `bcdeb624`（`empty-result-next-step.ts`、`mcp-proxy.ts` 018→AV 装配顺序；与 P0-4 同提交） |
| 对象 | Spec／Plan **v0.8**；SC 证据见 [证据审计](2026-11-13-empty-result-next-step-sc-evidence-audit.md) |
| 复测 | `cd webui && npx vitest run server/__tests__/empty-result-next-step.test.ts server/__tests__/empty-result-next-step-proxy.test.ts --reporter=dot` → **33 passed / 0 failed**（2026-11-13 Cursor 复核） |

## 结论

**PASS（实现层）** —— 主路径对齐 Spec v0.8 **D1–D3＝A**（结构化 `next_step`／只提示不阻断／单块内加键三承载位）与 **D13 严格 0 行** `lucy_query` 成功路径；与 P0-4 `answer_verifiability` 双键共存（装配先 018 后 AV，SC-09–SC-13／SC-18／SC-25）。本轮复测与证据审计一致（33/33）。残余仅为验收债／nits（见 Findings）。**本 CR 不表示可上线**／不做发布取证。

> **说明**：Spec／Plan 曾写「独立复审 **Approve with nits**」但 **inbox／`docs/reviews/` 无对应实现 CR 附件**；本轮重新审查，**不**沿用历史匿名 nit ID。下列 Findings 以 **F-N*** 为本轮唯一可追溯结论。

## 已对齐（摘要）

| 项 | 证据 |
|---|---|
| D1 结构化 `next_step` | `buildEmptyResultNextStep`：`kind`／`summary`／`query`／`suggestions`／`next_tools`／`hint`（SC-01／05／07／08） |
| D2 只提示不阻断 | 空结果不拒后续调用；无预算门闩（Spec §4 D2；夹具无拦截断言） |
| D3＝A 单块内加键 | text JSON 对象内注入；`structuredContent` 已存在对象时同步；`_meta.lucy.next_step`（SC-09／10／22） |
| D13 严格 0 行成功 | 先 `upstreamHttpStatus`＋`isError` 再注入；`rowCount===0` 且工具 `lucy_query`（SC-01–04／18／28／30） |
| D4–D15 承载位／白名单／保真 | D12 上游冲突跳过；D15 原始 token 不保真则跳过（SC-25）；D11 剥键（SC-14／21）；D14 截断 `repair` 并存（SC-24） |
| P0-4 共存 | 先 `applyEmptyResultNextStep` 再 `applyAnswerVerifiabilityToLucyQuery`；SC-09–11／13(b)／18／19／23／25；交叉见 [P0-4 CR](2026-11-13-p0-4-answer-verifiability-code-review.md) SC-18 |
| 可见工具门禁 | `allowedToolNames` 仅 D13 通过后（SC-06／17／20） |
| 术语／SC-15 | `00-product-terminology-standard.md` §4.8 登记；本条 Spec 未触发 `lint:spec-docs` 新增失败（证据审计） |

## Findings

### F-N1 [nit] 「Approve with nits」无落盘实现 CR — **本 CR 消分叉**

inbox 与 `docs/reviews/` 未见独立实现 CR。本轮以 F-N* 为唯一实现层结论；Spec／Plan／清单状态句已回链本文件。

### F-N2 [nit] SC-18 × isError 路径未显式断言 AV 有无

与 [证据审计](2026-11-13-empty-result-next-step-sc-evidence-audit.md) Nit-1 一致：成功／跳过路径 AV 共存已绿；`result_is_error` 路径未单列 AV 断言。不挡本轮 PASS。

### F-N3 [nit] commit `bcdeb624` 与 P0-4 共享差分

本条审查范围以 `empty-result-next-step*.ts` 与两测文件为主；AV 接线边界见 P0-4 实现 CR F-R3。

### F-N4 [nit] 全仓 `lint:terminology` 仍被 TableEditor 存量失败

与证据审计 SC-16 口径一致；本条 pretest 不否定 SC-15／16 合同登记。

## 对 Spec D／SC 的裁定

| 范围 | 裁定 |
|---|---|
| D1–D3＝A（结构化／不阻断／单块加键） | **接受** |
| D13 严格 0 行 `lucy_query` | **接受** |
| 与 P0-4 共存（SC-09–13／18／25） | **接受** |
| SC-01–SC-30 | **接受**（与 [证据审计](2026-11-13-empty-result-next-step-sc-evidence-audit.md) 30/30 一致） |

## 下一步

1. Wave A Task 5：四 CR 链接自检。  
2. 可选：Track B 补 SC-18 isError 路径 AV 显式断言（F-N2）。  
3. **不得**宣称可上线。
