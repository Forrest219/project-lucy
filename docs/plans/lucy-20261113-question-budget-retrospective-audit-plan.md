# 问询预算复盘审计字段 Implementation Plan

> **For agentic workers:** **开发授权已获得**（委托人 2026-11-13）。按本 Plan 落地；本条不表示可上线。

**Goal:** 交付面 A 下为问询预算耗尽事件写入可复盘快照，使运维能用 **`calls.csv`／字段说明** 调参；不改审计页布局、不改 MCP 预算终止响应体、不改终端问询 UI。

**Architecture:** R3 两类行写入 `args_summary.budgetSnapshot`（窗口级 + 累计读数）。仅 `calls.csv` 表尾抽扁平列；**不**动 `HEADERS_V2`／calls-v2；v2 metadata 显式排除新列。

**Tech Stack:** Lucy MCP Proxy、SQLite `args_summary`、Admin `calls.csv`／field-metadata、vitest（含 HTTP MCP 夹具）。

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v1.0** / 2026-11-13 |
| 主 Spec | [lucy-20261113-question-budget-retrospective-audit-spec.md](../specs/lucy-20261113-question-budget-retrospective-audit-spec.md)（**v1.0**） |
| 编号 | **REQ-030-035／P1-14** |
| 状态 | **v1.0；R2-F＋R4（委托人明示 2026-11-13）；开发授权已获得；实现已落地（2026-11-13）**。本条不表示可上线 |
| 授权边界 | 已获终稿确权与开发授权；不授权客户镜像／上线 |
| 验收 | Spec SC-R1–R12；证据见 Spec §4 落点 |
| 优先级 | P1；**不挡**原 P0 |
| 实施主体 | Lucy（Proxy + Admin 导出）；不改 KTX |
| 本版修订 | **v1.0**：定稿落地；闭合 Claude R2；Task 0–5 执行 |

## Global Constraints

- 不改 60／300、续查 1、settled／elapsed 开关语义、八桶。
- 不改 `Audit.tsx`；MCP 预算终止响应体不加 `budgetSnapshot`。
- 平滑升级保留 `lucy-demo-data`；禁止 `--fresh` 作为本功能前置。
- 术语遵守 `webui/docs/00-product-terminology-standard.md`（正文用「预算终止」，禁「触顶」作合同义务）。

---

## 1. 目标

1. 耗尽事件可区分 `calls`／`busy`／`wall`／`both`（含停机行与续查换窗行）。
2. 快照同时给出**窗口**读数与**问询累计**（`attempts`／归档忙时；elapsed 跨窗墙钟见 Spec R5b）。
3. `calls.csv` + 字段说明可复盘；平滑升级兼容。
4. 不扩大交付面 A（无 UI、无响应体变更、无 v2 证据包承诺）。

---

## 2. 开工前置（已满足）

- [x] Spec v1.0 决策 R1–R10／R5b 已冻结
- [x] 委托人确认交付面 A；R8＝响应体不加
- [x] 入池 REQ-030-035／P1-14（Task 0）
- [x] 开发授权（R4）已授予（2026-11-13）

---

## 3. 影响评估（摘要）

| 对象 | 影响 |
|---|---|
| 终端问数用户 | **无**响应体／额度／登录变化 |
| 审计表格／筛选 | **无** intentional 变化 |
| 详情抽屉 | 被动多 JSON 键 |
| `calls.csv`／字段说明 | **有**（主交付） |
| `calls-v2.csv` | **本期不改**；v2 metadata **排除**本条新列 |
| `lucy-demo-data` | 保留；无需 `--fresh` |
| Playground | 现状已忽略未知键 |

---

## 4. 文件落点

| 区域 | 文件 |
|---|---|
| 快照 | `webui/server/proxy/question-experience.ts`（`classifyExhaustion`／`buildBudgetSnapshot`） |
| 写入 | `webui/server/proxy/mcp-proxy.ts`（`argsSummary` only） |
| 导出 | `webui/server/admin/audit.ts`（`calls.csv` + FIELD_METADATA；v2 排除） |
| **明确不改** | `HEADERS_V2` 数据列；`Audit.tsx`；Spec 162（短注另议） |
| 测试 | `question-budget-retrospective-snapshot.test.ts`／`question-budget-retrospective-csv.test.ts` |

---

## 5. 任务

### Task 0: 入池与索引（文档）

- [x] 委托人确认 REQ-030-035／P1-14
- [x] 清单池／需求池／`docs/README.md`／`docs/plans/README.md` 登记

### Task 1: `classifyExhaustion` + `buildBudgetSnapshot`

- [x] 失败测 → 实现 → vitest 绿

### Task 2: 写入 `args_summary` only（R3 两类）

- [x] 预算终止 → `eventKind=budget_stop`
- [x] 续查换窗 → `eventKind=continuation_rollover`
- [x] 响应体不加 snapshot

### Task 3: `calls.csv` 表尾扁平列 + 字段说明

- [x] v1 表尾加列；v2 排除；SC-R6／R11

### Task 4: 文档

- [x] SC→测试文件映射（Spec §4）
- [x] 发版说明要点（见下）

### Task 5: 验证

- [x] 相关 vitest 绿（snapshot + csv + 既有 question-budget 回归）

---

## 6. 验收

见 Spec §4 SC-R1–R12。

### 完成定义

- SC-R1–R12 证据落点齐（见 Spec §4）
- 清单池／需求池／`docs/README.md`／`docs/plans/README.md` 状态镜像同句
- 发版说明要点就位
- **≠ 可上线**／≠ 客户交付

### 发版说明要点（运维）

- `calls.csv` **表尾**新增 12 列预算复盘字段；历史行对应单元格为空。
- 完整 JSON 仍在 `args_summary.budgetSnapshot`；兼容脚本可只解析 JSON。
- **不**宣称 `calls-v2.csv` 含这些列；v2 字段说明不含本条新列。
- 平滑升级：`npm run demo:upgrade`（保留 volume）；**不要** `--fresh`。

---

## 7. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 固定表头脚本裂 | 表尾加列 + 发版说明 + JSON 兼容路径 |
| 误改 calls-v2／响应体 | Plan 明文禁止；SC-R8；v2 metadata 排除测 |
| 只数 `budget_stop` 漏客户端 | R3／SC-R12 强制续查换窗写路径 |
| elapsed 跨窗墙钟不可复原 | Spec R5b 已知盲区 |

回滚：去掉快照写入与 CSV 加列即可；已写入 JSON 键无害；无需清库。

---

## 8. 待委托人拍板

（定稿项已闭合。）可选：Spec 162 §8 短注是否另开授权代改？

---

## 9. 落盘清单勾销（DEVELOPMENT）

| # | 项 | 本条 |
|---|---|---|
| 1 | Spec／Plan 共用编号 | 是 |
| 2–5 | 术语／状态等 | 已镜像 |
| 6 | Design System | **不适用**（无新 UI） |
| 7 | 索引 | 已登记 |
| 8 | 新命令 | **不适用** |
| 9 | 台账号 | 无；挂 P1-14 |
| 10 | 其余 | 已改运行代码（R4） |
| 11 | 闭口层级 | 有 |
| 12 | 作废状态句 | 无 |
| 13 | 交互合同 | **未触发** |

### 形态门禁（独立清单 · R2-F-03）

- [x] Spec 头部「状态」含「开发授权已获得」
- [x] 闭口层级四行齐全
- [x] Terminology Compliance 指向术语标准
- [x] SC 表证据等级可执行
- [x] Plan Global Constraints 与 Spec 同向
- [x] 伪代码豁免已登记
- [x] 「过程对抗 ≠ 终稿 ≠ R4」已在评审记录区分

---

## 10. Claude R1／R2 处置镜像

见 Spec §6；评审记录见 [claude-review](../reviews/2026-11-13-question-budget-retrospective-audit-claude-review.md)。
