# Connection Manifest Upload Affordance Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection Manifest Upload Affordance Spec |
| 文档类型 | Product / UX / Frontend Spec |
| 版本 | v0.2 |
| 撰写日期 | 2026-07-31 |
| 关联页面 | `/connections` |
| 关联工单 | `webui/docs/plans/wo-M28-connection-manifest-upload-affordance.md` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`, `webui/docs/27-connection-overview-ops-ux-cleanup-spec.md`, `webui/docs/28-catalog-reload-result-ops-ux-spec.md`, `webui/docs/29-connection-semantic-boundary-automation-spec.md`, `webui/docs/34-table-whitelist-catalog-reload-layout-stability-spec.md` |

## 1. 背景

`/connections` 页面已支持在 Schema 行内执行 `维护白名单`、`上传 Manifest`，并通过 Drawer 上传受控 Schema Manifest。

根据数据库接入与语义层维护边界，Schema 级 YAML 的主入口收敛到 `/connections`：

- 连接级按钮 `上传 Schema Manifest` 用于在该 Connection 下选择目标 Schema 后上传。
- Schema 行内 `上传 Manifest` 用于锁定当前 Schema 后上传。
- `/connections/whitelist` 只展示缺失 Manifest 诊断与跳转，不再提供第二个 Schema Manifest 上传入口。
- Table 级 YAML 不属于本页面，必须在语义层维护的 `表目录` / 表详情中以 `上传 semantic overlay` 呈现。

当前用户反馈集中在两个细节：

1. 表格操作列中的 `维护白名单`、`上传 Manifest` 以纯黑粗体按钮样式出现，和连接卡片底部主按钮 `上传 Schema Manifest` 的视觉权重冲突。
2. 上传 Drawer 中的 `文件名` 使用可编辑输入框。目标路径实际由系统按 Connection 与 Schema 计算，可编辑文件名会让用户误以为可以决定落盘路径，交互语义不合理。

本规格只修复上传入口归属与 affordance 问题，不改变 Schema Manifest 后端校验、目标路径计算或刷新本地目录流程。

## 2. 目标

- 降低表格行内操作的视觉权重，使其表现为行级链接操作，而不是主按钮。
- 保留行内操作的可点击感，使用品牌色或链接色，并在 hover/focus 时提供清晰反馈。
- 将 Drawer `文件名` 改为只读展示，避免用户误解其可以编辑目标路径。
- 确认 `/connections` 是 Schema 级 YAML 的主入口，承接从 `/connections/whitelist` 跳转来的缺失 Manifest 修复。
- 保留所选文件原始文件名，用于扩展名校验、审计和上传记录展示。
- 保持 `目标 Schema` 锁定、目标路径由系统计算、提交前自动校验、成功后刷新本地目录的既有能力。

## 3. 非目标

- 不新增上传入口。
- 不在 `/connections/whitelist` 中保留独立 Schema Manifest 上传入口。
- 不在数据库接入页面新增 table 级 YAML / semantic overlay 上传入口。
- 不改变 `schema_manifest` asset kind。
- 不允许用户选择或编辑 `semantic-layer/<connection>/_schema/<schema>.yaml` 目标路径。
- 不改变服务端 `filename` 入参语义；服务端仍不得信任 `filename` 计算写入路径。
- 不重构 Connection 卡片布局、Catalog reload 诊断、Add Schema Drawer 或 semantic overlay 发布流程。

## 4. UX 要求

### 4.1 Schema 行内操作

Schema 资产表格最后一列的行级动作必须使用轻量链接样式：

| 状态 | 行内动作 | 样式要求 |
|---|---|---|
| 已存在 Manifest | `维护白名单` | 普通字重，品牌色或链接色，hover 下划线或变色 |
| 缺失 Manifest | `上传 Manifest` | 普通字重，品牌色或链接色，hover 下划线或变色 |
| 解析失败 | `查看错误` / `重新上传 Manifest` | 普通字重，品牌色或链接色，hover 下划线或变色 |

行内动作不得复用 `pl-btn--primary`、`pl-btn--secondary` 或高权重 ghost button 的视觉样式。表格内动作必须和连接卡片底部 CTA 有明确层级差异。

### 4.2 上传 Drawer 文件名展示

上传 Drawer 中 `文件名` 必须改为只读展示：

- 不使用可编辑 `<input>`。
- 默认展示当前目标 Schema 对应的建议文件名，例如 `openclaw_db.yaml`。
- 用户选择文件后，展示用户选择的原始文件名，例如 `selected_schema.yaml`。
- 文件名展示区域必须添加 `translate="no"`、`notranslate` 和 `dir="ltr"`。
- 文件名展示不得看起来像可编辑表单控件。
- 目标路径仍通过校验面板或成功态展示，不允许用户编辑。

推荐视觉：

```text
文件名
openclaw_db.yaml
```

也可增加轻量辅助文案：

```text
目标路径由系统按 Connection 和 Schema 计算。
```

### 4.3 文件选择与粘贴行为

- 从文件选择或拖拽进入时，前端继续记录原始文件名并随请求提交。
- 直接粘贴 YAML 源码且未选择文件时，前端使用当前 Schema 的默认文件名提交。
- 切换可选 Schema 时，默认文件名同步为 `<schema>.yaml`。
- 切换可选 Schema 时，目标路径、所选文件默认名、YAML 示例和校验提示必须同步到当前 Schema。
- 默认 YAML 示例不得展示与当前 Schema 不一致的 `table: <schema>.<table>`。
- 重新打开 Drawer 时，恢复为当前入口对应的默认文件名与空内容。

### 4.4 Drawer 模式

`CatalogAssetUploadDrawer` 应支持两种清晰模式：

| 模式 | 来源 | Schema 控件 | 标题 | 目标路径 |
|---|---|---|---|---|
| `selectableSchema` | `/connections` 连接级 `上传 Schema Manifest` | 可选择当前 Connection 下的 Schema | `上传 <connection> 的 Schema Manifest` | 随选择的 Schema 更新 |
| `lockedSchema` | `/connections` Schema 行内 `上传 Manifest` 或从白名单页跳转后预选 | 只读展示目标 Schema | `上传 <schema> 的 Schema Manifest` | 锁定到当前 Schema |

两种模式复用同一个上传 Drawer、校验逻辑和提交 API，避免形成多套 Schema Manifest 上传心智。

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

Required UI terms:

| 概念 | UI 文案 |
|---|---|
| Schema 行内上传 | `上传 Manifest` |
| Connection 级上传 | `上传 Schema Manifest` |
| 上传 Drawer 标题 | `上传 <schema> 的 Schema Manifest` or `上传 <connection> 的 Schema Manifest` |
| 目标 Schema | `目标 Schema` |
| 文件名 | `文件名` |
| YAML 源码 | `YAML 源码` |
| Table 级 YAML | `上传 semantic overlay`，不在本页面出现 |

DOM 防御要求：

- `Schema`、`Manifest`、`Schema Manifest`、`YAML`、`Join` 必须按术语标准添加翻译防御。
- Schema 名、Connection id、文件名、目标路径必须添加 `translate="no"` 和 `notranslate`。
- 文件名和路径展示必须使用 `dir="ltr"` 或等价布局，避免被浏览器翻译或双向文本处理破坏。

## 6. 验收标准

1. `/connections` 中 Schema 行内 `维护白名单`、`上传 Manifest` 不再显示为黑色粗体按钮。
2. 行内操作 hover 时出现下划线或明显颜色变化，并仍可通过键盘 focus 识别。
3. 连接卡片底部 `上传 Schema Manifest` 仍保持 CTA 按钮样式。
4. 点击行内 `上传 Manifest` 后，Drawer 中不再出现可编辑文件名输入框。
5. Drawer 中展示默认文件名 `openclaw_db.yaml`，且节点具备 `translate="no"`、`notranslate`、`dir="ltr"`。
6. 选择本地 YAML 文件后，Drawer 展示所选原始文件名，但仍不可编辑。
7. 粘贴 YAML 源码上传时仍能自动校验并提交。
8. 上传请求仍包含 `filename`，服务端仍按 Connection + Schema 计算目标路径。
9. 连接级 Drawer 切换 Schema 后，目标路径、默认文件名与 YAML 示例同步更新到当前 Schema。
10. `/connections/whitelist` 不再提供独立 Schema Manifest 上传入口；跳转到 `/connections` 后复用本 Drawer。
11. 本页面不出现 table 级 `上传 semantic overlay` 入口。
12. 现有术语 lint 通过，不引入术语标准列出的禁用文案。

## 7. 测试要求

- 更新 `webui/src/__tests__/connection-overview.test.tsx`：
  - 断言行内 `上传 Manifest` / `维护白名单` 使用行内链接样式或不再带按钮视觉类。
  - 保留点击行内上传后锁定目标 Schema 的断言。
- 更新 `webui/src/__tests__/catalog-asset-upload.test.tsx`：
  - 断言 `catalog-asset-upload-filename` 不再是 input。
  - 断言默认文件名和选择文件后的文件名均只读展示。
  - 断言文件名展示具备翻译防御属性。
- 运行：
  - `cd webui && npm test -- connection-overview catalog-asset-upload`
  - `cd webui && npm run lint:terminology`

## 8. 风险与边界

| 风险 | 处理 |
|---|---|
| 用户误以为不可编辑文件名会影响扩展名校验 | 文件选择后展示原始文件名，校验面板继续反馈 `.yaml` / `.yml` 规则 |
| 直接粘贴 YAML 时没有真实文件名 | 使用 `<schema>.yaml` 作为默认文件名，只作为上传记录和扩展名校验输入 |
| 行内动作过轻导致可点击性下降 | 使用链接色、hover 下划线、focus ring 和光标反馈 |
| 与底部主 CTA 层级混淆 | 行内动作不使用按钮边框、底色或粗体，底部 CTA 保持按钮视觉 |
