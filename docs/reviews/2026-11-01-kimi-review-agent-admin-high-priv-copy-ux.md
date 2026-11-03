# Agent 管理台高权限警示与个人行限制呈现 Spec / Plan 审阅报告

**审阅者**：Kimi（独立 reviewer）  
**日期**：2026-11-01  
**审阅对象**：

- `docs/specs/lucy-20261101-agent-admin-high-priv-copy-ux-spec.md`
- `docs/plans/lucy-20261101-agent-admin-high-priv-copy-ux-plan.md`
- 现行源码（只读核对）：`webui/src/pages/admin/AgentDetail.tsx`、`AgentList.tsx`、`webui/src/lib/lucyAdminRole.ts`、对应组件测试。

---

## 一句话结论

**小修订后定稿**。Spec / Plan 的形态、闭口层级、术语、设计规范、伪代码、索引登记均合规；语义未越界；SC 可测。本轮仅更新版本状态行、索引摘要句，并在 Plan S2 增补一条旧测试断言同步说明，无阻塞项。

---

## 发现列表

| ID | 严重度 | 位置 | 问题 | 建议处置 | 是否已在本轮写入文档 |
|---|---|---|---|---|---|
| F01 | 低 | Spec 元数据「状态」行、Plan 元数据「状态」行 | 审阅前状态已写「v0.1 设计定稿，待实施」，把讨论采纳误当成审阅定稿 | 改为「v0.2 审阅定稿，待实施」 | 是 |
| F02 | 低 | Plan §S2 | 未显式列出需同步修改 `agent-detail.test.tsx` 中锁死旧空态文案的断言（如「未添加个人行限制」「不表示行级取数已生效」常驻段落） | 在 S2 步骤中增补「同步改 `agent-detail.test.tsx` 中锁死旧空态文案的断言…」 | 是 |
| F03 | 低 | SC-06 | 「次级弱于主标题」依赖计算样式 class（`text-xs text-fg-muted`）断言，实施时偏宽但可测 | 接受为已知限制；实施时同时断言主标题节点与次级节点分离、次级带 `text-xs`/`text-fg-muted` | 已在审阅意见中说明，未改 Spec 正文 |
| F04 | 低 | Spec 131 §5「高权限警示」与本 Spec | Spec 131 原字面锁定「高权限运维数据面」展示句，本 Spec 改为新文案 | 定稿轮补 Spec 131 注记「Agent 绑定可见文案以本 Spec 为准」；安全意图保留；不再 deferred 到实施 S3 | 是（定稿已写入 Spec 131） |

无阻塞项、无高优先级项。

---

## D1–D8 产品决议确认

| 决议 | 结论 | 依据 |
|---|---|---|
| D1：只改呈现／文案分层，不改 ACL／constraints 语义 | **确认** | Spec §「与既有 Spec 的关系」明确「修订呈现，不改语义」；Plan §3.2 列明不改 ACL 编译路径 |
| D2：警示 = 短主句「全部启用表＋权限很大」＋次句「MCP 数据访问／与 WebUI 登录无关」；删除「启用表目录」机制主文与 Token 过期夹带 | **确认** | Spec §Terminology 表与 §5.1 已锁定文案；Forbidden 列明确禁「启用表目录」「签发」「过期」组合 |
| D3：Token 过期不在 Agent 角色旁提示；不恢复 NewToken 政策句 | **确认** | Spec §5.1 禁 Token 过期建议句；§5.3 明确由签发页必填过期承担 Spec 131 意图；与 Token UX Spec 无冲突 |
| D4：绑定 lucy_admin 时仍可配置个人行限制（仅受既有 addBlockReason 约束） | **确认** | Spec §5.2 保留 `agent-constraints-editor` 与添加按钮；Plan §3.2 列明不改 `addBlockReason` 语义；源码 `AgentDetail.tsx` 当前未因 lucy_admin 额外禁用 |
| D5：含目录绑定／lucy_admin → 目录情境说明（「唯一的行级收窄」）；否则默认「在角色行级策略之上再收窄」 | **确认** | Spec §Terminology 表与 §5.2.2 已分支；与 Spec 100 FinalRows = EffectiveRowGrant OR ∧ AgentConstraints 一致（catalog_bound 的 rowGrant=all 会被 OR 吸收，个人限制是唯一收窄） |
| D6：空态弱展示：标题＋「未设置」＋「添加行限制」；无长说明、无「未添加个人行限制。」复读 | **确认** | Spec §5.2.3 已写死；SC-05 反向断言锁定 |
| D7：「编译≠取数」仅 ⓘ／保存确认，不常驻 | **确认** | Spec §5.2.1 与 §5.2.4 已限定；现有确认 Modal（`agent-save-confirm-modal`）文案「不表示行级取数已生效」保留，不冲突 |
| D8：主标题仅「个人行限制」；constraints 降为次级 mono | **确认** | Spec §5.2.1 已规定；SC-06 可断言分离 |

---

## SC-01–SC-12 验收项确认

| SC | 结论 | 可测性说明 |
|---|---|---|
| SC-01 | 确认 | 子串断言「全部启用表」「权限很大」+ test id `agent-lucy-admin-role-warning` |
| SC-02 | 确认 | 子串断言「MCP」「WebUI 登录无关」+ `MCP` 节点 `notranslate` |
| SC-03 | 确认 | 反向断言不含「启用表目录」「签发」「过期」组合 |
| SC-04 | 确认 | 可对 `webui/src/lib/lucyAdminRole.ts` 导出常量做同源断言，或断言 Detail/List 渲染文本相等 |
| SC-05 | 确认 | 空态 `agent-constraints-editor` 断言含「个人行限制」「未设置」；反向断言不含「编译通过」「未添加个人行限制」 |
| SC-06 | 确认（偏宽） | 断言主标题节点与次级 `constraints` 节点分离；次级带 `text-xs text-fg-muted` |
| SC-07 | 确认 | fixture 用非目录绑定业务角色，断言默认情境说明含「行级策略之上」 |
| SC-08 | 确认 | fixture 用 `lucy_admin` 或 `source_scope === "catalog_bound"` 角色，断言目录情境说明含「唯一的行级收窄」；source_scope 缺失时 Plan §2 退化条款保证至少覆盖 lucy_admin |
| SC-09 | 确认 | 断言勾选 `lucy_admin` 后「添加行限制」不因该角色额外禁用（仍仅由 `addBlockReason` 控制） |
| SC-10 | 确认 | 空态/警示条反向断言不含「编译通过」「行级取数已生效」；确认区 `confirm-finalrows-preview` 保留该 caveat |
| SC-11 | 确认 | `agent-constraints-editor`、`agent-lucy-admin-role-warning` test id 保留；保存确认流 test id 不变 |
| SC-12 | 确认 | `npm run lint:terminology` 退出码 0 |

---

## 本轮修订内容

| 文件 | 关键段落 | 改动 |
|---|---|---|
| `docs/specs/lucy-20261101-agent-admin-high-priv-copy-ux-spec.md` | 元数据表「文档类型 / 版本」「状态」 | 版本由 v0.1 改为 **v0.2 审阅定稿，待实施** |
| `docs/plans/lucy-20261101-agent-admin-high-priv-copy-ux-plan.md` | 元数据表「文档版本 / 日期」「主 Spec」「状态」 | 版本由 v0.1 改为 **v0.2 审阅定稿，待实施**；主 Spec 状态同步 |
| `docs/plans/lucy-20261101-agent-admin-high-priv-copy-ux-plan.md` | §S2 步骤 2 | 新增：同步改 `agent-detail.test.tsx` 中锁死旧空态文案的断言（如「未添加个人行限制」「不表示行级取数已生效」常驻段落），使其对齐 SC-05／SC-10 |
| `docs/README.md` | §2 Spec 索引行 | 该 Spec 摘要状态由「v0.1 设计定稿」改为「v0.2 审阅定稿，待实施」 |
| `docs/plans/README.md` | Plan 索引行 | 该 Plan 摘要状态由「v0.1 待实施」改为「v0.2 审阅定稿，待实施」 |
| `webui/docs/131-lucy-admin-catalog-bound-role-spec.md` | §5 高权限警示 | **定稿补记**：Agent 绑定可见文案指向主 Spec；安全意图保留（委托人批准提前闭合 F04） |
| 主 Spec／Plan | 状态／Follow-up／S3／完成定义 | 同步 F04 已于定稿闭合，不再列入实施 S3 |

---

## 形态门禁实测

- `npm run lint:spec-docs`：本次审阅的 Spec / Plan **无新增形态违规**；剩余阻塞项为无关的 `docs/specs/lucy-20261030-audit-context-bar-spec.md [close-layer]`，未予处理。
- 本次审阅的 Spec / Plan 已被 `docs/README.md`、`docs/plans/README.md` 索引登记。

---

## 定稿边界

- **权威文本版本号**：`v0.2 审阅定稿，待实施`（Spec / Plan 同）。
- **本轮是否改了业务代码**：**否**。未修改 `webui/src` 运行代码、未改 ACL／constraints 运行时语义、未改 `NewToken.tsx`、未改 KTX／server。
- **SC 是否已执行**：**否**。SC-01–SC-12 全部未执行，等待开发授权后由实施方补组件测试与 `lint:terminology` 证据。
- **是否授权开发**：**默认否**。除非委托人在本会话明确授权实施 `webui/src`，否则本轮审阅／定稿不构成开发授权。
- **定稿补记（委托人批准，2026-11-01）**：F04 不再 deferred——已在 `webui/docs/131-lucy-admin-catalog-bound-role-spec.md` §5「高权限警示」写入呈现注记；Plan S3 对应步骤标为定稿已完成。
