# API Staging 接入准入 Spec（一期 · 计划支持）

| 元数据 | 内容 |
|---|---|
| 文档名称 | API Staging 接入准入 Spec |
| 文档类型 | Design / Governance Spec |
| 版本 | v0.1 |
| 状态 | **计划支持** — 治理口径已冻结；**暂不开发** Lucy 代码、WebUI、ETL 模板或生产接入 |
| 撰写日期 | 2026-08-28 |
| 适用范围 | 接口方、同步任务 Owner、Lucy 治理人员、数据消费用户；对外接入说明与评审门禁 |
| 关联文档 | [`docs/design-db-connection.md`](design-db-connection.md)、[`webui/docs/29-connection-semantic-boundary-automation-spec.md`](../webui/docs/29-connection-semantic-boundary-automation-spec.md)、[`webui/docs/26-database-connection-operations-runbook-spec.md`](../webui/docs/26-database-connection-operations-runbook-spec.md)、[`docs/DEVELOPMENT.md`](DEVELOPMENT.md) |

## Terminology Compliance

| 概念 | 主术语 | 说明 |
|---|---|---|
| 接口数据进入 Lucy 的路径 | **API Staging 接入** | 不经 Lucy HTTP；数据先落库再 ingest |
| 一期唯一支持形态 | **分页主表 + UID 扩展表** | Pattern ID：`P1-MasterUidExtension` |
| Lucy 已连接库中的中间表 | **Staging 表** | 建议 schema：`lucy_staging` |
| 外部拉数程序 | **同步任务** | cron / Airflow / 脚本；Lucy 外维护 |
| 主表接口 | **主表接口** | POST 分页拉取；一行一业务主键×时间粒度 |
| 扩展表接口 | **扩展表接口** | POST + 主键批次（如 `uids`）查询 |

本 Spec 不新增 WebUI 模块名；Staging 表纳入既有 **数据库接入** → `enabled_tables` → **语义层维护** 链路。

---

## 1. 决策摘要

Lucy **不原生支持 HTTP 接口**，也不在一期增加 MCP / WebUI 的 API connector。

一期（计划支持、暂不开发）仅承认 **一种** 外部数据形态：

```text
只读 POST + 鉴权 + 分页主表 + 按 UID（或等价主键）查扩展表
  → 同步任务写入 Staging 表（Lucy 已连接的 MySQL / PostgreSQL）
  → Lucy 既有能力：enabled_tables → ingest → 语义层 → lucy_query
```

**对外口径：**

> Lucy 不承诺「任意接口可接」。一期只支持 **P1-MasterUidExtension**；且单次同步落库 **不超过 10 万行**。其余形态需单独立项或二期评审。

**参考样例（形态符合，生产接入未启动）：** 用户资产数据服务 — `user_asset_details/post_list`（主表）+ `tags` / `ad_list` / `vip_order_list`（UID 扩展表）；POST + HMAC-SHA256 + 分页 + UID 分批。

---

## 2. 状态与边界

### 2.1 当前状态：计划支持

| 项 | 状态 |
|---|---|
| 本 Spec（准入口径、Non-Goals、Checklist） | ✅ 已落盘 |
| ETL / 同步任务模板 | ❌ 暂不开发 |
| Staging DDL 标准库 | ❌ 暂不开发 |
| WebUI「API 连接」或发布门禁行数校验 | ❌ 暂不开发 |
| 生产域接入与 semantic-layer / Eval | ❌ 暂不开发 |

「计划支持」含义：评审、对外说明、接入申请 **可按本 Spec 裁决**；**不得**宣称 Lucy 产品已内置 API 能力。

### 2.2 Lucy 与非 Lucy 职责

| 职责 | 负责方 | Lucy 是否覆盖 |
|---|---|---|
| HTTP 调用、鉴权签名、分页、UID 批次 | 同步任务 Owner | ❌ |
| JSON 解析、拍平、PII 处理 | 同步任务 Owner | ❌ |
| Staging 表 DDL、写入、行数门禁 | 同步任务 Owner | ❌ |
| `ktx.yaml` `enabled_tables`、ingest | Lucy 治理（WebUI / 配置包） | ✅ |
| 语义 overlay、Wiki、Eval、ACL | Lucy 治理 | ✅ |
| Agent 问数（`lucy_query`） | Lucy 运行时 | ✅ |

与 [`webui/docs/29-connection-semantic-boundary-automation-spec.md`](../webui/docs/29-connection-semantic-boundary-automation-spec.md) 一致：**API Staging 不是第六种 WebUI 模块**；Staging 表视为 **已进入 Lucy 连接范围内的物理表**，走数据库接入 + 语义层维护。

---

## 3. 一期唯一支持形态：P1-MasterUidExtension

### 3.1 必须同时满足

| # | 条件 | 说明 |
|---|---|---|
| 1 | **只读** | 不得有写业务状态的 POST/PUT/DELETE |
| 2 | **POST + 固定 body 模板** | 每个接口 ≤ 5 套固定 form/body 参数组合；禁止 Agent 或同步任务任意 ad-hoc body |
| 3 | **鉴权在同步任务侧** | HMAC、API Key 等；AppSecret **不** 进入 Lucy 配置库 |
|  4 | **主表接口** | 支持 `pageNum` / `pageSize`（或等价）分页；返回 `{ output: flatObject[], totalNum }` |
| 5 | **扩展表接口** | **必须**通过主键批次（如 `uids`）查询；禁止无键全表拉取 |
| 6 | **结构化 output** | `output[]` 元素为 **扁平对象**；禁止整段非结构化文本 blob 作为唯一 payload |
| 7 | **行数门禁** | 单次同步任务写入 Staging 的合计行数 **≤ 100,000**（见 §4） |
| 8 | **落库后再接 Lucy** | Staging 表位于 Lucy 已声明 `connections.*` 的库中；接入前不同步 = Agent 不可见 |

### 3.2 主表与扩展表关系

```text
sync_batch
  │
  ├─► master_post_list(dt)     ──► staging.<domain>_post_list
  │         │ extract uid
  │         ▼
  ├─► extension_tags(uids)     ──► staging.<domain>_tags
  ├─► extension_ad_list(uids)  ──► staging.<domain>_ad_list
  └─► extension_*(uids)        ──► staging.<domain>_*
```

- **主表 grain** 必须在接入文档写清（如 `uid + dt` 一行）。
- **扩展表** 与主表通过 `uid`（及必要时 `dt`）关联；扩展表行数 **计入** 同一同步任务的 10 万预算。

### 3.3 返回 JSON 约束

| 允许 | 不允许 |
|---|---|
| 固定字段名的 flat object | 仅 `{ "content": "长文本报告..." }` 无结构化字段 |
| 单字段嵌套 JSON / 数组存 TEXT 列（如 `action_detail`） | 依赖 Agent 现场解析大 JSON 串做聚合 |
| nullable 字段（需在 Wiki 说明） | schema 每周变更且无版本号 |

---

## 4. 行数门禁（10 万行）

### 4.1 规则

- **计量单位**：一次 `sync_job` 从接口拉取并 **INSERT/REPLACE 进 Staging** 的行数合计。
- **上限**：`rows_written_total ≤ 100_000`。
- **主表**：同步前读取 `totalNum`；若 **未采样** 且 `totalNum > 100_000`，该 dt **拒收**（fail-closed，不部分偷跑）。
- **扩展表**：累计行数不得超过剩余预算；超出则 **停止扩展表同步** 并告警，已在预算内的数据可保留。
- **Agent 可见表**：只将纳入预算且完成治理的 Staging 表加入 `enabled_tables`。

### 4.2 超限时可选策略（接入评审时选一，写进 Wiki）

| 策略 | 适用 | 披露要求 |
|---|---|---|
| **拒收该 dt** | 数据必须完整 | Wiki 写明不可用日期 |
| **UID 采样** | 分析允许抽样 | Wiki 写明采样规则与偏差 |
| **拆多日分批** | 每 dt 本身 ≤10 万 | 每 dt 一次 sync_job |

> **样例提示：** 用户资产 `post_list` 单日 `totalNum` 约 11.2 万–15.8 万，**默认超一期上限**。正式接入前须与接口方约定：限流返回、分域、采样或提高 dt 切片策略；**不在 Spec 中放宽 10 万**。

---

## 5. 同步任务核心流程（Normative 伪代码）

实现落在 Lucy 外；此处供评审与后续 ETL 开发对齐。

```text
MAX_ROWS = 100_000

function sync_job(domain, dt, endpoints):
  rows_used = 0
  report = new SyncReport(domain, dt)

  master = fetch_master_all_pages(endpoints.master, dt)
  if master.totalNum > MAX_ROWS and not policy.allows_sampling:
    return REJECT("master_totalNum_exceeds_cap", master.totalNum)

  rows = policy.apply_master_cap(master.rows, MAX_ROWS)  # 可能采样或截断
  write_staging(endpoints.master_staging_table, rows, sync_batch_id)
  rows_used += len(rows)
  report.master_rows = len(rows)

  uids = distinct(rows, key=uid)
  for ext in endpoints.extensions:
    for batch in chunks(uids, ext.batch_size):
      if rows_used >= MAX_ROWS:
        report.warn("extension_skipped_budget_exhausted", ext.name)
        break
      ext_rows = fetch_extension(ext, batch, dt)
      remaining = MAX_ROWS - rows_used
      if len(ext_rows) > remaining:
        ext_rows = ext_rows[0:remaining]
        report.warn("extension_truncated", ext.name)
      write_staging(ext.staging_table, ext_rows, sync_batch_id)
      rows_used += len(ext_rows)

  report.rows_written_total = rows_used
  if rows_used > MAX_ROWS:
    raise InvariantViolation  # fail-closed
  return report
```

---

## 6. Staging 与治理约定（计划口径）

以下为一期 Spec 约定；**DDL 模板与自动化暂不开发**。

| 项 | 约定 |
|---|---|
| Schema | `lucy_staging`（或项目级 `<name>_staging`） |
| 表名 | `<domain>_post_list`、`<domain>_tags` 等 |
| 建议列 | 业务字段 + `dt` + `fetched_at` + `sync_batch_id` |
| PII | `uid` / `phone` / 订单号等：Agent 可见表须脱敏或 hash；原文表 **不** 加入 `enabled_tables` |
| 刷新频率 | 日级为主；Wiki 必须写清延迟 |
| Lucy 侧 | `enabled_tables` → ingest → overlay → ACL → Eval |

---

## 7. 角色与场景

| 角色 | 一期职责 |
|---|---|
| **接口人员** | 提供 POST 契约、样例 JSON、`totalNum` 行为、限流（如 20 次/分钟）、字段版本 |
| **同步任务 Owner** | HMAC/密钥管理、分页与 UID 批次、**10 万行门禁**、失败告警 |
| **Lucy 治理人员** | Staging 表授权、语义层、Wiki 口径、Eval、ACL |
| **数据消费用户** | 通过 Agent 对 **已发布** Staging 语义源问数；不问「实时 API」 |

| 场景 | 是否在一期范围内 |
|---|---|
| 主表按 dt 分页拉全量（≤10 万/次） | ✅ |
| 扩展表按主表 UID 分批查询 | ✅ |
| 平台 / 渠道 / ROI 等 SQL 聚合问数 | ✅（Lucy 侧） |
| 接口返回纯文本报告 | ❌ |
| GET 直拉、GraphQL、文件导出 API | ❌ |
| 单次同步 >10 万行 | ❌ |
| Agent 直连 HTTP | ❌ |
| 写操作接口 | ❌ |

---

## 8. 准入 Checklist（接入评审用）

以下为 **计划支持** 下的评审清单；全部满足方可批准「按本 Spec 实施同步 + Lucy 配置」。

- [ ] 形态为 **P1-MasterUidExtension**（§3.1 八条）
- [ ] 接口文档含版本号、样例 `output[]`、主键/grain 说明
- [ ] 主表 `totalNum` 与分页行为已验证
- [ ] 扩展表仅 UID（或文档化主键）批次查询
- [ ] 单次同步方案预估行数 **≤ 100,000**（或已选 §4.2 策略并 Wiki 披露）
- [ ] Staging DDL 与 PII 策略已评审
- [ ] 同步任务 fail-closed（超 cap 不写库或明确截断规则）
- [ ] Lucy：`connections.*` 已含 Staging 表所在库；`enabled_tables` 计划已列
- [ ] 语义 overlay + Wiki 口径 + ≥5 条 Eval 计划（实施阶段，非本 Spec 交付）

---

## 9. 一期 Non-Goals（明确不支持）

- Lucy / KTX **原生 HTTP connector**
- WebUI 创建「API 连接」表单
- MCP 新工具（如 `lucy_http_query`）
- 任意 POST body、GraphQL ad-hoc query
- GET 列表 / REST 直读（无 UID 扩展表形态）
- CSV/Excel URL 导出（非 POST 主从形态）
- 秒级实时 / WebSocket / 流式
- 单次同步 >10 万行
- 跨异构 API 在线联邦（Lucy 内 join 多个 HTTP 源）
- 将 AppSecret 存入 `ktx.yaml` 或 Lucy 仓库

---

## 10. 参考样例映射（用户资产 · 未生产接入）

| 接口 | P1 形态 | 10 万行 | 备注 |
|---|---|---|---|
| `user_asset_details/post_list` | 主表 ✅ | ⚠️ 部分 dt >10 万 | 接入前须 cap / 采样 / 分域 |
| `user_asset_details/tags` | 扩展表 ✅ | 取决于 UID 规模 | 计入同一 sync_job 预算 |
| `user_asset_details/ad_list` | 扩展表 ✅ | 同上 | 一 UID 多行 |
| `user_asset_details/vip_order_list` | 扩展表 ✅ | 稀疏 | 宜扩大 dt 窗口 + 定向 cohort |

---

## 11. 后续开发（不在 v0.1）

| 项 | 触发条件 |
|---|---|
| `examples/api-staging/` ETL 模板 | 首个生产域批准接入 |
| WebUI / 发布门禁行数校验 | 多次人为突破 cap 需硬约束时 |
| Help Center 对外一页纸 | 客户对外交付需要时 |

---

## 12. 变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v0.1 | 2026-08-28 | 初版；状态 **计划支持**；一期仅 P1-MasterUidExtension + 10 万行 cap |
