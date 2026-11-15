# Cases — UAT-SUITE-EQUIV-GUARD

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-EQ-R0 | 环境门禁 | 脚本 | `node -v`、`cd webui && npx vitest --version`、`npm --prefix webui ls better-sqlite3` | Node 与 better-sqlite3 原生模块可用；记下 `git rev-parse HEAD` 与工作树是否干净 |
| UAT-EQ-01 | 逐项等价（冻结旧实现／改前金样本） | 自动化 | `npm --prefix webui run test:equivalence` | 全部用例绿。F-1 inquiry-pack 行集、F-4 本地时间文本、F-6 as-of 证明（含大规模）、F-7 问询 WHERE 与 F-3／F-5 概览金样本 JSON 与改前逐字等价；导出分片（让出事件循环）的行与 CSV 文本与一次性计算逐字相同；F-2 重建触发、索引存在与走索引 |
| UAT-EQ-02 | 守卫自身完整（登记册） | 自动化 | 同上，`equivalence-manifest.test.ts` | 每个 F-n 的冻结旧实现／金样本文件存在、带 `FROZEN REFERENCE` 标记或为合法 JSON、且被对应测试实际引用；`legacy/`、`golden/` 里没有未登记的文件。删掉任一 oracle 或测试即红 |
| UAT-EQ-03 | 不复发（性能门禁） | 脚本 | `npm --prefix webui run sweep:event-loop:gate`，`SWEEP_STRICT=1` 为严口径 | `regressions=0`；P1-32／P1-33 登记的路由在门禁里为 OK（livez p99 ≤ 400ms、max ≤ 1000ms；顺序最大 ≤ 3000ms）。基线里对应登记已删除。同跑 `UAT-SWEEP-02` 结论另记 |
| UAT-EQ-04 | 变异自检（可选） | 手工脚本 | 见下「步骤」 | 每个变异都被至少一条用例拦下（红）；还原后全绿 |

---

## UAT-EQ-R0 — 环境门禁

### 步骤

1. `node -v`；`cd webui && npx vitest --version`。
2. `npm --prefix webui ls better-sqlite3`。
3. 记录 `git rev-parse HEAD` 与 `git status --short` 是否含运行代码改动。

### 期望

- 三项可用；信息写进跑次。

### 清理

无。

---

## UAT-EQ-01 / 02 — 等价与登记册

### 前置

UAT-EQ-R0 通过。测试全部在临时目录建 SQLite 库，不碰 demo volume、不碰 `access.yaml`。

### 步骤

1. `npm --prefix webui run test:equivalence`。
2. 读尾部：`Test Files`、`Tests`；任何 `×` 先看是哪个 F-n。
3. 红灯处理：**先怀疑运行代码**；确认是有意的行为变更时，走 [suite.md](suite.md)「想改金样本」一行，禁止直接重生金样本。

### 期望

- 全绿。`equivalence-manifest.test.ts` 绿＝02 通过。

### 清理

测试自行删除临时目录。

---

## UAT-EQ-03 — 性能门禁（不复发）

### 步骤

1. `npm --prefix webui run sweep:event-loop:gate`（约 8–15 分钟；细节见 [UAT-SUITE-PAGE-SWEEP](../page-event-loop-sweep/cases.md)）。
2. 看 `Gate` 段：`regressions=0`；`tracked-open` 里不含 P1-32／P1-33 已整改的路由。
3. 可选 `SWEEP_STRICT=1`：已登记越线清零后应退出码 0。

### 期望

- 退出码 0；基线只减不增。

### 清理

同 UAT-SUITE-PAGE-SWEEP。

---

## UAT-EQ-04 — 变异自检（可选）

每项变异在 `webui/server` 对应运行文件里临时改，跑 `test:equivalence`，应红；`git checkout -- <文件>` 或手动还原后应绿。**不得提交变异。**

| 变异 | 应被哪条用例拦下 |
|---|---|
| `sqlite-in-chunks.ts`：把 `SQLITE_IN_CHUNK_SIZE` 改成 40000（或 `audit-as-of-proof.ts` 去掉分块后合并排序） | `audit-as-of-proof.equivalence`（`too many SQL variables`／顺序） |
| `audit-inquiry-pack-rows.ts`：把 `ORDER BY ts DESC, id DESC` 改成只按 `id`，或去掉 `id` 并列决胜 | `inquiry-pack-rows.equivalence`（时间戳对 `id` 非单调且成组重复，两种改法都可见） |
| `audit-local-timestamp.ts`：改时区格式或去掉缓存 | `audit-local-timestamp.equivalence` |
| `reconciliation.ts` `inquiryWhere`：把空问询 ID 的 `IFNULL` 分支删掉 | `inquiry-where.equivalence` |
| `access-map-echo.ts`：把 `defaultEnsureInquiryRebuild` 改回逐请求重建 | `access-map-rebuild-trigger` |
| `proxy/audit.ts`：删掉 `idx_ital_access_log` | `audit-schema-indexes` |
| `ui-usage.ts`：分桶 `Math.floor` 改 `Math.round` | `ui-usage-overview.equivalence`（金样本）。`daily-question-kpi.ts` 尚未做变异实跑，见跑次 |
| `yield-slices.ts`：`mapSlicesYielding` 去掉 `await yieldToEventLoop()` | `export-yielding.equivalence`（事件循环未被让出） |

### 期望

- 每项变异至少一条红；还原后全绿。把结果写进跑次，缺哪条拦截就补哪条用例。
