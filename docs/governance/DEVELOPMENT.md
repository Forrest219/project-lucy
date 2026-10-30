# project-lucy 开发治理（Development Governance）

> 本文档面向**在本仓库写代码 / 改配置的 agent**（Claude Code、Codex 等）。

## 双轨语境：先看这里

本仓库有**两套独立语境**，混读会导致 prompt 污染或规则错配。其中开发态语境拆成两个并行入口（本规则文档 + 角色库），所以下表列 3 行：

| 文件 | 语境 | 谁读 | 注入方式 |
|------|------|------|---------|
| Lucy MCP Proxy `initialize` instructions（内容来源 `webui/config/data-qa-instructions.md`） | **运行时**：数据问答规则 | 任何走 `:7879` 连接的客户端（Codex、Cursor、Claude Code 等） | MCP `initialize` 响应注入，见 `webui/docs/07-mcp-auth-proxy-spec.md` §4.4 |
| `AGENTS.md` → 本文件 | **开发态**（规则）：代码 / 配置修改治理 | Claude Code、Codex 等 coding agent | agent 启动时读取 AGENTS.md |
| `docs/agent-pipeline.md` | **开发态**（流程）：可选的 vibe coding 完整交付流水线 | 同上，按需调用 | 同上 |

**规则**：两套语境只做单向引用，不互相复制内容。开发规则不得写入 `CLAUDE.md` 或 `webui/config/data-qa-instructions.md`；数据问答规则不得写入本文件。`CLAUDE.md` 现在只做指引（指向 `AGENTS.md` 和 proxy instructions 机制），不再承载数据问答规则正文。

---

## 适用范围

- **适用**：修改 `webui/`、`ktx.yaml`、`semantic-layer/`、`skills/`、`.ktx/` 等仓库源码与配置的任何会话
- **不适用**：纯数据问答场景——那部分规则在 `webui/config/data-qa-instructions.md`（由 Lucy MCP Proxy 注入，见 `webui/docs/07-mcp-auth-proxy-spec.md` §4.4），不要把本文档内容同步进去

## 强制流程：Plan Mode

以下改动，必须先输出计划（Claude Code 用 Plan Mode / EnterPlanMode，Codex 用等价的"先列步骤"机制），经人工确认后才能落地：

- 新功能、架构调整、跨文件改动
- semantic-layer / 数据库 schema 相关变更
- 修改 `skills/`、`CLAUDE.md`、`AGENTS.md`、`ktx.yaml`、`webui/config/access.yaml`、`webui/config/data-qa-instructions.md`、`webui/docs/07-mcp-auth-proxy-spec.md` 等治理类文件
- 任何会影响 KTX 数据问答运行时行为或 Lucy MCP Proxy 鉴权/指导内容的改动

例外（无需先出计划，可直接执行，范围保持窄）：

- 单文件内的 typo / 注释 / 格式修正
- 已经在被批准的计划范围内的后续小步执行

## 验证策略：浏览器测试约束

正常开发任务默认不需要做浏览器测试。只有在用户、当前任务说明或已批准计划明确要求浏览器测试、端到端浏览器验证、截图验证、Playwright/Cypress 浏览器运行，或交付标准本身以浏览器行为验证为准时，才执行浏览器测试。

Lucy 项目默认不做移动窄屏测试。除非用户、当前任务说明或已批准计划明确要求移动端、窄屏、响应式断点验证，不要主动执行 mobile viewport、narrow viewport 或 mobile emulation 相关测试。

现有 E2E 套件与 release gate 文档仍作为“被明确要求执行浏览器/E2E 验证时”的测试事实源；它们不改变普通开发任务的默认验证范围。

## 部署拓扑与并发一致性边界

Lucy 当前只支持**单实例、单副本**部署，不支持多个 WebUI / MCP Proxy 进程或多个容器副本共享同一份可写配置。

- 配置写入的一致性保证以**单进程内并发**为边界；Token 创建、吊销等写操作可以使用进程内串行化实现。
- 功能设计、Code Review 和 UAT 不得把分布式锁、跨进程锁、多副本事务或跨副本一致性作为当前版本的强制验收项或发布阻断项。
- 多进程、PM2 cluster、多容器副本、共享可写配置卷及其他多写者拓扑均属于当前不支持的部署方式。
- 若未来正式引入多副本能力，必须先新增对应架构 Spec，明确配置事实源、锁或事务机制、冲突处理、故障恢复和跨副本验收门禁；在该 Spec 生效前，不得宣称 Lucy 支持分布式部署。

## 红线（Off-Limits）

- `.ktx/secrets/` 下的密码/密钥文件：禁止读取内容后输出、禁止提交到 git
- `ktx.yaml` 中的数据库连接信息：改动前必须先确认，不能静默修改
- 生产数据库（Aliyun RDS MySQL）：只读查询，禁止 DDL/DML 写操作

## Spec 落位规则

- 仓库级 spec / 治理 / 跨模块产品视图落在 `docs/`，作为本仓库的事实来源
- **新的产品功能 Spec** 只落 `docs/specs/lucy-YYYYMMDD-<slug>-spec.md`。`webui/docs/` 已有的数字流水号 Spec 保持原路径，不再新增 `NNN-*-spec.md`，也不与 `docs/specs/` 各写一份。文件名与闭口层级见下方「功能闭口与发布取证」
- **访问权限（Access Control）域档案**落在 [`docs/access-control/`](../access-control/README.md)：域设计 / ADR / UAT / 本域 WO；Proxy/Admin 编号实现 Spec 仍就近留在 `webui/docs/`（如 `07`/`14`/`15`），由域 README 交叉引用。这些是已封板的存量路径，不作为新编号的先例
- 子模块自带的架构 / API / 数据模型等实现细节允许放在 `<module>/docs/`（当前实例：`webui/docs/01–06`），并在 `docs/governance/project-overview.md` 注册索引
- `webui` 的 M0–M5 开发已由 Codex 串行完成，对应工单包 `webui/docs/codex/` 作为执行历史归档保留，不再领取；后续若新增工单仍遵循「就近放 `<module>/docs/`」原则
- 个人分析 / 协作笔记不进本仓库，按既有约定放 Obsidian
- eval cases（YAML，agent 测）与 quiz HTML（人类测）的设计原则、命名约定、数据获取路径见 `docs/governance/eval-quiz-conventions.md`；新增 dataset 的 eval/quiz 前必读

## 功能闭口与发布取证

本节是仓库级设计原则。功能合同和发布取证回答两个不同的问题，出口不能写在同一条 Spec 里。

| 层级 | 证明什么 | 不证明什么 |
|---|---|---|
| 功能合同 | 这一条用户可观察的承诺，在它自己的接口上成立 | 这些承诺叠在目标拓扑上仍能一起成立。功能收口不能当成可以上线 |
| 发布取证 | 这一批已收口的承诺，在这次跑到的系统路径上没有互相拆掉。它是兜底，用来抓住组合、时序、拓扑和环境编排才会露出的问题 | 每个模块的合同都成立。没跑到的分支、失败关闭、并发和权限边角仍然可以是错的 |

功能合同的出口使用能打假这条承诺的检查。事务边界、失败关闭、持久化这类只有在真实进程里才成立的不变量，留在功能合同里。证明这些不变量所需的真实进程检查和局部故障注入也留在功能合同里，例如写入失败不能返回成功、事务中途失败不能留下半份数据。整库旅程、Agent 路径、跨模块或系统级故障演练，以及证据等级（本机 / CI / 客户环境）归发布取证。

发布取证失败时，只打回被证伪的那一条功能合同，不把整批已收口的模块重新打开。发布取证必须有主人和触发点：这一批已收口功能组成候选。不得把发布取证写成某条功能合同的出口，同时标注「未执行且不排期」。

上线只发生在第三件事：这一批模块都已按自己的合同收口，并且这次兜底跑在目标拓扑上、证据等级也够。

### 新 Spec 只有一个身份

新的产品 Spec 与 Plan 共用同一个编号 `lucy-YYYYMMDD-<slug>`。Spec 文件名是 `lucy-YYYYMMDD-<slug>-spec.md`，Plan 文件名是 `lucy-YYYYMMDD-<slug>-plan.md`。日期和 slug 必须相同，只换 `-spec` / `-plan` 后缀。`slug` 只使用小写字母、数字和连字符。版本写在头部元数据，不写进文件名。机器只拒绝 `v<数字>p<数字>` 这种版本段，例如 `v0p25`、`v2p5`。`v8` 这类技术专名可以留在 slug 里。其余像产品版本这样的写法由评审核对。文档之间用这个文件名互相引用。

台账号只出现在元数据中。功能挂在某本登记册上时写该号，没有就写「无」。不把台账号或 WebUI 流水号当作 Spec 的名字，也不为同一功能另派第二套编号。

`webui/docs/` 里已有的数字流水号 Spec 保持原路径，含子目录里已有的文件。此后不在任何 `<module>/docs/`（含子目录）新增一位及以上数字开头的 `*-spec.md`。模块内部、不构成产品承诺的实现笔记仍可放在 `<module>/docs/`，但不得使用新的数字流水号 Spec 文件名。

验收编号在本 Spec 内从 `SC-01` 起。不把其他 Spec 的验收编号写进本条出口。

### 必填小节

每份新的功能 Spec 包含：

```md
## 闭口层级

- 层级：功能合同
- 本条承诺：一句话，一条用户可观察的承诺
- 本条出口：能打假这条承诺的检查
- 不在本条出口：整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级
- 上线关系：本条收口不表示可上线
```

发布取证 Spec 使用同一小节。「层级」写「发布取证」，「不在本条出口」写各模块自己的合同，「上线关系」写「本条通过不表示各模块无问题」。

「是不是刚好一条承诺」由评审判断。`lint:spec-docs` 只检查小节是否存在、层级取值，以及文件名是否符合本节。

存量 Spec 与 Plan 不改名、不补写本小节。2026-10-30 引入本规则时，已跟踪且不符合的文件按「该文件 + 该规则」写入 [`docs/governance/spec-plan-doc-baseline.json`](spec-plan-doc-baseline.json)。此后基线只减不增。未跟踪的在途草稿不适用该豁免，`git add` 或提交时必须合规。

## Spec 内容规格：重要功能必含伪代码

**落位规则管「放哪里」；本节管「写什么」。** 术语必填见下方「Terminology Compliance」；本节约束**有决策 / 状态 / 管线**的重要功能 Spec。

### 触发条件（必须写）

新增或重大更新的功能 Spec，若包含下列任一语义，必须包含**可直接指导实现与验收**的核心流程伪代码（或等价 Normative 步骤 / 代数）：

- 权限 / ACL / 编译 / 裁决 / deny 码路径
- 多步状态机、门禁、发布 / 生效 / 索引管线
- 跨模块数据流、匹配 / 归一化 / digest / 合并算法
- 其他「分支顺序决定正确性」的核心行为（实现者不能只靠散文猜）

### 豁免（可不写）

- 纯文案、术语、IA 标签、视觉 polish、单字段改名
- 无分支的布局 / 间距 / 颜色调整
- 仅引用既有 Spec 算法且本 Spec **不改变**该流程语义（须在正文显式指向权威小节）

不确定时：**偏重要则写**；Review 可要求补齐后再批 Gate B / 开工。

### 必填小节形态

每个命中触发条件的 Spec 必须包含以下小节之一（标题固定，便于扫读）：

```md
## 核心流程（伪代码）
```

或英文 Spec：

```md
## Core Algorithm
```

内容要求：

- 使用 `text` / `ts` 代码块、编号步骤，或已有的 Normative 代数（如 AC-P1 `FinalRows` / DNF）；**禁止**只有「系统应当正确处理」类空话
- 覆盖主成功路径与关键失败 / deny / 降级分支的**顺序**
- 足以让实现者写出代码、让验收写出断言；细节类型签名可指向 API / Data Model 小节，但控制流不得省略
- 与 Acceptance / SC-\* 可对上：伪代码里出现的关键分支应能映射到至少一条验收项

参考（已有写法，非穷尽）：`webui/docs/99-access-control-p1-row-policy-spec.md`、`webui/docs/100-access-control-p15-agent-constraints-spec.md`、`webui/docs/13-business-wiki-ux-refactor.md`（Wiki Auto-Match Algorithm）、`webui/docs/62-trace-evidence-kernel-spec.md`。

### Review 要求

- Spec / Gate B 评审必须检查：命中触发条件时是否存在上述小节，且伪代码可执行地描述控制流
- WO「必含章节」列表（若该域使用）应包含「核心流程（伪代码）/ Core Algorithm」；**不替代**本文件为本规则的事实源
- **不**要求立刻用 `lint:spec` 机械检测伪代码质量；稳定后再考虑弱 warn（例如仅检查小节标题是否存在）

## 新增 Spec / Plan 的落盘清单

**本节是「落盘一份新 Spec / Plan 要做完哪几件事」的唯一清单。** 规则分散在多个文件里，逐个读容易漏，故在此集中列出，并注明每条的出处。**清单本身可作为交付物的一节**（审阅者直接查），但**不得替代**被引用的文件为事实源。

### 为什么有这一节

既有机器门禁（`lint:spec` / `lint:terminology` / `lint:ia-boundary`）只覆盖**机器可判定项**（路由 / API / 术语 / 元数据），**几乎不覆盖文档形态**。门禁全绿**不等于**文档合规。2026-10-29 实测：一份按规范写就的 Spec／Plan 仍有两处形态不合规（Design System 小节未用规定模板、新增 lint 命令未在测试门禁文档登记），而当时三个机器门禁**全部全绿**。

### 落盘清单（逐条勾销）

| # | 要求 | 出处 | 机器门禁 |
|---|---|---|---|
| 1 | **Spec 落 `docs/specs/`、Plan 落 `docs/plans/`**。二者共用编号 `lucy-YYYYMMDD-<slug>`，文件名分别为 `lucy-YYYYMMDD-<slug>-spec.md` 与 `lucy-YYYYMMDD-<slug>-plan.md`。`slug` 只用小写字母、数字和连字符，**不得把版本号写入文件名** | 本文件「Spec 落位规则」与「功能闭口与发布取证」 | `lint:spec-docs`（规则 `filename`） |
| 2 | **Spec 含「核心流程（伪代码）」/「Core Algorithm」**，或**显式写明伪代码豁免** | 本文件「Spec 内容规格」 | `lint:spec-docs`（规则 `pseudocode`） |
| 3 | **Spec 头部元数据含「文档类型 / 版本」与「状态」**；**Plan 头部含「状态」「授权边界」「验收」** | 本文件「Spec 内容规格」 | `lint:spec-docs`（规则 `metadata`） |
| 4 | **Plan 含 目标 / 开工前置 / 验收 / 完成定义 / 风险 五类小节**（措辞可不同，按语义匹配） | 本文件「强制流程：Plan Mode」与本节 | `lint:spec-docs`（规则 `plan-parts`） |
| 5 | **含 `Terminology Compliance` 小节 ⇒ 必须含 `This feature follows …` 与 `New terms:`** | 本文件「新模块必填 Terminology Compliance」 | `lint:spec-docs`（规则 `term-shape`） |
| 6 | **含 `Design System Compliance` 小节 ⇒ 必须用规定模板四段式**（`Referenced Specs` / `What This Change Follows` / `Exceptions (If Any)` / `Follow-up Needed`） | 本文件「WebUI 设计规范」＋ [`webui/docs/design-system/30-pr-compliance-template.md`](../../webui/docs/design-system/30-pr-compliance-template.md) | `lint:spec-docs`（规则 `ds-shape`） |
| 7 | **Spec / Plan 必须登记进对应索引**：`docs/specs/` → `docs/README.md`；`docs/plans/` → `docs/plans/README.md` | 本节 | `lint:spec-docs`（规则 `index`） |
| 8 | **新增命令 / CI job 必须在测试门禁文档登记** | [`docs/governance/test-layers-and-release-gates.md`](test-layers-and-release-gates.md) §2「Current Commands」与 §8「CI Mapping」 | 无（人工核对） |
| 9 | **文件名是 Spec 的身份**。台账号只写在元数据里，且仅当该功能挂在对应登记册上（v0.25 登记册见 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md)）；没有则写「无」。不把台账号或 WebUI 流水号当作 Spec 的名字，也不另派第二套编号 | 本文件「功能闭口与发布取证」 | 文件名见第 1 条；元数据里的台账号由评审核对 |
| 10 | **落盘后跑一遍机器门禁并逐条勾销本表**；不得以「门禁全绿」替代形态自查 | 本节 | `lint:spec-docs` + `lint:spec` + `lint:terminology` + `lint:ia-boundary` |
| 11 | **功能 Spec 含「闭口层级」**。层级只能是「功能合同」或「发布取证」，并写明本条承诺、本条出口、不在本条出口、上线关系。功能合同写「本条收口不表示可上线」；发布取证写「本条通过不表示各模块无问题」 | 本文件「功能闭口与发布取证」 | `lint:spec-docs`（规则 `close-layer`） |

### 索引登记的判据（避免误判）

`docs/README.md` 与 `docs/plans/README.md` 是**策展式索引**，不是全量目录：

- 2026-10-29 实测：`docs/specs/` 46 份中已索引 16 份；`docs/plans/` 74 份中已索引 15 份。
- 因此**存量文档不要求补登记**；但**自本节生效起新增的文档必须登记**（清单第 7 条）。
- **不得**把「索引未收录」当作「可以不登记」的依据，也**不得**把「别人没登记」当作惯例引用——**先数目录覆盖率，再下结论**。

### 存量豁免与基线（只减不增）

形态门禁 `npm run lint:spec-docs` 对全量 `docs/specs/` 与 `docs/plans/` 生效，并递归检查各模块 `<module>/docs/` 是否新出现一位及以上数字流水号 Spec。存量违规冻结在
[`docs/governance/spec-plan-doc-baseline.json`](spec-plan-doc-baseline.json)：

- **新增违规 ⇒ exit 1**，必须修，**不得写入基线**；
- 基线条目在违规消失后，门禁报 `STALE`，提示从基线移除——**基线只减不增**；
- 确需豁免某一份存量文档时，在基线里为**该文件 + 该规则**单独立一条并写明理由，**不得整规则豁免**。

### 门禁的判定范围（按 git 跟踪状态分流）

形态门禁扫描 `docs/specs/` 与 `docs/plans/` 的**全部文件**，并递归检查各模块 `<module>/docs/` 下一位及以上数字开头的 `*-spec.md`。**判定按 git 跟踪状态分流**：

| 文件状态 | 基线外违规的处置 | 理由 |
|---|---|---|
| **已跟踪**（已提交，或已 `git add` 进暂存区） | **阻塞**（exit 1） | 已进入仓库的产物，形态不合规即须修 |
| **未跟踪**（尚未 `git add` 的在途草稿） | **只报 `WARN`，不阻塞** | 共享工作区里，一个会话的在途草稿不该把另一个会话的门禁打成红 |

- 该文件一旦被 `git add` 或提交，同一条违规**立即转为阻塞项**——CI 侧工作树干净、文件均已跟踪，判定口径与本地一致，**规则不松**。
- 未跟踪文件的问题**由它的主人解决**：他人不得代改，也**不得**因此把该文件写进基线（基线只减不增）。
- 门禁输出显式区分两个通道：`FAILED — 新增形态违规（基线外）` 与 `WARN — … 尚未被 git 跟踪`。
- 2026-10-29 起因：门禁初版对未跟踪文件与已跟踪文件一视同仁，导致共享工作区里**他人的在途草稿把我的门禁打成红**，且输出无法区分责任归属。

### Review 要求

- Spec / Plan 评审必须检查：本清单 11 条是否逐条可答；回答不得是「门禁全绿」。
- 评审发现形态不合规时，**先修文档形态**，再论内容。
- 缺「闭口层级」，或功能合同的出口写入整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级，先退回形态。这些内容属于发布取证。证明本条不变量所需的局部故障注入留在功能合同里。
- 同一功能的 Spec 与 Plan 编号不一致（日期或 slug 不同），先退回形态。

## 全系统术语规范

Lucy 的系统级术语事实源是
[`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md)。
所有 WebUI、API 用户可见错误、Toast、Modal、Drawer、表格列名、导航、测试断言、
Spec、Plan、Runbook 和交付文档都必须遵守该标准。

### 新模块必填 Terminology Compliance

每个新增或重大更新的功能 Spec 必须包含以下小节：

```md
## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None
```

如果引入新概念，必须先在 `webui/docs/00-product-terminology-standard.md` 登记或在该小节说明新增术语、UI 主术语和禁止文案。

### 开发与 Review 要求

- 新增 UI 文案前先查术语标准，不得临时自造译名。
- 不得把 `Schema` 翻译成“架构 / 模式”，不得把 `Manifest` 翻译成“舱单 / 清单”，不得把 `Package` 翻译成“报价包”。
- 专业英文术语、数据库对象名、文件名、路径和 URL 的 DOM 节点必须添加 `translate="no"` 和 `notranslate`。
- Code Review 必须检查术语一致性、禁用词和浏览器翻译防御。
- WebUI 变更提交前运行 `cd webui && npm run lint:terminology`；根目录也可运行 `npm run lint:terminology`。

## WebUI 设计规范（Design System）

Lucy WebUI 的设计规范事实源在
[`webui/docs/design-system/README.md`](../../webui/docs/design-system/README.md)。

强约束如下：

- 涉及 UI 视觉或交互的改动，必须先对照对应章节（Foundations / Components / Patterns / Governance）。
- 新增视觉模式（如新按钮分层、新网格策略、新颜色语义）必须先补规范再落代码。
- PR / 交付说明必须包含 `Design System Compliance` 小节，至少写明“引用章节 + 本次遵循点”。
- 若需求超出已定义章节，先在 `webui/docs/design-system/99-governance.md` 记录临时决策，再在后续迭代升级为正式规范。

## Onboarding（首次拉取本仓库）

本地测试配置（连接、ACL、内网语义层）**完全私有**，不进共享 git。仓库只提供 `.example` / demo stub / `customer-config.example`。

1. `cp ktx.yaml.example ktx.yaml`（`ktx.yaml` 已 gitignore；每人/每机私有）
2. 替换 `ktx.yaml` 中的 `<CHANGE-ME-*>` 占位符为**你自己的**本地实际值（host / db / username / 密码文件绝对路径）
3. `mkdir -p .ktx/secrets && echo '<your-db-password>' > .ktx/secrets/<connection>-password`（该目录已在 `.gitignore` 排除）
4. `cp webui/config/access.yaml.example webui/config/access.yaml`（`access.yaml` 已 gitignore；按需改成你的私有 Agent / token）
5. 私有语义层 / wiki / eval：自行维护在本机（例如 `semantic-layer/<your-connection>/`），**不要 commit**；仓库仅跟踪 `semantic-layer/demo-mysql/`（CI stub）与 `examples/*/project-template/`
6. 安装 KTX CLI，**版本必须与镜像捆绑版本一致**（事实源是 `Dockerfile` 的 `ARG KTX_VERSION`）：
   `npm install -g @kaelio/ktx@$(sed -n 's/^ARG KTX_VERSION=//p' Dockerfile)`
   （或在本地 ktx 仓跑 `pnpm install && pnpm run link:dev`）
7. 启动本地 MCP daemon：`ktx mcp start --project-dir <本仓库绝对路径>`
8. 验证：`ktx status` 报告 `Agent integration ready: yes`，并跑一次 `ktx sl "<keyword>"` 看连接是否通；
   再跑 `npm run verify:host-ktx` 确认宿主 CLI 版本与镜像捆绑版本一致。**宿主版本落后不会让任何门禁变红**
   （仓库里的版本断言全部打在镜像/容器内），但本机直接跑的 WebUI 是 `execFile("ktx", …)`，
   拿到的是 PATH 上的宿主 CLI，语义层、目录与连接测试结果会因此与交付产物不同。
9. 启动 Lucy MCP Proxy（`:7879`）：`cd webui && npm run dev`
10. 配置 `.mcp.json`，指向 Lucy MCP Proxy：
   ```json
   {
     "mcpServers": {
       "lucy": {
         "type": "http",
         "url": "http://localhost:7879/mcp",
         "headers": { "Authorization": "Bearer ${LUCY_LOCAL_TOKEN}" }
       }
     }
   }
   ```
   `${LUCY_LOCAL_TOKEN}` 用环境变量插值，本机 shell 从 `.ktx/secrets/` 读取后 `export`，不要把明文写进 `.mcp.json`。

> **凭据/路径漂移防护**：`ktx.yaml.example` / `access.yaml.example` 仅作模板；真实连接与 ACL 永不提交。

### 本地 Docker demo 重建

本机 demo 重建必须走 **host-native** 路径，禁止误用客户打包用的 `lucy-amd64` builder（ARM 上会变成 QEMU，经常 >10 分钟像卡住）。

- **平滑升级（默认，保留账号与 audit 日志）**：`npm run demo:upgrade`（或 `npm run demo:rebuild`；支持 `--no-cache`、`--backup-dir inbox/backups`）。重建镜像并 `--force-recreate` 容器，**不**删除 `lucy-demo-data` volume。
- **从零 reseed（仅 dev 验收干净模板）**：`npm run demo:upgrade -- --fresh`（等价于删除 `lucy-demo-data` 后重新 seed）。
- **Compose project name** 来自 `docker compose -f <compose file> config`（`--format json` 的 `name`）。Demo 文件在 `deploy/compose/`，project name 是该目录名（`compose`），named volume 是 `compose_lucy-demo-data`。读不到 compose config 时才回退到当前工作目录名。已设置的 `COMPOSE_PROJECT_NAME` 优先。
- **空目标卷是失败，不是 `preserved=true`**：解析出的目标 named volume 已存在且挂载点下文件数为 0，同时有运行中的容器挂载了另一个同逻辑卷名（例如 `lucy-demo-data`）且其中有文件时，升级失败，不会把 preserve check 报成 ok。
- 等价手写：`BUILDX_BUILDER=default bash scripts/upgrade/upgrade-lucy.sh -f deploy/compose/docker-compose.demo.yml`。
- amd64 开发者覆盖：脚本已按 host 自动选择；若直接 compose，传 `TARGETPLATFORM=linux/amd64 TARGETARCH=amd64`。
- 客户 amd64 离线包 / K8s integration 大包：推荐 `bash scripts/release/build-customer-amd64-image.sh`（含 G1–G4 + G4b + **G8** 门禁）；或 `docker buildx build --builder lucy-amd64 ...` 并显式 `--build-arg TARGETPLATFORM=linux/amd64 --build-arg TARGETARCH=amd64`（创建 builder 时**不要** `--use`，结束后 `docker buildx use default`）。交付前**必须**完整走一遍 [`docs/runbooks/customer-delivery-preflight-checklist.md`](../runbooks/customer-delivery-preflight-checklist.md) 与 [`docs/runbooks/customer-amd64-image-build-checklist.md`](../runbooks/customer-amd64-image-build-checklist.md)（含 `assert-image-elf-arch.sh` 对 **node+tini** 架构、Python runtime 离线预装 G4b、镜像 UID 10001 + git init **G8**、Helm MCP URL 守卫、**H3 N-1 旧 PVC 升级**及现场验收命令）。K8s 升级方案见 [`deploy/k8s/helm/lucy/UPGRADE.md`](../../deploy/k8s/helm/lucy/UPGRADE.md)。详见 `docs/specs/lucy-customer-amd64-offline-delivery-spec.md` 与 `docs/specs/lucy-202608-08-image-arch-and-ktx-baseline-fix.md`。
- Demo 使用 `LUCY_TEMPLATE_ROOT=examples/docker-demo/project-template`（本地 `demo-mysql`），**不会**把内网测试库打进客户默认 seed。

## 语义层（semantic-layer）分层

`semantic-layer/<connection>/` 下的 yaml 看似两份重名文件，实际是 ktx 的
**manifest / overlay 双层设计**，由 loader 合并（参考
[`ktx-sl` 的 `loader.py::_compose`](https://github.com/kaelio/ktx/blob/main/python/ktx-sl/semantic_layer/loader.py)）。
**manifest/overlay 的归类错误会导致引擎按物理列查表，触发 `Unknown column`
却 validate 通过**——本节明确每类改动落哪、怎么让 MCP 检索到。

### 文件分类

| 文件 | 角色 | 谁写 | 内容 |
|---|---|---|---|
| `_schema/<schema>.yaml` | **manifest**：仓库物理表结构 | ktx 扫描 warehouse 自动生成 | 表名、列名、类型、nullable、双语描述 |
| `<table>.yaml` | **overlay**：lucy 的业务扩展 | 人工维护 | grain、columns（含 `expr` 派生列）、measures、segments、joins |

### 改什么落哪

| 改动 | 落点 | 例子 |
|---|---|---|
| 加一条业务指标 | overlay `measures:` | `total_profit: sum(profit)` |
| 加一个常用过滤 | overlay `segments:` | `active_rows: is_deleted = 0` |
| 加一个派生维度 | overlay `columns:` | `order_year: type: time, expr: YEAR(order_date)` |
| 改物理列的描述/类型 | overlay `column_overrides:` | （不要改 manifest） |
| 新增物理列 | 等下次 ktx 扫描重生成 manifest | — |

### 关键 gotcha

- **manifest 的列模型叫 `ManifestColumn`，不接受 `expr` / `role`**——把派生列写在
  manifest 里 `ktx sl validate` 不会报错，但 `expr` 被静默丢弃，引擎按物理列查就
  `Unknown column`。**派生列只能落在 overlay 的 `columns:` 块。**
- **不要手改 manifest**：下次 ktx 扫描 warehouse 会被覆盖掉。
- **不要在 overlay 里"新建"与 manifest 同名的列**——要用 `column_overrides:`
  增量补丁。loader 注释明说「Manifest column names cannot be reused here」。
- `columns:` 块里的 `expr` 由 `_expand_computed_columns` 在 SQL 生成时内联展开，
  生成形如 `(YEAR(superstore_orders.order_date)) AS order_year` 的合法 SQL。

### 改完 yaml 的标准流程（必走）

`semantic-layer/` 文件夹是**磁盘**；MCP server / `ktx sl <搜索词>` 读的是
**本地 SQLite 索引**（`ktxLocalStateDbPath`）。改 yaml 后必须**手动重建索引**，
否则 MCP agent 用 `sl_search` 找不到新增的列/measure/segment。

```bash
# 1. 重建索引（扫盘 → 写 SQLite）
ktx --project-dir /Users/zhangxingchen/Projects/project-lucy admin reindex

# 2. 验证（任一即可）
ktx sl validate superstore_orders           # YAML 语法 + 合并结果合法
ktx sl read superstore_orders              # 列出列/measure/segment 实际可见
ktx sl "order_year"                        # 搜索索引能命中
```

**关键事实**：

- 索引输出按 scope 分行报告：`sl/mysql-aliyun` 的 `scanned/updated/embeddings` 反映
  这次到底改了几条。
- `admin reindex` 默认是**增量更新**；彻底重建用 `admin reindex --force`（清空后
  全量重写，谨慎用）。
- 改完 yaml **不需要重启 MCP daemon**——daemon 通过 SQLite 文件读取，下次查询
  立即生效。
- 如果配了 embedding provider，reindex 会重新计算 embeddings；未配置则只做
  lexical 索引（warn 级别提示，不阻塞）。

### 反例

```yaml
# ❌ 错：把派生列写在 manifest，expr 被 ManifestColumn 静默丢弃
# 文件：_schema/dataforai.yaml
- name: order_year
  type: time
  expr: YEAR(order_date)        # ← 生效无效

# ✅ 对：派生列写在 overlay，SourceColumn 支持 expr
# 文件：superstore_orders.yaml
columns:
  - name: order_year
    type: time
    role: time
    expr: YEAR(order_date)
```

## Claude Desktop / 云端 Claude 接入

Claude Desktop 的"添加自定义连接器" UI 要求 HTTPS，且 URL 由 Anthropic 云端做 MCP discovery / OAuth 探测——`localhost` 系列地址（localhost / 127.0.0.1 / *.local）从云端不可达，**本地 HTTPS 反代也救不回来**（验证过：表单接受 `https://localhost:7880/mcp` 但提交后静默卡死）。按客户端分两条路：

**统一入口：Lucy MCP Proxy（`:7879`，Bearer Token 鉴权）**

所有客户端（Claude Desktop、Claude Code、Codex、Cursor 等）都应通过 Lucy MCP Proxy 接入：Token 校验、停用/吊销、对象 ACL、行级策略、先持久后释放的审计只在 Proxy 上生效。**不得**把 `ktx mcp stdio`（Claude Desktop 直连 KTX 进程）或 KTX `:7878` 直连当作客户或常规开发的接入方式——那会绕过全部上述控制（企业安全整改 Spec 20261018 §3.3；客户 Service/Ingress 不暴露 `7878`）。

- 配置来源：WebUI「生成 Token」页复制出的 MCP 配置；Token 只放环境变量或客户端的密钥存储，不进命令行和仓库。
- 仅限本机、非客户数据的 KTX 内核调试可临时直连 `127.0.0.1:7878` 或 stdio，并且必须是回环地址、使用合成/脱敏数据；此类会话不产出任何验收或审计证据，不能用来证明 Lucy 行为。
- Claude Desktop 的"自定义连接器"要求 HTTPS 且由云端探测，`localhost` 不可达：需要 HTTPS 的客户端请使用已部署的 Lucy（Ingress TLS，`LUCY_PUBLIC_MCP_URL`），不要自行把 `:7878` 隧道出去。

**Web Claude / 云端 agent**

仅在确实需要从云端访问 Lucy 时考虑，且暴露的只能是带 Token 鉴权的 Lucy MCP Proxy（`:7879`，经 TLS 终止的 Ingress），**绝不是 `:7878`**；生产数据暴露面必须再叠加 Cloudflare Access 等入口控制。无鉴权的 quick tunnel（含 `cloudflared tunnel --url http://localhost:7878`）会把端点落在客户端配置、进程列表、浏览器 prefetch 中，**不算秘密**，禁止用于任何非合成数据。本仓库当前未预置 cloudflared 配置。

## 上游依赖：KTX

本仓库不包含 KTX 本体（CLI / MCP server / 语义层引擎），运行依赖外部 KTX 安装。

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/kaelio/ktx |
| 本机 clone | `/Users/zhangxingchen/Projects/ktx` |

何时查阅 KTX 源码：

- 注册 / 调试 KTX MCP server（启动命令、传输方式、可用 tool 列表）
- 验证 `sl_read` / `sl_query` / `wiki_search` / `sl_validate` 的实际行为与 `CLAUDE.md` 描述是否一致
- 排查 `ktx.yaml` 字段含义、scan / ingest / agent 行为
- 在 KTX 本身有 bug / 缺特性时定位上游 issue

约定：

- 修改 KTX 源码属于**上游变更**，在 `/Users/zhangxingchen/Projects/ktx` 内进行，遵循该仓库自身的协作规则，不在本仓库提交。
- 本仓库只引用 KTX，**不复制** KTX 内部规则 / prompt 到本仓库。

## Skills 当前状态

`skills/` 是 project-lucy 的增量能力补齐，**当前不被 KTX MCP server 自动加载**。data agent 仅能通过 Read 工具主动读取 `skills/**/SKILL.md`。

- `skills/` = single source of truth（lucy 增量补齐能力）
- `.ktx/skills/` 已废弃移除，不要再写入
- 自动加载 / 按需触发能力将由独立的 `lucy-skills` MCP server 提供（P1.5 立项中）

KTX 上游不承担 skill 加载职责（KTX 定位是语义层 + wiki 通用 MCP server）；skill 由 lucy 自行起 MCP server 暴露，与 KTX 并列向 data agent 提供服务。

## 语境分工（详细说明）

双轨设计概览见文档开头"双轨语境"表。本节补充维护约定：

- 两套语境只做单行引用，不整段复制对方内容。
- 新增开发规则 → 只写本文件；不写入 `CLAUDE.md` 或 `webui/config/data-qa-instructions.md`。
- 新增数据问答规则（口径、表路由、Gotcha）→ 只写 `webui/config/data-qa-instructions.md`（由 Lucy MCP Proxy 注入，见 `webui/docs/07-mcp-auth-proxy-spec.md` §4.4）；不写入本文件或 `CLAUDE.md`。
- 修改 `CLAUDE.md`、`AGENTS.md`、`webui/config/data-qa-instructions.md`、`webui/config/access.yaml`、`webui/docs/07-mcp-auth-proxy-spec.md` 均属于治理类文件变更，需走 Plan Mode（见上方"强制流程"）。
