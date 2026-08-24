# 分表 E2E-ONBOARD-EVAL：语义上传包 → MCP Eval 对照

| 元数据 | 内容 |
|---|---|
| 文档名称 | 分表 E2E-ONBOARD-EVAL：语义上传包 → MCP Eval 对照 |
| 文档类型 | Checklist / Runbook |
| 版本 | v1.2 |
| 撰写日期 | 2026-08-08 |
| 撰写人 | Cursor Agent |
| 委托人 | zhangxingchen |
| 基于材料 | KSC Financial 端到端执行；Spider2-lite Pilot（`sandbox.s2_*`）；`docs/design-schema-onboarding.md`；Spec 123；`docs/eval-quiz-conventions.md`；父指引 `docs/qa/e2e-sop.md` |
| 适用范围 | 测试集 `E2E-ONBOARD-EVAL`：任意新 domain / 主题将上传包接入目标 Lucy，并用 MCP 作答 eval 对照 gold |
| 输出位置 | `docs/qa/suite-semantic-onboard-mcp-eval.md` |
| 父指引 | [`e2e-sop.md`](e2e-sop.md) |

> **先读父指引** [`e2e-sop.md`](e2e-sop.md) 确认本分表是正确测试集，再执行下列 Phase。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| 概念 | UI 主术语 | 英文辅助 | 禁止文案 |
|---|---|---|---|
| 本分表闭环 | 语义接入与 MCP 评测闭环 | Semantic onboard + MCP eval loop | 把「发布工作台」写成上传入口（Spec 123 后已移除） |
| 评测金标 | gold / `result_assertions` | exec-result gold | 仅用 Gold SQL 字符串匹配作为唯一判分 |

---

## 1. 目的

把「分析师上传包 → Lucy 可问答 → 可评测」固化为可重复执行的标准作业程序（SOP），供：

- **本主题复跑**（例如 `ksc_financial` 回归）
- **新主题首跑**（换 connection / schema / 表 / wiki / eval suite）

不替代产品 Spec；本文件是**操作规程**。浏览器步骤默认仅在任务明确要求「模拟人工 / 浏览器验证」时执行（见 `docs/DEVELOPMENT.md` 浏览器测试约束）。

---

## 2. 角色与产物

| 角色 | 职责 |
|---|---|
| 执行者（Agent / 人工） | 按 Phase 顺序操作；阻断即停并记录 |
| Owner | 确认目标环境、connectionId、评测范围、是否允许改 ACL |

| 输入（主题参数） | 说明 |
|---|---|
| `UPLOAD_PKG` | 上传包根目录（含 Manifest、source YAML、wiki、可选 evals） |
| `CONN_ID` | Lucy connectionId（例：`starrocks-r1`；**禁止**误用其它连接） |
| `SCHEMA` | 物理 schema / database 名（例：`ai`） |
| `TABLES` | `schema.table` 列表（写入 `enabled_tables`） |
| `WEBUI_BASE` | WebUI 根 URL（本地 Docker 常为 `http://127.0.0.1:55176`） |
| `MCP_BASE` | MCP endpoint（本地常为 `http://127.0.0.1:57881/mcp`） |
| `MCP_TOKEN` | Bearer token（须映射到有权 Agent） |
| `EVAL_SUITE` | `evals/{domain}/eval/{domain}-eval-cases.yaml` |
| `GOLD_DIR` | `evals/{domain}/gold/`（若有） |
| `SMOKE_IDS` | 首轮 case id 列表（推荐 basic + hard 子集，非全量） |
| `OUT_DIR` | 过程产物目录（默认 `inbox/{domain}-upload-run/`） |

| 输出 | 说明 |
|---|---|
| 目标 Lucy 数据卷内语义 / Wiki / `ktx.yaml` / `access.yaml` 已更新 | 运行时生效 |
| MCP `initialize` Visible Scope 含目标 connection + sources | 验收门禁 |
| `inbox/{domain}-mcp-eval-smoke-YYYYMMDD.md` | Pass/Fail 对照报告 |
| `OUT_DIR` 截图、validate/publish JSON、smoke results | 可删临时产物 |

---

## 3. 环境与目标选定（强制）

执行前必须**显式选定一套目标**，禁止混用：

| 检查项 | 做法 |
|---|---|
| WebUI 与 MCP 是否同实例 | 本地 Docker：WebUI `:55176` 与 MCP `:57881` 通常同容器；Cursor 里远程 MCP（其它 host）**不会**读到本地上传 |
| `ktx.yaml` 实际路径 | Docker 常为容器内 `/data/lucy/ktx.yaml`（volume），**不是**宿主机仓库根 `ktx.yaml` |
| connectionId | 与上传包 README / wiki `sl_refs` / eval metadata 一致 |
| 物理表是否存在 | 只读 SQL 核对行数（可与 suite `snapshot_rows` 对齐） |

**参考实例（KSC Financial，2026-08-08）**

| 参数 | 值 |
|---|---|
| `UPLOAD_PKG` | `/Users/zhangxingchen/Desktop/Inbox/lucy_upload_ksc_financial` |
| `CONN_ID` | `starrocks-r1` |
| `SCHEMA` | `ai` |
| `TABLES` | `ai.ksc_income_statement_detail` 等三表 |
| `WEBUI_BASE` | `http://127.0.0.1:55176` |
| `MCP_BASE` | `http://127.0.0.1:57881/mcp` |
| `MCP_TOKEN` | `lucy-demo-agent-token`（Agent `demo_agent`） |
| `EVAL_SUITE` | `evals/ksc_financial/eval/ksc_financial-eval-cases.yaml` |
| `SMOKE_IDS` | basic 5 + spider2_hard 5 |

```mermaid
flowchart LR
  pkg[UploadPackage] --> p0[Phase0_Precheck]
  p0 --> p1[Phase1_Schema_Enable]
  p1 --> p2[Phase2_Semantic_Publish]
  p2 --> p3[Phase3_Wiki]
  p3 --> p4[Phase4_ACL]
  p4 --> p5[Phase5_MCP_vs_Gold]
```

---

## 4. Phase 0 — 预检（只读）

**目标**：确认环境健康、表存在、当前缺口清晰。

1. `GET {WEBUI_BASE}/` → HTTP 200。
2. `GET {WEBUI_BASE}/api/connections` → 找到 `CONN_ID`；记录当前 `schemas` / `enabledTables`。
3. 只读核对物理表存在与大致行数。
4. 确认上传包文件齐全：Schema Manifest、各 source overlay、wiki（可选 evals）。
5. 打开 MCP `initialize`（当前 token）记录 Visible Scope 基线（通常尚无本主题 sources）。

**通过标准**：连接可达；物理表存在；参数表填齐。  
**失败**：停；先修连接 / 网络 / 目标环境。

---

## 5. Phase 1 — 添加 Schema + 启用表白名单

**入口（浏览器）**：`{WEBUI_BASE}/connections` → 连接卡片 → **+ 添加 Schema**（`data-testid=add-schema-{CONN_ID}`）。

1. 选择或输入 `SCHEMA` → 预览 → **确认写入**（写入目标实例 `ktx.yaml`）。
2. 成功页可点 **上传 Schema Manifest**，上传 Manifest YAML（或随后从连接卡片上传）。
3. 前往 **启用表范围**（`/connections/enabled-tables?connection=...&schema=...`），勾选 `TABLES` → **保存变更**（直接保存；「预览 YAML」为可选，不是保存前置）。
4. 验收：`schemas` 含 `SCHEMA`；`enabledTables` 含全部 `TABLES`；本地 Manifest 路径存在。

**自动化提示（Playwright）**

- 下拉选项文案常为 `{schema}（N 张表）`，应用 **option value=`SCHEMA`**，勿用 label=`SCHEMA`。
- 「保存变更」不会打开 `yaml-preview-drawer`；勿死等预览抽屉。

**通过标准**：连接卡片可见 Schema；三表（或主题表）已启用。  
**失败**：连通测试失败、schema 名非法、权限不足。

---

## 6. Phase 2 — 发布语义 source overlay 并索引生效

### 6.1 重要产品事实（Spec 123）

`/publish/workbench` 现为 **语义生效台**：校验 + **同步索引并生效**；**本页无「上传语义资产」入口**。  
多文件 overlay 发布走仍存在的后端：

- `POST /api/semantic-assets/validate`
- `POST /api/semantic-assets/publish`（`validationId` + 必要时 `confirmOverwrite: true`）

Manifest 单文件也可走 Catalog 上传：`POST /api/catalog/assets/upload`（UI：连接概览 / 添加 Schema 成功页）。

### 6.2 步骤

1. 准备 overlay 文件（standalone：含 `table:` + columns + measures/segments）。
2. **KTX 兼容清洗**：列上若含 `pk` / `nullable` 等不被当前 KTX contract 接受的键，发布校验会自动剥离（警告 `STRIPPED_MANIFEST_COLUMN_KEYS`）；Schema Manifest 中的同名字段保留不动。
3. `validate`（`defaultConnectionId=CONN_ID`，`defaultSchema=SCHEMA`）→ 记录 `validationId`。
4. `publish`（目标已存在则 `confirmOverwrite: true`）→ 等待 release `published` / reindex OK。
5. 浏览器打开 `/publish/workbench`：无脏文件时可点 **同步索引**；CLI/覆盖后可用「更多 → 全量重建索引」`force:true`。
6. 验收：`semantic-layer/{CONN_ID}/` 下 overlay 存在；reindex 日志含 `sl/{CONN_ID} scanned=N`。

**通过标准**：发布记录成功；KTX 可解析 sources。  
**失败**：校验门禁错误、contract 拒载、reindex 失败。

---

## 7. Phase 3 — 上传 Wiki

**入口（浏览器）**：`{WEBUI_BASE}/wiki` → 上传 → 确认上传。

或 API：

- `POST /api/wiki/upload/preview`
- `POST /api/wiki/upload/commit`  
  Body：`{ key, markdown, sourceFileName, overwrite }`

**强制检查**：frontmatter 必须含非空 `summary`（缺省会导致 wiki reindex `NOT NULL constraint failed: knowledge_pages.summary`）。  
`sl_refs` 必须指向本主题 `CONN_ID` / source，勿写错连接。

完成后执行一次 `POST /api/semantic-assets/reindex` `{ "force": true }`，确认 `wiki/global scanned≥1`。

**通过标准**：`GET /api/wiki` 列表可见该页；reindex wiki 无 error。

---

## 8. Phase 4 — Agent ACL（MCP 可见前提）

语义与 Wiki 落盘后，**未扩 ACL 则 MCP 仍不可见**。

1. 优先 **新建专用 role**（避免污染已 invalid 的共享 role）：  
   `POST /api/admin/roles`（先 `dryRun:true` 再 `false`）。
2. role.allow 至少包含：
   - `connections: [CONN_ID]`
   - `tableSelectors`: 本主题 schema + table names
   - `tools`: `lucy_catalog` / `lucy_query` / `lucy_read_source` / `wiki_search` / `wiki_read` 等只读面（可含 `sl_*` / `kx_catalog` 别名）
3. 将目标 Agent 切到该 role：  
   `PATCH /api/admin/agents/{id}` `{ dryRun:false, version, patch:{ role } }`
4. 验收：`GET /api/admin/agents/{id}/effective-permissions` 的 `sources` 含本主题表。
5. **新 MCP session** `initialize` → Visible Scope 列出 connection + sources。

**通过标准**：Visible Scope 正确；`lucy_catalog` 仅返回授权 sources。  
**失败**：`role_resolution_failed`（先修 role，勿硬改已坏 role）；gate `override_required`（敏感源需走治理流程）。

---

## 9. Phase 5 — MCP 作答 vs gold

### 9.1 范围策略

| 轮次 | 推荐范围 |
|---|---|
| 首轮冒烟 | `coverage_matrix.basic` + 若干 hard（约 5–10 题） |
| 回归全量 | suite 全部 cases（可选 quiz） |

### 9.2 作答约定

1. 新 session：`initialize` → `notifications/initialized`。
2. 每题：`lucy_catalog` →（需要时）`lucy_read_source` / `wiki_search` → `lucy_query`。
3. `lucy_query` 使用 **source 限定** measure / filter（如 `source.总收入`，`source.fiscal_year = 2024`）。
4. 对照同 case 的 `result_assertions`（及 `gold/*.csv`）；记录 Pass / Fail / Partial。
5. 落盘报告到 `inbox/{domain}-mcp-eval-smoke-YYYYMMDD.md`（正式报告需元数据表）。

### 9.3 常见查询坑

| 现象 | 处理 |
|---|---|
| `count(*)` → `does not reference any source` / `explicit_table_required` | 使用 `count(source.col)` / `count(distinct source.col)` |
| 结果形如 `headers` + `rows` | 按表头映射数值再比 gold |
| 无具名 measure（如 `fx_effect`） | 用 `{expr,name}` + `line_item_code` 条件聚合 |

**通过标准**：冒烟题集全部 Pass；或 Owner 接受的 Fail 清单已登记。

---

## 10. 阻断与回滚

| 阶段 | 常见阻断 | 处置 |
|---|---|---|
| 0 | WebUI/DB 不可达 | 查 Docker / 网络 / 密码文件（不打印密钥） |
| 1 | Schema 已存在 | 跳过添加，继续 Manifest / 启用表 |
| 2 | contract 拒载 | 清洗 YAML 后 `confirmOverwrite` 再发布 |
| 3 | wiki reindex NOT NULL | 补 `summary` 再上传 / commit |
| 4 | role invalid | 新建 role，勿在坏 role 上叠补丁 |
| 5 | Visible Scope 无表 | 确认 ACL + 新 session；确认 MCP 指向同实例 |

回滚（按需）：移除 Schema（Spec 117）、revoke token、删 wiki、覆盖旧 overlay；**不**在 SOP 默认路径做破坏性操作。

---

## 11. 新主题启用清单（复制即用）

```text
[ ] 1. 填主题参数表（§2）
[ ] 2. 选定 WEBUI_BASE / MCP_BASE 同实例（§3）
[ ] 3. Phase0 预检通过
[ ] 4. Phase1 Schema + Manifest + enabled_tables
[ ] 5. Phase2 overlay 清洗 + validate/publish + reindex
[ ] 6. Phase3 Wiki（含 summary）+ reindex
[ ] 7. Phase4 专用 role + Agent 绑定 + Visible Scope
[ ] 8. Phase5 冒烟 IDs 作答 vs gold，报告落 inbox/
[ ] 9. 若 Pass：可选启动全量 eval；若 Fail：只修阻断项后从失败 Phase 续跑
```

---

## 12. 参考实例产物路径

| 路径 | 内容 |
|---|---|
| `inbox/ksc-financial-mcp-eval-smoke-20260808.md` | KSC 冒烟对照报告（10/10 Pass） |
| `inbox/ksc-upload-run/` | 截图、validate/publish JSON、评测脚本与结果 |
| `evals/ksc_financial/` | 本主题 eval + gold |
| `inbox/spider2-lite-sqlite/results/e2e-summary.md` | Spider2-lite Pilot 分层 e2e 摘要（见 §14） |
| `evals/spider2_lite_sqlite/` | Spider2-lite Pilot eval + provisional gold |

---

## 13. 相关文档

- [`docs/design-schema-onboarding.md`](../design-schema-onboarding.md) — 添加 Schema
- [`webui/docs/123-publish-workbench-activation-ia-spec.md`](../webui/docs/123-publish-workbench-activation-ia-spec.md) — 生效台（无上传）
- [`webui/docs/03-api-spec.md`](../webui/docs/03-api-spec.md) — schemas / enabled-tables / semantic-assets / wiki / admin roles
- [`docs/eval-quiz-conventions.md`](../eval-quiz-conventions.md) — eval / gold 约定
- [`webui/docs/07-mcp-auth-proxy-spec.md`](../webui/docs/07-mcp-auth-proxy-spec.md) — MCP 鉴权与 instructions
- [`docs/DEVELOPMENT.md`](../DEVELOPMENT.md) — 浏览器测试约束与落位规则
- [`evals/spider2_lite_sqlite/README.md`](../../evals/spider2_lite_sqlite/README.md) — Spider2 Pilot suite
- [`suite-agent-mcp.md`](suite-agent-mcp.md) — Agent 抽样（Spider2 可选）

---

## 14. 参考实例 — Spider2-lite Pilot @ StarRocks `sandbox`

> 本实例走 **同一套 Phase 0–5**，但数据面是已装载的 `sandbox.s2_*`（非分析师上传包首发）。  
> 工单背景：[`docs/plans/wo-202608-58-spider2-lite-sqlite-stress-harness.md`](../plans/wo-202608-58-spider2-lite-sqlite-stress-harness.md)。  
> **跑 E2E 以本分表 + 父指引为准**；工单不替代本分表。

### 14.1 参数表（冻结）

| 参数 | 值 |
|---|---|
| `CONN_ID` | `starrocks-r1` |
| `SCHEMA` | `sandbox` |
| `TABLES` | `sandbox.s2_*`（Pilot 五库共 69 表；清单 `inbox/spider2-lite-sqlite/etl/pilot-enabled-tables.txt`） |
| `WEBUI_BASE` | `http://127.0.0.1:55176`（Docker Lucy） |
| `MCP_BASE` | `http://127.0.0.1:57881/mcp` |
| `MCP_TOKEN` | 专用 role `spider2_sandbox_readonly` 对应 token（用户字段用 `role:` 单数；见 Phase 4） |
| `EVAL_SUITE` | `evals/spider2_lite_sqlite/eval/spider2_lite_sqlite-eval-cases.yaml` |
| `GOLD_DIR` | `evals/spider2_lite_sqlite/gold/starrocks_pilot/`（provisional；见 `gold/CALIBRATION.md`） |
| `SMOKE_IDS` | `evals/spider2_lite_sqlite/sample-ids.txt`（8 题） |
| `OUT_DIR` | `inbox/spider2-lite-sqlite/results/` |

### 14.2 与通用 Phase 的差异

| Phase | Spider2 Pilot 做法 |
|---|---|
| 0 预检 | `npm run smoke:p1:spider2-lite-runtime`（connection + `sl validate` + 行数探针）；无 SR → **blocked** |
| 1 Schema/白名单 | 幂等 reseed：`npm run spider2-lite:reseed-sandbox`；`enabled_tables` 含全部 `sandbox.s2_*`；`schemas` 含 `sandbox` |
| 2 语义 | Manifest `sandbox.yaml` **已含 Pilot FK join graph**（`scripts/spider2-lite-inject-sandbox-joins.py`）+ 10 overlays；目标实例 sync + `admin reindex` |
| 3 Wiki | `wiki/global/spider2-ecommerce-rfm.md`（须含非空 `summary`） |
| 4 ACL | role 含 `sandbox` `prefix: s2_*`（demo token / `ksc_financial_readonly` 已扩）；工具含 `lucy_*` 与 `sl_*` |
| 5 MCP vs gold | catalog：`npm run smoke:p0:spider2-lite-eval`；sample eval：`python3 scripts/e2e-spider2-lite-eval-v2.py`（Lucy + SR SQL oracle） |

### 14.3 脚本化门禁（登记于 test-layers）

| 目的 | 命令 |
|---|---|
| G-cat | `npm run smoke:p0:spider2-lite-eval` |
| G-rt | `npm run smoke:p1:spider2-lite-runtime` |
| G-plat + datapath | `node scripts/p1-endpoint-smoke.mjs --proxy-url $MCP_BASE --token $MCP_TOKEN --connection starrocks-r1 --source s2_sakila_payment`；再 `lucy_query` 校验 `payment_count=16049` |
| MCP-direct / Cursor 抽样 | 转 [`suite-agent-mcp.md`](suite-agent-mcp.md) §5（`npm run e2e:spider2-lite:sample`，默认 demo token） |

**政策**：可选 gated；**不**进客户 headless 硬门禁；**不**进 `e2e:sow-trust-standard`。缺依赖写 blocked，禁止假 pass。

### 14.4 清单（Spider2 复跑）

```text
[ ] 1. 填 §14.1 参数；确认 WEBUI/MCP 同 Docker 实例
[ ] 2. G-rt PASS 或 blocked（有证据）
[ ] 3. 目标实例 enabled_tables + SL reindex 含 s2_*
[ ] 4. ACL role + 新 MCP session Visible Scope 含 sandbox.s2_*
[ ] 5. G-cat PASS；datapath lucy_query 冒烟 PASS
[ ] 6. Phase5 对 SMOKE_IDS 或登记 Fail；报告 → OUT_DIR
[ ] 7. 需要 Agent 最终答案时 → suite-agent-mcp §5
```
