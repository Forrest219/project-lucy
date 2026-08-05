# Table Editor Validation Issue Disclosure Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Table Editor Validation Issue Disclosure Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/110-table-editor-validation-issue-disclosure-spec.md`（v1.0） |
| 适用范围 | 落地 Spec 110：表编辑器校验结果披露 issues + Toast + 术语 |
| 输出位置 | `webui/docs/plans/wo-202608-43-table-editor-validation-issue-disclosure.md` |

**Goal:** 校验失败时用户能立即看到可读原因，不再只剩 Exit Code。

**Architecture:** 纯前端消费既有 `ValidationResult`；抽取 issue 选取 helper；改 `ChangeReview` 校验 Tab 与 Toast / badges。

**Tech Stack:** React TableEditor、既有 toast、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Draft → Implemented（本工单同 PR） |

---

## Non-Negotiable Boundaries

- 不改 `POST .../validate` 契约与 `ktx` 封装。
- 不清理 `._*` 文件；不改 ktx 忽略规则。
- 不做草稿 YAML validate；不做浏览器验证。

## Scope

### Phase 0 — Docs / Terminology / Ledger Open

- Spec 110、本工单。
- `00-product-terminology-standard.md` 登记 §4 术语。
- `webui/docs/README.md`、`plans/README.md` 索引。
- 台账追加 `UX-CATALOG-029`（实现前可 `Pending` / 实现后 `Fixed`）。

### Phase 1 — Frontend

- helper：`primaryValidationIssue` / `listValidationIssues`（过滤 `Project:` 噪声）。
- `ChangeReview` 校验面板：状态中文、问题列表、技术详情折叠。
- `handleValidateCurrent` Toast；`SaveStatusBadges` 去裸 Validate。
- 可选极薄 CSS：`.pl-validation-issues` 列表间距。

### Phase 2 — Tests

- `table-editor.test.tsx`：失败路径断言问题文案；通过路径断言无默认 Exit Code 主行；徽章文案。

### Phase 3 — Ledger close + Gate

- `UX-CATALOG-029` → `Fixed`；README 维护记录 + 跨页面主题 `validation failure disclosure`。
- Gate：

```bash
cd webui
npm test -- --run src/__tests__/table-editor.test.tsx
npm run lint:terminology
npm run build
```

## 验证要点

- Mock issues 含 `Project:` + 实质行 → UI/Toast 优先实质行。
- 成功校验：面板「校验通过」；无强制展示 Exit Code 主行。
- 无浏览器验证。

## Design System Compliance（交付）

- Referenced：`design-system/00-principles.md`、既有 `pl-validation-*` / `pl-error`
- Follows：失败可读、中文主术语、技术细节折叠
- Exceptions：原生 `<details>` 作技术详情
