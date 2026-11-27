# API Spec ＋ 问询预算 Spec · Codex CLI 三轮对抗过程评审

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-27 |
| 评审方 | Codex CLI（`gpt-5.6-sol`） |
| 委托人 | xingchen |
| 形态 | 两份 Spec × 三轮真实串行对抗；每轮后先修文档闭合可闭合项，再进入下一轮 |
| 运行边界 | 只读审阅实现；只改文档／状态镜像；未改运行代码、配置、Docker |
| 原始轮次输出 | `inbox/20261127-api-budget-adversarial-review-r1.txt` · `r2.txt` · `r3.txt` |

## 两份 Spec × 三轮汇总

| 对象 | R1 | R2 | R3 最终结论 | 最终版本 | 残留 |
|---|---|---|---|---|---|
| A · P1-89／REQ-030-110 | Request changes | Request changes | **Approve with nits** | **v1.3／S4** | OQ-3；SC-09／10 持久证据缺口。既有 UAT PASS 不重跑；≠ 功能合同收口；≠ 可上线 |
| B · REQ-0122 | Request changes | Request changes | **BLOCK**（阻断 Plan／开发授权／UAT 推进） | **v1.0-r3／S2**（事后 **v1.0-r5**：OQ-4／OQ-6 均已由委托人重裁闭合） | OQ-4／OQ-6 **已闭合**；OQ-5 条件式；下一阻塞＝PRE-01；UAT v1.0 待同步。≠ 开发授权／功能合同收口／UAT PASS／可上线 |

## A. API Spec（P1-89／REQ-030-110）

### 轮次 1

**结论：Request changes。** 实现与 UAT 已真实通过，不重开既有出口；状态镜像和 SC-09／10 证据链存在缺口。

| 编号 | 严重度 | 证据 | 对抗反例 | 关闭条件 |
|---|---|---|---|---|
| A-R1-01 | 重要 | Spec／Plan 状态仍写“UAT 待跑／尚无跑次”，但 `docs/qa/uat/INDEX.md` 与 `e2e-ledger.md` 已为 PASS | 同一功能在开发台与测试台产生两个现值；反向又可能据 PASS 越级升 S5 | 镜像为 UAT PASS，阶段保持 S4，明确 UAT PASS ≠ 功能合同收口；不重跑 UAT |
| A-R1-02 | 重要 | Spec 出口为 SC-01–10；正式 UAT 只承载 SC-01–08，SC-09／10 无持久命令输出 | 测试台全绿不证明文档 lint 与回归门禁执行过 | 建 SC-01–10 证据矩阵；已有证据回链，缺口诚实登记 |
| A-R1-03 | 建议 | Design System Compliance 仍为未勾选占位，而 SWH-06 浏览器三态已 PASS | 收口读者误判设计规范尚未核验 | 依据既有浏览器证据勾选，不新增行为 |

本轮修订：Spec／Plan 升 v1.2；状态镜像 UAT PASS；补证据矩阵；Design System 勾选。重放 SC-10 时 `table-editor` 31 tests PASS，两个服务端套件因本机缺 `mysql2` 在收集阶段失败，按环境证据缺口登记，不写成实现失败。

`评审方=Codex CLI；轮次=R1；日期=2026-11-27；≠终稿确权；≠开发授权`

### 轮次 2

**结论：Request changes。** R1 状态分叉已闭合，但 D8 广义范围与本条非目标边界冲突。

| 编号 | 严重度 | 证据 | 对抗反例 | 关闭条件 |
|---|---|---|---|---|
| A-R2-01 | 重要 | Spec D8 写“语义层全部写/删接口”未知字段一律 400；非目标又排除 `POST /api/semantic-assets/*`；P1-89 UAT 仅证明 PUT／import | publish 加 `typoConfirm` 仍可能静默忽略；SC-09 lint 不能证明广义端点实现 | 升 OQ-3：维持广义范围则另挂实现／验收；缩窄冻结 D8 亦须委托人重裁 |
| A-R2-02 | 建议 | v1.2 已诚实登记 SC-09／10 缺口，且镜像均为 S4／UAT PASS／待功能收口 | 只看静态对齐便宣称 SC-09/10 已绿，或无故重跑 SWH-01–06 | 保持缺口；只补非 UAT 证据 |

本轮修订：Spec／Plan 升 v1.3；新增 OQ-3；明确不重开 P1-89 已 PASS 的 PUT／import／WebUI 出口。

`评审方=Codex CLI；轮次=R2；日期=2026-11-27；≠终稿确权；≠开发授权`

### 轮次 3

**最终结论：Approve with nits｜v1.3。** 无新增阻断；P1-89 的既有 UAT 保持 PASS，D8 广义范围已被隔离为待裁 OQ。

| 编号 | 严重度 | 证据 | 对抗反例 | 关闭条件 |
|---|---|---|---|---|
| A-R3-01 | 建议／既有 OQ | Spec 状态、§5 OQ-3、INDEX 与 e2e-ledger 已区分既有 PASS 与广义 D8 未证明 | 用 PUT/import PASS 推定 publish 等全部端点未知字段 400 | 委托人重裁 OQ-3；两案均不补跑 P1-89 UAT |
| A-R3-02 | 建议／证据缺口 | §4.1 仍诚实写 SC-09 lint 与 SC-10 服务端回归未形成持久绿证据 | 将“本 Spec 未报错”冒充全库 lint PASS | 全库 lint 恢复后留成功输出；依赖完整环境补 SC-10 指定回归 |

本轮修订：只更新头部与镜像为“三轮已完成／Approve with nits”，未改合同、实现或 UAT 判定。

残留 OQ：OQ-3。下一步：委托人阅稿并重裁；不申请新的 P1-89 开发授权；不补跑 `UAT-SWH-01–06`。

`评审方=Codex CLI；轮次=R3；日期=2026-11-27；≠终稿确权；≠开发授权`

## B. 预算 Spec（REQ-0122）

### 轮次 1

**结论：Request changes。** D1–D8 方向基本闭合，但失败封顶、跨池 workload、并发信封、PRE-01 与 D7 验收仍可假绿。

| 编号 | 严重度 | 证据 | 对抗反例 | 关闭条件 |
|---|---|---|---|---|
| B-R1-01 | 阻断 | D4 仅以 `failedOrTimedOut` 封顶；SC-07 只测 4 次失败后一次成功 | 连续慢失败每次只计 30s，换窗后继续，验收仍绿 | D4 outcome 与持续失败最终停机升 OQ-4 待重裁 |
| B-R1-02 | 重要 | r1 声明轻元数据仍受 REQ-0119 workload；预算 UAT 只验 interactive meta pool | 多 integration Agent 以轻工具绕过 `borrowMax` | SC-03 显式挂 REQ-0119 轻元数据组合回归 |
| B-R1-03 | 重要 | SC-09 connection 第 33 路只要求 `retryAfterMs` | token 层信封完整、connection/global 层仍不可执行 | 补完整 D2 信封与释放后成交；改字段语义则升 OQ |
| B-R1-04 | 重要 | PRE-01 可被延后到 UAT-R0，且桶隔离选择可能改变 D2 | 抓包发现 `-` 桶后实现者自行改作用域键 | PRE-01 前移到 Plan／代码前；语义变化触发 OQ-5 |
| B-R1-05 | 重要 | SC-12 只验 `continuable=true`，未验 begin 隐藏 `mode=new_question` | A 臂通过、零绑定主路径仍提前放弃 | SC-12 拆 begin 可见／不可见双臂 |
| B-R1-06 | 建议 | 决策表仍写“待裁定”；元数据版本未显示 r1 | 实现者误以为 D1–D8 可自由调整 | 改为已裁定决策表，统一版本 |

本轮修订：升 v1.0-r2；不改 D1–D8；补 SC-03／09／12；PRE-01 前移；新增 OQ-4／OQ-5。

`评审方=Codex CLI；轮次=R1；日期=2026-11-27；≠终稿确权；≠开发授权`

### 轮次 2

**结论：Request changes。** OQ 与未授权状态能阻止开工，但旧 UAT 仍可假绿，并发现轻工具跨窗 runaway 新孔。

| 编号 | 严重度 | 证据 | 对抗反例 | 关闭条件 |
|---|---|---|---|---|
| B-R2-01 | 阻断 | OQ-4 已挂但 BA-07 仍无持续失败停机臂 | 连续失败跨窗无限续跑 | 先裁 OQ-4，再同步 UAT |
| B-R2-02 | 阻断 | Spec 挂 REQ-0119 回归，但 IMC-03 无轻元数据臂 | 轻工具不增 `integrationActive`，两个套件仍可绿 | 测试设计同步多 Agent 轻/重混合 workload 臂 |
| B-R2-03 | 重要 | SC-09 已增强，BA-09 仍只验 `retryAfterMs` | 第 33 路不可执行／永久拒绝仍 PASS | 同步全信封＋槽释放成交 |
| B-R2-04 | 重要 | SC-12 已双臂，BA-12 仍只有 continue | begin 隐藏路径失败而 A 臂通过 | 同步 `mode=new_question` 端到端臂 |
| B-R2-05 | 阻断 | PRE-01 仍出现在正式 UAT-R0；正式 UAT 又要求开发授权后执行 | PRE 被流程反向延后到开发后 | 旧 UAT 标为设计待同步、不可执行；R0 只引用预开发证据 |
| B-R2-06 | 重要 | D1 轻工具 200/窗；continue/new_question 清零 `metaCalls` | runaway 每 200 次换窗，持续重置 | 升 OQ-6；裁定跨窗总界后补敌对臂与合法成交臂 |
| B-R2-07 | 建议 | D7 本行未直接限定 interactive；自检仍写 S1 | 共享 fallback 误改 integration；阶段镜像误读 | D7 本行回填 r1 边界；自检改 S2 |

本轮修订：升 v1.0-r3；D7 本行限定 interactive；新增 OQ-6；§10.3 冻结旧 UAT 为“不可执行／不可 PASS”，列出六项同步门禁；补 e2e 勾连。不改 D1–D8。

`评审方=Codex CLI；轮次=R2；日期=2026-11-27；≠终稿确权；≠开发授权`

### 轮次 3

**最终结论：BLOCK（阻断 Plan／开发授权／UAT 推进）｜v1.0-r3。** 这是预期治理终态，不要求退回现有文档。

| 编号 | 严重度 | 证据 | 对抗反例 | 关闭条件 |
|---|---|---|---|---|
| B-R3-01 | 阻断／预期状态 | 状态行、OQ-4／6、PRE-01 与 §10.3；INDEX/e2e 均为 NOT RUN／设计待同步 | 实现者自行选 D4 outcome 或跨窗总界，旧 BA 用例仍可 PASS | 委托人裁 OQ-4／6；执行 PRE-01；再升版 UAT 并完成六项同步 |
| B-R3-02 | 条件阻断 | PRE-01 三模式抓包；若 `-` 桶要求改变作用域/D2，则触发 OQ-5 | 实施者发现共享桶后直接加隔离 | 未触发则证据关闭；触发则先由委托人裁 OQ-5 |

无新增发现。与 REQ-0119 r4 的 `8/16/32/48`、`borrowMax=12`、CANCEL_HOLD=5s、integration workload 与指引分流仍一致；画像、术语、S2、第一性原理与主路径双覆盖齐全。

本轮修订：只更新头部与镜像为“三轮已完成／BLOCK”。

残留 OQ：OQ-4、OQ-6；OQ-5 条件式；OQ-1 留二期。下一步：委托人先阅稿并重裁 OQ-4／6，再执行 PRE-01；此之前不建 Plan、不申请开发授权、不执行旧 UAT。

### 事后跟进（非 Codex 轮次）

- **2026-11-27**：委托人重裁 **OQ-4 闭合**（窄 `failedKind` 封顶；`no_data` 不封顶；单窗靠 calls／busy；跨窗沿用既有续查档）。Spec 升 **v1.0-r4**。
- **2026-11-27**：委托人重裁 **OQ-6＝A 闭合**（轻工具跨窗总界＝共用既有续查／`new_question` 档；单窗 200 保留；无终身／速率护栏）。Spec 升 **v1.0-r5**。
- **2026-11-27**：委托人授权执行 **PRE-01**；三模式抓包闭合（[证据](../../inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md)）；**OQ-5 未触发**。Spec 升 **v1.0-r6**。
- **2026-11-27**：委托人授权 **§10.3 UAT 升版**；`UAT-SUITE-BUDGET-ANALYST-UX` → **v1.1**；IMC-03 轻／重混合臂（integration-mcp-capacity v1.0-r4）。Spec 升 **v1.0-r7**。测试台仍 NOT RUN。**下一阻塞＝开发授权／Plan**。

`评审方=Codex CLI；轮次=R3；日期=2026-11-27；≠终稿确权；≠开发授权`

## 验证与边界

- `node scripts/uat/check-e2e-ledger.mjs`：PASS。
- `lint:spec-docs`：被本任务外新增文件 `docs/plans/lucy-20261127-uat-closure-shared-docker-plan.md` 的索引／Plan 形态违规阻断；不把全库失败冒充本次 Spec PASS，也不改该无关文件。
- SC-10 定向重放：`table-editor` 31 tests PASS；两个服务端套件因本机缺 `mysql2` 未进入行为执行，按证据缺口登记。
- 未补跑 API UAT；预算 UAT 保持 NOT RUN。
