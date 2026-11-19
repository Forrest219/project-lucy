# 角色权限与 Agent 多人编辑冲突恢复 Implementation Plan

> 实施者按仓库 AGENTS.md → DEVELOPMENT 逐任务执行；可选用 executing-plans 技能。本文件不是开发授权。

**Goal:** 无关对象修改可以安全先后保存，真实冲突和未知结果有草稿保留与恢复路径。

**Architecture:** 保留单实例发布窗口，在其内部按对象版本与预览依赖重检、基于最新整份配置应用 patch。只用可信持久终态确认保存结果，不自动重放写请求。

**Tech Stack:** TypeScript、Fastify、React、既有配置发布协调器与持久审计；不改登录策略或 KTX。

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施 Plan / v1.0 |
| 日期 / 产品线 | 2026-11-19 / 0.30.0 |
| 功能编号 | P1-59／REQ-030-080 |
| 状态 | v1.0。终稿确权；委托人2026-11-19明示开发授权。Wave1–3 实现完成并经 code review APPROVE（待 F59／浏览器）；本轮验证仅 vitest＋code review，未跑 docker／UAT；测试台 NOT RUN；不入核心分母；≠ 功能收口；≠ 可上线。 |
| 授权边界 | 已授权改运行代码与配套 vitest；禁止 docker 重建、造数、F58／F59／R 执行与浏览器取证；不新增 schema／不改 KTX；不以本轮 code review 推定功能收口或可上线 |
| 验收 | [Spec](../specs/lucy-20261119-roles-agent-concurrent-edit-spec.md) SC-01–13；组合结果只见 [UAT INDEX](../qa/uat/INDEX.md) |
| 需求与测试 | [总账](lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[共享 suite](../qa/uat/suites/roles-agent-concurrency-scale/suite.md) |

## 目标

先保留草稿、准确区分占用／冲突／结果未知，再引入对象版本和安全重建。请求协议兼容旧调用方；正常并发不因共用账号被误解释为互踢。

## 开工前置

1. 终稿由委托人明示确权（本次修订即终稿、免Codex CLI终审）；交互Q1–Q6为设计评审通过，浏览器未执行。开工仍须另发开发授权。
2. 核对当前 `publish-coordinator.ts`、`access-config.ts`、安全审计的事务边界；不得移出提交重检、运行时确认或审计终态。
3. 依赖正反例以Spec DEP-01–11及对象摘要金样本为准，创建／复制／删除各路径均核对；previewEffectDigest与整配置candidateDigest分开，避免无关对象假冲突。
4. 终稿前只读审计核查已完成，Spec §4.1确定复用config_change_log原行、唯一键与最小回执，不新增schema。开工先以真实序列化／终态链路验证此接法；若被证伪回设计，不在Task 4临时加表。
5. 共用 UAT 的 2×／5× 数据与会话向量冻结；所有写操作仅允许隔离 Docker fixture，不碰现网。

## 实施任务（均待授权）

### Task 1：真实并发与持久化失败基线

- Test：`webui/server/__tests__/admin-roles.test.ts`、`admin-agents.test.ts`、`publish-coordinator.test.ts`；拟新增 `roles-agent-concurrent-edit.test.ts`。
- Step 1：两独立会话读同一文件，分别修改不同对象，捕获当前无关冲突。
- Step 2：记录同对象变化、目标删除、预览后依赖变化与发布占用的当前行为。
- Step 3：真实进程注入局部写入／提交／审计失败，冻结“不得返回成功”的既有合同证据。
- 授权后命令：`cd webui && npx vitest run server/__tests__/roles-agent-concurrent-edit.test.ts server/__tests__/publish-coordinator.test.ts`；新增文件目前不存在，本轮不运行。

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

- 共用 P1-58 规划的 `scripts/uat/roles-agent-concurrency-scale.mts`，按 [cases](../qa/uat/suites/roles-agent-concurrency-scale/cases.md) 执行；本轮不创建或执行 runner。
- F59先按suite矩阵执行模块事务、DEP-01–11与14-B／C，不要求先完成共享系统压力；R再完整执行2×／5×双身份／读写／MCP／慢盘／长稳态，分开登记。
- fresh 依赖变化、提交后丢响应、写失败、恢复后的合法提交全部需实测；系统级重启与 MCP 共存只记共享 UAT，不代替本条局部事务检查。
- 按现有审计能力核对 operationId／actor／after 与配置最终状态；共用账号只能追到账号及会话，不能虚构自然人。
- 代码测试通过后再进行桌面浏览器验证，更新 runs 与 INDEX；不改旧 P1-13 PASS，也不以旧 PASS 推断新套件。

## 浏览器验证

- 路由：/admin/roles、/admin/roles/:roleId、/admin/agents、/admin/agents/:userId
- 视口：1920×1080
- 状态：E1、E2、E3、E4、E5、E6、E7、E8、E9、E10、E11、E12、E13、E14、E15、E16、E17、E18、E19、E20、E21、E22、E23、E24、E25、E26、E27、E28
- 证据：未执行

## 验收

本轮只验文档形态、链接和状态镜像。后续按 SC-01–13 逐条核实，保留差异、失败与恢复原始证据；桌面证据恰好覆盖 E1–E28。吞吐数只统计真实已确认提交；预期冲突、占用、未知和实际丢失分别报告。

## 完成定义

本次完成＝终稿、2×／5×用例、评审处理、总账与需求回链落盘；终稿已由委托人明示确权，不含开发或UAT执行。后续收口须另获开发授权、实现、代码复核与全部SC证据；F59与R分开登记，不能反推整套通过或可上线。

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
