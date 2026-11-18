# 同事 `84becc34` 升级 blocker 补丁 → `lucy-v0.30` 集成计划

| 元数据 | 内容 |
|---|---|
| 文档名称 | 同事 `84becc34` 升级 blocker 补丁 → `lucy-v0.30` 集成计划 |
| 文档类型 | Plan |
| 版本 | v0.1 |
| 撰写日期 | 2026-11-18 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | `84becc34`（`origin/fix/v030-ff4762c9-upgrade-blockers`）；`lucy-v0.30@9be444ba`；与 `ff4762c9` 分叉后主线提交 `dada75c2`／`7ebedd4e`／`784e7f7e`／`c672b0f8`／`f6fec5d3` |
| 适用范围 | 评估同事提交并**外科手术式**集成进 `lucy-v0.30`；本计划授权范围内可改运行代码与测试，但禁止整枝 merge、禁止用同事提交覆盖主线已收口行为 |
| 输出位置 | `docs/plans/lucy-20261118-ff4762c9-upgrade-blocker-integration-plan.md` |

> **For agentic workers:** 按 Task 顺序执行；每 Task 结束后跑该 Task 的验证命令再进入下一 Task。步骤用 checkbox 跟踪。

**Goal:** 把同事 `84becc34` 中**仍对 `lucy-v0.30` 有增量价值**的升级可靠性修复，在不回退主线 `784e7f7e`（预算延后）与 `dada75c2`（pause）的前提下，集成进 `lucy-v0.30`。

**Architecture:** 不以 merge／rebase 整枝合入。以 `lucy-v0.30` 为唯一集成主干，按「评估矩阵」对每个差集做 **take／adapt／reject／already-have**；冲突文件手工拣选。同事分支保留为对照与回归用例来源。

**Tech Stack:** 现有 WebUI（Node／Vitest）、Helm Chart `0.2.10`、audit sqlite、schema-structure 批量读。

## Global Constraints

1. **主干**：`lucy-v0.30`；对照提交固定为 `84becc34`（若远程 tip 前移，先与委托人确认是否改对照）。
2. **禁止** `git merge origin/fix/v030-ff4762c9-upgrade-blockers` 或等价整枝合入作为默认路径（预估 28 个内容冲突）。
3. **主线已收口行为优先**：
   - `784e7f7e`：预算截短／预算耗尽 → **defer**，真超时才终局；不得被同事的「共享 deadline 一律终局 timeout」覆盖。
   - `dada75c2`：`LUCY_INFERRED_MAINTAINER` pause 已进 Chart／values／helpers；不得为「再合一次」改坏文案或语义。
   - P1-50：`inferred_rebuild_state.watermark` 存 **ceilingId 十进制字符串**；同事改为 `watermark=ts` + 新列 `watermark_id`——属**竞争设计**，不得无证明整包替换。
4. **不声称交付**：同事 commit message 已写 *without claiming delivery*；合入后不把总账／UAT 写成 PASS／可上线，除非另有授权与证据。
5. **文档／总账**：默认不从 `84becc34` 搬状态叙事进总账；本计划只允许最小必要的「集成记录」回写（可选，单独 Task）。
6. **工作区卫生**：执行前先处理当前脏文档与 `stash@{0}`（见 Task 0）；不把无关 WIP 混进集成提交。
7. **不自动 commit／push**，除非委托人另行要求。

---

## 0. 评估结论（集成前 SOT）

### 0.1 分叉事实

| 项 | 值 |
|---|---|
| 共同祖先 | `ff4762c9` |
| 同事独有提交 | 仅 `84becc34`（约 140 文件） |
| 主线在分叉后已有相关修复 | `dada75c2` pause；`7ebedd4e` FDE pack-gate／rebuild；`784e7f7e` schema 预算 defer；另有测试／依赖修复 |
| 直接 merge-tree 冲突（抽样） | Chart／values、总账与多份 docs、`schema-structure*`、`inferred-turn-maintainer`、`page-budget`、`proxy/audit.ts`、多份测试、`package.json` 等 **≈28 文件** |

### 0.2 差集裁决矩阵

| 主题 | 同事做法 | 主线现状 | 裁决 |
|---|---|---|---|
| Chart pause `LUCY_INFERRED_MAINTAINER` | Chart 0.2.10 + values／helpers 透传 | `dada75c2` 已有同等能力（注释更完整） | **already-have** — 不重合 |
| Schema 预算边缘（F1／F2） | 共享 `SchemaReadDeadline` + 多处 timeout | `784e7f7e` 明确改为 **defer**，并补多轮收敛测试 | **reject overwrite** — 保留主线 defer；deadline 仅作 HTTP 信封 **adapt** |
| HTTP／请求级共享截止 | 新文件 `schema-read-deadline.ts`；`index.ts` 注入 `requestTimeoutMs` | 主线无此文件 | **adapt** — 引入模块，但必须与 defer 组合：预算耗尽仍 defer，只有信封耗尽才 `SchemaReadTimeout` |
| `catalog-show` 连接／查询共用剩余时间 | `remaining()` 递减 | 主线仍用整段 `timeoutMs` | **take** |
| `readyz` 60s 假 ready | 删除 warmup 时间兜底，仅 listener 标记后 ready | 主线仍有 `now - bootAt >= 60s` 兜底 | **take** + 带上对应回归测试 |
| Rebuild 同 id 快照／重建中插入 | `proxy/audit` 快照 id+ts；新列 `watermark_id`；maintainer 用 `watermark_id` | P1-50 用 `watermark` 存 id 字符串；无 `watermark_id` | **adapt／证明** — 先用同事测试意图在主线上复现；能绿则只补测试；不能绿再最小移植 id 边界语义（优先兼容 P1-50 列，不强制换 schema） |
| `page-budget` 常量 | 更小 page／write slice；`size===1→2`；`REBUILD_MUTATION_CHUNK` | 主线 F2++／R07 另一组常量（如 write 2／12／3） | **reject blind take** — 逐常量对照 UAT／慢盘证据后再改；默认可先只取有测试锁住的行为 |
| `admin/audit.ts` export catch-up | 返回 `{ caughtUp, lag }`，按 captured S 计 lag | 仍返回 boolean，lag 来源不同 | **adapt** — 小补丁移植，配既有／同事相关测试 |
| `proxy/audit.ts` 大改写 | 快照、mutation chunk、yield 策略重写 | 主线已有 F2++／R07 路径 | **禁止整文件采用**；仅在 Task「watermark 证明失败」后按最小 diff 移植 |
| `upgrade-fix-regressions.test.ts` 等新测试 | 多场景锁行为 | 主线无同名文件 | **take／改写** — 按主线 API／schema 改写后落地；失败即暴露真实缺口 |
| docs／总账／发版 JSON／大量 plan 改名 | 同事侧状态与目录整理 | 主线已前进且有本地脏文档 | **reject** — 不从此提交搬状态 |
| `package.json`／lock | 有变更 | 主线另有 `f6fec5d3` audit 依赖 bump | **reject unless required** — 仅当移植代码编译／测试缺依赖时再补 |

### 0.3 主线仍缺、同事有的**高价值增量**（优先移植目标）

1. `webui/server/schema-read-deadline.ts`（+ `schema-request-deadline` 测试）— 需与 defer 组合。
2. `webui/server/catalog-show.ts` 的 `remaining()` 共享超时。
3. `webui/server/runtime/readiness.ts` 去掉 60s 时间兜底。
4. 回归锁：`upgrade-fix-regressions.test.ts`、`inferred-turn-watermark-snapshot.test.ts`（改写到主线契约）。
5. 若证明缺口存在：rebuild 读快照 id 上界与「重建中新插入」补算语义（在 P1-50 列模型上实现，而不是强行引入 `watermark_id` 双轨，除非证明双轨更安全且迁移便宜）。

### 0.4 明确不在本计划交付

- 整枝 merge／把同事分支设为新主干。
- 回退 `784e7f7e` defer。
- 用同事 docs 覆盖总账跟进状态。
- 宣称 blocker 全关、UAT PASS、可上线。
- 处理客户 amd64 出包／K8s 现场（除非后续另授权）。

---

## 1. 文件落位（集成后预期）

| 路径 | 职责 |
|---|---|
| `webui/server/schema-read-deadline.ts` | 请求级单调截止；`SchemaReadTimeout` |
| `webui/server/schema-structure.ts` / `schema-structure-batch.ts` | **保持主线 defer**；仅增加可选 `requestTimeoutMs` 信封，不把预算截短误判为终局 timeout |
| `webui/server/index.ts` | schema-structure API 注入 `SCHEMA_REQUEST_TIMEOUT_MS`；保留 batch／defer 参数 |
| `webui/server/catalog-show.ts` | 连接与 query 共用剩余时间 |
| `webui/server/runtime/readiness.ts` | ready 仅来自显式 mark，无 60s 假 ready |
| `webui/server/admin/inferred-turn-maintainer.ts` | 仅在证明缺口后改覆盖判定；默认先不动 |
| `webui/server/proxy/audit.ts` | 仅在证明缺口后最小移植快照语义 |
| `webui/server/admin/audit.ts` | 可选：catch-up 返回 lag 结构 |
| `webui/server/__tests__/schema-request-deadline.test.ts` | 新建 |
| `webui/server/__tests__/upgrade-fix-regressions.test.ts` | 从同事改写后新建（按主线契约） |
| `webui/server/__tests__/inferred-turn-watermark-snapshot.test.ts` | 从同事改写后新建（查询 `watermark` id 字符串或主线等价断言） |
| `deploy/k8s/helm/lucy/*` | 本计划默认不改（pause 已有） |

---

## 2. Task 分解

### Task 0｜工作区消毒与对照钉死

**Files:** 无产品代码；仅 git 工作区

- [ ] **Step 1: 记录基线**

```bash
git checkout lucy-v0.30
git rev-parse HEAD
git rev-parse 84becc34
git status -sb
git stash list | head
```

Expected: 在 `lucy-v0.30`；对照为 `84becc34`。

- [ ] **Step 2: 隔离无关脏文档**

当前可见脏／未跟踪文档（集成前不得混入运行时提交），至少包括：

- 已修改：`docs/README.md`、`docs/governance/e2e-ledger.md`、`docs/plans/README.md`、需求池／总账、`docs/qa/uat/*`
- 未跟踪：`docs/plans/lucy-20261118-customer-upgrade-reliability-gate-plan.md`、`docs/specs/lucy-20261118-mcp-upgrade-compatibility-spec.md`
- stash：`stash@{0}: wip before checkout 84becc34`（含 schema-structure 重叠 WIP）

处理规则：

1. 与本次集成无关的 docs → 另 stash 或保持不动但不 `git add`。
2. `stash@{0}` **不要**直接 `stash pop` 到集成分支；其中 schema 改动与 `784e7f7e`／同事方案三重重叠，默认丢弃或仅作 diff 对照。

- [ ] **Step 3: 建立对照导出（只读）**

```bash
mkdir -p inbox/84becc34-integration
git show 84becc34:webui/server/schema-read-deadline.ts > inbox/84becc34-integration/schema-read-deadline.ts
git show 84becc34:webui/server/__tests__/upgrade-fix-regressions.test.ts > inbox/84becc34-integration/upgrade-fix-regressions.test.ts
git show 84becc34:webui/server/__tests__/inferred-turn-watermark-snapshot.test.ts > inbox/84becc34-integration/inferred-turn-watermark-snapshot.test.ts
git show 84becc34:webui/server/__tests__/schema-request-deadline.test.ts > inbox/84becc34-integration/schema-request-deadline.test.ts
git diff lucy-v0.30 84becc34 -- \
  webui/server/runtime/readiness.ts \
  webui/server/catalog-show.ts \
  webui/server/index.ts \
  webui/server/admin/page-budget.ts \
  webui/server/admin/inferred-turn-maintainer.ts \
  webui/server/proxy/audit.ts \
  > inbox/84becc34-integration/runtime.diff
```

**验证:** `inbox/84becc34-integration/` 文件齐；工作区产品代码仍干净（相对 `HEAD`）。

---

### Task 1｜引入请求级 `SchemaReadDeadline`（不破坏 defer）

**Files:**
- Create: `webui/server/schema-read-deadline.ts`
- Create: `webui/server/__tests__/schema-request-deadline.test.ts`
- Modify: `webui/server/index.ts`（注入 `requestTimeoutMs`）
- Modify: `webui/server/schema-structure.ts`（可选信封；**保留** `784e7f7e` defer 分支）

**Interfaces:**
- Produces: `SCHEMA_REQUEST_TIMEOUT_MS`、`SchemaReadDeadline`、`SchemaReadTimeout`
- Consumes: 现有 `previewSchemaStructure(..., { callBudgetMs, tables, ... })`

- [ ] **Step 1: 先落地同事测试意图（按主线 import 路径改写）**

从 `inbox/84becc34-integration/schema-request-deadline.test.ts` 拷入并改到可编译；断言重点：

1. 信封耗尽 → 抛／返回可识别的请求级超时；
2. **不得**要求「预算截短超时 ⇒ 终局 timeout」（那是已被 `784e7f7e` 否定的行为）。

- [ ] **Step 2: 跑测试确认红**

```bash
cd webui && npx vitest run server/__tests__/schema-request-deadline.test.ts
```

Expected: FAIL（模块或接线缺失）。

- [ ] **Step 3: 加入 `schema-read-deadline.ts`，在 `previewSchemaStructure` 增加 `requestTimeoutMs` 信封**

组合规则（写进代码注释过短即可，行为必须测住）：

1. `callBudgetMs` 耗尽／预算截短 → **defer**（主线已有）。
2. `requestTimeoutMs` 耗尽 → `SchemaReadTimeout`（同事增量）。
3. 单表真超时（跑满 per-table 上限）→ 终局 timeout rejection（主线已有）。

- [ ] **Step 4: `index.ts` 接线**

对 `/api/connections/:connId/schema-structure` 传入 `requestTimeoutMs: SCHEMA_REQUEST_TIMEOUT_MS`；**保留**主线 `callBudgetMs`／tables／batch 行为；不要为对齐同事而删除 defer 相关参数。

- [ ] **Step 5: 复测**

```bash
cd webui && npx vitest run server/__tests__/schema-request-deadline.test.ts server/__tests__/schema-structure-batch.test.ts
```

Expected: 上述测试 PASS；`schema-structure-batch` 不回归。

---

### Task 2｜`catalog-show` 剩余时间共享

**Files:**
- Modify: `webui/server/catalog-show.ts`
- Test: 既有 catalog／schema 相关测试；必要时从同事侧摘最小用例

- [ ] **Step 1: 移植 `remaining()`**

对照 `inbox/84becc34-integration/runtime.diff` 中 `catalog-show.ts` hunk：connectTimeout 与 query timeout 使用同一单调时钟剩余值；耗尽抛既有超时错误文案。

- [ ] **Step 2: 验证**

```bash
cd webui && npx vitest run server/__tests__/catalog-show.test.ts server/__tests__/schema-structure-batch.test.ts
```

Expected: PASS（若无 `catalog-show.test.ts`，跑最接近的 schema／connection 测试集并记录命令）。

---

### Task 3｜去掉 `readyz` 60s 假 ready

**Files:**
- Modify: `webui/server/runtime/readiness.ts`
- Create／改写: `webui/server/__tests__/upgrade-fix-regressions.test.ts` 中与 ready 相关的用例（可先只迁这一条）

- [ ] **Step 1: 改 `isWebuiReady()` 为仅返回显式 `ready` 标志**（删除 `WARMUP_MS`／`bootAt` 时间兜底）；`markWebuiWarmupComplete` 语义保持「HTTP+MCP 都 bind 后才 mark」的主线注释／调用点，若主线调用点仍只在 HTTP bind，则**先查调用点再改**，避免误把 ready 永久置 false。

- [ ] **Step 2: 锁回归**

从同事用例移植并改写：

`never becomes ready solely because MCP startup took longer than 60 seconds`

- [ ] **Step 3: 验证**

```bash
cd webui && npx vitest run server/__tests__/upgrade-fix-regressions.test.ts
# 以及任何现有 readiness / livez / mcp listen 测试
rg -l 'isWebuiReady|markWebuiWarmupComplete' webui/server/__tests__ | xargs -n1 -I{} npx vitest run {}
```

Expected: PASS；无测试依赖「60s 后自动 ready」。

---

### Task 4｜Watermark／同 id 快照：先证明，再决定是否改运行时

**Files（证明阶段）:**
- Create: `webui/server/__tests__/inferred-turn-watermark-snapshot.test.ts`（改写版）

**Files（仅当证明失败）:**
- Modify: `webui/server/proxy/audit.ts`（最小）
- Modify: `webui/server/admin/inferred-turn-maintainer.ts`（最小）
- 避免无必要引入 `watermark_id` 列；优先继续 P1-50 的 `watermark` id 字符串模型

- [ ] **Step 1: 改写同事 watermark 测试到主线契约**

同事断言读 `watermark_id`；主线应改为：

1. 读 `inferred_rebuild_state.watermark`（十进制 id 字符串）或主线导出的等价字段；
2. 保留场景意图：
   - 重建 yield 期间插入的 call 不得被视为已覆盖；
   - 同 ts／更旧 ts 但更大 id 的行仍触发补算；
   - 无新 id 的用户不进入 rebuilt 列表。

- [ ] **Step 2: 在未改运行时前跑测试**

```bash
cd webui && npx vitest run server/__tests__/inferred-turn-watermark-snapshot.test.ts
```

- [ ] **Step 3A: 若 PASS** → 只保留测试，**不改** `proxy/audit.ts`／maintainer；在本计划 Changelog 记「主线 P1-50 已覆盖同事场景」。
- [ ] **Step 3B: 若 FAIL** → 对失败断言做最小运行时修补：
  1. 保证 rebuild 开始时固化 id 上界快照；
  2. complete 时写入的水位是该快照 id，不是事后 `MAX(id)`；
  3. maintainer 用 id 比较发现快照之上的行；
  4. **不要**为了对齐同事而把 `watermark` 改回 ts，除非另开设计决策并写迁移。

- [ ] **Step 4: 复测相关套件**

```bash
cd webui && npx vitest run \
  server/__tests__/inferred-turn-watermark-snapshot.test.ts \
  server/__tests__/inferred-turn-rebuild-recovery.test.ts \
  server/__tests__/inferred-turn-maintainer-cold-start.test.ts \
  server/__tests__/rebuild-watermark-race.test.ts \
  server/__tests__/rebuild-probe-budget-wal.test.ts
```

Expected: PASS。

---

### Task 5｜改写并落地 `upgrade-fix-regressions` 剩余用例（过滤已过时）

**Files:**
- Modify: `webui/server/__tests__/upgrade-fix-regressions.test.ts`

- [ ] **Step 1: 逐条分类同事文件中的 `it(...)`**

| 用例意图 | 处理 |
|---|---|
| legacy timestamp watermark 误覆盖 | 用主线 P1-50 语义改写；依赖 `watermark_id` 的夹具改为 id 字符串／NULL 旧行 |
| table-preparation 在 defer 后收敛 | **保留**；应对齐 `784e7f7e`／`prepareSchemaStructure` |
| 单表 defer 不得空成功 | **保留** |
| singleton batch 聚合 rejection | **保留／微调** |
| 60s ready | 已在 Task 3 |
| inquiry／cluster／page-budget 生长 | 仅当不与主线 R07 常量策略冲突时保留；冲突则标 skip 原因并开子项，不擅自改 `page-budget.ts` |

- [ ] **Step 2: 跑全文件**

```bash
cd webui && npx vitest run server/__tests__/upgrade-fix-regressions.test.ts
```

Expected: 纳入的用例全 PASS；显式 skip 的条目在测试名或注释写明「等待 page-budget 常量决策」。

---

### Task 6｜`admin/audit.ts` catch-up lag（可选小补丁）

**Files:**
- Modify: `webui/server/admin/audit.ts`
- Test: 既有 audit export／projection 测试；同事若有 fixture 则改写后加入

仅当 Task 4／5 暴露 export lag 诊断缺口，或对照 diff 显示主线仍返回粗糙 boolean 且测试能锁住行为时执行。

- [ ] 移植 `{ caughtUp, lag }` 返回，且 **按 captured upperSeq 计算 lag**（同事注释：证明的是快照 S，不是 S 之后新事件）。
- [ ] 验证相关 audit 测试 PASS。

若无失败用例驱动，本 Task 可标记 **deferred**，不阻塞集成主路径。

---

### Task 7｜`page-budget` 常量 — 决策门（默认不做）

**Files:** `webui/server/admin/page-budget.ts`

- [ ] 列出主线 vs `84becc34` 常量表（MIN／INITIAL／WRITE_SLICE／MUTATION_CHUNK／`size===1→2`）。
- [ ] 对照已有慢盘／pause UAT 证据（`docs/qa/uat/suites/rebuild-probe-budget/`、`cold-start-slow-disk/`）。
- [ ] **无证据不改代码**。若要改，另写一条最小提交并补单测，不塞进 schema／ready 提交。

---

### Task 8｜集成验收（不宣称交付）

- [ ] **Step 1: 目标回归包**

```bash
cd webui && npx vitest run \
  server/__tests__/schema-request-deadline.test.ts \
  server/__tests__/schema-structure-batch.test.ts \
  server/__tests__/upgrade-fix-regressions.test.ts \
  server/__tests__/inferred-turn-watermark-snapshot.test.ts \
  server/__tests__/inferred-turn-rebuild-recovery.test.ts \
  server/__tests__/rebuild-watermark-race.test.ts \
  server/__tests__/rebuild-probe-budget-wal.test.ts
```

Expected: PASS（允许 Task 5／7 中已记录的 skip）。

- [ ] **Step 2: 确认未回退 defer**

```bash
rg -n 'tableRead.deferred|budget-induced deferral|F1/F2' webui/server/schema-structure.ts
```

Expected: `784e7f7e` 关键 defer 路径仍在。

- [ ] **Step 3: 确认 pause 仍在 Chart**

```bash
rg -n 'LUCY_INFERRED_MAINTAINER' deploy/k8s/helm/lucy/values.yaml deploy/k8s/helm/lucy/templates/_helpers.tpl
```

Expected: 仍存在。

- [ ] **Step 4: 产出集成纪要（inbox，非正式发版）**

写 `inbox/84becc34-integration/RESULT.md`：taken／adapted／rejected／already-have 清单 + 测试命令与结果 + 仍开放的 gap（typecheck／客户验收／page-budget 等）。**不**改总账为已关闭，除非另授权。

---

## 3. 建议提交切片（若委托人要求 commit）

1. `fix(webui): add schema request deadline envelope without undoing budget defer`
2. `fix(webui): share remaining timeout across catalog-show connect/query`
3. `fix(webui): ready only after explicit warmup mark (no 60s fallback)`
4. `test(webui): port upgrade-fix regressions onto lucy-v0.30 contracts`（含 watermark 证明或最小修复）

禁止把 docs 总账状态、Chart 无增量改动、`page-budget` 无证据改动塞进上述提交。

---

## 4. 执行选项（计划确认后）

计划确认后可选：

1. **本会话按 Task 0→8 内联执行**（推荐：差集已评估，冲突需连续判断）。
2. **Subagent 逐 Task**（适合 Task 1／4 这种可隔离补丁；Task 4 证明失败时的 runtime 修补建议仍回主会话决策）。

---

## Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 初稿：完成对 `84becc34` vs `lucy-v0.30@9be444ba` 的评估矩阵与外科手术式集成任务拆分；明确拒绝整枝 merge 与覆盖 `784e7f7e` defer |
