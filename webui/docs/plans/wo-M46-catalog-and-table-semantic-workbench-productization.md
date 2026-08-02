# M46 Catalog And Table Semantic Workbench Productization Work Order

## Codex Prompt

请在 `/Users/forrest/Projects/project-lucy/webui` 中实现 M46：表目录与表语义资产工作台产品化。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/03-api-spec.md`
- `docs/06-navigation-ia.md`
- `docs/23-semantic-asset-publish-export-spec.md`
- `docs/24-yaml-delivery-runbook-spec.md`
- `docs/48-catalog-and-table-semantic-workbench-productization-spec.md`
- `src/app/App.tsx`
- `src/pages/Catalog.tsx`
- `src/pages/TableEditor.tsx`
- `src/components/RowMoreMenu.tsx`
- `src/app/app.css`

目标：

把 `表目录` 从根路径与冗余表格页，产品化为 `/catalog`；把单表页从手工录入表单，收敛为以 `导出 YAML -> Claude Code / Codex 完善 -> 导入 YAML -> 校验 -> 保存` 为主路径的表语义资产工作台。

## Scope

### Phase 1: Catalog

1. 新增 canonical route `/catalog`。
2. `/` redirect 到 `/catalog`。
3. 侧边栏 `表目录` 指向 `/catalog`。
4. Catalog PageHeader 删除：
   - `66 / 66 张表`
   - `业务 Wiki`
   - `审阅`
5. 筛选栏新增 `Connection`，放在 `Schema` 前。
6. `Schema` 选项随 `Connection` 联动。
7. 表格第一列只显示 `table`，不重复展示 `{schema}.{table}`。
8. 完整引用 `{conn}/{schema}/{table}` 放入 tooltip 或更多菜单 copy action。
9. 修复中等宽度布局：
   - `1024x768` 下不得 document 级横向滚动。
   - `结构`、`语义更新时间`、`操作` 不得竖排。
10. 移除 Catalog 表头 uppercase 视觉改写。

### Phase 2: Table Semantic Workbench

1. 新增 canonical route `/catalog/:conn/:schema/:table`。
2. 旧 `/sources/:conn/:schema/:table` redirect 到 canonical `/catalog/:conn/:schema/:table`，并保留 query/hash。
3. 面包屑改为：
   `表目录 / {Connection} / {Schema} / {table}`。
4. Header 聚焦当前表和主链路动作：
   - `导出 YAML`
   - `导入 YAML`
   - `校验`
   - `保存`
   - `粘贴 YAML` 作为导入补充路径，放在语义资产交换区内并默认折叠。
5. Header 删除固定按钮：
   - `业务 Wiki`
   - `关联关系`
   - `审阅`
6. 次要操作放更多菜单或区块内。
7. 候选关联默认折叠为低噪声 `待处理建议（n）`。
8. 表目录导航默认折叠到高级区，不抢占编辑主视觉。
9. 手工表单默认降级为 `高级：手工维护语义字段`，用户展开后再编辑。
10. 变更预览改为摘要优先，原始 Diff 折叠。

## Implementation Notes

### Routing

优先在 `src/app/App.tsx` 中添加新 route。

建议：

```tsx
<Route path="/" element={<Navigate to="/catalog" replace />} />
<Route path="/catalog" element={<Catalog />} />
<Route path="/catalog/:conn/:schema/:table" element={<TableEditor />} />
<Route path="/sources/:conn/:schema/:table" element={<SourceRouteRedirect />} />
```

实际实现如封装 redirect component，必须保留 params / query / hash。

### Catalog Filtering

在 `Catalog.tsx` 中增加：

```ts
const [connection, setConnection] = useState("all");
```

筛选顺序：

```txt
Connection -> Schema -> 状态 -> 搜索
```

Schema options 必须基于当前 Connection 派生。

### Catalog Table

第一列只显示：

```txt
kx_dim_company
```

不要再显示：

```txt
dataforai.kx_dim_company
```

完整引用可放：

- `title`
- 更多菜单 `复制完整引用`
- 详情页 breadcrumb

### Table Editor Positioning

`TableEditor.tsx` 当前内容较多。不要一次删除能力，应通过折叠、分组、默认隐藏来收敛。

推荐结构：

```txt
Header
  title: kx_dim_company
  context: mysql-aliyun / dataforai / partial
  actions: 导出 YAML / 导入 YAML / 校验 / 保存 / ...

Main
  语义资产交换
  变更摘要
  轻量修正

Collapsed / Secondary
  待处理建议
  高级手工编辑
  原始 Diff / YAML / Validate
  目录导航
```

### Change Preview

不要让 raw diff 成为唯一默认解释。

新增一个摘要模型可以先在前端从现有 diff / patch 状态推导；如果推导不可靠，再新增后端 dry-run summary。

最低验收：

- 表描述变更时，显示 `表描述：修改 1 处` 或等价文案。
- 展示影响文件数量和文件路径。
- 原始 Diff 仍可展开查看。

## Tests

新增或更新以下测试：

### Catalog

- `/` redirect 到 `/catalog`。
- 侧边栏 `表目录` 指向 `/catalog`。
- PageHeader 不显示 `66 / 66 张表`。
- PageHeader 不显示 `业务 Wiki`、`审阅`。
- `Connection` 筛选出现在 `Schema` 前。
- 切换 Connection 后 Schema 选项联动。
- 表名不重复展示 `{schema}.{table}`。
- 表头不会视觉 uppercase `Schema` / `Agent`。
- 表头使用 `Agent 引用`，显示 `/api/sources[].authorizedAgentCount`，含义是 data agent mcp 系统中的 Agent 引用 / 可见数量，不写成“授权 Agent”。

### Table Editor

- `/catalog/:conn/:schema/:table` 渲染 TableEditor。
- `/sources/:conn/:schema/:table` redirect 到 canonical `/catalog/:conn/:schema/:table`。
- Header 不显示固定 `业务 Wiki`、`关联关系`、`审阅`。
- Header 显示导出 / 导入 / 校验 / 保存主动作。
- 支持粘贴 Claude Code / Codex 返回的 YAML 并生成 dry-run 预览。
- 候选关联默认折叠，折叠态不展示长句“发现 x 个智能推断的候选关联关系”。
- 手工表单默认折叠在高级区。
- 原始 Diff 默认折叠。
- 变更摘要在表描述修改后出现。

### Visual / Layout

如现有测试栈支持 Playwright，补充或更新截图检查：

- `1440x900` Catalog 无页面级横向溢出。
- `1024x768` Catalog 无页面级横向溢出。
- `结构`、`语义更新时间`、`操作` 没有竖排。

## Validation

至少运行：

```bash
npm run lint:terminology
npm run lint:ia-boundary
npm test -- src/__tests__/catalog.test.tsx src/__tests__/table-editor.test.tsx
```

如果实际测试文件名不同，选择最相关测试，并在最终说明中列出实际命令。

浏览器验收：

- `http://localhost:5174/` 自动进入 `/catalog`。
- `http://localhost:5174/catalog` 可用。
- `http://localhost:5174/catalog/mysql-aliyun/dataforai/kx_dim_company` 可用。
- 旧 `http://localhost:5174/sources/mysql-aliyun/dataforai/kx_dim_company` 跳转到 `/catalog/mysql-aliyun/dataforai/kx_dim_company`。

## Acceptance Checklist

- [ ] `/catalog` 是表目录 canonical URL。
- [ ] `/` 不再直接承载 Catalog 页面。
- [ ] Catalog Header 无统计 badge 和跨模块 actions。
- [ ] Catalog 有 `Connection` 筛选。
- [ ] Catalog 使用 `Agent 引用`，不再显示 `授权 Agent`。
- [ ] Catalog 表名不重复。
- [ ] Catalog 中等宽度不横向撑出页面。
- [ ] 单表页是 Catalog 二级页面。
- [ ] 单表页 Header 主操作聚焦导出 / 导入 / 校验 / 保存。
- [ ] 单表页支持粘贴 YAML 生成导入 dry-run 预览。
- [ ] `业务 Wiki`、`审阅`、`关联关系` 不再固定占据 Header。
- [ ] 候选关联默认折叠。
- [ ] 手工表单默认折叠。
- [ ] 变更预览摘要优先。
- [ ] 原始 Diff 折叠但可访问。
- [ ] 术语 lint 通过。
- [ ] IA boundary lint 通过。

## Out Of Scope

- 不做在线 AI 生成语义。
- 不做 Owner。
- 不做看板 / 血缘 / 下游引用。
- 不改变 YAML 分层与保存安全边界。
