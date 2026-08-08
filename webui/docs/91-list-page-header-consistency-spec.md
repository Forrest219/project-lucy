# List Page Header Consistency Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | List Page Header Consistency Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 全站一级/二级 PageHeader 统一性检查（2026-08-05）；`webui/docs/42-page-header-standardization-spec.md`；`docs/ui-ux-feedback/README.md` §跨页面治理规则；Spec 88 / 89（访问治理 Header 样板） |
| 适用范围 | 语义发布、质量评测、配置审计、表语义编辑与系统手册页等页面头部统一性检查与收敛 |
| 输出位置 | `webui/docs/91-list-page-header-consistency-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 91 |
| 关联工单 | `webui/docs/plans/wo-202608-24-list-page-header-consistency.md` |
| 关联页面 | `/publish/history`、`/admin/config-audit`、`/eval/runs`、`/eval/cases`、`/eval/security-candidates`、`/catalog/:conn/:schema/:table`、`/help` |
| 关联台账 | `docs/ui-ux-feedback/pages/publish-history.md`（`UX-PUBLISH-HISTORY-006`～`007`）；`docs/ui-ux-feedback/pages/eval.md`（`UX-EVAL-001`～`003`）；`docs/ui-ux-feedback/pages/admin-config-audit.md`（`UX-ADMIN-CONFIG-AUDIT-001`）；`docs/ui-ux-feedback/pages/catalog.md`（`UX-CATALOG-027`）；`docs/ui-ux-feedback/pages/help.md`（`UX-HELP-001`） |
| 上游 Spec | Spec 42（PageHeader 契约）；Spec 85（发布记录表格）；Spec 88 / 89（访问治理 Header 样板） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |
| 范围 | 删列表纯计数 badges；标题与导航对齐；评测/安全候选容器与按钮体系；表编辑补 backAction；导出 actions 次级样式对齐；系统手册页头统一性纳入台账 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地 |

## 1. 背景

2026-08-05 全站 PageHeader 统一性检查发现：访问治理模块（Spec 87–89）已收敛为「标题 + 描述 + actions、无纯列表计数 badge」样板，但语义发布、质量评测、配置审计等历史/列表页仍在 `PageHeader.badges` 展示与表格或分页重复的「共 N 条」类文案，且存在标题与侧栏不一致、评测模块根容器与按钮体系分裂、表语义编辑缺返回入口等问题。

治理规则（`docs/ui-ux-feedback/README.md`）：**Header 只承载对象身份、位置上下文和关键状态；不得放低价值统计 chips。**

## 2. 目标

1. **删除纯列表计数 badges**（P1）：`/publish/history`、`/admin/config-audit`、`/eval/runs`；`/eval/cases` 仅删 case 数 badge，保留最近一次 Run 通过率摘要 badge。
2. **标题与导航对齐**（P2）：`/publish/history` H1 改 **发布记录**（与 `navigation.ts` 一致）。
3. **actions 样式对齐**（P2）：配置审计「导出 CSV」与发布记录导出同为 `pl-btn--secondary`；安全候选「抽取候选」改 `pl-btn pl-btn--primary`。
4. **容器与 IA 收敛**（P3）：评测列表/详情/编辑页根容器统一 `pl-page-stack`；安全候选去一级页 breadcrumbs、改 `pl-page-stack`。
5. **二级页返回入口**（P3）：表语义编辑补 `backAction`（‹ 返回语义资产 → `/catalog`）。

## 3. 非目标

- 不改 API 契约。
- 不调整 `/publish/workbench` 工作流状态 badges（待发布文件数 / 校验结果属状态，非纯列表计数）。
- 不调整 `/eval/monitor` 筛选上下文 badges。
- 不移动 `/admin/audit` Tab 到 Header actions（留后续 wave）。
- 不做浏览器验证。

## 4. Terminology Compliance

遵循 `webui/docs/00-product-terminology-standard.md`。

| 概念 | UI 文案 |
|---|---|
| 发布记录页 H1 | **发布记录**（与侧栏一致） |
| 表编辑返回 | **‹ 返回语义资产** |
| 列表计数 | 仅出现在表格空态、表尾或分页区，不出现在 PageHeader badges |

## 5. UI 变更

### 5.1 `/publish/history`

| 项 | 调整前 | 调整后 |
|---|---|---|
| title | 发布历史与审计 | **发布记录** |
| badges | `共 N 条记录` | **删除** |
| actions | 导出当前语义资产包 (.zip) secondary | **导出 CSV** secondary（Spec 113 修订；不再导出 ZIP） |

### 5.2 `/admin/config-audit`

| 项 | 调整前 | 调整后 |
|---|---|---|
| badges | `N 条记录` | **删除**（保留表格上方分页 `x–y / 共 N 条`） |
| actions | 导出 CSV ghost | **secondary** |

### 5.3 `/eval/runs`

| 项 | 调整前 | 调整后 |
|---|---|---|
| badges | `N / total 条` | **删除** |
| 根容器 | `grid gap-6` | `pl-page-stack` |

### 5.4 `/eval/cases`

| 项 | 调整前 | 调整后 |
|---|---|---|
| badges | `N 个 case` + Run 通过率 | **仅保留** Run 通过率 badge |
| 根容器 | `grid gap-6` | `pl-page-stack` |

### 5.5 `/eval/security-candidates`

| 项 | 调整前 | 调整后 |
|---|---|---|
| breadcrumbs | `["质量评测", "安全候选"]` | **删除** |
| 根容器 | `p-6` | `pl-page-stack` |
| 主按钮 | 裸 `rounded-md bg-primary` | `pl-btn pl-btn--primary` |

### 5.6 `/catalog/:conn/:schema/:table`

| 项 | 调整前 | 调整后 |
|---|---|---|
| backAction | 无 | **‹ 返回语义资产** → `/catalog` |

### 5.7 评测详情/编辑（随容器 wave）

`RunDetail`、`CaseEditor`、`NewToken` 根容器由 `grid gap-6` / `max-w-*` 改为 `pl-page-stack`（NewToken 保留 `max-w-xl` 内层约束）。

### 5.8 `/help`（检查纳入范围）

| 项 | 当前结论 | 后续动作 |
|---|---|---|
| 冗余计数 badge | 无（右上角为来源路径与更新时间） | 无 |
| Header 组件一致性 | 仍为 `HelpCenter.tsx` 手写 `pl-page-header`，未复用 `PageHeader` 组件 | 台账登记 `UX-HELP-001` 持续跟踪 |

## 6. 验收标准

1. 上述六路由 PageHeader 无纯列表计数 badge（cases 仅保留 Run 摘要 badge）。
2. `/publish/history` H1 为「发布记录」；测试与台账同步。
3. `ConfigAudit` 导出按钮 class 含 `pl-btn--secondary`。
4. `SecurityCandidates` 无面包屑；主按钮为 `pl-btn--primary`。
5. `TableEditor` 渲染 `backAction` 链接「返回语义资产」。
6. 评测相关页面根容器为 `pl-page-stack`。
7. `cd webui && npm test` 相关用例通过；`lint:terminology`、`build` 通过。
8. `/help` 已纳入检查范围并在台账留痕（本轮不做浏览器验证）。
9. UI/UX 台账对应条目 → `Fixed` 或 `Open`（按条目实际状态登记）。

## 7. 测试要求

- `publish-history.test.tsx`：标题改「发布记录」；断言无 `publish-history-count`。
- `admin-config-audit.test.tsx`：断言无 `page-header-badges`。
- `eval-cases.test.tsx` / 新增断言：runs/cases 无 count badge。
- `security-eval-candidates.test.tsx`：无面包屑；抽取按钮 `pl-btn--primary`。
- `table-editor.test.tsx`：断言存在「返回语义资产」链接。
