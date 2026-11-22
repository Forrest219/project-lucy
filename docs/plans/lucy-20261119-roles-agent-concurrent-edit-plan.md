# 角色权限与 Agent 多人编辑冲突恢复 Implementation Plan

> 实施者按仓库 AGENTS.md → DEVELOPMENT 逐任务执行；可选用 executing-plans 技能。开发及分批提交已获委托人2026-11-20明确授权，当前执行边界见下节。

**Goal:** 无关对象修改可以安全先后保存，真实冲突和未知结果有草稿保留与恢复路径。

**Architecture:** 保留单实例发布窗口，在其内部按对象版本与预览依赖重检、基于最新整份配置应用 patch。只用可信持久终态确认保存结果，不自动重放写请求。

**Tech Stack:** TypeScript、Fastify、React、既有配置发布协调器与持久审计；不改登录策略或 KTX。

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施 Plan / v1.2 |
| 日期 / 产品线 | 2026-11-19 / 0.30.0 |
| 功能编号 | P1-59／REQ-030-080 |
| 状态 | S5｜**v1.2；功能合同已收口（2026-11-22，scoped／仅B1；A1）**。证据＝batch1 跑次＋[收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。测试台仍 PASS WITH GAP（仅B1）。不入核心分母。≠ 可上线 |
| 授权边界 | 委托人2026-11-20已授权实现与隔离验证，现批准暂停长测、分批归档并commit本进程；当前只完成首批必要验证，第二批不自动执行；不发布上线、不改KTX；索引仅P1-58 D7两条，不新增表／列。 |
| 验收 | [Spec](../specs/lucy-20261119-roles-agent-concurrent-edit-spec.md) SC-01–13；组合结果只见 [UAT INDEX](../qa/uat/INDEX.md) |
| 需求与测试 | [总账](lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[共享 suite](../qa/uat/suites/roles-agent-concurrency-scale/suite.md) |

## 2026-11-20 分批交付决议（本轮执行边界）

委托人批准“暂停长测，收敛当前优化，分批继续”，并明确“收口，commit本进程”。本次收口对象是**本轮实现与证据归档**；完整功能合同仍保留SC-01–13，没有因测试耗时删除验收、不将未执行项计PASS。

- 首批：冻结本进程已实现的统计减负／有界worker／两条已授权索引、对象级提交与草稿／回执恢复；短回归、类型检查、真实前台查看／新建／编辑／删除及冲突恢复。范围、候选指纹和实际结果以[正式跑次](../qa/uat/suites/roles-agent-concurrency-scale/runs/2026-11-20-codex-racs-batch1.md)为准。
- 第二批（本轮延期，不自动执行）：完整F58／F59、B／2×／5×三轮、固定窗口历史增长、双身份每类百对授权写、全部DEP与剩余局部故障矩阵、精确改前对照及索引完整成本。仍沿用原预算与判定器。
- 首批不包含其他进程的P1-66摘要投影或核心可用性改动。现网502／503具体原因未取得运维证据，不能因本轮优化宣称已定位或消除。
- 发布取证R、发布、上线均未执行；本次提交不构成面向用户更新的放行签字。后续用户试用前仍须按其候选核对必要验收和交付授权。

## 目标

先保留草稿、准确区分占用／冲突／结果未知，再引入对象版本和安全重建。请求协议兼容旧调用方；正常并发不因共用账号被误解释为互踢。

## 开工前置

1. 终稿由委托人明示确权（本次修订即终稿、免Codex CLI终审）；交互Q1–Q6为设计评审通过，浏览器未执行。委托人已授权实现及必要验证；本次按分批决议停止长测。
2. 核对当前 `publish-coordinator.ts`、`access-config.ts`、安全审计的事务边界；不得移出提交重检、运行时确认或审计终态。
3. 依赖正反例以Spec DEP-01–11及对象摘要金样本为准，创建／复制／删除各路径均核对；previewEffectDigest与整配置candidateDigest分开，避免无关对象假冲突。
4. 终稿前只读审计核查已完成，Spec §4.1确定复用config_change_log原行、唯一键与最小回执，不新增schema。开工先以真实序列化／终态链路验证此接法；若被证伪回设计，不在Task 4临时加表。
5. 共用 UAT 的 2×／5× 数据与会话向量冻结；所有写操作仅允许隔离 Docker fixture，不碰现网。

## 实施任务（已授权；按分批决议登记实际完成与延期）

### Task 1：真实并发与持久化失败基线

- Test：`webui/server/__tests__/admin-roles.test.ts`、`admin-agents.test.ts`、`publish-coordinator.test.ts`；拟新增 `roles-agent-concurrent-edit.test.ts`。
- Step 1：两独立会话读同一文件，分别修改不同对象，捕获当前无关冲突。
- Step 2：记录同对象变化、目标删除、预览后依赖变化与发布占用的当前行为。
- Step 3：真实进程注入局部写入／提交／审计失败，冻结“不得返回成功”的既有合同证据。
- 授权后命令：`cd webui && npx vitest run server/__tests__/roles-agent-concurrent-edit.test.ts server/__tests__/publish-coordinator.test.ts`；相关文件现已存在；已执行结果见正式跑次。

### Task 2：对象摘要与预览绑定

- Modify：`webui/server/admin/access-config.ts`、`webui/server/admin/roles.ts`、`webui/server/admin/agents.ts`；若抽取 helper，拟新增 `webui/server/admin/access-object-version.ts`。
- Step 1：先为未知字段、有序规则、集合字段、缺席对象写摘要等价／非等价用例。
- Step 2：新增对象版本与实际依赖摘要；维护 legacy 全文件版本分支；混合冲突输入拒绝。
- Step 3：dryRun 返回与目标、patch、依赖、效果和身份绑定的 previewToken；不把全文件 hash 当作对象依赖。
- 出口：SC-02／04／10。

### Task 3：发布窗口内安全应用 patch

- Modify：同上，并审阅 `webui/server/publish-coordinator.ts`、`webui/server/proxy/authorization-barrier.ts`；原则为复用、不改窗口语义。
- Step 1：进入窗口后重新鉴权、检查恢复门禁、重读配置与 operationId 状态。
- Step 2：目标没变、依赖不变时，把 patch 应用到最新配置；目标变化或效果变化返回明确冲突；创建、复制、删除均走各自存在性／引用保护。
- Step 3：在窗口内完成 fresh 校验、治理门禁、审计 intent、写入、运行时确认、terminal 与绑定 after。
- Step 4：验证两个无关修改最终都保留，同对象后提交明确冲突；占用即时返回而非静默排队。
- 出口：SC-01／02／04–07／12。

正式写入仍串行，窗外预计算不可代替窗内最终鉴权、依赖与效果重检；记录窗口持有耗时与BUSY，不能把对象版本协议解释为并行写吞吐保证。

### Task 4：保存结果只读确认

- Modify：既有 Role／Agent 写响应、`webui/server/admin/access-config.ts`；拟新增最小只读状态路由模块 `webui/server/admin/access-write-status.ts`，登记到 `webui/server/index.ts` 与 API 文档。
- Test：拟新增 `webui/server/__tests__/access-write-status.test.ts`。
- Step 1：用真实反向代理仅阻断提交响应，检查提交确实发生；不是 mock 成功体。
- Step 2：按Spec §4.1把operationId映射到现有idempotency_key，racsReceipt持久绑定原账户UID／请求摘要／目标／版本；intent认领和terminal合并不丢回执，可信requestId不被覆盖。
- Step 3：首次认领失败不得继续落盘；同号异内容／异账号拒绝；查询最小历史提交结果，不把后来当前值配成旧after；证据不足unknown。
- Step 4：检查超时后的核对均为只读；新提交必须新预览、新确认、新 operationId。
- 出口：SC-08／09／12；不新增schema，核查底座不等于协议已实现；跨重启与审计连续性系统故障在R另验。

### Task 5：草稿保留与冲突比较

- Modify：`webui/src/pages/admin/RoleDetail.tsx`、`AgentDetail.tsx`、`AgentList.tsx`、必要的 `RoleList.tsx`、`webui/src/lib/types.ts`；复用既有状态／浮层组件。
- Test：`webui/src/__tests__/admin-roles.test.tsx`、`admin-agents.test.tsx`、`agent-list.test.tsx`；必要时新增具名冲突场景文件。
- Step 1：409／发布占用／断网后输入保持，刷新当前值不覆盖内存草稿。
- Step 2：比较基线／我的修改／当前值；权限字段不自动合并；删除后不得复活。
- Step 3：未知结果只读核对最多 3 次／6 秒；保留后续手动核对与重新预览入口，不能误报失败或成功。
- Step 4：同账号独立 Cookie 与不同账号均可用；无权读取时不泄露新配置；不新增敏感 localStorage 草稿。
- 出口：SC-03／08／09／11／13。

### Task 6：组合高负载 UAT 与审计复核

- 共用 P1-58 规划的 `scripts/uat/roles-agent-concurrency-scale.mts`，按 [cases](../qa/uat/suites/roles-agent-concurrency-scale/cases.md) 执行；完整选择器延期第二批；本轮只执行首批必要验证。
- F59先按suite矩阵执行模块事务、DEP-01–11与14-B／C，不要求先完成共享系统压力；R再完整执行2×／5×双身份／读写／MCP／慢盘／长稳态，分开登记。
- fresh 依赖变化、提交后丢响应、写失败、恢复后的合法提交全部需实测；系统级重启与 MCP 共存只记共享 UAT，不代替本条局部事务检查。
- 按现有审计能力核对 operationId／actor／after 与配置最终状态；共用账号只能追到账号及会话，不能虚构自然人。
- 代码测试通过后再进行桌面浏览器验证，更新 runs 与 INDEX；不改旧 P1-13 PASS，也不以旧 PASS 推断新套件。

## 浏览器验证

- 路由：/admin/roles、/admin/roles/:roleId、/admin/agents、/admin/agents/:userId
- 视口：1920×1080
- 状态：E1、E2、E3、E4、E5、E6、E7、E8、E9、E10、E11、E12、E13、E14、E15、E16、E17、E18、E19、E20、E21、E22、E23、E24、E25、E26、E27、E28
- 证据：[2026-11-20首批跑次](../qa/uat/suites/roles-agent-concurrency-scale/runs/2026-11-20-codex-racs-batch1.md)；只认该记录实际覆盖，未覆盖E项延期，不主张全矩阵通过。

## 验收与本轮完成定义

本轮按委托人分批决议归档实现、必要回归和真实前台主路径证据，并commit本进程；正式判定见[首批跑次](../qa/uat/suites/roles-agent-concurrency-scale/runs/2026-11-20-codex-racs-batch1.md)。首批归档不等于原完整SC-01–13合同收口；未跑、失败与缺口逐项保留，不抬预算，不把旧候选证据移算为新候选PASS。第二批待委托人明确继续后执行。

## 风险

| 风险 | 应对 |
|---|---|
| 对象摘要遗漏字段导致覆盖 | 未知字段保留，所有可写语义入摘要，独立金样本检查 |
| 为减少冲突而漏依赖 | 依赖、候选效果、身份和门禁提交时重算，变化必须重新确认 |
| 结果未知永久卡住 | 有界核对＋保留草稿＋再次核对／fresh 预览，不能自动重放 |
| 拆全局锁破坏跨模块一致性 | 保留现有提交窗口；压缩纯预处理但提交重检仍在窗内 |
| 共用账号审计被过度解释 | 明确账号／会话可追，无法证明实际操作人 |

## 落盘清单核对

本次两份 Spec／Plan 的 17 项自查与机器门禁记录统一见 [读取响应 Plan「落盘清单核对」](lucy-20261119-roles-agent-read-responsiveness-plan.md#落盘清单核对本次两份-specplan-共用)。本条元数据与全部状态镜像同句；交互 E1–E28、四路由与浏览器四行已按门禁文法核对，均未执行。新脚本、schema 与持久化机制均未创建或修改。

设计定稿与事实纠正见 [评审处理记录](../reviews/2026-11-19-roles-agent-design-finalization.md)。六问设计评审通过不替代E1–E28浏览器执行；未知结果回执是已确定的实现方案，尚未主张行为通过。

## 2026-11-20 补齐执行计划

1. 补齐服务端实际编译输入闭包、窗内身份／恢复／门禁重检、操作回执与创建删除恢复边界；补统计失败与慢查询逃生回归。
2. 执行聚焦回归与类型检查，保留原始输出；独立Docker候选冻结源码清单、构建标识与镜像摘要，不覆盖共享demo。
3. 按suite F58／F59映射执行B／2×／5×、独立oracle、并发与局部真实失败，不以smoke替代。
4. 真实前台浏览器1920×1080逐E编号验收，页面计时与API分列；全部SC通过后同步现值、INDEX与e2e，R仍单列。

当前执行记录与证据：`inbox/p1-58-59-finalization-20261120/`；正式跑次在共享suite的runs落盘。
