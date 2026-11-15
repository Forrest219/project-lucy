# Run — 2026-11-16 — claude-equiv-first

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-EQUIV-GUARD` |
| Agent | Claude（Cursor） |
| 环境 | 本机 Mac（Apple Silicon）；Node v24.13.1；vitest 4.1.9；`HEAD`＝`d64414d6`，工作树含 P1-32／P1-33 整改（未提交）；SQLite 为 better-sqlite3 真库（内存库与临时目录文件库），**无 mock 数据库** |
| 开始／结束 | 2026-11-16 ≈00:00–00:50 CST |
| 总判定 | **PASS WITH GAP**（必做 R0／01／02／03 通过；可选 04 有已写明缺口；EQ-03 引用的 PAGE-SWEEP 本身为 PASS WITH GAP） |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-EQ-R0 | **PASS** | Node、vitest、better-sqlite3 可用；`HEAD`＝`d64414d6`；工作树含运行代码改动（本次被测对象） |
| UAT-EQ-01 | **PASS** | `npm --prefix webui run test:equivalence`：**10 个文件、71 条用例全绿**。覆盖 F-1…F-7、索引、导出分片（行／调用 CSV／问询 CSV，边界行数 0／1／片长±1／多片；含逗号、引号、换行、公式前缀字段）与「不饿死」断言。F-6 规模用例：4 万行号下旧实现按预期抛 `too many SQL variables`，新实现与分片后的旧实现结果相同 |
| UAT-EQ-02 | **PASS** | `equivalence-manifest.test.ts` 全绿：F-1…F-7、F-idx、F-yield 均登记；`legacy/`、`golden/` 无未登记文件 |
| UAT-EQ-03 | **PASS** | 见 [`UAT-SUITE-PAGE-SWEEP` 本次跑次](../../page-event-loop-sweep/runs/2026-11-16-claude-page-sweep-after-fix.md)：登记路由全部 OK，`regressions=0`，基线 `tracked` 清零；严格口径对本次报告回放退出码 0。**该跑次的 PAGE-SWEEP 判定为 PASS WITH GAP（夹具未测项），不要读成无缺口** |
| UAT-EQ-04 | **PASS WITH GAP** | 对运行代码逐项临时变异、跑 `test:equivalence`、还原：<br>① 分块大小改 40000 → 红（as-of 证明）<br>② 问询包 `ORDER BY` 去掉 `ts` → **首次未被拦下（绿）**：旧用例的时间戳与 `id` 同序，排序错误不可见。已把时间戳改成对 `id` 非单调、成组重复，之后「去掉 `ts`」与「去掉 `id` 并列决胜」两种变异都红<br>③ 本地时间 `hour12` → 红<br>④ `inquiryWhere` 去掉空串 `IFNULL` 分支 → 红<br>⑤ `defaultEnsureInquiryRebuild` 不再刷新 → 红<br>⑥ 删 `idx_ital_access_log` → 红<br>⑦ `ui-usage` 分桶 `floor`→`round` → 红（金样本）<br>⑧ `mapSlicesYielding` 去掉让出 → 红<br>**缺口**：`daily-question-kpi` 的变异未实跑（F-3 金样本由改前代码生成，但没有对它做变异证明）；格式化器缓存被去掉不改变输出，等价守卫**拦不住**纯性能回退——靠 UAT-EQ-03 |

## 同批回归

- `npx tsc --noEmit -p webui`：本次改动文件无新增错误；`admin/audit.ts` 内 1 条既有类型错误（`HEAD` 上同样存在，行号漂移）及 `__tests__`／`ops/concepts-*`、`server/index.ts` 的既有错误不属本次。
- `server` 全量 vitest：**76 条失败／4233 通过**，失败分布在 19 个文件（`mcp-proxy-*`、`token-renewal-closure`、`api.*`、`display-*` 等）。**同一批 19 个文件在 `HEAD` 干净工作树（`git worktree`）上同样 76 条失败**，数量与文件一致；与本次改动无关，但**没有逐条比对用例名**，不作更强声明。本条整改涉及的审计、对账、治理、访问关系图、概览相关测试均在通过之列（`p1-access-map-contract` 的 1 条失败是术语 lint 脚本，`HEAD` 上同样失败）。

## 备注

- 本套件是自动化回归守卫，层级「脚本／自动化」；**不含 HTTP／浏览器**，HTTP 侧真测由 UAT-EQ-03 承担。
- **≠ 可上线**；**≠** 客户现场验证；**功能合同收口 ≠ UAT PASS**。
- 已知覆盖不到：`audit/export-pack`、v2 导出完整路径、`linkedHandshakeRows`（见 [fixtures.md](../fixtures.md)）。
