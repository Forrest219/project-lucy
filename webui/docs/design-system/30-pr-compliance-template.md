# Design System Compliance 模板

| 元数据 | 内容 |
|---|---|
| 文档名称 | Design System Compliance 模板 |
| 文档类型 | Checklist |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Codex |
| 委托人 | zhangxingchen |
| 基于材料 | `docs/DEVELOPMENT.md` Design System 约束、`webui/docs/design-system/*` 章节 |
| 适用范围 | PR 描述、交付说明、评审记录中的规范符合性说明 |
| 输出位置 | `webui/docs/design-system/30-pr-compliance-template.md` |

把下列模板粘贴到 PR 描述或交付说明中，并按实际情况填写。

## 模板（可直接复制）

```md
## Design System Compliance

### Referenced Specs
- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/<chapter>.md`

### What This Change Follows
- [ ] 视觉层级与交互语义一致（例如按钮主次关系）
- [ ] 颜色使用语义 token / 语义 class，无新增硬编码色值
- [ ] 网格/间距遵循现有页面节奏，无随机 spacing 漂移
- [ ] 文案与排版符合术语与可读性要求
- [ ] 焦点态、禁用态、加载态覆盖完整

### Exceptions (If Any)
- None / <列出例外项与原因>

### Follow-up Needed
- None / <需要后续补齐的规范章节或回归项>
```

## Reviewer 速查要点

- 是否明确引用了具体规范章节，而不是笼统写“遵循设计规范”。
- 是否说明了例外及其边界，而不是直接跳过。
- 是否给出后续补规范或回归计划（如果本次有临时决策）。
