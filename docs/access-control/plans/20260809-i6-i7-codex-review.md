# Codex Code Review - AC-P0 WP-I6 / WP-I7

| 元数据 | 内容 |
|---|---|
| 文档名称 | AC-P0 I6/I7 Codex Code Review |
| 文档类型 | Review |
| 版本 | v1.1 |
| 审阅日期 | 2026-08-09 |
| 审阅人 | Codex |
| 修复日期 | 2026-08-09 |
| 修复人 | Cursor Agent |
| 基于材料 | `docs/access-control/plans/20260809-i6-i7-codex-review-handoff.md`；Spec 98 §8.4 / §10 / §11；WO-202608-59 |
| 审阅范围 | WP-I6 / WP-I7 working tree diff；未做浏览器验证 |

## 结论

**原结论（v1.0）：不建议签 Gate C。** 审出 3 个 P1、2 个 P2。

**修复后（v1.1）：上述 3×P1 + 2×P2 已全部落地修复**（见 §修复处置）。Gate C 是否可签仍取决于 Admin 子集预存失败、`tsc --noEmit` 全仓债、以及 UAT/Runbook 人工勾选——不在本修复包宣称范围内。

## P1

### P1-1 `/api/health` 在策略未初始化时仍返回 `status: "ok"` — **FIXED**

- 文件：`webui/server/index.ts`；共享判定 `isPolicyRuntimeHealthy()` in `acl.ts`
- 原症状：health 只看 degrade 标志，忽略空 `policyVersion`
- 修复：health 与 `/api/admin/policy-runtime` 共用 `isPolicyRuntimeHealthy`（要求 `policyVersion !== ""` 且无 degrade）
- 回归：`policy-runtime-i6` → `P1-1: /api/health is degraded when EffectivePolicy is uninitialized`

### P1-2 `runtimeAck=false` 时前端仍执行成功后的导航和状态清理 — **FIXED**

- 文件：`AgentDetail.tsx`、`RoleDetail.tsx`
- 原症状：error toast 后仍 invalidate 业务数据、清 diff、navigate
- 修复：`toastAccessWriteAck` 返回 boolean；`false` 时仅刷新 `policy-runtime`，保留编辑/diff 上下文，禁止 navigate；Toast 文案改为「保存未生效…磁盘可能已回滚」

### P1-3 编译失败类 deny 审计行缺 `policy_version` / `capability_digest` — **FIXED**

- 文件：`webui/server/proxy/mcp-proxy.ts` `auditMeta`
- 原症状：`permissionSnapshot` 失败时整段省略策略字段
- 修复：始终从 `getPolicyRuntimeStatus()` 写入 `policyVersion`；compile-failed 时 `capabilityDigest` 显式缺省（DB NULL），不伪造 digest
- 回归：`policy-runtime-i6` → `P1-3: compile-failed deny audit still stamps policy_version`

## P2

### P2-1 per-agent 降级集合变化不会继续写事件 — **FIXED**

- 文件：`webui/server/proxy/acl.ts` `commitEffectivePolicyUnlocked`
- 修复：比较 previous/new degraded agent set；首入写 `policy_degraded_enter`，后续增减写 `policy_degraded_scope_changed`（`addedAgents`/`removedAgents`），清空写 `policy_degraded_recover`

### P2-2 AC-SEC-KEY 断言过宽 — **FIXED**

- 文件：`webui/server/__tests__/ac-security-eval.test.ts`
- 修复：先断言 `warehouse + fin_ledger` allow，再断言 `other + fin_ledger` → `unknown_or_forbidden_connection:other`

## 验证结果

### 修复后复跑（实现方）

```bash
cd webui
npm test -- --run server/__tests__/ac-security-eval.test.ts server/__tests__/policy-runtime-i6.test.ts
```

结果：`2 passed / 9 tests passed`（含 P1-1 / P1-3 新用例与收紧后的 AC-SEC-KEY）。

```bash
cd webui
npm test -- ac-security-eval policy-runtime-i6 policy-compile
```

结果：通过。

### 原审阅时验证（v1.0，保留备查）

```bash
cd webui
npm test -- --run server/__tests__/ac-security-eval.test.ts server/__tests__/policy-runtime-i6.test.ts server/__tests__/policy-compile.test.ts
```

结果：通过，`3 passed / 17 tests passed`。

扩大 Admin/ACL 子集当时：`17 failed | 60 passed`（集中在 `admin-agents` / `admin-roles` dryRun:false 500，多为预存 audit mock 债）。

`lint:terminology`：通过。  
`tsc --noEmit`：全仓仍不绿（未全部归因 I6/I7）。

未执行：浏览器验证；`lint:spec`（环境依赖问题）。

## Open Questions（已闭合口径）

1. `capability_digest` 对 `role_resolution_failed`：**允许 NULL**；必须保留 `policy_version` + `decision_reason`。
2. `/api/health` 未初始化：返回 **`status: "degraded"`** + `policy.healthy:false` + 空 `policyVersion`（不新增枚举）。
