# 工单 M1 · 基础壳与只读目录

> 先读 [README.md 总纲](README.md)。依赖：M0 完成。

## codex 直投 prompt
```
工作目录：/Users/forrest/Projects/project-lucy/webui。先读 docs/codex/README.md、docs/03-api-spec.md、docs/04-data-model.md。
任务：M1 项目读取 + 只读 Catalog/单表（见本工单）。这一里程碑只读不写。
约束：守全局护栏；/api/project 必须剥离 password；不返回 secrets。
完成后 npm test 贴结果，按 DoD 收尾，停下交回。
```

## 目标
读取真实 ktx 项目，做出可浏览/搜索/筛选的表目录与只读单表详情。**本里程碑不涉及任何写入。**

## 必读
`03-api-spec.md`（project/sources 端点）；`04-data-model.md §1-2,§4`（YAML 结构、TableModel、完成度）。

## 交付文件
```
server/project.ts          # 项目根解析 + ktx.yaml（剥 password）
server/semantic-layer.ts   # 扫描 + readSource（parseDocument→规范化）
server/completion.ts       # 纯函数完成度
server/model.ts            # 共享类型
src/lib/types.ts  src/lib/queryKeys.ts
src/pages/Catalog.tsx  src/pages/TableEditor.tsx(只读视图先行)
src/components/StatusBadge.tsx  src/components/YamlPreview.tsx
server/__tests__/{completion,semantic-layer.read}.test.ts
```

## 实现步骤
1. `project.ts`：解析根（`--project` > `KTX_PROJECT_ROOT` > 向上找 `ktx.yaml`），读连接/schema，**ConnectionInfo 不含 password 值**（只给 `passwordSource`）。→ `GET /api/project`。
2. `semantic-layer.ts`：
   - `listSources` 扫 `<conn>/_schema/*.yaml`，遍历 `tables{}`，逐表算摘要（columnCount/hasTableDesc/hasGrain/joinCount…）+ `completion`。→ `GET /api/sources`。
   - `readSource` 用 `parseDocument` 读单文件，抽 `tables[table]` 规范化为 `TableModel`，**保留 rawYaml 与未知键**。→ `GET /api/sources/:conn/:schema/:table`。
3. `completion.ts`：按 04 §4 四态，纯函数（validation_failed 由上层旁路合并，纯函数只算结构态）。
4. 前端 Catalog：表格列表 + connection/schema 过滤 + 表名/字段名搜索 + 完成度状态筛选；用 TanStack Query 拉 `/api/sources`。
5. TableEditor 先做**只读**：左导航 + 右 YAML preview（编辑表单留 M2）。

## 约束（重点）
- `descriptions` 渲染优先 `human` 回退 `ai`。
- 真实数据 3 表（`dataforai.superstore_orders` / `superstore_returns` / `superstore_people`）；按真实语义层展示，勿为凑数过滤；扫描结果可按文件 mtime 缓存。
- 严禁任何写操作；严禁返回 secrets。

## 自验
```bash
npm run dev
# Catalog 列出 20 表，能按 schema 过滤、搜 superstore_orders、按状态筛选
# 打开 superstore_orders 看到只读 YAML，无 password 泄漏
npm test   # completion 四态 + readSource 规范化用例绿
# password 断言：每个连接都不得含 password 字段（passwordSource 允许保留，不算泄漏）
curl -s localhost:5174/api/project | jq '[.data.connections[] | has("password")] | any | not'  # 期望 true
```

## DoD
总纲 §3 全项 + 列出 3 张 dataforai 真实表 + 单表只读可看 + `/api/project` 无 password 值。完成后**停下交回**。
