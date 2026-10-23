# Lucy 企业安全整改与真实用户 E2E 验收映射

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 企业安全整改与真实用户 E2E 验收映射 |
| 文档类型 | Checklist |
| 版本 | v1.1（T10～T15 落地与本地执行记录；v1.0 为 T00 映射） |
| 撰写日期 | 2026-10-18 |
| 撰写人 | Claude（Cursor Builder，T00） |
| 委托人 | xingchen |
| 基于材料 | [Spec v0.2](../specs/lucy-20261018-enterprise-security-and-real-e2e-spec.md) §6～§8；[Plan v0.2](../plans/2026-10-18-enterprise-security-and-real-e2e-plan.md) T00～T15；[安全缺陷登记](security-findings.yaml)；评估 v1.1 与本次 T00 基线（runId `t00-20261018-0042`） |
| 适用范围 | 为 Spec §7 的 32 个场景及显式子场景分配「执行器 / 计划落地的测试文件 / 任务 ID」；T10 冻结正式 case catalog 前的唯一映射来源 |
| 输出位置 | `docs/qa/enterprise-security-real-e2e-acceptance.md` |

## 0. 使用约定

- **不复制授权规则正文**：断言以 Spec 对应章节为准，本表只登记归属。场景 ID 沿用 Spec §7；子场景 ID 为 **T00 临时编号**，T10 写入 `scripts/e2e/contracts/case-catalog.yaml` 时可改名，但不得合并或丢失。
- 执行器沿用 Spec §7：B=真实浏览器；P=直接协议/HTTP；D=真实 DB；A=真实 Agent 产品客户端；O=运维/故障；V=证据校验器。每行至少一个执行器；无执行器的 required 场景视为本文件未完成。
- 「落地文件」列：**既有** = 仓库当前已存在，复用并按任务补强；**新建** = Plan 计划新建，当前尚不存在。路径均为 Plan 原文，未在 T00 创建。
- 单元/模拟 UI（contract 层）不能签用户 E2E；每个 required 变体最终都要有 security-integration 或 user-e2e 层的真实执行。
- 本文件不是通过证据。只有 `scripts/e2e/verify-evidence.mjs`（T13）对完整 release execution 的校验结果才有效。

```mermaid
flowchart LR
  S[Spec §7 场景] --> M[本映射 执行器/文件/任务]
  M --> C[T10 冻结 case catalog]
  C --> R[run-security / management / agent 执行]
  R --> V[T13 verify-evidence]
  V --> G[customer-release-readiness]
```

- 场景 → 映射（T00）→ 冻结目录（T10）→ 三类执行 → 唯一 verifier → 客户上线门禁。

## 1. Spec §7 的 32 个主场景

任务 ID 含义见 Plan §3；`T0A` 为 A0 热修复。通用落地文件缩写：

- `RS` = `scripts/e2e/run-security.mjs`（新建，T10）。
- `RA` = `scripts/e2e/run-agent-journey.mjs`（新建，T12）。
- `RB-*` = `webui/tests/real-e2e/*.spec.ts`（新建，T11）。
- `VF` = `scripts/e2e/verify-evidence.mjs`（新建，T13）。
- `WS` = `webui/server/__tests__/`。

| ID | 场景 | 执行器 | 计划落地的测试文件 / 执行入口 | 任务 ID | 复用既有资产 |
|---|---|---|---|---|---|
| SEC-01 | 默认管理认证 | B/P/O | 新建 `WS/webui-deployment-mode.test.ts`、改 `WS/webui-admin-auth.test.ts`；`RS`；`RB-admin-auth`；`scripts/runtime/docker-entrypoint.test.mjs`；`gate:k8s-static` | T0A-2、T02、T10、T11、T14 | 既有 `WS/webui-admin-auth.test.ts`、`scripts/runtime/docker-entrypoint.test.mjs` |
| SEC-02 | 引导密钥与并发 | B/P | 新建 `WS/webui-bootstrap-concurrency.test.ts`；`RS`；`RB-admin-auth` | T0A-2、T02、T10、T11 | 既有 `WS/webui-admin-auth.test.ts` |
| SEC-03 | 管理职责（owner/operator） | B/P | 改 `WS/webui-admin-auth.test.ts`；新建 `WS/audit-actor-propagation.test.ts`；`RS`；`RB-admin-auth` | T02、T08、T10、T11 | 既有 `WS/webui-admin-auth.test.ts` |
| SEC-04 | 会话回收 | B/P/O | 新建 `WS/webui-session-revocation.test.ts`、`WS/webui-account-incarnation.test.ts`；`RS`；`RB-admin-auth`；恢复 runbook 演练（T03）+ OPS-01 | T03、T10、T11、T14 | 既有 `WS/webui-admin-auth.test.ts` |
| SEC-05 | 认证失败/限速 | P/O | 新建 `WS/webui-auth-rate-limit.test.ts`、`WS/audit-actor-propagation.test.ts`；`RS`（含重启不清桶） | T02、T08、T10 | 既有 `WS/web-security.test.ts` |
| SEC-06 | Token 一次性展示 | B/P/V | `RB-management-journey` + `webui/tests/real-e2e/helpers/secret-capture.ts`；新建 `WS/audit-secret-scrub.test.ts`；`RS` 泄漏扫描；`VF` artifact 扫描 | T08、T10、T11、T13 | 既有 `WS/admin-tokens.test.ts`、`WS/proxy-identity-device.test.ts` |
| SEC-07 | 过期/吊销/停用后所有通道 | B/P/A | 新建 `WS/mcp-disabled-agent-all-methods.test.ts`、`WS/mcp-admission-all-methods.test.ts`、`WS/mcp-revocation-stream.test.ts`；`RS`；`RB-management-journey`；`RA` | T0A-3、T04、T10、T11、T12 | 既有 `WS/mcp-proxy-skills.test.ts`、`WS/mcp-proxy-acl.test.ts` |
| SEC-08 | 错误身份（匿名/假 Token/Cookie/外来 sessionId/batch） | P | 新建 `WS/mcp-admission-all-methods.test.ts`、`WS/mcp-session-ownership.test.ts`；`RS` | T04、T10 | 既有 `WS/mcp-proxy-upstream-session.test.ts`、`WS/mcp-proxy-acl.test.ts` |
| SEC-09 | 连接/表/同名 source | P/D/A | `RS`（同名 source 夹具）；`RA`；子场景见 §2 | T10、T12 | 既有 `WS/mcp-proxy-acl.test.ts`、`WS/ac-security-eval.test.ts`、`WS/ambiguous-source-hint.test.ts` |
| SEC-10 | Role Set（同角色闭合/OR/AND） | P/D | `RS`；改 `WS/ac-security-eval.test.ts`；`WS/context-acl-matrix.test.ts`（上下文通道侧，T05 新建） | T05、T10 | 既有 `WS/ac-security-eval.test.ts`、`WS/agent-constraints-ac-p15.test.ts`、`WS/admin-roles.test.ts` |
| SEC-11 | 真行集（BY-01～19） | P/D | `RS` + 真 KTX/DB gold（`examples/security-e2e/gold/compute-gold.mjs`，T10 新建） | T10 | 既有 `WS/mcp-proxy-row-policy-by01-by18.test.ts`、`WS/row-policy-ac-p1.test.ts`、`scripts/smoke/ac-p1-ktx-forced-filters-probe.sh`、`scripts/smoke/ac-p15-uat-runbook.mjs` |
| SEC-12 | 绕过输入 | P/D | `RS`（绕过语料、上游执行计数为 0）；子场景见 §2 | T10 | 既有 `WS/query-guardrails.test.ts`、`WS/mcp-proxy-row-policy-by01-by18.test.ts` |
| SEC-13 | 策略/启用表变化 | B/P/O | 新建 `WS/context-policy-invalidation.test.ts`、`WS/mcp-revocation-stream.test.ts`；`RS`；`RB-management-journey` | T04、T05、T10、T11 | 既有 `WS/role-permission-draft-parity.test.ts` |
| SEC-14 | 上下文隔离 | B/P/A | 新建 `WS/context-acl-matrix.test.ts`、`WS/context-channel-parity.test.ts`、`WS/context-acl-migration.test.ts`；`RB-context-isolation`；`RS`；`RA` | T05、T06、T10、T11、T12 | 既有 `WS/skill-acl.test.ts`、`WS/mcp-proxy-skills.test.ts`、`WS/mcp-proxy-instructions.test.ts`、`webui/tests/e2e/specs/business-skill-151.spec.ts`（contract 层） |
| SEC-15 | 文件内容供应链 | P/O/B | 新建 `WS/frontmatter-safety.test.ts`、`WS/context-file-boundary.test.ts`；`RS`；`RB-context-isolation`；FM 子场景见 §3 | T0A-1、T06、T10、T11 | 既有 `WS/wiki.test.ts`、`WS/api.semantic-asset-export.test.ts` |
| SEC-16 | 间接提示注入 | A/P/D | `RA`（Wiki/Skill/单元格注入）；`RS`；受控出站 sink（T10 环境） | T10、T12 | — |
| SEC-17 | 全载体泄漏 | V/P | `RS` 全载体扫描；`VF`；新建 `WS/audit-secret-scrub.test.ts` | T08、T10、T13 | 既有 `WS/audit-privacy.test.ts` |
| SEC-18 | 可问责审计 | B/P/V | 新建 `WS/audit-actor-propagation.test.ts`、`WS/audit-release-barrier.test.ts`；`RB-audit-export`；`collect-server-evidence.mjs`；`VF` | T07、T08、T11、T12、T13 | 既有 `WS/admin-audit.test.ts`、`WS/mcp-proxy-audit-meta.test.ts`、`WS/request-client-meta.test.ts` |
| SEC-19 | 审计故障 | O/P | 新建 `WS/audit-release-barrier.test.ts`、`WS/audit-projection-recovery.test.ts`；`RS` 故障变体（隔离控制面） | T07、T10 | 既有 `WS/audit-write-health.test.ts`、`WS/proxy-audit.test.ts` |
| SEC-20 | 导出/保留/历史 | B/P/O/V | 新建 `WS/audit-secret-scrub.test.ts`；改 `WS/audit-export-paging.test.ts`；`RB-audit-export`；`VF` | T08、T11、T13 | 既有 `WS/audit-export-paging.test.ts`、`WS/audit-privacy.test.ts`、`WS/query-artifact-cold-store.test.ts` |
| SEC-21 | 会话跨 Token/客户端 | P/A | 新建 `WS/mcp-session-ownership.test.ts`；`RS`；`RA` | T04、T10、T12 | 既有 `WS/mcp-proxy-upstream-session.test.ts` |
| SEC-22 | 客户网络（TLS/Origin/可信代理/旁路） | O/P/B | `WS/web-security.test.ts`（改）；`gate:k8s-static`；`RS`；`RB-admin-auth`；`deploy/k8s/security-e2e/` | T02、T10、T11、T14 | 既有 `WS/web-security.test.ts`、`scripts/gates/helm-lucy-gate.sh` |
| SEC-23 | 依赖与交付 | O/V | `npm --prefix webui audit --omit=dev`；`docs/qa/security-findings.yaml` 交叉校验；G1–G4 ELF/架构 gate；`VF` | T09、T13、T14 | 既有 `scripts/gates/g8-image-k8s-contract-gate.sh`、`scripts/release/security-baseline.mjs` |
| UX-01 | J-01 管理到使用 | B/A/D | `RB-management-journey`；`RA`；`RS` 同实例核对 | T11、T12 | 既有 `docs/qa/suite-user-journey.md`（UJ-ADM-01、UJ-ENG-01）、`webui/tests/e2e/specs/e2e-pub-01.spec.ts`（contract 层） |
| UX-02 | 业务正确性 | A/D | `RA`；`scripts/e2e/answer-assertions.mjs`；独立 gold 计算器 | T10、T12 | 既有 `scripts/smoke/p1-agent-e2e.mjs`（T09 先修门禁语义） |
| UX-03 | 空/NULL/0/失败 | A/D/O | `RA`；故障/超时变体；子场景见 §2 | T12 | 既有 `WS/question-budget.test.ts`、`WS/query-guardrails.test.ts` |
| UX-04 | 多轮/发布与恢复 | B/A/D | `RB-management-journey`；`RA`；子场景见 §2 | T11、T12 | 既有 `WS/report-template-pilot.test.ts`、`WS/certified-route.test.ts` |
| UX-05 | 多产品一致性（每 required 产品 3 次） | A/V | `RA` + 各产品 adapter；`VF`（3 次不可删除） | T12、T13 | — |
| UX-06 | 离线 Eval | B/P/D | `RB-eval-offline`；`RS` hash/完整性拒绝变体 | T10、T11 | 既有 `WS/eval-offline-batch.test.ts`、`WS/eval-offline-runner.test.ts`、`WS/eval-results-import.test.ts`、`WS/eval-suite-import.test.ts` |
| UX-07 | 现场提问/安全候选 | B/P | `RB-eval-offline` / `RB-audit-export`；`RS` | T10、T11 | 既有 `WS/eval-field-questions.test.ts` |
| OPS-01 | amd64 K8s 新装/升级/恢复 | O/B/P/A | `scripts/gates/k8s-{acceptance,release-gate,upgrade-gate}.sh`；`RS`/`RB-*`/`RA` 在同一候选 digest 上执行 | T14 | 既有 `scripts/gates/k8s-gate-negative.test.mjs`、`scripts/gates/helm-lucy-gate.sh` |
| GATE-01 | 门禁反向测试 | V | 新建 `scripts/e2e/__tests__/evidence-verifier.test.mjs`、`scripts/gates/customer-release-readiness.test.mjs`；改 `scripts/gates/p1-release-readiness.test.mjs` | T09、T13 | 既有 `scripts/gates/p1-release-readiness.test.mjs`、`scripts/smoke/p1-agent-e2e.test.mjs` |

统计：SEC 23 行 + UX 7 行 + OPS 1 行 + GATE 1 行 = **32 行**，每行至少一个执行器。

## 2. Spec §7 显式子场景（T00 临时编号）

| 子场景 ID | 来源（Spec §7） | 子场景 | 执行器 | 计划落地文件 | 任务 ID |
|---|---|---|---|---|---|
| SEC-09-S01 | SEC-09/12 | `discover_data` 拒绝建议只含授权对象 | P/D/A | `RS`；`RA` | T10、T12 |
| SEC-09-S02 | SEC-09/12 | `dictionary_search` 同上 | P/D/A | `RS`；`RA` | T10、T12 |
| SEC-09-S03 | SEC-09/12 | `entity_details` 同上 | P/D/A | `RS`；`RA` | T10、T12 |
| SEC-09-S04 | SEC-09/12 | 物理表别名与歧义修复提示同上 | P/D | `RS`；既有 `WS/ambiguous-source-hint.test.ts` | T10 |
| SEC-09-S05 | SEC-09/12 | 未知 tool AbsoluteDeny | P | `RS`；既有 `WS/mcp-proxy-acl.test.ts` | T10 |
| UX-02-S01 | UX-02/04 | 内建度量 `count(*)`/`count(1)` 引导、嵌套聚合拒绝、同名字段消歧、中文度量 | A/D | `RA`；`answer-assertions.mjs`；既有 `WS/query-guardrails.test.ts` | T12 |
| UX-04-S01 | UX-02/04 | 认证路径与报告模板沿用原查询 ACL、不扩大来源 | P/A | `RS`；`RA`；既有 `WS/certified-route.test.ts`、`WS/report-template-pilot.test.ts` | T10、T12 |
| UX-04-S02 | UX-02/04 | 模板/口径/实际预测版本与审计 appliedVersion 一致；模板错误/权限拒绝不静默改题 | A/D | `RA`；`collect-server-evidence.mjs` | T12 |
| UX-03-S01 | UX-03 | 问询预算耗尽、一次继续、无绕过无限循环（阈值沿用 Spec 162） | A/P | `RA`；既有 `WS/question-budget.test.ts` | T12 |
| UX-03-S02 | UX-03 | 查询并发上限、失败后释放执行槽、合法后续请求继续 | P/A | `RS`；`RA` | T10、T12 |
| UX-03-S03 | UX-03 | 取消、超时重试、空结果与慢调用 | A/O | `RA`；故障/超时变体 | T12 |
| SEC-18-S01 | SEC-18/20、UX-07 | 「先调用后上报问题」补绑 | P/V | `RS`；既有 `WS/turn-correlation.test.ts` | T08、T10、T13 |
| SEC-18-S02 | SEC-18/20、UX-07 | 不同客户端/会话不并簇 | P/A | `RS`；`RA`；既有 `WS/turn-correlation.test.ts` | T10、T12 |
| SEC-18-S03 | SEC-18/20、UX-07 | 一次原始问询不重复生成为推断问询 | P/V | `RS`；`RB-audit-export` | T10、T11 |
| SEC-18-S04 | SEC-18/20、UX-07 | 初始化/发现探测不虚增业务问询 | P/V | `RS`；`RB-audit-export` | T10、T11 |
| UX-07-S01 | SEC-18/20、UX-07 | 调用监控/使用概况窗口、慢标记、eval 排除与真实事件对账 | B/P/V | `RB-audit-export`；既有 `WS/call-monitor.test.ts`、`WS/usage-default-view.test.ts`、`WS/usage-slow-call-list.test.ts`、`WS/admin-ui-usage.test.ts` | T11 |
| SEC-15-S01 | SEC-15/17/22 | 品牌图片/Markdown 脚本载荷不执行（含 allow 对照） | P/B | `RS`；`RB-context-isolation`；既有 `WS/branding.test.ts` | T10、T11 |
| SEC-22-S01 | SEC-15/17/22 | 管理快照、Skill 客户端导出与下载链接的权限/过期（含 allow 对照） | P/B | `RS`；`RB-audit-export`；既有 `WS/api.semantic-asset-export.test.ts` | T06、T10、T11 |
| SEC-22-S02 | SEC-15/17/22 | 已由 Spec 175 v0.2 移出分母：部署许可实现删除，激活码不再拒绝任何 MCP 内容通道 | — | — | — |

## 3. SEC-15 的 frontmatter 子场景（Spec §4.6 / §7）

载荷集合：`---js`、`---javascript`、`---JS`、`--- js`、`---json`。断言：服务端零执行、明确 4xx、无写盘；合法 YAML 对照必须成功。

| 子场景 ID | 入口 | 执行器 | 计划落地文件 | 任务 ID |
|---|---|---|---|---|
| SEC-15-FM-01 | 上传预览 `POST /api/wiki/upload/preview` | P | 新建 `WS/frontmatter-safety.test.ts`；`RS` | T0A-1、T10 |
| SEC-15-FM-02 | 上传提交 `POST /api/wiki/upload/commit` | P | 同上 | T0A-1、T10 |
| SEC-15-FM-03 | 编辑保存 `PUT /api/wiki/:key`（dryRun 与非 dryRun） | P | 同上 | T0A-1、T10 |
| SEC-15-FM-04 | 读取磁盘已有文件 `GET /api/wiki/:key`（422） | P | 同上 | T0A-1、T10 |
| SEC-15-FM-05 | 版本恢复 | P | 同上 | T0A-1、T10 |
| SEC-15-FM-06 | 配置包导入 | P | 同上；`RS` | T0A-1、T10 |
| SEC-15-FM-SEED | 播种（Spec §4.6 第 4 条）：模板 Wiki 非法 frontmatter 时 entrypoint 失败并给出文件名 | O | `scripts/runtime/docker-entrypoint.test.mjs`（既有，补强） | T0A-1 |

`SEC-15-FM-SEED` 为 T00 补充登记，Spec §7 未单独编号；T10 case catalog 需确认其是否独立编号。

## 4. 原评估待写用户旅程的归属（不得留占位）

来源：`docs/qa/suite-user-journey.md` §3 矩阵中标「待写」的 10 条。

| 旅程 | 名称 | 归属场景 | 执行器 | 落地文件 | 任务 ID |
|---|---|---|---|---|---|
| UJ-ENG-02 | 连接概览巡检 + 刷新本地目录 | UX-01 | B | `RB-management-journey` | T11 |
| UJ-ENG-03 | 添加 Schema 抽屉 | UX-01 | B | `RB-management-journey` | T11 |
| UJ-ENG-04 | 上传 Manifest；覆盖确认 | UX-01 | B | `RB-management-journey` | T11 |
| UJ-ENG-05 | 维护启用表范围 | UX-01、SEC-13 | B/P | `RB-management-journey` | T11 |
| UJ-ENG-06 | 表目录 → 语义 → 保存并校验 | UX-01、UX-04 | B/A | `RB-management-journey` | T11 |
| UJ-ENG-07 | Wiki 阅读/编辑/保存预检/`sl_ref` | SEC-14、SEC-15 | B | `RB-context-isolation` | T11 |
| UJ-ADM-02 | 角色权限预览 | SEC-10、SEC-14 | B | `RB-context-isolation` | T11 |
| UJ-ADM-03 | 访问日志：问询与调用流水 | SEC-18、SEC-20 | B | `RB-audit-export` | T11 |
| UJ-ADM-04 | MCP 调试台受控 `tools/list` | SEC-08、SEC-14 | B/P | `RB-management-journey` | T11 |
| UJ-ADM-05 | 撤销 Token / 停用 Agent | SEC-07 | B/P/A | `RB-management-journey`；`RS`；`RA` | T11 |

## 5. 首发 required 客户端（Plan T00 步骤 4，R4/R7）

锁定值：`docs/qa/real-e2e-clients.yaml` v4（2026-10-18 owner 方案 A）。

| 产品 | 执行 | transport | GO | adapter / 清单 |
|---|---|---|---|---|
| Codex | automated | `cli` | required | `scripts/e2e/adapters/codex.mjs` |
| Claude Code | automated | `cli` | required | `scripts/e2e/adapters/claude-code.mjs` |
| OpenClaw | automated | `cli` | required | `scripts/e2e/adapters/openclaw.mjs` |
| WorkBuddy | **manual（永远人工）** | `gui` | required | `docs/qa/manual-gui-e2e-checklist.md` |
| Cursor Agent GUI | **manual（永远人工）** | `gui` | required | `docs/qa/manual-gui-e2e-checklist.md` |
| Cursor Agent CLI | automated | `cli` | optional | `scripts/e2e/adapters/cursor-cli.mjs` |

自动层缺二进制/凭据 → BLOCKED；人工层缺 checklist pack → GO blocked。

## 6. T09 待办：selector 契约漂移（T00 只记录，未修）

命令 `npm --prefix webui run e2e:selector-contract` 于 2026-10-18 在 `lucy-v2.0` 工作区（HEAD `fbed6d4`）退出码 1，**33 项失败**，另 49 条 ORPHAN 警告。原样输出：`inbox/e2e/t00-20261018-0042/selector-contract.out`（临时目录，随时可删）。

| 类别 | 数量 | 涉及对象 |
|---|---|---|
| `UNREGISTERED`（实现存在、契约未登记） | 17 | `catalog-bound-scope-note`、`prepare-structure-drawer`、`endpoint-gate-{panel,back,different-database,retry-live,add-schema,separate}`、`setup-assistant-progress`、`agent-token-list`、`audit-turn-meta-card`、`audit-export-inquiry-pack`、`usage-call-monitor-link`、`execution-runtime-notice`、`whitelist-large-list-notice`、`monitor-field-panel`、`call-monitor-usage-slow-mark` |
| `UNREGISTERED TEMPLATE`（模板化 testid 未登记） | 13 | `${idPrefix}-{done,downgrade-preview,structure-error}`、`${testId}-{copy,download}`、`agent-token-row-${token.label}`、`audit-call-inferred-turn-id-${entry.id}`、`audit-usage-slow-${entry.id}`、`connection-more-${conn.id}`、`endpoint-gate-match-${match.id}`、`read-structure-${conn.id}-${schema}`、`schema-more-${conn.id}-${schema}`、`whitelist-group-toggle-${conn.id}-${schema}` |
| `SPEC-DANGLES-IMPL`（spec 引用的 testid 实现已无） | 3 | `skill-role-none`（`business-skill-151.spec.ts`）、`workbench-pending-count`（`e2e-pub-01.spec.ts`）、`role-permission-structure.spec.ts` 中的 `role-skill-access-summary` |

处置要求（Plan T09 步骤 4）：修真实漂移与正负引用识别，不降级为警告，不靠空元素断言或删失败用例制造绿灯。T06 会再改 selector 契约，两者在 T09 汇总复验。

另有同类待办一并挂 T09：`scripts/smoke/p1-governance-smoke.mjs` / `p1-publish-regression-smoke.mjs` 全 blocked 仍 exit 0；`p1-release-readiness.mjs` 把 dry-run 计为 passed；`scripts/smoke/p1-agent-e2e.mjs` 旧路径与 Role Set；`docs/qa/impact-map.json` 仍为旧版（G-02/03/04）。

## 7. 本映射的完整性检查

- [x] Spec §7 32 个主场景全部登记，每行有执行器与任务 ID（§1）。
- [x] Spec §7 明列的五组显式子场景全部登记（§2）。
- [x] `SEC-15-FM-01～06` 全部登记（§3）。
- [x] 原评估 10 条待写旅程均有归属（§4）。
- [x] 自动 required ≥2 产品族（Codex + Claude Code + OpenClaw），另加人工 GUI required；Hermes 不重复计数（§5）。
- [x] T10 冻结 case catalog 分母与变体展开：`scripts/e2e/contracts/case-catalog.yaml` 展开为 **270** 个变体，自动固定分母 **460** 次执行（Agent 变体 × Codex/Claude Code/OpenClaw × 3 次）；人工 GUI 另计 checklist。`case-catalog.lock.json` 固定 digest 与 required id。
- [x] 各「计划新建」文件已落地（见 §8）；个别 UI/Agent/运维用例的**自动化尚未编写**，在 catalog 中保持 required 并如实报 BLOCKED，不删分母。


## 8. T10～T15 落地与本地执行记录（据实；不是通过证据）

基线 HEAD `60683d2`（工作区含 T10～T15 未提交改动），开发机 Apple M4 Pro / Node 24 / arm64，无 KTX 上游、无数据库、无 Codex/Cursor 二进制与模型凭据。运行目录 `inbox/e2e/<runId>/`（临时，可删）。

### 8.1 冻结目录与执行层

| 项 | 数量 / 结果 |
|---|---|
| catalog 变体 | 270 = security 177 + management 27 + gate 40 + agent 26；digest 见 `case-catalog.lock.json` |
| 固定分母 | 460 次执行（agent 变体 × `codex`/`claude-code`/`openclaw` × 3 次；人工 GUI 不进自动分母） |
| security-integration（`e2e:real:security`，真实 Lucy 进程 + HTTP + SQLite） | **73 passed / 0 failed / 104 blocked**（177 个 security 变体） |
| 真实桌面浏览器（`e2e:real:management`，customer 模式 + 认证 required，1440×900，workers=1，retries=0） | 9 个用例通过，覆盖 **12 个** management 变体：SEC-01-V06、SEC-02-V06、SEC-03-V05、SEC-04-V11、SEC-06-V01、SEC-07-V13、SEC-14-V11、SEC-15-V06、SEC-18-V06、SEC-20-V01/V02/V06；其余 15 个 BLOCKED |
| 真实客户端（`e2e:real:agent`） | 分母改为 3 CLI × agent 变体 × 3；本机仍可能因缺 OpenClaw / API key BLOCKED。人工 GUI 不进自动 runner |
| 唯一 verifier 反向测试 | GATE-01-V01～V16 全部通过（`evidence-verifier.test.mjs`，经 node:test 事件 API 采集，非 stdout 解析） |
| harness 单测 | `npm run test:e2e-harness` 152/152 通过 |
| `customer-release-readiness --collect`（本地 run） | exit 3，`releaseReady=false`，只写 `release-readiness.collect.json`，421 条问题（缺分母、缺能力、缺 K8s 证据） |
| 回归 | `webui npm test` 2777/2777；`lint:terminology`、`lint:ia-boundary`、`security:baseline`、`e2e:selector-contract`、`webui build` 通过 |

### 8.2 BLOCKED 清单（security 变体，104 个）

| 原因 | 数量 | 说明 |
|---|---|---|
| 缺 `ktx-upstream` | 36 | 需要真实 KTX 上游才有意义（SEC-18 数据类、SEC-21、SEC-22-S02 许可矩阵、UX-06 等）。此表是 Spec 175 之前的运行快照；许可矩阵已从目录删除，下一次运行不再计入这 15 条 |
| 缺 `ktx-upstream` + `postgres` | 42 | SEC-09/10/11/12 的真实 DB 查询、行集与绕过输入，BY-01～19 |
| `handler_not_implemented` | 18 | SEC-04-V07、SEC-05-V07、SEC-06-V02、SEC-13-V03/V04、SEC-15-V02、SEC-15-FM-06、SEC-15-FM-SEED、SEC-15-S01、SEC-19-V04、SEC-20-V03/V04/V05、SEC-22-S01、UX-06-V04～V07：用例**尚未编写**，不得视为通过 |
| 缺 `network-profile` | 4 | TLS/Secure/HSTS/可信代理、受控出站 sink 需要目标网络 |
| 缺 `clock-control` | 2 | 空闲 30 分钟 / 绝对 12 小时到期（需要时钟控制面） |
| 缺 `k8s-amd64` + `network-profile` | 1 | SEC-22-V05（7878 无直接入口） |
| 缺 `agent-client` + `ktx-upstream` + `postgres` | 1 | SEC-16-V04 受控出站 sink |

management 与 gate 变体的 BLOCKED 原因见 `results/management.json`、`results/gates.json`：连接向导/语义/发布（UX-01、UX-04-V02/V03、SEC-13-V06）、离线 Eval（UX-06-V01～V03/V08）、现场提问/候选（UX-07-*）依赖真实 DB + KTX（及真实客户端），**对应 UI 自动化尚未编写**；OPS-01-*、SEC-17 大部分、SEC-23-V01/V02/V03/V05 依赖 K8s/CI 产物（npm audit、digest 绑定的 G1–G4）。

### 8.3 与 Spec 的差异与已知缺口（需决策或后续任务）

1. **UX-01-V01（J-01 全链路）在连接向导步骤上尚无 UI 自动化**：现有用例只覆盖 J-01 中能在本地验证的步骤（引导、账户、Wiki 授权、Token 一次性展示、吊销、审计导出）。在向导自动化补齐前，该变体保持 BLOCKED，release 将无法通过——这是有意的诚实状态。
2. **K8s 版故障控制面缺失**：依赖 `fault-control` 的变体（重启、存储故障、损坏配置等）在 K8s 上只能 BLOCKED。
3. **隔离探测**：同一 OS 用户下客户端必然读得到 gold，正式验收需独立 OS 身份/VM（`run-agent-journey` 会报 `isolation_not_established`）。
4. **`k8s-upgrade` 门禁（N-1 PVC 升级，OPS-01-V02～V07）未接入 workflow**：verifier 报 `gate_missing`（BLOCKED）。
5. Codex / Cursor adapter 的命令行标志按产品文档编写，**从未用真实二进制执行过**。
6. `npm run lint:spec` 在当前工作区有 8 条 `api-spec` 路由缺失告警（`export-inquiry-pack`、`schema-structure`、`confirm-review`、`field-questions*`、`monitor/field`、`help/diagrams/:id`）：属于工作区中他人未提交的 `webui/docs/03-api-spec.md` 改动与 Spec 161/162/172/173 的路由，**非本任务引入，本任务未改动该文件**。
7. `deploy/k8s/helm/lucy/.DS_Store`（2026-08-03，已被 `.gitignore` 忽略）会让 `k8s-gate-negative` 的 "K6 rejects offline package that pins config ID as digest" 在本机失败（包内含 macOS 残留）；干净检出不受影响，本任务未删除该文件。

## Terminology Compliance

本文件遵循 `webui/docs/00-product-terminology-standard.md`，未新增产品概念；「持久安全账本」「真实用户 E2E 上线门禁」「一次性引导密钥」等用语沿用 Spec「Terminology Compliance」登记。
