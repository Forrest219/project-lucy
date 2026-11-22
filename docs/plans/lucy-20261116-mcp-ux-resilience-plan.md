# MCP 握手、失败信息、会话恢复与快速失败（体验韧性）Plan（P1-37）

| 元数据 | 内容 |
|---|---|
| 文档名称 | MCP 握手、失败信息、会话恢复与快速失败（体验韧性）Plan |
| 文档类型 | Other（实施 Plan） |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-16 |
| 撰写人 | Claude（Cursor Agent） |
| 委托人 | xingchen |
| 基于材料 | [Spec](../specs/lucy-20261116-mcp-ux-resilience-spec.md)；[P1-35 Spec](../specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md)；[P1-36 Spec](../specs/lucy-20261116-trace-span-ledger-spec.md)；客户全量调用流水分析（2026-11-16） |
| 适用范围 | P1-37／REQ-030-058：U1 握手长尾、U2 失败信息可操作、U3 会话恢复与限流、U4 拒绝快速返回；指标字典与 UAT |
| 状态 | **S4｜终稿确权（委托人 2026-11-17 授权代理修正后定稿，免 Codex 终审）；v1.0；已获开发授权（委托人 2026-11-17「授权开发落地」）；部分落地：U1（描述索引按文件指纹缓存；宽目录沙箱复现长尾后修复，**偏离 Spec 的 instructions 缓存设计**）、U2、U3a、U4（拒绝与门闩路径跳过逐 Agent 权限编译）已实现；U3b 按委托人决定不实现（MCPX-09／10＝BLOCKED）；M1–M6 取数脚本与宽目录沙箱夹具已交付并通过 MCPX-12 核对；vitest 回归无新增失败，本机 demo 已平滑升级；测试台 `UAT-SUITE-MCP-UX-RESILIENCE`＝**PASS WITH GAP**（2026-11-17 宽目录沙箱 Tier-A 跑次 `docs/qa/uat/suites/mcp-ux-resilience/runs/2026-11-17-claude-wide-sandbox-tierA.md`；MCPX-09／10 BLOCKED，其余缺口见跑次，不是整套 PASS）。≠ UAT PASS；≠ 可上线** |
| 授权边界 | 本 Plan **只定义步骤与验证**。终稿确权已获得（委托人 2026-11-17 授权代理修正后定稿，免 Codex）；O1–O7 已按 Spec §9 闭合（O6 转开工前置）。改运行代码仍须**委托人另发开发授权**。不含：门闩判定改写（P1-35）、解冻 P0-7、U5–U8、改 KTX 源码、客户现场验证 |
| 验收 | 见 §3 |
| 输出位置 | `docs/plans/lucy-20261116-mcp-ux-resilience-plan.md` |

**清单**：P1-37（**不入核心分母**）｜**REQ**：REQ-030-058｜**总账**：[功能清单池](lucy-20261107-lucy-0-30-feature-inventory-pool.md)｜**Spec**：[mcp-ux-resilience-spec](../specs/lucy-20261116-mcp-ux-resilience-spec.md)

## 1. 目标

让 MCP 客户端（含纯 MCP 与定时任务）在握手、被拒（门控）、上游会话失效时得到**有界延迟与可操作的下一步**（普通上游连接拒绝／超时／5xx 不在本条）；用指标把这些体验量化，用 UAT 把它们变成可反复复现的回归。**先量后改**：每项修复须附根因取证。

## 开工前置

- 已入总账：P1-37／REQ-030-058（2026-11-16）。
- 终稿确权已获得（2026-11-17）；**开发授权未获得**：未获得前实现步骤冻结。
- O1–O7 已闭合；其中 **O6（KTX 会话失效响应形态）是步骤 0 的取证交付，先于 U3a 实现**；**O7 定稿决策：U3b（SC-09／SC-10，持续失效短路）移出本条出口，不随本条实现**，UAT-MCPX-09／10 为伴生，夹具未闭合记 BLOCKED 但不阻塞本条收口。
- 与 P1-36 的关系：步骤 0 的阶段取证优先用 P1-36；P1-36 未授权时按 Spec §6 用等价最小计时，**该最小计时先入 Spec 变更**。
- 环境：本机 demo Docker（平滑升级）；会话失效、策略重载、大目录夹具按 `UAT-SUITE-MCP-UX-RESILIENCE` fixtures 构造；不触碰客户实例；不 `git commit`。

## 2. 步骤与验证

| 步骤 | 内容 | 验证 |
|---|---|---|
| 0 | **取证与夹具交付**：握手阶段计时（`skills_load`／`instructions_build`／`catalog_resolve`／`upstream_handshake`）；:7879 事件环采样入口；在 demo **真实重启 KTX** 取会话失效的实际响应体与头；用 KTX 真实调用确认「必然被拒的入参形状」与合法形状清单；交付 `scripts/uat/`：握手压力脚本（含发送清单）、大目录造数脚本（≥ 300 可见 Source）、测试身份 A／B 与 **≥ 17 身份（全局 LRU 用）**创建与清理、撤权保密延迟钩子与 skills 变更脚本、上游调用只读计数入口（若 KTX 无请求日志）、缓存与重复被拒状态只读计数入口 | 取证报告落 `docs/reviews/`；回填 Spec O6；形态清单写入跑次；**夹具就绪门禁**：每个夹具须有固定命令、输入、输出格式、清理与失败判据，并 dry-run 通过；未通过前依赖它的用例记 **NOT READY**，不得写基线结果 |
| 1 | **基线**：改前跑 UAT-MCPX-01／02／04／05／06／07／08（09／10 为 U3b 伴生，记 BLOCKED），记录 M1–M6 基线 | `runs/…-baseline.md`；INDEX 基线 FAIL 入账（不得写 PASS） |
| 2 | **U3a**（入出口）：恢复匹配扩到取证确认的形态；覆盖 `ping` 与 `wiki_search` 本地回退；每个原请求至多 1 次恢复握手＋1 次重试；内部恢复握手须 `notifications/initialized` 2xx 才缓存新会话；以显式 `RecoveryResult` 归一四类恢复失败。**U3b（持续失效短路，不入出口、本步不实现）设计保留于 Spec U3b**：guard 键＝（agentId，tokenHash，下游会话作用域），进入时固定；短路（第 N+1 个请求起，普通请求上游调用 ≤ 4N），`initialize` 不被计数短路但 open 期每 T=5 s 至多 1 次上游尝试（60 s 总上界 44）；任一健康上游响应清零；短路请求不刷新窗口，60 s 无新失败自然半开；**两套握手状态机**：内部恢复握手须 `notifications/initialized` 2xx 才缓存与清零，客户端 `initialize` 只登记 pending reset、notification 被上游接受后才清零；本地降级 initialize 不清零 | vitest `mcp-proxy-upstream-session` 扩展；U3a＝SC-07／08（U3b 的 SC-09／10 不在本步） |
| 3 | **U2**：未知工具名分支前移并带**本身份可见**清单；仅复制 KTX 必然拒绝形状的入参校验前移（Lucy 工具名＋示例，无 `sl_query`）；重复被拒提示（键＝身份＋下游会话作用域＋工具＋`rejection_fingerprint`＋理由＋`policy_version`；固定 TTL 60 s、单身份 64／全局 1024 LRU）；新增拒绝行审计列 `rejection_fingerprint`（**HMAC**，服务端密钥不入库不导出，版本前缀，M3 同版本内比较）；拒绝工具清单＝该身份真实 `tools/list` 名称集合 | vitest 契约；SC-04／05／06 |
| 4 | **U4**：拒绝路径用既有目录缓存、廉价检查前置；钉选放行不退化 | SC-11；`UAT-MCPX-07` |
| 5 | **U1**：按取证选修复（instructions 缓存键＝有效权限摘要＋`policy_version`＋skills 哈希，LRU＋换代失效；握手只读预先维护的摘要，命中时读盘为 0；**响应发送前重验 generation，变化则重建，撤权后不得发出旧代内容**；skills 失效＝写入事件换代＋文件级后台周期复核，**冻结复核周期 ≤ 30 s 为最大陈旧窗口**；重载异步预热；只清受影响会话） | SC-01／02；`UAT-MCPX-01／02`（SC-03／`UAT-MCPX-03` 伴生） |
| 6 | **指标**：把 M1–M6 的取数口径落到文档与取数脚本（只读调用流水）；**不接告警**；M7–M9 不入出口 | SC-13；`UAT-MCPX-12`（必做，以自产行已知值核对） |
| 7 | **主路径回归**：合法分析师单表、多表 join、纯 MCP；钉选后合法成交最小对照（P1-35 整套回归走发布取证／持续节奏） | SC-12；`UAT-MCPX-11` |
| 8 | 全套 UAT 跑次 | `UAT-SUITE-MCP-UX-RESILIENCE` 必做全绿；INDEX 判定 |

## 3. 验收

- Spec SC-01、02、04–13 有证据（vitest、测试台跑次分别标等级）；SC-03 为伴生，不入出口。
- 必做用例 PASS：R0、01、02、04、05、06、07、08、11、12；`UAT-MCPX-03`（依赖 P1-36）与 `UAT-MCPX-09／10`（U3b，夹具待 O7）伴生，不入必做、不阻塞本条收口。
- 每个修复在 PR／实现记录里附取证条目（根因闸门）。
- 新增 npm 命令或 CI job（若有）登记进 [`test-layers-and-release-gates.md`](../governance/test-layers-and-release-gates.md) §2／§8。

## 浏览器验证

不适用：本条不改 WebUI 页面、组件与文案，不触发交互合同；验收走 MCP、HTTP、SQL 与自动化测试，默认不做浏览器测试，也不做移动窄屏测试（见 DEVELOPMENT「验证策略：浏览器测试约束」）。

## 4. 完成定义

功能合同层：Spec 头部状态更新并同步镜像（总账、`docs/README.md`、`docs/plans/README.md`）；测试台 INDEX 有跑次与判定。**≠ UAT PASS 的自动推定；≠ 可上线。** 告警接线、U5–U8 另立行，不在本条状态里暗示已含。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| 假设与根因不符 | 取证闸门；无证据不改 |
| （U3b 启用时）短路误伤正常重连 | 按会话计数、窗口有界、健康响应清零；SC-10 随 U3b 必做 |
| instructions 缓存读到旧内容或串权限 | 缓存键含有效权限摘要＋策略版本＋skills 哈希；换代失效；UAT-MCPX-02 负向断言 |
| 工具清单越权枚举 | 清单仅限当前身份 `allowedToolNames`；UAT-MCPX-04 双身份差分 |
| 持续失效夹具造不出来 | O7 定稿决策：U3b 移出出口；BLOCKED 停表，不用替身凑绿 |
| 会话失效形态不可稳定识别 | O6 先取证；识别不稳则不扩恢复匹配，并回写 Spec |
| 与 P1-35 修订互相踩 | U2 只引用 P1-35 载荷；改门闩文件时建议同跑 P1-35 套件（持续节奏，非本条出口） |
| 客户运行版本与仓库不一致 | O4 先答；基线在本机 demo 取得 |
