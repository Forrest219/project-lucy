# 数据库接入模块技术设计

| 元数据 | 内容 |
|---|---|
| 文档名称 | 数据库接入模块技术设计 |
| 文档类型 | Design |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-20 |
| 撰写人 | Claude Architect |
| 委托人 | zhangxingchen |
| 基于材料 | webui-module-guide.md、webui/server/ktx.ts、webui/server/project.ts、webui/server/fs-safe.ts、webui/server/model.ts、webui/server/index.ts |
| 适用范围 | Builder 开发数据库接入模块（WebUI 新增功能） |
| 输出位置 | /Users/zhangxingchen/Projects/project-lucy/docs/design-db-connection.md |

---

## 一、现有可复用能力

新模块在以下已有基础上扩展，开发前确认：

| 能力 | 位置 | 说明 |
|---|---|---|
| 读取 `ktx.yaml` 连接配置 | `server/project.ts → readProject()` | 已解析 `id / driver / passwordSource / schemas`，未含 `enabled_tables` |
| `ConnectionInfo` 类型 | `server/model.ts` | 已有，需新增 `enabledTables` 字段（见 §5） |
| KTX CLI 调用模式 | `server/ktx.ts → validateSource()` | `execFile("ktx", [...], { cwd: projectRoot, env: { POSTHOG_DISABLED: "1" } })` 固定模式，复用 |
| fs-safe 写保护 | `server/fs-safe.ts` | `ktx.yaml` 在项目根目录，**当前不在 ALLOW 列表内**，需扩展（见 §4） |

---

## 二、新增 API 端点

注册在 `server/index.ts`，风格参照现有路由。

### `GET /api/connections`

返回所有连接的完整信息，含 `enabled_tables`。

**Response**
```ts
{
  ok: true,
  data: {
    connections: Array<{
      id: string;               // 如 "mysql-aliyun"
      driver?: string;          // "mysql" | "postgres" | ...
      passwordSource?: "file" | "env" | "inline";
      schemas: string[];
      enabledTables: string[];  // 如 ["dataforai.superstore_orders"]
    }>
  }
}
```

**实现**：新建 `readConnections()` 函数（不修改现有 `readProject()`），在解析 `connections` 时额外读取 `enabled_tables` 字段并返回。

---

### `GET /api/connections/:connId/tables`

列出该连接下数据库中所有可见的表（不限于白名单），用于白名单页面左侧"可选列表"。

**Response**
```ts
{
  ok: true,
  data: { tables: string[] }  // 格式 "schema.table"
}
```

**实现**：优先读取 `semantic-layer/<connId>/_schema/*.yaml` 中的表名（已有文件，稳定可靠）；若需要包含尚未 ingest 的表，再考虑调 `ktx connection list --connection-id <connId>`。

---

### `PUT /api/connections/:connId/enabled-tables`

更新某个连接的表白名单，写回 `ktx.yaml`。

**Request Body**
```ts
{ enabledTables: string[] }  // 全量替换，非增量
```

**Response**
```ts
{ ok: true }
```

**实现**：读 `ktx.yaml` → `parse()` → 替换 `connections[connId].enabled_tables` → `stringify()` → `safeWrite("ktx.yaml", ...)`。注意事项见 §3 和 §4。

---

### `POST /api/connections/:connId/test`

测试数据库连通性。

**Response（成功）**
```ts
{ ok: true, data: { status: "ok", latencyMs: number, detail?: string } }
```

**Response（失败，HTTP 200）**
```ts
{ ok: true, data: { status: "error", reason: string } }
```

**实现**：参照 `ktx.ts → validateSource()` 的 `execFile` 模式，实现 `testConnection(projectRoot, connId)`，调用 `ktx connection test <connId>`，解析 stdout/stderr，记录耗时。

---

### `POST /api/connections/:connId/ingest`

触发 `ktx ingest <connId>`，将新表 schema 同步到语义层。

**Response**
```ts
{ ok: true, data: { exitCode: number, stdout: string, stderr: string } }
```

**实现**：调用 `ktx ingest <connId>`，超时设 120s（ingest 耗时可能数十秒）。先按同步实现，后续如有需要再改异步轮询。

---

## 三、YAML 写入规范

写回 `ktx.yaml` 时，只替换目标字段，保留其余所有字段（`llm`、`storage`、`scan` 等）。

```
1. readFile("ktx.yaml")
2. parse(yamlText)          ← 用现有 yaml 依赖，不用正则/字符串替换
3. config.connections[connId].enabled_tables = newList
4. stringify(config)
5. safeWrite("ktx.yaml", serialized)
```

---

## 四、fs-safe 扩展

**问题**：`ktx.yaml` 在项目根目录，`fs-safe.ts` 的 ALLOW 列表做目录前缀匹配，根目录文件不在任何允许目录，`safeWrite("ktx.yaml")` 会被拒绝。

**方案**：补充文件级精确白名单，与目录白名单分开校验：

```ts
// fs-safe.ts 新增
const ALLOW_FILES = ["ktx.yaml"];

// 在 resolveWritable() 的目录校验之后追加：
if (ALLOW_FILES.includes(normalized)) {
  const rootReal = await realpath(projectRoot);
  const target = path.join(rootReal, normalized);
  if (!isWithin(target, rootReal)) {
    throw new ForbiddenPathError("Resolved path escapes the project root");
  }
  return target;
}
```

**影响面**：仅放开 `ktx.yaml` 一个文件，不影响其他安全边界。

---

## 五、model.ts 扩展

`ConnectionInfo` 新增 `enabledTables` 字段：

```ts
export type ConnectionInfo = {
  id: string;
  driver?: string;
  passwordSource?: "file" | "inline" | "env";
  schemas: string[];
  enabledTables: string[];  // 新增
};
```

`ProjectInfo` 不变（`connections: ConnectionInfo[]` 自动包含新字段）。

---

## 六、前端路由与页面

`src/app/App.tsx` 新增导航 section（插在现有"语义层维护"之前）：

```tsx
<section>
  <h2 className="pl-nav-section-title">数据库接入</h2>
  <NavLink to="/connections">连接概览</NavLink>
  <NavLink to="/connections/whitelist">表白名单</NavLink>
  <NavLink to="/connections/test">连通测试</NavLink>
</section>
```

新增路由及页面文件：

| 路由 | 页面文件 |
|---|---|
| `/connections` | `src/pages/connections/ConnectionOverview.tsx` |
| `/connections/whitelist` | `src/pages/connections/TableWhitelist.tsx` |
| `/connections/test` | `src/pages/connections/ConnectionTest.tsx` |

---

## 七、验收标准

1. **连接概览**：`/connections` 展示所有连接的 ID、driver、schemas、enabled_tables 数量
2. **表白名单**：`/connections/whitelist` 可见全部可选表 + 当前白名单；保存后 `ktx.yaml` 中 `enabled_tables` 更新；「触发扫描」显示执行日志
3. **连通测试**：`/connections/test` 点击测试，5 秒内返回成功/失败及原因
4. **安全边界**：`PUT enabled-tables` 只能改 `ktx.yaml`；`.ktx/secrets/` 在任何新路由中不可读写
5. **无回归**：现有所有路由行为不变

---

## 八、明确不做

- **不做新建连接**：`ktx setup` 是交互式 terminal 向导，不在 WebUI 中重新实现
- **不做密码管理**：`.ktx/secrets/` 永远在 DENY 列表
- **不做列级 / 行级权限**：超出 v1.0 范围，见 `docs/vision.md §5`
