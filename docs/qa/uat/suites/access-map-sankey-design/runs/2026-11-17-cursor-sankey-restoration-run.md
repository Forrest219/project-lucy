# Run — 2026-11-17 — cursor-sankey-restoration

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ACCESS-MAP-SANKEY` |
| Agent | Cursor（Claude） |
| 性质 | **改后沙箱复验**。目标：Spec v0.2（D0＝C）已实现并提交，在同一批确定性种子上重跑 R0／01～05，对照 [改前基线](2026-11-17-cursor-sankey-probe-baseline.md) |
| 环境 | 宿主隔离沙箱（关闭鉴权，不碰 demo 容器与 `lucy-demo-data`）；前端为工作树 `vite build` 产物；五个 profile 各一个端口（58201–58205） |
| 线上实例 | 未触碰（`gitSha=6d2664b3`，未升级，无凭据） |
| 总判定 | **沙箱范围 PASS**（必做 R0／01～05 与可选 06）；沙箱是降级环境，设计用例的 Docker 全真执行见 [docker-seeded-run](2026-11-17-cursor-sankey-docker-seeded-run.md)（PASS WITH GAP，仅 06 沿用基线、07 BLOCKED）。**≠ UAT 对线上通过；≠ 可上线** |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-SANKEY-R0 | **PASS** | API 数字逐项等于 [fixtures 期望值](../fixtures.md#profile-与期望值)：rich 188／20／173／2；grants-only 188／0／0／0；sparse 188／4／55／0；candidate-only 188／0／0／0（`unconfirmedCalls=175`）；dense 524／146／1455／2（`grantPaths／accessPaths／rawCalls／deniedCalls`） |
| UAT-SANKEY-01 | **PASS** | `rich`：API 访问路径 20、`rawCalls=173`、`deniedCalls=2` 不进访问路径。图：[c-rich](evidence/2026-11-17-c-rich.png)。本轮未重数 DOM 流带；使用节点柱高 > 0 由测试 `access-map-sankey-restoration.test.tsx` 与上一轮沙箱目视保证。纯闲置节点（如 `idle_bot`）柱高为 0，按 Spec §5.2 属预期，不是使用节点 |
| UAT-SANKEY-02 | **PASS** | `grants-only`：表列存在，恰 4 个闲置授权聚合节点，文案为「8 张表／16 条」「4／4」「12／48」「120／120」，合计 188 条；32 条幽灵带；使用流带 0；图例第 2 项为「虚线轮廓 = 闲置授权（示意宽度，封顶，不与实心带同尺度）」。图：[c-grants-only](evidence/2026-11-17-c-grants-only.png)。基线为 3 列发丝线、无表列 |
| UAT-SANKEY-03 | **PASS** | `sparse`：使用流带 8 条；4 个聚合节点文案含 119／10／8／4 张表；36 条幽灵带。点击聚合节点开清单、点行开抽屉由页面测试覆盖（SC-B4、SC-B5） |
| UAT-SANKEY-04 | **PASS** | `candidate-only`：API `unconfirmedCalls=175`；`trust=include_candidate` → **400**（`INVALID_ACCESS_MAP_PARAMETER`，「关联口径只接受已确认关联」），`trust` 仍为 `confirmed`；页面说明「窗口内另有 175 次调用因问询关联未确认，未计入本图（口径：已确认关联）…」并带「对照访问日志」链接，不再出现「可调整筛选后再看」。图：[c-candidate-only](evidence/2026-11-17-c-candidate-only.png) |
| UAT-SANKEY-05 | **PASS** | `dense`：Agent 列 25（24＋「其他」）、表列 26（24＋「其他」＋1 个闲置聚合节点）；有柱的节点 58 个，其中零高柱 **0**；容器 `overflow-y:auto`，`clientHeight=842 < scrollHeight=1011`，可纵向滚动（基线：SVG 高 1350 且不可滚、零高柱 76）。使用带厚度不低于 2px 由布局测试 SC-A2 保证，未用 DOM 包围盒复核（路径包围盒含纵向跨度，不等于厚度）。图：[c-dense](evidence/2026-11-17-c-dense.png) |
| UAT-SANKEY-06 | **PASS（沿用基线）** | 旧码对照结论不依赖本次改动，本轮未重跑；见基线 run |
| UAT-SANKEY-07 | **BLOCKED** | 无线上凭据，线上未升级；A1／D5 未获授权。不得用本表沙箱结果替代 |

## 备注

- 单元／页面测试：`npx vitest run src/__tests__/access-map server/__tests__/p1-access-map` 230／231 通过。唯一失败是 `p1-access-map-contract` SC-11 术语 lint，来源为 `CreateConnectionDrawer.tsx`、`EditConnectionDialog.tsx`、`TableEditor.tsx`、`NewToken.tsx` 的既有违规，非本条引入。
- 与 Spec 的已知差异：闲置聚合节点不计入 `COLUMN_NODE_CAP`；纯闲置节点柱高为 0；`accessOk=false` 时不出聚合节点（Spec §5.2、§9）。
- Plan「浏览器验证」证据保持「未执行」：本 run 是沙箱 DOM 量值，未按 1920×1080 对 E1–E9 逐态截图，不冒充该证据。
- 清理：沙箱落在 `/tmp/lucy-sankey/`；本轮进程已按端口 PID 结束；未使用 `docker restart`，未碰 demo 容器。
