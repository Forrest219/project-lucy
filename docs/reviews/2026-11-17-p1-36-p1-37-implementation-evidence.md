# P1-36／P1-37 开发落地取证记录（O6 与本机 demo 实测）

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-36／P1-37 开发落地取证记录（O6 与本机 demo 实测） |
| 文档类型 | Review |
| 版本 | v1.1（2026-11-17 补：U1／U4 由宽目录沙箱实证后修复，见 §9；§5／§6 的「不改」决定已**被 §9 取代**） |
| 撰写日期 | 2026-11-17 |
| 撰写人 | Claude（Cursor Agent） |
| 委托人 | xingchen |
| 基于材料 | [P1-36 Spec](../specs/lucy-20261116-trace-span-ledger-spec.md)；[P1-37 Spec](../specs/lucy-20261116-mcp-ux-resilience-spec.md)；本机 demo Docker `compose-lucy-1`（`npm run demo:upgrade` 平滑升级后）；探针 `scripts/uat/mcp-ux-resilience-probe.mjs` |
| 适用范围 | 记录 P1-37 步骤 0（O6）取证结论、U1／U4 取证与修复、U3a／U2／P1-36 的实测；**不是 UAT 跑次（跑次在各套件 `runs/`），不是 UAT PASS** |
| 输出位置 | `docs/reviews/2026-11-17-p1-36-p1-37-implementation-evidence.md` |

## 1. 证据等级

- 全部实测来自**本机 demo Docker**（arm64，单客户端，demo 数据量），**不代表**客户现场（客户流水的 >30 s 握手长尾**未能在 demo 复现**）。
- 令牌来自本机 Cursor MCP 配置的 `lucy-demo` 项，只经环境变量传入，未打印、未落盘。
- 原始输出在 `inbox/`（临时目录，可删）：`o6-probe-output.jsonl`、`o6-shapes-output.jsonl`、`probe-handshake-1.json`、`probe-deny-1.json`、`probe-stale-1.json`。

## 2. O6：KTX 会话失效响应形态（已闭合）

| 场景 | 观测 |
|---|---|
| 带失效会话号（任一方法） | HTTP 404，`text/plain`，正文 `Unknown MCP session: <id>` |
| 不带会话号的非 initialize 请求 | HTTP 400，正文含 `initialize request is required…` |
| `sl_query` 缺／空 `measures` | 上游以参数校验失败拒绝 |

据此 `UPSTREAM_SESSION_REQUIRED_RE` 已覆盖两种形态；恢复序列固定为 ≤4 次上游请求（原请求、`initialize`、`notifications/initialized`、重试）。

## 3. U3a 会话恢复：真实重启验证

方法：建立 Lucy 会话并成功调用一次 `lucy_read_source`（走上游）→ 在容器内 `kill -9` KTX 进程 → entrypoint 监督进程自动拉起 → 用**同一个** Lucy 会话再次调用。

结果：客户端得到 HTTP 200 与正常 `lucy_read_source` 内容；该次流水的 span 为 `upstream_call`(404) → `upstream_handshake`(200) → `upstream_handshake`(202) → `upstream_call`(200，`retry_count:1`)。即 404 不再透给客户端，且上游请求数符合 ≤4。

## 4. U2 失败信息：demo 实测

- 未知工具名：回复含 `not a tool this server provides` 与真实 `tools/list` 工具名清单；审计 `error_category=policy_denied`、`reason=tool_unclassified`。
- `lucy_query` 缺 `measures`：回复为 `invalid_arguments:lucy_query:measures_required` 与示例；审计 `error_category=client_schema_failure`。
- 同一请求 60 s 内重复：第二次回复追加「不要原样重试」提示；两次流水均带 `rejection_fingerprint`（`rf1:` 前缀，不含明文参数）。

## 5. U1 握手长尾：demo 取证（**其「不改」结论已被 §9 取代**）

200 次顺序＋20 并发 `initialize`（demo）：

| 口径 | P50 | P95 | P99 | max | >30 s |
|---|---|---|---|---|---|
| 顺序 | 13.8 ms | 19.2 ms | 28.2 ms | 82.3 ms | 0 |
| 20 并发 | 165.2 ms | 175.9 ms | 176.2 ms | 176.2 ms | 0 |

阶段耗时（`access_trace_span`，220 条）：`instructions_build` P50 10 ms／P99 142 ms，其中 `skills_load` P50 6 ms、`catalog_resolve` P50 3 ms；`upstream_handshake` P50 1 ms。

结论：demo 内握手无长尾，主要耗时在 `instructions_build`（并发时因同进程串行排队放大），**无 >30 s 的根因证据**。按 Spec「无根因证据不改」，**未实现 U1 缓存**。已交付的阶段 span 可在客户现场采集后再决策；若要先行优化，`skills_load` 是占比最大的候选。

## 6. U4 拒绝快速返回：demo 取证（**其「不改」结论已被 §9 取代**）

100 次/形态（demo，小目录）：

| 形态 | P50 | P95 | P99 |
|---|---|---|---|
| 未知工具名 | 2.2 ms | 6.4 ms | 9.2 ms |
| 缺 `measures` | 37.3 ms | 45.5 ms | 53.4 ms |

均远低于 Spec 门槛。**未覆盖**：宽目录（≥300 源）与 ≥17 身份的 SC-11 形态——夹具尚未交付，故 U4 在宽目录下的耗时**未验证**。

## 7. P1-36 在 demo 的实测

- 自首条 span 行（id 1843）起：无 `trace_id` 的流水行 0 条、无 span 的流水行 0 条、孤儿 span 0 条。id ≤ 1840 的 721 条为升级前历史行，`trace_id` 为空，按 Spec 不回写。
- 拒绝类请求的 span：`admission`→`acl`（或 `arg_validate`），理由码来自登记表。
- 导出包 `spans.csv`、`spanCoverage` 清单字段由单测覆盖；**未在 demo 上取导出包**（需管理员会话）。`GET /api/admin/audit/status` 同理仅单测覆盖。

## 8. 已知偏差与缺口（v1.0 原文；v1.1 的变化见 §10）

1. `spanCoverage` 位于清单独立字段，**不在**既有六项对账与 `combinedComplete` 之内。
2. 部分阶段未埋点；拒绝类 span 为零时长标记。
3. 理由码映射增加了 ACL 相关的额外理由（`ACL_EXTRA_REASONS`），登记表需补记。
4. `spans.csv` 不分片，`computeSpanCoverage` 为同步计算，超大库下可能阻塞。**（v1.1：已改为分片并让出事件循环，见 §10）**
5. 上游宕机时非缓冲方法的 502 路径仍不落流水（既有行为，未改）。
6. 重复拒绝提示未接入来源门闩与口径拒绝点（指纹仍记录）。**（v1.1：已接入，见 §10）**
7. wiki_search「本地回退」：会话失效时走通用缓冲恢复路径，未新增本地回退。
8. `lucy_query` 的 `digest_kind=sql` 路径无单测。
9. `ping` 经恢复路径后返回缓冲改写结果。
10. R3 修订未复审。
11. 未实现：U3b（委托人决定不做）。（v1.0 曾写 U1／U4 未实现，**v1.1 已实现**）
12. （v1.0 写「宽目录夹具、M1–M6 脚本未交付；两套件 NOT RUN」，**v1.1 已交付并跑次**，见 §9、§10。）

## 9. v1.1：U1／U4 由宽目录沙箱实证后修复（取代 §5／§6 的「不改」）

**为何推翻 v1.0 的决定**：demo 目录小、单客户端，复现不了客户的握手长尾；Spec 的「无根因证据不改」要的是**在可复现环境里取证**，而不是「demo 没有就不做」。委托人批准「极可能验真模拟」后，造了宽目录沙箱（独立容器／volume／库，320 Source、20 Agent，`scripts/uat/uat-wide-sandbox.mjs`），在其上复现并剖析。

**根因（可核，CPU profile 与 span 一致）**

- U1：`initialize` 构建 instructions 时反复读解析 320 个 Source 的 manifest／overlay（`loadDescriptionIndexes`），并发握手在同进程内串行排队放大。旧构建窗口 M1 P99 达 **18.4 s**（n＝891，含并发突发）。
- U4：拒绝／门闩路径为列出可选来源调用 `listSources`，其中的「已授权 Agent 数」对**每个 Agent** 重新编译权限，宽目录下单次拒绝 ≈ 470–570 ms。

**修复（最小改动）**

| 项 | 改动 | 与 Spec 的差异 |
|---|---|---|
| U1 | `webui/server/proxy/source-descriptions.ts`：`loadDescriptionIndexes` 外包一层**按文件指纹**（`file｜mtimeMs｜ctimeMs｜size｜ino`）校验的缓存，命中不读内容，任何文件变化下一次调用即失效；键＝语义层根＋可见连接集合；最多 64 项；返回深拷贝防污染 | **偏离** Spec §U1 的「instructions／generation 缓存」设计：没有跨身份缓存、没有代际、没有陈旧窗口，因此 Spec 里针对 instructions 缓存的 SC-02(a)(c)5b6 项**不适用**。7 项 vitest 覆盖命中／未命中、与未缓存读取等价、同大小只改 mtime 也失效、overlay 增删、manifest 删除、范围隔离、变异安全 |
| U4 | `webui/server/semantic-layer.ts`：`listSourcesWithManifests(root, { skipAuthorizedCounts })`；`mcp-proxy.ts` 在 `collectRepairEvidence` 与 SAG 探测两处传 `skipAuthorizedCounts: true`（拒绝路径不需要「已授权 Agent 数」）。vitest 断言轻量列表与完整列表仅在授权计数上不同 | 与 Spec §U4「拒绝快速返回」意图一致；实现为跳过权限编译而非新增快路径 |
| U2 补 | SC-05：裸形状（仅 `connectionId`、`measures: []`）的拒绝文案原本**没有示例**——UAT-MCPX-05 实测发现；已补 | 真实缺口，由 UAT 发现 |
| U2 补 | 重复拒绝提示接入来源门闩、口径拒绝与 SAG 拒绝点 | 关闭 v1.0 §8 第 6 项 |
| P1-36 补 | `span 导出` 分片并让出事件循环；10 万 trace 规模下事件环 max 98 ms | 关闭 v1.0 §8 第 4 项 |

**效果（宽目录沙箱）**：门闩拒绝 P50 568→194 ms（P99 723→235 ms）；ACL 工具拒绝 P50 466→177 ms；顺序握手 P50 13 ms；200 并发突发 P99 1.5 s、0 次 >30 s。详表见 [MCP-UX 跑次](../qa/uat/suites/mcp-ux-resilience/runs/2026-11-17-claude-wide-sandbox-tierA.md)。

**残余项（如实）**

- 允许路径上宽目录的合法 `lucy_query` 仍约 600 ms（每次调用解析 manifest），本批未优化。
- 策略提交后的首批握手约 0.5–0.6 s（所有身份权限重编译），不是长尾，未改。
- 客户现场的 >30 s 是否同一根因**仍未证实**；须客户侧采集 P1-36 阶段 span。

## 10. v1.1：UAT 跑次与新登记的发现

- 跑次：[MCP-UX](../qa/uat/suites/mcp-ux-resilience/runs/2026-11-17-claude-wide-sandbox-tierA.md)（PASS WITH GAP；MCPX-09／10 BLOCKED）、[TRACE-LEDGER](../qa/uat/suites/trace-span-ledger/runs/2026-11-17-claude-wide-sandbox-tierA.md)（PASS WITH GAP；TRC-07／08／09 NOT RUN）。
- **需要委托人裁定**：
  1. **F-3**：P1-36 Spec SC-06「其他 `tools/call` 行主状态不为 `unknown`」与 §6.2「`tools/call` 主状态证据路径保持 `v2p5-1` 不变」冲突；实现按 §6.2，入参校验失败行仍为 `unknown`（客户基线 104 行）。选项：A 把 SC-06 改成「协议／wiki 行」；B 为入参校验失败行补 `failed`／`denied` 证据（动派生规则，须另批）。
  2. **F-2**：正式完整导出 `mode=complete` 因既有 F-02（`attribution_journal_baseline_seq` 未登记）失败关闭，导致 P1-36「封存包含 `spans.csv`」目前只能在诊断包里验证。是否另立条目修 F-02，不由本条处理。
- 其余发现 F-1（审计写入失败丢整行的缺口只能靠发送清单对账发现）、F-4（被拒阶段 span 的 `seq` 排在 `response_serialize` 后，读序应以 `started_at_ms` 为准）、F-5（管理员登录即追加账本事件，紧接导出会撞投影滞后）见 TRACE-LEDGER 跑次。
- M1–M6 取数：`scripts/uat/mcp-ux-metrics.mjs`（自测 5 项通过；UAT-MCPX-12 与已知值核对 PASS）。
