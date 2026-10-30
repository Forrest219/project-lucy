# Spec 162 修订落地 Task：问询预算窗口

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实现 Task / v1.0 |
| 日期 | 2026-10-30 |
| 状态 | **本分支开发完成（2026-10-30）**。设计合同仍是 Spec v1.0 / Plan v1.0。验收表已记录。不构成客户交付 |
| 授权边界 | 2026-10-30 用户指示：Spec 若已定稿，则制定 Task 推进落地。本 Task 是 Spec §9 所称的另行实现授权。授权按下方波次实现代码与对应测试，并在波次 E 同批改指导文本与术语标准三条既有词条。问询汇总新增列的浏览器核对只覆盖该列所在审计页。**不授权**把 SC-01–SC-48 标成已通过、客户镜像、部署、git 提交、修改 KTX、回改历史审计行、重开 D1–D9 |
| 验收 | 逐条记录见 [验收表](../reviews/2026-10-30-question-budget-acceptance.md)。SC-04 有进程内 MCP 自动化（关服务、清模块、再经 HTTP 调用），不是操作系统或容器重启 |
| 合同 | [Spec v1.0](../specs/lucy-20261029-question-budget-window-optimization-spec.md) · [Plan v1.0](2026-10-29-lucy-question-budget-window-optimization-plan.md) · [第 3 轮定稿](../reviews/2026-10-30-question-budget-round3-final.md) |

## 目标

把已冻结的问询预算修订按 Plan 阶段落到 Lucy 代理与审计汇总。运行时在波次 D 完成前保持现行墙钟；波次 E 的新工具与指导文本同一批可见。

## 开工前置

- Spec v1.0 与 Plan v1.0 已定稿。D1–D9 按推荐项冻结。第 3 轮 F01–F05 已写入伪代码与阶段动作。
- SC-01–SC-48 均有初态、输入、模式、观测时点。48 条与 S1–S8 的对应关系见 Plan §5，无缺号。
- §1.2 最后三行仍是推断或待查证，不作为门禁事实。波次 A 的导出发起侧排查只取证，不预设「服务端默认 `outcome=ok`」。
- 原 Spec 162 正文继续描述现行运行时。新口径在对应波次发布前不得拿来解释既有审计行。

## 波次

顺序固定。后一波的默认开关不得先于前一波进入可运行构建。每波独立可回退，回退手段用 Plan §7，不另造开关。

| 波次 | Plan | 依赖 | 退出验收 | 这一波交付 |
|---|---|---|---|---|
| A | S1 | 无 | SC-25、SC-26、SC-27、SC-28；SC-29 只验四列存在 | 汇总层「预算终止次数」与四桶恒等式。不改额度判定。导出发起侧只查 `outcome` 从哪来 |
| B | S2 | A 已在同一构建中可见 | SC-02、SC-03、SC-04、SC-05、SC-38、SC-39、SC-48 | 稳定作用域 `bq:<identityKey>:<sessionId>`、装载纪律、`commit` / `recover`。SC-04 必须真实重启代理后经 MCP 调用 |
| C | S3 | B | SC-11、SC-12、SC-13、SC-14 | 窗口票据与到点封顶。`res.close` 不是结算点 |
| D | S4 | C | SC-01、SC-06、SC-07、SC-08、SC-09、SC-10、SC-37 | 默认改为已结算 `busyMs`。事故等价用例用可控时钟，同一用例对照 `settled` 放行与 `elapsed` 拒绝 |
| E | S5 + S8 | D | SC-15–SC-24、SC-29 的四项取值、SC-30、SC-40、SC-41、SC-42、SC-45、SC-47 | `lucy_continue_question` 与指导文本、三条术语词条同一发布单元。工具不可见时不得先改指导 |
| F | S6 | D | SC-35、SC-36、SC-46 | 认证路由与报表模板一次外部调用记 1 次；内部查询在 `finally` 结算，不重复记次数 |
| G | S7 | B；排在 F 之后 | SC-31、SC-32、SC-33、SC-34、SC-43、SC-44 | 同身份同会话的新 `begin_question` 显式取代。与消费、结算共用一把作用域锁 |
| H | S9 剩余 | 对外发布的波次都已留证 | 文档与运行时一致 | 把 Spec 162 生效声明、登记册和升级建议书里的旧「120 秒墙钟」句子改到已发布口径。未发布的句子保持原描述 |

波次 A 的审计页新增列沿用现有问询汇总表格，不新开设计系统章节。实现该列时在审计页核对列可见、恒等式与八桶执行结论仍然分开。

波次 E 的指导文本落点是 `webui/config/data-qa-instructions.md`。术语只改「问询预算」「关联调用数」「可继续」三条既有词条。`lucy_continue_question` 的 schema 只有 token，参数闸不得要求 connection；ACL 要登记 known tools、角色授予和升级迁移。

## 验收

- 实现完成：该波代码与测试就位，开关回归覆盖 Plan §6.1。
- 功能验收：SC 逐条留下初态、输入、实际输出。未留证视为未通过。
- 当前 SC-01–SC-48 全部未执行。本 Task 不改这个状态。

## 完成定义

八个波次的代码与测试都按上表退出，且对外默认值是 `LUCY_QUESTION_BUDGET_WALL_MODE=settled`、`LUCY_QUESTION_BUDGET_SCOPE=stable`、`LUCY_QUESTION_BUDGET_BYPASS=on`。指导文本不宽于代理预算。历史审计行不回改。次数上限保持 20。`question_budget_exhausted` 与 `question_budget_unavailable` 的原因码不变。预算终止不改写成权限拒绝。

## 风险

- 波次 D 的默认值会改变生产闸门。回退只用 `LUCY_QUESTION_BUDGET_WALL_MODE=elapsed`，其余修复不跟着退回。
- 波次 E 若指导先于工具发布，模型会被导向不可见工具。两份变更必须同一发布单元。
- 波次 C 若退回 `res.close` 结算，会重新少计。该回退窗口保持最短。
- 导出发起侧在取证前不下结论。SC-25 要求无 `outcome` 参数时导出包含预算终止行；SC-26 要求显式 `outcome=ok` 时只含 ok 行。
