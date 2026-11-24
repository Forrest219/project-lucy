# Run — 2026-11-17 — cursor-sankey-docker-seeded

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ACCESS-MAP-SANKEY` |
| Agent | Cursor（Claude） |
| 性质 | **Docker 全真复验，按 [cases.md](../cases.md) 设计步骤逐条执行**（委托人确认路线：另起一次性容器）。每个种子 profile 一个容器，真实镜像 `project-lucy:demo`、真实 WebUI、真实 Chromium（1920×1080）。不碰 demo 容器、demo 数据卷、demo 审计库 |
| 环境 | 容器 `lucy-uat-sankey-<profile>`，端口 58301–58305，数据目录 `/tmp/lucy-sankey-docker/<profile>/data`（用后即删）。`/api/health`：`lucyVersion=0.30.0`、`gitSha=65f40847…`、`gitDirty=true`（镜像含本提交的未提交改动，哈希已与宿主比对一致）。入口：`scripts/uat/sankey-docker/{up.sh,run-uat.mjs,down.sh}` |
| 与 demo 容器的差异（降级项，已披露） | 一次性容器以 `LUCY_DEPLOYMENT_MODE=development`、`LUCY_WEBUI_AUTH=off` 启动（customer 模式要求引导密钥与管理员登录）；4 个种子连接指向 `sandbox.invalid`，不连真实库，本套件只验访问关系图，不跑问数 |
| 总判定 | **PASS WITH GAP**：必做 R0／01／02／04／05 与 03 全部通过；06 沿用基线沙箱 A/B 结论，未在 Docker 重跑；07 线上 BLOCKED。**≠ UAT 对线上通过；≠ 可上线** |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-SANKEY-R0 | **PASS** | 五个 profile 的 `grantPaths／accessPaths／rawCalls／deniedCalls` 逐项等于 [fixtures 期望值](../fixtures.md#profile-与期望值)：grants-only 188／0／0／0；sparse 188／4／55／0；rich 188／20／173／2；candidate-only 188／0／0／0；dense 524／146／1455／2 |
| UAT-SANKEY-01 | **PASS** | `rich`：使用流带 25（≥20）；有使用流带的节点柱高为 0 的个数 0；最薄流带 10.3px；边状态 normal 23／dormant 132／overflow 1／needs_review 1，四态齐全；页面「进入允许调用 173」。图：[docker-rich](evidence/2026-11-17-docker-rich.png) |
| UAT-SANKEY-02 | **PASS** | `grants-only`：表列恰 4 个闲置聚合节点（8／4／12／120 张表，合计 188 条授权路径）；使用流带 0；四个连接各有一条连接→聚合节点幽灵带，厚度 8／6／24／40px，全部落在 6–40px，不是 3px 发丝线；另有 12 条上游幽灵带。图：[docker-grants-only](evidence/2026-11-17-docker-grants-only.png) |
| UAT-SANKEY-03 | **PASS** | `sparse`：使用流带 8；聚合节点文案含 119／10／8／4 张表；依次点开 4 个聚合节点，清单行数分别为 119／10／8／4，等于各自的 k；点 `warehouse_dw` 清单第一行（`dw_fact_001`）打开关系明细，边为 `conn:warehouse_dw → table:warehouse_dw::dw::dw_fact_001`，对象正确；图例四项，第 1 项「流带宽度 = 访问路径数」，无「授权路径数」。图：[docker-sparse](evidence/2026-11-17-docker-sparse.png)、[idle-list](evidence/2026-11-17-docker-sparse-idle-list.png) |
| UAT-SANKEY-04 | **PASS** | `candidate-only`：API `unconfirmedCalls=175`，`trust=confirmed`；`trust=include_candidate` → **400**（`INVALID_ACCESS_MAP_PARAMETER`）；页面说明「窗口内另有 175 次调用因问询关联未确认，未计入本图（口径：已确认关联）…」，无「可调整筛选后再看」。图：[docker-candidate-only](evidence/2026-11-17-docker-candidate-only.png) |
| UAT-SANKEY-05 | **PASS** | `dense`（42 Agent）：Agent 列 25（24＋「其他」）、表列使用节点 25（另有闲置聚合节点单独计）；有使用流带的节点零高柱 0；59 条使用流带，最薄 2px（等于刻度下限）；容器 `overflow-y:auto`，`clientHeight=842 < scrollHeight=1011`，可纵向滚动。图：[docker-dense](evidence/2026-11-17-docker-dense.png) |
| UAT-SANKEY-06 | **PASS（沿用基线）** | 旧码对照结论不依赖本次改动，未在 Docker 重跑；见 [基线](2026-11-17-cursor-sankey-probe-baseline.md) |
| UAT-SANKEY-07 | **BLOCKED** | 线上仍是 0.25.0（`gitSha=6d2664b3…`），无凭据；A1／D5 未授权 |

## 备注

- 是否使用 `docker restart`：**否**。五个容器均为新起、用后删除；demo 容器 `compose-lucy-1` 未被改动。
- 同日 [demo Docker 复验](2026-11-17-cursor-sankey-demo-docker-run.md) 是改编版（demo 数据形态与种子不同），本跑次才是设计用例的全真执行；两者不互相替代。
- `up.sh` 在本跑次中从头到尾验证过一次（先 `down.sh` 清场，再 `up.sh`，等 healthy 后跑 `run-uat.mjs`）。
- 清理：`down.sh` 已删除五个容器和 `/tmp/lucy-sankey-docker`；临时探针 `inbox/sankey-demo-probe.mjs` 可随时删除。
