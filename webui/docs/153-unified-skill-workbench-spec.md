# 统一 Skill 工作台 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 统一 Skill 工作台 Spec |
| 文档类型 | Spec |
| Spec 编号 | 153 |
| 版本 | v1.0 |
| 状态 | Implemented（共享 selector contract 受并行变更阻塞） |
| 日期 | 2026-09-27 |
| 上游 Spec | Spec 144、147、151；Wiki Spec 79、105 |
| 关联工单 | `webui/docs/plans/wo-202609-27-unified-skill-workbench.md` |
| 适用范围 | `/skills` 信息架构、编辑体验、保存预检与 Skill Admin API |

> 编号说明：批准计划拟使用 Spec 152；实施时工作区已有独立的 Spec 152（Catalog Connection → Schema 范围树），因此顺延为 153，避免覆盖并行工作。

## 1. 目标与原则

`/skills` 采用 Wiki 已验证的“左侧浏览器 + 右侧主工作区”模式，但不复制 Wiki 的文件治理和语义发布能力。默认入口是全量治理总览；Skill 详情为主区阅读态，编辑时使用结构化元数据与 Markdown 双栏，写入前必须完成只读预检。

## 2. 冻结范围

### 2.1 保留项

- 默认展示全量 Skill 治理总览，保留名称、域、状态、版本、角色授权和校验结果。
- 保留创建、编辑、状态变更和删除。
- `roles_allowed` 仍是授权事实源：`[]` 为无人可见，`["*"]` 为所有角色可见；进入通配授权必须二次确认。
- 更新、删除继续使用 `expected_version`；编辑时 `domain`、`name` 不可变。
- `published` 仅为 frontmatter 状态，不进入语义发布工作台。
- 已发布 Skill 的内容校验问题不阻止保存，但预检必须醒目披露。

### 2.2 复用 Wiki 的模式

- 左侧领域/Skill 浏览器；右侧总览、阅读或编辑主区。
- 阅读态优先；详情不再使用 Drawer。
- Markdown 源码与渲染预览双栏。
- 未保存修改状态、站内离开确认和 `beforeunload` 保护。
- 保存前预检与草稿版本绑定；列表摘要与详情懒加载。
- URL 恢复当前领域和 Skill。

### 2.3 不复制项

- 上传或替换文件、目录 CRUD、跨领域移动、身份重命名。
- 版本历史与恢复、模板选择器、Wiki 语义发布与索引管线。
- 移动窄屏专用布局。

## 3. URL 与页面状态

| URL | 状态 |
|---|---|
| `/skills` | 全量治理总览 |
| `/skills?domain=analysis` | 领域治理总览 |
| `/skills?skill=analysis/foo` | Skill 阅读态；领域由 Skill 自动确定 |
| `/skills?new=1` | 新建 Skill |
| `/skills?new=1&domain=analysis` | 新建并预填领域 |

编辑态是页面本地状态。取消编辑回到同一 Skill 阅读态；详情返回时进入所属领域总览。无效 `domain` 显示空领域总览；无效 `skill` 显示详情加载失败且保留左侧浏览器。

## 4. 线框

### 4.1 治理总览

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ 业务 Skill                                           [新建 Skill]          │
├──────────────────────┬─────────────────────────────────────────────────────┤
│ 搜索领域或 Skill     │ Skill 治理总览                                      │
│ [________________]   │ 全部领域 · 28 个 Skill                              │
│                      │ [搜索] [状态] [角色授权] [校验状态]                 │
│ ● 全部 Skill     28  │                                                     │
│ ▾ analysis        8  │ 名称       域        状态    版本   授权   校验     │
│   revenue-report     │ revenue…   analysis  已发布  1.3.0  3角色  通过     │
│   churn-insight      │ churn…     analysis  草稿    0.4.0  无人    2问题   │
│ ▸ operations      6  │ ...                                                 │
└──────────────────────┴─────────────────────────────────────────────────────┘
```

左栏约 260px、独立滚动。领域与 Skill 均为可聚焦按钮；表格行不承担隐式点击行为。搜索匹配名称、标题、领域和触发词；状态、授权范围、校验状态默认“全部”。

### 4.2 阅读态

```text
┌──────────────────────┬─────────────────────────────────────────────────────┐
│ 领域与 Skill 浏览器  │ revenue-report                         [编辑] [删除] │
│ ▾ analysis           │ analysis/revenue-report                              │
│   ● revenue-report   │ 已发布 · v1.3.0 · 授权 3 个角色 · 校验通过          │
│   churn-insight      │ 触发词：收入、营收分析                              │
│                      │ ┌───────────────────────────────┬───────────────┐   │
│                      │ │ 渲染后的 Markdown             │ 页内目录      │   │
│                      │ └───────────────────────────────┴───────────────┘   │
└──────────────────────┴─────────────────────────────────────────────────────┘
```

正文存在多个二、三级标题时显示页内目录；技术 URI、路径、字段名和角色 ID 必须防浏览器翻译。

### 4.3 编辑态与保存预检

```text
┌──────────────────────┬─────────────────────────────────────────────────────┐
│ 领域与 Skill 浏览器  │ revenue-report                 有未保存修改         │
│                      │                         [取消] [保存并预检]          │
│ ▾ analysis           │ ▸ 元数据与授权                                      │
│   ● revenue-report   │   已发布 · v1.3.0 · 3 个角色 · 校验通过              │
│                      │ ┌──────────────────┬────────────────────────────┐   │
│                      │ │ Markdown 源码    │ 渲染预览                   │   │
│                      │ └──────────────────┴────────────────────────────┘   │
└──────────────────────┴─────────────────────────────────────────────────────┘

┌──────────────────── 保存 Skill 前预检 ──────────────────────┐
│ 校验：2 个内容问题（允许保存）                              │
│ 状态：草稿 → 已发布                                         │
│ 授权：2 个角色 → 所有角色；预计影响 14 个角色、37 个 Agent  │
│ Diff …                                                      │
│ □ 我确认将授权给所有角色                 [返回编辑] [确认保存]│
└─────────────────────────────────────────────────────────────┘
```

新建时元数据区默认展开，编辑时默认折叠。结构化字段覆盖 `domain`、`name`、`title`、`description`、`version`、`status`、`roles_allowed`、`triggers`、`prerequisites.sources/measures/wiki_docs` 与 `eval_cases`。`Cmd/Ctrl+S` 只打开预检。

## 5. API 与数据契约

### 5.1 摘要与详情

- `GET /api/skills?includeContent=false` 返回治理摘要，不含 `content`、`raw`、`filePath`。
- `GET /api/skills` 暂时保持兼容，仍返回完整对象。
- `GET /api/skills/:domain/:name` 返回完整详情；前端选中后懒加载。

### 5.2 写入预检

- `POST /api/skills/preview`：预检创建。
- `POST /api/skills/:domain/:name/preview`：预检更新。
- 预检复用正式写入的序列化、路径、身份与版本校验，但不得写文件、写审计或刷新 Skill 缓存。
- 响应 `preview` 包含 `operation`、`uri`、`relativePath`、`proposedMarkdown`、`diff`、`validation`、`impact` 与 `expectedVersion`。
- `impact` 披露状态、角色集合、进入/退出通配符、受影响角色和 Agent 数。

`SkillValidationIssue` 增加稳定 `code`；`message` 使用中文，技术字段保留原文。

## 6. 核心流程（伪代码）

```text
load route:
  fetch summaries(includeContent=false)
  if skill selector exists:
    fetch exact detail lazily
    show read view
  else:
    apply domain/search/status/access/validation filters
    show governance overview

enter edit:
  baseline = normalize(detail)
  draft = clone(baseline)

navigate or cancel:
  if normalize(draft) != baseline:
    require discard confirmation
  continue only after confirmation

save shortcut or button:
  payload = serialize(draft)
  draftVersion = stableSerialize(payload)
  preview = POST preview(payload)
  if structural/path/identity/version error: remain in editor
  else show diff + validation + status/auth impact bound to draftVersion

confirm preview:
  require stableSerialize(currentDraft) == previewDraftVersion
  if preview.impact.enteredWildcard: require explicit acknowledgement
  POST or PUT existing write endpoint
  server rechecks expected_version and current filesystem state
  on success: invalidate summaries/detail, mark clean, show read view
```

## 7. 错误、脏数据与可访问性

- 结构错误、路径冲突、身份变化和版本冲突阻止预检或写入；内容校验问题只警告。
- 草稿变化立即关闭或作废旧预检。页面关闭使用 `beforeunload`；站内选择领域、Skill、新建、返回和取消均先确认放弃。
- 左侧节点、表格入口、折叠区和对话框全键盘可达；当前节点使用 `aria-current`，折叠区使用 `aria-expanded`；预检关闭后焦点返回“保存并预检”。

## 8. Acceptance

| ID | 断言 |
|---|---|
| SC-153-01 | `/skills` 默认全量总览；`domain` 与 `skill` 深链可恢复 |
| SC-153-02 | 摘要 API 不返回正文；详情只在选中后加载 |
| SC-153-03 | 详情与编辑在主工作区；无 Skill Drawer |
| SC-153-04 | 编辑覆盖全部结构化字段并提供 Markdown 双栏预览 |
| SC-153-05 | 所有离开路径保护未保存修改；快捷键不直接写盘 |
| SC-153-06 | 创建/更新预检无写入副作用，且披露 Diff、校验、状态和授权影响 |
| SC-153-07 | 通配授权未经预检确认不能保存；确认后正式接口仍执行版本检查 |
| SC-153-08 | 校验问题有稳定 code 和中文文案；技术内容具备翻译防御 |
| SC-153-09 | Skill 定向 Vitest、术语检查、selector contract、构建和桌面 Playwright 通过 |

## 9. Design System Compliance

- 页面结构遵循 `design-system/20-patterns-page-layout.md` 的工作台模式。
- 治理表格遵循 `design-system/11-components-data-grid.md`。
- 复用现有 `pl-editor-layout`、`pl-card`、按钮层级、状态 Badge、Dialog 与焦点样式；不新增视觉 token。
- 视觉方向为克制的高密度治理工作台，与 Wiki 同构但不逐像素复制。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- `Skill 治理总览`：`/skills` 默认主区。
- `保存并预检` / `保存 Skill 前预检`：只读预检动作与对话框，不等于发布。
- `Markdown 源码` / `渲染预览`：编辑双栏标签。
