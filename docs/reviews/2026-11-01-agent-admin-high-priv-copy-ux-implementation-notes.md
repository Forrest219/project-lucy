# Agent 管理台高权限警示与个人行限制呈现 — 实施记录

## 状态

**功能合同已收口（2026-11-01）**。本条收口不表示可上线。

## 改动文件

| 路径 | 改动 |
|---|---|
| `webui/src/lib/lucyAdminRole.ts` | 新增共享常量：`LUCY_ADMIN_WARNING_PRIMARY`／`SECONDARY`、`PERSONAL_CONSTRAINT_*_HELP`、`PERSONAL_CONSTRAINT_CAVEAT` |
| `webui/src/lib/LucyAdminRoleWarning.tsx` | 新增共享高权限警示组件，主句＋次句，`MCP` 节点 `notranslate` |
| `webui/src/pages/admin/AgentDetail.tsx` | 使用共享警示组件；重构个人行限制标题行（`constraints` 次级 mono）、空态「未设置」、ⓘ caveat tooltip、目录/默认情境说明分支 |
| `webui/src/pages/admin/AgentList.tsx` | 新建 Agent Modal 使用共享警示组件 |
| `webui/src/__tests__/agent-detail.test.tsx` | 更新旧空态断言；新增 `lucy_admin` 警示、默认情境、目录情境测试 |
| `webui/src/__tests__/agent-list.test.tsx` | 更新警示文案断言，同源常量验证 |
| `docs/qa/selector-contract.md` | 登记新增 `agent-constraints-empty`、`agent-constraints-caveat-tooltip` |
| `docs/specs/lucy-20261101-agent-admin-high-priv-copy-ux-spec.md` | 状态改为「功能合同已收口」，补证据落点 |
| `docs/plans/lucy-20261101-agent-admin-high-priv-copy-ux-plan.md` | 状态改为「功能合同已收口」，S3 补实测证据 |
| `docs/README.md`、`docs/plans/README.md` | 索引摘要状态同步 |

## 验证命令与结果

### 组件测试

```bash
cd webui && npx vitest run src/__tests__/agent-detail.test.tsx src/__tests__/agent-list.test.tsx
```

结果：

```text
Test Files  2 passed (2)
     Tests  69 passed (69)
```

### 术语门禁

```bash
cd /Users/forrest/GitHub/project-lucy && npm run lint:terminology
```

结果：

```text
Terminology lint passed (1094 files scanned).
```

## TDD RED → GREEN 摘要

1. 先改 `agent-list.test.tsx` 警示断言为同源常量 → 运行 RED（旧文案不匹配）。
2. 实现 `LucyAdminRoleWarning` 与常量 → GREEN。
3. 先改 `agent-detail.test.tsx` 旧空态断言为「未设置」＋反向断言 → RED。
4. 重构 `AgentDetail` constraints 编辑器 → GREEN。
5. 新增目录情境测试 → RED（无分支实现）→ 实现 `usesCatalogBoundContext` → GREEN。
6. 新增 `lucy_admin` 警示测试 → 因组件已共享，直接 GREEN。

## 已知限制

- SC-08 目录情境句覆盖依赖 `source_scope === "catalog_bound"` 或 `role.id === "lucy_admin"`。当前 `AgentDetail` 的 `formalRoles` 来自 `includeTemplates=false`，但测试夹具将 `lucy_admin` 作为 `source=yaml` 返回，因此覆盖完整；若生产角色列表无 `source_scope`，仍至少对 `lucy_admin` 走目录句（退化条款已登记）。
- 未做浏览器走查／Playwright／窄屏（不在本条出口）。
- 未改 ACL／constraints runtime；未回潮 `NewToken.tsx` 政策句；未涉及 KTX／Helm／镜像。

## 决策遵守检查

- D1：只改呈现/文案分层，未改 ACL/constraints 语义。✅
- D2：警示 = 短主句＋次句；删除「启用表目录」机制主文与 Token 过期夹带。✅
- D3：Token 过期不在 Agent 角色旁提示；未恢复 NewToken 政策句。✅
- D4：绑定 `lucy_admin` 时仍可配置个人行限制（仍仅受 `addBlockReason` 约束）。✅
- D5：含目录绑定/`lucy_admin` → 目录情境说明；否则默认情境说明。✅
- D6：空态 = 标题＋「未设置」＋「添加行限制」；无「未添加个人行限制。」复读。✅
- D7：「编译≠取数」仅在 ⓘ tooltip 与保存确认区；空态/警示条未常驻。✅
- D8：主标题仅「个人行限制」；`constraints` 降为次级 mono。✅
