# 工单 M6 · Schema Onboarding

> 先读 [README.md 总纲](README.md)。依赖:M3 完成(已实现 fs-safe `ALLOW_FILES` 通道 + ktx CLI 封装 util)。可与 M4 / M5 并行。

## codex 直投 prompt
```
工作目录:/Users/forrest/Projects/project-lucy/webui。先读 docs/codex/README.md、docs/02-arch-spec.md、docs/03-api-spec.md、docs/design-schema-onboarding.md(本工单 spec)。
任务:M6 Schema Onboarding(给已有连接添加 schema)。
关键约束:写入只经 fs-safe;YAML 就地补丁(ADR-01 / ADR-11);不接管新建连接;不写 .ktx/secrets/;POST schemas 默认 dryRun=true,必须显式 false 才落盘;写入前先跑 ktx connection test;写后不自动触发 ingest。
完成后 npm test 贴结果,按 DoD 收尾,停下交回,不要继续 M7。
```

## 目标
在「连接概览」加「+ 添加 schema」入口,让数据工程师在 webui 内完成「输入 schema 名 → 测连通 → 写回 ktx.yaml → 触发 ingest」,不接触凭据、不直接编辑 YAML。

## 必读
- `../../docs/design-schema-onboarding.md`(本工单 spec,ADR-11 全文)
- `../02-arch-spec.md §3.6(project.ts) §3.1(fs-safe)`
- `../03-api-spec.md §1(envelope) §2(connections 端点段)`
- `../01-architecture.md §6 ADR-01 / ADR-09 / ADR-11`
- `../../docs/design-db-connection.md §四(ALLOW_FILES 扩展)、§八(不做的事)`

## 交付文件
```
server/project.ts                       # 新增 writeKtxYaml util + addSchema()
server/ktx.ts                           # 新增 testConnection() (若尚无)
server/index.ts                         # 注册 POST /api/connections/:connId/schemas
server/model.ts                         # 新增 AddSchemaPreview / AddSchemaResult 类型
server/__tests__/project.ktx-yaml.test.ts     # round-trip + 不变量
server/__tests__/api.add-schema.test.ts       # supertest: dryRun / 409 / 400 / 落盘
src/pages/connections/ConnectionOverview.tsx  # + 添加 schema 按钮 + 抽屉入口
src/components/AddSchemaDrawer.tsx            # 三步状态机(test → diff → confirm → ingest)
src/lib/schemas.ts                            # schema 名校验(zod,前端镜像后端正则)
src/__tests__/add-schema-drawer.test.tsx      # RTL
```

## 实现步骤

### T6.1 — `writeKtxYaml` util(`server/project.ts`)

抽 `writeKtxYaml(root: string, mutator: (doc: Document.Parsed) => void, opts?: { dryRun?: boolean }): { doc: Document.Parsed; serialized: string }`。

实现细节:
- `readFile(path.join(root, 'ktx.yaml'))` → 文本
- `parseDocument(yamlText)`(用 `yaml` 包的 Document API,**严禁** `parse` + `stringify`)
- 调 `mutator(doc)` 改 CST
- `doc.toString()` 序列化
- `dryRun=true` 时**不**调 `safeWrite`,直接返回 `{ doc, serialized }`
- `dryRun=false` 时调 `safeWrite('ktx.yaml', serialized)` 后返回

**单测**(`server/__tests__/project.ktx-yaml.test.ts`):
- 加载 `ktx.yaml.example` 测试 fixture,跑空 mutator,序列化结果与原文件**严格字符串相等**
- 跑「仅改 `connections.mysql-aliyun.schemas`」mutator,断言 `JSON.stringify(doc.get('llm'))` / `'storage'` / `'scan'` / `'ingest'` / `'agent'` / `'setup'` / `'connections.mysql-aliyun.host'` / `'.password'` / `'.enabled_tables'` 在写入前后**字符串相等**

### T6.2 — `addSchema` 端点

`server/project.ts addSchema(root, connId, schema, dryRun)`:
1. 正则校验 schema 名 `^[a-zA-Z_][a-zA-Z0-9_]{0,62}$`,失败抛 `SCHEMA_NAME_INVALID`
2. 读 `ktx.yaml`,定位 `connections[connId]`,不存在抛 `CONNECTION_NOT_FOUND`
3. 校验 `.schemas` 是 `YAMLSeq` 且不含 `schema`,已含则抛 `SCHEMA_ALREADY_EXISTS`
4. `dryRun=true`:走 `writeKtxYaml` 但不落盘,经 `diff.ts previewDiff(oldText, newText, 'ktx.yaml')` 生成 unified diff,返回 `AddSchemaPreview`
5. `dryRun=false`:
   - 调 `ktx connection test <connId>`(若 `server/ktx.ts` 已有 `testConnection` 复用,否则新加,沿用 `execFile` + 5s 超时 + `POSTHOG_DISABLED=1`),失败抛 `CONNECTION_TEST_FAILED`(detail 含 stdout / stderr)
   - 走 `writeKtxYaml` 落盘
   - 写 `config_change_log`(`change_type='schema_add'`, `target_id='<connId>:<schema>'`, `old_summary=oldSchemas.join(',')`, `new_summary=newSchemas.join(',')`, `diff=unifiedDiff`)
   - 返回 `AddSchemaResult`

`server/index.ts` 注册:
```ts
fastify.post<{ Params: { connId: string }; Body: AddSchemaBody }>(
  '/api/connections/:connId/schemas',
  { schema: { body: z.object({ schema: z.string().min(1).max(63), dryRun: z.boolean().default(true) }) } },
  async (req, reply) => {
    const result = await addSchema(projectRoot, req.params.connId, req.body.schema, req.body.dryRun);
    return { ok: true, data: result };
  }
);
```

### T6.3 — 前端

`src/pages/connections/ConnectionOverview.tsx` 在每个连接卡片加 `<Button onClick={() => openAddSchema(conn)}>+ 添加 schema</Button>`。

`src/components/AddSchemaDrawer.tsx` 三步状态机:
- **Step 1 input**:zod client 镜像校验 `^[a-zA-Z_][a-zA-Z0-9_]{0,62}$`,勾选「写入前自动测试连通性」默认勾选
- **Step 2 preview**:调 `POST ?dryRun=true`,DiffViewer 复用,显示 `proposedYaml` 与原 yaml 的 unified diff
- **Step 3 confirm**:调 `POST ?dryRun=false`,成功后 toast「已添加 schema: xxx」+「现在 ingest」按钮调 `POST /api/connections/:connId/ingest`

错误用 `apiClient` 的 `error.code` 区分:
- `SCHEMA_NAME_INVALID` → 输入框红框 + 正则提示
- `SCHEMA_ALREADY_EXISTS` → toast「该连接已有此 schema」
- `CONNECTION_TEST_FAILED` → 折叠面板显示 ktx stderr
- `KTX_YAML_PARSE_ERROR` → 致命错误,显示「请在终端检查 ktx.yaml」并禁用后续步骤

### T6.4 — 审计

`config_change_log` SQLite helper 若已有(`server/index.ts` 或 `server/project.ts`)直接调;无则新建。

写字段:
```ts
{
  ts: new Date().toISOString(),
  actor: 'local-admin',
  session_id: requestId,
  file_path: 'ktx.yaml',
  change_type: 'schema_add',
  target_id: `${connId}:${schema}`,
  old_summary: oldSchemas.join(','),
  new_summary: newSchemas.join(','),
  diff: unifiedDiff,
  request_id: requestId,
}
```

### T6.5 — 文档

- `docs/webui-module-guide.md` v1.3:在「数据库接入 / 连接概览」段后加「#### 添加 schema」子节(对齐 v1.2 风格,文案参见设计稿 §七)
- `docs/webui-feature-map.md` §4:加一行「| 给已有连接添加 schema | 🔧 M6 开发中 | 在 webui 内给连接加 schema | 详见 `docs/design-schema-onboarding.md` |」
- `docs/webui-impl-status.md`:在「数据库接入」段加一行状态「🔧 开发中」

### T6.6 — 安全 / 边界回归

`server/__tests__/fs-safe.test.ts`(已存在)加新用例:
- 写 `ktx.yaml` 经 ALLOW_FILES 通道放行
- 写根目录其它文件(如 `README.md`)被拒
- 写 `.ktx/secrets/p` 仍 403
- 写 `raw-sources/r` 仍 403
- `semantic-layer/../.ktx/secrets/p`(穿越)仍 403
- 符号链接指向 secrets 仍 403

`server/__tests__/api.add-schema.test.ts` 端到端:
- 写后 `ktx.yaml` 的 `password` 字段**未泄露**给 `/api/project` / `/api/connections`(沿用 M3.4 既有行为)
- dryRun=true 不修改文件 mtime
- 写后 `ktx.yaml` 整体 byte 数 = 写前 + 1 行(精确差分)

## 约束(本工单重点)
- 写入只经 `fs-safe.ts`,**严禁**模块内直接 `fs.writeFile`
- YAML 就地补丁(ADR-01):用 `yaml.Document` API,**严禁** `parse` → JS 对象 → `stringify`
- 写后**不**自动触发 ingest —— 仅在 UI 提示「现在 ingest」(避免长任务阻塞 UI,且尊重用户的 git 节奏)
- 写 schema 失败**不**回滚(因为还没写);写后 ingest 失败**不**回滚 `schemas` 字段
- 错误 envelope 必检(ADR-09):`apiClient` 先判 `ok===false` 再用 `data`,失败时绝不渲染"已添加"假成功
- 仅绑 `127.0.0.1`,无鉴权(沿用 M0~M5)
- 不接管「新建连接」(host/port/user/password 仍走 `ktx setup`)

## 自验
```bash
cd /Users/forrest/Projects/project-lucy/webui
npm test   # round-trip / 409 / 400 / dryRun 不落盘 / fs-safe 全用例绿
npm run dev
# 连接概览 → mysql-aliyun → + 添加 schema → 输入 "demo_finance" → 下一步 → diff 预览 → 确认
# 验证 ktx.yaml 实际多了一行 schemas: - demo_finance
# 点「现在 ingest」 → 后台 ktx ingest 输出 → 表目录 schema 筛选器出现 demo_finance
# git -C /Users/forrest/Projects/project-lucy diff ktx.yaml  → 仅 + 一行
```

冒烟 case 选 mysql-aliyun 上**真实可连**的小 schema;若当前无备用 schema,可用 `mysql -e "CREATE DATABASE schema_onboard_test"` 临时建一个,跑完 `DROP DATABASE` 清理。

## DoD
- 上述 fs-safe / dryRun / 409 / 400 / round-trip 用例全绿
- 「+ 添加 schema」入口从连接到 ingest 全链路跑通
- `ktx.yaml` 实际变更仅 + 1 行 `schemas`,其余段字符串相等
- 写 `.ktx/secrets/p` 仍 403(回归)
- `config_change_log` 多一条 `schema_add` 记录
- 文档三处(`webui-module-guide` v1.3 / `webui-feature-map` / `webui-impl-status`)同步更新

完成后**停下交回**。
