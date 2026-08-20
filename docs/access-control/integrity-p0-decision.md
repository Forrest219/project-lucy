# Lucy 企业完整性 P0 决策备忘

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 企业完整性 P0 决策备忘 |
| 文档类型 | Decision / Product baseline |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-20 |
| 委托人 | xingchen |
| 状态 | **已批准落盘**（决策基线；非实现 Spec） |
| 适用范围 | 售前 / 对内对齐 / 路线图升格；界定「必须承诺」与「已知限制」 |
| 输出位置 | `docs/access-control/integrity-p0-decision.md` |
| 相关 | [`gap-analysis-202608.md`](gap-analysis-202608.md)；[`../lucy-202608-reliable-delivery-upgrade-spec.md`](../lucy-202608-reliable-delivery-upgrade-spec.md)；[`webui/docs/62-trace-evidence-kernel-spec.md`](../../webui/docs/62-trace-evidence-kernel-spec.md) |

---

## 0. 定位与冲突裁决

本文回答：**对企业 CIO / 数据平台，Lucy 要宣称「访问可完整答辩」时，P0 必须有什么、绝不能口头承诺什么。**

| 关系 | 说明 |
|---|---|
| 相对 202608 工程 P0 | **扩展口径，不替代**。工程已立项 P0 仍是 Trace / Evidence Kernel（GOV-01） |
| 相对 `design-upgrade.md` | 权限模型 ADR 仍以 `design-upgrade.md` 为准；本文不改 ACL 语义 |
| 相对实现 Spec | IP0-3 / IP0-4 等尚未单独成 `webui/docs/NN-*.md`；升格实施前须另批 Spec + WO |
| 相对 `inbox/` | 本文为域档案正式基线，**不是**临时审计草稿 |

**完整性判别标准：** 出事时能否答辩

```text
问了什么 → 谁问的 → 凭什么查 → 实际怎么查 → 触达什么 → 规模如何
（可选增强：最终答了什么、谁改过边界、一年后能否交卷）
```

---

## 1. 必须进产品承诺的完整性 P0（IP0）

| ID | 能力 | 验收一句话 | 与现网 / 路线图关系 |
|---|---|---|---|
| **IP0-1** | Trace / Evidence 内核 | 每次业务 `tools/call` 有 append-only `policy_decision` + evidence refs；Admin 能从审计行打开证据链 | **已是** 202608 正式工程 P0（GOV-01 / Spec 62） |
| **IP0-2** | 问询稳定绑定 | 业务调用尽量挂 `turnId`；支持上报问询 + 推断问询，UI 标明来源；漏报不阻断查询，但完整性报告须披露覆盖率 | 已有 `lucy_begin_question` / inferred turn；须升为**覆盖率指标**，不只是可选工具 |
| **IP0-3** | 查询计划 / SQL 可复核（受控） | 语义查询落：规范化计划或 SQL 的 **hash** + **脱敏结构预览** + 触达源清单；授权角色可看预览；**默认不存明文全量 SQL** | **缺口**；现网仅有短 `query_preview` / `query_hash`，且 Agent 裸 `query`/`sql` 被 `raw_query_forbidden` 拒绝。须另立 Spec |
| **IP0-4** | 授权触达一致性 | Proxy 允许源集合与本次实际触达源（含上游改写后可观测部分）可对账；不一致记 `warn`/`deny` 证据 | UAT 已登记「ACL 检参数、不校验最终 SQL」；属安全完整性硬伤。依赖 IP0-3 或等价上游可观测契约 |
| **IP0-5** | 配置变更可答辩 | Agent / Role / Token / `access.yaml` 变更有 dryRun、diff、config audit；高危扩张可关联 Trace | 配置审计已有；与 Trace 打通 + 高危门禁属 202608 P1，但「可答辩」底线纳入完整性口径 |
| **IP0-6** | 对外口径固化 | 发布 / 售前材料固定：本文件 §1 承诺表 + §2 已知限制表；禁止口头扩大 | 流程项 |

### 1.1 P0 最小答辩句（交付后应能说）

> 这次访问：身份是谁、绑定哪次问询（上报 / 推断）、Role 与权限快照是什么、裁决 allow/deny 原因、实际触达哪些源、查询指纹 / 结构预览是什么、结果规模多少——均可在 Admin 证据链上打开。

### 1.2 依赖顺序

```text
IP0-1 Trace/Evidence          ← 地基（已立项）
    ├─ IP0-5 变更证据挂钩
    ├─ IP0-2 问询绑定 + 覆盖率
    └─ IP0-3 查询指纹 / 结构预览
         └─ IP0-4 授权 ↔ 触达对账
IP0-6 口径表随发布冻结
```

- **可并行：** IP0-2 与 IP0-1 后半（Admin Trace read model）
- **须串行：** IP0-4 依赖「能看见实际触达 / 计划」→ 吃 IP0-3 或等价契约

---

## 2. 不进 P0 承诺、必须写进「已知限制」

| 项 | 为什么不进 P0 | 对外怎么写 |
|---|---|---|
| 100% 还原用户原话 | 客户端不一定上报 | 「问询可上报 / 可推断，不保证全量原话」 |
| Agent 最终自然语言答案存档 | 答案在 MCP 客户端会话 | 「Lucy 审计数据面与工具调用，不托管聊天全文」 |
| 完整明文 SQL 默认落库 | 与审计脱敏 / 二次泄密冲突 | 「默认 hash + 脱敏结构；明文仅受控场景」 |
| 行级 / 列级 / 动态 RLS | AC-P1 冻结；202608 明确不做 | 「表级 ACL；细粒度用 VIEW / 拆表」 |
| SSO / 多管理员 IdP | 路线图，非完整性答辩底线前置 | 「Agent Token 治理已具备；管理面企业 SSO 后续」 |
| SaaS 多租户 | 产品 Non-Goal | 「单组织私有部署」 |
| 对象存储冷归档 180 天+ | 愿景 / 路线图 | 「热存本地审计 + 导出；冷归档后续」 |
| 业务错答自动变 Eval | 202608 仅安全负样本方向 | 「质量 Eval 可手工 / 门禁；生产错答不自动入库」 |
| 完整 Visual Debugger | 明确不承诺 | 「Admin 证据链只读，不是全链路调试器」 |

---

## 3. 与「202608 工程分层」对齐

| 层级 | 内容 | 说明 |
|---|---|---|
| **工程已立项 P0** | Trace / Evidence + policy decision + Audit Trace 只读 | 总控 Wave A / GOV-01 |
| **完整性建议增补（须另批 Spec）** | IP0-2 覆盖率、IP0-3 SQL/计划指纹、IP0-4 授权↔触达对账 | 未单独成正式 WO 前，**不得写成已交付** |
| **工程 P1** | 访问治理门禁、安全 Log→Eval、治理看板 | 有 Trace 后才有意义 |
| **工程 P2** | 风险复核候选项、发布证据包 | 交卷材料；不挡首期答辩底线 |

---

## 4. 现网事实锚点（防捏造）

下列为落盘时已核实的能力边界，实施 Spec 时不得回退口径：

| 主题 | 事实 |
|---|---|
| 身份 | Bearer Token；明文一次性；落盘 sha256；可撤销 |
| 授权 | Role-first；表级 / 工具级；fail-closed；裸 SQL 参数拒绝 |
| 审计 | `access_log` + sources + turns；config audit；摘要脱敏 |
| SQL | 可能有 `query_hash` / 截断脱敏 `query_preview`；**无**「问题 → 完整可复现 SQL」一等闭环 |
| 原问题 | 可选上报 / 推断；规格不保证 100% 还原 |
| Trace | Spec 62 / WO-01 为 202608 P0；append-only；禁止热存原始 SQL AST / 结果样本 / Token 明文 |
| 上游最终 SQL 与 ACL | UAT：主要检请求参数，**不**校验上游最终 SQL 真实表集合 |

参考：`docs/security-guide.md`、`webui/docs/07-mcp-auth-proxy-spec.md`、`webui/docs/08-mcp-audit-question-tracing-spec.md`、`docs/access-control/uat-agent-permissions-v1.md` §4.6。

---

## 5. 决策表（拍板用）

| 议题 | 决定 | 若不遵守的后果 |
|---|---|---|
| 只做现网 202608 工程 P0（Trace）对外称「完整性」？ | **否，不够** | 仍缺「怎么查」与「授权=触达」 |
| Trace + 问询覆盖率 + 查询指纹 + 触达对账 = 完整性 P0 最小集？ | **是** | 可对 CIO 答辩数据面 |
| 把 SSO / RLS / 答案全文塞进完整性 P0？ | **否** | 与 Non-Goals 冲突，范围爆炸 |
| 明文全量 SQL 默认进审计？ | **否** | 审计库变泄密面；用 hash + 脱敏预览 |

---

## 6. 后续动作（非本文件范围）

1. 产品确认后，为 **IP0-3 / IP0-4** 另批实现 Spec（建议落 `webui/docs/`）与 WO。
2. IP0-2：在 Admin / 发布证据中增加问询绑定覆盖率披露，不改「漏报不阻断查询」语义。
3. 售前 / `docs/security-guide.md` / 客户材料引用本文件 §1–§2，避免口径漂移。
4. 术语若新增「查询指纹 / 授权触达对账」等产品概念，先登记 `webui/docs/00-product-terminology-standard.md`。

---

## 7. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`.

Protected / 勿裸露混用：`Agent`、`Token`、`Role`、`ACL`、`MCP`、`Trace`、`Evidence`、`access.yaml`、`SQL`（结构预览 vs 明文全量须在文案中区分）。

本文件为决策备忘；若升格为功能 Spec，须在 Spec 内设完整 `Terminology Compliance` 小节。

— 完
