# Table Whitelist Productization Follow-up Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Table Whitelist Productization Follow-up Spec |
| 文档类型 | Product / UX / API Safety Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-01 |
| 关联页面 | `/connections/whitelist` |
| 关联工单 | `webui/docs/plans/wo-M45-table-whitelist-productization-followup.md` |
| 浏览器复核记录 | `inbox/whitelist-page-browser-check-2026-08-01.md` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/03-api-spec.md`、`webui/docs/34-table-whitelist-catalog-reload-layout-stability-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 背景

`/connections/whitelist` 已完成第一轮产品化改版：单一表头、轻量 group header、Floating Dock、动作列统一为查看 / 编辑链接，并移除了动作列里的「加入白名单」按钮。

Docker 重建后浏览器复核显示主结构已生效，但用户继续反馈以下问题：

1. PageHeader 右上角 `/data/lucy` 无决策价值，占用注意力。
2. `批量操作` 与 `刷新本地目录` 都是可操作入口，但视觉样式不一致。
3. 搜索框偏短；横向空间足够，且 `批量操作` 更像作用于当前筛选结果的表格操作。
4. 状态列 `已纳入` 语义不直观。
5. 修改 checkbox 后状态显示 `待同步`，用户无法判断是待启用还是待禁用。
6. 只新增或移除 1 张表时，`YAML 预览` 出现约 80+ 行删除和 80+ 行新增，远超合理预期。
7. 保存成功后提示「保存不会自动刷新本地目录」，用户不理解为什么还要手动刷新。

本规格将这些反馈收敛为第二轮修复目标，重点不是视觉 polish，而是让「启用表范围」的编辑、预览、保存链路可理解、可验证、低噪音。

## 2. 目标

1. 移除低价值上下文，降低 PageHeader 噪音。
2. 将页面级动作与表格级批量操作分层。
3. 扩大搜索框，提高大表列表筛选效率。
4. 让状态文案直接表达当前保存态与语义完成态。
5. 让草稿态明确表达 `待启用` / `待禁用`。
6. 修复 `enabled_tables` dry-run diff 过大问题，使预览只展示合理的最小变更。
7. 明确保存后本地目录刷新策略，避免用户陷入「保存了还要刷新什么」的困惑。

## 3. 非目标

- 不改变 `enabled_tables` 的业务含义。
- 不改变进入语义层的表范围保存 API 路由。
- 不新增物理数据库扫描或远程数据库连接动作。
- 不在 `/connections/whitelist` 新增 Schema Manifest 上传能力；缺失 Manifest 仍跳转到连接概览。
- 不引入新的字段详情路由；`查看字段 ↗` 继续复用现有 `/sources/:conn/:schema/:table`，除非实现时已有稳定字段页。

## 4. UX 规格

### 4.1 PageHeader

移除 PageHeader badge 中的项目根路径 `/data/lucy`。

保留：

- 标题：`启用表范围`
- 描述：配置各连接进入语义层的表范围，并审阅保存前变更。
- PageHeader 右侧主动作：`刷新本地目录`

`刷新本地目录` 是页面级动作，继续放在 PageHeader 右侧。

### 4.2 表格工具区

工具区承担「当前表格视图」的筛选与批量操作，建议结构：

```text
[搜索框 360px] [Schema 筛选]                         已选 x/y 张表  [批量操作]
```

要求：

- 搜索框宽度从当前约 `182px` 扩大到约 `360px`，并在窄屏自然换行。
- `Schema 筛选` 保持当前语义。
- `已选 x/y 张表` 继续表示当前筛选结果内已启用表数，不表示临时多选。
- `批量操作` 放到工具区右侧，因为 `全选 / 反选` 作用于当前筛选结果。
- `批量操作` 与 `刷新本地目录` 都必须使用一致的按钮视觉系统；推荐：
  - `刷新本地目录`：secondary button，PageHeader action。
  - `批量操作`：secondary / ghost menu button，工具区 action。

### 4.3 状态列

状态列必须回答「这张表当前处于什么状态」。推荐状态文案：

| 状态 | 条件 | UI 文案 | 说明 |
|---|---|---|---|
| 语义完成 | `enabledPersisted === true` 且 `completion === "done"` | `已启用，语义完成` | 替代 `已纳入` |
| 待补语义 | `enabledPersisted === true` 且 `completion !== "done"` | `已启用，待补语义` | 保持现有直观表达 |
| 未启用 | `enabledPersisted === false` 且无草稿变更 | `未启用` | 保持现有表达 |
| 待启用 | `enabledPersisted === false` 且 `enabledDraft === true` | `待启用` | 替代 `待同步` |
| 待禁用 | `enabledPersisted === true` 且 `enabledDraft === false` | `待禁用` | 替代 `待同步` |

动作列在草稿态继续显示 `待保存`，但状态列不得再显示 `待同步`。

### 4.4 YAML 预览

`YAML 预览` 的首要任务是帮助用户确认本次会改哪些表，而不是暴露整份 YAML 的序列化噪音。

Drawer 顶部必须优先展示结构化摘要：

```text
Connection: poc-mysql-aliyun
启用表范围：5 -> 4
移除：
- data_agent_poc.forbidden_finance
```

完整 diff 可以保留，但必须满足：

- 对 1 张表新增或移除，diff 中的 added / removed 行应接近实际 `enabled_tables` 局部变化。
- 不允许因为 YAML parse -> JS object -> stringify 导致无关 connection、`schemas`、`driver`、`host` 等整块重排。
- 如短期内无法做到 YAML 原文局部 diff，Drawer 默认应折叠完整 diff，只展示结构化摘要，并标记「完整 YAML diff」为高级检查。

### 4.5 保存与本地目录刷新

保存 `enabled_tables` 后，用户需要清楚知道下一步是否还要操作。

推荐方案：

1. 保存成功后自动触发本地目录刷新。
2. 成功提示文案：

```text
启用表范围已保存，本地目录已刷新。
```

3. 如果刷新失败，保存仍然成功，但提示必须拆开：

```text
启用表范围已保存；本地目录刷新失败，请重试。
```

4. 如实现上暂不自动刷新，保存成功 Banner 必须包含明确 CTA `刷新本地目录`，不能只显示「保存不会自动刷新本地目录」。

## 5. API / 后端契约

### 5.1 enabled_tables dry-run diff

当前 `PUT /api/connections/:connId/enabled-tables` 使用 `parse(yamlText)` 生成 JS object 后 `stringify(config)`，会破坏原始 YAML key 顺序和块顺序，导致大面积 diff。

修复要求：

- 必须改为 YAML Document / AST 级局部 patch。
- 只修改目标 connection 下的 `enabled_tables` 节点。
- 保留 `ktx.yaml` 其它 connection、`schemas`、`driver`、`host`、注释、未知字段和顺序。
- `dryRun:true` 与 `dryRun:false` 必须使用同一份 proposed YAML 生成逻辑。
- `diff` 应基于原始 `yamlText` 与局部 patch 后文本。

验收示例：

| 操作 | 预期 diff |
|---|---|
| 新增 1 张表 | 只出现该表对应的新增行，最多包含必要上下文 |
| 移除 1 张表 | 只出现该表对应的删除行，最多包含必要上下文 |
| 同 connection 内调整多张表 | 只影响 `enabled_tables` 列表 |
| 多 connection 存在 | 未修改 connection 不应出现在 added / removed diff 行中 |

### 5.2 返回数据

现有返回保持兼容：

```ts
type EnabledTablesPreview = {
  diff: string;
  proposedYaml: string;
  oldEnabledTables: string[];
  newEnabledTables: string[];
};
```

可选新增字段（推荐）：

```ts
type EnabledTablesPreview = {
  diff: string;
  proposedYaml: string;
  oldEnabledTables: string[];
  newEnabledTables: string[];
  addedEnabledTables?: string[];
  removedEnabledTables?: string[];
};
```

前端可先本地计算新增 / 移除；后端新增字段时前端优先使用后端字段。

## 6. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- `待启用`：`启用表范围` 页面草稿态状态，表示保存后会加入 `enabled_tables`。
- `待禁用`：`启用表范围` 页面草稿态状态，表示保存后会从 `enabled_tables` 移除。
- `已启用，语义完成`：替代 `已纳入`，表示表已进入启用表范围且语义完成度为 done。

禁止文案：

- `已纳入`
- `待同步`
- `加入白名单`
- `白名单变更操作`
- `可加入白名单`

专业英文术语和路径必须继续使用 `notranslate` 与 `translate="no"`：

- `Schema`
- `Catalog`
- `YAML`
- `ktx.yaml`
- `enabled_tables`
- table / schema / connection id

## 7. 验收标准

### 7.1 浏览器验收

在 `http://localhost:5174/connections/whitelist` 验收：

- PageHeader 不显示 `/data/lucy`。
- PageHeader 右侧只保留 `刷新本地目录` 作为页面级主动作。
- 表格工具区搜索框明显变长，约为当前宽度 2 倍。
- `批量操作` 在工具区右侧，视觉样式与按钮系统一致。
- 状态列不出现 `已纳入`。
- 状态列不出现 `待同步`。
- 勾选未启用表后显示 `待启用`，动作列显示 `待保存`。
- 取消勾选已启用表后显示 `待禁用`，动作列显示 `待保存`。
- `YAML 预览` 对 1 张表新增 / 移除只展示最小合理 diff；无关 connection 不出现整块红绿重排。
- 保存成功后的提示不再写「保存不会自动刷新本地目录」作为终态说明；要么自动刷新，要么提供明确刷新 CTA。
- 放弃后 dirty 状态清空。

### 7.2 自动化验收

必须覆盖：

- TableWhitelist 状态文案映射。
- 批量操作位置从 PageHeader 移回 toolbar。
- PageHeader badge 移除 `/data/lucy`。
- enabled_tables API dry-run 对 1 张表新增 / 移除产生最小 diff。
- 保存成功后自动刷新或 CTA 行为。
- 术语 lint 与 IA boundary lint。

## 8. 风险与回滚

| 风险 | 说明 | 缓解 |
|---|---|---|
| YAML AST patch 破坏格式 | `ktx.yaml` 可能含注释、未知字段、特殊 quoting | 使用 `yaml` Document API，新增 round-trip 测试 |
| 自动刷新耗时 | 保存后刷新可能让用户等待更久 | 保存成功先落状态，再异步刷新并展示进度 |
| 批量操作回到 toolbar 后噪音变大 | 顶部工具区可能再次拥挤 | 搜索框、筛选、统计、批量操作使用稳定两区布局，窄屏换行 |
| 状态文案变更影响测试 | 旧测试断言 `已纳入` / `待同步` 失效 | 同步更新测试，禁止旧文案回归 |
