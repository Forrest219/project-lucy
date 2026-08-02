# Connection Overview Action Bar And Visual Noise Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection Overview Action Bar And Visual Noise Spec |
| 文档类型 | Product / UX / Frontend Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-31 |
| 关联页面 | `/connections` |
| 关联工单 | `webui/docs/plans/wo-M29-connection-overview-actionbar-visual-noise.md` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`, `webui/docs/27-connection-overview-ops-ux-cleanup-spec.md`, `webui/docs/28-catalog-reload-result-ops-ux-spec.md`, `webui/docs/31-connection-manifest-upload-affordance-spec.md` |

## 1. 背景

`/connections` 页面在 M27-M28 后已完成只读状态本地化、Schema 行内操作链接化、上传 Drawer 文件名只读展示等修复。人工视觉复核继续发现三个企业级 SaaS 细节问题：

1. `刷新本地目录` 位于连接卡片头部右下方，和连接身份信息、Schema 操作区都没有形成明确关系，看起来像悬空按钮。
2. `凭据：inline`、`已完成`、`1 个提示`、`缺失 Manifest` 同时以 Badge/Pill 高亮，造成状态色竞争。
3. 缺失 Manifest 诊断 sub-row 内的 `展开详情`、`复制路径`、`重新检查` 是可点击命令，但视觉上接近粗体文本，affordance 不足。

本规格聚焦 Connection 卡片内的操作内聚、状态色收敛和诊断微操作组件化。

## 2. 目标

- 将 Connection 级操作统一收拢到底部 Action Bar，消除头部悬空按钮。
- 建立 `/connections` 的状态色规则：成功信息不用框，警示只出现一次，失败/危险才使用强色。
- 让缺失 Manifest 诊断区的微操作具备明确按钮形态、hover/focus 状态和操作优先级。
- 删除 `/connections` 底部与当前模块无关的系统级资产包迁移提示。
- 保持现有 Schema Manifest 上传、Catalog reload、Add Schema、表白名单导航行为不变。

## 3. 非目标

- 不改变 `CatalogReloadButton` 的后端 API、请求参数或刷新结果模型。
- 不改变 Schema Manifest 上传 API、asset kind 或目标路径计算。
- 不新增或删除 Connection / Schema 管理能力。
- 不修改 `/review` 页面或系统级资产包导出能力。
- 不引入新的外部图标依赖；如现有项目无图标库，则使用现有 CSS/button 体系实现轻量图标或符号。

## 4. UX 要求

### 4.1 Connection Action Bar

Connection 卡片头部只展示身份与状态，不放卡片级操作按钮。

底部 Action Bar 统一承载 Connection 级和 Schema 级主操作，顺序如下：

| 顺序 | 操作 | 推荐视觉 |
|---|---|---|
| 1 | `+ 添加 Schema` | Secondary |
| 2 | `刷新本地目录` | Secondary 或 Ghost |
| 3 | `上传 Schema Manifest` | 存在缺失 Manifest 时 Primary，否则 Secondary |

Action Bar 必须和 Schema 表格视觉相连，但不放入表格内部。按钮在窄宽度下可以换行，但不能悬浮在头部空白区。

### 4.2 状态色收敛

Connection 卡片内状态色按以下规则使用：

- 成功信息不用框：`已完成` 不再渲染为 Badge/Pill。
- 数量摘要不用框：`3 张表`、`1 个提示` 进入一行 meta summary。
- 警示只出现一次：缺失 Manifest 时，保留 Schema 行的 `缺失 Manifest` warning Badge 作为主要视觉锚点。
- 凭据来源默认是 meta 信息：`凭据：inline` 降级为普通 meta 文本；如需提示风险，用 tooltip 或轻量文本色，不使用 warning pill。
- 失败或危险状态才使用强色：Catalog reload 失败、连接测试失败等错误状态仍可使用 danger 样式。

推荐状态摘要：

```text
本地目录已刷新 · 2026-07-31 14:30 · 3 张表 · 1 个提示
```

### 4.3 诊断微操作组件化

缺失 Manifest sub-row 的三个动作必须使用按钮组件，而不是纯文本：

| 操作 | 推荐样式 | 反馈 |
|---|---|---|
| `展开详情` | Ghost small button + chevron | 展开后文案变 `收起详情` |
| `复制路径` | Ghost small button + copy icon/text | 成功后文案变 `已复制` |
| `重新检查` | Secondary small button + refresh icon/text | 复用 Catalog reload pending/complete 反馈 |

按钮必须具备可见 hover、focus ring、disabled/pending 状态。窄宽度下按钮允许换行，但每个按钮文字不可拆字换行。

### 4.4 移除无关迁移提示

`/connections` 页面不再常驻展示：

```text
系统级资产包导出已迁移到 变更审阅 页面，仅在发布语义资产或交付运维包时使用，与 Connection 无关。
```

如需帮助用户寻找系统级资产包导出，应在 Help Center、系统手册或 `/review` 页面内说明，不占用 Connection Overview 主工作台。

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

Required UI terms:

| 概念 | UI 文案 |
|---|---|
| Connection 级刷新 | `刷新本地目录` |
| Add Schema | `添加 Schema` |
| Schema Manifest Upload | `上传 Schema Manifest` / `上传 Manifest` |
| Missing Manifest | `缺失 Manifest` |
| Review page | `变更审阅` |

DOM 防御要求：

- `Schema`、`Manifest`、`Schema Manifest`、`YAML`、`Connection` 必须按术语标准添加翻译防御。
- Connection id、Schema 名、Host、Database、文件路径必须添加 `translate="no"` 和 `notranslate`。
- 文件路径必须使用 LTR 展示，避免浏览器翻译或双向文本处理破坏。

## 6. 验收标准

1. `刷新本地目录` 不再出现在 Connection 卡片头部右侧。
2. Connection 卡片底部 Action Bar 按 `+ 添加 Schema`、`刷新本地目录`、`上传 Schema Manifest` 顺序展示。
3. 存在缺失 Manifest 时，`上传 Schema Manifest` 是底部 Action Bar 中视觉权重最高的 CTA。
4. `本地目录已刷新`、`已完成`、`3 张表`、`1 个提示` 渲染为同一条 meta summary，不再分别使用多个 Badge/Pill。
5. `凭据：inline` 不再使用 warning pill；仍保留凭据来源可见性和 tooltip。
6. Schema 表格中 `缺失 Manifest` 保留 warning Badge，作为唯一常驻 warning 锚点。
7. 缺失 Manifest sub-row 中 `展开详情`、`复制路径`、`重新检查` 都具备按钮视觉，不再像纯文本。
8. 诊断路径在 sub-row 中不会把单词或路径片段拆得难以阅读；必要时单行横向滚动。
9. `/connections` 底部不再展示系统级资产包导出迁移提示。
10. 术语 lint、IA boundary lint 和相关组件测试通过。

## 7. 测试要求

- 更新 `webui/src/__tests__/connection-overview.test.tsx`：
  - 断言 header actions 不再包含 `刷新本地目录`。
  - 断言 footer actions 中按顺序包含 `+ 添加 Schema`、`刷新本地目录`、`上传 Schema Manifest`。
  - 断言 Catalog reload summary 不再产生多个高亮 badge。
  - 断言凭据来源不再带 warning pill class。
  - 断言缺失 Manifest sub-row 的三个微操作是 small button 样式，且 `重新检查` 有 secondary 权重。
  - 断言系统级资产包导出迁移提示不存在。
- 运行：
  - `cd webui && npm test -- connection-overview`
  - `cd webui && npm run lint:terminology`
  - `cd webui && npm run build`

## 8. 风险与边界

| 风险 | 处理 |
|---|---|
| 降低 `凭据：inline` 高亮后，用户忽略凭据风险 | 保留文本与 tooltip；真正阻断性安全问题再使用 danger 状态 |
| 去掉 `1 个提示` Badge 后，提示入口不明显 | 缺失 Manifest 行保留唯一 warning Badge；summary 中保留提示数量 |
| 微操作按钮增加视觉重量 | `展开详情`、`复制路径` 使用 ghost small；只有 `重新检查` 使用 secondary small |
| Action Bar 按钮在窄屏拥挤 | 允许 flex wrap；按钮文字 nowrap，避免拆字 |
