# Codex Code Review Handoff — AC-P0 WP-I6 / WP-I7

| 元数据 | 内容 |
|---|---|
| 文档名称 | AC-P0 I6/I7 Codex Code Review Handoff |
| 文档类型 | Review |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 修订 | v1.1：Codex 审出的 3×P1 + 2×P2 已修复；处置见 `20260809-i6-i7-codex-review.md` v1.1 |
| 委托人 | xingchen |
| 基于材料 | Spec 98 §8.4 / §10 / §11；WO `wo-202608-59-access-control-p0.md`；既有 I1–I5（`1062bf4`） |
| 适用范围 | 供 Codex 做 **defect-first code review**；本文作者**未**做 code review / 浏览器验证 |
| 输出位置 | `docs/access-control/plans/20260809-i6-i7-codex-review-handoff.md` |

## 1. 任务边界

| 波次 | 目标 | 状态（实现方自述） |
|---|---|---|
| **WP-I6** | 审计字段、`policyVersion`/capability digest 落库；Admin 降级 banner；Capability Preview；保存路径展示 `runtimeAck`/`policyVersion` | 已实现 |
| **WP-I7** | AC-SEC-SL/CLS/CAP/KEY/SCOPE；UAT 清单；降级 Runbook | 已实现 |
| **明确不做（本 handoff）** | Code review、浏览器验证、Gate C 签字、AC-P1 scoped 行注入 | — |

**工作树：** `/Users/zhangxingchen/Projects/project-lucy-access-control`  
**分支：** `feature/access-control-upgrade`（相对 `origin/main` 超前；I6/I7 改动在提交前可能仍为 working tree / 待 commit）

## 2. 权威依据

1. `webui/docs/98-access-control-p0-runtime-spec.md` §8.4、§10.3、§11
2. `webui/docs/07-mcp-auth-proxy-spec.md` §0.2 / §0.5（`capability_forbidden` 筛选；审计字段）
3. `docs/access-control/design-upgrade.md` §5 / §6.4
4. `docs/access-control/plans/wo-202608-59-access-control-p0.md` WP-I6 / WP-I7

冲突裁决：实现 vs Spec → Spec；Spec vs design-upgrade → **design-upgrade**。

## 3. 变更文件清单（审查范围）

### 3.1 I6 — 服务端

| 路径 | 意图 |
|---|---|
| `webui/server/proxy/audit.ts` | `access_log.policy_version` / `capability_digest`；`permission_snapshots.capability_digest` / `tool_classification_version`；`writeLog` INSERT |
| `webui/server/admin/audit.ts` | 同 schema；列表/CSV 映射；`decisionReasonPrefix` 查询 |
| `webui/server/proxy/mcp-proxy.ts` | `auditMeta` 附带 `policyVersion` / `capabilityDigest` / snapshot 扩展字段 |
| `webui/server/proxy/acl.ts` | `permissionSnapshot` 扩展；`policy_scope_expanded` / `policy_degraded_*` → `config_change_log` |
| `webui/server/admin/policy-runtime.ts` | **新** `GET /api/admin/policy-runtime` |
| `webui/server/index.ts` | 注册 policy-runtime；`/api/health` 区分 `degraded` |
| `webui/server/admin/agents.ts` / `roles.ts` | `effectivePermissionsToPreview` 含 capabilities + digest |

### 3.2 I6 — 前端

| 路径 | 意图 |
|---|---|
| `webui/src/components/PolicyDegradeBanner.tsx` | **新** Admin 顶部降级 banner |
| `webui/src/app/App.tsx` | 挂载 banner |
| `webui/src/pages/admin/AgentDetail.tsx` | Capability Preview；Toast 读 `runtimeAck`/`policyVersion` |
| `webui/src/pages/admin/RoleDetail.tsx` | 同上 |
| `webui/src/pages/admin/Audit.tsx` | `capability_forbidden` 等 reason 前缀筛选；行内显示 pv/digest |
| `webui/src/lib/types.ts` | Preview / PolicyRuntime / Audit 类型扩展 |

### 3.3 I7 — 测试与文档

| 路径 | 意图 |
|---|---|
| `webui/server/__tests__/ac-security-eval.test.ts` | AC-SEC-SL/CLS/CAP/KEY/SCOPE |
| `webui/server/__tests__/policy-runtime-i6.test.ts` | writeLog 字段 + policy-runtime API |
| `docs/access-control/uat-ac-p0.md` | design §5 UAT 勾选 |
| `docs/access-control/runbook-policy-degrade.md` | 路径 A Admin 修复 / 路径 B 回滚 YAML |
| `docs/access-control/plans/wo-202608-59-access-control-p0.md` | I6/I7 状态更新 |

## 4. 实现方自述的验收点（供 Codex 核对，非自称已 review）

### I6

- [ ] allow/deny 审计行可查 `policy_version` + `capability_digest`
- [ ] `permission_snapshots` 含 digest + `tool_classification_version`
- [ ] `GET /api/admin/policy-runtime` 暴露 degrade 范围；`/api/health.status` 在降级时不为完全 `ok`
- [ ] Admin `/admin/*` 降级 banner（`data-testid=policy-degrade-banner`）
- [ ] Agent/Role「生效边界」展示 Data Capability Preview（tool × sourceKey × rowGrant=TRUE）
- [ ] 保存成功 Toast 展示 `policyVersion`；`runtimeAck=false` 走错误 Toast
- [ ] Audit 筛选项含 `capability_forbidden`（`decisionReasonPrefix`）
- [ ] `policy_scope_expanded` / `policy_degraded_enter|recover` 写入 `config_change_log`

### I7

- [ ] `npm test -- ac-security-eval` 五案全绿
- [ ] UAT / Runbook 文档已落盘且带元数据表
- [ ] 未声称 Dynamic RLS / scoped 行级已交付

## 5. 已跑命令（实现方；非 review）

```bash
cd webui
npm test -- ac-security-eval policy-runtime-i6 policy-compile
# 结果（实现时）：3 files / 17 passed
```

建议 Codex review 后复跑（按 Spec 98 §11.2）：

```bash
cd webui
npm test -- acl capability canonical tool-classification mcp-proxy-acl policy-compile ac-security-eval policy-runtime-i6 admin-agents admin-roles
npm run lint:spec
npm run lint:terminology
./node_modules/.bin/tsc --noEmit
```

## 6. 已知风险 / 请 Codex 重点盯的点

> v1.1 注：下列第 3、5、8 项对应 Codex P1-2 / P2-1 / P2-2，**已修**；第 4 项部分由 P1-1（health 对齐）覆盖。

1. **双 audit 模块 schema 同步**：`proxy/audit.ts` 与 `admin/audit.ts` 均懒迁移；列/INSERT 不一致会导致只写一侧可读。
2. **`writeLog` 缓存的 prepared statement**：进程内首次 prepare 后 schema 变更不会重建；冷启动依赖 `ensureColumn`。
3. ~~**Admin write-then-commit + Toast**~~ → **已修（P1-2）**：`runtimeAck=false` 不再 navigate/清状态。
4. **热路径仍钉住 EffectivePolicy**：外部改 YAML / source map 须 commit 才生效（I5）。~~health 在未初始化时仍 ok~~ → **已修（P1-1）**。
5. ~~**`policy_degraded_enter` 对 per-agent 欠采样**~~ → **已修（P2-1）**：集合变化写 `policy_degraded_scope_changed`。
6. **Capability Preview 与旧「工具并集 + Source 树」并存**：Spec 14 禁止**只**展示双并集；审查是否仍误导为笛卡尔。
7. **术语 / `translate="no"`**：`policyVersion`、`capability`、tool/sourceKey 是否按术语标准防御。
8. ~~**AC-SEC-KEY 断言过宽**~~ → **已修（P2-2）**：allow 对照 + `unknown_or_forbidden_connection:other`。
9. **UAT 未人工勾选**：文档已出，Gate C 仍缺签字。
10. **未做浏览器验证**：banner / Toast / Audit 筛选项仅代码层交付。
11. **编译失败 deny 审计缺 policyVersion** → **已修（P1-3）**：`auditMeta` 始终打 runtime `policyVersion`。

## 7. Non-Goals（审查时勿要求本 diff 交付）

- AC-P1 `scoped` / FinalRows / 强制谓词注入
- Gate C 全量 SC-01…SC-10 签字包
- Release notes 正文
- 浏览器 / 移动窄屏测试

## 8. 建议 Codex Review 输出格式

请按 defect-first 输出：

1. **P0 / P1 / P2** 分栏，每条含：文件路径、症状、风险、建议最小修复
2. 标明是否阻塞 Gate C
3. 不修代码（除非调用方另开修复任务）；本 handoff 仅供审查

---

**实现方声明：** 本文是交付说明，**不是** code review 结论。审查以 Spec / design / 代码为准。
