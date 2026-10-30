# 问询预算窗口修订 —— 实现与验收记录（Spec 162 修订线）

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实现与验收记录 / v1.0 |
| 日期 | 2026-10-30 |
| 状态 | **实现完成。** SC-01–SC-48 的逐条记录见 [验收表](2026-10-30-question-budget-acceptance.md)。SC-04 有进程内 MCP 自动化，不是操作系统或容器重启 |
| 授权边界 | 2026-10-30 用户授权按 [落地 Task](../plans/2026-10-30-question-budget-window-implementation-task.md) 分波实现。**不含**浏览器验证、Docker 重建、客户镜像、部署、客户交付声明；**不含**把 SC 标成已通过 |
| 合同 | [Spec v1.0](../specs/lucy-20261029-question-budget-window-optimization-spec.md) · [Plan v1.0](../plans/2026-10-29-lucy-question-budget-window-optimization-plan.md) · [第 3 轮定稿](2026-10-30-question-budget-round3-final.md) |
| 实现主体 | Lucy（Proxy 问询预算层 + Admin 审计汇总 + 审计归口）。不修改 KTX 源码 |

---

## 1. 波次对照

| 波次 | Plan 阶段 | 交付 | 代码落点 | 自动化用例 |
|---|---|---|---|---|
| A | S1 可观测性 | 汇总层「预算终止次数」独立列；四桶恒等式；执行结论仍以八桶主状态为准 | `webui/server/admin/audit.ts`、`webui/src/pages/admin/Audit.tsx` | `admin-audit.test.ts`（SC-25／26／27／28） |
| B | S2 稳定作用域与落库 | 作用域键 `bq:<identityKey>:<sessionId>`；`loadState` 的 `loaded` 纪律；`commit`／`recover` 与幂等键同事务；恢复全字段、在途不恢复 | `webui/server/proxy/question-experience.ts`、`webui/server/proxy/audit.ts` | `question-budget-scope-identity.test.ts`（SC-02／03／04／05／38／39／48） |
| C | S3 结算与窗口票据 | 票据 + 窗口归档 + 并发上限 + 绝对执行时限；结算点在「上游结束」或「到点停止等待」 | `question-experience.ts`、`mcp-proxy.ts` | `question-budget-settlement.test.ts`（SC-11／12／13／14） |
| D | S4 墙钟口径 | 判定式改为已结算 `busyMs`；`elapsed` 只回退时间判定 | `question-experience.ts` | `question-budget-window-mode.test.ts`、`question-budget-incident-regression.test.ts`（SC-01／06／07／08／10／37） |
| E | S5 + S8 续查与指导 | `lucy_continue_question`（schema 只有 token）+ 声明—消费两段式；指导文本与术语三条词条同批 | `mcp-proxy.ts`、`acl.ts`、`admin/role-templates.ts`、`admin/mcp-tools.ts`、`scripts/lint-spec.mjs`、`webui/config/data-qa-instructions.md`、`webui/docs/00-product-terminology-standard.md` | `question-budget-continuation.test.ts`（SC-15…SC-24／29／30／42／45／47）、`data-qa-instructions-contract.test.ts`（SC-40） |
| F | S6 旁路纳管 | 认证路由／报表模板纳入统一 consume；一次外部调用记 1 次，内部查询只计时长 | `mcp-proxy.ts` | `question-budget-bypass-scope.test.ts`（SC-35／36／46／39） |
| G | S7 显式取代 | 同身份同会话的新 `begin_question` 取代旧轮次；归属登记与握手回填的事务内重检 | `question-experience.ts`、`turn-correlation.ts`、`mcp-proxy.ts`、`audit.ts` | `question-budget-turn-supersede.test.ts`（SC-31／32／33／34／43／44） |
| H | S9 文档回写 | 登记册同步。波次 H 当时不翻生效声明；2026-10-30 收口已把 Spec 162 §7.2 与升级建议书 §2.3 改为已结算数据处理时长 | `docs/plans/README.md`、`docs/README.md` | `lint:spec-docs` 形态门禁 |

---

## 2. 本轮（2026-10-30 实现会话）改动的生产代码

| 文件 | 改动 | 对应合同 |
|---|---|---|
| `webui/server/proxy/mcp-proxy.ts` | 捕获在途上游请求句柄；**到点与客户端断开时取消上游**，并按实际已耗时结算（不按绝对时限封顶）；结算事实（超时未确认／客户端断开）写进本次调用的审计行 | §6.2、SC-13、SC-14 |
| 同上 | 续查**声明**事实（`budgetContinuation.declared`）写进 `lucy_continue_question` 那一行；续查**生效**事实（`budgetContinuation.applied` + windowId/round/requestId）写进对应数据调用那一行 | §6.7、SC-29、SC-30 |
| 同上 | 旁路入口（认证路由／报表模板）补上绝对执行时限与 `finally` 结算 | §6.6、SC-14、SC-36 |
| 同上 | 恢复后的归属条目以**恢复时刻**为 TTL 锚点（此前用问询原始起点，超过 10 分钟的问询刚恢复就被 purge，归属当次丢失） | §6.4、SC-03 |
| 同上 | `LUCY_QUESTION_BUDGET=off` 时开题不再走预算存储（此前预算关了，问询开题仍会被预算存储故障卡住） | §7.6、SC-39 |
| 同上 | 取代事实写进开题审计行（`budgetSupersession.from/to`）；归属登记改用 `reportedTurns.supersede` | §6.5、SC-34 |
| `webui/server/proxy/question-experience.ts` | 头部凭证信任条件收敛为 Spec §6.3 的两条（删掉「本次请求解析出的 turnId」这条合同外分支——它等于多出一条不核对凭证的续查入口） | §6.3、SC-22 |
| 同上 | `settle` 增加 `clientDisconnected` 标志；`declareContinuation` 返回 windowId/round；`beginQuestion` 的 turnId 判空改为 `!= null`（对齐伪代码） | §6.2、§6.3、§6.5 |
| `webui/server/proxy/audit.ts` | 握手回填的「仍未归属」重检**移入事务**，UPDATE 带同一谓词，前像只记**实际被更新**的行 | §6.5、SC-33 |
| `webui/server/proxy/audit-classification.ts` | 并发超限归「引擎超时与并发」；续查声明被拒（`pending_exists`／`no_credit`／`not_exhausted`／`mismatch`）归「用法与语义」 | Plan §3.3（S5） |
| `webui/server/proxy/turn-correlation.ts` | 新增 `supersede` 与按身份+会话的 `activeTurnFor` | Plan §3.3（S7） |

---

## 3. 随本次落地一并修掉的既有缺陷

这些缺陷由「问询预算窗口」改造带进来（或被它暴露），会阻断门禁或让合同不成立，本轮一并修掉：

| 缺陷 | 表现 | 处置 |
|---|---|---|
| 示例 `access.yaml` YAML 缩进错误 | 新增的 `lucy_continue_question` 行缩进比同组兄弟少一级 → **YAML 解析失败**，Docker demo 模板与客户示例的 ACL 全部读不出来 | 两份示例文件按兄弟条目对齐缩进；`yaml.safe_load` 复核通过 |
| `conversation_turns(session_id)` 索引建在 `ensureColumn` 之前 | 存量库没有 `session_id` 列 → 建索引报错 → **整个 schema exec 失败**，审计库打不开 | 索引移到 `ensureColumn` 之后（`proxy/audit.ts` 与 `admin/audit.ts` 两处） |
| 「只读问答」预设与 UI 夹具不同步 | 预设加入 `lucy_continue_question` 后变成 7 个工具，UI 用例仍按 6 个断言 → 4 个 UI 用例失败 | 更新夹具与断言（`role-tool-grants` / `role-detail` / `admin-roles`） |
| `tools/list` 期望列表缺新工具 | 新工具登记后 `tools/list` 多一项 → 冒烟用例失败 | 更新期望列表与用例里的角色工具授权 |
| 指导文本口径变更未同步契约用例 | 两处契约用例仍断言旧口径「墙钟 120 秒」 | 更新为「累计 120 秒数据处理时长（不含思考时间）」 |
| 四桶恒等式断言未含预算终止桶 | 既有断言用 `toEqual` 严格比较三桶 | 改为四桶并保留恒等式断言 |

---

## 4. 新增与改动的测试

| 文件 | 类型 | 覆盖 |
|---|---|---|
| `webui/server/__tests__/question-budget-scope-identity.test.ts` | 新增 | SC-02／03／04／05／38／39／48。SC-04 是 vitest 进程内关服务、清模块、再经 HTTP MCP 调用，不是操作系统或容器重启 |
| `webui/server/__tests__/question-budget-settlement.test.ts` | 新增 | SC-11／12／13／14 |
| `webui/server/__tests__/question-budget-continuation.test.ts` | 新增 | SC-15…SC-24／29／30／42／45（+ SC-47 真实 MCP `tools/call`） |
| `webui/server/__tests__/question-budget-turn-supersede.test.ts` | 新增 | SC-31／32／33／34／43／44 |
| `webui/server/__tests__/question-budget-bypass-scope.test.ts` | 新增 | SC-35／36／46（+ SC-39 代理层形态） |
| `webui/server/__tests__/question-budget-incident-regression.test.ts` | 新增 | SC-10／37／38／39（开关回归） |
| `webui/server/__tests__/admin-audit.test.ts` | 改动 | SC-25／26／27／28（四桶恒等式、八桶主状态、导出两种情形）；既有断言补第四桶 |
| `webui/server/__tests__/data-qa-instructions-contract.test.ts` | 改动 | SC-40（新口径 + `continuable` 分支 + 指导不宽于代理预算）、SC-41（术语标准三条既有词条） |
| `webui/server/__tests__/scope-restatement-instructions.test.ts` | 改动 | 口径改为「累计 120 秒数据处理时长（不含思考时间）」 |
| `webui/server/__tests__/slow-call-and-empty-result.test.ts` | 改动 | 慢问询标记改读**稳定作用域**的 `originStartedAt`（`ensureTurn` 在 stable 模式不再建桶） |

---

## 5. 跑过的命令

| 命令 | 结果 |
|---|---|
| `cd webui && npx vitest run server/__tests__/question-budget-*.test.ts --maxWorkers=1` | 7 文件全绿 |
| `cd webui && npx vitest run --maxWorkers=1`（全量） | **402 文件 / 4780 用例全绿**（2026-10-30 末次全量跑） |
| `npm run lint:terminology` | 通过（1067 files scanned） |
| `npm run lint:ia-boundary` | 通过 |
| `npm run lint:spec` | 通过（access-role-policy 有既有 WARN，非本次引入） |
| `npm run lint:spec-docs` | **失败**：本条目已登记 `docs/plans/README.md`；剩余违规全部来自并发会话的其它条目（`docs/plans/2026-10-29-ci-restoration-plan.md` 的 term-shape、`docs/plans/2026-10-30-l25-11-publish-window-task.md` 的 index/plan-parts/metadata），已在提交中跟踪，按「未跟踪文件由其主人解决、他人不得代改」未代改 |
| `cd webui && npx tsc --noEmit` | 本次改动的文件无类型错误（仓库存在既有错误基线，tsc 不是门禁） |

---

## 6. 验收状态（SC-01–SC-48）

逐条初态、输入、实际输出见 [验收表](2026-10-30-question-budget-acceptance.md)。本表只保留收口前的覆盖说明，现行结论以验收表为准。

| 状态 | SC | 说明 |
|---|---|---|
| 已写入验收表 | SC-01–SC-48 | 见验收表。SC-09 的 MCP 用例与 SC-13 的取消确认结算在 `question-budget-closure.test.ts` |

---

## 7. 未做与剩余风险

1. **访问日志页已核对「预算终止次数」列**（`http://127.0.0.1:55176/admin/audit?range=1h`，已登录）。客户镜像与部署仍未授权。
2. 收口前的实现曾未提交。收口提交只包含问询预算相关路径。`24cf118b` 是更早的一刀，不代替本次收口。
3. **Spec 162 §7.2 与升级建议书 §2.3 已改为已结算数据处理时长。** 历史审计行不按新口径重写。
4. **`lucy_certified_route` 的入参闸与工具 schema 不一致**（既有现象，非本次引入）：代理的数据面入参闸要求 `lucy_*` 工具带 connection，而该工具的 schema 只声明 `routeId`／`templateId`。测试按现状带 `connectionId` 调用。未改动该闸，避免扩大授权面。
5. **SC-14 的「到点停止等待」是代理侧实现**：到点时销毁上游请求并按封顶增量记账；上游是否真的停止不由 Lucy 证明（与 Spec §6.2 的口径一致）。
6. **续查生效事实落在数据调用那一行**（`budgetContinuation.applied`），不是独立审计事件行；「两条可区分事实」成立，但与 Spec §6.3 伪代码里 `audit(budget_continued, …)` 的写法不同。

---

## 8. 回退开关

| 行为 | 开关 | 回退后语义 |
|---|---|---|
| 时间判定 | `LUCY_QUESTION_BUDGET_WALL_MODE=elapsed` | 回到流逝时间判定（事故口径），其余修复不回退 |
| 作用域键 | `LUCY_QUESTION_BUDGET_SCOPE=legacy` | 回到 `turn:` / `scope:` 旧键 |
| 旁路纳管 | `LUCY_QUESTION_BUDGET_BYPASS=off` | 认证路由／报表模板不消耗预算 |
| 预算整体 | `LUCY_QUESTION_BUDGET=off` | 预算整体关闭，既有行为不变 |
| 续查通道 | 撤下 `lucy_continue_question` 的工具可见性 | 仅剩 HTTP 头路径；指导文本须同批回退 |

默认值：`settled` / `stable` / 旁路纳管开 / 预算开；次数上限保持 20；`question_budget_exhausted` 与 `question_budget_unavailable` 两个原因码不变。
