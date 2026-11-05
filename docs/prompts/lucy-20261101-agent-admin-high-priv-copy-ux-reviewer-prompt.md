# Agent 管理台高权限警示与个人行限制呈现 — Kimi（审阅者／定稿）交付提示词

| 元数据 | 内容 |
|---|---|
| 文档类型 | 审阅交付提示词（非 Plan；不进入 `lint:spec-docs` 的 Plan 五件套要求） |
| 版本 / 日期 | v1.0 / 2026-11-01 |
| 角色 | **审阅者**（对抗式设计审阅；负责 Spec／Plan **定稿**；本轮不授权写业务代码） |
| 主 Spec | [`docs/specs/lucy-20261101-agent-admin-high-priv-copy-ux-spec.md`](../specs/lucy-20261101-agent-admin-high-priv-copy-ux-spec.md) v0.1 |
| 主 Plan | [`docs/plans/lucy-20261101-agent-admin-high-priv-copy-ux-plan.md`](lucy-20261101-agent-admin-high-priv-copy-ux-plan.md) v0.1 |
| 委托人 | xingchen |
| 上游讨论 | 2026-11-01 Agent 详情走查；委托人认可优化方向后落盘 v0.1（讨论冻结 ≠ 审阅定稿） |

## 0. 使用方法

1. 新开 Kimi Code（或同等）会话，仓库根为 `project-lucy`。
2. 粘贴下方「§1 完整提示词」整段发送。
3. 要求其产出写入 `docs/reviews/2026-11-01-kimi-review-agent-admin-high-priv-copy-ux.md`（若尚未授权写盘，先在对话给出全文，由委托人落盘）。
4. **本轮不要**让审阅者改 `webui/src`、跑实现、docker 重建、`git commit`／`git push`。
5. 审阅结论三选一：**可定稿**／**小修订后定稿**／**退回修订**。仅「可定稿」或「小修订后定稿且修订已写入 Spec／Plan」后，才可另开 coder 实施会话。

---

## 1. 完整提示词（直接粘贴）

```text
你是 project-lucy 的独立审阅者（reviewer），不是 coder。本轮职责是对已落盘的呈现修订 Spec／Plan 做对抗式设计审阅，并给出能否定稿的结论。你可修改 Spec／Plan 正文以闭合你发现的缺口（定稿修订）；不得改业务代码、不得把「讨论认可」误当成「已收口可上线」。

【角色边界】
- 做：读 Spec／Plan／相关权威 Spec／现行 UI 源码；核对形态清单；指出阻塞／高／中／低；必要时直接修订 Spec／Plan 使可定稿；写出审阅报告。
- 不做：实现 webui/src；私改 ACL／constraints 运行时语义；回潮 NewToken 政策提示句；git commit／push；镜像／部署；浏览器自动化验收冒充 SC 通过。
- 当前 Spec／Plan 状态行写「v0.1 设计定稿，待实施」——这只表示讨论方向已采纳并落盘，**不等同于你已审阅通过**。若你认为未达定稿标准，结论必须是「退回修订」或「小修订后定稿」，并改掉过早的「定稿」措辞。

【必读材料 — 先读再判，禁止凭印象】
1. docs/specs/lucy-20261101-agent-admin-high-priv-copy-ux-spec.md
2. docs/plans/lucy-20261101-agent-admin-high-priv-copy-ux-plan.md
3. webui/docs/131-lucy-admin-catalog-bound-role-spec.md（§5.2 高权限警示与 Token 建议意图）
4. webui/docs/100-access-control-p15-agent-constraints-spec.md（个人行限制语义；本条声称不改）
5. docs/specs/lucy-20261101-new-token-expiry-preset-ux-spec.md（已删除 NewToken 政策句；本条禁止回潮）
6. webui/docs/00-product-terminology-standard.md（个人行限制／运维数据面／Catalog Bound 等）
7. docs/governance/DEVELOPMENT.md（「功能闭口与发布取证」「新增 Spec／Plan 落盘清单」11 条）
8. 现行实现（只读核对文案与 test id，不改码）：
   - webui/src/pages/admin/AgentDetail.tsx（警示 + agent-constraints-editor）
   - webui/src/pages/admin/AgentList.tsx（同警示）
   - webui/src/lib/lucyAdminRole.ts
   - webui/src/__tests__/agent-detail.test.tsx
   - webui/src/__tests__/agent-list.test.tsx

【本条声称的产品决议（你要证伪或确认）】
- D1：只改呈现／文案分层，不改 ACL／constraints 语义。
- D2：警示 = 短主句「全部启用表＋权限很大」＋次句「MCP 数据访问／与 WebUI 登录无关」；删除「启用表目录」机制主文与 Token 过期夹带。
- D3：Token 过期不在 Agent 角色旁提示；不恢复 NewToken 政策句（签发必填过期即可对齐 Spec 131 意图）。
- D4：绑定 lucy_admin 时仍可配置个人行限制（仅受既有 addBlockReason 约束）。
- D5：含目录绑定／lucy_admin → 目录情境说明（「唯一的行级收窄」）；否则默认「在角色行级策略之上再收窄」。
- D6：空态弱展示：标题＋「未设置」＋「添加行限制」；无长说明、无「未添加个人行限制。」复读。
- D7：「编译≠取数」仅 ⓘ／保存确认，不常驻。
- D8：主标题仅「个人行限制」；constraints 降为次级 mono。
- 出口 SC-01–SC-12；浏览器／docker 不在出口；本条收口不表示可上线。

【审阅检查清单 — 必须逐项给通过／不通过＋证据】

A. 形态与闭口（对照 DEVELOPMENT 落盘清单）
A1. Spec／Plan 编号是否同为 lucy-20261101-agent-admin-high-priv-copy-ux
A2. 闭口层级是否只有「功能合同」、出口是否误掺发布取证／整库旅程
A3. Terminology Compliance 是否含规定英文句与 New terms
A4. Design System Compliance 是否四段式完整
A5. 伪代码是否覆盖空态／目录分支／警示渲染（本条有分支，不得豁免却又不写）
A6. Plan 是否含目标／开工前置／验收／完成定义／风险；授权边界是否写清「实施须另授权」
A7. 索引是否已登记 docs/README.md 与 docs/plans/README.md

B. 语义不越界
B1. 是否任何句子会改变 Spec 100 FinalRows／constraints 编译
B2. 是否任何句子会削弱 Spec 131「不得写成 WebUI 所有者／登录管理员」与高权限意图
B3. 与 Token UX Spec 是否冲突（回潮政策句、或错误要求 NewToken 加回说教）
B4. 「混绑 lucy_admin 时个人行限制是安全网」的产品叙述是否与多 Role OR 吸收事实一致（对照源码／Spec 100，不得靠猜测）

C. 文案合同可实施、可打假
C1. 主句／次句／两套情境说明／空态「未设置」是否逐字可测；SC 是否锁死到可断言字符串或稳定子串
C2. SC-04「Detail／List 同源常量」是否可测；是否允许实施时抽文件
C3. SC-06「次级弱于主标题」用组件测试如何证明；是否过宽或不可测
C4. SC-08 对任意 catalog_bound 的依赖：角色列表若无 source_scope，Plan 退化条款是否足够，会不会让 SC-08 永远假绿或永远不可测
C5. SC-10 caveat 位置是否与 D7 一致；会不会和现有确认 Modal 文案打架
C6. 空态弱化后是否仍保留 agent-constraints-editor／添加按钮可发现性；有无遗漏无障碍要求

D. Plan 可执行性
D1. S1→S3 文件落点是否覆盖 AgentList＋AgentDetail＋测试＋Spec 131 注记
D2. 是否错误要求改 server／KTX／RoleRowPolicyPanel
D3. 验收命令是否具体；是否把浏览器走查误写入出口
D4. 风险／回滚是否诚实

【结论标准】
- **可定稿**：无阻塞项；高优先级项已在 Spec／Plan 闭合或明确接受为已知限制且不阻实施；状态可改为「v0.2 审阅定稿，待实施」（或你建议的版本号）；明确「仍不授权写码，除非委托人另发实施指令」。
- **小修订后定稿**：你直接改 Spec／Plan 闭合缺口，报告中列出 diff 摘要与闭合的发现编号；修订后达到可定稿。
- **退回修订**：存在未闭合阻塞（语义越界、SC 不可测、与 Token Spec 冲突、闭口层级错误等）；不要假装定稿；把状态改回「草稿／待修订」类措辞。

【输出要求】
1. 先给一句话结论：可定稿／小修订后定稿／退回修订。
2. 发现列表表：ID｜严重度(阻塞/高/中/低)｜位置(Spec§/Plan§/文件)｜问题｜建议处置｜是否已在本轮写入文档。
3. 对 D1–D8 与 SC-01–SC-12 各给：确认／需改／删除／合并（勿只说「大体 OK」）。
4. 若修订了 Spec／Plan：列出改动文件与关键段落；更新版本／状态行与索引摘要句。
5. 将完整报告写入（或给出可落盘全文）：
   docs/reviews/2026-11-01-kimi-review-agent-admin-high-priv-copy-ux.md
6. 报告末尾「定稿边界」必须写明：
   - 权威文本版本号
   - 本轮是否改了业务代码（应为否）
   - SC 是否已执行（应为否）
   - 是否授权开发（默认否，除非委托人在本会话明确授权——当前未授权）

【立即升级为阻塞的红线】
- 把 MCP 运维数据面写成 WebUI 登录管理员／所有者
- 因 lucy_admin 删除或禁用个人行限制能力
- 要求恢复 NewToken「默认 90／最长 365／Proxy 拒绝」政策句
- 把浏览器走查或 docker 重建写成功能合同出口且不改闭口层级
- SC 断言无法失败（空转／只断言常量 true）

现在开始：先读材料与现行警示／constraints 源码片段，再出结论。不要实现功能。
```

---

## 2. 委托人收件检查（你自己用）

审阅返回后，委托人核对：

| 检查 | 通过标准 |
|---|---|
| 结论清晰 | 三选一，无「基本可以但…」含糊收尾 |
| 发现可追踪 | 每条有严重度、位置、处置 |
| 定稿与授权分离 | 定稿 ≠ 开发授权；Plan 仍写实施须另授权 |
| 红线未破 | 未削弱 Spec 131／100；未回潮 Token 政策句 |
| 文档一致 | 若「小修订后定稿」，Spec／Plan／索引状态句已同步 |
| 无越权改码 | `git status` 无意外的 `webui/src` 实现 diff |

通过后，另开 **coder** 会话按 Plan S1→S3 实施（可另写 coder 提示词；本文件不是 coder 提示词）。
