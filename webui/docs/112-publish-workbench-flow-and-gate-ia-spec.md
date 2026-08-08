# Publish Workbench Flow and Gate IA Spec

> **修订（Spec 119，2026-08-07；Spec 121，2026-08-07）：** 首屏布局由「待发布变更 | 变更详情 | 发布门禁」三栏改为「待发布变更 | 发布门禁」双栏；**变更详情**下沉为按需 Drawer。详见 [`119-publish-workbench-queue-gate-ia-spec.md`](119-publish-workbench-queue-gate-ia-spec.md)。Header「发布并重建索引」不得打开上传 Drawer，见 [`121-publish-workbench-cta-confirm-spec.md`](121-publish-workbench-cta-confirm-spec.md)。本 Spec §5.1 Header / 步骤、§5.4 影响分流、§5.5 自动校验仍有效；§5.3 与验收「三栏标题」以 Spec 119 为准。

| 元数据 | 内容 |
|---|---|
| 文档名称 | Publish Workbench Flow and Gate IA Spec |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 用户批准的改善方案；`UX-PUBLISH-WORKBENCH-001`～`003`；浏览器证据 `docs/ui-ux-feedback/assets/publish-workbench/UX-PUBLISH-WORKBENCH-001-003.png`；Spec 35 |
| 适用范围 | `/publish/workbench` 发布流程可视、三栏角色、Header 动作收口、发布门禁；术语与 UI/UX 台账 |
| 输出位置 | `webui/docs/112-publish-workbench-flow-and-gate-ia-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 112 |
| 关联工单 | `webui/docs/plans/wo-202608-45-publish-workbench-flow-and-gate-ia.md` |
| 关联页面 | `/publish/workbench` |
| 关联台账 | `docs/ui-ux-feedback/pages/publish-workbench.md`（`UX-PUBLISH-WORKBENCH-001`～`003`） |
| 上游 Spec | Spec 35（语义发布 IA；本 Spec 修订其工作台 Header / 主布局 / 右栏契约，不改导航与「发布即索引」原则） |
| 状态 | Implemented |
| 日期 | 2026-08-06 |
| 范围 | 流程可视、三栏角色、Header ≤3 主动作、发布门禁、Schema/表影响分流 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.1 | 交叉引用 Spec 119：§5.3 三栏布局由队列–门禁双栏 + 变更详情 Drawer 取代 |
| v1.0 | 初稿并落地：发布门禁、三栏角色、Header 收口、影响分流 |

## 1. 背景

Spec 35 已把 `/review` 收敛为「语义发布 / 发布工作台」，并确立「发布即索引」。落地后首屏仍像工具箱：

1. 用户看不清「审阅 → 校验 → 发布」主路径（`UX-PUBLISH-WORKBENCH-001`）。
2. 三栏标题分别为「待发布变更 / 裸文件路径 / 变更影响范围」，角色割裂（`UX-PUBLISH-WORKBENCH-002`）。
3. PageHeader 同行 6 个动作（含多余「表目录」）过密（`UX-PUBLISH-WORKBENCH-003`）。
4. `_schema/*.yaml` 被当成表名进「影响 N 张表」，并出现「未在 Catalog 中」误导。

产品已批准改善方案：用发布流水线心智重排，不另开二级菜单。

## 2. 目标

1. 首屏可回答：主路径是什么、当前卡在哪一步、下一步点哪里。
2. 三栏稳定角色：**待发布变更 | 变更详情 | 发布门禁**。
3. Header 主组动作按状态 ≤3（另加最右导出辅助）；删除「表目录」。
4. Schema Manifest 与表 overlay 影响分流；禁止内部 status 码（如 `W`）裸露。
5. 同步术语、Spec 35 交叉引用、UI/UX 台账。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 不改导航（仍仅工作台 + 发布记录） | Spec 35 已定 |
| 不新增「索引生效」页 | 发布即索引 |
| 不在本页做语义编辑 | 归属 `/catalog` |
| 不改 Validate Gate / reindex API 契约 | 仅 UI/IA |
| 不做浏览器验证（本轮） | Vitest + terminology + build + code review |
| 不强制把强制重建做成危险确认 Modal | 保持一键兜底；仅位置下沉 |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`（§4.3 / 语义发布增补）。

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Publish Gate Panel | 发布门禁 | 变更影响范围（作唯一栏标题）、Validate Gate（作栏标题） | 主工作面审阅区（布局见 Spec 119） |
| Change Detail | 变更详情 | 裸路径作栏主标题；默认常驻最大栏 Diff | 按需 Drawer；路径为副信息（Spec 119） |
| Pending Changes | 待发布变更 | — | 左栏（沿用 Spec 35） |
| File Change Status | 已修改 / 新增 / 已删除 / 已重命名 / 已变更 | 状态：W、M、A（裸码） | 文件变更业务态 |
| Schema Manifest Impact | Schema Manifest 变更 | 把 `_schema` 文件算作「表」 | 影响区分栏 |
| Table Overlay Impact | 表语义变更 | — | overlay 影响表列表 |
| Publish Flow Steps | 审阅变更 → 校验 → 发布并重建索引 | 自拟四步以上流水线 | 轻量步骤指示 |
| Advanced Publish Actions | 高级 | — | 强制重建、边界检查、上传（有待发布时） |

Protected：`KTX`、`MCP`、`Agent`、`Schema Manifest`、文件路径、connection/schema/table 名、`YAML`。

## 5. 产品行为

### 5.1 主路径与步骤指示

右栏「发布门禁」顶部展示三步状态（轻量，非 wizard）：

```text
审阅变更 → 校验 → 发布并重建索引
```

| Gate | 步骤高亮 | 门禁说明（示例） |
|---|---|---|
| `empty` | 无待发布 | 可上传语义资产，或强制重建索引 |
| `pending` 且未跑校验 | 校验 | 下一步：校验变更 |
| `pending` 且校验失败 / 空结果 | 校验 | N 张未通过 / 无可校验对象，发布已阻断 |
| `ready` | 发布 | 校验已通过，可发布并重建索引 |

`发布并重建索引` 仍仅在 `ready` 时可作为可点击 primary（Header）；门禁区用文案说明，**不**再放第二颗 primary。

### 5.2 PageHeader 动作

Page description：

> 审阅待生效语义资产，校验通过后一键发布并重建索引。

**有待发布文件时** Header 主组：

```text
[校验变更] [发布并重建索引] … [导出当前快照 (.zip)]
```

**无待发布文件时** Header 主组：

```text
[上传语义资产] [强制重建索引] … [导出当前快照 (.zip)]
```

| 动作 | 有待发布 | 无待发布 | 备注 |
|---|---|---|---|
| 校验变更 | Header | 隐藏或 disabled 无意义 | 推荐下一步 |
| 发布并重建索引 | Header；非 ready 时 disabled | 可不展示或 disabled | 唯一 primary（仅 ready） |
| 上传语义资产 | 下沉「高级」 | Header | — |
| 强制重建索引 | 下沉「高级」 | Header | Spec 35 兜底仍可达 |
| 导出当前快照 (.zip) | 最右 ghost | 最右 ghost | 辅助 |
| 表目录 | **禁止** | **禁止** | 侧栏「语义资产」已覆盖 |

Badges 可保留：待发布文件数、校验通过/失败摘要（属工作流状态，非纯列表计数；与 Spec 91 一致）。

### 5.3 三栏布局

> **已由 Spec 119 修订：** 默认布局为「待发布变更 | 发布门禁」双栏；变更详情为按需 Drawer。下列 ASCII 仅保留为 Spec 112 历史契约，实现以 Spec 119 §5.1–5.2 为准。

```text
┌ 待发布变更 ┐  ┌ 发布门禁（主工作面）────────────────┐
│ 文件队列    │  │ 步骤 + 状态 + 影响 + 校验摘要        │
│ 点击开详情  │  │ 高级（重建/上传/边界）               │
└────────────┘  └─────────────────────────────────────┘
         → Drawer：变更详情（路径副标题 + Diff）
```

- Drawer 主标题固定「变更详情」；`filePath` 为副标题（`notranslate`）。
- 状态映射：`W`/`M`/`modified` → 已修改；`A`/`added` → 新增；`D`/`deleted` → 已删除；`R`/`renamed` → 已重命名；其它 → 已变更。
- 删除右栏「建议命令」`git diff` 块（仍有效）。
- 边界检查清单若存在，放入「高级」折叠，默认收起。

### 5.4 影响范围分流

对 `files[]` 分类：

| 路径形态 | 类型 | 展示 |
|---|---|---|
| `semantic-layer/<conn>/_schema/<schema>.yaml` | Schema Manifest | 「Schema Manifest 变更」列表：`conn/schema` |
| `semantic-layer/<conn>/<table>.yaml`（非 `_schema`） | 表 overlay | 「表语义变更」：可链 Catalog |
| 其它（wiki / 源码等） | 其它变更 | 可选摘要一行；不计入「影响 N 张表」 |

禁止把 Schema basename（如 `dataforai`）当作表名并标「未在 Catalog 中」。

### 5.5 进页校验引导

有待发布文件且本会话尚未产生校验结果时：

- 门禁明确写「下一步：校验变更」；
- **自动触发一次** `POST /api/validate-changed`（文件列表签名变化后可再触发；进行中防重入）。

失败表在门禁校验摘要中保留；有 Catalog 命中时提供对象深链（沿用既有 object detail search）。

### 5.6 与 Spec 35 的关系

本 Spec **修订** Spec 35 §6.1–6.3：

- Header 不再要求四按钮常驻同排；「强制重建索引」改为「空态 Header / 有变更时高级可达」。
- 主布局由「文件 | Diff + 松散右栏」改为「文件 | 变更详情 | 发布门禁」。
- 导出仍为辅助；「表目录」不得进入 Header。

不修订：导航、发布即索引、Validate Gate fail-closed、`/review` 重定向、发布记录范围。

## 6. API

无新后端端点。复用：

- `GET /api/diff`
- `POST /api/validate-changed`
- `POST /api/semantic-assets/reindex`
- `GET /api/sources`
- 既有 publish / export Drawer 与按钮

## 7. 验收标准

1. 有待发布时 Header 无「表目录」；主组可见「校验变更」「发布并重建索引」；导出为 ghost。
2. 无待发布时 Header 可见「上传语义资产」「强制重建索引」；强制重建可点。
3. 双栏标题为「待发布变更」「发布门禁」；「变更详情」仅在 Drawer（Spec 119）。
4. 中栏不展示裸 `状态：W`；Schema Manifest 不进表影响列表。
5. 门禁展示步骤与下一步说明；无 `git diff` 建议命令块。
6. 有待发布时进页自动校验一次；gate=ready 时发布 CTA 高亮可点；空 validate 结果仍 fail-closed。
7. Vitest `review.test.tsx` 绿；`lint:terminology`；`build`。
8. 台账 `UX-PUBLISH-WORKBENCH-001`～`003` → `Fixed`（本轮不做浏览器验证）。

## 8. Design System Compliance

- Referenced：`PageHeader`、`pl-btn` 层级、`pl-review-layout`、跨页 `header sibling nav redundancy` / `button hierarchy consistency` / `header action density`
- Follows：同组最多一 primary；辅助 ghost；侧栏兄弟入口不进 Header
- Exceptions：工作流 badges 保留（Spec 91 例外）
- Deviations：无
