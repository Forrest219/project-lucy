# 跑次：2026-11-26 kscc P1-84 基线臂（R0／01）

| 元数据 | 内容 |
|---|---|
| 跑次 | `2026-11-26-kscc-p184-baseline`（基线臂；配对跑次的改前半） |
| 日期 / 撰写人 / 委托人 | 2026-11-26／Kscc Agent／xingchen |
| 候选身份 | 镜像 `project-lucy:demo`＝`sha256:2c6cc629496a…feda71d5f928d1a`；容器 `compose-lucy-1`；源码 HEAD `a76cac96`（dirty，＝本机未提交工作树构建）；P1-75 X1／X3／X4／X5 已含 |
| 档位 | **scale**（`npm run uat:scale-baseline` 退出 0；MySQL 1401 表／宽表 1000 列／角色 200／Agent 530／凭据 1530／Wiki 302／Skill 107／审计全历史 1,001,564 行；Hive 2 项 SKIPPED 同诊断 Gate 口径） |
| 授权 | 开发授权＝委托人 2026-11-26 明示（「授权开发，严格按 plan 实施」）；本跑次为改前基线，无运行代码变更 |
| 端口 | WebUI `:55176`；MCP `:57881` |
| 证据 | `inbox/p184-uat/baseline/evidence/`（JSONL 原始账本；sha256 见下表） |

## 臂构造

| 臂 | 构造 | 时长 |
|---|---|---|
| 注入器臂（机制鉴别，`UAT-PES-01`） | `POST /api/admin/ops-step-uat/sync-section`（`Atomics.wait`，holdMs=2500）×13 次；容器临时 `LUCY_OPS_STEP_UAT=1`（用后关闭） | ~65 s |
| 生产重工作臂（可行性鉴别） | ①`PUT /api/branding` 同值写 ×5（写屏障→展示快照失效→冷构建）＋4 路并发 `GET /api/sources`（共 100 次）＋`GET /api/admin/audit?limit=500`（每 10 读一次）②3 路 MCP 会话保持 `lucy_catalog` 在途（60 s 内任一时刻 ≥1 条在途） | ~60 s |

## 判定结果

### 注入器臂（探针 1Hz，12 tick）

| 路径 | n | p50 ms | p99 ms | max ms | 超时 | 判定 |
|---|---:|---:|---:|---:|---:|---|
| `GET /` | 12 | 2526 | 15596 | 15596 | 0 | **越线**（预算 5000／max 上限 10000） |
| `GET /api/branding` | 12 | 5049 | 10009 | 10009 | 4 | **越线**（预算 1000） |
| `GET /api/auth/status` | 12 | 2522 | 10010 | 10010 | 1 | **越线**（预算 1000） |
| 首屏资产 | 66 | 2650 | 15004 | 15004 | 6 | **越线**（预算 3000） |
| `GET /api/livez`（分列） | 12 | 906 | 2773 | 2773 | 0 | 200；与入口**同滞**（非「探针绿入口死」分裂形态，同诊断 Gate） |
| 事件循环（/api/health 快照） | — | — | 5138 | 7617 | — | **超上限**（p99≤400／max≤800） |

越线样本 ≥3（每路径 12 样本几乎全部超预算）→ `UAT-PES-01` 基线 FAIL 成立（记基线 FAIL，不关缺陷冒充已修）。

### 生产重工作臂（探针 1Hz，29 tick）

| 路径 | n | p50 ms | p99 ms | max ms | 超时 | 判定 |
|---|---:|---:|---:|---:|---:|---|
| `GET /` | 29 | 26 | 13770 | 13770 | 0 | **越线** |
| `GET /api/branding` | 29 | 47 | 10008 | 10008 | 1 | **越线** |
| `GET /api/auth/status` | 29 | 18 | 6853 | 6853 | 0 | **越线** |
| 首屏资产 | 168 | 32 | 13787 | 13795 | 0 | **越线** |
| 事件循环 | — | — | 6891 | 6891 | — | **超上限**（21 个违规快照） |

**结论：基线上存在能复现越线的生产重工作臂**（非仅注入器）→ 最终臂「生产重工作臂」不判 BLOCKED。

## 差集登记（Task 1）

| 热点 | 实测（容器内只读计时） | 判定 | 处置 |
|---|---|---|---|
| H1 展示快照全量构建（`listSourcesWithManifests`，scale 夹具 15 源表＋530 Agent 授权计数） | 总 265–710 ms；**最大同步段 201 ms** | ≤ 250 ms 上限 | **无需切片**；切片清单为空 |
| H2 审计导出／行展示（已切片路径） | `presentCallRows`／`renderAccessLogCsv` 均经 `mapSlicesYielding` | — | 只回归（EQUIV-GUARD／SWEEP 门禁复跑） |
| H3 推断问询补算 | P1-38／47 已让出 | — | 只回归 |
| H4 MCP 代理侧同步处理 | `lucy_catalog` 客户端 p50 ≈33 ms；未见 >250 ms 同步段 | — | 无差集 |
| **差集 D-1**：`GET /api/admin/audit` 列表读 | `SELECT primary_status, outcome FROM access_log`（1,002,127 行全量载入 JS）单同步段 ≈3029 ms；`COUNT(*)` ≈663 ms；汇总聚合 ≈1168 ms。scale 夹具下事件循环停滞 ≈6.9 s，与该读完全重合 | **不可切片**（单条 SQL，无法让出） | **不在本条出口**（H2 只回归）。生产臂越线证据保留，改后该路径预期仍越线；差集指向审计读事件循环族（见 `docs/lessons/2026-11-13-audit-read-blocks-event-loop.md`）／P1-82 B1 另案。最终臂事件循环臂改用已切片的 `GET /api/admin/audit/export` |

## 账本哈希（sha256）

| 文件 | sha256 |
|---|---|
| `probes-baseline-injector.jsonl` | `070d2d3027172e07cfa8cd5d06bf39cdbc974c5353dae8d0d023ec323972182c` |
| `injector-arm.jsonl` | `0b69111450ce097a7b1680d478946cabbf209b22c9d570537b98d6daa2b55e2a` |
| `probes-prod-arm-feasibility.jsonl` | `eec7d6e19b556ed0a24ec4cd15811017d8c43c9f02c9bae4d4c9e5b2da784703` |
| `display-arm.jsonl` | `12f3763bf98ebdf5a941512d4636c5ce260f1dd2ef691bebce8d0c89ab801a26` |
| `mcp-arm.jsonl` | `61989be93129d615c2fe9348dce032ba91957210b45534a9a8d40074cf1073d4` |

## 边界

- 本跑次只覆盖 R0／01 的基线（改前）半；最终臂（02–08）另行跑次。
- 诊断 Gate ≠ UAT；本跑次为正式测试台首个基线证据。
- MCP 臂量级：3 并发在途（复用 P1-82 语义的只读 `lucy_catalog`），未复验 P1-82 `UAT-MCPHA-03` 数值。
