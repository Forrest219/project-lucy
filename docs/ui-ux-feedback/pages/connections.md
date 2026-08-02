# /connections UI/UX Feedback

Route: `/connections`

本页记录连接概览页面的 UI/UX 反馈。后续浏览器核查应按条目 ID 定向执行 `Browser Check`。

## UX-CONNECTIONS-001: 表格统计列表头与数值未对齐

Status: Verified
Route: `/connections`
Area: Connection card schema table / `本地表数` and `启用表数`
Severity: P2
Reported: 2026-08-02

### Feedback
`本地表数`、`启用表数` 的列名和数值没有对齐在一列的位置。

### Evidence
- Screenshot: `../assets/connections/UX-CONNECTIONS-001.png`

### Expected
统计列表头与数值单元格使用一致的水平对齐；MySQL 和 StarRocks 两张 Connection 卡片应使用同一列模型，便于横向扫描。

### Browser Check
1. Open `/connections`.
2. Locate each Connection card schema table.
3. Verify `本地表数` and `启用表数` headers align with their numeric cells.
4. Verify MySQL and StarRocks cards keep the same column model.

### Notes
2026-08-02 已修复 CSS selector 优先级和列宽。
2026-08-02 浏览器复核通过：`本地表数` and `启用表数` headers and numeric cells are both right-aligned.

## UX-CONNECTIONS-002: `上传 Manifest` 行内动作视觉权重过高

Status: Verified
Route: `/connections`
Area: Connection card schema table / `操作`
Severity: P2
Reported: 2026-08-02

### Feedback
需要复核 `操作` 和 `上传 Manifest` 的字体大小与颜色设计，`上传 Manifest` 比较突兀。

### Evidence
- Screenshot: `../assets/connections/UX-CONNECTIONS-002-004-mysql.png`

### Expected
`上传 Manifest` 是缺失 Manifest 行的低权重行内动作，不应呈现为 Primary、Secondary 或高权重 ghost button；它应与 `维护启用范围`、`查看详情` 保持清晰但克制的行内链接层级。

### Browser Check
1. Open `/connections`.
2. Locate rows whose Manifest 状态 is `缺失 Manifest`.
3. Verify `上传 Manifest` is visually lighter than footer Primary actions.
4. Verify `上传 Manifest` does not dominate `查看详情` or make the `操作` column visually noisy.

### Notes
2026-08-02 已降低表格内 `.pl-row-action-link` 字重，并保留 muted detail action。
2026-08-02 浏览器复核通过：row actions are regular weight, and `查看详情` remains muted.

## UX-CONNECTIONS-003: 缺失 Manifest 详情区路径与动作布局突兀

Status: Verified
Route: `/connections`
Area: StarRocks `starrocks-r1` / Schema `ai` detail row
Severity: P2
Reported: 2026-08-02

### Feedback
点击 `starrocks-r1 / ai` 中的 `查看详情` 后，得到的路径及路径地址不在一行，且 `收起详情`、`复制路径`、`重新检查` 三个按钮的位置有点突兀。

### Evidence
- Screenshot: `../assets/connections/UX-CONNECTIONS-003.png`

### Expected
详情区应清晰分为问题说明、预期路径和动作区；路径应作为独立可复制信息展示，动作按钮应放在同一层级的稳定位置，不应夹在正文中造成视觉跳跃。

### Browser Check
1. Open `/connections`.
2. In the `starrocks-r1` card, locate Schema `ai`.
3. Click `查看详情`.
4. Verify the expected path is displayed as a distinct path row.
5. Verify `收起详情`, `复制路径`, and `重新检查` appear in a stable action group and do not interrupt the diagnostic copy.

### Notes
2026-08-02 已重排详情区结构：说明、预期路径和动作区分层展示。
2026-08-02 浏览器复核通过：`预期路径` is displayed as a distinct path row, and detail actions are grouped on the right.

## UX-CONNECTIONS-004: 多动作行撑高后 Schema 文本视觉上不居中

Status: Verified
Route: `/connections`
Area: MySQL `openclaw_db` and StarRocks `sandbox` rows
Severity: P3
Reported: 2026-08-02

### Feedback
MySQL 和 StarRocks 表格最后一行 `openclaw_db` 和 `sandbox` 没有在所在行的上下居中位置。

### Evidence
- Screenshot: `../assets/connections/UX-CONNECTIONS-002-004-mysql.png`
- Screenshot: `../assets/connections/UX-CONNECTIONS-004-005-starrocks.png`
- Screenshot: `../assets/connections/UX-CONNECTIONS-004-regression.png`

### Expected
Schema 名称、状态、统计数值和行内操作应在同一行高内视觉居中；行内操作不应因为换行显著撑高普通数据行。

### Browser Check
1. Open `/connections`.
2. Locate MySQL `openclaw_db` and StarRocks `sandbox`.
3. Verify each row keeps a stable row height.
4. Verify Schema text appears vertically centered relative to status, counts, and actions.

### Notes
2026-08-02 已加宽操作列并让行内动作尽量不换行，减少行高被操作列撑高的情况。
2026-08-02 浏览器复核通过：affected rows keep a stable row height and Schema text is vertically centered.
2026-08-02 用户截图反馈未通过：`openclaw_db` and `sandbox` last rows still look taller because the last row visually merges with spacing before the footer.
2026-08-02 已恢复 schema table 最后一行底边线，并收紧 body cell vertical padding；等待浏览器复核。

## UX-CONNECTIONS-005: 本地表数为 0 但启用表数大于 0 的统计语义不清

Status: Open
Route: `/connections`
Area: StarRocks `demo_finance` and `meta` rows
Severity: P2
Reported: 2026-08-02

### Feedback
StarRocks 出现矛盾统计：`demo_finance` 中本地表数是 `0`，但启用表数是 `1`。

### Evidence
- Screenshot: `../assets/connections/UX-CONNECTIONS-004-005-starrocks.png`

### Expected
当 `本地表数 = 0` 且 `启用表数 > 0` 时，页面应明确表达这是“enabled_tables 中有配置，但本地 Schema Manifest 未读取到表”的状态，而不是看起来像统计自相矛盾。

### Browser Check
1. Open `/connections`.
2. Locate the `starrocks-r1` card.
3. Check rows where `本地表数` is `0 张表` and `启用表数` is greater than `0 张表`.
4. Verify the UI provides an explanation, status hint, tooltip, or copy that clarifies the two counts come from different sources.
5. Verify the row still exposes the relevant repair action for missing Manifest.

### Notes
2026-08-02 API 只读核查显示 `enabledTables` includes `demo_finance.ads_finance_revenue_day` and `meta.*`, while `/api/connections/starrocks-r1/tables` returns `[]`. This is source-backed but needs clearer UI semantics.
2026-08-02 浏览器复核未通过：`demo_finance` and `meta` still show `本地表数 = 0 张表` with `启用表数 > 0 张表` without visible source-difference explanation in the table row.

## UX-CONNECTIONS-006: Schema 表格后两列视觉拥挤

Status: Verified
Route: `/connections`
Area: Connection card schema table / columns
Severity: P2
Reported: 2026-08-02

### Feedback
`Schema`、`Manifest 状态`、`本地表数`、`启用表数`、`操作` 的列宽不均匀，其中 `启用表数` 和 `操作` 都挤到一块了，建议均分，或部分均分。

### Evidence
- Screenshot: `../assets/connections/UX-CONNECTIONS-006-008-upload-drawer.png`

### Expected
统计列与操作列之间应有清晰分隔；`操作` 列要有足够宽度容纳 `上传 Manifest` 和 `查看详情`，不应贴近 `启用表数`。

### Browser Check
1. Open `/connections`.
2. Locate MySQL and StarRocks schema tables.
3. Verify `启用表数` and `操作` are visually separated.
4. Verify row actions fit in the operation column without crowding the count columns.

### Notes
2026-08-02 已调整列宽为 `24% / 22% / 15% / 15% / 24%`，并增加行内 action gap；等待浏览器复核。

## UX-CONNECTIONS-007: 上传 Drawer 说明信息重复

Status: Fixed
Route: `/connections`
Area: Schema Manifest upload Drawer
Severity: P3
Reported: 2026-08-02

### Feedback
点开 `上传 Manifest`，侧边栏中有冗余信息，比如左上角 `数据接入`，和最下面的提示语：`请选择 .yaml 文件或直接在下方粘贴 YAML 源码。提交前会自动校验。`

### Evidence
- Screenshot: `../assets/connections/UX-CONNECTIONS-006-008-upload-drawer.png`

### Expected
Drawer 标题应直接进入当前任务；底部 validation 区只展示状态或校验结果，不重复上方上传/粘贴规则。

### Browser Check
1. Open `/connections`.
2. Click a row-level `上传 Manifest`.
3. Verify the Drawer header no longer shows redundant `数据接入` eyebrow.
4. Verify the idle validation panel does not repeat file/paste instructions.
5. Verify real validating, success, warning, and error states still render.

### Notes
2026-08-02 已移除 catalog asset upload Drawer 的 `数据接入` eyebrow，并将 idle validation copy 改为 `等待校验。`；等待浏览器复核。

## UX-CONNECTIONS-008: 上传 Drawer `选择文件` 按钮不清晰

Status: Fixed
Route: `/connections`
Area: Schema Manifest upload Drawer / file dropzone
Severity: P2
Reported: 2026-08-02

### Feedback
点开 `上传 Manifest`，侧边栏中 `选择 .yaml / .yml 文件或拖入此处。选择文件` 的 `选择文件` 按钮不够清晰，混在了提示语中。

### Evidence
- Screenshot: `../assets/connections/UX-CONNECTIONS-006-008-upload-drawer.png`

### Expected
`选择文件` 应是明确的 secondary button，和上传说明文案形成清晰视觉层级。

### Browser Check
1. Open `/connections`.
2. Click a row-level `上传 Manifest`.
3. Locate the file dropzone.
4. Verify `选择文件` has visible button affordance: border, surface background, clear height, and distinct spacing from helper copy.
5. Verify selected filename state remains readable after choosing a file.

### Notes
2026-08-02 已将 `选择文件` 从 ghost small button 改为 bordered secondary action，并将 dropzone 文案改为 `拖入 .yaml / .yml 文件到此处。`；等待浏览器复核。

## UX-CONNECTIONS-009: 已有 Manifest 的 Schema 缺少查看、下载、重新上传入口

Status: Fixed
Route: `/connections`
Area: Connection card schema table / Manifest asset management
Severity: P1
Reported: 2026-08-02

### Feedback
`dataforai` 已经有 Manifest 文件，但用户需要在线查看、下载后重新编辑、再上传覆盖，这是合理的日常维护场景；当前前端只显示 `维护启用范围`，不支持 Manifest 文件管理。

### Evidence
- Browser check 2026-08-02: `demo-mysql / dataforai` 行状态为 `已存在`，操作区只有 `维护启用范围`；页面无 `查看 Manifest`、`下载`、`重新上传` 入口。

### Expected
已有 Manifest 的 Schema 行应提供 Manifest 资产管理入口：在线查看 YAML、下载当前文件、重新上传覆盖现有文件，同时保留启用表范围维护入口。

### Browser Check
1. Open `/connections`.
2. Locate `demo-mysql / dataforai`.
3. Verify the row shows `查看 Manifest`、`下载`、`重新上传`、`维护启用范围`.
4. Click `查看 Manifest`; verify the Drawer shows target path and read-only YAML source.
5. Click Drawer `下载`; verify a `.yaml` download starts.
6. Click Drawer `重新上传`; verify the upload Drawer title is `更新 dataforai 的 Schema Manifest` and the YAML textarea is prefilled.
7. Uploading from this path should overwrite the existing YAML and refresh the local catalog.

### Notes
2026-08-02 已新增受控 Manifest 读取接口和前端查看 Drawer；已有 Manifest 行新增查看、下载、重新上传动作，重新上传会预填当前 YAML 并以更新模式覆盖现有文件。等待 Docker 重建后的浏览器复核。

## UX-CONNECTIONS-010: Host / Database 与 Schema 表格列缺少对齐关系

Status: Fixed
Route: `/connections`
Area: Connection card header / metadata alignment
Severity: P2
Reported: 2026-08-02

### Feedback
`Host`、`Database` 应和下方 `Schema`、`Manifest 状态` 有更明确的对齐关系；当前 `Database` 飘在 `Manifest 状态` 和 `本地表数` 之间，视觉突兀。

### Evidence
- Browser check 2026-08-02: `Host` 起点与 `Schema` 列一致，但 `Database` 起点不对齐任何表格列。

### Expected
连接元信息应复用 schema 表格的列节奏：`Host` 从 `Schema` 列开始，`Database` 从 `Manifest 状态` 列开始，整体保持可扫描的企业后台信息网格。

### Browser Check
1. Open `/connections`.
2. Locate MySQL and StarRocks cards.
3. Verify `Host` starts at the same x-position as `Schema`.
4. Verify `Database` starts at the same x-position as `Manifest 状态`.
5. Verify long Host values still wrap inside the card.

### Notes
2026-08-02 已将 `Host / Database` 元信息改为与 schema 表格相同的五列比例 grid；等待浏览器复核。

## UX-CONNECTIONS-011: Connection header 缺少企业后台感和数据源识别图标

Status: Fixed
Route: `/connections`
Area: Connection card header / identity
Severity: P2
Reported: 2026-08-02

### Feedback
`MySQL demo-mysql`、`StarRocks starrocks-r1` 的组合一个是数据库类型、一个是数据连接名称，目前只是纯文本显示，不够优雅，不符合企业级 SaaS 产品后台设计。

### Evidence
- Browser check 2026-08-02: card 标题是小 badge 加粗连接名，缺少图标和主副层级。

### Expected
连接卡片应更像数据资产 identity block：左侧数据库图标，主标题为连接名，副标签为数据库类型；MySQL / StarRocks 使用克制的不同视觉 token。

### Browser Check
1. Open `/connections`.
2. Verify each connection card title has a database icon.
3. Verify the connection id is the main title.
4. Verify engine type such as `MySQL` / `StarRocks` is rendered as secondary metadata, not visually fused with the title.

### Notes
2026-08-02 已使用 `lucide-react` Database 图标重构连接标题，连接名作为主标题，数据库类型作为副标签，并按 engine 添加克制色彩 token；等待浏览器复核。

## UX-CONNECTIONS-012: `上次刷新` 文案未说明刷新对象

Status: Fixed
Route: `/connections`
Area: Connection card header / local catalog reload timestamp
Severity: P2
Reported: 2026-08-02

### Feedback
`上次刷新：2026-08-02 15:07` 中的“上次刷新”指代不清，需要明示刷新对象，并验证是否和后台一致。

### Evidence
- Browser + API check 2026-08-02:
  - `demo-mysql` 页面时间 `2026-07-31 17:30` 对应 `/api/catalog/reloads.lastByConnection.demo-mysql.startedAt = 2026-07-31T09:30:14.669Z`
  - `starrocks-r1` 页面时间 `2026-08-02 15:07` 对应 `/api/catalog/reloads.lastByConnection.starrocks-r1.startedAt = 2026-08-02T07:07:51.415Z`

### Expected
文案应明确为 `本地目录刷新`，并通过 tooltip/title 说明这是读取本地 YAML / Schema Manifest 后生成的 Catalog 快照时间，不会连接数据库。

### Browser Check
1. Open `/connections`.
2. Verify header timestamp label reads `本地目录刷新：`.
3. Verify the time matches `/api/catalog/reloads.lastByConnection[connectionId].startedAt` converted to Asia/Shanghai.
4. Verify hover title or browser title text explains it is a local YAML / Schema Manifest Catalog snapshot time and does not connect to the database.

### Notes
2026-08-02 已将 header timestamp 文案改为 `本地目录刷新：`，并将 `title` 改为包含后端 ISO 时间和 Catalog 快照来源说明；等待浏览器复核。

## UX-CONNECTIONS-013: `操作` 表头与行内操作未左对齐

Status: Fixed
Route: `/connections`
Area: Schema asset table / action column
Severity: P2
Reported: 2026-08-02

### Feedback
列名 `操作` 的位置不对，没有和 `查看 Manifest` 对齐。

### Evidence
- Browser check 2026-08-02: `操作` 表头与 action cell 对齐，但 `.pl-schema-asset-actions` 使用右对齐，导致 `查看 Manifest` 比表头右移约 `108px`。

### Expected
`操作` 表头和行内第一个操作的左边缘应一致，方便扫描每行可执行动作。

### Browser Check
1. Open `/connections`.
2. Locate a row with `查看 Manifest`.
3. Verify `操作` 表头左边缘和 `查看 Manifest` 左边缘对齐。
4. Verify missing Manifest rows的 `上传 Manifest` 也与 `操作` 表头左对齐。

### Notes
2026-08-02 已将 `.pl-schema-asset-actions` 从右对齐改为左对齐；等待浏览器复核。

## UX-CONNECTIONS-014: Manifest 查看抽屉混入 `维护启用范围` 次任务

Status: Fixed
Route: `/connections`
Area: Schema Manifest view Drawer / footer actions
Severity: P2
Reported: 2026-08-02

### Feedback
点击 `Manifest` 得到的侧边栏中 `维护启用范围` 按钮可能多余；侧边栏首要目标是查看或重新上传。

### Evidence
- Browser check 2026-08-02: Manifest 查看 Drawer footer 同时显示 `维护启用范围`、`下载`、`重新上传`。

### Expected
Manifest 查看 Drawer 只承载 Manifest 资产任务，保留 `下载` 和 `重新上传`；`维护启用范围` 留在 schema 行内入口。

### Browser Check
1. Open `/connections`.
2. Click `查看 Manifest`.
3. Verify Drawer footer only shows `下载` and `重新上传`.
4. Verify table row仍保留 `维护启用范围` 入口。

### Notes
2026-08-02 已从 Manifest 查看 Drawer 移除 `维护启用范围`；等待浏览器复核。

## UX-CONNECTIONS-015: Add Schema 抽屉首屏说明冗余

Status: Fixed
Route: `/connections`
Area: Add Schema Drawer / first step copy
Severity: P2
Reported: 2026-08-02

### Feedback
点击 `添加 Schema` 得到的侧边栏存在很多问题描述，需要全局检查是否冗余。

### Evidence
- Screenshot: `../assets/connections/UX-CONNECTIONS-015-add-schema-drawer.png`
- Browser check 2026-08-02: 首屏同时显示 `数据接入` eyebrow、标题说明、字段规则、MySQL helper、底部 `ktx connection test ... 不会扫描物理数据库` 说明。

### Expected
Add Schema 首屏只保留当前决策所需信息：标题、简短任务说明、Schema 命名规则、数据库类型 helper；连接测试和凭据说明在下一步或失败诊断中出现。

### Browser Check
1. Open `/connections`.
2. Click `+ 添加 Schema`.
3. Verify Drawer 不显示 `数据接入` eyebrow。
4. Verify标题下只保留一句简短说明：写入 `ktx.yaml`，下一步验证连接权限。
5. Verify首屏不再显示 `ktx connection test ...` 和 `不会扫描物理数据库` 的重复说明。

### Notes
2026-08-02 已移除 Add Schema Drawer 的 `数据接入` eyebrow 和底部重复连接测试说明，标题说明精简为一句；等待浏览器复核。

## UX-CONNECTIONS-016: 启用表范围页面 URL 仍使用 `whitelist`

Status: Verified
Route: `/connections/enabled-tables`（兼容 `/connections/whitelist`）
Area: Data access navigation / enabled table scope route
Severity: P2
Reported: 2026-08-02

### Feedback
页面定位已经是维护 `enabled_tables` 的启用表范围，但地址仍是 `/connections/whitelist`，后缀和当前产品语义不一致。

### Evidence
- Browser check 2026-08-02: 页面标题和导航为 `启用表范围`，但 URL 为 `/connections/whitelist`。

### Expected
正式导航和跨页入口使用语义更明确的 `/connections/enabled-tables`；旧 `/connections/whitelist` 保留兼容跳转，避免历史书签失效。

### Browser Check
1. Open `/connections`.
2. Click `维护启用范围` from a Schema row with local Manifest.
3. Verify the destination URL starts with `/connections/enabled-tables`.
4. Open `/connections/whitelist?schema=dataforai`.
5. Verify it redirects to `/connections/enabled-tables?schema=dataforai` and still renders `启用表范围`.

### Notes
2026-08-02 已新增 canonical route `/connections/enabled-tables`，旧 `/connections/whitelist` 做兼容重定向。
2026-08-02 浏览器复核通过：旧 URL 跳转到 `/connections/enabled-tables?schema=dataforai`，导航入口指向 canonical route。

## UX-CONNECTIONS-017: 启用表范围缺少连接筛选

Status: Verified
Route: `/connections/enabled-tables`
Area: Enabled table scope toolbar
Severity: P2
Reported: 2026-08-02

### Feedback
筛选器缺少数据库连接维度，用户无法直接筛选 `demo-mysql`、`starrocks-r1` 等连接。

### Evidence
- Browser check 2026-08-02: Toolbar 只有搜索和 `Schema 筛选`，没有 `连接筛选`。

### Expected
Toolbar 提供 `连接筛选`，选项包含 `全部连接` 和每个 connection id；选择连接后只展示该连接下的表范围和 Schema 选项。

### Browser Check
1. Open `/connections/enabled-tables`.
2. Verify toolbar shows `连接筛选`.
3. Select `demo-mysql`; verify only `demo-mysql` groups remain.
4. Select `starrocks-r1`; verify only `starrocks-r1` groups or its missing Manifest summary remain.
5. Verify `Schema 筛选` options follow the selected connection.

### Notes
2026-08-02 已新增连接筛选，并让 Schema 筛选按连接范围收窄。
2026-08-02 浏览器复核通过：`demo-mysql` 只展示 `dataforai/openclaw_db`，`starrocks-r1` 只展示 `ai/demo_finance/meta/sandbox`。

## UX-CONNECTIONS-018: 缺 Manifest Schema 在启用表范围页占用过多视觉面积

Status: Verified
Route: `/connections/enabled-tables`
Area: Missing Manifest diagnostics
Severity: P2
Reported: 2026-08-02

### Feedback
本页主要做表范围设计和选择；对于连 Manifest 都没有的 Schema，在这里完整展开诊断卡会把表选择主任务冲淡。

### Evidence
- Browser check 2026-08-02: `/connections/whitelist` 主体连续展示多个 `缺少 Manifest` 诊断卡，并提供路径、展开详情、复制路径和跳转动作。

### Expected
默认只展示紧凑汇总：多少个 Schema 缺少 Manifest，暂不可配置表范围，并引导去连接概览上传 Manifest；只有用户筛选到具体缺失 Schema 时才展示单条路径和修复入口。

### Browser Check
1. Open `/connections/enabled-tables`.
2. Verify缺 Manifest Schema 默认显示为一条汇总提示，而不是连续诊断卡列表。
3. Use `Schema 筛选` 选择一个缺 Manifest Schema.
4. Verify only that Schema shows a focused diagnostic with path, copy, details, and `去连接概览上传 Manifest`.
5. Verify upload仍不在启用表范围页内直接打开。

### Notes
2026-08-02 已将缺 Manifest 默认展示降为汇总提示，精确筛选时再展示单条详情。
2026-08-02 浏览器复核通过：默认仅显示 `5 个 Schema 缺少 Manifest` 汇总；筛选 `starrocks-r1 / ai` 后只显示单条详情且无本页上传按钮。

## UX-CONNECTIONS-019: 启用表范围页右上角重复提供刷新本地目录

Status: Verified
Route: `/connections/enabled-tables`
Area: Page header actions
Severity: P2
Reported: 2026-08-02

### Feedback
右上角 `刷新本地目录` 更像连接概览页面的本地 Catalog 状态维护动作，不是表范围选择页的核心动作。

### Evidence
- Browser check 2026-08-02: `/connections/whitelist` PageHeader 右上角有 `刷新本地目录`；`/connections` 每个 Connection 卡片也有同名动作，并展示刷新时间和 Manifest 状态。

### Expected
启用表范围页不显示手动 `刷新本地目录`；保存启用表范围后仍可自动刷新本地目录；手动刷新入口留在连接概览。

### Browser Check
1. Open `/connections/enabled-tables`.
2. Verify PageHeader does not show `刷新本地目录`.
3. Verify toolbar also does not show `刷新本地目录`.
4. Make and save a table-scope change.
5. Verify save still writes `enabled_tables` and surfaces save/reload completion feedback.

### Notes
2026-08-02 已移除启用表范围页手动刷新入口，保留保存后的自动 reload 流程。
2026-08-02 浏览器复核通过：启用表范围 PageHeader 和 toolbar 均无 `刷新本地目录`；连接概览仍保留每个 Connection 的刷新入口。为避免写入 `ktx.yaml`，浏览器复核未点击保存；保存后自动 reload 由 `table-whitelist.test.tsx` 覆盖。

## UX-CONNECTIONS-020: 全选和反选被藏在批量操作下拉里

Status: Verified
Route: `/connections/enabled-tables`
Area: Enabled table scope toolbar / batch actions
Severity: P3
Reported: 2026-08-02

### Feedback
`批量操作` 下拉里只有 `全选`、`反选`，当前空间足够，直接显示更清晰。

### Evidence
- Browser check 2026-08-02: 点击 `批量操作` 后菜单只包含 `全选` 和 `反选`。

### Expected
Toolbar 直接显示 `全选` 和 `反选` 两个按钮，作用于当前筛选结果；不再显示 `批量操作` 下拉。

### Browser Check
1. Open `/connections/enabled-tables`.
2. Verify toolbar directly shows `全选` and `反选`.
3. Verify `批量操作` text/dropdown is absent.
4. Filter to a subset of tables.
5. Click `全选` then `反选`; verify selection summary updates only for current filtered rows.

### Notes
2026-08-02 已将下拉改为直接按钮。
2026-08-02 浏览器复核通过：toolbar 直接显示 `全选` / `反选`，无 `批量操作` 下拉；筛选到 `demo-mysql / dataforai` 后，全选从 `1/3` 更新为 `3/3`，反选更新为 `0/3`。

## UX-CONNECTIONS-021: 启用表范围与语义资产表格网格实现不一致

Status: Fixed
Route: `/connections/enabled-tables`, `/catalog`
Area: Enabled table scope table grid, action column terminology
Severity: P2
Reported: 2026-08-02

### Feedback
`/connections/enabled-tables` 和 `/catalog` 的表格网格线肉眼看起来不一致；同类行内操作列在两页分别命名为 `动作` 和 `操作`。

### Evidence
- Cross-page browser check before fix found `/connections/enabled-tables` used `.pl-data-table`, while `/catalog` used `.pl-catalog-table`.
- Enabled table scope used final column header `动作`; Catalog used `操作`.
- Main record: [`UX-CATALOG-008`](catalog.md#ux-catalog-008-catalog-and-enabled-table-scope-grids-use-divergent-implementation).

### Expected
启用表范围与语义资产复用同一基础数据网格样式；同类行内操作列统一命名为 `操作`。

### Browser Check
1. Open `/connections/enabled-tables` and `/catalog`.
2. Verify both tables share the same base grid style.
3. Verify both final column headers read `操作`.
4. Verify row separators and action-cell alignment are visually consistent.

### Notes
2026-08-02 已在代码中将启用表范围和语义资产表格统一到 `pl-data-grid`，并将启用表范围列名 `动作` 改为 `操作`。本条为 Connections 台账交叉引用；详细证据与修复记录见 `UX-CATALOG-008`。修复当轮按用户约束未做浏览器复核，浏览器复核在 Docker 重建后补做。
2026-08-02 Docker 重建后浏览器复核通过：`/connections/enabled-tables` 与 `/catalog` 均使用共享 `pl-data-grid`，最后一列表头均为 `操作`，表头 letter spacing / padding 与行分隔线一致，action 相对表头左缩进均为 `12px`，且无横向溢出。
