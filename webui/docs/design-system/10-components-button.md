# Lucy WebUI 按钮规范（Components）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI 按钮规范（Components） |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Codex |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/src/app/app.css`、`webui/src/pages/Onboarding.tsx`、`webui/src/pages/connections/ConnectionOverview.tsx`、UI/UX 反馈 `UX-CONNECTIONS-023`、`UX-OVERVIEW-008` |
| 适用范围 | Lucy WebUI 所有按钮、按钮组和按钮状态设计与实现 |
| 输出位置 | `webui/docs/design-system/10-components-button.md` |

## 1. 设计目标

- 保证按钮语义与视觉层级一一对应。
- 避免同组操作出现误导性显著性。
- 提升跨页面一致性和可预测性。

## 2. 按钮语义与类型

- `primary`：唯一主路径动作（如提交确认、发布、完成关键步骤）。
- `secondary`：并列维护动作（如查看、复制、刷新、新增、打开详情）。
- `ghost/link`：低干扰辅助动作。
- `danger`：删除、禁用、清空、不可逆风险动作。

## 3. 关键规则（强约束）

1. 同一 `action group` 内最多一个 `primary`。
2. 并列动作默认全部 `secondary`，不得混入 `primary`。
3. 只有存在“唯一推荐下一步”时才允许 `primary`。
4. `danger` 不与普通主操作并排混淆；必要时二次确认。
5. 同组按钮尺寸（高度、圆角、内边距）必须一致。
6. 文案使用动词开头，避免模糊词（例如“刷新”应明确对象范围）。

## 4. 交互状态

每个按钮类型都必须定义并验证：

- `default`
- `hover`
- `active`
- `focus-visible`
- `disabled`
- `loading`

实现要求：

- `loading` 时按钮宽度应尽量稳定，防止布局抖动。
- `disabled` 需视觉可识别，且屏蔽触发行为。
- `focus-visible` 必须清晰可见，不得被容器裁切。

## 5. 按钮组布局

- 按钮组默认横向排列，间距统一（建议固定 gap）。
- 主按钮位置在同一产品区域内保持一致（推荐右侧）。
- 当断点导致换行时，保持视觉顺序和语义顺序一致。

## 6. 适配 Lucy 当前页面的落地约定

- `/connections` 的 `+ 添加 Schema` 与 `刷新本地目录` 为并列维护动作，必须同级 `secondary`。
- `/overview` 的 `复制 MCP 配置` 与 `查看配置` 为并列动作，必须同级 `secondary`。
- 后续新增“复制/刷新/查看/新增”类组合，默认沿用上述同级策略。

## 7. Do / Don’t

- Do：同组并列维护动作统一 `secondary`。
- Do：把真正关键、唯一的下一步放为 `primary`。
- Don’t：仅因“看起来更显眼”就把并列动作升成 `primary`。
- Don’t：在同组放两个及以上 `primary`。
- Don’t：用颜色替代语义（例如普通操作误用 `danger` 色）。

## 8. 验收清单（PR 必填）

- 是否存在同组多个 `primary`？
- 是否把并列维护动作错误地设置为主按钮？
- 是否覆盖了 hover/focus/disabled/loading 状态？
- 是否保证断点下按钮组顺序和可达性？
- 是否新增或变更了用户可见文案，并通过术语 lint？

## 9. 回归与治理

- 本规范为按钮组件事实源；若实现与规范冲突，先修实现。
- 若出现新交互模式未覆盖，先在 `99-governance.md` 记录临时决策，再升级本规范。
