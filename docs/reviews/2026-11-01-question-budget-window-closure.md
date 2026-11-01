# 问询预算窗口与预算终止可观测性 — 功能合同收口

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01 |
| 授权 | PM 于 2026-11-01 批准「听取建议，制定计划干」，本条为阶段 C |
| 对象 | [问询预算窗口与预算终止可观测性优化 Spec](../specs/lucy-20261029-question-budget-window-optimization-spec.md) v1.0（沿用 Spec 162，不新发流水号）；[配套 Plan](../plans/2026-10-29-lucy-question-budget-window-optimization-plan.md) |
| 前置 | [验收表](2026-10-30-question-budget-acceptance.md)（2026-10-30，SC-01–SC-48 逐条 48/48 覆盖） |
| 结论 | **功能合同收口。** SC-01–SC-48 全部通过。**本条收口不表示可上线。** SC-04 的证据等级是**进程内** MCP 自动化，不是操作系统或容器重启 |

## 出口

本条闭口层级（Spec「闭口层级」小节）声明的出口：

- SC-01–SC-48 的自动化用例——逐条落点见 Spec §7.8 与 [验收表](2026-10-30-question-budget-acceptance.md)
- `npm run lint:terminology`

**不在本条出口**：操作系统进程重启与容器重启（SC-04 的进程内证据不覆盖，属发布取证层）；远端 CI job；客户环境验证；镜像构建、部署与客户交付；整库旅程、Agent 路径与跨模块故障演练；全仓 typecheck 基线。

验收断言原文见主 Spec §7，逐条证据见验收表。本文件不重复抄写，只给结论、本次实测与本轮补的动作。

## SC-04 的证据等级（本条最需要写清的一条）

主 Spec 状态行、验收表和本文件三处口径一致：

- SC-04 的证据是**进程内**的。`question-budget-scope-identity.test.ts` 的 describe「question budget survives a real proxy restart (SC-04)」在**同一个 vitest 进程**内：`vi.resetModules()` 清掉模块缓存 → 起第一个真实代理实例 → 关掉它 → 起**第二个**真实代理实例 → 两个实例共用同一个**磁盘**审计库 → 经 HTTP `tools/call` 发一次真实 MCP 数据调用 → 断言累计字段从持久层恢复、归属在冻结前恢复为原 turn。
- **它不是操作系统进程重启，也不是容器重启。** 所以它证明的是「代理重启后预算状态能从持久层恢复」这条承诺，**不证明**进程级或容器级重启下的行为。
- 该用例的注释写明合同来自 Spec §7.1 / Plan S2 退出条件：「直接调函数的写法视为不通过」——即必须走真实 MCP 通道，不能用单元级直调替代。

## 本轮补的动作

### 一、修掉两处既存 typecheck 错误

`webui/server/__tests__/question-budget-closure.test.ts` 的两处 `getUpstream: () => upstream` 报 TS2322：`UpstreamHandle = Pick<ClientRequest, "once" | "destroy"> & { destroyed?: boolean }` 里 `once` 的重载返回 `this`（即 `ClientRequest`），而夹具是 `EventEmitter`，两者的 `this` 类型不兼容。

修法**不改任何运行代码**：`UpstreamHandle` 没有对外导出，所以从函数签名反推——

```ts
type SettlementInput = Parameters<typeof bindQuestionBudgetSettlement>[0];
type UpstreamHandle = NonNullable<ReturnType<SettlementInput["getUpstream"]>>;
```

再在两处调用点做一次显式转换。运行时行为不变。

**全仓 typecheck：88 → 86。**

### 二、更正 Spec §9 的过期登记

§9「交付判定」原来写的是「**验收状态**：SC-01–SC-48 **全部未执行**」——那是 2026-10-29 定稿时的记录。实现与验收在 2026-10-30 就已完成（验收表逐条 48/48），该行在收口时属过期登记，已改为「全部通过」并指向验收表与 §7.8。

历史变更行按惯例不回改——project-overview 的 v1.69 行仍记着当时的「问询预算收口已执行」，那是当时事实。

## 这次跑过的检查

```bash
# 本条的核心测试（验收表同一口径的命令）
cd webui && npx vitest run --maxWorkers=1 \
  server/__tests__/question-budget-*.test.ts \
  server/__tests__/data-qa-instructions-contract.test.ts \
  server/__tests__/scope-restatement-instructions.test.ts
# → 10 个文件 / 75 条通过

# 可观测性那四条
cd webui && npx vitest run --maxWorkers=1 server/__tests__/admin-audit.test.ts
# → 1 个文件 / 27 条通过（SC-25–SC-28 在其中）

# 静态门禁
npm run lint:terminology   # → passed (1094 files scanned)

# typecheck
cd webui && npx tsc --noEmit
# → 全仓 86 个既存错误；本条涉及文件 0 错误（本轮修掉 2 处）
```

**数量漂移说明**：验收表记的是「11 文件 / 87 通过」，本次实测为「**10 个文件 / 75 条通过**」，全部通过。差的不是用例被删了，而是 `question-budget-*.test.ts` 这个通配现在匹配到 8 个文件而不是 9 个——其中一个文件在验收之后被改名或移走了。**逐条 SC 覆盖没有缺口**（验收表逐条点名到用例名，本次跑的 10 个文件里都能找到那些用例名）。

## 逐条结论

SC-01–SC-48 的逐条结论、初态、输入、实际输出与证据落点，**以[验收表](2026-10-30-question-budget-acceptance.md)为准**，本文件不重复抄写。本轮只做三件事：

1. **复核了全部 48 条的证据落点存在且通过**——验收表点名的用例名在本次跑的 10 个文件里全部命中，无一条落空。
2. **SC-04 的证据等级写进了出口**（主 Spec §7.8 与「闭口层级」小节），不再只出现在状态行里。
3. **§9 的「全部未执行」过期登记已更正**。

按主题分组：

| 编号 | 结论 | 证据文件 |
|---|---|---|
| SC-01–SC-08 | 通过 | `question-budget-window-mode.test.ts`、`question-budget-scope-identity.test.ts`（SC-03/04/05） |
| SC-09 | 通过 | `question-budget-closure.test.ts`——四类不累计预算的 MCP 路径（`resources/list`、`lucy_catalog`、`lucy_skill_search`、ACL 拒绝的 `lucy_read_source`） |
| SC-10 | 通过 | `question-budget-incident-regression.test.ts` |
| SC-11–SC-14 | 通过 | `question-budget-settlement.test.ts`、`question-budget-closure.test.ts`（SC-13） |
| SC-15–SC-24 | 通过 | `question-budget-continuation.test.ts`、`question-budget-turn-supersede.test.ts` |
| SC-25–SC-28 | 通过 | `admin-audit.test.ts`（导出不带 `outcome` / 带 `outcome=ok`；问询汇总的 `budgetStop` 与四桶之和） |
| SC-29–SC-34 | 通过 | `question-budget-continuation.test.ts`、`question-budget-turn-supersede.test.ts` |
| SC-35–SC-36、SC-46 | 通过 | `question-budget-bypass-scope.test.ts`（认证路由只记 1 次、源授权失败不执行查询） |
| SC-37–SC-39 | 通过 | `question-budget-incident-regression.test.ts`、作用域文件 |
| SC-40–SC-41 | 通过 | `data-qa-instructions-contract.test.ts`、`scope-restatement-instructions.test.ts` |
| SC-42 | 通过 | `question-budget-continuation.test.ts` |
| SC-43–SC-45 | 通过 | `question-budget-turn-supersede.test.ts`、`question-budget-continuation.test.ts` |
| SC-47–SC-48 | 通过 | `question-budget-continuation.test.ts`、`question-budget-scope-identity.test.ts` |

## 残余，不打回本条

- **操作系统进程重启与容器重启未做。** SC-04 的进程内证据不覆盖这两种形态；按「闭口层级」它们归发布取证层，**不构成本条收口的阻塞项**。但要真的上线，仍需在目标拓扑上跑一次进程级重启取证。
- **远端 CI job 未跑。** 本地 `lint:terminology` 与定向测试全绿；证据等级归发布取证。
- **全仓 typecheck 86 个既存错误**与本条无关（`tsc` 在本仓不是门禁），本条涉及文件 0 错误。
- **浏览器侧的可观测性核对**（问询记录表头「关联调用数」「预算终止次数」、结果列口径）由验收表记录的已登录走查承担，属发布取证层。

## 不在收口里

客户镜像、Helm、集群部署、客户环境验证与客户交付，都不在这条里。本条收口不表示可上线，也不构成客户包验收。
