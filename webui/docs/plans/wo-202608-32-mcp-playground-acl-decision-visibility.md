# MCP Playground and ACL Decision Visibility Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | MCP Playground and ACL Decision Visibility Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/99-mcp-playground-acl-decision-visibility-spec.md`（v1.1）；Spec 100 §5 Registry |
| 适用范围 | 落地 Spec 99：DryRun、裁决双行、Audit 改造、`tools/list` 最小 live smoke |
| 输出位置 | `webui/docs/plans/wo-202608-32-mcp-playground-acl-decision-visibility.md` |

**Goal:** MCP 调试台 ACL 裁决预览 + 访问日志裁决原因双行可读化 + Registry 合规深链；必达 `tools/list` 最小 smoke。

**Architecture:** 共享 ACL preview + DecisionReason 映射 → admin API → Playground UI + Audit `DecisionReasonCell` → 导航/入口。

**Tech Stack:** Fastify、`proxy/acl.ts`、React、TanStack Query、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿 |
| v1.1 | 对齐 Spec 99 v1.1：双行硬契约；`tools/list` smoke 必达；Registry 对齐 Spec 100 |

---

## Non-Negotiable Boundaries

- 不引入 LLM。
- 不改 Spec 07 码语义。
- DryRun 不转发 KTX、不落 Token。
- Live：仅白名单；禁止任意 URL；Token 不落盘。
- 深链只生产 Spec 100 §5 Registry URL（禁止无 `tab` 的 `outcome=denied` 等）。
- Audit 最终态禁止单行只显示机器码。
- 不做浏览器验证。

## Scope

### Phase 1 — 映射 + ACL preview

- 抽取 `previewAclDecision`；`decision-reason-labels.ts`。
- `POST /api/admin/mcp-playground/acl-preview`；remediation href 用 Registry（audit 带 `tab=calls&hours=168&user=`）。
- 单测与 proxy-acl 行为对齐。

### Phase 2 — DecisionReasonCell + Audit

- 共享前端组件：主行 label、次行 code（testids）。
- `Audit.tsx` 调用流水列 + Drawer 替换单行 `decisionReason`。
- denied：「在调试台复现」→ `agentId` 从 `user` 映射。

### Phase 3 — Playground UI + 导航

- `McpPlayground.tsx`；`navigation.ts`；Agent 详情 / Overview 次入口。
- 预填 query：`agentId`、`tool`、`mode`。

### Phase 4 — 必达 `tools/list` live smoke

- `POST .../live-smoke`；确认 Modal；会话 Token。
- 服务端/集成测覆盖成功与拒绝路径（可用 mock proxy）。

### Phase 5 — 文档台账

- 术语 §4.8 已有则核对；台账 Pending→Fixed。
- Spec 99/100 Registry 交叉引用保持。

### Phase 6 — Gate

```bash
cd webui
npm test -- --run src/__tests__/mcp-playground.test.tsx src/__tests__/decision-reason-cell.test.tsx server/__tests__/mcp-playground-acl-preview.test.ts
# 含 audit 相关测试
npm run lint:terminology
npm run build
```

## Defer

- `kx_catalog` live、audit 参数完整回填：Phase B / follow-up，须在收尾注明。
