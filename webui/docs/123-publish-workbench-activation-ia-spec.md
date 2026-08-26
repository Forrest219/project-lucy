# Publish Workbench Activation IA Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Publish Workbench Activation IA Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-07 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 用户批准的「语义生效台」最终设计；否定 Spec 35 上传一站式；否定本页导出快照；Spec 119/121 |
| 适用范围 | `/publish/workbench` 定位为语义生效台：校验 + 同步索引；上传/导出移出本页 |
| 输出位置 | `webui/docs/123-publish-workbench-activation-ia-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 123 |
| 关联工单 | `webui/docs/plans/wo-202608-57-publish-workbench-activation-ia.md` |
| 关联页面 | `/publish/workbench` |
| 关联台账 | `docs/ui-ux-feedback/pages/publish-workbench.md`（`UX-PUBLISH-WORKBENCH-007`） |
| 上游 Spec | Spec 35（本 Spec **修订** §6.1–6.4 上传一站式与工作台导出）；112/119/121 |
| 状态 | Implemented |
| 日期 | 2026-08-07 |
| 范围 | 生效叙事与术语；去上传/去导出；整批同步文案；「更多」全量重建 `force:true`；双栏比例 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented：语义生效台 IA + 台账 Fixed |

## 1. 背景

用户否定 Spec 35「上传 + 校验 + 发布 + reindex 一站完成」：对 MCP **检索生效**实质是同步 KTX 索引；上传与「导出当前快照」与本页主路径无关，干扰操作。

本 Spec 将页面收成 **语义生效台**。

## 2. 目标

1. 主路径：磁盘已有变更 → 校验 → **同步索引并生效**。
2. 本页禁止「上传语义资产」「导出当前快照」。
3. 术语去「门禁」；队列写明整批同步、不可勾选。
4. 「更多」仅「全量重建索引」且 API `force: true`。
5. 双栏等高、宽度约 2:3。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 本 PR 为上传/导出另找 UI 落点 | 仅本页删除；Catalog 上传仍在；export API 保留 |
| 分文件多选 / 伪入队时长 | 索引整批生效；无真实队列 |
| 浏览器验证 | 用户约束；结束后 code review |
| 改 MCP / ktx 二进制 | 仅 WebUI IA |

## 4. Terminology Compliance

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Activation Prep Panel | 生效准备 | 发布门禁 | 右栏主工作面 |
| Sync Change List | 本次将同步的变更 | 待发布变更（作唯一栏标题时可并存副文） | 左栏；副文「本批一并同步，不可分文件勾选」 |
| Sync Index and Activate | 同步索引并生效 | 发布并重建索引（本页 Header/确认主 CTA） | 有变更时主按钮 |
| Sync Index | 同步索引 | — | 无变更时增量 reindex |
| Full Reindex | 全量重建索引 | 强制重建索引（作本页文案） | 更多菜单；`force:true` |
| Confirm Sync Drawer | 确认同步索引并生效 | 确认发布并重建索引；发布语义资产 | 确认侧栏 |

本页禁止：「上传语义资产」「导出当前快照」「发布语义资产」。

Protected：`KTX`、`MCP`、`Agent`、路径与表名。

## 5. 产品行为

### 5.1 PageHeader

说明：`审阅并校验语义与 Wiki 变更，同步索引后使其对 Agent 生效。`

| 状态 | 动作 |
|---|---|
| 有脏文件 | `[校验变更] [同步索引并生效] … [更多]` |
| 无脏文件 | `[同步索引] … [更多]` |

无上传、无导出。

### 5.2 双栏

- 左：`本次将同步的变更` +「本批一并同步 N 项（不可分文件勾选）」；点击打开 Diff Drawer。
- 右：`生效准备`；步骤「审阅 → 校验 → 同步索引」；影响摘要；校验摘要。
- 禁止栏内「高级」上传/强制重建/导出。
- CSS：`md/xl: grid-cols-[minmax(280px,2fr)_minmax(0,3fr)]`（或等价），两栏同高。

### 5.3 同步与确认

- gate≠ready：同步 CTA disabled。
- gate=ready：打开确认 Drawer → `POST /api/semantic-assets/reindex` `{force:false}`。
- 无脏文件「同步索引」：同 API `force:false`，可无确认。
- 更多「全量重建索引」：`{force:true}`；文案说明较慢。

### 5.4 修订 Spec 35

- §6.2 / §6.4：删除工作台上传与导出要求。
- 工作台定位改为生效台；上传归 Catalog 等入口；导出 UI 不在本页（API 可留）。

## 6. API

无新端点。复用 `validate-changed`、`reindex`（区分 force）。

## 7. 验收标准

1. 本页无「上传语义资产」「导出当前快照」。
2. 标题为「本次将同步的变更」「生效准备」；主 CTA「同步索引并生效」。
3. 整批文案可见；确认 Drawer 无选文件 UI。
4. 更多「全量重建索引」请求 `force:true`；日常同步 `force:false`。
5. Vitest `review.test.tsx`；`lint:terminology`；`build`。
6. 台账 `UX-PUBLISH-WORKBENCH-007` → Fixed。

## 8. Design System Compliance

- Referenced：PageHeader、pl-drawer、button hierarchy、Spec 119 双栏
- Follows：≤1 primary；上传/导出不进生效主叙事
- Exceptions：工作流 badges 可保留
- Deviations：无
