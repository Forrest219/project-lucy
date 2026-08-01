# wo-M44 Connection Overview Visual Simplification

> Codex / Claude Code 直投工单。执行前请阅读 `AGENTS.md`、`docs/DEVELOPMENT.md`、`webui/docs/00-product-terminology-standard.md` 和 `webui/docs/44-connection-overview-productization-spec.md` v0.2。

## 0. 背景

`/connections` 的 M44 v0.1 已完成按钮权重、Warning Banner、KeyValue 和 PageHeader pill 的第一轮修复。浏览器复核后，用户确认还需要继续收敛：

1. 移除 PageHeader 的 `工作目录：/data/lucy`。
2. 去掉外层 panel 与卡片双边框嵌套，但每张连接卡之间保留轻量间隔。
3. 每卡移除 `配置文件 ktx.yaml` 与 `凭据来源 file`；`file` 的解释不放在卡片里。
4. 刷新状态移到卡片 Header 右侧，只保留时间戳。
5. Schema 资产表新增 `启用表数`，并保证所有连接卡字段和列位置稳定对齐。
6. `维护白名单` 改为 `维护启用范围`。
7. `预期只读` 降低视觉权重。

## 1. 范围

### 1.1 主要修改文件

- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/pages/connections/MetricCard.tsx`（仅当 Catalog 状态 tone 需要微调）
- `webui/src/app/app.css`
- `webui/src/__tests__/connection-overview.test.tsx`
- `docs/qa/selector-contract.md`
- `docs/qa/lucy-webui-e2e-test-suite.md`
- `docs/qa/impact-map.json`

### 1.2 不做

- 不改 `/connections/whitelist` 页面布局。
- 不新增后端 API。
- 不新增依赖。
- 不改变 Schema Manifest 上传 Drawer 行为。
- 不改变 `readOnlyExpected` 的业务判定。

## 2. 实现步骤

### Step 1: Header 去冗余

- 从 `ConnectionOverview` 的 `PageHeader.description` 中移除工作目录行。
- 不向 `badges` slot 传入 `/data/lucy`。
- 保留一句说明文案。

验收：

- DOM 中 `/connections` 页面不出现 `工作目录：`。
- DOM 中 `/data/lucy` 不出现在 PageHeader。

### Step 2: 去掉外层 panel 双边框

- 将连接列表从 `pl-panel` 外壳中释放出来，或将该 section 改为无边框容器。
- Connection 卡自身保留轻量边框。
- `.pl-overview-grid` 或连接列表容器保留 12-16px gap。

验收：

- 页面不再出现外层大框包住所有连接卡。
- `poc-mysql-aliyun` 与 `mysql-aliyun` 之间仍有清晰间隔。

### Step 3: 简化连接属性

- 从每张卡移除 `配置文件` / `ktx.yaml`。
- 从每张卡移除 `凭据来源` / `file`。
- 卡片 Header 只保留 `Host` 和 `Database` 等连接差异项。
- 移除 KeyValue label 的 uppercase 样式，`Host` / `Database` 按原大小写展示。
- 给 `Host` / `Database` label 和 value 补齐 `translate="no"` 与 `notranslate`；value 保持 `dir="ltr"`。

说明：

- `file` 表示密码来源是 `ktx.yaml` 引用的本地 secret 文件，WebUI 不读取、不展示密码。该解释不在卡片逐条展示；如需要，可后续放 Help Center 或配置审计。

验收：

- 卡片内不出现 `配置文件`、`凭据来源`。
- 卡片内不出现单独的 `file` 凭据来源值。
- `Host` / `Database` 不显示为 `HOST` / `DATABASE`。

### Step 4: 移动刷新状态

- 成功刷新状态从卡片正文移到 Header 右侧。
- 文案仅保留时间戳：

```text
上次刷新：2026-08-01 22:32
```

- 不再展示 `已完成`、`6 张表`、`1 个提示`。
- 未刷新状态继续使用 Warning Banner，但不能同时显示旧状态行 `本地目录未刷新 · 尚未读取本地 YAML`。
- 失败状态靠近 Header 或刷新动作显示轻量 danger 文案。

验收：

- 卡片正文中 Schema 表上方不再出现成功刷新摘要。
- 成功卡 Header 右侧可见 `上次刷新：<timestamp>`。
- 未刷新卡只显示 Warning Banner，不重复旧状态行。

### Step 5: Schema 表列模型

- Schema 资产表列改为：
  - `Schema`
  - `Manifest 状态`
  - `本地表数`
  - `启用表数`
  - `操作`
- `启用表数` 从 `conn.enabledTables` 按 Schema 前缀计算：
  - `enabledTable` 形如 `<schema>.<table>` 时计入对应 Schema。
  - 如存在更完整的三段 ref，需保持与当前项目已有解析约定一致，避免误计。
- 表格使用固定列模型，确保每张连接卡列位置一致。
- 数字列使用一致对齐方式，推荐右对齐或 tabular nums。
- 缺失 Manifest 诊断 subrow `colSpan` 同步为 5。

验收：

- 每张卡表头都是同一列序。
- 多张 Connection 卡之间 `Manifest 状态`、`本地表数`、`启用表数`、`操作` 列位置一致。
- `启用表数` 与左侧导航 `启用表范围` 术语呼应。

### Step 6: 行内操作改名

- 将 schema 行内 `维护白名单` 改为 `维护启用范围`。
- 保持跳转目标 `/connections/whitelist?schema=...` 不变。
- 更新测试和 selector 文档中的文案约束。

验收：

- 页面不出现 `维护白名单`。
- schema 行出现 `维护启用范围`。

### Step 7: 只读提醒降权

- `预期只读` 不再使用强 pill badge。
- 改为标题旁轻量 meta 文本，或并入属性区 `访问模式：预期只读`。
- `readOnlyExpected === false` 可保留轻量 warning 文本，但不要使用强 pill。

验收：

- `预期只读` 不再具有明显 border + filled pill 视觉。
- 该提醒不抢过连接名、Warning Banner 或 Primary action。

## 3. 测试要求

更新 `webui/src/__tests__/connection-overview.test.tsx`：

- Header 不出现 `工作目录：` 和 `/data/lucy`。
- 卡片不出现 `配置文件` / `凭据来源` / 单独的 `file`。
- `Host` / `Database` label 原样大小写并具备翻译防御。
- 成功刷新状态在 Header 右侧，仅展示时间戳。
- 未刷新状态只展示 Warning Banner，不重复旧状态行。
- Schema 表包含 `启用表数`，多卡列模型一致。
- `维护启用范围` 替代 `维护白名单`。
- `预期只读` 不使用强 badge/pill class。
- Footer 仍只有 `+ 添加 Schema` 与 `刷新本地目录`，每卡最多一个 Primary。
- 缺失 Schema 行仍保留 `上传 Manifest` 并打开锁定 schema 的 Drawer。

运行：

```bash
cd webui
npx vitest run src/__tests__/connection-overview.test.tsx
npm run lint:terminology
npm run lint:ia-boundary
npm test
npm run e2e:selector-contract
npm run build
```

## 4. 浏览器复核

在 Docker 重建后打开 `http://localhost:5174/connections`，至少复核：

- 1280px 宽度首屏。
- 第一张有提示/缺失 Manifest 的连接卡。
- 第二张健康连接卡。
- 390px 或等价窄屏，确认没有新增由本改动导致的横向溢出。

复核清单：

- Header 无工作目录。
- 连接列表无外层大框，但卡间有间隔。
- 每卡无 `配置文件` / `凭据来源`。
- 成功刷新时间在 Header 右侧。
- Schema 表列稳定且含 `启用表数`。
- 行内操作为 `维护启用范围`。
- `预期只读` 降权。
- 控制台无 error/warning。

## 5. 交付说明

收尾时说明：

- 修改了哪些文件。
- 运行了哪些测试。
- 浏览器复核结果。
- 是否仍存在全局 AppShell 移动端侧栏溢出等非本工单问题。

---
_Plan by Codex · 2026-08-01_
