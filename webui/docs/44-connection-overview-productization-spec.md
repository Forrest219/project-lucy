# Connection Overview Productization Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection Overview Productization Spec |
| 文档类型 | Product / UX / Frontend Spec |
| 版本 | v0.2 |
| 撰写日期 | 2026-08-01（v0.1 → v0.2） |
| 关联页面 | `/connections` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/25-connection-module-terminology-ia-refresh-spec.md`、`webui/docs/31-connection-manifest-upload-affordance-spec.md`、`webui/docs/32-connection-overview-actionbar-visual-noise-spec.md`、`webui/docs/42-page-header-standardization-spec.md` |
| 关联工单 | `webui/docs/plans/wo-M44-connection-overview-visual-simplification.md` |

## 1. 问题背景

`/connections` 已具备 Connection 状态、Schema Manifest 上传、本地目录刷新和启用表范围跳转等运维能力。v0.1 已解决“上传 Schema Manifest 被错误提升为卡片 Primary”的问题，但浏览器复核（参见 `inbox/connections-redesign/connections-1440.png` 等截图）后仍存在以下 7 条产品化缺口：

1. PageHeader 仍显示 `工作目录：/data/lucy`，对连接运维判断无帮助。
2. 页面外层 panel 与 Connection 卡片边框叠加，形成“盒子套盒子”的视觉噪音。
3. 每张卡重复展示 `配置文件 ktx.yaml` 与 `凭据来源 file`，其中 `file` 对用户语义不清，也不是连接之间关键差异。
4. `本地目录已刷新 · 时间 · 已完成 · 表数 · 提示` 混在卡片正文与 Schema 表格之间，和 `刷新本地目录` 动作割裂。
5. Schema 资产表缺少 `启用表数`，无法与侧边导航 `启用表范围` 形成直觉呼应；不同卡片列宽由内容驱动，跨卡比较时列位置漂移。
6. `维护白名单` 是历史治理术语，已不适合当前 `启用表范围` 设计体系。
7. `预期只读` 只是提醒，却以 pill badge 形式占据过强视觉权重。

补充项：v0.1 中 KeyValue 网格对 `Host` / `Database` label 应用 `uppercase` 样式，且 label 节点缺少浏览器翻译防御，需要在 v0.2 一并修正。

本规格在保留现有 API、Drawer 与本地 Catalog 工作流的前提下，继续收敛 `/connections` 的信息层级、卡片结构、表格字段和术语。

### 1.1 与历史规格的关系

本规格延续既有数据库接入边界和术语规则，但覆盖以下旧规则：

- `webui/docs/31-connection-manifest-upload-affordance-spec.md` 中“连接级上传按钮保持 Footer CTA”的要求；
- `webui/docs/32-connection-overview-actionbar-visual-noise-spec.md` 中“缺失 Manifest 时 Footer 上传为 Primary”以及 Footer 固定包含连接级上传的要求；
- v0.1 中 PageHeader 显示工作目录、每卡显示配置/凭据、正文显示完整刷新摘要、只读提醒使用强 pill 的设计。

覆盖后的规则是：缺失 Schema 行内保留 `上传 Manifest`，Footer 不再重复提供连接级上传；每张卡片的唯一 Primary 是 `刷新本地目录`；卡片只展示连接差异项和当前可操作状态。

## 2. 设计目标

- 让每张 Connection 卡片最多出现一个 Primary，并将高频、低风险的本地目录刷新设为稳定主动作。
- 移除 `/connections` Header 中的工作目录，减少与连接运维无关的上下文。
- 减少容器嵌套，保留卡片之间 12-16px 间距或等价分隔，形成轻量列表感。
- 卡片只展示连接之间有区分度的信息：Connection id、driver、Host、Database、本地目录刷新时间、Schema 资产状态。
- 将成功刷新状态移到卡片 Header 右侧，仅展示时间戳；数量与提示交给顶部指标和 Schema 表承载。
- 将 Schema 资产表固定列模型，并增加 `启用表数`，与 `启用表范围` 呼应。
- 将 `维护白名单` 改为 `维护启用范围`。
- 将 `预期只读` 降级为低显著提醒，不与 warning、danger 或 Primary 竞争。
- `Host` / `Database` 标签保持原大小写，具备浏览器翻译防御。
- 复用现有组件、数据请求与操作回调，不新增依赖，不改变后端契约。

## 3. 非目标

- 不新增或删除 Connection、Schema、本地 Catalog API。
- 不在本次改版中增加新的“测试连接”入口；既有兼容路由保持不变。
- 不改变 Schema Manifest 上传 Drawer、校验、目标路径计算或提交协议。
- 不修改 `/connections/whitelist` 页面布局或当前未提交工作。
- 不调整 Engine、只读状态的业务判定规则。
- 不新增 Actions 菜单组件或图标依赖。
- 不在每张 Connection 卡片中解释 `凭据来源 file`；该解释属于帮助文档、配置审计或连接详情说明，不是卡片主信息。

## 4. 交互与视觉规范

### 4.1 PageHeader

`/connections` PageHeader 只保留：

- H1：`连接概览`
- 说明：`维护每个连接的 Schema、YAML 资产与本地目录刷新状态。`

不得显示：

- `工作目录：/data/lucy`
- `/data/lucy` pill badge
- 其他与连接状态判断无关的运行环境上下文

如未来需要暴露工作目录，应放在系统概览、配置审计或 Help Center，不放在 Connection 日常运维页。`PageHeader` 的 `badges` slot 在 `/connections` 上不传递任何子节点；这与 `webui/docs/42-page-header-standardization-spec.md` 的 PageHeader 设计一致。

### 4.2 卡片容器与视觉分割

`/connections` 主体直接渲染 Connection 卡片列表，不再用外层 bordered panel 包裹全部卡片。

视觉规则：

- 每张 Connection 卡保留自身轻量边框或分隔线。
- Connection 卡之间保持 12-16px 垂直间距，保证“一丢丢”视觉分割。
- 不出现外层大框 + 内层卡片双边框嵌套。
- 卡片 header 可保留轻微 background tint，但不能再形成第三层明显容器。

### 4.3 Connection 卡片动作层级

每张 Connection 卡片最多一个 Primary：

| 位置 | 动作 | 视觉权重 | 说明 |
|---|---|---|---|
| Footer | `+ 添加 Schema` | Secondary | 配置扩展动作 |
| Footer | `刷新本地目录` | Primary | 稳定的高频主动作 |
| 未刷新 Warning Banner | `立即刷新` | Ghost / inline | 就地快捷动作，不与 Footer Primary 竞争 |
| 缺失 Schema 行 | `上传 Manifest` | 行内文字链接 | 只在需要补录的目标 Schema 上出现 |

约束：

- Footer 不再展示连接级 `上传 Schema Manifest`，避免与 Schema 行内入口重复。
- `上传 Manifest` 不使用 Primary、Secondary 或高权重 ghost button 视觉。
- `立即刷新` 复用本地目录刷新能力，不使用 `↗`、`→` 等外链符号。
- 点击任一刷新入口时，沿用既有 pending、成功、失败回调和 query cache 刷新机制。

### 4.4 Connection 属性

Connection 卡片 Header 只展示连接差异项：

| Label | Value |
|---|---|
| Host | `<host>:<port>` |
| Database | `<database>` |

不再逐卡展示：

- `配置文件 ktx.yaml`
- `凭据来源 file`

排版规则：

- Label 使用弱文本；Value 使用等宽字体与正文色。
- Value 不使用灰底、边框、pill 或 code badge。
- Host 容器必须 `min-width: 0`，并使用 `overflow-wrap: anywhere`；同时保留完整 `title`，不能撑破卡片。
- `Host`、`Database` 标签必须按大小写原样显示，不使用 CSS uppercase。
- `Host`、`Database`、路径、数据库名和 Connection id 必须具备浏览器翻译防御。

`凭据来源 file` 的解释：`file` 表示 `ktx.yaml` 中的连接密码来源是本地 secret 文件引用，WebUI 不读取、不展示密码值。该信息不应在每张连接卡上重复；需要解释时放在 Help Center、配置审计或连接详情说明中。

### 4.5 本地目录刷新状态

刷新状态属于 `刷新本地目录` 动作的结果，不应混在卡片正文正中间。

布局规则：

- 成功状态移至卡片 Header 右侧，靠近连接标题或只读提醒区域。
- 仅展示时间戳：

```text
上次刷新：2026-08-01 22:32
```

- 不展示 `已完成`、`6 张表`、`1 个提示` 等冗余摘要；本地目录刷新每次都是全量扫描，表数/提示由 Schema 资产表和顶部 Catalog 指标承载。
- 未刷新状态使用 4.6 Warning Banner；失败状态使用轻量 danger/alert 行，靠近刷新动作。
- 正文区域只保留 Schema 资产标题、表格和必要的缺失 Manifest 诊断。

### 4.6 未刷新 Warning Banner

当某个 Connection 尚无本地目录刷新记录，且当前未处于刷新中或刷新失败状态时，在 Schema 资产列表上方展示轻量 Banner：

```text
本地目录未刷新：尚未读取本地 YAML 资产配置。    立即刷新
```

视觉规则：

- 使用 warning soft 背景、轻量 warning 边框和 warning strong 文本；推荐语义接近 amber，而不是故障红。
- Banner 保持单行优先，窄屏允许文案与动作换行。
- 不使用大图标、强阴影或高饱和整块背景。
- `立即刷新` 是原地操作，不带外链符号。
- Banner 出现时，不再同时显示旧的普通状态行 `本地目录未刷新 · 尚未读取本地 YAML`，避免重复。
- 点击刷新后，pending 期间不重复展示静态“未刷新”提示；成功后 Banner 消失；失败时沿用既有 danger 状态摘要和重试主动作。

### 4.7 顶部 Catalog 指标

顶部 `Catalog 状态` 指标卡在以下状态增加轻量 warning tint 或顶部 warning 强调线：

- 尚未运行；
- 最近一次运行失败；
- 最近一次运行包含待处理 warning。

健康成功且无 warning 时保持普通指标卡样式，不额外增加绿色大面积背景。

### 4.8 Schema 资产表

Schema 资产表必须在每张 Connection 卡之间保持列字段和列位置稳定。

列定义：

| 列 | 说明 |
|---|---|
| `Schema` | Schema 名 |
| `Manifest 状态` | `已存在` / `缺失 Manifest` / `Manifest 解析失败` / `空 Manifest` |
| `本地表数` | 本地 Manifest / semantic-layer 中读取到的表数 |
| `启用表数` | `ktx.yaml enabled_tables` 中属于该 Schema 的表数 |
| `操作` | 行内低权重动作 |

视觉规则：

- 每张 Connection 卡使用相同列模型和稳定列宽；不能让不同卡片因为内容不同而列位置漂移。
- 数字列右对齐或统一 tabular-nums；表头和单元格对齐方式一致。
- 缺失 Manifest 诊断行可跨列展示，但不得破坏主表列宽。
- 表格标题使用 `关联 Schema 资产列表`；`Schema`、`Manifest` 等英文术语必须防翻译。
- `启用表数` 优先从 `conn.enabledTables` 按 Schema 前缀在前端计算，避免新增 API。

### 4.9 行内操作命名

`维护白名单` 已废弃。

新的行内跳转文案：

```text
维护启用范围
```

说明：

- 与侧边导航 `启用表范围` 保持一致。
- 避免使用 `白名单`，除非在安全治理文档中讨论 allowlist 概念。
- `上传 Manifest` 保持行内低权重动作，只在缺失目标 Schema 上出现。

### 4.10 只读提醒

`预期只读` 是提示信息，不是状态异常。

视觉规则：

- 不使用高显著 pill badge。
- 降级为标题旁轻量文本、灰色 meta，或并入连接属性：`访问模式：预期只读`。
- 不能与 warning、danger 或 Primary action 竞争视觉权重。
- 如果 `readOnlyExpected === false`，可使用轻量 warning 文本，但仍不使用强 pill。

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

Required UI terms:

| 概念 | UI 文案 |
|---|---|
| Connection Overview | `连接概览` |
| Add Schema | `添加 Schema` |
| Manifest repair | `上传 Manifest` |
| Catalog Reload | `刷新本地目录` |
| Catalog never run | `未运行` / `本地目录未刷新` |
| Local Catalog | `本地目录` / `本地 Catalog` |
| YAML Asset | `YAML 资产` |
| Enabled table scope | `启用表范围` / `维护启用范围` |

Deprecated UI terms:

| 旧文案 | 替代文案 |
|---|---|
| `维护白名单` | `维护启用范围` |
| `/connections` 上的 `工作目录：/data/lucy` | 移除 |
| `维护每个连接的 Schema、YAML 资产与本地目录刷新状态。` 之下的工作目录 pill | 移除；保留说明文案 |

浏览器翻译防御要求：

- `Schema`、`Manifest`、`Catalog`、`YAML`、`Host`、`Database`、`ktx.yaml` 必须在对应 DOM 节点同时设置 `translate="no"` 与 `notranslate`。
- Connection id、Schema 名、Host、Database、文件名和路径必须同时设置 `translate="no"` 与 `notranslate`。
- 路径、Host、Database 与文件名使用 `dir="ltr"` 或等价的稳定排版。
- 普通中文句子只保护其中的专业英文术语或代码值，避免无必要地阻止整段翻译。

## 6. 验收标准

1. `/connections` 首屏不再出现黑底 Primary 的 `上传 Schema Manifest`。
2. 每张 Connection 卡片最多一个 Primary，且该 Primary 为 `刷新本地目录`。
3. Footer 只保留 `+ 添加 Schema` 与 `刷新本地目录`；缺失 Schema 行仍保留 `上传 Manifest` 行内入口。
4. `/connections` PageHeader 不显示 `工作目录：/data/lucy`，也不显示 `/data/lucy` pill。
5. 主体不再出现外层大 panel 包裹所有连接卡；Connection 卡之间仍有 12-16px 间距或等价分隔。
6. Connection 属性只保留 `Host / Database` 等连接差异项；不再逐卡展示 `配置文件 ktx.yaml` 与 `凭据来源 file`。
7. 成功刷新状态移至卡片 Header 右侧，仅展示 `上次刷新：<timestamp>`；正文中不再出现 `已完成`、`6 张表`、`1 个提示` 等刷新摘要。
8. 尚未刷新本地目录的 Connection 在 Schema 列表上方展示 amber Warning Banner，文案为 `本地目录未刷新：尚未读取本地 YAML 资产配置。`，并提供无外链符号的 `立即刷新`；同一卡片不再重复显示旧状态行。
9. 顶部 `Catalog 状态` 在未运行、失败或有待处理 warning 时显示轻量 warning tint；健康成功时保持普通样式。
10. Schema 资产表列为 `Schema / Manifest 状态 / 本地表数 / 启用表数 / 操作`，每张 Connection 卡字段和列位置稳定对齐。
11. 行内跳转文案从 `维护白名单` 改为 `维护启用范围`。
12. `预期只读` 降级为低显著提醒，不再是强 pill badge。
13. `Host` / `Database` label 保持原大小写，具备浏览器翻译防御。
14. 长 Host 不撑破卡片，且悬停可查看完整值。
15. 现有 Schema Manifest 上传 Drawer、刷新回调、错误诊断和只读状态行为不回归。
16. 相关 Vitest、术语 lint、IA boundary lint、selector contract 和生产构建通过。
17. 在真实浏览器中完成正常态与未刷新态复核，并保留截图或明确的逐项复核记录。

## 7. 测试计划

### 7.1 组件测试

更新 `webui/src/__tests__/connection-overview.test.tsx`：

- 断言 `/connections` Header 不显示 `工作目录：` 或 `/data/lucy`。
- 断言 Connection 卡片不再逐卡显示 `配置文件` / `凭据来源`。
- 断言 Host/Database label 保持原大小写，并具备翻译防御属性。
- 断言长 Host 节点具有完整 title、LTR 和防溢出 class。
- 断言尚未刷新时出现 exact warning 文案与 `立即刷新`，且不重复显示旧状态行。
- 断言成功刷新状态在 Header 右侧，仅展示时间戳，不展示 `已完成` / 表数 / 提示数摘要。
- 断言 Schema 表包含 `启用表数`，并且多张卡表头列模型一致。
- 断言行内跳转文案为 `维护启用范围`，不出现 `维护白名单`。
- 断言 `预期只读` 不使用强 badge/pill class。
- 断言每卡最多一个 Primary，且 Footer 不再包含连接级上传。
- 保留缺失 Schema 行内上传和 Drawer 锁定 Schema 的既有测试。
- 执行 forbidden terms guard。

### 7.2 静态与构建检查

```bash
cd webui
npx vitest run src/__tests__/connection-overview.test.tsx
npm run lint:terminology
npm run lint:ia-boundary
npm test
npm run e2e:selector-contract
npm run build
```

### 7.3 浏览器复核

- 在 `http://localhost:5174/connections` 以 1440px 与 1280px 宽度检查正常态。
- 通过浏览器会话级 API route mock 复核未刷新状态，不写入后端或生产数据。
- 检查长 Host、按钮层级、Banner、Catalog 指标 tint、Header 无工作目录、卡片无双层方框、表格列对齐和窄屏换行。
- 截图落在仓库根目录 `inbox/` 临时目录。

## 8. 风险与边界

| 风险 | 处理 |
|---|---|
| Footer 移除连接级上传后，用户找不到补录入口 | 缺失 Manifest 的目标 Schema 行保留明确的 `上传 Manifest` 链接；先添加 Schema 后再补录 Manifest |
| Banner 与 Footer 同时可刷新造成动作重复 | Banner 使用轻量就地快捷动作；Footer 保持唯一 Primary，二者复用同一 mutation/cache 机制 |
| 移除凭据来源后用户不理解 `file` | `/connections` 不展示 `file`；需要解释时放到 Help Center、配置审计或连接详情说明 |
| 隐藏表数/提示数后用户找不到刷新结果 | 顶部 Catalog 指标和 Schema 资产表承载数量；卡片 Header 只展示刷新时间，降低重复 |
| 新增 `启用表数` 需要后端字段 | 优先前端从 `conn.enabledTables` 按 Schema 前缀计算，避免新增 API |
| 长 Host 抬高网格行高 | 优先保证完整可读与不溢出，允许按任意位置换行，并通过 title 提供完整值 |
| warning 颜色过强 | 使用既有 warning soft token 与轻量顶部强调，不使用 danger 红或大面积高饱和背景 |
| 共享 CSS 存在其他未提交工作 | 只修改 PageHeader、MetricCard、Connection 区域，编辑前后按文件局部 diff 复核，不触碰 TableWhitelist WIP |

---
_Spec by Claude (Coder) · v0.2 updated by Codex · 2026-08-01_
