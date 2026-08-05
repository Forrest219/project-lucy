# Design System Compliance 模板

| 元数据 | 内容 |
|---|---|
| 文档名称 | Design System Compliance 模板 |
| 文档类型 | Checklist |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `docs/DEVELOPMENT.md` Design System 约束、`webui/docs/design-system/*` 章节；Spec 101 按钮 PR 勾选增补 |
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
- [ ] 选中态未误用 `primary` / `danger`（筛选/Tab/时间窗走 segmented）
- [ ] PageHeader 可见动作 ≤ 3；工具刷新/复制/更多优先 `pl-icon-btn`
- [ ] disabled 若有前置条件，已提供 tooltip / `aria-describedby`
- [ ] 颜色使用语义 token / 语义 class，无新增硬编码色值
- [ ] 网格/间距遵循现有页面节奏，无随机 spacing 漂移
- [ ] 列表页 KPI 使用共享 Metric Card（标题行 + ⓘ + 主值 + 副文），无裸 16px 标题 / 无空 ⓘ
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
