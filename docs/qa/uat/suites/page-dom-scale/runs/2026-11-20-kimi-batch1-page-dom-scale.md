# Run — 2026-11-20 — kimi-batch1-page-dom-scale（tokens／audit／publish）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-PAGE-DOM-SCALE` |
| 选择器 | UAT-PDS-R0／01／02／03（03 BLOCKED） |
| Agent | Kimi Code |
| 环境 | WebUI `http://127.0.0.1:55176`；`compose-lucy-1` healthy；候选 `1fb73f72…` dirty |
| 浏览器 | 系统 Chrome headed 前台 1920×1080，逐轮 `visibilityState=visible` |
| 入口 | `scripts/uat/page-dom-probe.mjs`（基线/加压各一轮）；`scripts/uat/seed-tokens.mjs`；`scripts/uat/seed-audit-rows.mjs` |
| 原始 JSON | `inbox/uat-pds-batch1-2026-11-20/`（baseline-timing.json／loaded-timing.json／seed-*.json） |
| 总判定 | **PASS（Batch 1 全页参照线内；无 FAIL-OBSERVE）＋ PDS-03 BLOCKED**；≠ 各页功能合同验收；≠ 可上线 |

## 基线（现状数据）

| 页面 | 行数 | DOM | colder | SPA×3 | consoleErr |
|---|---:|---:|---:|---|---:|
| /admin/tokens | 13 | 842 | 144 ms | 143–157 ms | 0 |
| /ops/calls | 9 | 511 | 150 ms | 142–153 ms | 0 |
| /publish/history | 0（空态） | 361 | 27 ms | 12–32 ms | 0 |
| /eval/runs | 0（空态） | 342 | 13 ms | 14–32 ms | 0 |
| /connections/enabled-tables | 17 | 544 | 143 ms | 136–137 ms | 0 |
| /admin/access-map | 0 | 562 | 15 ms | 29–45 ms | 0 |

## 造数（真实路径，0 失败）

| 项 | 路径 | 结果 |
|---|---|---|
| tokens +200 | `POST /api/admin/agents/:id/tokens`（demo_agent/demo_ops 各 100，label `pds-t###`） | 200×200，0 失败；总数 13→**213** |
| audit +341 | 真实 MCP 只读调用（`lucy_catalog`/`connection_list`/`wiki_search` 轮换，Bearer=临时签发 token，间隔 500 ms） | 300/300 成功，1.89 rps；7d total 4→**345**；进程未中断（R-2 纪律有效） |
| publish records | validate→publish 真实流程 | **BLOCKED**：validate 需上传语义文件 envelope，空发布不产生 release 记录；在共享 demo 上有状态副作用，按「做不到全真即停表」记 BLOCKED（建议后续用专用语义层夹具项目复测） |

## 加压测量

| 页面 | 行数 | DOM | colder | SPA×3 | longtask | API p50 |
|---|---:|---:|---:|---|---:|---:|
| /admin/tokens | 213（×16） | **7242**（×8.6，≈32 nodes/token） | 163 ms | 149–156 ms | 0 | 20 ms |
| /ops/calls | **9**（分页！） | 527 | 157 ms | 151–162 ms | 0 | 10 ms |
| /admin/access-map | — | 496 | 33 ms | 31–49 ms | 0 | 27 ms |
| /publish/history | 0 | 361 | 39 ms | 20–50 ms | 0 | 4 ms |
| /eval/runs | 0 | 342 | 38 ms | 26–31 ms | 0 | 3 ms |
| /connections/enabled-tables | 17（Batch 2 造数） | 544 | 136 ms | 149–156 ms | 0 | — |

consoleErrors 全程 0；无 >50 ms longtask。

## 判定与发现

1. **PASS**：全部页面 primaryReady 远优于参照线 B≤1000 ms（最慢 tokens 163 ms）。
2. **发现 F-1（良性架构）**：`/ops/calls` 在 345 行审计数据下 UI 仍只渲染 9 行——**分页器生效，DOM 有界**，调用流水页无规模风险（回链 P1-36 佐证）。
3. **发现 F-2**：`/admin/tokens` 全量渲染 213 行 DOM 7.2k，但 primaryReady 对行数不敏感（就绪门槛=首批行）、全程无 longtask——token 行结构简单，规模风险低；按 ~32 nodes/行外推 1,000 tokens ≈ DOM 33k，建议届时复测（看守阈值）。
4. **协议注记**：tokens 就绪门槛为首批 5 行（floor 依现状数据设定），primaryReady 表征"首屏可用"；DOM 与 longtask 才是规模风险载体，本跑次两者均平稳。
5. **PDS-03 BLOCKED**：发布记录造数需真实语义上传+发布（共享 demo 有状态副作用），现状 0 记录仅测空态；列入 GAP，建议专用夹具项目跟进。

## 清理（fixtures §7）

- tokens：200 个 `pds-t###` 全部吊销删除，verify 回 **13**（与基线一致）。
- audit 行：真实业务调用产生，**不可删**，留作观测样本（全部为 UAT 只读 catalog/wiki 调用，无敏感内容）；跑次注明。
- 临时 MCP token（`uat-pds-audit`）在 Batch 2 结束后吊销。

## GAP

- PDS-03 发布记录规模未测（BLOCKED）；eval-runs／whitelist 未造数（Batch 2）；access-map 在更多审计数据+引用下的形态（Batch 2 复测）。
- 就绪门槛各页不同（依现状行数），跨页 primaryReady 对比需注意口径；DOM/longtask 口径一致。
