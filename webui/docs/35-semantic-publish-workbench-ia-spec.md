# Semantic Publish Workbench IA Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Semantic Publish Workbench IA Spec |
| 文档类型 | Product / UX / Frontend / Backend Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-31 |
| 关联页面 | `/review` -> `/publish/workbench`, `/publish/history` |
| 关联工单 | `webui/docs/plans/wo-M32-semantic-publish-workbench-ia.md` |
| 事实源 | 用户截图：当前 `/review` 页面；用户设计输入：一级菜单改为 `语义发布`，二级菜单仅保留 `发布工作台` 与 `发布记录` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`, `webui/docs/06-navigation-ia.md`, `webui/docs/23-semantic-asset-publish-export-spec.md`, `webui/docs/24-yaml-delivery-runbook-spec.md`, `webui/docs/29-connection-semantic-boundary-automation-spec.md`, `docs/DEVELOPMENT.md` |

## 1. 背景

当前左侧导航存在一级模块 `审阅与校验`，二级菜单为 `变更审阅`。页面内部同时承载待发布文件 diff、`校验变更`、`重建 KTX 索引`、`上传语义资产`、导出全量资产包等动作。

从用户任务看，该模块的核心价值不是“审阅”或“校验”本身，而是让已经维护好的语义资产进入 Agent / MCP 可用状态。用户已经明确判断：

1. 一级菜单应改为 `语义发布`。
2. `待发布变更` 不应成为二级菜单，因为它只是发布工作台中的一个区域。
3. `索引生效` 不应成为二级菜单，因为产品原则是 **发布即索引**。
4. 离线导入/导出不是独立模块职责，应作为发布工作台或发布记录中的辅助动作。

本规格将 `/review` 收敛为 `语义发布` 模块，并拆成两个二级入口：`发布工作台` 与 `发布记录`。

## 2. 决策摘要

| 决策 | 说明 |
|---|---|
| 一级菜单改为 `语义发布` | 替换现有 `审阅与校验`，表达“让语义资产生效”的用户价值 |
| 二级菜单仅保留 2 个 | `发布工作台`、`发布记录` |
| 发布即索引 | 正常发布路径必须在发布后自动触发 `ktx admin reindex` |
| 不新增 `待发布变更` 菜单 | 待发布文件、diff、校验结果是 `发布工作台` 的内容区域 |
| 不新增 `索引生效` 菜单 | 索引是发布闭环，不制造独立心智 |
| 常驻手动 reindex | `强制重建索引` 作为发布工作台高级/兜底动作常驻，不隐藏 |
| 资产包降级为辅助动作 | `导出当前快照 (.zip)` 放在工作台或记录页右上角，不作为二级菜单 |
| `/review` 保持兼容 | 旧路由重定向到 `/publish/workbench`，避免历史链接失效 |
| v0.1 历史范围 | `发布记录` 仅记录 WebUI 发起的发布和强制重建索引；外部 CLI/Git 手动执行暂不强求回写 |
| v0.1 快照范围 | `导出当前快照 (.zip)` 统一导出系统当前时点的全量资产快照；历史版本快照留到 v0.2 |

## 3. 目标与非目标

### 3.1 目标

| 目标 | 说明 |
|---|---|
| 改善导航心智 | 用户从左侧导航即可理解该模块用于“发布语义资产” |
| 强化发布闭环 | 上传、校验、diff、发布、reindex 在同一工作台完成 |
| 让 reindex 可见 | 手动重建索引常驻，作为发布后补救或 CLI/Git 改动后的生效动作 |
| 增加发布历史 | 提供历史发布批次、reindex 状态、错误日志和快照入口 |
| 降低技术噪声 | 菜单名不使用 `reindex`、`diff`、`Validate changed` 等过程词 |
| 保持模块边界 | 不把数据库接入、语义层维护、业务文档的编辑职责搬进语义发布 |

### 3.2 非目标

| 非目标 | 理由 |
|---|---|
| 不在语义发布中编辑表语义 | 表语义编辑仍属于 `语义层维护 / 表目录` |
| 不在语义发布中新建数据库连接或 Schema | Connection、Schema、Schema Manifest 入口仍属于 `数据库接入` |
| 不在语义发布中编辑 Wiki 正文 | Wiki 维护仍属于 `业务文档 / Wiki 文档` |
| 不把资产包做成二级菜单 | 资产包是交付/迁移辅助动作，不是用户日常主路径 |
| 不改变 Catalog reload 语义 | `刷新本地目录` 仍只属于数据库接入，不等同于 reindex |
| 不运行 `ktx ingest` | 本模块只处理语义资产发布与 KTX 索引重建 |

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| 概念 | UI 主术语 | 英文辅助 | 禁止文案 |
|---|---|---|---|
| Semantic Publish module | `语义发布` | Semantic Publish | `审阅与校验` 作为左侧一级菜单 |
| Workbench page | `发布工作台` | Publish Workbench | `变更审阅` 作为主入口 |
| History page | `发布记录` | Publish History | `Reindex 历史` 作为导航主名 |
| Changed files area | `待发布变更` | Pending Changes | 作为二级菜单 |
| Validate action | `校验变更` | Validate Changes | `Validate changed` |
| Publish action | `发布并重建索引` | Publish and Reindex | `发布并 reindex` 作为主按钮 |
| Manual reindex | `强制重建索引` | Force Reindex | `索引生效` 作为二级菜单 |
| Snapshot export | `导出当前快照 (.zip)` | Export Snapshot | `资产包` 作为二级菜单 |

Browser translation defense is mandatory for:

- `KTX`、`MCP`、`Agent`、`Schema Manifest`、`Semantic Overlay`、`YAML`、`Reindex` 等专业英文术语。
- `semantic-layer/demo-mysql/_schema/dataforai.yaml`、`ktx.yaml`、`enabled_tables` 等文件名、路径和配置字段。
- connection、schema、source、table 名称，例如 `demo-mysql`、`dataforai`、`superstore_orders`。

## 5. Target Navigation

Target left navigation:

```text
语义发布
  发布工作台
  发布记录
```

Route contract:

| 页面 | Route | 说明 |
|---|---|---|
| 发布工作台 | `/publish/workbench` | 默认入口；承载当前 `/review` 的核心功能 |
| 发布记录 | `/publish/history` | WebUI 发起的历史发布批次、reindex 结果、当前快照入口 |
| 旧入口兼容 | `/review` | 自动重定向到 `/publish/workbench` |

Breadcrumb contract:

| 页面 | Breadcrumb |
|---|---|
| 发布工作台 | `语义发布 / 发布工作台` |
| 发布记录 | `语义发布 / 发布记录` |

## 6. 发布工作台

### 6.1 Page Header

Recommended copy:

```text
语义发布 / 发布工作台

发布工作台
查看并发布当前待生效的语义资产，系统将在发布后自动重建 KTX 索引。

[导出当前快照 (.zip)]
```

Header badges:

| Badge | 说明 |
|---|---|
| `3 个待发布文件` | 来自 `/api/diff` 的可发布文件数量 |
| `最近 reindex 成功` / `最近 reindex 失败` | 来自发布记录或手动 reindex sidecar |

### 6.2 Primary Actions

Action order:

```text
[校验变更] [强制重建索引] [上传语义资产] [发布并重建索引]
```

Required behavior:

| Action | Contract |
|---|---|
| `校验变更` | 调用现有 `/api/validate-changed`；展示每个 changed source 的 validate 结果 |
| `强制重建索引` | 调用 `/api/semantic-assets/reindex`；常驻显示；用于 CLI/Git 改动或发布后补救 |
| `上传语义资产` | 打开语义资产 Drawer；支持 YAML / zip / tar.gz；仅 Dry-Run 时不落盘 |
| `发布并重建索引` | 对已通过 validate gate 的发布批次执行 promote，然后自动 reindex；工作台内仅在 `pending files > 0` 且校验通过后高亮可用；Drawer 内作为提交主按钮 |

Primary/secondary weight:

- `发布并重建索引` 在 validate gate 通过后是最高权重主按钮；在没有待发布文件或校验未通过时不得作为可点击高亮 CTA。
- `SemanticAssetPublishDrawer` 内的 submit CTA 必须使用 `发布并重建索引`，并由 Drawer 的 dry-run / validate gate 控制可提交状态。
- `校验变更` 与 `上传语义资产` 是普通主动作。
- `强制重建索引` 是醒目但带兜底语义的动作，可使用 secondary/danger-aware 样式，避免被误认为日常第一步。
- `导出当前快照 (.zip)` 是 header 右侧辅助动作。

### 6.3 Main Layout

Desktop layout:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 待发布变更 (3 个文件)          [校验变更] [强制重建索引] [发布并重建索引] │
├───────────────────────────────┬──────────────────────────────────────────────┤
│ 文件列表                       │ 变更详情 / Diff                             │
│ semantic-layer/...             │ diff --git a/... b/...                      │
│ webui/config/...               │ --- a/...                                   │
│ wiki/...                       │ +++ b/...                                   │
└───────────────────────────────┴──────────────────────────────────────────────┘
```

Right-side status area:

```text
校验结果
- 2 张通过
- 1 张失败

KTX 索引
- reindex 完成，退出码 0
- 或 reindex 失败，退出码 2

建议命令
git diff
git status --short
```

Responsive behavior:

- Narrow screens stack: actions wrap, file list appears above diff.
- Button text must not overflow.
- The diff panel should keep stable width and scroll internally when needed.

### 6.4 Empty State

When there are no changed files:

```text
暂无待发布变更
你仍可以上传语义资产，或在已有 YAML 由 CLI/Git 更新后强制重建索引。
```

Required visible actions:

- `上传语义资产`
- `强制重建索引`
- `导出当前快照 (.zip)`

Do not hide manual reindex just because there are no changed files.
Do not show `发布并重建索引` as an enabled highlighted CTA when there are zero changed files.

## 7. 发布记录

### 7.1 Page Header

Recommended copy:

```text
语义发布 / 发布记录

发布历史与审计
查看历史发布批次、Reindex 执行结果及当前版本快照。
```

### 7.2 Table Contract

Table columns:

| Column | Source | Contract |
|---|---|---|
| `发布时间` | release `createdAt` | Use local time display; include tooltip or detail timestamp if needed |
| `触发方式` | release metadata | v0.1 renders WebUI-originated values: `WebUI 发布` / `WebUI 强制重建索引`; external `CLI/Git` rows are out of scope unless a future shared sidecar writes them |
| `操作人` | release `actor` | Existing actor if available; fallback `unknown` |
| `Reindex 状态` | release `status` + `reindex` | `成功` / `失败` / `进行中` / `未执行` |
| `动作/快照` | release id / export API | `查看 Diff`、`下载当前快照`、`查看错误`；v0.1 的下载始终导出当前时点全量资产快照 |

Example:

```text
┌──────────────────┬──────────┬───────────┬──────────────┬────────────────────────┐
│ 发布时间         │ 触发方式 │ 操作人    │ Reindex 状态 │ 动作/快照              │
├──────────────────┼──────────┼───────────┼──────────────┼────────────────────────┤
│ 2026-07-31 15:00 │ WebUI 发布 │ Admin     │ 成功         │ 查看 Diff / 下载当前快照│
│ 2026-07-31 12:10 │ WebUI 强制重建索引│ Admin │ 失败         │ 查看错误               │
└──────────────────┴──────────┴───────────┴──────────────┴────────────────────────┘
```

### 7.3 History Data Contract

Use existing release APIs where possible:

| API | Usage |
|---|---|
| `GET /api/semantic-assets/releases` | List release records |
| `GET /api/semantic-assets/releases/:id/status` | Poll active release status |
| `POST /api/semantic-assets/export` | Export current full snapshot in v0.1 |

If manual `强制重建索引` is triggered without a publish batch, it must create a lightweight history record or sidecar entry so `发布记录` can show the reindex result.

v0.1 history scope:

- Record actions triggered through WebUI, including normal publish and `强制重建索引`.
- Do not require external CLI/Git reindex commands to write back to WebUI history.
- Future v0.2 may introduce a shared sidecar or append-only audit log for external automation.

Minimum manual reindex history shape:

```ts
type ManualReindexHistoryRecord = {
  id: string;
  createdAt: string;
  trigger: "webui_manual_reindex";
  actor: string;
  reindex: {
    ok: boolean;
    exitCode: number;
    stdout?: string;
    stderr?: string;
  };
};
```

## 8. Backend Requirements

### 8.1 Publish Contract

Normal publish must remain fail-closed:

```text
upload / select asset
  -> validate
  -> promote to formal semantic-layer / wiki paths
  -> ktx admin reindex
  -> write publish history
```

Rules:

- Validate failure must block publish.
- Promote failure must block reindex.
- Reindex failure must not roll back promoted files, but must mark the release as failed.
- Publish response may return `reindexing`; UI must poll until terminal status.

### 8.2 Manual Reindex Contract

Manual reindex is allowed only as an explicit user action from `发布工作台`.

Rules:

- It must not upload, promote, or mutate YAML content.
- It must call `ktx admin reindex`.
- It must return stdout/stderr/exit code in a structured envelope.
- It must record a history entry visible in `发布记录`.
- It must not run concurrently with an active publish reindex unless backend already has a safe lock.

## 9. Migration Plan

| Current | Target |
|---|---|
| Sidebar group `审阅与校验` | `语义发布` |
| Sidebar item `变更审阅` | `发布工作台` |
| Route `/review` | Redirect to `/publish/workbench` |
| Current review page title `变更审阅与校验` | `发布工作台` |
| Button `校验变更` | Keep |
| Button `重建 KTX 索引` | Rename to `强制重建索引` |
| Button `上传语义资产` | Keep |
| Future publish submit | `发布并重建索引`；工作台内仅在 pending files 且校验通过后高亮可用；Drawer 内作为 submit CTA |
| New page | `/publish/history` -> `发布记录` |

## 10. Acceptance Criteria

1. Sidebar shows `语义发布` with exactly two second-level items: `发布工作台`, `发布记录`.
2. `/review` redirects to `/publish/workbench`.
3. `/publish/workbench` displays `上传语义资产`, `校验变更`, `强制重建索引`, and `导出当前快照 (.zip)` when there are zero changed files.
4. Publish path copy clearly states that publish automatically rebuilds KTX index.
5. `发布并重建索引` is highlighted/enabled on the workbench only when `pending files > 0` and validate gate has passed.
6. `SemanticAssetPublishDrawer` uses `发布并重建索引` as the submit CTA.
7. No user-visible `Validate changed`, `发布并 reindex`, or `审阅与校验` remains in the navigation or page header.
8. `强制重建索引` calls the backend reindex API and displays terminal success/failure.
9. `发布记录` lists WebUI-originated release and manual reindex history with reindex status.
10. Manual reindex creates a visible history record.
11. Asset package export is an auxiliary action, not a second-level navigation item.
12. Snapshot download exports the current full asset snapshot in v0.1; historical per-release snapshots are out of scope.
13. Terminology lint passes.

## 11. Resolved Decisions

| Question | Decision | Rationale |
|---|---|---|
| Q1: `发布并重建索引` button placement and visibility | Workbench: highlight/enable only when `pending files > 0` and validate gate has passed. Drawer: use as the submit CTA. | Follows fail-closed behavior and prevents accidental empty or unvalidated publish. |
| Q2: CLI/Git reindex history scope | v0.1 records only WebUI-triggered actions, including normal publish and `强制重建索引`. External CLI manual runs do not need to write back. | Keeps v0.1 scope small and preserves the CLI's lightweight, dependency-free operating model. |
| Q3: Snapshot download scope | v0.1 exports the current full asset snapshot only. Historical release snapshots are a v0.2 enhancement. | Historical snapshot archival requires storage and version management that should not block the P0 publish workflow. |
