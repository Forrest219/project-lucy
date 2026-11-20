# Run — 2026-11-20 — kimi-batch2-page-dom-scale（eval-runs／whitelist／access-map）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-PAGE-DOM-SCALE` |
| 选择器 | UAT-PDS-04（BLOCKED）／05／06 |
| Agent | Kimi Code |
| 环境 | WebUI `http://127.0.0.1:55176`；`compose-lucy-1` healthy；候选 `1fb73f72…` dirty；Batch 1 的 345 audit 行仍在观测窗内 |
| 浏览器 | 系统 Chrome headed 前台 1920×1080，逐轮 `visibilityState=visible` |
| 原始 JSON | `inbox/uat-pds-batch1-2026-11-20/loaded-timing-batch2.json` |
| 总判定 | **PASS（whitelist／access-map 参照线内）＋ PDS-04 BLOCKED（环境缺评测 runner CLI）**；≠ 功能合同验收；≠ 可上线 |

## UAT-PDS-04 评测运行历史（/eval/runs）— BLOCKED

- 造数：`POST /api/eval/runs`（domain `demo_superstore`）返回 422 `RUNNER_PRECHECK_FAILED`：eval runner 需要 `claude-code` CLI，demo 容器未安装（`/data/lucy/...` module not found）。
- 按「做不到全真即停表」记 **BLOCKED（环境缺口）**，不 mock run 记录；页面空态计时已在 Batch 1 基线（13–38 ms，DOM 342）。
- 建议：评测 runner 依赖的宿主 CLI 属部署前提，若客户/演示环境要支持页内触发评测，需在交付契约中声明 runner 前置条件；本页 DOM 规模风险待有 runner 的环境复测。

## UAT-PDS-05 启用表范围（/connections/enabled-tables）— PASS

造数（真实）：
1. demo-db `dataforai` 真实建表 200 张（`uat_pds_t001..200`，4 列）；
2. **发现 F-3（环境机制）**：WebUI 读取的 scanned catalog 在**内容根** `/data/lucy/config/semantic-layer/<conn>/_schema/*.yaml`（M31 布局），`/data/lucy/semantic-layer` 为源、`runtime/` 为启动镜像——三处各自维护，本次三处同步追加真实 information_schema 派生的 YAML（另附备份）；
3. `PUT /api/connections/demo-mysql/enabled-tables`（dryRun=false）启用 203 张：200，written:true，auditId 2080；注意该 PUT 同样 **dryRun 默认 true**（与 role/tokens 家族一致，O-2 同类）。

| 状态 | UI 行数 | DOM | colder | SPA×3 | longtask |
|---|---:|---:|---:|---|---:|
| 基线（3 表启用） | 17 | 544 | 143 ms | 136–137 ms | 0 |
| 加压（203 表启用） | **52（页面上限）** | 884 | ready 超时* | 151–171 ms | 0 |

\* colder 轮 20s 就绪超时：从 overview 冷进时需先拉 schema 列表，轮询窗口内未达 8 行门槛；SPA 轮（同页数据已热）3/3 达标。SPA 轮为可比口径。

判定：**PASS**——203 张启用表下页面仅渲染 52 行（分页/上限生效），DOM 884 平稳，primaryReady ≪1000 ms。

清理（fixtures §7）：PUT 恢复 3 张 superstore（auditId 2082）；三处 schema YAML 从备份还原（grep 0 uat_pds）；DROP 200 张表，demo-db 回到 **3 张**；均 verify。

## UAT-PDS-06 访问关系图（/admin/access-map）— PASS

| 状态 | DOM | colder | SPA×3 | longtask | API p50 |
|---|---:|---:|---|---:|---:|
| 基线（4 audit 行） | 562 | 15 ms | 29–45 ms | 0 | 17 ms |
| 加压（345 audit 行＋203 启用表） | 543 | 42 ms | 33–38 ms | 0 | 27 ms |

判定：**PASS**——sankey 聚合渲染有界，数据量 ×86 下 DOM 与 primaryReady 基本不变（节点为聚合 ribbon，非逐行）。

## 清理汇总

- whitelist 全链路还原（启用表/YAML/DB 表）verify 通过；临时 MCP token `uat-pds-audit` 已吊销。
- tokens 现 12 = 2 基线 + 10 个 `uat-wua-*`（**Wiki 上传 ACL 套件的他方夹具，非本套件产物，未触碰**）。
- audit 345 行留作观测样本（Batch 1 已注明）。

## GAP

- PDS-04 BLOCKED（eval runner CLI 缺失）；PDS-03 BLOCKED（Batch 1，发布流有状态）。
- whitelist colder 轮就绪口径需调整（schema 预拉取后再计时），不影响 SPA 结论。
- F-3 三处语义层副本的同步机制建议在运维文档显式化（本次靠逐层试错定位）。
