# Connection Catalog Upload UX Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection Catalog Upload UX Spec |
| 文档类型 | Product / UX / API Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-29 |
| 适用范围 | Lucy WebUI 数据库接入模块：`/connections`、`/connections/whitelist`、`AddSchemaDrawer`、本地 YAML Catalog 资产上传与刷新 |
| 架构决议 | 继续坚持 Zero AI Dependency for Core Pipeline；`ktx.yaml` 与 `semantic-layer/**/*.yaml` 仍为 Source of Truth；WebUI 增加受控 YAML 上传入口，替代“分析师维护后交给运维手工上传目录”的低效流程 |
| 事实源 | `ktx.yaml`、`semantic-layer/<connection>/_schema/<schema>.yaml`、`semantic-layer/<connection>/<table>.yaml`、`.ktx-ui/**` sidecar |
| 关联文档 | `webui/docs/17-static-catalog-loading-spec.md`、`webui/docs/16-ingest-first-class-ux-spec.md`、`webui/docs/11-connection-whitelist-test-ux-refresh.md`、`webui/docs/03-api-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 决策摘要

M14 将数据库接入模块从动态 CLI `ktx ingest` 调整为静态 Catalog Loading，解决了无 LLM / 无 embedding 环境下核心数据管道被 enrichment 阻断的问题。但新的操作模型仍有一个交付缺口：

```text
分析师维护 semantic-layer YAML
  -> 交给运维
  -> 运维手工上传到配置目录
  -> WebUI 刷新本地 Catalog
```

该流程不符合企业级 SaaS 的自助交付标准。分析师是语义层资产的主要生产者，却无法在 WebUI 中直接提交资产；运维被迫承担文件搬运职责，既低效，也缺乏产品化校验、审计与错误反馈。

因此本规格作出新的产品决议：

1. WebUI 增加“受控 YAML 资产上传”能力，允许分析师上传 schema manifest YAML。
2. 上传入口必须绑定 `connectionId` 与 `schema`，后端决定落盘路径，前端不得传任意目标路径。
3. 上传前必须先 validate / dry run，展示将写入路径、解析到的表数量、warning 与覆盖风险。
4. 上传成功后触发静态 `POST /api/catalog/reload`，让页面立即反映本地文件事实源。
5. `/connections` 连接概览同步收敛信息架构：去掉冗余导航、简化连接卡片、澄清“刷新本地目录”的使用场景。

## 2. 设计原则

### 2.1 Source Of Truth 不变

WebUI 上传不是引入新的数据库或远端配置源。最终事实源仍然是仓库内文件：

```text
ktx.yaml
semantic-layer/<connection>/_schema/<schema>.yaml
semantic-layer/<connection>/<table>.yaml
```

WebUI 只是一个受控写入入口，负责：

- 校验 YAML 结构。
- 防止越权路径写入。
- 落盘到白名单目录。
- 记录上传审计 sidecar。
- 触发本地 Catalog reload。

### 2.2 不恢复 CLI Ingest

本功能不得恢复以下行为：

- 后端执行 `ktx ingest`。
- WebUI 访问物理数据库扫描 DDL。
- 上传后触发 LLM enrichment / embeddings。
- 用上传按钮伪装成数据库扫描。

如需重新扫描物理数据库，应作为独立离线流程或未来可选高级能力，不属于本规格。

### 2.3 上传必须受控

“上传 YAML 资产”不是任意文件上传。MVP 只支持：

```text
semantic-layer/<connection>/_schema/<schema>.yaml
```

也就是 schema manifest。暂不支持：

- 上传 zip。
- 批量目录上传。
- 在线编辑 overlay。
- 上传 arbitrary YAML 到任意路径。
- 覆盖 `ktx.yaml`。
- 读取或写入 `.ktx/secrets/**`。

## 3. 当前问题分析

### 3.1 `/connections/*` Header 右侧信息冗余

当前 `/connections` Header 右侧同时显示：

- `/data/lucy`
- `1 个连接`
- `KTX 可用`
- `表白名单`
- `连通测试`
- `打开表目录`

这些信息与左侧导航、指标卡和页面内容重复。Header 变成第二套导航，降低了页面焦点。

#### 决议

所有 `/connections/*` 子页面遵循统一 Header 治理规则：

- `/connections`
- `/connections/whitelist`
- `/connections/test`

Header 不再承担跨页面导航，不再承载业务操作区。跨页面入口回到左侧导航、页面主体工具栏或当前业务卡片上下文中。

建议：

- 彻底移除右上角重复的跨页面导航按钮，例如 `表白名单`、`连通测试`、`打开表目录`。
- Header 仅保留页面标题、一句话描述与极简环境路径 Badge。
- 环境路径 Badge 建议只保留项目根，例如 `/data/lucy`；连接数量、KTX 可用性、Catalog 状态等交给指标卡或页面主体展示。
- 页面级主动作放入页面主体 Action Bar；连接级动作放入 Connection Card。

### 3.2 Connection Details 信息模型复杂

当前连接卡片同时承载：

- 连接身份。
- 驱动与协议。
- 访问模式。
- 连通测试状态。
- Catalog reload 状态。
- schema 列表。
- enabled table 数量。
- 添加 schema / 测试连接 / 重新加载资产。

这些信息没有清晰层级，用户难以快速回答三个核心问题：

1. 这个连接现在是否可用？
2. 它配置了哪些 schema？
3. 我下一步应该做什么？

#### 决议

将连接卡片调整为“连接摘要行 + schema 资产表 + 操作区”的结构。

建议布局：

```text
demo-mysql        MySQL · Read-only expected        Not tested
上次刷新：2026-07-29 22:57 · 成功 · 1 个提示

Schema          本地 YAML        表数        状态
dataforai       已存在           3           可维护白名单
openclaw_db     缺失 manifest    0           可上传 YAML

[添加 Schema] [上传 YAML] [测试连接] [刷新本地目录]
```

“连接配置来自当前项目，不在 WebUI 中直接编辑凭据。”应降级为小型说明：

```text
配置来源：ktx.yaml。凭据不在 WebUI 中编辑。
```

不要把这句话作为大卡片标题。

### 3.3 Add Schema 抽屉引导不清晰

当前文案存在认知冲突：

```text
全程在本地完成，不会触碰凭据。
添加前会自动调用 ktx connection test demo-mysql。
```

连接测试必然会使用当前项目已有凭据验证连通性。用户会困惑：到底是否使用凭据、是否访问数据库、是否扫描物理库。

#### 决议

文案必须区分三件事：

| 动作 | 是否使用凭据 | 是否扫描物理库 | 是否写文件 |
|---|---:|---:|---:|
| 连接测试 | 是，使用现有项目凭据 | 否，只验证连通与访问 | 否 |
| 添加 schema | 否 | 否 | 是，写 `ktx.yaml` |
| 上传 YAML | 否 | 否 | 是，写 `semantic-layer/.../_schema/*.yaml` |
| 刷新本地目录 | 否 | 否 | 否，只读本地文件 |

Add Schema 推荐流程：

```text
1. 输入 Schema 名
2. 测试连接可用性
3. 写入 ktx.yaml 并完成
4. 可选：上传该 Schema 的 YAML 资产
```

Step 3 成功文案：

```text
已将 openclaw_db 写入 ktx.yaml。
WebUI 不会自动扫描物理数据库。若你已有该 Schema 的 manifest YAML，可以现在上传；否则稍后由离线流程生成后上传。
[上传 YAML] [完成]
```

### 3.4 “重新加载资产”语义不清

“资产”太抽象，用户容易误解为：

- 重新扫描数据库。
- 重新生成语义层。
- 重新执行 ingest。
- 重新读取凭据。

#### 决议

统一改名为：

```text
刷新本地目录
```

或在更技术的上下文中使用：

```text
重新读取 YAML
```

推荐主文案使用“刷新本地目录”，帮助配置人员理解它只读本地文件。

使用场景说明：

- 手动修改了 `ktx.yaml`。
- 上传了 schema manifest YAML。
- 添加或删除了 `semantic-layer/**/*.yaml` 文件。
- `git pull` 后本地语义层资产变化。
- 添加 Schema 后，想让 WebUI 重新识别配置与本地 manifest 状态。
- 白名单页出现 manifest missing warning，补齐 YAML 后需要刷新。

按钮旁可放 info tooltip：

```text
重新读取 ktx.yaml 和 semantic-layer YAML，不会连接数据库，也不会执行 ingest。
```

## 4. 页面规格

### 4.1 `/connections/*` Header 通用规格

适用于：

- `/connections` 连接概览。
- `/connections/whitelist` 表白名单。
- `/connections/test` 连通测试。

Header 固定结构：

```text
数据库接入 / <当前页面>
<当前页面标题>
<一句话说明>
[/data/lucy]
```

规则：

- 不展示右上角跨页面导航按钮。
- 不展示页面主体已有的重复指标。
- 不把 `刷新本地目录`、`上传 YAML`、`测试连接` 等业务动作放入 Header 右侧。
- 页面动作进入页面主体工具栏；连接动作进入连接卡片或 schema 上下文。

### 4.2 `/connections` 连接概览

#### Header

删除 Header 右侧跨页面导航按钮：

- `表白名单`
- `连通测试`
- `打开表目录`

Header 不再重复展示已由指标卡覆盖的信息。仅保留页面标题、描述与极简环境路径 Badge。

#### Metric Cards

保留 4 张指标卡即可：

1. 数据连接。
2. 启用的表。
3. 语义层对象。
4. Catalog 状态。

不要新增“上传数量”等短期过程指标，上传历史应放在连接卡片或审计详情里。

#### Connection Card

连接卡片必须高效扫描：

- 首行：连接名、driver、read-only 期望、连通状态。
- 次行：配置来源、上次本地目录刷新状态。
- Schema 区：以表格或紧凑列表展示 schema、manifest 状态、表数量、下一步动作。
- 操作区：动作按钮按工作流排序。

推荐操作区：

```text
[添加 Schema] [上传 YAML] [测试连接] [刷新本地目录]
```

按钮层级：

- 主按钮：根据当前缺口动态选择。
  - 如果有 schema 缺 manifest，主按钮为 `上传 YAML`。
  - 否则主按钮为 `添加 Schema` 或无主按钮。
- `刷新本地目录` 为次级按钮，不应长期占据主按钮位置。
- `测试连接` 为次级按钮或链接。

#### Schema 行

每个 schema 显示：

| 字段 | 说明 |
|---|---|
| Schema | `dataforai` / `openclaw_db` |
| YAML 状态 | `已存在` / `缺失 manifest` / `解析失败` |
| 表数 | 从本地 manifest 读取 |
| 下一步 | `维护白名单` / `上传 YAML` / `查看错误` |

### 4.3 `/connections/whitelist` 表白名单

白名单页继续作为 enabled tables 的维护页面。

新增/调整：

- Header 遵循 `/connections/*` 通用规格，不放右上角跨页面导航。
- 顶部主体工具栏常驻按钮文案从 `刷新本地表目录` 统一为 `刷新本地目录`。
- 空 Schema 区域提供上下文按钮：`上传该 Schema 的 YAML`。
- 保存按钮只写 `ktx.yaml enabled_tables`，不触发 reload 和 CLI ingest。
- 支持 query param 预选 Schema：`/connections/whitelist?schema=<schema>`。从上传成功页跳转而来时，Schema 筛选自动选中对应 schema。
- 保存后提示：

```text
已保存白名单变更。若你同时更新了 YAML 文件，请刷新本地目录。
```

### 4.4 `/connections/test` 连通测试

连通测试页 Header 遵循 `/connections/*` 通用规格。

页面主体保留：

- 连接选择。
- 重新测试连接按钮。
- 结构化诊断看板。
- 可展开原始诊断日志。

不得在 Header 右侧重复放置 `表白名单`、`连接概览` 或 `打开表目录` 等跨页面导航。

### 4.5 `AddSchemaDrawer`

Add Schema 抽屉改为清晰四段：

1. 输入 Schema。
2. 可选连接测试说明。
3. 写入 `ktx.yaml`。
4. 上传 YAML 或完成。

文案建议：

```text
添加 schema 会写入 ktx.yaml，不会扫描物理数据库。
连接测试会使用当前项目已有凭据验证访问权限。
```

提交成功后：

```text
openclaw_db 已添加到 demo-mysql。
下一步可以上传该 schema 的 YAML manifest，或稍后刷新本地目录。
```

动作：

```text
[上传 Schema Manifest] [刷新本地目录] [完成]
```

其中 `刷新本地目录` 只有在已有本地 manifest 文件时才有意义；如果刚添加 schema 但没有 YAML，优先引导上传。

## 5. 受控 YAML 上传规格

### 5.1 MVP 范围

MVP 只支持上传 schema manifest：

```text
semantic-layer/<connection>/_schema/<schema>.yaml
```

上传方式：

1. 用户在 WebUI 选择 `.yaml` / `.yml` 文件，或直接粘贴 YAML 源码。
2. 前端读取文本内容。
3. 前端提交 JSON 给后端。
4. 后端 validate。
5. validate 通过后，用户确认上传。
6. 后端原子写入目标路径。
7. 后端记录上传历史。
8. 后端触发静态 Catalog reload。

### 5.2 Validate 规则

必须校验：

- `connectionId` 存在于 `ktx.yaml`。
- `schema` 已配置在该 connection 的 schemas 中。
- 文件大小不超过 512 KB。
- 文件名扩展名为 `.yaml` 或 `.yml`。
- YAML 可解析。
- YAML 顶层包含可识别的 schema manifest 表清单。
- 表名数量大于 0 时展示 parsed summary；等于 0 时允许 warning，但需要用户确认。
- 目标路径只能是 `semantic-layer/<connection>/_schema/<schema>.yaml`。
- 目标路径必须由后端内部计算，不能来自前端 request。
- 后端计算候选路径时必须使用 `path.resolve(projectRoot, targetPath)` 归一化。
- 后端必须使用 `fs.realpath(projectRoot)` 与 `fs.realpath(projectRoot/semantic-layer)` 获取真实根目录。
- 对目标父目录执行 `realpath`，并使用 `path.relative(realSemanticLayerRoot, realTargetParent)` 判断其位于真实 `semantic-layer` 根目录下。
- 不得使用裸 `startsWith` 作为唯一目录包含判断。
- 若目标目录链路中存在 symlink，MVP 可直接拒绝写入并返回 `PATH_NOT_ALLOWED`。
- 若目标文件已存在，必须确认目标文件本身不是 symlink 后才允许覆盖。

禁止：

- 任意 path 参数。
- `../` 路径穿越。
- 绝对路径。
- 写入 `.ktx/secrets/**`。
- 写入 `ktx.yaml`。
- 写入 overlay 文件，除非未来另有 spec。

### 5.3 覆盖规则

如果目标文件已存在：

- validate 响应必须包含 `exists: true`。
- UI 必须显示“将覆盖现有 YAML”。
- upload 请求必须带 `confirmOverwrite: true`。
- 后端应在 sidecar 中记录 `overwritten: true`。

MVP 不要求内置版本回滚，但应保留审计记录，未来可扩展为版本历史。

### 5.4 审计记录

记录到：

```text
.ktx-ui/catalog-asset-uploads.json
```

保留最近 50 条。

字段：

```ts
type CatalogAssetUploadRecord = {
  id: string;
  createdAt: string;
  connectionId: string;
  schema: string;
  assetType: "schemaManifest";
  targetPath: string;
  originalFilename: string;
  sizeBytes: number;
  sha256: string;
  tables: number;
  overwritten: boolean;
  warnings: CatalogAssetWarning[];
  reloadRunId?: string;
};
```

不得记录文件正文、凭据、token 或个人敏感信息。

## 6. API 契约

### 6.1 `POST /api/catalog/assets/validate`

Request:

```ts
type CatalogAssetValidateRequest = {
  connectionId: string;
  schema: string;
  assetType: "schemaManifest";
  filename: string;
  content: string;
};
```

Response:

```ts
type CatalogAssetValidateResponse = {
  valid: boolean;
  connectionId: string;
  schema: string;
  assetType: "schemaManifest";
  targetPath: string;
  exists: boolean;
  originalFilename: string;
  sizeBytes: number;
  sha256: string;
  tables: number;
  tableNames: string[];
  warnings: CatalogAssetWarning[];
  errors: CatalogAssetError[];
};
```

规则：

- 只 validate，不写盘。
- `valid: false` 时 `errors` 必须可直接展示给用户。
- 路径为项目相对路径，不返回绝对路径。

### 6.2 `POST /api/catalog/assets/upload`

Request:

```ts
type CatalogAssetUploadRequest = CatalogAssetValidateRequest & {
  confirmOverwrite?: boolean;
};
```

Response:

```ts
type CatalogAssetUploadResponse = {
  uploaded: true;
  record: CatalogAssetUploadRecord;
  validation: CatalogAssetValidateResponse;
  reload: CatalogReloadRun;
};
```

规则：

- 内部必须复用 validate。
- 若目标文件存在但未传 `confirmOverwrite: true`，返回 409。
- 写盘后调用 `reloadCatalog({ connectionId, schema })`。
- 写盘使用 temp file + rename，避免半文件状态。

### 6.3 `GET /api/catalog/assets/uploads`

Response:

```ts
type CatalogAssetUploadsResponse = {
  records: CatalogAssetUploadRecord[];
  lastBySchema: Record<string, CatalogAssetUploadRecord>;
};
```

`lastBySchema` key 格式：

```text
<connectionId>.<schema>
```

## 7. 组件规格

新增共享组件：

- `CatalogAssetUploadButton`
- `CatalogAssetUploadDrawer`
- `CatalogAssetValidationPanel`
- `CatalogAssetUploadHistoryBadge`

共享 hook：

- `useCatalogAssetUpload`

输入模式：

1. 文件拖拽 / 选择：接受 `.yaml`、`.yml`。
2. YAML 源码直接粘贴：MVP 使用 `Textarea`；如果项目后续已有统一代码编辑器依赖，可升级为 Monaco，但 M17 不为此单独引入 Monaco。

状态：

1. Idle：选择文件或粘贴 YAML。
2. Validating：校验中。
3. Validation Failed：展示错误，不允许上传。
4. Ready To Upload：展示目标路径、表数量、warning、覆盖提示。
5. Uploading：按钮 loading。
6. Uploaded：展示成功结果、reload 统计、下一步入口。

成功文案示例：

```text
已上传 openclaw_db.yaml
解析到 12 张表，并已刷新本地目录。
```

上传成功后的 Drawer 底部动作：

```text
[前往配置表白名单 ->] [完成并关闭]
```

规则：

- `前往配置表白名单 ->` 为 Primary，跳转到 `/connections/whitelist?schema=<schema>`。
- `完成并关闭` 为 Secondary，只关闭 Drawer。
- 如果上传入口已锁定 connection，跳转后白名单页必须保留该 schema 筛选；如果未来支持多 connection，再追加 connection query param。

失败文案示例：

```text
YAML 无法解析：第 14 行缩进错误。
```

## 8. 验收标准

### 8.1 产品验收

- `/connections`、`/connections/whitelist`、`/connections/test` Header 不再出现重复跨页面导航按钮。
- 三个数据库接入子页面 Header 仅保留标题、描述与极简环境路径 Badge。
- 连接卡片能在 5 秒内让用户看清连接状态、schema 状态与下一步动作。
- “重新加载资产”统一改为“刷新本地目录”或“重新读取 YAML”。
- UI 明确说明刷新本地目录不会连接数据库、不会执行 ingest。
- Add Schema 抽屉明确区分连接测试、写 `ktx.yaml`、上传 YAML、刷新本地目录。
- 分析师可以在 WebUI 通过文件选择/拖拽或 YAML 文本粘贴上传 schema manifest YAML，无需运维手工放文件。
- 上传后 Catalog 自动刷新，白名单页可以看到新表。
- 上传成功后点击 `前往配置表白名单 ->` 会跳转到 `/connections/whitelist?schema=<schema>`，并自动选中对应 Schema 筛选。

### 8.2 安全验收

- 上传端点不能写入任意路径。
- 不能读取或写入 `.ktx/secrets/**`。
- 不能覆盖 `ktx.yaml`。
- 不能通过 filename/path 注入写出项目目录。
- 路径防护必须覆盖 symlink 绕过：目标父目录和已有目标文件不能通过 symlink 指向 `semantic-layer` 外部。
- 审计记录不包含 YAML 正文和敏感信息。
- 所有错误日志不泄露凭据。

### 8.3 技术验收

- `POST /api/catalog/assets/validate` 覆盖成功、解析失败、未知 connection、未配置 schema、路径穿越、超大文件、目标已存在。
- `POST /api/catalog/assets/upload` 覆盖成功、409 覆盖保护、写盘后 reload。
- `/api/catalog/reload` 继续保持零 CLI / 零 LLM 依赖。
- `/connections`、`/connections/whitelist`、`AddSchemaDrawer` 测试更新。
- 构建通过：

```bash
npm test
npm run build
```
