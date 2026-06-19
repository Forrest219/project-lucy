# Module 1 Agent 权限管控 — 代码审查报告

| 元数据 | 内容 |
|---|---|
| 文档名称 | Module 1 Agent 权限管控代码审查报告 |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-19 |
| 撰写人 | Claude Reviewer |
| 委托人 | zhangxingchen |
| 基于材料 | project-lucy/docs/design-agent-permissions.md, webui/server/admin/*, webui/src/pages/admin/* |
| 适用范围 | Builder 修复参考；合并前必读 |
| 输出位置 | project-lucy/docs/review-module1-agent-permissions.md |

---

## 总体判定

**REQUEST CHANGES** — 无 P0 安全漏洞，存在 2 条 P1 正确性问题必须修复后方可合并，另有 4 条 P2/P3 建议性修改。

---

## P0 安全性

全部通过。

- **Token 明文不落盘**：`tokens.ts` 生成明文仅在 HTTP 响应 `data.token` 字段返回，不写 yaml、不写日志。通过。
- **fs-safe 路径穿越防护**：`webui/config/../../../secrets` 穿越测试已覆盖，`resolveExistingTarget` + `isWithin` 双重防护有效。通过。

---

## P1 正确性（必须修复）

### [P1-1] `tokens.ts:101-116` — DELETE token 时 sqlite 写入顺序错误且错误被静默吞掉

**问题**：实现先 try/catch sqlite INSERT、再无条件 `safeWrite` yaml。若 sqlite 写失败被 catch 吞掉，yaml 照常删除 token——token 消失于 yaml 但未进 `revoked_tokens`，不符合设计意图，且调用方无感知。设计 §5.2 要求"先写 `revoked_tokens` 再删 yaml"。

**建议修复**：
1. 将 sqlite INSERT 移到 `safeWrite` 之前
2. sqlite 写失败时向上抛（不静默吞掉），返回 500

### [P1-2] `agents.ts:300-311` — DELETE agent 时同样的 sqlite 错误被静默吞掉

**问题**：DELETE `/api/admin/agents/:userId` 先 try/catch 把所有 token hash 写 `revoked_tokens`（reason: `agent_deleted`），错误被 `// best effort` 注释吞掉，之后 yaml 段照常删除。设计 §4.3 要求先写 sqlite 成功再删 yaml。

**建议修复**：sqlite INSERT 错误应向上抛，yaml 删除在 INSERT 全部成功后执行。

### [P1-3] `AgentDetail.tsx:153-161` — 禁用/启用按钮直接绕过 dryRun 和 diff 预览

**问题**：点击"禁用/启用"按钮直接调用 `saveMutation.mutate({ enabled: newEnabled })`（dryRun:false），完全跳过 previewMutation 和 diff 模态确认。设计 §2.3 明确"「保存」按钮先弹 diff 模态确认"。

**建议修复**：将此处改为先调 `previewMutation.mutate({ enabled: newEnabled })`，走 diff tab 流程，或至少加 `confirm()` 二次确认弹窗。

---

## P2 架构对齐（建议修复）

### [P2-1] `agents.ts:151-171` — `makeDiff` 实现的是位置对齐而非 unified diff

自实现的逐行位置对齐在插入/删除行时会产生大量错误的 `-`/`+`，无法正确表达变更意图。设计 §2.3 明确"复用 DiffViewer"并使用 unified diff。

**建议**：改用 `diff` 库（`unified` 算法）替换此函数。

### [P2-2] `agents.ts:253-255` — 乐观锁 version 校验可被绕过

```ts
if (request.body?.version && request.body.version !== currentVersion) {
```
客户端不传 `version` 字段时短路跳过检查，并发保护实际可绕过。

**建议**：要求 version 必传，或去掉 `request.body?.version &&` 短路条件改为总是校验。

### [P2-3] `audit.ts:97` — LIMIT/OFFSET 用字符串拼接而非参数绑定

虽然 parseInt + Math.min 阻断了注入风险，但不符合最佳实践且阻止 prepare cache。

**建议**：改为 `?` 参数绑定。

---

## P3 Non-Goals 合规（建议）

### [P3-1] `agents.ts:122-129` — `getLastUsedMap` 函数定义后从未调用，死代码

**建议**：删除此函数。

### [P3-2] `mcp-tools.ts` — 工具列表硬编码未标注这是 A1 降级实现

**建议**：补注释 `// A1 fallback: proxy tool cache not yet implemented; using static list`。

### [P3-3] proxy 文件（mcp-proxy.ts / identity.ts / acl.ts）未被修改，符合 Non-Goals

通过。

### [P3-4] 前端仅使用现有 className，无新样式依赖

通过。

---

## 未确认假设处置建议

| 假设 | 实现处置 | 建议 |
|---|---|---|
| A1（proxy 已缓存 tools/list） | 用硬编码列表代替 | 补注释说明降级实现 |
| A3（乐观锁） | 实现了 version 字段但检查条件可绕过 | 修复短路条件（见 P2-2） |
| A4（30s TTL 可接受） | ?reload=true 未实现，toast 提示 30s | 在 PR 描述对齐此决定 |

---

## 合并前必须修复

1. **P1-1**：`tokens.ts` DELETE token — sqlite INSERT 移到 safeWrite 前，失败返回 500
2. **P1-2**：`agents.ts` DELETE agent — sqlite INSERT 失败向上抛，yaml 删除在 INSERT 成功后执行
3. **P1-3**：`AgentDetail.tsx` 禁用/启用按钮 — 走 diff 预览流程，不直接 dryRun:false
