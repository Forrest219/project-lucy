# 角色权限与 Agent 列表读取响应 Implementation Plan

> 实施者按仓库 AGENTS.md → DEVELOPMENT 逐任务执行；可选用 executing-plans 技能。本文件不是开发授权。

**Goal:** 让高频、多会话访问下的角色权限和 Agent 名册及时可用，保持授权与统计含义。

**Architecture:** 先拆分历史聚合，再复用已核实的展示快照；Agent 名册与统计分区，统计只允许明确披露的短期展示复用。继续使用单实例发布屏障与既有 ACL 编译器。

**Tech Stack:** TypeScript、Fastify、better-sqlite3、React Query、Docker；不改 KTX。

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施 Plan / v1.0 |
| 日期 / 产品线 | 2026-11-19 / 0.30.0 |
| 功能编号 | P1-58／REQ-030-079 |
| 状态 | v1.0。终稿确权；委托人2026-11-19明示开发授权。Wave1–3 实现完成并经 code review APPROVE（待 F58／浏览器）；本轮验证仅 vitest＋code review，未跑 docker／UAT；测试台 NOT RUN；不入核心分母；≠ 功能收口；≠ 可上线。 |
| 授权边界 | 已授权改运行代码与配套 vitest；禁止 docker 重建、造数、F58／F59／R 执行与浏览器取证；不新增 schema／不改 KTX；不以本轮 code review 推定功能收口或可上线 |
| 验收 | [Spec](../specs/lucy-20261119-roles-agent-read-responsiveness-spec.md) SC-01–12；组合判定仅见 [UAT INDEX](../qa/uat/INDEX.md) |
| 需求与测试 | [总账](lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[共享 suite](../qa/uat/suites/roles-agent-concurrency-scale/suite.md) |

## 目标

第一批依次完成统计查询减负、角色展示复用、错误与耗时分类；第二批实现名册／统计分区及短期展示新鲜度补偿。每个任务保持原有 API 与度量口径可对照，不以展示缓存绕过权限校验。

## 开工前置

1. 终稿由委托人明示确权（本次修订即终稿、免Codex CLI终审）；交互Q1–Q6已完成设计评审，不是浏览器已测。开工仍须委托人另发开发授权。
2. 冻结改前commit／候选镜像摘要、fixture seed、资源限制、计数金样本及负载向量。预算已定为可证伪目标，开发前补测有效改前响应；改后同时过绝对与相对闸，无有效基线的错误组不得计算虚构改善。已有0.30构建不能仅靠版本名视为相同候选。
3. 共用 UAT fixtures 是负载值唯一真源：校准后按 `max(设计下限, 实测当前基线)` 放大 2×、5×，不改结果阈值追样本。
4. 现有 P1-13／Spec 174／195 及 P1-47 已落地部分先核实，不重复开发；本条不重开其合同状态。
5. 新索引、worker 或统计表若被证明必要，先补决策与授权；不由实施者顺带扩展 schema。

## 实施任务（均待授权）

### Task 1：冻结统计等价金样本与改前成本

- Test：`webui/server/__tests__/admin-agents.test.ts`；拟新增 `webui/server/__tests__/admin-agent-stats-equivalence.test.ts`。
- Step 1：用固定 seed 生成真 SQLite，独立计算窗口、分类、凭据碰撞、最新时间预期；不调用被测聚合函数生成预期。
- Step 2：对现有路由取改前响应、查询计划、stats 耗时和峰值阻塞，记录失败基线；不改时间戳以凑窗口。
- Step 3：新增“窗口内固定、窗口外历史增至 5×”用例，证明现有读取成本；性能与计数分别断言。
- 授权后验证命令：`cd webui && npx vitest run server/__tests__/admin-agents.test.ts server/__tests__/admin-agent-stats-equivalence.test.ts`。新增文件目前不存在；本轮不运行。
- 出口：SC-01／02 的改前证据与可重复金样本。

### Task 2：窗口聚合与最近使用分离

- Modify：`webui/server/admin/agents.ts`，只触及 `getStatsMap`、`getLastUsedMap` 和响应组合。
- Step 1：将计数时间窗移入 WHERE；全部历史最近使用另查；共用事务快照、asOf 与 ceilingId。
- Step 2：评估已有索引下按配置凭据定位最新行，记录冷／热 EXPLAIN 与实耗，不先加索引。
- Step 3：运行 Task 1 真库等价测试及边界用例；失败即停，不通过更改指标意义解决。
- 出口：SC-01／02／10；再做性能差值，不将错误响应时间计为查询耗时。

### Task 3：角色展示快照与在途构建合并

- Modify：`webui/server/admin/roles.ts`、`webui/server/display-snapshot.ts`（仅必要适配）、`webui/server/admin/permission-display.ts`、`webui/server/entry-performance-timing.ts`。
- Test：`webui/server/__tests__/admin-roles.test.ts`、`admin-permission-batch.test.ts`、`display-invalidation.test.ts`、`display-rollback-races.test.ts`。
- Step 1：写 25 并发同键／不同键、失败重试、外部文件变动、回滚和权限收紧的负例。
- Step 2：优先接入现有快照／reconciler，不建立第二套失效机制；构建结果跨代次即丢弃。
- Step 3：确认所有 HTTP 请求仍鉴权，dryRun／保存／运行时不读展示缓存，释放失败和取消在途状态。
- 授权后命令：`cd webui && npx vitest run server/__tests__/admin-roles.test.ts server/__tests__/admin-permission-batch.test.ts server/__tests__/display-invalidation.test.ts server/__tests__/display-rollback-races.test.ts`。
- 出口：SC-03–05／10。

### Task 4：名册与统计分区、5 秒新鲜度补偿

- Modify：`webui/server/admin/agents.ts`、`webui/src/lib/displayQueryOptions.ts`、`webui/src/lib/types.ts`、`webui/src/pages/admin/AgentList.tsx`、`webui/src/pages/admin/RoleList.tsx`、`webui/docs/03-api-spec.md`。
- Test：`webui/src/__tests__/agent-list.test.tsx`、`admin-roles.test.tsx`、`display-query-isolation.test.tsx`，服务端 `admin-agents.test.ts`。
- Step 1：先测试默认完整 API 兼容、新统计路由匹配、混合配置版本拒拼接。
- Step 2：实现 roster 与 statistics 分区，统计失败不阻断名册；时间窗以响应原始 asOf 为准。
- Step 3：限定短期统计结果复用与用户可见统计时间，手动刷新绕过已完成缓存；新增写入立即失效，禁止用 TTL 保护权限。
- Step 4：覆盖筛选依赖、取消与快速切页、部分失败、刷新恢复；不新增后台频繁轮询。
- 出口：SC-06–08／12；治理方 ↓ 的补偿必须可实测。

### Task 5：统一错误分类与有界读重试

- Modify：`webui/src/lib/apiClient.ts`、`webui/src/lib/displayQueryOptions.ts`、对应两页失败呈现；复用已有 Server-Timing。
- Test：`webui/src/__tests__/api-client-abort.test.ts`；拟新增 `api-client-http-errors.test.ts`。
- Step 1：测试 HTML 502／503、JSON BUSY、401／403／409、取消与写请求不重放。
- Step 2：先判状态与内容类型；保留接口结构化错误，HTML 不透原文；只读重试最多一次且总预算 5 秒。
- Step 3：验证单次用户读取不会因多层重试相乘；共享调用方回归，不只验两个列表。
- 出口：SC-09／10；与 P1-59 未知写结果状态对齐。

W1完成Task 1–3／5只记阶段结果，W2的Task 4与其SC仍是完整合同要求。未完成W2不能宣布P1-58收口；如需独立交付，先具名修订范围和登记后续项。

### Task 6：模块验收与组合 UAT

- Module：真库等价、计时与固定配置的接口负载，对应 SC-01–12；代码审阅不代替 UAT。
- Shared runner 拟新增：`scripts/uat/roles-agent-concurrency-scale.mts`；由 P1-58 与 P1-59 共用，不能各写一套分母与判定器；本轮只设计、不创建脚本。
- 实现该 runner 时先在 `docs/governance/test-layers-and-release-gates.md` 的 Current Commands／CI Mapping 登记实际可执行入口；未实现前不把拟议命令写成现有能力。
- 先在独立Docker fixture执行suite分层矩阵的F58，证明本模块SC；共享R保留完整2×／5×单维与组合、慢盘、MCP和长稳态，作为组合发布取证另记。F58通过不替代R，R未跑不倒挂全部SC未完成。
- 算法减负后仍越线：提交热点与读量剖析，评审只读 worker；不得擅自修改探针预算或增加副本。

## 浏览器验证

- 路由：/admin/roles、/admin/agents
- 视口：1920×1080
- 状态：E1、E2、E3、E4、E5、E6、E7、E8、E9、E10、E11、E12、E13、E14、E15、E16、E17、E18
- 证据：未执行

## 验收

- 本轮文档验收：Spec／Plan／suite／cases／fixtures／三台指针完整；只做文档门禁，不主张行为通过。
- 开发后：每个 SC 有结果与原始证据；读取性能用有效 200 及正确 payload 判定，失败和取消独立计数；桌面浏览器证据恰好覆盖 E1–E18。
- UAT 执行者记录镜像 digest、gitSha、dirty、fixture 指纹、硬件／限速、客户端计划与实际到达量；原始数据落 inbox，正式跑次落测试台 runs。

## 完成定义

本次完成＝优化后的终稿、评审处理记录与登记落盘，机器门禁和形态自查完成，测试台NOT RUN。终稿已由委托人明示确权，后续仍须开发授权、实现与全部SC证据；共享R不得由本次文档lint或F58子集推定PASS，功能合同收口不表示可上线。

## 风险

| 风险 | 应对 |
|---|---|
| 拆查询改变全历史最近时间／分类 | 固定金样本与独立 oracle，最新记录另查 |
| 短期统计展示滞后 | 5 秒上界、统计时间、立即刷新与失败补偿；未验通不收口 |
| 快照键遗漏或后台核对超时 | 复用现有依赖代次与失败关闭；权限不设陈旧宽限 |
| 负载基线未知 | 显式设计下限；客户倍率主张须补当前实测，缺失维度不能写已覆盖 |
| worker 掩盖低效 SQL | 先算法和查询计划，再按剩余热点独立决策 |

## 落盘清单核对（本次两份 Spec／Plan 共用）

依据 DEVELOPMENT「新增 Spec / Plan 的落盘清单」逐项自查；只证明文档形态与登记，不证明功能已实现。

| 项 | 本次结果 |
|---|---|
| 1 文件名与落位 | 已核对：两组同日期、同 slug 的 Spec／Plan，分别位于 docs/specs 与 docs/plans |
| 2 核心流程 | 两份 Spec 均有成功、冲突、失败与恢复的伪代码 |
| 3 元数据 | 类型／版本／状态、Plan 授权边界／验收齐全 |
| 4 Plan 五类小节 | 两份均有目标、开工前置、验收、完成定义、风险 |
| 5 术语 | 两份均有固定格式；并发文案在 Spec 内登记，未修改全局标准 |
| 6 设计系统 | 两份均按四段式引用真实章节，不新增视觉模式 |
| 7 索引 | docs README、plans README 与概览 §9 已登记 |
| 8 命令／CI | 本次未新增可执行命令或 CI；拟新增 runner 明确未实现，实际开发时先登记 Current Commands／CI Mapping |
| 9 身份 | 文件名为 Spec 唯一身份，台账号无，P1-58／59 为总账行而非第二套文件编号 |
| 10 门禁与形态 | 2026-11-19 lint:spec-docs、lint:spec、lint:terminology、lint:ia-boundary、e2e-ledger 检查均 exit 0；另对新文件直接调用形态／交互检查，返回零违规 |
| 11 闭口层级 | 两份均为功能合同；组合探针／MCP／系统故障演练留共享 UAT／发布取证 |
| 12 现值 | 状态镜像同句；没有将设计、未执行或旧 PASS 写为本条已交付 |
| 13 交互合同 | 两份合同／元素／六问与配对浏览器四行均齐；六问为本次设计评审通过，浏览器未执行，不回写历史证据 |
| 14 入账 | 先入总账 P1-58／59，再起草；需求池 REQ-030-079／080 双向回链 |
| 15 三台勾连 | suite／cases／fixtures／runs 目录、INDEX NOT RUN、e2e 指针与 GAP 均已登记；现有硬编码 checker 未枚举新行，另行核对新文件和回链存在性 |
| 16 主路径 | 同时设计拒绝生效与恢复后合法成交；含不带 WebUI Cookie 的纯 MCP 共存 |
| 17 用户画像 | 两份四画像完整；治理方按最差子面 ↓，补偿路径挂 SC 与 UAT 编号 |

门禁现有非阻塞提示：总账 metadata 有一条 STALE 基线项；lint:spec 有既有 eval paired_quiz 与 demo_readonly 权限版本警告。本次未修改这些无关项或豁免基线。新文件相对链接已逐项核对存在，未以未跟踪文件只告警的机制掩盖违规。

## 定稿变更与验收层级

本次在委托人明示免Codex CLI终审的授权下定稿；[评审处理记录](../reviews/2026-11-19-roles-agent-design-finalization.md)记载采纳、部分采纳与事实纠正。保留2×／5×硬负载，预算按有效改前基线＋绝对上限＋相对不回退；模块F58和共享R分开判定，现场倍率17缺口单列。当前没有运行行为证据，不写功能合同收口或UAT PASS。
