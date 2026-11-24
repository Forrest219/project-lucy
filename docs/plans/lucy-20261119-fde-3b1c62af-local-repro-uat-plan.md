# FDE 3b1c62af 打包前检查：本机复现 UAT 计划

| 元数据 | 内容 |
|---|---|
| 文档名称 | FDE 3b1c62af 打包前检查：本机复现 UAT 计划 |
| 文档类型 | Plan |
| 版本 | v0.3 |
| 撰写日期 | 2026-11-19 |
| 撰写人 | Cursor（Claude） |
| 委托人 | xingchen |
| 基于材料 | FDE 报告 `Lucy升级检查_3b1c62af_20261119`（检查报告.md／检查明细.csv／证据/）；[UAT 约定](../qa/uat/CONVENTIONS.md)；[UAT README](../qa/uat/README.md)；[UAT INDEX](../qa/uat/INDEX.md)；[DEVELOPMENT「端到端三台账」](../governance/DEVELOPMENT.md) |
| 适用范围 | 在本机用同一候选 `3b1c62af` 复现 FDE 的 P0／P1 结论，判定每条结论「成立／不成立／无法判定」。不含修复、不含镜像／Helm 出包、不含客户环境验收 |
| 输出位置 | `docs/plans/lucy-20261119-fde-3b1c62af-local-repro-uat-plan.md` |
| 状态 | v0.3；旧候选及基线的L1复现已完成，原四基线完整L2未完成，旧复现模式历史BLOCKED保留。P1-57新修复模式原完整范围实测FAIL保留；委托人2026-11-19延期G6正式完整导出，本次客户功能测试排除此项，可按限定范围进行。真实局部结果及D5边界见跑次，本条不另授权运行代码；≠ 可上线。 |
| 授权边界 | 本 Plan 仅测试台与证据。历史 D1–D4 的延迟代理／84 构建授权保留；12:35 后另获的投影进度与缩短窗口授权由整改 Plan 记录，须先全真后降级。新增 P1-57 修复模式及 D5 拒绝代理仍待本轮确认；不授权运行代码、amd64 仿真或出包发布 |
| 总账条目 | 待分配（建议新 P1 行，REQ 号由总账分配；见 Task 0） |

> **For agentic workers:** 按 Task 顺序执行，每步勾选 checkbox 并把证据落到 `inbox/uat-fde-3b1c62af-2026-11-19/`。任何一步做不到全真，先停表标 `BLOCKED` 并向委托人申请降级授权，不得用替身或 CR 凑绿。

**Goal:** 用本机可复查的跑次，回答「FDE 报告里的 4 项 P0、3 项 P1 缺陷以及其正向结论，在本机是否同样成立」，并把差异归因到「产品缺陷／环境差异／测试替身差异」之一。

**Architecture:** 两层复现。**L1 原样复现**：在干净 worktree 重跑 FDE 随报告提供的脚本，只验证「FDE 的证据在本机可重现」。**L2 UAT 全真验证**：在独立 Docker 沙箱里用真实服务、真实数据与真实 HTTP 入口，验证用户可观察行为。只有 L2 结果写入测试台 INDEX。

**Tech Stack:** git worktree、Node 22、Vitest、`webui/` 真实 Fastify＋SQLite、Docker（本机 demo／lab 容器）、`scripts/uat/*`、`npm run lint:e2e-ledger`。

## Global Constraints

- **全真原则**：[CONVENTIONS](../qa/uat/CONVENTIONS.md) 第 1–3 条。禁止用 Code Review 冒充 UAT；做不到全真须停表并申请独立授权。
- **主路径可用性优先**：每个「约束／缺陷」用例必须成对验证「缺陷是否复现」与「合法用户路径是否可用」。
- **只读复现**：不改产品源码、不改 `cases.md` 既有期望；不对 `compose-lucy-1`（日常 demo）做 `down -v`、重启或换镜像，沙箱用独立 compose project 与 volume。
- **不使用 `--no-cache`**；不为排障改 Dockerfile 的 install `RUN`；macOS 构建补 `BUILDPLATFORM=linux/arm64`。
- **凭据**：只写文件路径，不写内容；不访问客户生产库；不调用客户 Lucy／Lucy2 业务工具。
- **术语**：跑次与总账用语遵守 [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md)。
- **报告口径**：UAT 判定只用 `PASS`／`PASS WITH GAP`／`FAIL`／`SKIPPED`／`BLOCKED`／`NOT RUN`。对已知缺陷，「复现成立」写作 `FAIL（预期，复现 FDE-xx）`，不得写成「PASS」。

---

## 0. 目标与范围

目标是对 FDE 报告的每条结论给出本机可复查的判定。范围只含复现与判定，不含修复、出包、客户环境验收。

## 1. 开工前置：先核实的事实（已在本机确认）

| 事实 | 本机结果 |
|---|---|
| 当前 HEAD | `lucy-v0.30`＝`3b1c62af32af7b6d045caef7fa10ccc92300ae97`，与 FDE 候选一致 |
| 工作区状态 | **不干净**：`Dockerfile`、`e2e-ledger.md`、总账、`INDEX.md`、一份 Spec 有未提交修改。因此复现必须在 `git worktree` 的干净检出上做，不能直接在工作区跑 |
| 基线可达性 | `ff4762c9`、`3a9f0711`、`84becc34`、`abb38913` 均在本地对象库，无需联网 |
| 共同祖先 | `merge-base(84becc34, HEAD)＝ff4762c9`，与 FDE「84 不是候选祖先」一致 |
| 可用容器 | `compose-lucy-1`（demo，勿动）、`lucy-old3a9`（3a9 旧镜像，可作 AUDIT-01 旧基线）、`compose-demo-db-1`（MySQL 8.4）、`lucy-uat-hive-hms`、`doris-lab-2014-fe-1`、`lucy-krb-hms`、`kdc-lab` |
| Node | 本机 v24.13.1，FDE 用 22.23.1。Dockerfile 与 `engines` 均为 22，L1 须用 Node 22 |

**一条必须先澄清的合同问题（R1）**：`webui/server/__tests__/upgrade-fix-regressions.test.ts` 的 8 个 `it.skip` 带有作者原因，不是无意丢失。例如：F04 两项写「needs batchRead; not on lucy tip」，滚动窗口一项写「colleague assertion diverges on current rebuild; needs dedicated audit investigation」。FDE 把这些视为缺陷，且抽取 84 的用例时删除了当前不存在的 `batchRead` 参数。所以本计划先判断这些断言对应的**用户可观察行为**是否仍是 0.30 合同，再下「缺陷」结论。判断依据只能是 L2 的真实用户行为，不是 84 的测试文本。

---

## 2. 复现矩阵

「L2 全真度」列：**A**＝真实服务与真实数据，可直接做；**B**＝真实服务，但需注入延迟或进度，属降级，须 §9 D2 授权；**—**＝不属 UAT。

| FDE 编号 | FDE 结论 | L1 原样复现入口（FDE 证据） | L2 UAT 用例 | L2 全真度 | 对照基线 |
|---|---|---|---|---|---|
| F01 | 正式 CSV／ZIP 导出，lag 1→0 后仍 409；S 之后新事件误拒 | `functional-export-catchup.test.ts`＋`functional-export-catchup-fixture.ts` | UAT-FDE-01 | B（投影 lag 难自然构造，见 Task 5） | ff4762c9、84becc34 |
| F02 | 首语法慢拒绝 7100ms 被判 timeout，第三语法不再试 | `functional-verify-hive-slow-legal.mts` | UAT-FDE-02 | B（需让合法拒绝变慢） | ff4762c9（绿）、当前（红） |
| F03 | 单表预算 deferred 被 preview 吞掉，空结构、无 deferred／rejections | `functional-verify-hive-default-envelope.mts` | UAT-FDE-03 | B | 无 |
| F04 | 宽表整批 deferred 后客户端报「无进展」；30 表混合权限不继续 | `functional-skipped-skipped-public-behavior.test.ts`＋`functional-skipped-vitest.config.ts` | UAT-FDE-04 | B（真实 MySQL 宽表够快，不会触发预算，需注入延迟） | 84becc34（绿） |
| AUDIT-01 | 30 天窗口滚动后同一调用归属两份问询 | `audit-repros/audit-rolling-window.mts`、`audit-baseline-rolling.mts` | UAT-FDE-05 | **A**（真实等待约 40 秒，不需要改时钟） | 3a9f0711（红）、84becc34（绿） |
| G01 | 根测试登记漏 4 个 concepts 测试 | `npm run test:ci-workflow-contracts` | 不属 UAT，记入复现记录 | — | — |
| G02 | 2 个 Plan 新增 7 条文档形态违规；根门禁 407／2 | `npm run lint:spec-docs`、`npm run test:root-contracts` | 同上 | — | — |
| G03 | 8 个原断言变空 `it.skip` | `升级回归断言跳过对比.patch` | 同上；与 R1 联动 | — | 84becc34 |
| T01 | 类型检查 37 条错误 | `npm run typecheck` | 同上 | — | 3a9（40） |
| S01／CI01 | dev 依赖 10 项告警；该 SHA 无远端 CI | `npm audit`、`gh run list --commit` | 同上 | — | — |
| 正向 | 默认全量 6550 通过／8 跳过；SIGKILL 恢复 1000 条；冷启动、重启探针达标 | `npm test`；`audit-native-sigkill-rerun`；`独立五路慢盘性能.mjs` | UAT-FDE-06／07，复用 `UAT-SUITE-INFERRED-REBUILD-RECOVERY`、`UAT-SUITE-COLD-START-SLOW-DISK` | A | — |

**不在本 Plan 范围**（FDE 自己也标「未执行」）：C05 答案正确性、C06 最终制品权限矩阵、C09 正式镜像／Helm／ELF、C10 备份升级回退再升级、真实 K8s。

---

## 3. 用例定义（拟建 suite：`UAT-SUITE-FDE-PACKCHECK`，前缀 `UAT-FDE-*`）

> 套件文件落点：`docs/qa/uat/suites/fde-packcheck-3b1c62af/{suite,cases,fixtures}.md` 与 `runs/`，模板见 [`templates/`](../qa/uat/templates/suite.md)。

### UAT-FDE-R0 环境与身份门禁（必做）

1. 干净 worktree：`git worktree add /private/tmp/lucy-fde-3b1c62af 3b1c62af32af7b6d045caef7fa10ccc92300ae97`；另建 `ff4762c9`、`3a9f0711`、`84becc34` 三个只读 worktree。
2. 每个 worktree `git status --short` 为空，`git rev-parse HEAD` 与目标完整 SHA 一致。
3. L2 镜像用 `org.opencontainers.image.revision` 或构建参数写入 `gitSha`，`gitDirty=false`。

**期望**：四个 worktree 身份正确；镜像身份可查。任一不满足，后续用例全部 `BLOCKED`。

### UAT-FDE-R1 合同适用性核对（必做，先于 F04／AUDIT-01 判定）

1. 逐条对照 8 个 `it.skip` 的原因与 FDE 缺陷，列出「skip 原因＝合同未采纳」还是「skip 原因＝尚未实现」。
2. 对 F04：确认「合法宽表最终必须能读完」是否是 0.30 合同，依据 [P1-34 大 Schema Spec](../specs/) 的 LS 条款与 `UAT-SCALE-*` 规模下限。
3. 对 AUDIT-01：确认「一个调用只属于一个问询」是否是合同，依据 `UAT-TRC-*`／`UAT-EQ-*` 与审计 Spec。

**期望**：产出一张「skip 原因 × 用户可观察合同」表。判为「合同未采纳」的，仍须在 L2 看真实用户行为，由 L2 结果而不是 skip 原因定性。

### UAT-FDE-01 正式完整导出等待追平（F01）

**步骤（L2）**
1. 在沙箱容器里写入真实审计日志，让投影进入 `lag>0`。
2. 在 lag 追平的同一时刻，请求正式 CSV 与正式 ZIP（`complete`）。
3. 追平后又写入新事件，请求同一次捕获上界 S 的导出。
4. 同一时刻再请求 diagnostic 导出作对照。
5. 持续 lag 不追平时请求 complete 导出。

**期望（合同）**：步骤 2、3 返回 200 并封存；步骤 5 保持拒绝；diagnostic 不能代替 complete。

**判定**：步骤 2 或 3 为 409＝`FAIL（预期，复现 FDE-F01）`。步骤 5 若不再拒绝＝另记 `FAIL`（约束被误放开）。

**降级**：若无法用真实写入稳定构造 `lag 1→0`，标 `BLOCKED` 并申请 §9 D2，**不得**直接改用 FDE 的受控进度替身。

### UAT-FDE-02 Hive 慢合法语法回退（F02）

**步骤（L2）**
1. 用 lab 的 Hive／Doris 外部目录（`lucy-uat-hive-hms`、`doris-lab-2014-fe-1`），让首个语法的**合法拒绝**耗时约 7100ms，后两个语法各约 100ms。
2. 通过真实 `GET` 表结构预览路径读取该表，单表预算 8000ms。
3. 对照：快速前两语法拒绝＋第三成功；真正超时；连接被关闭。

**期望**：步骤 2 在总预算内读到字段（旧 ff 同输入约 7.3 秒成功）；对照三项分别按各自合同返回。

**判定**：步骤 2 报 timeout 且未尝试第三语法＝`FAIL（预期，复现 FDE-F02）`。

### UAT-FDE-03 单表 deferred 披露（F03）

**步骤（L2）**：用正式 19 秒请求／10 秒调度预算打单表预览，使该表预算用尽。

**期望**：响应包含 deferred 或 rejections，客户端可多轮续读。

**判定**：空结构且无披露＝`FAIL（预期）`，同时记「正式 HTTP／UI 实际影响」，补齐 FDE 标为「待验证」的缺口。

### UAT-FDE-04 宽表整批 deferred 后客户端收敛（F04）

**步骤（L2）**
1. 用 `scripts/uat/seed-large-schema-fixtures.sh all` 造 50 表×400 字段（须不低于 `UAT-SCALE` 规模下限）。
2. 对数据库访问注入每次 SQL 约 6000ms 的延迟，使首轮调度预算 10000ms 耗尽。
3. 用真实预览 API＋真实客户端 `readCheckedTableColumns`（`src/lib/prepareSchemaStructure.ts`）读全部表。
4. 变体：30 表中 `t0` 权限拒绝，其余合法。

**期望**：50 表 20000 字段全部读到；变体中 29 表继续、`t0` 汇总为「有 1 张表没有读到字段」。

**判定**：客户端报「读取表结构没有进展，请稍后重试。」＝`FAIL（预期，复现 FDE-F04）`。

### UAT-FDE-05 滚动窗口唯一归属（AUDIT-01）

**步骤（L2，A 级全真，不改系统时钟）**
1. 在沙箱 volume 的审计库里，为同一会话写两条调用：`t1＝now-30d+10s`、`t2＝now-30d+50s`（间隔 40 秒，小于默认 120 秒簇间隔）。
2. 触发重建，确认形成 1 个问询。
3. **真实等待约 35 秒**，使 `t1` 滑出 30 天窗口、`t2` 仍在窗口内。
4. 写入当前时刻的另一会话调用，再触发重建（维护器与读时重建各跑一次）。
5. 请求两个问询详情、调用流水、问询列表。
6. 同一用例分别对 3a9 容器（`lucy-old3a9`）、84 构建、当前候选执行。

**期望**：`t2` 只属于一个问询；详情编号与调用流水一致；`t1`、`t2`、新调用共 3 条始终保留。

**判定**：`t2` 同时属于两个问询、两个详情都 200 但编号 1／2＝`FAIL（预期，复现 FDE-AUDIT-01）`。

### UAT-FDE-06 默认全量与门禁（L1，不进 INDEX）

在干净 worktree、Node 22 下：
1. `npm ci`（根与 `webui/`，按锁文件）；复制 `ktx.yaml.example→ktx.yaml`、`webui/config/access.yaml.example→webui/config/access.yaml`（与 CI 一致）。
2. `npm test`；记录通过／失败／跳过数，预期 `6550 passed | 8 skipped`。
3. `npm run test:root-contracts`（预期 407／2）、`npm run test:ci-workflow-contracts`（预期 61／1）、`npm run lint:spec-docs`（预期 7 条）、`npm run typecheck`（预期 37 条）。
4. `npm audit --omit=dev`（预期 0）、`npm audit`（预期 WebUI 10 项）；`gh run list --commit 3b1c62af…`（预期 0 次）。

### UAT-FDE-07 FDE 正向结论复核（L2，复用既有套件）

| FDE 正向结论 | 复用套件与用例 | 本机阈值 |
|---|---|---|
| 真实 SIGKILL 后恢复 1000 条且不重复 | `UAT-SUITE-INFERRED-REBUILD-RECOVERY`：IRR-01–04 | 沿用该套件 |
| 冷启动／重启五路 120 秒 | `UAT-SUITE-COLD-START-SLOW-DISK`：COLD-01／02，`UAT-SUITE-REBUILD-PROBE-BUDGET`：RPB-01–03 | FDE 阈值：livez max ≤1000ms、p99 ≤400ms，diff p95 ≤3000ms，五路无 3 秒超时 |

两套件须用**干净候选镜像**跑，并在跑次注明本机为 arm64 原生，FDE 为 amd64 仿真，数值不能直接对比。

---

## 4. 任务序列

### Task 0：治理前置（动手前必做）

- [x] 在总账 [`lucy-20261107-lucy-0-30-feature-inventory-pool.md`](lucy-20261107-lucy-0-30-feature-inventory-pool.md) 入池一行「FDE 3b1c62af 打包前检查本机复现」，取得条目 ID／REQ（规则：先入总账再动手）。
- [x] 为 F01、F02、F04、AUDIT-01 各确认总账是否已有对应行；没有的补录「待确权」行，**不写开发授权**。
- [x] 在 `docs/qa/uat/suites/fde-packcheck-3b1c62af/` 建 suite／cases／fixtures，INDEX 增一行状态 `NOT RUN`，`e2e-ledger.md` 挂总账 ID。
- 验证：`npm run lint:e2e-ledger` 退出 0；`npm run lint:spec-docs` 对本 Plan 无新增违规。

### Task 1：身份与 worktree（UAT-FDE-R0）

- [x] 建 4 个 worktree（见 R0），输出 `inbox/uat-fde-3b1c62af-2026-11-19/identity.json`。实际路径 `/private/tmp/lucy-fde-cursor/{cand,ff,3a9,84}`（另一 Agent 占用了 `/private/tmp/lucy-fde`，故隔离）。
- [x] 用 `npx -y node@22` 或已装 Node 22 固定运行时，记录 `node -v`。
- 验证：四个 `git status --short` 为空。

### Task 2：L1 门禁复现（UAT-FDE-06）

- [x] 依序执行 §3 UAT-FDE-06 的 4 组命令，原始输出落 `inbox/.../l1/`。
- [x] 把本机数字与 FDE 数字逐项对表（通过数、失败数、跳过数、错误条数）。
- 验证：每项一行「FDE 值／本机值／一致?」；不一致项写原因（环境、依赖版本、Node 版本）。

### Task 3：L1 FDE 脚本原样复现

> **已执行（2026-11-19）**：结果见 `inbox/uat-fde-3b1c62af-2026-11-19/l1/summary.md`。另发现 G01 实为 6 个漏登记文件（FDE 报告写 4 个）；`npm test` 首跑 1 个偶发失败，复跑 6550 通过。

- [x] 把证据目录里 `functional-*`、`audit-repros/*` 复制到候选 worktree 的 `inbox/` 对应子目录，**只改 import 路径**，保留一份与 FDE 原文的 `diff`。
- [x] 在候选跑 F01／F02／F03／F04／AUDIT-01 脚本；在 ff4762c9、3a9、84 worktree 跑对应对照（F04 对 84 只选 2 项）。
- 验证：当前 5 项均失败；对照结果与 FDE 一致（F02 ff 绿、F04 84 绿、AUDIT-01 3a9 红／84 绿、F01 ff 红）。
- 记录：L1 结果写入 `inbox/.../l1/`，**标「自动化复现」，不写 UAT PASS／FAIL**。

### Task 4：合同适用性核对（UAT-FDE-R1）

- [ ] 产出 8 个 `it.skip` × 合同表，交委托人确认「哪些是 0.30 合同」。
- 验证：每个 skip 有「合同／非合同／待定」三值之一与依据链接。

### Task 5：L2 沙箱与镜像

- [ ] 在干净候选 worktree 构建 `project-lucy:fde-3b1c62af`（有缓存；`BUILDPLATFORM=linux/arm64`；构建结束记录 `ktx install layer: CACHED|MISS|UNKNOWN`）。
- [ ] 以独立 compose project／volume 起沙箱（不碰 `compose-lucy-1`），端口与 demo 错开，凭据只写文件路径。
- [ ] 先读 `webui/server/admin/audit.ts` 3189／4792 附近与投影进度来源，设计 F01 的真实 lag 构造；写入 `fixtures.md`。
- 验证：沙箱 `healthy`；`/api/health` 返回的 `gitSha` 与候选一致且 `gitDirty=false`。

### Task 6：L2 先做 A 级用例（UAT-FDE-05）

- [ ] 执行 AUDIT-01 对 3a9、84、候选的三次对照。
- 验证：与 FDE 三向结论比较。分叉则在跑次写明，不改 `cases.md` 期望。

### Task 7：L2 B 级用例（UAT-FDE-01／02／03／04）

- [ ] 先停表：向委托人申请 §9 D2（延迟注入／进度构造的降级授权）。
- [ ] 获批后逐项执行；未获批的项标 `BLOCKED`，不用替身代替。
- 验证：每项都含「缺陷复现」与「合法用户路径」成对结果。

### Task 8：L2 正向结论复核（UAT-FDE-07）

- [ ] 用候选镜像跑 IRR-01–04、COLD-01／02、RPB-01–03；RPB 按既有「≥3 次独立冷启动」口径。
- 验证：阈值按 FDE 表，数值与 FDE 并列，写明 arm64 对 amd64 仿真的差异。

### Task 9：汇总、回写与清理

- [ ] 写 `runs/2026-11-19-cursor-fde-3b1c62af-repro.md`，含 §5 的差异表。
- [ ] 回写 INDEX 最近跑次（只写本跑次判定，不改 Spec 合同状态）；`e2e-ledger.md` 缺口表记录与 FDE 的分叉。
- [ ] 清理沙箱容器与 volume、临时连接 id、`uat_` 前缀种子库按 README 约定处理；`git worktree remove`。
- 验证：`npm run lint:e2e-ledger` 退出 0；`git status` 只出现本 Plan、suite 文件、INDEX、e2e-ledger、总账的变更。

---

## 5. 结论回写：差异分类

每条 FDE 结论最终归入下表一类，写入跑次。

| 本机结果 | 归类 | 含义 |
|---|---|---|
| L1 复现、L2 复现 | **FDE 结论成立（全真）** | 产品缺陷，进入修复排期（须授权） |
| L1 复现、L2 不复现 | **仅替身成立** | FDE 测试替身与真实路径有差异；缺陷是否存在待重新评估 |
| L1 不复现 | **FDE 证据不可重现** | 查 Node 版本、依赖、harness 适配差异 |
| L1 复现、L2 BLOCKED | **无法判定** | 须委托人授权降级或补环境，才能下结论 |
| 本机更严重或多出问题 | **新增发现** | 另入总账 |

---

## 6. 本机与 FDE 环境差异（必须在跑次逐项披露）

| 项 | FDE | 本机 | 影响 |
|---|---|---|---|
| 架构 | linux/amd64 经 QEMU 仿真 | arm64 原生 | 性能数值不可直接对比；功能缺陷不受影响 |
| Node | 22.23.1 | 须固定 22 | 版本不一致会引入假差异 |
| 依赖安装 | 独立锁文件，联网补全 | 同锁文件 | 应一致 |
| 外部 SQL／投影进度 | 受控替身 | 真实服务＋（获批后）延迟注入 | 决定 L2 全真度 |
| 内部镜像 | 继承旧测试镜像系统层与 KTX 层 | 干净候选重建 | 本机更接近标准构建 |
| 工作区 | 隔离 archive | 工作区不干净，用 worktree | 不用工作区直接跑 |

---

## 7. 风险与回滚边界

- **84 不是祖先**：FDE 用 84 作「正常参考」，前提是 84 的断言代表 0.30 合同，R1 就是为核对此点。
- **B 级用例依赖降级授权**：若 D2 不批，F01／F02／F03／F04 在 L2 只能 `BLOCKED`，L1 结果不可写 UAT PASS／FAIL。
- **F03 影响面**：FDE 只确认函数级，本计划补正式 HTTP／UI 影响，可能把 P1 改判。
- **时序类用例**：AUDIT-01 的约 35 秒真实等待要求沙箱时钟稳定；重试前须重新造数据。
- **并发 KTX 重载**污染：历史跑次出现过被并发重载污染作废，沙箱期间不要对其他容器做 `demo:upgrade`。
- **绿灯 ≠ 可上线**：本 Plan 任何结果都不构成放行依据。

## 8. 验收与完成定义

完成定义：下列五项全部满足，且委托人确认 §5 的归类结果。

- [ ] §2 矩阵每行都有本机结论，归入 §5 五类之一。
- [ ] 每个 L2 用例都有缺陷复现与合法用户路径的成对记录。
- [ ] L1 与 L2 结果分别存放，INDEX 只含 L2 判定。
- [ ] 与 FDE 的每处分叉都有原因分类。
- [ ] 沙箱与 worktree 已清理；`lint:e2e-ledger` 退出 0。

## 9. 待委托人确认的决策点

| 编号 | 问题 | 委托人决定（2026-11-19） |
|---|---|---|
| D1 | 是否同意先入总账并新建 `UAT-SUITE-FDE-PACKCHECK` | **同意**；这是动手前置 |
| D2 | F01／F02／F03／F04 无法零改动全真构造时，是否授权降级 | **仅授权「延迟注入代理」**（真实 MySQL／Hive／Doris＋人为 SQL 延迟）。F01 的投影进度先尝试真实构造，失败后须单独申请，不得直接用受控进度替身 |
| D3 | AUDIT-01 的 84 基线是否构建 84 镜像做 L2 | **构建**（有缓存构建一次） |
| D4 | 是否需要 amd64 仿真复核性能数值 | **否**；性能结论只作 arm64 参考，amd64 留给出包阶段 |
