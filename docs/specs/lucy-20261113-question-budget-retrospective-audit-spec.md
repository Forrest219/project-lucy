# 问询预算复盘审计字段 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能合同 / **v1.0** |
| 日期 | 2026-11-13 |
| 功能编号 / 优先级 | **REQ-030-035／清单 P1-14**／P1（运营复盘；**不挡**原 P0） |
| 状态 | **v1.0；R2-F＋R4（委托人明示 2026-11-13）；开发授权已获得；实现已落地（2026-11-13）；实现 CR 已落盘（PASS，2026-11-13）**。交付面 **A**。本条收口不表示可上线；不构成客户交付 |
| 评审记录 | [Claude Spec 评审](../reviews/2026-11-13-question-budget-retrospective-audit-claude-review.md)（过程对抗）· [实现 CR](../reviews/2026-11-13-p1-14-question-budget-retrospective-audit-code-review.md)（W1；**不表示可上线**） |
| 决策来源 | 2026-11-13 产品对话；Claude Code R1／R2；同日委托人授权定稿并落地 |
| 与既有 Spec 的关系 | **补强** Spec 162／问询预算窗口可观测性，**不改**预算配额、结算口径、续查语义、八桶主状态。权威：`webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`；窗口／续查：`docs/specs/lucy-20261029-question-budget-window-optimization-spec.md`；频率：`docs/specs/lucy-20261111-question-budget-threshold-relax-spec.md` |
| 配对 Plan | [lucy-20261113-question-budget-retrospective-audit-plan.md](../plans/lucy-20261113-question-budget-retrospective-audit-plan.md) |
| 实施主体 | Lucy（Proxy 审计写入 + Admin 导出／字段说明）；不修改 KTX |
| 本版修订 | **v1.0**：定稿并落地；闭合 Claude R2 R2-F-01…F-06 |

---

## 闭口层级

- 层级：功能合同
- 本条承诺：预算终止行与头部续查换窗行写入可复盘的 `budgetSnapshot`（维度 + 窗口／累计读数）；`calls.csv` 与字段说明可解析；平滑升级不要求清 volume
- 本条出口：SC-R1–R12 自动化／夹具通过；字段说明与对应 CSV 列集合一致（声明 ⊆ 实际）
- 不在本条出口：审计页新列／看板；calls-v2 数据列；改预算频率；客户镜像／上线
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.
New terms: 无。用户可见与合同正文统一用既有词条「预算终止」（`budget_stop`／`budget_stopped`）。技术叙述中的「耗尽事件」指运行时 `isExhausted===true` 的瞬间（未必已写 `budget_stop` 行）；禁止再用未登记口语「触顶」指代合同义务。专业字段名（`budgetSnapshot`、`exhaustedBy`）仅出现在审计 JSON／CSV／字段说明。

---

## 1. 问题与目标

问询预算默认已放宽为 **60 次／300s**。事后调参需要回答：

1. **预算终止**与**耗尽事件**是否仍常见？落在谁／哪类客户端？（含头部续查换窗路径，不得只数 `budget_stop` 行）
2. **当次耗尽窗口**先到的是次数还是时间维（settled＝busyMs；elapsed＝墙钟流逝）？
3. 该事件瞬间的窗口读数与问询级累计读数各是多少？
4. 续查是否已按既有合同留下声明／生效两条事实（本条**不新增**续查事实；统计续查＝按行解析 `args_summary.budgetContinuation`，**非目标**做汇总列）？

**目标（交付面 A）**：不改 WebUI 布局与交互；快照写入 `access_log.args_summary`；**`calls.csv`（v1）**与字段说明可解析；运维用导出复盘。

**非目标**：审计页新列／筛选／看板；**不修改 MCP 预算终止响应体**；不承诺 `calls-v2.csv` 数据列含快照；不改预算频率；不回填历史；不新增续查汇总列。

---

## 2. 决策（已冻结）

| ID | 决策 | 取值 |
|---|---|---|
| R1 | 交付面 | **A**：Proxy 写入 + **`calls.csv`／字段说明**；不改 `Audit.tsx` 表格／筛选／看板 |
| R2 | 主载体 | `args_summary.budgetSnapshot`（与既有 `budgetContinuation` 并列）；**不**新建 `access_log` SQLite 列 |
| R3 | 快照写触发 | **两类行都必须带完整快照**：(a) `budget_stop` ∧ `question_budget_exhausted`；(b) 头部／工具续查换窗生效行（`budgetContinuation.applied=true` 且本次消费因耗尽而换窗）——(b) 快照记录**换窗前**窗口读数与 `exhaustedBy`，不得用清零后的 0 |
| R4 | 耗尽原因 | settled：`calls` \| `busy` \| `both`；elapsed：`calls` \| `wall` \| `both` |
| R5 | 快照字段 | 见 §3.1；`calls`／`busyMs`／`elapsedMs`＝**该事件所涉窗口**读数；`attempts`＝问询级累计准入次数；`archivedBusyMsByWindow` 键格式 `` `${round}:${windowId}` ``；频率＝模块常量 |
| R5b | elapsed 盲区 | elapsed 模式下**不**归档墙钟；问询级累计墙钟与「旧窗当初耗尽维」**不可复原**——已知盲区；§1 目标 2／3 在 elapsed 下只保证**当前／当次事件窗口**可读，不保证跨窗墙钟累计 |
| R6 | 续查 | **不新增**续查事实；保持 20261029 SC-30 |
| R7 | 历史行 | 只向前写；不做回填 |
| R8 | MCP 响应体 | **不加**快照 |
| R9 | 扁平 CSV | 仅 `calls.csv` 表尾 additive；`ACCESS_LOG_CSV_HEADERS_V2`／v2 字段说明须**显式排除**新列（防 metadata 扩散）；不改 `HEADERS_V2` 数据列 |
| R10 | turns CSV | **二期** |

---

## 3. 写入合同

### 3.1 调用行

示例（settled、首窗预算终止；`attempts`＝已准入次数，停机当次未计入准入时可等于 `calls`）：

```json
{
  "budgetContinuation": { "...既有续查事实，本条不扩展..." },
  "budgetSnapshot": {
    "schemaVersion": "lucy-budget-snapshot/v1",
    "eventKind": "budget_stop|continuation_rollover",
    "exhaustedBy": "calls",
    "calls": 60,
    "busyMs": 120000,
    "elapsedMs": null,
    "attempts": 60,
    "maxCalls": 60,
    "maxBusyMs": 300000,
    "maxWallMs": 300000,
    "wallMode": "settled",
    "windowId": 0,
    "round": 0,
    "continuations": 0,
    "archivedBusyMsByWindow": {}
  }
}
```

规则：

- `exhaustedBy` 与 `classifyExhaustion`／`isExhausted` **同源**；禁止事后猜。
- `eventKind`：`budget_stop`＝停机行；`continuation_rollover`＝换窗生效行（快照为换窗前读数）。
- `calls`／`busyMs`／`elapsedMs`＝该事件窗口读数；问询累计用 `attempts` 与 `archivedBusyMsByWindow`（键 `` `${round}:${windowId}` ``）。elapsed 下跨窗墙钟累计见 R5b 盲区。
- 频率取自 `QUESTION_BUDGET_MAX_*` 常量；`LUCY_QUESTION_BUDGET=off` 时不产生本条事件行。
- **脱敏（对齐 20261029 §6.3）**：不得回传 `scopeKey`／`identityKey`；快照不得含 `presentedToken`／`pendingToken`／原始 continue token。
- `question_budget_unavailable`／`concurrency_exceeded` 不冒充本条快照。

### 3.2 导出

- **主路径**：`calls.csv`（含 `args_summary`）+ **v1** 字段说明。
- **扁平列（一期）**：仅 `calls.csv` 表尾：`budget_event_kind`、`budget_exhausted_by`、`budget_calls`、`budget_busy_ms`、`budget_elapsed_ms`、`budget_attempts`、`budget_max_calls`、`budget_max_busy_ms`、`budget_max_wall_ms`、`budget_wall_mode`、`budget_window_id`、`budget_continuations`；非事件行为空。
- **v2 metadata**：扩展 `ACCESS_LOG_CSV_HEADERS` 时，必须让 `ACCESS_LOG_CSV_HEADERS_V2`／`ACCESS_LOG_FIELD_METADATA_V2` **排除**本条新列（或另写白名单），保证任意 export-metadata 声明列 ⊆ 对应 CSV 实际列。
- **机械护栏**：表头列数＝每行列数；既有前 N 列加列前后不变。
- **非路径**：不改 `HEADERS_V2` 数据列；不承诺 calls-v2 含快照。
- **续查统计**：非目标。

### 3.3 WebUI

- 禁止改表格列／筛选／看板。
- 详情抽屉被动多出 JSON 键——既有调试面，非本功能 UI 交付。
- Playground：`readArgsPrefill` 只取 `connectionId`／`sourceName`；未知键不透传——**确认现状即可**，不改 `Audit.tsx`。URL 查询串可能因 `argsSummary` 变长，**不改重放语义**。

### 核心流程（伪代码豁免）

本条为审计字段补强，无独立用户交互状态机。写入路径伪代码豁免：实现挂接 R3 两类记账点（`budget_stop` 与续查换窗生效），快照构造见 Plan Task 1 的 `classifyExhaustion`／`buildBudgetSnapshot`。

---

## 4. 验收

| ID | 期望 | 证据等级 | 落点 |
|---|---|---|---|
| SC-R1 | settled 下次数耗尽停机 → `eventKind=budget_stop`；`exhaustedBy=calls`；窗口 `calls`／`maxCalls` 一致 | 单元＋消费路径 | `question-budget-retrospective-snapshot.test.ts` |
| SC-R2 | settled 下忙时耗尽停机 → `exhaustedBy=busy` | 单元 | 同上 |
| SC-R3 | 两维同时 → `exhaustedBy=both` | 单元 | 同上 |
| SC-R3b | elapsed 下时间维耗尽停机 → `exhaustedBy=wall`；`elapsedMs` 可读 | 单元 | 同上 |
| SC-R4 | 非本条事件业务调用行 **不含** `budgetSnapshot` 键 | CSV 夹具（plain 行空列） | `question-budget-retrospective-csv.test.ts` |
| SC-R5 | 旧行可导出；新列空；无需 `--fresh` | CSV 夹具 | 同上 |
| SC-R6 | `calls.csv` 字段说明含快照／扁平列；与实际表头一致；**v2 metadata 不含**本条新列 | metadata HTTP | 同上 |
| SC-R7 | 审计表格列／筛选无 intentional diff | 静态：未改 `Audit.tsx` | 实现约束 |
| SC-R8 | MCP 预算终止响应 JSON **仅**既有四键语义；**无** `budgetSnapshot` | 既有预算夹具＋写入只改 argsSummary | `mcp-proxy.ts` 响应体未改 |
| SC-R9 | 快照／扁平列／args_summary **不含** scopeKey／identityKey／presentedToken／pendingToken | 单元负向 | snapshot 测 |
| SC-R10 | 续查换窗后再停机：快照可区分窗口级与累计 | 单元 continuation_rollover | snapshot 测 |
| SC-R11 | CSV 表头数＝单元格数；既有前列加列前后不变 | CSV 夹具 | csv 测 |
| SC-R12 | 续查换窗生效行带 `eventKind=continuation_rollover` 完整快照（换窗前读数） | 单元 | snapshot 测 |

---

## 5. 平滑升级

- `demo:upgrade` 保留 volume 必须可用；禁止要求 `--fresh`。
- 仅 additive 写入与 `calls.csv` 表尾加列；禁止改列名／八桶。
- 终端问数：无额度／登录／响应体语义变化（R8＝不加）。
- 固定表头脚本：发版说明写明表尾加列；兼容路径＝解析 `args_summary.budgetSnapshot`。

---

## 6. 对 Claude Code 发现的处置

### 6.1 R1 → v0.2

| ID | 级别 | 处置（v0.2） |
|---|---|---|
| F-01 | major | R8＝响应体不加；非目标保留「无终端可见文案变更」 |
| F-02 | major | 窗口 vs 累计写明；补 `attempts`／`archivedBusyMsByWindow`；SC-R10 |
| F-03 | major | 主路径＝`calls.csv`；明确不承诺 calls-v2 |
| F-04 | major | elapsed→`wall`；补 `elapsedMs`；配额＝常量 |
| F-05 | medium | 脱敏对齐 scopeKey＋identityKey；SC-R9 |
| F-06 | medium | R6／R8 去双承诺 |
| F-07 | medium | SC 证据等级；SC-R4 改为「不含键」 |
| F-08 | medium | 闭口层级／伪代码豁免；Plan 补形态（见 Plan） |
| F-09 | medium | SC-R11 机械护栏 |
| F-10 | medium | 续查统计＝非目标；turns＝二期 |
| F-11 | low | Playground 确认现状 |
| F-12 | low | 162 短注移出本期（另议） |
| F-13 | low | 配额表述对齐常量 |

### 6.2 R2 → v0.3／v1.0

| ID | 级别 | 处置（v0.3／v1.0） |
|---|---|---|
| R2-F-01 | major | R3 扩为两类写触发；补 `eventKind`；SC-R12 |
| R2-F-02 | medium | Terminology／正文统一「预算终止」；禁「触顶」作合同义务 |
| R2-F-03 | medium | Plan 形态门禁改为独立清单（见 Plan） |
| R2-F-04 | medium | R5b 声明 elapsed 跨窗墙钟盲区 |
| R2-F-05 | medium | R9／SC-R6：v2 metadata 显式排除新列 |
| R2-F-06 | low | §3.1 示例改为可达的首窗停机样例 |
