# UI/UX Feedback Ledger

本目录用于长期记录 WebUI 页面级 UI/UX 反馈，作为后续浏览器核查、回归检查和修复验收的稳定事实源。

## 目录结构

```text
docs/ui-ux-feedback/
  README.md
  pages/
    admin-agents.md
    catalog.md
    connections.md
    wiki.md
  assets/
    catalog/
    connections/
      UX-CONNECTIONS-001.png
    wiki/
```

## 使用规则

- 每个页面维护一个文档，放在 `pages/` 下。
- 每条反馈使用稳定 ID：`UX-<PAGE>-NNN`，例如 `UX-CONNECTIONS-001`。
- 新反馈只追加，不覆盖历史；若问题复现，用同一个 ID 更新状态和补充证据。
- 每条反馈必须包含 `Status`、`Route`、`Feedback`、`Expected`、`Browser Check`。
- 修复代码后将 `Status` 更新为 `Fixed`；浏览器复核通过后再更新为 `Verified`。
- 截图放在 `assets/<page>/`，文件名尽量和反馈 ID 对齐。
- 浏览器检测应优先读取对应条目的 `Browser Check`，不要依赖聊天记录回忆。

## 页面索引

| Page | Route | Ledger |
|---|---|---|
| Catalog / Semantic Asset | `/catalog`, `/catalog/:conn/:schema/:table` | [`pages/catalog.md`](pages/catalog.md) |
| Connections | `/connections`, `/connections/enabled-tables` | [`pages/connections.md`](pages/connections.md) |
| Business Wiki | `/wiki` | [`pages/wiki.md`](pages/wiki.md) |
| Agent Admin | `/admin/agents`, `/admin/roles` | [`pages/admin-agents.md`](pages/admin-agents.md) |

## 最近维护记录

| Date | Scope | Update |
|---|---|---|
| 2026-08-02 | Agent Admin `/admin/roles`, `/admin/roles/:roleId` | 根据 Role Admin UI/UX 反馈追加 `UX-ADMIN-AGENTS-005` 至 `UX-ADMIN-AGENTS-008`：Role 指标运维语义、筛选器业务口径、参考模板 / 待修复状态区分、模板创建心智降噪。M57 已落地并在 Docker 重建后完成浏览器复核，状态均为 `Verified`。 |
| 2026-08-02 | Business Wiki `/wiki` | Docker 重建后完成 M56 浏览器复核，`UX-WIKI-007`、`UX-WIKI-008`、`UX-WIKI-010` 至 `UX-WIKI-013` 更新为 `Verified`：顶层空目录、目录删除拦截、文档移动、下载作用域、上传创建 / 覆盖预检均通过。 |
| 2026-08-02 | Ledger governance | 根据 Agent Admin 反馈补充跨页面规则：对象关系指标必须说明统计口径；权限 / 能力数量必须绑定配置位置、允许范围和运行时生效边界。 |
| 2026-08-02 | Business Wiki `/wiki` | M56 follow-up 完成 code review 后修复 `UX-WIKI-008`、`UX-WIKI-010` 至 `UX-WIKI-013`，状态更新为 `Fixed`；本轮按用户要求只做非浏览器验证，待后续浏览器复核后再升级 `Verified`。 |
| 2026-08-02 | Agent Admin `/admin/agents`, `/admin/roles/demo_readonly` | Docker 重建后完成浏览器复核，`UX-ADMIN-AGENTS-001` 至 `UX-ADMIN-AGENTS-004` 更新为 `Verified`。 |
| 2026-08-02 | Business Wiki `/wiki` | Docker 重建后复核 `UX-WIKI-008` 至 `UX-WIKI-013`：`UX-WIKI-008` 专项检查仍失败并退回 `Open`；`UX-WIKI-010` 至 `UX-WIKI-012` 浏览器确认仍属实；`UX-WIKI-013` 完整上传流因当前浏览器 harness 无法设置本地文件，保留 `Open` 并标注待完整复核。 |
| 2026-08-02 | Agent Admin `/admin/agents` | 追加 `UX-ADMIN-AGENTS-001` 至 `UX-ADMIN-AGENTS-004`：usage-oriented metrics、role 可发现性、MCP 工具权限解释、demo smoke 文案清理。M55 已落地并完成 code review / 非浏览器验证，状态 `Fixed`，待浏览器复核。 |
| 2026-08-02 | Business Wiki `/wiki` | 根据用户后续反馈新增 `UX-WIKI-010` 至 `UX-WIKI-013`：目录删除、文档移动目录、下载作用域、上传目标可发现性 / 覆盖预检表达；状态均为 `Open`。同步修正 `UX-WIKI-008` 的 `Fixed` 备注表达。 |
| 2026-08-02 | Business Wiki `/wiki` | Docker 重建后完成 M53 浏览器复核，`UX-WIKI-009` 更新为 `Verified`：版本记录、历史预览、恢复预检、确认恢复和新增恢复记录均通过。 |
| 2026-08-02 | Business Wiki `/wiki` | 追加 `UX-WIKI-009`：Markdown 覆盖 / 编辑缺少版本记录与恢复能力；已落地 M53 spec/plan 和实现，状态 `Fixed`，待浏览器复核。 |
| 2026-08-02 | Catalog `/catalog/:conn/:schema/:table` | Docker 重建后完成 M52 浏览器复核，`UX-CATALOG-005`、`UX-CATALOG-010`、`UX-CATALOG-012` 至 `UX-CATALOG-016` 更新为 `Verified`。 |
| 2026-08-02 | Catalog `/catalog/:conn/:schema/:table` | M52 修订 `UX-CATALOG-005`、`UX-CATALOG-010`、`UX-CATALOG-012`，追加 `UX-CATALOG-013` 至 `UX-CATALOG-016`；状态 `Fixed`，按用户要求仅做 code review / lint / test / build，待浏览器复核。 |
| 2026-08-02 | Business Wiki `/wiki` | Docker 重建后复核 `UX-WIKI-007`：拆分动作、`global/<目录>` 空目录持久化、子目录和 scoped 新建文档通过；因顶层空目录预览与实际路径不一致，暂不升级 `Verified`，新增 `UX-WIKI-008` 为 `Open`。 |
| 2026-08-02 | Business Wiki `/wiki` | M51 已落地 `UX-WIKI-007`：新建目录 / 新建文档拆分，并支持空目录独立存在；状态更新为 `Fixed`，待后续浏览器复核后再升级 `Verified`。 |
| 2026-08-02 | Business Wiki `/wiki` | 初评曾决定暂不新增 `UX-WIKI-008`；后续浏览器复核发现顶层空目录路径不一致，已改为新增独立条目追踪。 |
| 2026-08-02 | Business Wiki `/wiki` | Docker 重建后完成浏览器复核，`UX-WIKI-001` 至 `UX-WIKI-006` 更新为 `Verified`。 |
| 2026-08-02 | Business Wiki `/wiki` | M50 将 `UX-WIKI-004`、`UX-WIKI-005`、`UX-WIKI-006` 更新为 `Fixed`；本轮按用户要求只做非浏览器验证与 code review，后续浏览器复核通过后再改为 `Verified`。 |

## 跨页面治理规则

- Header 只承载对象身份、位置上下文和关键状态；不得放低价值统计 chips 或页面功能说明。
- 同一视口内，同一个全局命令只能有一个主触发点；不得依赖 aria label 来补救可见命令重复。
- 辅助流程入口必须可发现，但不得挤占主任务首屏空间。
- Inspector / sticky status rail 只展示动态反馈；全局操作、变更预览和 raw detail 应进入独立命令面或详情面板。
- 生产 UI 不展示研发 spec 式说明文案；必要帮助使用短 label、tooltip、帮助入口或文档链接承载。
- 全局侧栏之外，页面主体内不得再引入视觉上等价的第二侧栏；局部导航优先使用 tabs、segmented controls 或紧凑切换器。
- 运维指标必须区分静态配置数量与真实使用观测；涉及时间窗的指标必须在 label 或 hint 中明确时间范围和数据来源。
- 涉及对象关系的指标必须说明统计口径和关系边界，例如 Agent 数、配置 Token、活跃 Token、调用次数分别按哪个实体聚合、是否去重、时间窗是什么。
- Metric label 不使用不解释的英文缩写；安全异常指标可以保留，但不得挤掉更高价值的近期使用信息。
- 低频、高责任配置页默认展示可服务状态、异常状态和审阅入口；不得把模板数量、复制入口或预设清单作为页面主心智。
- 筛选器选项必须表达用户要完成的业务 / 运维判断，不展示裸后端枚举值，如 `yaml`、`template`、`invalid`。
- 状态标签必须区分对象来源、异常状态和生命周期状态；`待修复` 不得替代 `已停用`，中性来源标签不得使用 danger 视觉。
- 配置复制 / 从模板创建必须进入明确的新建流程，并展示写入目标、diff / dry-run 和人工确认语义。
- 列表页中的配置引用（如 role id、Connection id、Schema id）应能导航到其事实源或详情页，不应只作为纯文本出现。
- 列表页不默认展开完整技术 scope；高噪声工具清单、raw 权限和 runtime 边界说明应进入详情页、Role 页或权限预览。
- 权限 / 能力数量（如 N 个工具、N 个源）只有在同时提供配置位置、允许范围和运行时生效边界时才作为主信息展示；否则应弱化为摘要，并提供查看详情入口。

## 工作流

1. 收到页面级 UI/UX 反馈后，先按页面追加到 `pages/<page>.md`，保留用户原始反馈摘要、截图和目标路由。
2. 若同一轮反馈包含多个可独立回归的问题，拆成多个稳定 ID；若多个现象共享同一修复，可在 `Notes` 交叉引用。
3. 浏览器核查时只记录事实，不把修复建议写成已验证结果；修复后但未做浏览器复核时，状态保持 `Fixed`。
4. 代码修复应在 `Notes` 写明主要文件和验证命令；如果用户明确要求不做浏览器验证，需要在 `Browser Check` 或 `Notes` 标注“待复核”。
5. 后续回归检查从 `Open` 和 `Fixed` 条目开始，`Verified` 条目只在相关页面大改或问题复现时重开。
6. 每轮修复完成后必须做一次非浏览器 code review；若未做浏览器复核，相关条目只能停在 `Fixed`，不得写成 `Verified`。

## Status

| Status | 含义 |
|---|---|
| `Open` | 已确认或待确认的问题，尚未修复 |
| `Fixed` | 已有代码修复，但尚未完成浏览器复核 |
| `Verified` | 已通过浏览器或人工验收复核 |
| `Won't Fix` | 经确认不修复，需在 Notes 说明原因 |

## 条目模板

```md
## UX-CONNECTIONS-001: 表格统计列对齐不一致

Status: Open
Route: /connections
Area: Connection card schema table
Severity: P2
Reported: 2026-08-02

### Feedback
用户原始反馈或问题摘要。

### Evidence
- Screenshot: ../assets/connections/UX-CONNECTIONS-001.png

### Expected
期望体验和验收口径。

### Browser Check
1. Open `/connections`.
2. Locate the affected area.
3. Verify the expected behavior.

### Notes
实现备注、PR、残余风险或待复核事项。
```
