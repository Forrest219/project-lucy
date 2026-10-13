# Connection Live Catalog Discovery Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection Live Catalog Discovery Spec |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 产品确认：允许 Owner 按需只读连库；进页按连接懒加载 + 短 TTL；`/connections` Schema 表需「库内表数」；Add Schema 应可选而非只手填；`ktx sql --json` 探测；修订 Spec 21「不扫物理库」边界 |
| 适用范围 | `/connections` Schema 资产表；`AddSchemaDrawer`；`GET /api/connections/:connId/live-schemas`；术语与 UI/UX 台账 |
| 输出位置 | `webui/docs/107-connection-live-catalog-discovery-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 107 |
| 关联工单 | `webui/docs/plans/wo-202608-40-connection-live-catalog-discovery.md` |
| 关联页面 | `/connections`；Add Schema Drawer |
| 关联台账 | `docs/ui-ux-feedback/pages/connections.md`（`UX-CONNECTIONS-026`～`027`） |
| 上游 Spec | Spec 21（Catalog 上传 / 本地目录边界）；Spec 44（连接概览产品化）；术语标准 §4.2 |
| 状态 | Implemented |
| 后续修订 | [Spec 174](174-webui-entry-performance-spec.md) §5：live-schemas 改走全服务有界后台探测队列（并发 2、排队 ≤64、同配置代次进行中合并）；保留只读查询、10 分钟成功缓存与 `refresh=1`（只绕过已完成缓存，仍可合并进行中任务）；连接配置代次变化即清空缓存，旧代次结果不写入新配置缓存；可选 `purpose=automatic\|manual`（默认 manual） |
| 日期 | 2026-10-12 |
| 范围 | Owner 按需只读库内目录；连接概览「库内表数」；Add Schema 有候选时只下拉，目录失败或候选为空时才手输；分连接懒加载与 TTL 缓存 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地：live-schemas API、库内表数列、Add Schema 可选 |
| v1.1 | 有候选时去掉「手动输入 Schema 名称」切换；手输只在库内目录失败或候选为空时自动出现 |

## 1. 背景

连接概览 Schema 表已有：

| 列 | 口径 |
|---|---|
| 已发现表数 | 本地 Schema Manifest |
| 已启用表数 | `ktx.yaml` `enabled_tables` |

缺少**物理库**中该 Schema 的表数量。`openclaw_db` 等已在库内存在、但未写入 `schemas` / 无 Manifest 时，运维无法从本页判断「库里有多少表」。

Add Schema 抽屉目前只能手填名称，易拼错、不可见账号实际可见的 Schema 列表。

Spec 21 曾声明 WebUI「不会扫描物理数据库」。产品确认：**允许 Owner 在运维面按需做只读目录查询**，作为受控例外；进页懒加载（表结构很少变），不做强制显式刷新才能看见。

## 2. 目标

1. 新增 `GET /api/connections/:connId/live-schemas`：经 `ktx sql` 只读查询，返回该连接账号可见的 Schema 及表数量。
2. `/connections` Schema 表新增列 **库内表数**，与 Manifest / 启用计数严格区分。
3. 进页按**连接**独立懒加载；短 TTL 缓存；单连接失败不影响其它连接与本地列。
4. `AddSchemaDrawer`：有候选时只从 live 目录选择 Schema；库内目录失败或候选为空时才改为手输。
5. 术语 / Spec 21 交叉引用 / UI/UX 台账同步。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 不自动把 live Schema 写入 `ktx.yaml` | 仍须走添加 Schema 确认 diff |
| 不替代 Manifest / 已启用计数 | 三源并存，禁止合并列 |
| 不做全页串行阻塞 | 分连接；失败隔离 |
| 不新建物理连接 / 不读 secrets 明文 | 复用既有 `ktx` 凭据通道 |
| 不做浏览器验证（本轮） | Vitest + terminology + build + code review |
| 不改启用表范围页的「已扫描」语义 | 仍以本地 Manifest 为主 |
| 不把空库 / 仅视图 Schema 补进下拉 | live SQL 仍只统计 BASE TABLE；有候选时不能再手填这些名字 |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`.

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Live Table Count | 库内表数 | 物理表数（可作 tooltip）、远端表数、DB 表数 | 物理库可见 BASE TABLE 数量；非 Manifest |
| Discovered Table Count | 已发现表数 | 本地表数（主导航） | Schema Manifest 内表数 |
| Enabled Table Count | 已启用表数 | 白名单表数 | `enabled_tables` |
| Live Catalog | 库内目录 | 物理扫描（作主标签） | Owner 按需只读目录查询结果 |
| Refresh Live Catalog | 重新拉取库内目录 | 刷新本地目录（易混） | 仅 bypass TTL 重查物理库 |
| Select Schema | 选择 Schema | 选择架构 / 模式 | Add Schema 下拉 |
| Enter Schema Manually | 手动输入 Schema 名称 | 手动输入架构 | 仅库内目录失败或候选为空时，表单改为输入框；有候选时不提供切换 |

Protected：`Schema`、Connection id、schema 名、`ktx sql`、`information_schema`。

## 5. 产品行为

### 5.1 加载策略

- `/connections` 挂载后，对每个 Connection **并行**发起 live-schemas（React Query）。
- `staleTime` / 服务端 TTL：**10 分钟**。
- 连接卡片提供低调 **重新拉取库内目录**（`?refresh=1`），不作为主路径。
- Add Schema 打开时复用同一 queryKey；缓存命中则无需再连库。

### 5.2 Schema 表列

列顺序：

`Schema` → `Manifest 状态` → **`库内表数`** → `已发现表数` → `已启用表数` → `操作`

| 状态 | 单元格 |
|---|---|
| loading | `…` / `加载中` |
| ok，配置 Schema 在 live 结果中 | `N 张表` |
| ok，配置 Schema 不在账号可见范围 | `—` + title 说明 |
| error | `不可用` + title/aria 带 reason |

### 5.3 Add Schema

1. 正在加载：禁用的「选择 Schema」下拉，占位「正在加载库内 Schema 列表…」。不展示输入框，也不展示引擎说明。
2. 有候选：`<select>`，选项 `schema_name（N 张表）`，排除已在 `connection.schemas` 中的项。不提供「手动输入 Schema 名称」或「从库内目录选择」。
3. live 失败：改为「Schema 名称」输入框，并说明「无法加载库内 Schema 列表」。
4. 候选为空（可见 Schema 都已配置，或库内没有可选项）：同样改为输入框，并说明「库内可见 Schema 均已配置，或当前无可选项。请手动输入。」
5. 写入路径不变：dryRun → connection test → 写 `ktx.yaml`。

### 5.4 安全与边界

- 只读 SQL；禁止写语句。
- 不返回 password / secret 路径内容。
- 系统库过滤（MySQL：`information_schema` / `mysql` / `performance_schema` / `sys`；Postgres：`pg_catalog` / `information_schema` / `pg_toast*`）。
- 修订 Spec 21：本 Spec 为 Owner 运维面受控例外；「刷新本地目录」仍不连库。

## 6. API

### `GET /api/connections/:connId/live-schemas`

Query：`refresh=1` 可选，跳过缓存。

成功：

```ts
{
  ok: true,
  data: {
    status: "ok",
    connectionId: string,
    schemas: Array<{ schema: string; tableCount: number }>,
    fetchedAt: string, // ISO
    cached: boolean,
    latencyMs?: number,
    wireProtocol: "mysql" | "postgres"
  }
}
```

失败（HTTP 200，与 connection test 同构，便于分连接 UI）：

```ts
{
  ok: true,
  data: {
    status: "error",
    connectionId: string,
    schemas: [],
    fetchedAt: string,
    cached: false,
    reason: string,
    wireProtocol?: "mysql" | "postgres" | "unknown"
  }
}
```

连接不存在：`404 CONNECTION_NOT_FOUND`。

实现：`ktx sql -c <connId> --json --max-rows <n> "<readonly aggregate SQL>"`；按 `wireProtocol` 选择 MySQL/StarRocks 或 Postgres 方言。

## 7. 验收标准

1. Schema 表出现 **库内表数**，且与已发现 / 已启用文案不同。
2. 进页后各连接独立加载；一连接失败不抹掉其它连接的库内列。
3. 10 分钟内重复进入 / 打开 Add Schema 不强制重查（除非重新拉取）。
4. Add Schema 有候选时只能从下拉选择；库内目录失败或候选为空时手输仍可用。
5. 术语 lint 通过；相关 Vitest 绿；本轮不做浏览器验证，台账为 `Fixed`。

## 8. 对 Spec 21 的修订

Spec 21「WebUI 不会自动扫描物理数据库」修订为：

- **默认**本地 YAML / `ktx.yaml` 路径不变（刷新本地目录、Manifest 上传等）。
- **例外**：Owner 在 `/connections` 经本 Spec 的 live-schemas 按需只读查询库内目录，用于库内表数展示与添加 Schema 候选。
