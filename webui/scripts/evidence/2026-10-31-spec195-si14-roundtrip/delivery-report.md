# WO-20261030 展示快照去重与隔离 — 交付报告

| 项 | 内容 |
|---|---|
| 日期 | 2026-10-31 |
| 仓库 / 分支 | `/Users/forrest/GitHub/project-lucy` / `lucy-v0.25`（基线 HEAD `87d2738b`，工作区含其他会话的未提交改动） |
| 规格 / 计划 | `webui/docs/195-display-snapshot-invalidation-isolation-spec.md`（v0.1）／ `webui/docs/plans/wo-20261030-display-snapshot-invalidation-isolation.md`（v0.1） |
| 结论 | **完成**（SI-01–SI-14 全部执行；SI-14 现场实例复核未执行） |
| 未做 | 未构建镜像、未部署、未出客户包、未改现场实例、未改 KTX / 运行时 ACL / Policy / 锁生命周期、未 `git commit` / `git push` |

## 1. 相对开工基线的文件清单

开工基线：`inbox/spec195/baseline-git-status.txt`（115 行）。

**新增（5）**

- `webui/server/display-revisions.ts` — 统一文件版本账本 + 按 scope 的校验健康度
- `webui/server/__tests__/display-revisions.test.ts`
- `webui/src/components/DisplayRefreshNotice.tsx`
- `webui/src/__tests__/display-refresh-notice.test.tsx`
- `webui/tests/performance/spec195-display-roundtrip.spec.ts` — SI-14 桌面浏览器往返

**修改（17）**

- `webui/server/display-generation.ts` — touched-path 登记、屏障扩展、退出时确认最终版本
- `webui/server/display-snapshot.ts` — 按 scope 校验、共享有界 I/O、请求级预算、可区分诊断
- `webui/server/admin/agents.ts` — `agent-permissions` 改 P/C；最终核对覆盖 P/C；共享请求预算
- `webui/server/semantic-layer.ts` — 外层屏障按实际待写路径取并集（overlay→D，Manifest→D/P）
- `webui/server/catalog-assets.ts` — Manifest rename 的 scope 由目标路径算出，登记 touched path
- `webui/server/fs-safe.ts` — 中心写/删/移动函数登记 touched path
- `webui/server/index.ts` — `/api/sources` 走请求级预算
- `webui/src/pages/admin/AgentList.tsx`、`webui/src/pages/Catalog.tsx` — 接入刷新失败提示
- `webui/server/__tests__/display-snapshot.test.ts`、`display-invalidation.test.ts`、`display-permission-runtime.test.ts`
- `webui/src/__tests__/agent-list.test.tsx`、`catalog-loading.test.tsx`
- `webui/scripts/entry-performance.mts`、`webui/tests/performance/entry-performance.config.ts` — SI-14 场景与夹具期望修正
- `webui/docs/174-webui-entry-performance-spec.md` — 加 Spec 195 精确修订指针

**未越界**：`webui/server/project.ts`、`webui/package.json` 未改；未触碰发布工作台、L25-11、L25-15、L25-16 的实现文件；工作区其余改动属其他会话，未回退。

## 2. RED / GREEN

| 阶段 | 命令 | 结果 |
|---|---|---|
| RED（HEAD 基线 `87d2738b` + 新增用例） | `npx --no-install vitest run --maxWorkers=1 server/__tests__/display-snapshot.test.ts server/__tests__/display-invalidation.test.ts server/__tests__/display-permission-runtime.test.ts` | **3 文件 8 用例失败**（重复失效 D 1→2 次；overlay-only 保存推进 P；overlay 不可读时 Agent 也 503）。原始输出：`inbox/spec195/task1-red-baseline.txt` |
| GREEN（同一组用例） | 同上 | 3 文件 **52 用例全绿** |
| Plan Task 7 综合 | `npx --no-install vitest run --maxWorkers=1 server/__tests__/display-revisions.test.ts display-snapshot display-invalidation display-rollback-races display-permission-runtime admin-permission-batch admin-agents entry-performance-timing src/__tests__/display-refresh-notice display-query-isolation agent-list catalog-loading` | **12 文件 201 用例全绿**（连续 3 次跑中 2 次全绿、1 次 `DI-05/16` 偶发失败；该文件单跑 18/18 通过，属负载相关抖动，见 §4） |
| 全量回归 | `npx --no-install vitest run --maxWorkers=1`（工作区） | **424 文件 5153 用例：422 文件 / 5150 用例通过，2 文件 3 用例失败**（见 §4，均为环境原因，与本单无关）。日志：`inbox/spec195/full-vitest-worktree.txt` |
| 术语门禁 | `npm run lint:terminology` | PASS（1095 文件） |
| 规格门禁 | `npm run lint:spec` | **FAIL 1 项**：`webui/docs/03-api-spec.md: missing /api/publish-workbench/evidence` —— 该路由是**其他会话**未提交的新增（本单未新增任何路由），已在 HEAD 复现为 PASS |
| 类型检查 | `npm --prefix webui run typecheck` | 工作区 89 个既存类型错误；**本单文件 0 个**。与 HEAD 基线（78）逐条 diff，18 个新增全部落在其他会话文件（`hq-hive-execution.test.ts`、`admin/roles.ts`、`proxy/mcp-proxy.ts`、`access-map-layout.test.tsx`、`connection-overview.test.tsx`） |
| 文档形态门禁 | `npm run lint:spec-docs` | **FAIL**：共 27 条，其中 26 条来自其他会话已跟踪的文档（`lucy-ci-restoration-spec.md`、`2026-10-29-ci-restoration-plan.md`、`2026-10-30-l25-11-publish-window-task.md`、`2026-10-30-manifest-upload-size-fix.md`）。与本单相关的 1 条：`webui/docs/195-display-snapshot-invalidation-isolation-spec.md [filename]` —— 该文件名由 `fbe2d568`（2026-10-30 20:41）引入，**在本单开工前已存在于 HEAD**，本单未改名。门禁自带的修法提示与 `DEVELOPMENT.md`「落盘清单」都指向：为存量文档在 `docs/governance/spec-plan-doc-baseline.json` 写「该文件 + 该规则」单条豁免并写明理由。因该文件是共享治理文件且改名会变更本单文档身份，未擅自处理，见 §7 |
| SI-14 浏览器 | `npm --prefix webui run perf:entry -- --phase baseline --mode production --scenario spec195-roundtrip --iterations 30 --warmup 5 --output inbox/webui-entry-perf/spec195-roundtrip-final2 --skip-build` | exit 0；**31 个实测样本全部成功，0 个 busy 响应**。样本：`inbox/spec195/si14/` |

## 3. 计数口径（文件读取 / 失效 / 重建分开）

- **一次外部 overlay 版本变更** = 1 次派生失效通知（`bumpDisplayGeneration`）+ 1 次派生重建；metadata 与 full digest 先后或并发观察到同一版本时仍为 1 次失效、1 次重建。
- **文件读取次数**：metadata 扫描对签名变化的文件读取摘要（1 次），full digest 扫描对全部被监视文件各读取 1 次；去重只合并失效通知，**不取消必要的重复读取**。
- **写前 / 写后屏障**：单次真实写入推进 D 两次（begin + end），去重不触碰这两条边界。
- **写事务最终确认**：最外层事务退出时读取磁盘最终版本并写入账本（不额外推进代次），观察器随后看到同一版本不再重建。

## 4. 未归因失败的定性

| 失败 | 定性 | 证据 |
|---|---|---|
| `server/__tests__/skill-file-management-147.test.ts`（1 例，120 s 超时） | **环境**：本机 `rm` 被 `mavis-trash` 替身接管，仓库路径下 `rm -rf` 耗时 120 s；同一脚本用真实 `/bin/rm` 只需 **0.025 s**。与本单无关（脚本、`skills/`、`.dockerignore`、`Dockerfile` 均未改） | 手工计时对比 |
| `server/__tests__/api.create-connection.test.ts`（2 例） | **全量跑下的偶发**：单跑 **8/8 通过**（带与不带 harness 的 `GIT_CONFIG_COUNT` 均通过）；全量失败信息为 `Use of "GIT_CONFIG_COUNT" is not permitted`，属环境变量导致的 git init 差异 | 单跑复核 |
| `server/__tests__/display-invalidation.test.ts` 的 `DI-05/16`（综合命令里偶发 1 次） | **负载相关抖动**：该文件单跑 **18/18 通过**；综合命令连续 3 次跑中 2 次全绿。与 `lucy-verification-baseline` 记录的「两个测试文件对 CPU 负载敏感」同类 | 单跑复核 + 连续重跑 |

两处均在 HEAD 基线可复现为 PASS / 环境差异，未按本单改动处理。

## 5. SI-01–SI-14 结果

| ID | 结果 | 证据位置 |
|---|---|---|
| SI-01 | 通过 | `display-snapshot.test.ts` §「Spec 195 SI-01/SI-02」（metadata→full / full→metadata / 并发） |
| SI-02 | 通过 | 同上（第二版本、删除后重建、原子替换、同字节 mtime 更新各确认一次） |
| SI-03 | 通过 | `display-revisions.test.ts` §「unified file revision ledger」（晚到观察不覆盖新账本、已确认版本不再通知、context 切换起新账本） |
| SI-04 | 通过 | `display-invalidation.test.ts` §「SI-04」（overlay-only 保存只推进 D；P/C 不变；Agent 权限不重建；语义资产恰好重建一次） |
| SI-05 | 通过 | `display-revisions.test.ts` §「write transactions confirm the final version」（写前/写后边界仍在、退出后同版本不再重建、嵌套写入不提前确认、rename 两端登记） |
| SI-06 | 通过 | 同上（删除登记）＋`display-rollback-races.test.ts`、`admin-permission-batch.test.ts` 原有回滚 / 权限批处理回归保持绿 |
| SI-07 | 通过 | `display-permission-runtime.test.ts` §「SI-07」（overlay 不可读 → 语义资产如实失败、Agent 仍正常；语义层不可枚举 → D 与 P 同时失败） |
| SI-08 | 通过 | `display-invalidation.test.ts` §「SI-08」（Manifest 写入与 ktx.yaml 变更仍使 Agent 权限失效并重建） |
| SI-09 | 通过 | `display-snapshot.test.ts` §「SI-09」（逾期校验不返回成功载荷并在恢复后恢复；放弃的请求不终止共享校验任务） |
| SI-10 | 通过 | 同上 §「SI-10」（单请求 ≤3 次尝试、一次恢复预算、并发读者共享校验任务、文件 I/O ≤2、展示构建 ≤4） |
| SI-11 | 通过 | `display-permission-runtime.test.ts` §「SI-11」（统计等待期间 P 变化 → 整批重建，不拼接旧权限与新统计） |
| SI-12 | 通过 | `display-snapshot.test.ts` §「SI-12」（busy 原因可区分；诊断不含绝对路径） |
| SI-13 | 通过 | `display-refresh-notice.test.tsx`（7）、`agent-list.test.tsx`、`catalog-loading.test.tsx`（各 1） |
| SI-14 | **通过（本地匿名夹具）／现场复核未执行** | 30 组 Agent ↔ 角色权限 / 语义资产 / 配置审计 往返 + 1 次中途 overlay 编辑后的冷读：31/31 实测样本成功、0 次 busy；主体可见中位数 2.7–3.2 ms（最大 8.4 ms）、网络完成在冷读样本 5.4 ms（1 次请求）。原始样本 `inbox/spec195/si14/`。**现场实例 `http://10.69.95.109:8276` 复核未执行**——本单未部署新版本，不得以旧实例访问宣称修复已生效 |

## 6. 顺手修正（在本单范围内，已在交付报告说明）

`webui/scripts/entry-performance.mts` 的 `readFixtureExpectations` 原本读**服务启动后**的工作夹具，而夹具服务启动会自建 Spec 149 的 `lucy-ops` 语义层，导致期望值 62/47 与清单 60/45 冲突——**该失败在 HEAD 同样复现**，会使 Spec 174 的浏览器场景整体无法运行。改为从**干净夹具**读期望值后恢复。这只影响性能夹具的期望来源，不改产品行为、不改测量合同。

## 7. 需要人决定的问题

1. **文档形态门禁对 Spec 195 文件名的豁免**（`lint:spec-docs`）：该文件由 `fbe2d568`（2026-10-30 20:41）以 `webui/docs/195-...-spec.md` 引入，规则要求新产品 Spec 落在 `docs/specs/lucy-YYYYMMDD-<slug>-spec.md`。两条可选修法：(a) 按 `DEVELOPMENT.md`「落盘清单」与门禁自带提示，在 `docs/governance/spec-plan-doc-baseline.json` 为「该文件 + `filename` 规则」单独立一条并写明理由；(b) 改名并同步引用（会变更本单文档身份与用户给定的路径）。因涉及共享治理文件与文档身份，本单未擅自处理。
2. `lint:spec` 的 `api-spec` 失败来自其他会话未提交的 `/api/publish-workbench/evidence` 路由，需要该会话补 `webui/docs/03-api-spec.md`。
3. 全量回归里 `skill-file-management-147.test.ts` 因本机 `rm` 替身（mavis-trash）超时 —— 是否要在 CI 侧固定 `rm` 行为，或把该用例的 120 s 超时上调，属仓库工程决定，本单未动。
4. 本单**未提交**任何改动。工作区同时有多个会话的未提交内容，提交前需要人工按文件挑选（`git index` 共享，见既有教训）。
5. 现场复核需要在部署窗口单独安排；本单不包含部署与镜像。
