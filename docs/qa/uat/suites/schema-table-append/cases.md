# Cases — UAT-SUITE-SCHEMA-TABLE-APPEND

> 口径：对齐 Spec v1.1（SC-01–SC-08）。合同回链：Spec [`lucy-20261125-schema-manifest-table-append-spec.md`](../../../../specs/lucy-20261125-schema-manifest-table-append-spec.md)。
> 推荐执行顺序：`UAT-R0` → `UAT-STA-01` → `UAT-STA-02` → `UAT-STA-03` → `UAT-STA-04` → `UAT-STA-05` → `UAT-STA-06` → `UAT-STA-07`。
> 本套件夹具需求见 [suite.md 边界](suite.md)：既有 100 表三段名 Manifest 追加 1 表、预置同名 standalone 触发反向告警；均用 demo 现成连接构造，跑次结束还原。

| ID | 标题 | 层级 | 合同回链 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | — | demo healthy；API 直连可达；MCP `:57881` 可用 |
| UAT-STA-01 | dryRun 预览不落盘且幂等 | API 全真 | Spec SC-01 | `200 { diff, proposedYaml, files, noChanges:false, warnings }`；diff 仅含新增表节点；磁盘不变；同一 payload 重复 dryRun 结果一致 |
| UAT-STA-02 | 正式追加成交＋catalog 可见＋MCP 可见 | API 全真＋MCP | Spec SC-02 | `written:true`；Manifest 仅新增该表节点（既有表节点逐字节不变）；`/api/sources` 含新表；enabled-tables 可启用；MCP `discover_data`／`lucy_read_source` 可见 |
| UAT-STA-03 | create-only：已存在表 409 | API 全真 | Spec SC-03 | `409 TABLE_ALREADY_EXISTS`＋`data.nextSteps` 指向 import；Manifest 字节不变 |
| UAT-STA-04 | 请求体与内容校验四类拒绝 | API 全真 | Spec SC-04 | 合同外字段 `400 INVALID_SCHEMA_APPEND_BODY`；column `expr`/`role`→`422 OVERLAY_ONLY_KEY`；三段名末尾段不一致→`422 TABLE_NAME_MISMATCH`；非法 YAML→`422 YAML_PARSE_ERROR`；非白名单节点键→`422 SCHEMA_APPEND_UNKNOWN_KEY`；均不落盘 |
| UAT-STA-05 | import 指引与 404／409 归一化 | API 全真 | Spec SC-05 | import 未登记表 `404 SOURCE_NOT_FOUND`＋`data.nextSteps` 指向追加端点；schema 不存在四路径 `404 SCHEMA_MANIFEST_NOT_FOUND`（非 500）；大小写多义 `409 AMBIGUOUS_SCHEMA` |
| UAT-STA-06 | 三段名追加＋四路径归一化＋反向 shadow 告警 | API 全真 | Spec SC-06 | 三段名以短键追加成功且落盘原样保留；`bidw` vs `BIDW` 四路径归一化命中；既有同名 standalone 时 dryRun 与正式写均输出 `EXISTING_STANDALONE_SHADOW` 且不阻断 |
| UAT-STA-07 | 写管线、恢复与审计 | API 全真（含中断恢复） | Spec SC-07 | 写盘经 ktx.yaml 写锁＋展示写屏障＋发布窗口＋恢复日志；模拟中断后不留半份文件；审计含 actor／端点／diff 摘要且不含凭据 |
| （文档审查） | 文档登记审查 | 文档审查 | Spec SC-08 | `webui/docs/03-api-spec.md` 与 `docs/SYSTEM_HANDBOOK.md` 已登记新端点、四路径归一化与「追加／更新／整文件替换」分工；SC-08 不设 API 用例，单列本行 |

---

## UAT-R0 — 环境门禁

### 目的

确认 demo 环境就绪，后续用例结果可归因。

### 前置

本机 demo compose 已启动。

### 步骤

1. `curl -sS http://127.0.0.1:55176/api/health` → 确认服务健康并记录 `gitSha`、`lucyVersion`、`ktxRuntime`。
2. `curl -sS http://127.0.0.1:55176/api/sources` → 确认 API 直连可达并选定一个可用连接／schema（记录 conn/schema）。
3. 确认 MCP `:57881` 探针可达（后续 SC-02 使用）。

### 期望

服务健康、API 直连 200、MCP 端口可用，选定连接／schema 存在。

---

## UAT-STA-01 — dryRun 预览不落盘且幂等（SC-01）

### 目的

验证追加端点 dryRun 分支返回完整预览信封、不落盘且幂等。

### 前置

UAT-R0 PASS；选定 conn/schema 的 Manifest 文件内容与 mtime 已记录基线。

### 步骤

1. `POST /api/schema-manifests/<conn>/<schema>/tables`，body `{ "table": "<new-table>", "yaml": "<单表片段>", "dryRun": true }`。
2. 复查 Manifest 文件内容与 mtime。
3. 以同一 payload 重复步骤 1，比对两次响应。

### 期望

- 返回 `200 { diff, proposedYaml, files: [{ filePath, diff, proposedYaml }], noChanges: false, warnings }`；`diff` 仅含新增表节点。
- Manifest 文件内容与 mtime 不变（不落盘）。
- 两次 dryRun 响应一致（幂等）。

---

## UAT-STA-02 — 正式追加成交＋catalog 可见＋MCP 可见（SC-02）

### 目的

验证正式追加按表合并写入、既有表零影响、追加后 catalog 与 MCP 立即可见。

### 前置

UAT-R0 PASS；使用「既有 100 表三段名 Manifest 追加 1 表」夹具；Manifest 全部既有表节点摘要已记录基线。

### 步骤

1. `POST /api/schema-manifests/<conn>/<schema>/tables`，body `{ "table": "<new-table>", "yaml": "<片段>", "dryRun": false }`。
2. 核对落盘 Manifest：既有全部表节点摘要逐一对照基线。
3. `GET /api/sources?conn=<conn>` 确认新表出现。
4. `PUT /api/connections/<conn>/enabled-tables` 将新表加入白名单（dryRun:false）。
5. 经纯 MCP 调 `discover_data`／`lucy_read_source` 确认新表可见。

### 期望

- 返回 `200 { written: true, noChanges: false, writtenFiles, validation, changedFiles, warnings, nextSteps: ["PUT /api/connections/<conn>/enabled-tables", "POST /api/semantic-assets/reindex"] }`；`writtenFiles` 含 `semantic-layer/<conn>/_schema/<schema>.yaml`。
- Manifest 仅新增该表节点；既有全部表节点逐字节不变。
- `/api/sources` 立即含新表；enabled-tables 保存成功；MCP 两工具均可见新表。

---

## UAT-STA-03 — create-only：已存在表 409（SC-03）

### 目的

验证 create-only 语义：对已存在表追加被拒且给出可执行下一步。

### 前置

UAT-R0 PASS；选定既有表的 Manifest 字节已记录基线。

### 步骤

1. `POST /api/schema-manifests/<conn>/<schema>/tables`，body `{ "table": "<existing-table>", "yaml": "<该表片段>", "dryRun": false }`。
2. 复查 Manifest 字节。

### 期望

- 返回 `409 TABLE_ALREADY_EXISTS`；`data.nextSteps` 含 `"POST /api/sources/<conn>/<schema>/<table>/import"`。
- Manifest 字节不变（不写盘）。

---

## UAT-STA-04 — 请求体与内容校验四类拒绝（SC-04）

### 目的

验证请求体白名单与节点内容校验：拒绝一律显式报错，不落盘、不静默丢弃。

### 前置

UAT-R0 PASS；Manifest 字节已记录基线。

### 步骤

1. 合同外顶层字段：body 追加 `{ "patch": {} }` 或其他白名单外键 → 期望 `400 INVALID_SCHEMA_APPEND_BODY`，响应含顶层 `data: { unknownKeys, allowedKeys, nextSteps }`。
2. 缺 `table` 或 `yaml` 为非空字符串缺失 → 期望 `400` 同码。
3. column 含 overlay-only 键：yaml 片段的 `columns[]` 内含 `expr` 或 `role` → 期望 `422 OVERLAY_ONLY_KEY`（提示派生列请落 per-table overlay）。
4. 物理表名末尾段不一致：节点 `table:` 为 `BIDW.dbo.<other>` 而路径 `table` 为 `<new-table>` → 期望 `422 TABLE_NAME_MISMATCH`。
5. 非法 YAML（语法坏）→ 期望 `422 YAML_PARSE_ERROR`。
6. 节点含白名单外键（`TABLE_KEYS` 之外）→ 期望 `422 SCHEMA_APPEND_UNKNOWN_KEY`。
7. 每步复查 Manifest 字节。

### 期望

- 六步分别返回上述状态码与错误码；错误响应经 `data.nextSteps`／消息给出可执行下一步。
- 全部步骤不落盘、不静默丢弃。

---

## UAT-STA-05 — import 指引与 404／409 归一化（SC-05）

### 目的

验证 import 的追加指引与四路径 schema 名归一化的拒绝语义。

### 前置

UAT-R0 PASS。

### 步骤

1. 对未登记表调用 `POST /api/sources/<conn>/<schema>/<table>/import` → 检查响应。
2. 对不存在的 schema，分别以 `GET /api/sources/<conn>/<no-such-schema>/<t>`、`PUT`、`import`、`POST /api/schema-manifests/<conn>/<no-such-schema>/tables` 四路径请求 → 检查响应。
3. 构造大小写多义夹具（如 `BIDW.yaml` 与 `bidw.yaml` 并存）后重复步骤 2 任一路径 → 检查响应；跑次结束还原夹具。

### 期望

- 步骤 1：`404 SOURCE_NOT_FOUND`，`data.nextSteps` 含 `"POST /api/schema-manifests/<conn>/<schema>/tables"`（import 仍为 update-only）。
- 步骤 2：四路径均返回 `404 SCHEMA_MANIFEST_NOT_FOUND`，**不是** 500／ENOENT。
- 步骤 3：返回 `409 AMBIGUOUS_SCHEMA`。

---

## UAT-STA-06 — 三段名追加＋四路径归一化＋反向 shadow 告警（SC-06）

### 目的

验证三段物理表名兼容、四路径大小写归一化的正向命中与反向 standalone shadow 告警。

### 前置

UAT-R0 PASS；「既有 100 表三段名 Manifest」与「预置同名 standalone」两夹具就绪。

### Case A — 三段名追加（归一化正向）

#### 步骤

1. `POST /api/schema-manifests/<conn>/<schema>/tables`，body `{ "table": "<short-key>", "yaml": "table: BIDW.dbo.<short-key>\n...", "dryRun": false }`（路径 schema 段用与磁盘文件名不同大小写，如 `bidw`）。
2. 读取落盘 Manifest 核对该表节点；再以归一化小写 schema 名 `GET /api/sources/<conn>/<lower-schema>/<short-key>` 读取。

#### 期望

- 追加成功（`written:true`）；落盘节点 `table:` 原样保留三段 `BIDW.dbo.<short-key>`。
- 大小写不同的 schema 名归一化命中既有 Manifest，读写均按磁盘实际文件名。

### Case B — 反向 standalone shadow 告警

#### 步骤

1. 在 `semantic-layer/<conn>/` 下预置与追加目标同名的 standalone 文件（顶层含 `table:` 或 `sql:`）。
2. 对该表先 `dryRun:true` 追加 → 检查 `warnings`；再 `dryRun:false` 正式追加 → 检查 `warnings` 与落盘结果。

#### 期望

- 两分支响应 `warnings` 均含 `[{ code: "EXISTING_STANDALONE_SHADOW", file: "semantic-layer/<conn>/<table>.yaml", hint: "同连接存在同名 standalone 文件，将遮蔽刚追加的 Manifest 定义；可经 DELETE /api/semantic-assets/overlay/<conn>/<table> 清理" }]`。
- 告警**不阻断追加**：正式写仍 `written:true`、节点落盘成功。
- 跑次结束还原 standalone 夹具。

---

## UAT-STA-07 — 写管线、恢复与审计（SC-07）

### 目的

验证追加写入复用 L25-16 写管线（写锁＋展示写屏障＋发布窗口＋恢复日志）与审计，且中断后不留半份文件。

### 前置

UAT-R0 PASS；选定 conn/schema；审计查询权限就绪。

### 步骤

1. 正常追加一次（`dryRun:false`），核对恢复日志（release recovery journal）与审计记录：含 actor、conn/schema/table、diff 摘要、来源端点，且不含凭据与绝对路径。
2. 模拟写盘中断（如注入写失败／中断容器写入），随后按恢复链恢复，核验 Manifest 不留半份文件、可重放。
3. 复核追加不创建 `TableYamlVersionSnapshot`（`GET /api/sources/<conn>/<schema>/<table>/versions` 无该表新快照）。

### 期望

- 步骤 1：写盘走 ktx.yaml 写锁＋展示写屏障＋发布窗口＋恢复日志；审计记录含 actor／端点／diff 摘要且不含凭据。
- 步骤 2：恢复后 Manifest 完整（整文件一致或回滚到追加前），不留半份文件。
- 步骤 3：**无**该表的新版本快照（回滚走 release recovery journal，不走版本快照）。
