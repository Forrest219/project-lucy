# Claude Code Opus 终审记录

| 项 | 值 |
|---|---|
| 计划执行时间 | 2026-06-22 02:00:00 Asia/Shanghai |
| 实际开始时间 | 2026-06-22 02:00:04 CST +0800 |
| 实际结束时间 | 2026-06-22 08:33:21 CST +0800 |
| 退出码 | 0 |
| 目标文档 | /Users/forrest/Projects/project-lucy/inbox/ktx-mcp-usage-improvement-plan-2026-06-21.md |

I've reviewed the plan against all reference materials, including both KTX tool surfaces. I found one structural issue that the plan's own premise depends on. Here's my final review.

---

# 终审 Review：KTX MCP 调用量改善活动计划

## 1. 总体结论

**有条件通过（Conditional Pass）。**

作为"改善活动 / 前置调研"闸门，本文档定性正确、责任边界清楚、明确拒绝了把 KTX 上游 schema 与内部规则落入 lucy 的反模式。**A0 / A1 / A3 的设计与调研可以进入。**

但在批准 A2 改 `CLAUDE.md` 和 A4 写代码之前，有一个**贯穿性前提缺口必须先澄清**：计划默认"Lucy MCP Proxy 缓存能压低观测到的调用量"，但当前重流量客户端很可能根本不经过 proxy（详见 F1/F2）。这个前提不澄清，A4 的验收信号会"在合成测试里通过、但真实数字不动"。因此 A2/A4 标记为有条件接受，与 Codex 临时自审一致。

---

## 2. Findings（按严重程度）

### F1【高 / 阻塞 A4 立项前提】重流量客户端可能直连 KTX :7878，proxy 缓存截不到

- **位置**：§3 A4「目的」、§2 已确认事实、验收信号；对照 `07-mcp-auth-proxy-spec.md` §7（`.mcp.json` url **计划**改为 `:7879`，当前 Onboarding `DEVELOPMENT.md` §Onboarding 仍写 `http://localhost:7878/mcp`）。
- **问题**：观测到的 1,965 次 `tool_use`（含 863 `sql_execution`、616 `sl_read_source`、167 `connection_list`）是直连 KTX `:7878` 的客户端/运行时产生的。Lucy MCP Proxy 在 `:7879`，目前还不是这些调用的必经路径。**缓存放在 proxy 里，只能拦到经过 proxy 的流量**；如果重流量仍直连 `:7878`，A4 的验收信号（"同一 token + 同一 input 命中缓存"）可以在合成测试里满足，但**不会降低真实观测到的 616/167**。
- **建议修改**：
  1. A0 增加一项硬指标：**逐客户端记录 endpoint 路由**（每个 client 的 `.mcp.json` 指向 `:7878` 还是 `:7879`），并标注 1,965 次到底来自哪条路径。
  2. A4「目的」补一句前置条件：*缓存仅对经 proxy 路由的客户端生效；要让它影响观测基线，必须先把重流量客户端切到 `:7879`*。否则把 A4 的收益主张降级为"为未来 proxy 化客户端预留"。

### F2【高 / 影响 A2 可行性】`kx_catalog` 不在 `CLAUDE.md` 运行时 agent 的工具面里

- **位置**：§3 A2 建议规则「已知 KX 财务核心问题优先使用 semantic layer / `kx_catalog`」。
- **问题**：`kx_catalog` 是 **proxy 注入并直接服务**的工具（`07` §5.1.1 / §6.1），只对经 `:7879` 的外部客户端可见。而 `CLAUDE.md` 是由 `ktx.yaml` 注入给 **KTX 内置运行时 agent** 的 prompt，该 agent 在 KTX 进程内、直接拿 KTX 原生工具（`CLAUDE.md` 工具表只有 `sl_read`/`sl_query`/`wiki_search`/`sl_validate`，源码侧还有 `connection_list`/`discover_data`/`entity_details` 等）。**它的工具面里没有 `kx_catalog`。** 把"优先用 `kx_catalog`"写进 `CLAUDE.md`，等于让运行时 agent 调一个它看不到的工具。
- **根因**：A2（改 `CLAUDE.md` → 作用于运行时 agent）和 A4（proxy 缓存 → 作用于 proxy 路由客户端）**针对的是两群不同的调用方**，计划把它们当成同一群在治理。
- **建议修改**：A2 落规则前先确认目标 agent 的真实工具面：
  - 若规则面向运行时 agent → 用 `discover_data` / `sl_*`，**删掉 `kx_catalog` 字样**。
  - 若规则面向经 proxy 的外部客户端 → 这类约定不属于 `CLAUDE.md`，应放客户端侧 prompt 或 proxy 的 `kx_catalog` 返回内容里。

### F3【中 / A2 正确性】"`sl_read_source` 已覆盖就跳过 `entity_details`"对 manifest 为主的 KX 维表/视图站不住

- **位置**：§3 A2 第 2 条第 3 点。
- **问题**：`sl_read_source` 返回的是 **overlay YAML**（measures/业务列描述）；`entity_details`(MCP) 返回的是 **live-database scan 快照**（`nativeType`/`nullable`/`primaryKey`/`sampleValues`/`foreignKeys`/`estimatedRows`，见 `context-tools.ts` 的 `entityDetailsOutputSchema`）。二者是不同信息源。`project-overview.md` §5 显示 `kx_dim_*` / `kx_vw_*` 是"manifest 为主"，overlay 很薄——此时 `sl_read_source` 并不"覆盖"物理列/类型/样例值。当前规则虽有例外子句（"需要 sample values、物理 scan 字段或权限验证时调用"）兜底，但主句"已由 `sl_read_source` 覆盖"措辞过强，容易诱导模型在缺物理列信息时也跳过。
- **建议修改**：把主句改为约束性更弱的表述，例如"**同一轮内**若已读过该 source 的 overlay 且本轮无需物理列/类型/样例值，则不重复 `entity_details`"，并显式点出 KX 维表/视图 overlay 薄、物理列以 scan 为准。

### F4【中 / A0 可即时收敛】`maxRows` vs `rowLimit` 不是版本漂移，是两个并存工具面

- **位置**：§2 最后一条 bullet、§3 A0 第 3 步。
- **问题**：计划把日志里的 `maxRows` 与源码里的 `rowLimit` 当作"运行时版本或暴露层需先对齐"。但对照源码：**MCP 暴露面** `context-tools.ts` 的 `sql_execution` 用 `maxRows`（default 1000）；而 ingest 阶段的 `warehouse-verification/sql-execution.tool.ts` 用 `rowLimit`（default 100）。**两者在同一份代码里并存**，是两个不同工具面，不是版本 skew。日志里的 `maxRows` 恰好对上 MCP 面。`entity_details` 同理：MCP 面是 `entities[]`，ingest 面是 `targets[]`，`07` §6 抽表逻辑引用的是 MCP 的 `entities[].table`，一致。
- **建议修改**：A0 不必为这个"版本差异"做大调查——结论已可从提供的源码直接给出。A0 改为只确认**外部客户端实际命中哪个工具面**，并把这条结论写回 §2（移除"版本漂移"措辞）。

### F5【中 / A4 安全语义需收紧】缓存 key 的"或"有歧义；真正的跨权限防线是 ACL-first，不是 key

- **位置**：§3 A4「cache key 至少包含 … user id **或** permission snapshot hash」、「表级 ACL 必须先于 cache 命中判断执行」。
- **问题/判断（回应 Q2）**：候选缓存工具（`connection_list`/`sl_read_source`/`entity_details`/`wiki_read`）都是 KTX 原生工具，而 KTX 源码里 `userId` 硬编码 `'local'`、**不做按用户过滤**——也就是说同一 `(tool, input)` 对任何调用方返回的字节完全相同，**内容本身不随权限变化**。因此跨权限泄漏的唯一真实防线是 `07` 已定义的 **ACL-first + fail-closed**，cache key 里的身份只是纵深防御。所以：
  - "user id **或** permission snapshot hash"的"或"是隐患：若实现者选 user id，碰上 role reload（`07` §5.1.2 的 30s TTL / 主动 reload）就可能在 TTL 内按旧权限放行。应改为**强制 ACL-first 判定 + 复用 `07` 已有的 `permission_snapshot_hash`** 作 key 组成，不要新造一个概念。
  - key 还应纳入**数据快照/索引版本**：`entity_details` 输出带 `snapshot.syncId`；`sl_read_source` 读的是 reindex 后的 SQLite 索引、wiki 可被 WebUI `/wiki` 编辑。短 TTL 不能保证"WebUI 改完 → 立即不命中旧值"。
  - "schema 修改、权限 reload、proxy restart 时缓存可失效"目前是**断言**，需落成**显式失效钩子**（接到 reindex / access.yaml reload / wiki 保存路径），否则 5–10 分钟 TTL 内会发旧定义。
- **建议修改**：A4 设计约束改写为：①ACL-first 为硬前提；②key = `tool + normalized input + permission_snapshot_hash + 数据快照/索引版本`（去掉"或"）；③失效钩子绑定 reindex/reload/wiki 保存，而非仅靠 TTL。

### F6【中 / A4 与 07 对齐】audit 需要新增 `served_from`/`cache_hit` 维度，不能复用 outcome 枚举

- **位置**：§3 A4「audit 中能区分 forwarded 与 cache_hit」；对照 `07` §5.2 的 `outcome ∈ {ok,error,denied}` 与 §6.1.1 `decision_reason`。
- **问题**：现有 audit 没有"是否命中缓存"维度。把 cache_hit 塞进 `outcome` 会污染既有语义。
- **建议修改**：A4 明确要求新增独立字段（如 `served_from: forwarded|cache`），并在 ADR 里登记为对 `07` §5.2 的 schema 增量。

### F7【低 / Q5】A3 之前先确认 eval 框架是否已支持"逐 case 工具调用计数"

- **位置**：§3 A3 验收信号「eval 能输出每个 case 的工具调用计数」。
- **问题**：这条被列为验收目标，暗示能力可能尚不存在。`project-overview.md` §7 只说有 eval/quiz，未说明 harness 是否已采集 per-case tool-call 计数。
- **建议修改**：A3 前置一步——核对 `evals/` harness 现状；若已采集则 A3 是写断言，若未采集则 A3 含 harness 改造，工作量与归类（前置调研 vs 开发）会变。

### F8【低】`connection_list` 167 次的最廉价解法是 A2 行为约束，不一定是缓存

- **位置**：§2、§3 A4 候选工具。
- **说明**：项目当前只 1 个 connection 且返回恒定。`07` §6 明确 `connection_list` "无需检查"、proxy 也不按权限过滤其输出——所以缓存它安全但收益低。更省的是 A2 加一条"单 connection 项目不反复 `connection_list`"。可作为 A2/A4 取舍的说明，不阻塞。

### F9【低 / 落位】A4 进入代码时应作为 `webui/docs/07` 的增量 ADR，而非孤立 inbox 笔记

- **位置**：§5 第 5 步、§7 待终审 Q4。
- **说明**：A4 是对**已存在的** `07-mcp-auth-proxy-spec.md`（canonical proxy spec）的扩展。按 `DEVELOPMENT.md` §Spec 落位规则，proxy 实现细节应落 `webui/docs/`。ADR 应显式声明"修订 `07` 的 §5.2 audit schema 与 §6 ACL/缓存交互"，并在 `project-overview.md` §9 索引注册。

---

## 3. 共识与争议矩阵

| 项 | 内容要旨 | 评价 | 标记 |
|---|---|---|---|
| **A0 版本对齐核查** | 确认 daemon/clone/log 版本一致 | 方向对；但 `maxRows/rowLimit` 已可由源码直接收敛（F4），应改为"确认客户端命中哪个工具面 + 逐客户端 endpoint 路由"（F1） | 【双方接受，可进入】（按 F1/F4 调整范围） |
| **A1 复盘脚本固化** | 把一次性复核转周报脚本 | 复用已存在的 `ktx_mcp_usage_recheck_2026-06-21.py`，落 inbox，不进 docs，纯观测无副作用 | 【双方接受，可进入开发/前置活动】 |
| **A2 收紧 `CLAUDE.md` 使用侧约定** | 减少无效探索调用 | 治理类变更须单独出计划（DEVELOPMENT.md 强制 Plan Mode）；且存在 F2（`kx_catalog` 工具面错位）+ F3（entity_details 跳过的正确性风险）两处实质问题，须先改 | 【有条件接受，先补前置条件：澄清目标 agent 工具面 + 修正措辞 + 单独计划】 |
| **A3 tool-budget eval** | 把"少重复"变可测指标，预算失败记 P2/P3、保留正确性断言 | 设计合理、不牺牲正确性；唯一前置是核对 harness 是否已支持计数（F7） | 【双方接受，可进入设计】（先做 F7 能力核对） |
| **A4 proxy 只读缓存** | 可撤销短 TTL 只读缓存实验 | 方向合理；但依赖 F1 路由前提才有真实收益，且 key/失效/audit 语义需按 F5/F6 收紧，须先 ADR | 【有条件接受，先补 ADR + 路由前提澄清】 |
| **A5 上游 issue 材料** | 给 KTX 提 `sourceVersion`/`cacheable` 元数据需求 | 正确地把"长期修复"放回上游；明确区分上游建议 vs lucy 临时缓解；无凭据泄漏约束到位 | 【双方接受，可进入】 |
| **"不建议做的事"** | 不转正式 spec / 不抄 KX schema 进 `CLAUDE.md` / 不抄 KTX 内部规则 / 不默认开缓存 / 不缓存 SQL 结果 / 不把单次测试当长期结论 | 完全认同；与 `DEVELOPMENT.md` 双轨语境、`07` Non-Goals 一致，是本计划最稳的部分 | 【双方接受】 |

> 与 Codex 临时自审的一致性：职责边界、A4 须先 ADR、A2 须单独计划、本文不构成开发批准——**四点完全一致**。我额外加了 F1（路由前提）与 F2（`kx_catalog` 工具面错位），这两点 Codex 自审未覆盖，建议一并纳入仲裁视野。

---

## 4. 最终开发闸门

**可以进入（前置调研 / 设计，低风险、可撤销）：**
- A0 版本对齐核查 —— 范围按 F1/F4 调整（加逐客户端 endpoint 路由；去掉版本漂移调查）。
- A1 复盘脚本固化 —— 直接进行，落 inbox。
- A3 eval budget **设计** —— 先做 F7 的 harness 能力核对，再写断言。
- A5 上游 issue 材料整理。

**必须留给 Forrest 仲裁 / 补前置条件后才能动：**
- **A2 改 `CLAUDE.md`** —— 须 (a) 澄清规则面向哪群 agent、确认 `kx_catalog` 是否在其工具面（F2）；(b) 修正 entity_details 跳过措辞（F3）；(c) 走独立 Plan Mode 计划。**不在本文档授权范围内。**
- **A4 proxy 缓存写代码** —— 须 (a) 先澄清 F1 路由前提（不然收益主张不成立）；(b) 出 ADR（修订 `07` 的 audit/ACL 交互，按 F5/F6 收紧 key 与失效）；(c) 默认关闭。**本文档只批准其调研/设计，不批准实现。**

判定：本文档**可作为"改善活动阶段"的启动依据，但不构成 A2/A4 的开发批准**——与 §6 与 §8 Codex 自审结论一致。

---

## 5. 可落盘的简短修订建议（不改本文件，供下一版采纳）

1. **§2 末条 bullet**：删除"版本漂移"措辞，改为"`maxRows`(MCP 面) 与 `rowLimit`(ingest 面) 是两个并存工具面，日志对应 MCP 面；A0 改为确认外部客户端命中的工具面"。（F4）
2. **§3 A0 验收信号**新增一行：「能说明每个客户端的 `.mcp.json` 指向 `:7878` 还是 `:7879`，并标注 1,965 次调用的来源路径」。（F1）
3. **§3 A2 第 2 条第 1 点**：把 `kx_catalog` 替换为运行时 agent 实际可见工具（`discover_data`/`sl_*`），或注明"该规则仅适用于经 proxy 的外部客户端，不写入 `CLAUDE.md`"。（F2）
4. **§3 A2 第 2 条第 3 点**：主句改为"同一轮内、且本轮无需物理列/类型/样例值时"才跳过 `entity_details`，并点明 KX 维表/视图 overlay 薄、物理列以 scan 为准。（F3）
5. **§3 A4 设计约束**：cache key 去掉"或"，固定为 `tool + normalized input + permission_snapshot_hash(复用 07) + 数据快照/索引版本`；ACL-first 列为硬前提；新增"失效钩子绑定 reindex / access.yaml reload / wiki 保存"；audit 增 `served_from` 字段而非复用 `outcome`。（F5/F6）
6. **§5 第 5 步**：把"ADR 或小 spec"明确为"修订 `webui/docs/07` 的 ADR，并在 `project-overview.md` §9 注册"。（F9）

---

需要我把这份终审单独落一份 `inbox/` review 记录（只读评审产物，不改原计划），方便你回填到原文档的"§8 终审交付状态"吗？
