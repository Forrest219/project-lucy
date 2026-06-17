# KTX Local WebUI MVP 方案

## 目标

为当前 KTX 项目提供一个本地运行的语义补充工作台，降低直接手写 `semantic-layer/**/*.yaml` 和 `wiki/**/*.md` 的成本。

MVP 的核心目标：

1. 读取现有 KTX 项目文件。
2. 可视化浏览和编辑表语义。
3. 保存前展示 YAML/Markdown diff。
4. 保存后调用 KTX CLI 做校验。
5. 保持文件仍然是唯一事实源，方便 Git review。

整体流程：

```text
读取 semantic-layer / wiki
→ 表单编辑语义
→ 生成 YAML / Markdown
→ 展示 diff
→ 写回项目文件
→ 调用 ktx validate
→ 交给 Git diff / PR review
```

## 设计原则

- 文件优先：`semantic-layer/**/*.yaml` 和 `wiki/**/*.md` 仍然是 source of truth。
- 本地优先：只在本机运行，不依赖云端服务。
- 审核优先：任何写入前必须展示 diff。
- 安全写入：只允许写 `semantic-layer/`、`wiki/` 和 `.ktx-ui/`。
- 不碰敏感数据：不读取或展示 `.ktx/secrets/` 内容。
- 不污染扫描证据：不写 `raw-sources/`。
- 先服务 300 张表语义补充，不追求完整 BI 建模器。

## MVP 范围

第一版覆盖这些能力：

1. 表目录浏览、搜索、筛选。
2. 单表语义编辑。
3. 字段描述和字段属性编辑。
4. 指标 measures 编辑。
5. 常用过滤 segments 编辑。
6. join 关系编辑。
7. wiki 页面创建和编辑。
8. 文件级 diff 预览。
9. 调用 `ktx sl validate` 校验。
10. 展示本次修改文件列表。

暂不做：

- 用户登录和权限系统。
- 多人协同编辑。
- 云端部署。
- 自动创建 Git commit 或 PR。
- 任意 SQL 执行控制台。
- 复杂血缘图和拖拽建模。
- 完整版本历史系统，版本历史由 Git 负责。

## 推荐技术栈

```text
Frontend: React + Vite + TypeScript
UI: Tailwind CSS + shadcn/ui
Backend: Node.js + Fastify
YAML: yaml
Diff: diff / jsdiff
Validation: child_process 调用 ktx CLI
Storage: 直接读写当前项目文件
```

建议目录结构：

```text
webui/
  README.md
  package.json
  vite.config.ts
  tsconfig.json
  src/
    app/
    components/
    pages/
    lib/
  server/
    index.ts
    ktx.ts
    project.ts
    semantic-layer.ts
    wiki.ts
    diff.ts
```

## 页面设计

### 1. Table Catalog

表目录页，用作 300 张表的工作队列。

功能：

- 按 connection / schema 过滤。
- 按表名和字段名搜索。
- 按补充状态筛选：
  - 未开始
  - 部分完成
  - 已完成
  - 校验失败
- 展示每张表的关键状态：
  - 表名
  - 字段数
  - 是否有表描述
  - 是否有 grain
  - measures 数量
  - joins 数量
  - wiki 引用数量
  - validation 状态
  - 最近修改时间

### 2. Table Editor

单表语义编辑页。

布局：

```text
左侧：表和字段导航
中间：语义表单
右侧：YAML preview / diff
```

编辑项：

- 表描述。
- 业务域 tags。
- 行粒度 grain。
- 主键 / 自然键。
- 默认时间字段。
- 字段描述。
- 字段角色：
  - 普通字段
  - 时间字段
  - 维度字段
  - 指标原子字段
- 字段可见性：
  - public
  - internal
  - hidden
- measures：
  - name
  - expr
  - filter
  - description
- segments：
  - name
  - expr
  - description

保存流程：

```text
编辑表单
→ 生成 YAML
→ 展示 diff
→ 点击 Save
→ 写回 YAML
→ 自动 validate
```

### 3. Join Editor

关系编辑页。

功能：

- 展示当前 YAML 中的 joins。
- 基于字段名提示候选 join。
- 支持关系类型：
  - `many_to_one`
  - `one_to_many`
  - `one_to_one`
- 支持标记可信度：
  - confirmed
  - candidate
  - rejected

MVP 写入策略：

- 只有 confirmed join 写入 `semantic-layer/**/*.yaml`。
- candidate / rejected 先写入本地 sidecar：

```text
.ktx-ui/join-candidates.json
```

这样可以保留候选判断，又避免污染正式语义层。

### 4. Wiki Editor

业务口径编辑页。

功能：

- 列出 `wiki/**/*.md`。
- 创建 `wiki/global/*.md`。
- 编辑 frontmatter：
  - summary
  - tags
  - sl_refs
  - refs
  - usage_mode
- Markdown 正文编辑。
- 从表编辑页一键创建关联 wiki。

适合沉淀：

- 收入口径。
- 财务报表口径。
- 满意度 / NPS 口径。
- 测试数据排除规则。
- 数据异常说明。
- source of truth 说明。

### 5. Review & Validate

审核页。

功能：

- 展示本次修改过的文件。
- 文件级 diff。
- 一键运行校验：

```bash
ktx sl validate <table> --connection-id <connectionId>
```

其中 `<table>` 是 `ktx sl --connection-id <connectionId>` 列表中的短 `name`，例如 `accrual_demo`；不要传 `schema.table` 或 `connection/table`。

- 展示校验结果。
- 展示建议 Git 命令，但不自动提交：

```bash
git diff
git status
```

## 后端 API 草案

```text
GET  /api/project
GET  /api/sources
GET  /api/sources/:connectionId/:schema/:table
PUT  /api/sources/:connectionId/:schema/:table
POST /api/sources/:connectionId/:schema/:table/validate

GET  /api/wiki
GET  /api/wiki/:key
PUT  /api/wiki/:key

GET  /api/diff
POST /api/validate-changed
```

### API 说明

`GET /api/project`

返回当前 KTX 项目根目录、连接列表、schema 列表、本地 KTX 状态。

`GET /api/sources`

扫描 `semantic-layer/**/*.yaml`，返回表目录和完成度摘要。

`GET /api/sources/:connectionId/:schema/:table`

读取单个 semantic source，返回标准化 JSON 和原始 YAML。

`PUT /api/sources/:connectionId/:schema/:table`

接收标准化 JSON，转换成 YAML，展示或写回文件。

`POST /api/sources/:connectionId/:schema/:table/validate`

调用 KTX CLI 校验单个 source。

`GET /api/wiki`

扫描 `wiki/**/*.md`，返回 wiki 页面列表。

`PUT /api/wiki/:key`

写入 Markdown wiki 页面。

`GET /api/diff`

返回当前工作区中 WebUI 相关文件的 diff。

`POST /api/validate-changed`

对本次修改涉及的 semantic source 批量执行 validate。

## 内部数据模型

```ts
type SemanticSource = {
  connectionId: string
  schema: string
  tableName: string
  filePath: string
  qualifiedName?: string
  descriptions?: Record<string, string>
  grain?: string[]
  columns: Column[]
  measures?: Measure[]
  segments?: Segment[]
  joins?: Join[]
}

type Column = {
  name: string
  type: "string" | "number" | "time" | "boolean"
  pk?: boolean
  nullable?: boolean
  role?: "time" | "dimension" | "measure_source" // 暂只读/草稿，不落盘覆盖已有列
  visibility?: "public" | "internal" | "hidden"  // 当前 ktx overlay 不支持，暂不落盘
  descriptions?: Record<string, string>
}

type Measure = {
  name: string
  expr: string
  filter?: string
  description?: string
}

type Segment = {
  name: string
  expr: string
  description?: string
}

type Join = {
  to: string
  on: string
  relationship: "many_to_one" | "one_to_many" | "one_to_one"
  alias?: string
  source?: "formal" | "manual" | "candidate"
}
```

## 文件写入策略

允许写入：

```text
semantic-layer/
wiki/
.ktx-ui/
```

禁止写入：

```text
.ktx/secrets/
raw-sources/
.git/
```

保存规则：

1. 写入前生成 diff。
2. 用户确认后才写入。
3. 写入后运行 validate。
4. YAML 尽量保留已有 key 顺序。
5. 不删除未知字段。
6. 对 candidate 信息使用 `.ktx-ui/` sidecar，不写入正式 YAML。

## 完成度判断

每张表计算一个 completion status：

```text
未开始:
  无表描述，且无 grain，且无字段描述

部分完成:
  有表描述或 grain，但核心字段未描述

已完成:
  有表描述
  有 grain
  主键或自然键明确
  核心字段有描述
  常用 measures 或说明该表不需要 measures

校验失败:
  ktx sl validate 失败
```

## 验收标准

第一版通过以下标准即可验收：

1. 能读取当前项目的 semantic sources。
2. 能承载未来 300 张表目录。
3. 能搜索、筛选、打开单表。
4. 能编辑表描述、grain、字段描述、measures、segments、joins；`role/visibility` 暂只读或草稿，不落盘。
5. 能保存回 YAML。
6. 保存前能显示 diff。
7. 保存后能调用 `ktx sl validate`。
8. 能创建和编辑 `wiki/global/*.md`。
9. 不读取或展示 `.ktx/secrets`。
10. 不写入 `raw-sources`。
11. Git diff 可以清楚看到 WebUI 改动。

## 实施里程碑

### Milestone 1: 基础壳和只读目录

- 初始化 React + Vite + Fastify。
- 读取 `ktx.yaml`。
- 扫描 `semantic-layer/**/*.yaml`。
- 展示 Table Catalog。
- 展示单表只读详情。

### Milestone 2: 单表编辑和 diff

- 建立 YAML parse / serialize。
- 实现 Table Editor。
- 支持表描述、grain、字段描述编辑。
- 实现 YAML preview。
- 实现 diff 预览。

### Milestone 3: 保存和 validate

- 安全路径校验。
- 写回 YAML。
- 调用 `ktx sl validate`。
- 展示 validate 结果。
- 展示修改文件列表。

### Milestone 4: Measures / Segments / Joins

- measures 表单。
- segments 表单。
- measures / segments / grain 写入 `semantic-layer/<conn>/<table>.yaml` overlay，不写 `_schema/<schema>.yaml`。
- joins 表单。
- candidate join sidecar。

### Milestone 5: Wiki Editor

- 扫描 `wiki/**/*.md`。
- 编辑 frontmatter 和 Markdown。
- 从表页跳转到相关 wiki。
- 创建 `wiki/global/*.md`。

## 第一版建议交付物

```text
webui/
  README.md
  package.json
  src/
  server/
```

启动命令：

```bash
cd webui
npm install
npm run dev
```

访问地址：

```text
http://localhost:5173
```

## 后续增强

- AI 批量生成候选描述。
- 按业务域批量分配 owner。
- 表关系图谱视图。
- 语义变更 checklist。
- 针对代表性问题生成 SQL 进行验证。
- 与 GitHub PR review 集成。
- 导入 CSV 批量补充字段描述。
