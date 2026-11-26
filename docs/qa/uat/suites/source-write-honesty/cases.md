# Cases — UAT-SUITE-SOURCE-WRITE-HONESTY

> 口径：对齐 Spec v1.0（SC-01–SC-08；D3＝D3a）。合同回链：Spec [`lucy-20261125-source-write-api-honesty-spec.md`](../../../../specs/lucy-20261125-source-write-api-honesty-spec.md)。
> 推荐执行顺序：`UAT-R0` → `UAT-SWH-01` → `UAT-SWH-02` → `UAT-SWH-03` → `UAT-SWH-04` → `UAT-SWH-05` → `UAT-SWH-06`。
> 本套件无特殊夹具；使用 demo 现成连接（如 `mysql-aliyun`／`dataforai`）即可，写盘用例须在跑次记录前后文件/版本对照。

| ID | 标题 | 层级 | 合同回链 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | — | demo healthy；API 直连可达 |
| UAT-SWH-01 | PUT 空补丁落盘请求 → 诚实零写入 | API 全真 | Spec SC-01 | `200 written:false`＋`noChanges:true`＋`writtenFiles:[]`；无新版本快照、无 changedSources 登记、磁盘文件不变 |
| UAT-SWH-02 | 合同外顶层字段 → 400 ＋机器可读下一步 | API 全真 | Spec SC-02 | `400 INVALID_SOURCE_PATCH_BODY`＋`data.nextSteps` 数组＋消息含正确字段指引 |
| UAT-SWH-03 | `patch.tableDescription` 写 Manifest `descriptions.human` | API 全真 | Spec SC-03 | `written:true`、`writtenFiles` 含 Schema Manifest 路径、`db`/`ai` 子键保留 |
| UAT-SWH-04 | 导入三分流（结构片段／业务 source＋schema 键／纯业务 source） | API 全真 | Spec SC-04／05／06 | 结构片段写 Manifest 保留 pk；`descriptions` 豁免＋`IMPORT_SCHEMA_KEYS_IGNORED`；纯业务 source overlay-only 无 warnings |
| UAT-SWH-05 | dryRun 零变更与有变更对照 | API 全真 | Spec SC-07 | 零变更 `noChanges:true` 且 `files:[]`；有变更 `noChanges:false` 且 `diff`/`files` 非空 |
| UAT-SWH-06 | WebUI 表编辑器保存提示（有变更／无变更／失败三态） | 浏览器全真 | Spec SC-08 | 有变更「已保存到语义层」；无变更「内容无变更，未写入」；失败错误面不变；1920×1080＋计时 |

---

## UAT-R0 — 环境门禁

### 目的

确认 demo 环境就绪，后续用例结果可归因。

### 前置

本机 demo compose 已启动。

### 步骤

1. `curl -sS http://127.0.0.1:55176/api/health` → 确认服务健康并记录 `gitSha`、`lucyVersion`、`ktxRuntime`。
2. `curl -sS http://127.0.0.1:55176/api/sources` → 确认 API 直连可达并选定一个可用表（记录 conn/schema/table）。

### 期望

WebUI 就绪、API 直连 200，选定表存在且可读。

---

## UAT-SWH-01 — PUT 空补丁落盘请求 → 诚实零写入（SC-01）

### 目的

验证 `dryRun:false` 且补丁无实际变更时返回诚实零写入，且不产生任何副作用。

### 前置

UAT-R0 PASS；选定表的当前 YAML、`.ktx-ui/table-yaml-history/` 版本列表与 `changedSources` 登记状态已记录基线。

### 步骤

1. 记录基线：versions 列表（`GET /api/sources/:conn/:schema/:table/versions`）、Manifest 与 overlay 文件内容与 mtime、changedSources 登记。
2. `PUT /api/sources/:conn/:schema/:table`，body `{ "patch": {}, "dryRun": false }`（或与现状等值的补丁）。
3. 复查步骤 1 的三处基线。

### 期望

- 返回 `200 { written:false, noChanges:true, writtenFiles:[], validation, changedFiles }`。
- versions 列表不变（**无**新版本快照）；changedSources **无**新登记；磁盘文件内容与 mtime 不变（显示缓存失效亦未触发）。

---

## UAT-SWH-02 — 合同外顶层字段 → 400 INVALID_SOURCE_PATCH_BODY（SC-02）

### 目的

验证写接口请求体白名单校验与机器可读下一步。

### 前置

UAT-R0 PASS。

### 步骤

1. `PUT /api/sources/:conn/:schema/:table`，body 含合同外顶层字段 `yaml`（如 `{ "yaml": "...", "dryRun": false }`）及另一例 `model`。
2. `POST /api/sources/:conn/:schema/:table/import`，body 含合同外顶层字段 `patch`／`model`／`confirmOverwrite`。
3. 检查两个接口的错误响应结构。

### 期望

- 两接口均返回 `400 INVALID_SOURCE_PATCH_BODY`；错误消息指明正确字段（PUT 指向 `patch.tableDescription` 等；import 指明导入请传 `yaml` 字段）。
- 响应含顶层 `data: { unknownKeys, allowedKeys, nextSteps }`；`nextSteps` 为字符串数组（机器可读下一步），禁止另造单数字段名。
- dryRun:true 与 dryRun:false 同样校验（两分支各验一次 PUT 合同外字段）。

---

## UAT-SWH-03 — `patch.tableDescription` 写 Manifest `descriptions.human`（SC-03）

### 目的

验证表描述补丁的正确落点与既有子键保留。

### 前置

UAT-R0 PASS；选定表的 Manifest 已有（或明确无）`descriptions.human`／`descriptions.db`／`descriptions.ai`，并记录基线。

### 步骤

1. `PUT /api/sources/:conn/:schema/:table`，body `{ "patch": { "tableDescription": "<新描述>" }, "dryRun": false }`。
2. 读取 Schema Manifest `semantic-layer/<conn>/_schema/<schema>.yaml` 核对该表节点。

### 期望

- 返回 `200 { written:true, noChanges:false, writtenFiles, validation, changedFiles, version }`；`writtenFiles` 含 `semantic-layer/<conn>/_schema/<schema>.yaml`。
- Manifest `descriptions.human` 更新为新描述；`descriptions.db`／`descriptions.ai` 子键保留（不改写、不删除）。
- 有新版本快照（versions 列表新增一条）。

---

## UAT-SWH-04 — 导入三分流（SC-04／05／06）

### 目的

验证 import 按分流规则（2026-08-25 P0/P1＋D3a）正确区分结构片段与业务 source，并在保护性丢弃时给出告警。

### 前置

UAT-R0 PASS；选定表的 Manifest `pk` 与既有 columns 已记录基线。

### Case A — 结构片段写 Manifest 保留 pk（SC-04）

#### 步骤

1. `POST .../import`，`yaml` 为仅含 `descriptions`／`columns`／`joins` 的结构片段（不含 `grain`/`measures`/`segments`），或含 `tables.<table>` 的 Schema Manifest 文档。
2. 核对 Manifest 表节点与响应 `warnings`。

#### 期望

- 全量合并入 Schema Manifest；`columns` 合并保留既有 `pk`/`nullable`（对照基线逐字段核对）。
- 无 `IMPORT_SCHEMA_KEYS_IGNORED` 告警。

### Case B — 业务 source＋descriptions（＋columns）（SC-05）

#### 步骤

1. `POST .../import`，`yaml` 为扁平业务 source（含 `grain`/`measures`/`segments` 任一），同时含表级 `descriptions` 与 `columns`。
2. 核对 Manifest、overlay 与响应 `warnings`。

#### 期望

- overlay 照常写入（`writtenFiles` 含 overlay 路径）。
- 表级 `descriptions` 豁免合并入 Manifest（D3a）。
- `columns`/`joins` 保护性丢弃（Manifest `pk` 不被冲掉），响应 `warnings` 含 `[{ code:"IMPORT_SCHEMA_KEYS_IGNORED", keys:["columns",...], hint:"业务 source 导入（含 grain/measures/segments）时 <keys> 不写入 Manifest；结构片段（仅 descriptions/columns/joins）导入或 PUT patch 可写" }]`。

### Case C — 业务 source 无任何 schema 键（SC-06）

#### 步骤

1. `POST .../import`，`yaml` 为仅含 `grain`/`measures`/`segments`（及 `name`/`table`）的扁平业务 source。
2. 核对响应与 Manifest。

#### 期望

- overlay-only 写入；`warnings: []`；Manifest 零 diff（或 `noChanges:true` 诚实零写入，视 Manifest 是否本就有该内容）。

### 通用期望（三分支共用）

- `dryRun:false` 零变更 → `{ written:false, noChanges:true, writtenFiles:[], validation, changedFiles, warnings }`；有写入 → `{ written:true, noChanges:false, writtenFiles, validation, changedFiles, version, warnings }`。
- 空 YAML → `400 INVALID_IMPORT_YAML`。

---

## UAT-SWH-05 — dryRun 零变更与有变更对照（SC-07）

### 目的

验证 dryRun 预览的诚实性：不虚报 diff，也不漏报。

### 前置

UAT-R0 PASS。

### 步骤

1. `PUT ...`（或 `POST .../import`）`dryRun:true` 且补丁与现状零变更 → 检查响应。
2. 同接口 `dryRun:true` 且补丁有实际变更（如改 `tableDescription`）→ 检查响应。
3. 确认两次 dryRun 均未落盘（文件与 versions 不变）。

### 期望

- 步骤 1：`{ diff, proposedYaml, files, noChanges }` 中 `noChanges:true` 且 `diff`/`proposedYaml`/`files` 为空。
- 步骤 2：`noChanges:false` 且 `diff`/`files` 非空。
- 两步均无磁盘写入、无新版本快照。

---

## UAT-SWH-06 — WebUI 表编辑器保存提示三态（SC-08）

### 目的

验证 WebUI 表编辑器保存链路的用户可见提示与后端诚实响应一致，且计时达标。

### 前置

UAT-R0 PASS；真实前台浏览器（Chrome，窗口 1920×1080），登录管理员；表编辑器页面 `/catalog/<conn>/<schema>/<table>` 可达。

### 步骤

1. **有变更保存**：修改表描述后点保存 → 记录「导航/点击→提示可见」计时与保存 API 耗时（分列）。
2. **无变更保存**：不做修改（或还原后）点保存 → 记录计时与 API 耗时。
3. **保存失败**：构造一次保存失败（如临时不可写场景或断开后端）→ 观察错误面。
4. 每步截图留存，计时数据写入跑次记录。

### 期望

- 步骤 1：提示「已保存到语义层」；步骤 2：提示「内容无变更，未写入」（不虚报保存成功）。
- 步骤 3：保存失败错误面不变（明确失败提示，不伪装成功）。
- 全程真实前台浏览器完成；「导航→提示可见」计时与 API 耗时**分列**记录；禁止用 vitest／CR 冒充本用例。
