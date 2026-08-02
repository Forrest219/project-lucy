# WebUI Schema Onboarding 技术设计

| 元数据 | 内容 |
|---|---|
| 文档名称 | WebUI Schema Onboarding 技术设计 |
| 文档类型 | Design |
| 版本 | v1.0 |
| 撰写日期 | 2026-07-24 |
| 撰写人 | Claude Architect |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/01-architecture.md`(ADR-01~10)、`webui/docs/02-arch-spec.md`、`webui/docs/04-data-model.md`、`webui/docs/05-task-list.md`、`docs/design-db-connection.md`、`docs/webui-feature-map.md`、`docs/webui-module-guide.md`、`ktx.yaml.example` |
| 适用范围 | Builder 开发 WebUI schema onboarding 模块(代号 M6);Reviewer 核对 ADR-11 落地 |
| 输出位置 | /Users/forrest/Projects/project-lucy/docs/design-schema-onboarding.md |

---

## 一、背景与目标

当前 webui 已实现「连接概览 / 表白名单 / 连通测试」三个二级入口,但**只能编辑已声明在 `ktx.yaml` 中的 schema 下的表白名单**,无法在 webui 内给已有连接加新 schema。给一个新项目接入时,数据工程师必须打开 `ktx.yaml` 手动编辑 `connections.<connId>.schemas: [...]`,然后在终端跑 `ktx ingest <connId>`,再回 webui 看到新表。

**目标**:在「连接概览」加「+ 添加 schema」入口,让数据工程师在 webui 内完成「输入 schema 名 → 测连通 → 写回 `ktx.yaml` → 触发 ingest」的全流程,且全程不接触凭据、不直接编辑 YAML。

## 二、scope 边界

**做(M6 范围):**
- 给**已存在的连接**追加一个新 schema(database)
- 走 `ktx connection test <connId>` 预检连通
- 写回 `ktx.yaml` 的 `connections.<connId>.schemas: []` 数组追加
- 触发 `ktx ingest <connId>` 把新 schema 的表扫到 `semantic-layer/<connId>/_schema/<schema>.yaml`
- 表目录的 schema 筛选器自动出现新 schema

**不做(明确划线,与 `design-db-connection.md §八` 一致):**
- **新建连接**:host / port / user / password 仍走 `ktx setup` 终端
- **写 `.ktx/secrets/`**:密码文件永远在 DENY 列表
- **删除 / 重命名 schema**:不在 v1 范围
- **编辑 `ktx.yaml` 的其它顶层字段**(llm / scan / ingest / agent / storage / setup):不在 v1 范围
- **批量添加 schema**:v1 一次只接一个

## 三、关键设计决策(新 ADR-11)

> 在 `webui/docs/01-architecture.md §6` 表中追加 ADR-11。

| # | 决策 | 理由 |
|---|---|---|
| ADR-11 | **新增 schema 走 webui 端点,但不接管新建连接**;写入 `ktx.yaml` 用 yaml `Document` 就地补丁,只追加 `connections.<connId>.schemas` 数组项,不动 host / password / credentials / llm / scan / ingest / agent / storage / setup 等任何其它字段;写入前必须先 `ktx connection test <connId>` 通过 | 守 `design-db-connection.md §八` 安全边界;复用 M3.4 扩展的 `ALLOW_FILES = ["ktx.yaml"]` 通道;就地补丁与 ADR-01 一致,避免破坏用户已配的 `scan.relationships` / `ingest.embeddings` / `agent.run_research` 等复杂段;`ktx connection test` 预检防止用户拼错 schema 名直接落盘 |

配套约束:
1. schema 名严格正则 `^[a-zA-Z_][a-zA-Z0-9_]{0,62}$`,防 YAML 注入 + 防过长
2. 写入后 `ktx ingest` 失败**不自动回滚** `ktx.yaml.schemas` —— `schemas` 字段已声明,只是本地 `_schema/<schema>.yaml` 没生成,人工补 ingest 即可
3. 写 schema 失败不重试,由用户在 UI 调整后重新提交

## 四、API 设计

注册在 `server/index.ts`,沿用统一错误 envelope(ADR-09)。

### `POST /api/connections/:connId/schemas`

**Request Body**
```ts
type AddSchemaBody = { schema: string; dryRun: true }
type AddSchemaConfirm = { schema: string; dryRun: false }
```

**Response(dryRun=true)**
```ts
{
  ok: true,
  data: {
    diff: string;              // jsdiff unified,ktx.yaml 整体前后 diff
    proposedYaml: string;      // 完整文件供前端预览
    oldSchemas: string[];
    newSchemas: string[];
  }
}
```

**Response(dryRun=false)**
```ts
{
  ok: true,
  data: { written: true, auditId: number, oldSchemas: string[], newSchemas: string[] }
}
```

**新错误码**(在 `03-api-spec.md §1` 错误码表追加):
- `SCHEMA_ALREADY_EXISTS`(409):同名 schema 已在该连接 `schemas` 列表
- `SCHEMA_NAME_INVALID`(400):不匹配正则,detail.pattern 给出正则字符串
- `CONNECTION_NOT_FOUND`(404):`connId` 不在 `ktx.yaml` 中
- `CONNECTION_TEST_FAILED`(400):`ktx connection test` 失败,detail 含 stdout / stderr
- `KTX_YAML_PARSE_ERROR`(500):`ktx.yaml` 不是合法 YAML

**复用现有端点**(无需新增):
- `GET /api/connections` — 取 `ConnectionInfo[].schemas`
- `POST /api/connections/:connId/test` — 加 schema 前内部预检
- `POST /api/connections/:connId/ingest` — 加完后由前端引导触发

## 五、YAML 写入策略

```
1. readFile("ktx.yaml")                                  ← 根目录文件,不在 secrets 黑名单
2. parseDocument(yamlText)                               ← 必须用 Document,不能用 parse()
3. 定位 connections[connId] 节点 → 校验存在
4. 定位 .schemas 节点 → 校验是 YAMLSeq
5. .schemas.items.push(new Schema(schemaName))           ← yaml Document API
6. doc.toString() → 保留 llm / scan / ingest / agent / storage / setup 全部段
7. safeWrite("ktx.yaml", serialized)                     ← 经 ALLOW_FILES 通道
```

**关键不变量**(单元测试覆盖):
- 写后 `ktx.yaml` 整体 byte 数 ≥ 写前 + 1 行
- 写后以下片段的 `JSON.stringify(doc.get(path))` 与写前**严格字符串相等**:
  - 顶层 `llm / storage / scan / ingest / agent / setup`
  - `connections.<connId>.host / port / database / username / password / driver / wire_protocol / readonly / r1_target / enabled_tables`
- 写后 `semantic-layer/**` / `wiki/**` / `.ktx-ui/**` / `.ktx/secrets/**` 任何文件**未被触碰**

## 六、安全与审计

| 项 | 方案 |
|---|---|
| YAML 注入 | schema 名严格正则 + `yaml.Document` API 序列化,不做字符串拼接 |
| fs-safe | 复用 `ALLOW_FILES = ["ktx.yaml"]` 通道(M3.4 已规划),不新增 fs-safe 改动 |
| secrets | schema 字段本身不含凭据;前端绝不展示 password 字段(沿用 M3.4 行为) |
| 审计 | 写 `config_change_log` 一行,`change_type = "schema_add"`,`target_id = "<connId>:<schema>"`,`old_summary` = `oldSchemas.join(',')`,`new_summary` = `newSchemas.join(',')`,`diff` = 完整 unified diff |
| 错误 envelope | 沿用 ADR-09;前端 `apiClient` 先判 `ok===false` 才用 `data`,失败时绝不渲染"已添加"假成功 |
| 回滚 | **不自动回滚**;`ktx ingest` 失败保留 `schemas` 字段,前端 toast 提示「重试 ingest」 |

## 七、UI 流程

位置:「连接概览」页(`/connections`)对每个连接卡片加一个「+ 添加 schema」按钮。

```
┌─────────────────────────────────────────────────┐
│  mysql-aliyun          driver: mysql             │
│  schemas: dataforai                             │
│  ┌────────────────┐  ┌──────────────────────┐   │
│  │ + 添加 schema  │  │ ⚙ 表白名单  🔌 测试  │   │
│  └────────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────┘
                       │
                       ▼ 点击「+ 添加 schema」
┌─────────────────────────────────────────────────┐
│  添加 schema  到  mysql-aliyun                   │
│  ─────────────────────────────────────────────  │
│  Schema / database 名:  [_______________]       │
│  ☑ 写入前自动测试连通性  (推荐)                   │
│                                                 │
│  [取消]                              [下一步]   │
└─────────────────────────────────────────────────┘
                       │  → 内部 POST test
                       ▼
┌─────────────────────────────────────────────────┐
│  预览变更  ktx.yaml                              │
│  ─────────────────────────────────────────────  │
│   32    schemas:                                 │
│   33      - dataforai                            │
│   34 +    - finance_mart                         │ ← 红色
│                                                 │
│  [取消]                              [确认写入] │
└─────────────────────────────────────────────────┘
                       │  → POST schemas?dryRun=false
                       ▼
┌─────────────────────────────────────────────────┐
│  ✓ 已添加 schema: finance_mart                  │
│  下一步:触发 ingest 把表同步到语义层              │
│  [现在 ingest]    [稍后]                         │
└─────────────────────────────────────────────────┘
                       │
                       ▼
       跳转 POST /api/connections/:connId/ingest
```

**文案注意**:对 `engine: mysql / doris / starrocks` 显示 "Schema 或 database",对 `engine: postgres` 显示 "Schema",对其他引擎显示通用 "Schema",避免术语错位。`engine` 字段来自 `ConnectionInfo.engine`(M3.4 已暴露)。

**三步抽屉实现要点**:
- 状态机:`idle → submitting_test → previewing → submitting_write → success`
- 错误处理:用 `apiClient` 的 `error.code` 区分:
  - `SCHEMA_NAME_INVALID` → 输入框红框 + 正则提示
  - `SCHEMA_ALREADY_EXISTS` → toast「该连接已有此 schema」
  - `CONNECTION_TEST_FAILED` → 折叠面板显示 ktx stderr
  - `KTX_YAML_PARSE_ERROR` → 致命错误,显示「请在终端检查 ktx.yaml」并禁用后续步骤

## 八、model.ts / fs-safe 扩展

### `server/model.ts`

`ConnectionInfo` 不变(已有 `schemas: string[]`)。

新增类型:
```ts
export type AddSchemaPreview = {
  diff: string;
  proposedYaml: string;
  oldSchemas: string[];
  newSchemas: string[];
};

export type AddSchemaResult = {
  written: true;
  auditId: number;
  oldSchemas: string[];
  newSchemas: string[];
};
```

### `server/fs-safe.ts`

**不新增** fs-safe 改动 —— 复用 M3.4 规划的 `ALLOW_FILES = ["ktx.yaml"]` 通道。T6.1 任务降级为"YAML 写入 util 抽象",不与 fs-safe 改动耦合。

## 九、里程碑(M6 · Schema Onboarding)

| # | 任务 | 验收 |
|---|---|---|
| T6.1 | `server/project.ts writeKtxYaml(root, mutator)` util:parseDocument → 用户回调改 CST → toString → 经 fs-safe 落盘。YAML round-trip 单测不破坏 `llm / scan / ingest / agent / storage / setup` 任何段 | round-trip 严格字符串相等 |
| T6.2 | `addSchema(root, connId, schema, dryRun)` + `POST /api/connections/:connId/schemas` 端点;内部预检 `ktx connection test`;dryRun 返回 diff;写时走 `writeKtxYaml` + 写审计 | dryRun 不落盘;`SCHEMA_ALREADY_EXISTS` 409;`SCHEMA_NAME_INVALID` 400;`CONNECTION_TEST_FAILED` 400 含 ktx 输出 |
| T6.3 | 前端「连接概览」+ 三步抽屉/对话框(test → diff → confirm → ingest 引导) | UI 跑通;新 schema 在「表目录」schema 筛选器可见 |
| T6.4 | 审计:`config_change_log` 写 `schema_add` 记录,`target_id = "<connId>:<schema>"` | audit 表可见对应行 |
| T6.5 | 文档:`docs/webui-module-guide.md` v1.3 / `docs/webui-feature-map.md` §4 / `docs/webui-impl-status.md` 同步 | 与 spec 一致 |
| T6.6 | 安全 / 边界回归:写 `ktx.yaml` 经 ALLOW_FILES 通道放行;写 `.ktx/secrets/p` 仍 403;写 `raw-sources/r` 仍 403;`semantic-layer/../.ktx/secrets/p` 仍 403;写入不泄露 password 字段 | fs-safe 全用例绿 |

工单包见 `webui/docs/codex/wo-M6-schema-onboarding.md`。

## 十、不在 v1 范围(后续考虑)

- 批量添加 schema(一次性输入多行 / CSV 导入)
- 在 webui 中重命名 / 删除 schema
- 接管「新建连接」(host / port / user / password 仍走 `ktx setup`)
- 编辑 `ktx.yaml` 的 llm / scan / ingest 等其它顶层字段
- 跨连接移动 schema

## 十一、待澄清(写 codex 工单前默认)

| # | 决定 | 默认 |
|---|---|---|
| Q1 | 写后是否自动触发 ingest | 仅提示,给「现在 ingest」按钮 —— 避免长任务阻塞 UI,尊重用户 git 节奏 |
| Q2 | schema 名大小写敏感性 | 严格字符串比较,大小写视为不同;DB 端大小写不敏感由 ktx / test 兜底 |
| Q3 | 是否需要"批量添加 schema" | v1 不做,只接单个 |
| Q4 | 失败回滚 | 不自动回滚,保留 `schemas` 字段,提示用户重试 |
| Q5 | 写后是否需要重新加载 `ktx.yaml` 缓存 | 后端用 `parseDocument` 每次现读,无缓存,不需要 reload |

---
_架构设计 by Claude (architect) · 2026-07-24_
