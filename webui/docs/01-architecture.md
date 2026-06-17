# 01 · 系统架构

KTX Local WebUI — 本地语义补充工作台。本文给出系统级架构、组件边界、关键架构决策与安全模型。

## 1. 设计目标与约束

| 维度 | 约束 |
| --- | --- |
| 部署 | 仅本机运行，单用户，绑定 `127.0.0.1`，无鉴权 |
| 事实源 | `semantic-layer/**/*.yaml`、`wiki/**/*.md` 仍是唯一事实源；webui 是编辑器不是数据库 |
| 写入 | 任何写入前展示 diff、用户确认、写后 validate；只允许写白名单目录 |
| 规模 | 承载 ~300 张表的目录与单表编辑，非完整 BI 建模器 |
| 版本 | 版本历史交给 Git，webui 不做 commit/PR |
| 安全 | 不读取/不展示 `.ktx/secrets/`；不写 `raw-sources/`、`.git/` |

## 2. 系统上下文（C4 L1）

```text
            ┌─────────────┐      HTTP(127.0.0.1)     ┌──────────────────┐
   用户 ───▶│  浏览器 SPA  │ ───────────────────────▶ │  本地 Node 服务   │
            │ React+Vite  │ ◀─────────────────────── │  Fastify (API)   │
            └─────────────┘        JSON               └────────┬─────────┘
                                                                │ 文件读写 / 子进程
                                                ┌───────────────┼───────────────┐
                                                ▼               ▼               ▼
                                       semantic-layer/      wiki/          ktx CLI
                                        *.yaml             *.md         (sl validate)
                                                                │
                                                          .ktx-ui/  (sidecar: 候选 join 等)
```

外部依赖：`ktx` 命令行（校验）、本地文件系统、可选的 `git`（Review 页 diff）。

## 3. 容器 / 进程架构

单一 Node 进程承载 API 与（生产时）静态资源。

- **开发**：`vite`(5173) 提供前端 HMR，`/api` 经 Vite proxy 转发到 Fastify(5174)。`npm run dev` 用 `concurrently` 同时拉起两者。
- **生产 / 打包**：前端 `vite build` 产物由 Fastify 用 `@fastify/static` 托管，API 与页面同端口（如 5174），最终目标是 `ktx ui` 一条命令启动。

**项目根解析**（架构关键）：webui 需知道操作哪个 ktx 项目。解析优先级：
1. CLI 参数 `--project <dir>`；
2. 环境变量 `KTX_PROJECT_ROOT`；
3. 从 `process.cwd()` 向上查找含 `ktx.yaml` 的目录。
解析后所有路径以该根为基准，启动时校验 `ktx.yaml` 可读。

## 4. 组件分解

### 4.1 后端模块（`server/`）

| 模块 | 职责 | 关键约束 |
| --- | --- | --- |
| `index.ts` | Fastify 启动、路由注册、错误 envelope、仅绑定 localhost | 不暴露 secrets 路径 |
| `project.ts` | 解析项目根、读 `ktx.yaml`、列出 connection/schema | 不解析 `password: file:` 指向内容 |
| `semantic-layer.ts` | 扫描/读取/写回 `_schema/*.yaml`，YAML ↔ 模型映射 | 就地补丁（见 ADR-01） |
| `wiki.ts` | 扫描/读写 `wiki/**/*.md`，frontmatter 解析 | 仅写 `wiki/` |
| `ktx.ts` | 封装 `ktx` CLI（execFile），解析 validate 结果 | 无 shell 注入、超时 |
| `fs-safe.ts` | **唯一写入网关**：路径白名单/黑名单、防穿越 | 所有写经此 |
| `diff.ts` | 保存前 proposed↔disk diff；Review 页 git diff | 统一 unified 格式 |
| `completion.ts` | 由模型计算单表完成度状态 | 纯函数 |

### 4.2 前端模块（`src/`）

| 区域 | 内容 |
| --- | --- |
| `pages/` | Catalog、TableEditor、JoinEditor、WikiEditor、Review 五大页 |
| `components/` | 共享 UI（shadcn/ui 封装）、DiffViewer、StatusBadge、YamlPreview |
| `lib/` | API client（含 error envelope 检查）、zod schema、类型、查询 key |
| `app/` | 路由、Provider（TanStack Query）、布局 |

状态管理：服务端状态用 **TanStack Query**；表单用 **react-hook-form + zod**；不引入 Redux（见 ADR-08）。

## 5. 关键数据流

### 5.1 读取单表
```text
GET /api/sources/:conn/:schema/:table
→ semantic-layer.ts 读 _schema/<schema>.yaml (parseDocument)
→ 抽取 tables[table] → 规范化 JSON（保留原始 YAML 文本片段）
→ completion.ts 计算状态 → 返回 {model, rawYaml, completion}
```

### 5.2 保存单表（核心写流程）
```text
前端表单 → 规范化 JSON patch
→ PUT /api/sources/:conn/:schema/:table  (dryRun=true)
→ semantic-layer.ts: 加载现有 Document → 就地 apply patch → 序列化
→ diff.ts: 生成 proposed↔disk diff → 返回给前端预览（不落盘）
→ 用户确认 → PUT (dryRun=false)
→ fs-safe.ts 校验路径 → 写回
→ ktx.ts 自动 validate → 返回结果 + 修改文件列表
```

### 5.3 校验与 Review
```text
POST /api/sources/:conn/:schema/:table/validate
→ ktx sl validate <source> --connection-id <conn>
GET /api/diff → git diff（限定 semantic-layer/、wiki/、.ktx-ui/）或会话内写入记录
```

## 6. 关键架构决策（ADR）

| # | 决策 | 理由 |
| --- | --- | --- |
| ADR-01 | YAML 用 `yaml` 包 `parseDocument()` 的 **Document/CST 就地补丁**，禁止 parse→JS对象→dump | 真实文件含 `"on"` 引号、注释、key 顺序；naive 序列化会破坏并删除未知字段，触发无意义 git diff 与 validate 失败 |
| ADR-02 | 文件粒度 = schema 文件；编辑单元「表」地址 = `connectionId + schema + table` | 真实布局 `_schema/<schema>.yaml` 内含多表，README 的「一文件一 source」不成立 |
| ADR-03 | 人工编辑的描述写入独立作者桶 `descriptions.human`，不覆盖 `descriptions.ai` | 保留 AI 产出可追溯，人工优先级在渲染层决定 |
| ADR-04 | **单一写入网关** `fs-safe.ts`，realpath 解析后做白/黑名单 + `..` 穿越校验 | 安全约束集中可审计，避免分散绕过 |
| ADR-05 | 本地单进程，仅绑定 `127.0.0.1`，无登录 | 单用户本地工具，鉴权是过度设计 |
| ADR-06 | diff 双轨：保存前用 jsdiff(proposed↔disk)，Review 页用 `git diff` | 保存预览需即时且无需 git；Review 复盘借力 git（项目已是 git 仓库） |
| ADR-07 | `ktx` CLI 经 `execFile`（非 `exec`）+ 参数数组 + 超时调用 | 杜绝 shell 注入，结果可结构化解析 |
| ADR-08 | 服务端状态 TanStack Query，表单 RHF+zod，不引入 Redux | 轻量、契合「编辑器」形态 |
| ADR-09 | API 统一 **显式错误 envelope**，前端 client **必须**检查 `error` 字段后才用 `data` | 直接呼应历史教训：MCP 错误响应被吞导致假数据，见 [memory] |
| ADR-10 | 新增语义字段分层写入：`grain/measures/segments` 写独立 overlay，`role/visibility/tags` 暂不写 | 实测 ktx 只在 `semantic-layer/<conn>/<source>.yaml` overlay 中消费 `grain/measures/segments`；`visibility` 会被拒，已有列不能用 overlay 覆盖 `role` |

> ADR-09 背景：曾出现「`_mcp_list_datasources` 未检查 error 字段导致『暂无数据源』反复出现」的 bug。本架构把「错误不可被吞」作为前后端契约的硬约束。

## 7. 安全模型

```text
允许写：  semantic-layer/   wiki/   .ktx-ui/
禁止写：  .ktx/secrets/   raw-sources/   .git/   （及一切白名单之外）
禁止读返回：  .ktx/secrets/**   ktx.yaml 中 password: file: 指向的内容
```

强制点（全部在 `fs-safe.ts`）：
1. 入参路径 `path.resolve` → `fs.realpathSync`（破符号链接）→ 必须落在某个白名单根内；
2. 黑名单根优先于白名单，命中即拒；
3. 计算 `path.relative(root, target)`，含 `..` 或绝对则拒（防穿越）；
4. 服务仅 `listen({host:'127.0.0.1'})`；
5. `/api/project` 返回连接信息时**剥离** password 字段（只暴露「password 来源类型」如 `file`，不暴露值）。

## 8. 与真实 semantic-layer 布局的对齐

基于对 `semantic-layer/mysql-aliyun/_schema/*.yaml` 的核对（dataforai=5表 / dataforai=11表 / dataforai=3表）：

| 项 | 原 README 假设 | 真实情况 | 处理 |
| --- | --- | --- | --- |
| 文件粒度 | 一文件一 source（conn/source） | 一文件一 schema，内含 `tables:` map | ADR-02：表地址改为 conn+schema+table |
| 描述结构 | `descriptions: Record<string,string>` | 按作者分桶，现有仅 `ai:` | ADR-03：人工写 `human` 桶 |
| join `on` | `on` | YAML 中为 `"on"`（保留字加引号） | ADR-01：就地补丁保留引号 |
| grain/measures/segments | MVP 必备 | 真实数据**当前不存在** | ADR-10：写入 `semantic-layer/<conn>/<source>.yaml` overlay；不要写入 `_schema/<schema>.yaml` |
| role/visibility | 字段属性 | 真实 column 仅 name/type/pk/nullable/descriptions | 暂不落盘：`visibility` 被 ktx compose 明确拒绝；已有列的 `role` 不能通过 overlay 覆盖 |

## 9. 风险与未决问题

| 风险 | 影响 | 缓解 / 待确认 |
| --- | --- | --- |
| ktx schema 是否支持 grain/measures/segments/visibility | 决定 M2/M4 能否落地 | **已探测 2026-06-15**：`grain/measures/segments` 支持在独立 overlay 文件中合并并 validate；`visibility` 不支持；已有列 `role` 不能通过 overlay 覆盖 |
| `ktx` 二进制定位与调用约定 | validate 能否工作 | **已探测 2026-06-15**：`ktx sl validate <sourceName> --connection-id <conn>`，其中 `sourceName` 是短表名（如 `superstore_orders`），不是 `schema.table` 或 `conn/source`；成功退出码 0，找不到 source / schema compose 失败退出码 1 |
| 前端/后端框架大版本漂移 | M1/M2 才会真正覆盖路由、查询、表单链路 | M0 lockfile 实际解析为 React 19 / Vite 8 / TypeScript 6 / Fastify 5 / React Router 7。M1 验证 React Router + TanStack Query；M2 验证 react-hook-form + zod。优先按当前 lockfile 修复，阻塞时再回退大版本 |
| 300 表目录扫描性能 | Catalog 加载慢 | 扫描结果缓存 + 文件 mtime 失效；必要时增量 |
| Document 就地补丁对新增嵌套结构的支持 | measures/joins 写入复杂度 | M4 前做 spike 验证 yaml 包 Document API 增删节点 |
| 与 ktx 内部 git（`storage.git`）的关系 | Review diff 可能与 ktx 自己的提交冲突 | webui 只读 `git diff`，绝不 commit |

### 9.1 ADR-10 探测记录

探测命令在 `/private/tmp/ktx-schema-probe` 项目副本中执行，避免修改真实语义层：

- 原始真实 source：`POSTHOG_DISABLED=1 ktx sl validate superstore_orders --connection-id mysql-aliyun --json` → `Valid semantic-layer source: mysql-aliyun/superstore_orders`，退出码 0。
- 错误 source 标识：`dataforai.superstore_orders` 与 `mysql-aliyun/superstore_orders` 都找不到；前者被解析为 `mysql-aliyun/dataforai.superstore_orders`，后者被解析为 `mysql-aliyun/mysql-aliyun/superstore_orders`，退出码 1。
- 在 `_schema/dataforai.yaml` 的表节点直接添加 `grain/measures/segments/role/visibility` 不会触发 validate 失败，但 `ktx sl read superstore_orders` 不消费这些值；不要把这当成支持。
- 新建 `semantic-layer/mysql-aliyun/superstore_orders.yaml` overlay，只包含 `name/grain/measures/segments` 时，`sl read` 能合并输出这些字段，`sl validate` 退出码 0。
- overlay 中加入 `visibility: public` 时，`sl read` 报 `composeOverlay: overlay for 'superstore_orders' has unhandled keys [visibility]`，退出码 1。
- overlay 中重复声明已存在列 `columns.date` 并加 `role: time` 时，`sl read` 报 `column 'date' in columns already exists on manifest source 'superstore_orders'`，退出码 1。

---
_架构设计 by Claude (architect) · 2026-06-15_
