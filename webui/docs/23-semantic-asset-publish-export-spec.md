# Semantic Asset Self-Service Publish And Export Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Semantic Asset Self-Service Publish And Export Spec |
| 文档类型 | Product / UX / API / Security Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-30 |
| 适用范围 | Lucy WebUI 语义资产自助上传、Dry-Run、发布、下载与审计：`/connections`、`/sources`、`/review`、新增语义资产发布入口 |
| 架构决议 | WebUI 从“受控上传 schema manifest”升级为“Staged Publish with Validate Gate + Sanitized Export with Secrets Hard Block” |
| 事实源 | `/data/lucy` 或项目根下的 `ktx.yaml`、`semantic-layer/**/*.yaml`、`wiki/`、`evals/`、`.ktx-ui/**` sidecar；`.ktx/secrets/**` 永不进入 WebUI 导出或审计正文 |
| 关联文档 | `webui/docs/17-static-catalog-loading-spec.md`、`webui/docs/21-connection-catalog-upload-ux-spec.md`、`webui/docs/12-semantic-layer-maintenance-ux-refresh.md`、`webui/docs/03-api-spec.md`、`docs/customer-deployment-guide.md`、`docs/DEVELOPMENT.md` |

## 1. 决策摘要

M17 已经让分析师可以通过 WebUI 上传受控 schema manifest：

```text
semantic-layer/<connection>/_schema/<schema>.yaml
```

但客户 K8s / Docker 私有化部署中的真实 Ops 流程还包括另一类高频资产：

```text
semantic-layer/<connection>/<source>.yaml
```

这类文件承载业务语义源、grain、measures、segments、派生 columns 和 joins。当前流程仍需要运维工程师从后台复制 YAML、重启或 reindex，造成版本漂移、交接不稳定和排障低效。

本规格作出三个产品级决议：

1. WebUI 支持分析师自助提交 semantic asset package，覆盖 schema manifest 与 semantic overlay/source YAML。
2. “发布语义层”必须是强阻断流程：先在 staging project 中完成 YAML parse 与 `ktx sl validate`，全部通过后才允许写入正式 PVC，并且只有写入成功后才运行 `ktx admin reindex`。
3. “下载当前全量资产包”必须走安全白名单导出，强制排除 secrets、token、`.env`、私钥和明文凭据。

## 2. 目标用户与职责边界

| 角色 | 责任 | WebUI 应释放的时间 |
|---|---|---|
| 分析师 / 语义资产 Owner | 上传、编辑、Dry-Run、Diff、发布、下载语义资产包 | 不再等待运维复制 YAML 或返回当前版本 |
| 运维工程师 / 平台底座 Guard | K8s PVC、Secret、数据库网络、Lucy Backend、MCP Proxy 健康 | 不再介入日常 YAML 搬运和版本查找 |
| 管理员 / 审计方 | 查看发布历史、diff、hash、validate/reindex 结果 | 能追踪谁在何时发布了哪批语义资产 |

目标工作流：

```text
分析师
  -> 选择 connection / schema
  -> 上传 manifest 与 overlay YAML
  -> Dry-Run 解析、路径预览、Diff
  -> 点击发布语义层
  -> Staging validate gate
  -> Atomic promote 到正式 PVC
  -> KTX reindex
  -> 下载当前全量资产包用于排障或归档

运维
  -> 保障 /data/lucy 可写且持久
  -> 托管数据库凭据与网络连通
  -> 保障 Lucy Backend 与 MCP Proxy 容器存活
```

## 3. 设计原则

### 3.1 Source Of Truth 不变

正式事实源仍然是项目根或客户部署目录：

```text
ktx.yaml
semantic-layer/
wiki/
evals/
skills/
webui/config/access.yaml
.ktx-ui/
```

WebUI 不引入第二套数据库事实源。上传、发布、下载都是围绕这些文件做受控读写。

### 3.2 Staged Publish With Validate Gate

发布流程必须避免坏配置进入 Agent 索引。后端不得把未校验内容直接写入正式 `semantic-layer/` 后再尝试 validate。

强制流程：

```text
上传/编辑内容
  -> YAML Parse
  -> 构建 staging project
  -> ktx sl validate changed sources --project-dir <staging>
  -> 全部成功
  -> atomic promote 写入正式 PVC
  -> release 状态置为 reindexing 并立即返回 releaseId
  -> 后台执行 ktx admin reindex
  -> static catalog reload
  -> 更新发布批次终态
```

阻断规则：

- YAML parse 失败：不写 staging，不写正式 PVC，不 reindex。
- `ktx sl validate` 失败：丢弃 staging，不写正式 PVC，不 reindex。
- atomic promote 失败：不 reindex，发布批次标记 `promote_failed`。
- promote 成功后，HTTP publish 请求不得同步等待 reindex 完成，避免 K8s Ingress / ALB / Cloudflare 504 timeout 造成前端与后端状态不一致。
- `ktx admin reindex` 失败：正式文件已写入，但发布批次标记 `reindex_failed`，UI 必须提示 Agent 索引未更新。
- 前端通过 release status 轮询或 SSE 展示 `reindexing -> published/reindex_failed`，MVP 优先轮询。

### 3.3 Sanitized Export With Secrets Hard Block

导出只能从白名单收集文件，不允许“先全量打包再排除”。任何导出逻辑必须默认拒绝未知路径。

允许导出：

| 路径 | 规则 |
|---|---|
| `ktx.yaml` | 只能导出 sanitized 版本，`host`、`port`、`username`、`password` 必须替换为 `<REDACTED>` |
| `semantic-layer/**/*.yaml` | 允许导出，禁止跟随 symlink |
| `wiki/**/*.md` | 允许导出，禁止跟随 symlink |
| `evals/**/*.yaml` | 允许导出，禁止跟随 symlink |
| `skills/**` | 可选，必须先做敏感词扫描与文件类型白名单 |

绝不允许导出：

```text
.ktx/secrets/**
.env
*.pem
*.key
*.p12
node_modules/**
.git/**
raw-sources/**
.ktx-ui/audit.sqlite
任何包含 password/token/secret/api_key/authorization 明文的物理配置文件
```

`webui/config/access.yaml` 默认不进入全量资产包。若未来需要导出，必须生成 sanitized 版本，只包含 role 结构与 token hash 摘要，不包含 token 明文。

### 3.4 K8s 多副本写入必须单写者

客户 K8s 部署必须满足：

- Lucy Backend 对 `/data/lucy` 有写权限。
- `/data/lucy` 由 PVC 或等价持久化存储承载。
- M19 MVP 仅承诺 Lucy Backend single-replica / RWO PVC 写入模型。
- 多副本部署必须通过平台层保证 publish API 单写者，例如 API gateway 单路由、独立 worker、Lease、数据库锁或对象存储锁。
- 发布、promote、reindex 不允许两个请求并发执行。

MVP 可使用 `.ktx-ui/semantic-publish.lock` 作为单实例保护。不得宣称文件锁或 SQLite 锁可在 NFS / RWX PVC / 多 Pod 上提供可靠互斥；这类部署必须由平台层提供外部一致性锁或单 writer 拓扑。

### 3.5 Diff 与核心路径保持 Zero Native Binary

Dry-Run unified diff 必须使用纯 JS 实现，例如当前仓库已使用的 `diff` / jsdiff。WebUI 后端不得通过 `child_process` 调用宿主机 `diff` CLI，避免 Alpine、Distroless、极简容器或受限 PATH 环境中缺少系统命令导致 Dry-Run 失败。

## 4. 资产类型

### 4.1 Schema Manifest

目标路径：

```text
semantic-layer/<connection>/_schema/<schema>.yaml
```

识别形态：

```yaml
tables:
  source_name:
    table: schema.table_name
    columns:
      - name: id
        type: number
```

校验要求：

- 顶层必须有 `tables` mapping。
- `connection` 必须存在于 `ktx.yaml`。
- `schema` 必须存在于该 connection 的 `schemas`。
- 表清单可为空，但必须 warning 并要求用户确认。

### 4.2 Semantic Overlay / Source

目标路径：

```text
semantic-layer/<connection>/<source>.yaml
```

识别形态：

```yaml
name: international_country_metrics
table: chatbi.ai_metric_international_country_daily
grain:
  - date
measures:
  - name: dau
    expr: sum(dau)
segments:
  - name: valid_rows
    expr: date is not null
```

校验要求：

- `name` 必须是安全 source id。
- `table` 必须是 `<schema>.<table>`，且 schema 在 connection 配置中存在。
- 文件名必须与 `name` 一致，或 UI 明确提示将按 `name` 落盘。
- 允许 source 名不同于底表名。
- `columns` 中的派生列可以带 `expr`；不得把派生列写入 `_schema` manifest。
- `measures[].expr`、`segments[].expr`、`joins[].on` 的语义合法性由 `ktx sl validate` gate 决定。

### 4.3 Package Upload

MVP 支持两种输入：

1. 多文件选择 / 拖拽。
2. `.zip` 或 `.tar.gz` 包。

包内路径只作为分类线索，不能直接作为写入路径。后端必须解析内容后重新计算目标路径。

限制建议：

| 项 | 默认上限 |
|---|---:|
| 单文件大小 | 512 KB |
| 包内 YAML 文件数 | 50 |
| 解压后总文本大小 | 3 MB |
| 包内路径深度 | 6 |

若包内出现 symlink、绝对路径、`../`、二进制文件或未知扩展，必须拒绝或忽略并给出 structured warning；不得写入。

## 5. 发布生命周期

### 5.1 Dry-Run

Dry-Run 必须返回：

- asset 分类结果。
- 后端计算的目标路径。
- 覆盖风险。
- 文件 hash。
- 解析出的 source/table/schema。
- unified diff。
- changed source 列表。
- warnings 和 errors。

Dry-Run 不写正式文件，不 reindex。

### 5.2 Validate Gate

后端为 Dry-Run 或 Publish 构建 staging project：

```text
.ktx-ui/staging/semantic-publish/<batch-id>/
  ktx.yaml
  semantic-layer/
  wiki/
  evals/
```

规则：

- 不复制 `.ktx/secrets/**` 内容。
- `ktx.yaml` 中的 `password: file:` 引用保持原值；validate 若需要连库，由 KTX 读取原有 secret 文件。
- staging 中应用本次 proposed files。
- 对每个 changed source 串行执行 `ktx sl validate <source> --connection-id <connection>`。
- 任一失败立即阻断。
- Publish 完成、blocked 或 failed 后，必须在 `finally` 中删除该次 staging 目录。
- 服务启动时和每次 validate/publish 前必须执行 opportunistic cleanup，删除超过 1 小时的 `.ktx-ui/staging/semantic-publish/*` 废弃目录。
- staging 目录禁止无限增长；GC 失败必须写 warning，不得影响正式文件安全边界。

### 5.3 Atomic Promote

validate 全部通过后，正式写入：

- 单文件：同目录 temp file + rename。
- 多文件：先写入所有 temp file，再逐个 rename；失败时必须保留可诊断记录。
- 不允许覆盖 symlink。
- 覆盖必须要求用户确认。

### 5.4 Async Reindex

promote 成功后，publish API 将 release 状态置为 `reindexing` 并返回。后端后台执行：

```bash
ktx --project-dir <projectRoot> admin reindex
```

MVP 可使用普通增量 reindex；若用户显式选择“彻底重建索引”，才使用 `--force`。

规则：

- validate 失败绝不执行 reindex。
- promote 失败绝不执行 reindex。
- publish HTTP response 不同步等待 reindex 完成。
- reindex 失败不回滚文件，但发布状态必须显示 `reindex_failed`。
- reindex stdout/stderr 进入发布记录摘要，敏感字段需 redaction。
- 前端通过 `GET /api/semantic-assets/releases/:id/status` 轮询终态；SSE 是后续增强，不作为 M19 必需。

### 5.5 Release Record

发布记录写入：

```text
.ktx-ui/semantic-asset-releases.json
```

保留最近 100 条。

字段：

```ts
type SemanticAssetReleaseRecord = {
  id: string;
  createdAt: string;
  actor: string;
  status: "blocked" | "promote_failed" | "reindexing" | "published" | "reindex_failed";
  connectionIds: string[];
  files: Array<{
    targetPath: string;
    kind: "schemaManifest" | "semanticSource" | "wiki" | "eval";
    sha256: string;
    overwritten: boolean;
  }>;
  changedSources: Array<{ connectionId: string; sourceName: string }>;
  diff?: string;
  validation: {
    ok: boolean;
    results: Array<{
      connectionId: string;
      sourceName: string;
      ok: boolean;
      exitCode: number;
      stdout?: string;
      stderr?: string;
      issues: Array<{ message: string; filePath?: string; line?: number; column?: number }>;
    }>;
  };
  reindex?: {
    ok: boolean;
    exitCode: number;
    stdout?: string;
    stderr?: string;
  };
};
```

Sidecar 不得存储 uploaded YAML 正文。

## 6. API 契约

### 6.1 `POST /api/semantic-assets/validate`

Request:

```ts
type SemanticAssetValidateRequest = {
  files: Array<{
    filename: string;
    content: string;
  }>;
  defaultConnectionId?: string;
  defaultSchema?: string;
};
```

Response:

```ts
type SemanticAssetValidateResponse = {
  valid: boolean;
  validationId: string;
  files: SemanticAssetFilePreview[];
  changedSources: Array<{ connectionId: string; sourceName: string }>;
  diff: string;
  warnings: SemanticAssetWarning[];
  errors: SemanticAssetError[];
};
```

`valid: true` 只表示文件解析与路径计算通过。是否可发布还取决于 publish 阶段重新执行的 validate gate。

### 6.2 `POST /api/semantic-assets/publish`

Request:

```ts
type SemanticAssetPublishRequest = {
  validationId: string;
  confirmOverwrite?: boolean;
};
```

Response:

```ts
type SemanticAssetPublishResponse = {
  accepted: boolean;
  release: SemanticAssetReleaseRecord;
};
```

规则：

- 必须重新加载 validation snapshot，不能信任前端传回的 paths 或 content。
- 必须重新跑 staging validate gate，避免 TOCTOU。
- 失败返回 `ok:false` 时，`data.release` 可包含 blocked 记录供 UI 展示。
- promote 成功后必须立即返回 `accepted: true` 与 `release.status: "reindexing"`，不得同步等待 reindex 完成。

### 6.3 `GET /api/semantic-assets/releases/:id/status`

返回单个 release 的当前状态，用于前端轮询：

```ts
type SemanticAssetReleaseStatusResponse = {
  release: SemanticAssetReleaseRecord;
};
```

状态流转：

```text
blocked
promote_failed
reindexing -> published
reindexing -> reindex_failed
```

### 6.4 `GET /api/semantic-assets/releases`

返回最近发布记录。

### 6.5 `POST /api/semantic-assets/export`

Request:

```ts
type SemanticAssetExportRequest = {
  scope?: {
    connectionId?: string;
    schema?: string;
  };
  includeWiki?: boolean;
  includeEvals?: boolean;
  includeSkills?: boolean;
  includeSanitizedKtxYaml?: boolean;
};
```

Response:

```ts
type SemanticAssetExportResponse = {
  exportId: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
  includedFiles: string[];
  excludedFiles: Array<{ path: string; reason: string }>;
};
```

下载 URL 必须指向短期临时文件，默认存放：

```text
.ktx-ui/exports/<export-id>.zip
```

导出记录不包含文件正文。

## 7. UI 规格

### 7.1 语义资产发布入口

入口建议：

- `/connections` connection card：`上传语义包`。
- `/sources` 或 Catalog：`发布语义层`。
- `/review`：当存在 semantic-layer 变更时展示 `发布并 reindex`。

上传 Drawer 状态：

1. Idle：拖拽文件、选择文件或粘贴 YAML。
2. Parsed：展示 asset 分类和目标路径。
3. Dry-Run：展示 diff、warnings、覆盖提示。
4. Ready To Publish：按钮 `发布语义层` 可用。
5. Publishing：展示 validate、promote 步骤。
6. Reindexing：publish API 已返回 release id，前端轮询 release status 并展示 reindex 进度状态。
7. Published：展示 release id、文件数、changed sources、reindex 结果、下载入口。
8. Blocked：展示失败阶段、具体 issue、文件与行号。

### 7.2 Validate Gate 反馈

错误展示优先级：

1. YAML parse 行号/列号。
2. asset 分类错误：未知 connection、未配置 schema、source name 不安全。
3. `ktx sl validate` issue：source、measure/segment/column、stderr 摘要。
4. promote/reindex 系统错误。

UI 不得把 blocked 状态显示为 partial success。

### 7.3 下载当前资产包

页面提供：

```text
下载当前全量资产包 (.zip)
```

点击后：

- 后端按白名单打包。
- UI 展示 included/excluded summary。
- 明确显示 “Secrets 已强制排除”。
- 若 sanitized `ktx.yaml` 不可生成，则允许继续导出 semantic-layer，但 warning。

## 8. 安全验收

- validate/publish/export 端点不能接受任意目标路径。
- 所有目标路径由后端根据 asset 内容和选定 connection 计算。
- 不读取、不写入、不导出 `.ktx/secrets/**`。
- 导出时不跟随 symlink。
- 上传包内 symlink、绝对路径、`../` 必须被拒绝。
- `ktx.yaml` 导出必须脱敏。
- `ktx.yaml` 导出必须将 `host`、`port`、`username`、`password` 强制替换为 `<REDACTED>`。
- `.env`、私钥、token 明文、audit sqlite 不得进入 zip。
- validate 失败严禁写正式 PVC。
- validate 失败严禁 reindex。
- 发布操作必须有并发锁。
- 发布记录不得保存 YAML 正文。
- staging 目录必须在 publish 成功、blocked、failed 后清理；超过 1 小时的废弃 staging 目录必须被 opportunistic GC 清理。
- M19 MVP 只承诺 single-replica / RWO PVC；多 Pod / RWX PVC 必须由平台层提供单写者保障。

## 9. 技术验收

- manifest + overlay 多文件上传能生成正确 target paths。
- source 名不同于物理表名的 overlay 能被识别、validate、发布。
- validate gate 失败时正式文件 hash 不变。
- promote 成功后启动异步 reindex，且 UI 能展示 reindex 结果。
- publish API 在 promote 成功后返回 `reindexing`，不会因长时间 reindex 被 Ingress 504 误判为失败。
- 前端能通过 release status 轮询看到 `published` 或 `reindex_failed`。
- reindex 失败时发布记录为 `reindex_failed`。
- 导出 zip 不包含 hard-block 路径。
- 导出 zip 中的 `ktx.yaml` 不包含 host、port、username、password 明文或 token。
- Dry-Run diff 使用纯 JS diff 实现，不调用系统 `diff` CLI。
- K8s 单副本 PVC 场景下，发布后 Pod 重启仍能看到新 YAML。
- 定向测试通过：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- semantic-assets semantic-export catalog-asset-upload table-editor review
```

## 10. 非目标

- 不在本规格中实现物理数据库 scan / ingest。
- 不把 WebUI 变成 Git hosting 或 PR 系统。
- 不实现完整多人 RBAC 登录；MVP 可沿用本地管理台假设，企业版再接入 WebUI auth。
- 不把 `.ktx/secrets/**` 纳入任何导出、审计正文或 UI 预览。
- 不承诺跨 Pod 分布式锁的具体实现，MVP 先单实例锁，K8s 多副本另开平台部署规格。
- 不在 M19 实现 rollback API；`POST /api/semantic-assets/releases/:id/rollback` 留作 M20 或后续版本扩展。

## 11. 实施工单

实施按 [wo-M19-semantic-asset-publish-export.md](plans/wo-M19-semantic-asset-publish-export.md) 执行。
