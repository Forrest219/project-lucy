# Spec 129 — Agent Admin Browser Audit Remediation

| 元数据 | 内容 |
|---|---|
| 文档名称 | Agent Admin Browser Audit Remediation Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-26 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/plans/2026-08-26-agent-admin-browser-audit-remediation.md`；浏览器审计；Spec 14/59；Design System 02 |
| 适用范围 | `/admin/agents` 列表与详情、对象详情抽屉（Agent/Token 相关）、Agent 写接口角色绑定边界 |
| 输出位置 | `webui/docs/129-agent-admin-browser-audit-remediation-spec.md` |

## 1. 目的

修复 Agent 管理经浏览器审计确认的 UI/UX、可访问性与功能边界问题：正式 Role 与参考模板分离、详情页签深链与脏状态守卫、权限/diff 信息层级、对象抽屉焦点管理、列表密度与筛选恢复。

## 2. 锁定产品决策

### Decision 1 — 仅正式 Role 可绑定 Agent

- Agent 新建/编辑角色列表只展示正式 Role（`GET /api/admin/roles?includeTemplates=false`）。
- 参考模板不得出现在 Agent 角色选择器；不得经 Agent POST/PATCH（含 `dryRun:true`）绑定。
- 参考模板只能在 Role 管理中「基于模板创建正式 Role」后再绑定。
- **本决策废止 Spec 14 §5.2「使用 template role 创建后，落盘 YAML 展开为普通 role」作为 Agent Admin 合法路径。** Spec 14 该验收点以本 Spec 为准（superseded）。

### Decision 2 — 服务端不可绕过

当解析角色来源为模板时，Agent POST/PATCH 在治理 gate / materialize 之前返回：

```json
{
  "ok": false,
  "error": {
    "code": "REFERENCE_TEMPLATE_NOT_ASSIGNABLE",
    "message": "Reference template '<roleId>' must be copied to a formal Role before assignment."
  }
}
```

拒绝后 `access.yaml` 字节内容不变。删除 Agent 写入路径对模板 materialize 的调用。

### Decision 3 — 失效正式 Role

- 新建 Agent：失效正式 Role 不可选或不可提交。
- 编辑：若当前已绑定失效正式 Role，仅保留禁用的当前值，并提供 Role 管理修复入口；不得成为其他 Agent 的可选值。

### Decision 4 — 详情页签与脏状态

- URL：`?tab=info|tokens|permissions|diff`；默认 `info`。点击页签必须写入 URL；前进/后退与刷新保持一致。
- 未知/不可用 tab → `replace` 归一到 `info`。
- 单一 dirty 源（现有 `hasEdits` / `edit*` 基线）；`beforeunload` + 路由离开确认；页内切 tab 不确认、不丢表单。

### Decision 5 — Diff / 权限信息层级

- dry-run `diff` 仅覆盖本次写操作涉及片段；unified diff 约三行上下文；排序稳定。
- `diff` 与 `proposedYaml`（若返回）服务端脱敏 Token hash 等为 `[REDACTED]`。
- 前端先字段摘要，原始 diff 默认折叠「技术详情」。
- 权限主视图展示可读「数据能力」；digest / 原始 `rowGrant` / `FinalRows` 等进技术详情。高风险变更仍走 dry-run / 确认 / 治理 gate。

### Decision 6 — 抽屉可访问性

- 使用 Radix Dialog；焦点捕获/循环/Esc；关闭后焦点恢复触发点。
- 生产 UI 不得展示「关闭方式：…」调试文案。
- Agent 抽屉展示创建日期、配置最后变更时间、访问日志入口。

### Decision 7 — 列表密度与响应式

- 主表移除「创建日期」「配置最后变更时间」；筛选空状态可「清除筛选」。
- 「编辑」为主操作；权限/日志收纳进更多菜单；点击目标约 ≥32×32px。
- **保留 Design System 02**：`--layout-min-readable-width: 1200px` 与壳层 `min-width`。1024–1199 允许壳层级横滚；宽表在自身容器滚动。
- 移动端 390px 适配延期。

## 3. Non-Goals

- 不改权限计算公式、YAML Schema、数据库结构。
- 不拆除 DS02 全局壳层锁宽；不新增移动端布局。
- 不改 Role 管理模板复制/读取；不新增重复 roles API。
- 不把本轮宣称为企业级签字包。

## 4. Terminology Compliance

- 参考模板 / 正式 Role / Agent / Token / 数据能力：遵循 `00-product-terminology-standard.md`。
- 技术键名（digest、rowGrant、FinalRows、access.yaml）仅技术详情出现，并 `notranslate`。

## 5. 验收摘要

见实施计划第 9 节；自动化覆盖见计划 Task 1/7。
