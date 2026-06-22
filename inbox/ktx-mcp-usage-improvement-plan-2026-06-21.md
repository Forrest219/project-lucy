# KTX MCP 调用量改善活动计划

| 元数据 | 内容 |
|---|---|
| 文档类型 | Improvement Plan / 行动建议 |
| 日期 | 2026-06-21 |
| 来源 | `/Users/forrest/Documents/my_vault/00_Inbox/ktx_mcp_usage_review_2026-06-21.md` 及 Codex 复核 |
| 状态 | Claude Code Opus 终审已完成；结论为有条件通过 |
| 落位说明 | 本文是过程性改善计划，放在 `inbox/`；不是正式 spec，不进入 `docs/` |

## 1. 结论

当前不建议直接进入大规模开发，也不建议把 KX 核心表 schema 手工写入
`CLAUDE.md`。可以进入一组低风险改善活动：先建立观测基线，再收紧使用侧约定，
最后用 Lucy MCP Proxy 做可撤销的只读缓存实验。

目标不是替代 KTX 上游能力，而是在 KTX 上游暂不可控的前提下，减少本地运行时的
重复元数据调用，并确保不会制造新的 schema 漂移源。

## 2. 已确认事实

- 复核窗口内 ktx MCP `tool_use = 1,965` 可复现。
- `sql_execution` 863 次，`sl_read_source` 616 次，二者约占 75%。
- `sl_read_source` 的 Top sources 集中在 KX 财务核心表和视图。
- `connection_list` 167 次返回内容完全一致，当前实际返回 1 个 connection。
- ktx tool result 与 ktx tool use 是 1:1 配对；原报告中的 3,691 更像是全工具
  result 数，不是 ktx result 数。
- 按记录内 `timestamp` 复核，调用集中在 2026-06-20 与 2026-06-21；不能用
  jsonl 文件 mtime 推导 7 天逐日调用分布。
- 本机 KTX clone 位于 `/Users/forrest/projects/ktx/ktx`，远端为
  `https://github.com/Kaelio/ktx.git`。
- 本机 KTX 源码中 MCP 工具实现显示：
  - `connection_list` / `sl_read_source` / `entity_details` 带有 `readOnlyHint`
    与 `idempotentHint`。
  - `discover_data` 的 MCP tool description 当前不包含“后续调用 `sl_read_source` /
    `entity_details`”的显式引导；此类行为更可能来自模型策略或其他工具面。
  - `sql_execution` 在 MCP 面使用 `maxRows`（默认 1000），在 ingest 工具面使用
    `rowLimit`（默认 100）；两者是并存工具面，不应误判为版本漂移。

## 3. 改善活动分层

### A0：版本对齐核查

目的：确认当前运行中的 KTX MCP、外部客户端 endpoint、工具面与本机 clone / GitHub
upstream 的关系，避免基于错误路径或错误工具面做优化判断。

建议动作：

1. 记录当前 CLI 路径与版本：`which ktx`、`ktx --version`。
2. 记录 daemon 启动来源：Claude Code / `.mcp.json` / `ktx mcp start` 使用的可执行文件。
3. 逐客户端记录 MCP endpoint：确认 Claude Code、Codex app、Lucy proxy 客户端等到底
   指向 `:7878` 还是 `:7879`，并标注 1,965 次调用的来源路径。
4. 对照运行中 `tools/list` 的 `sql_execution` input schema，确认外部客户端命中的是
   MCP 面 `maxRows`，还是 ingest 面 `rowLimit`。
5. 记录 `/Users/forrest/projects/ktx/ktx` 的当前 commit、branch、remote。

验收信号：

- 能明确说明报告日志、当前运行 daemon、本机 clone 三者是否为同一版本。
- 能明确说明每个重流量客户端是否经过 Lucy MCP Proxy `:7879`。
- 后续所有数据复盘都附带 KTX 版本信息。

### A1：固化 usage 复盘脚本

目的：把一次性复核转成可重复观测，避免只凭单次集中测试下结论。

建议动作：

1. 基于 `inbox/ktx_mcp_usage_recheck_2026-06-21.py` 整理一版周报脚本。
2. 输出至少包含：
   - ktx tool_use / tool_result。
   - Top tools、Top `sl_read_source.sourceName`。
   - result/input bytes，并注明文本长度或 JSON 编码口径。
   - 按记录内 `timestamp` 的日分布。
   - 同一 session 内重复读取统计。
   - KTX CLI path / version / daemon schema 摘要。
3. 输出继续落 `inbox/`，作为过程性审计，不进正式 docs。

验收信号：

- 一条命令能生成稳定 Markdown/JSON 摘要。
- 报告中不再混入非 ktx 工具 result。
- 能对比改善前后重复元数据调用是否下降。

### A2：收紧运行时使用侧约定

目的：减少模型在已知 KX 财务域中的无效探索调用，但不复制 schema。

建议动作：

1. 在修改 `CLAUDE.md` 前先单独提出计划，因为它是运行时治理文件。
2. 可考虑新增的规则方向：
   - 已知 KX 财务核心问题优先使用目标 agent 实际可见的 KTX 原生工具，例如
     semantic layer / `sl_query` / 必要的 `sl_read_source`，避免每轮先 broad
     `discover_data`。
   - 同一轮已读取过的 `sourceName` 不重复调用 `sl_read_source`，除非用户要求验证
     schema 变化。
   - 同一轮内，如果已读取过某 source 的 semantic-layer 定义，且本轮无需物理列、
     类型、PK/FK 或权限验证，不再立刻用 `entity_details` 读取同一表的完整列定义。
     KX 维表/视图 overlay 较薄时，物理列信息仍以 scan / `entity_details` 为准。
   - 当前 KTX MCP 面的 `entity_details` 不返回 `sampleValues`；需要样例值时，不应
     指向该 MCP 工具，应考虑 `dictionary_search` 或其他 profile/value 工具。
   - 保留 raw SQL 只读约束，继续要求业务回答附 provenance。
3. 明确禁止：
   - 不把 6 张 KX 核心表字段清单手工复制到 `CLAUDE.md`。
   - 不把一次性 usage 统计写入 `CLAUDE.md`。
   - `CLAUDE.md` 中的工具使用规则只能要求调用目标 agent 实际可见的工具；proxy 专属
     工具（例如 `kx_catalog`）不得写成 KTX 运行时 agent 的必调用路径。可说明某工具
     仅在 proxy 路径可见，但不能把不可见工具写成操作指令。
   - 不让 prompt 规则绕过必要的数据验证。

验收信号：

- 新增规则是行为约束，不是 schema 副本。
- eval 中同一 case 的重复 `sl_read_source` 明显下降。
- 回答正确率不因减少探索调用而下降。

### A3：增加 tool-budget eval / 回归约束

目的：把“少重复调用”变成可测指标，而不是只靠 prompt 期望。

建议动作：

1. 在 KX 财务 eval 中增加工具调用预算断言：
   - 同一 `sourceName` 在单 case 内 `sl_read_source` 不超过 N 次。
   - 已知表路由问题不应先 broad `discover_data`。
   - 简单口径问题不应调用 `connection_list`。
2. 对关键 case 保留正确性断言，避免模型为了省工具而不验证。
3. 将 budget 失败作为 P2/P3 级别的效率回归，不直接等同于答案错误。

验收信号：

- eval 能输出每个 case 的工具调用计数。
- 至少覆盖 KX 财务 source 路由、报表视图查询、amount_type 选择三类 case。

### A4：Lucy MCP Proxy 只读缓存实验

目的：在不改 KTX 上游的情况下，对明显只读且幂等的工具做可撤销缓存实验。

候选工具：

- `connection_list`
- `sl_read_source`
- `entity_details`
- `wiki_read`（可选）

设计约束：

- 默认关闭，通过环境变量开启，例如 `LUCY_MCP_CACHE_READONLY_TOOLS=1`。
- TTL 短而保守，初始建议 5-10 分钟；TTL 只能作为兜底上限，不能独立承担 schema /
  权限漂移防护。
- cache key 至少包含：
  - tool name
  - normalized JSON input
  - `permission_snapshot_hash`
  - 数据侧版本信号：优先使用 scan snapshot、semantic-layer reindex version、wiki
    `updatedAt` 等可获得版本；若某工具暂不可得，必须在 ADR 中登记风险，并通过事件
    失效 + 短 TTL 兜底，不得默默省略。
- 只缓存成功返回；denied、upstream error、parse error 不缓存。
- audit 必须记录 cache hit/miss，不隐藏真实用户访问行为。
- 表级 ACL 必须先于 cache 命中判断执行，避免跨权限泄漏。
- 失效必须挂在事件钩子上：semantic-layer reindex、`access.yaml` reload、wiki save、
  proxy restart 均应清理或切换对应缓存版本。
- 不缓存 `sql_execution` / `sl_query` / `discover_data`，除非后续有更强语义证明。

验收信号：

- 开关关闭时行为与当前 proxy 完全一致。
- 开关开启后，同一 token + 同一 input 的重复 `sl_read_source` 能命中缓存。
- audit 中能区分 forwarded 与 cache_hit。
- 未授权 token 无法通过缓存读取此前授权 token 的结果。

### A5：上游 KTX issue / PR 材料

目的：即使不能控制 KTX 上游，也要给出可执行的反馈材料。

建议动作：

1. 基于已修订报告整理 GitHub issue：
   - 复核后的关键数字。
   - 重复 `sl_read_source` / `connection_list` 样本。
   - 期望的 `sourceVersion` / `updatedAt` / `cacheable` 元数据。
   - MCP tool annotation 与结果缓存语义之间的差距。
2. 说明 lucy 侧计划先做短 TTL proxy cache 作为临时措施。
3. 若上游接受，可以后续把 proxy 实验降级或移除。

验收信号：

- issue 不包含生产凭据、数据库密码、token 或敏感数据样本。
- issue 明确区分“上游建议”和“lucy 临时缓解”。

## 4. 不建议做的事

- 不直接把报告转成正式 spec。
- 不把 KX 核心表字段清单手工写入 `CLAUDE.md`。
- 不把 proxy 专属工具写成 `CLAUDE.md` 运行时 agent 的必调用路径；`CLAUDE.md` 的工具
  使用规则只能要求调用目标 agent 实际可见的工具。
- 不在 lucy 侧复制 KTX 内部实现规则。
- 不默认开启 proxy 缓存。
- 不缓存 SQL 查询结果。
- 不把 TTL 当成 schema / 权限漂移的独立防护；缓存必须配事件失效或版本化 key。
- 不把一次集中测试的调用分布当作长期行为结论。

## 5. 建议推进顺序

1. A0 版本对齐核查。
2. A1 固化 usage 复盘脚本。
3. A2 提案式修改 `CLAUDE.md` 使用侧约定。
4. A3 增加 tool-budget eval。
5. A4 以 ADR 或小 spec 形式设计 proxy 只读缓存实验。
6. A5 给 KTX 上游提交 issue。

## 6. 是否进入开发阶段

当前建议进入“改善活动阶段”，不是直接进入大规模开发阶段。

可以立即做的工程前置：

- 版本对齐核查。
- 复盘脚本整理。
- eval budget 设计。

需要单独批准后再做的开发：

- 修改 `CLAUDE.md`。
- 修改 eval cases。
- 修改 Lucy MCP Proxy 缓存逻辑。

## 7. 待终审问题

请 Claude Code 终审重点确认：

1. 是否仍有把 KTX 上游职责误落到 project-lucy 的风险。
2. A4 proxy cache 的 cache key / ACL / audit 约束是否足够防止跨权限泄漏。
3. A2 运行时约定是否可能牺牲数据问答正确性。
4. 是否应把 A4 先写成 ADR，再进入代码实现。
5. 是否遗漏了现有 `webui/server/proxy` 或 eval 框架已支持的能力。

## 8. Claude Code 终审交付状态

已尝试调用 Claude Code Opus 做只读终审，但当前 Anthropic session limit 阻塞：

```text
You've hit your session limit · resets 1:20am (Asia/Shanghai)
```

待额度恢复后，可直接在仓库根目录重跑：

```bash
claude -p --model opus --permission-mode bypassPermissions \
  --add-dir /Users/forrest/Documents/my_vault/00_Inbox \
  --output-format text \
  "请以终审 reviewer 角色，只读审阅 /Users/forrest/Projects/project-lucy/inbox/ktx-mcp-usage-improvement-plan-2026-06-21.md。

请同时参考：
- /Users/forrest/Projects/project-lucy/docs/DEVELOPMENT.md
- /Users/forrest/Projects/project-lucy/docs/project-overview.md
- /Users/forrest/Projects/project-lucy/webui/docs/07-mcp-auth-proxy-spec.md
- /Users/forrest/Documents/my_vault/00_Inbox/ktx_mcp_usage_review_2026-06-21.md
- /Users/forrest/projects/ktx/ktx/packages/cli/src/context/mcp/context-tools.ts
- /Users/forrest/projects/ktx/ktx/packages/cli/src/context/sl/tools/sl-read-source.tool.ts
- /Users/forrest/projects/ktx/ktx/packages/cli/src/context/ingest/tools/warehouse-verification/entity-details.tool.ts
- /Users/forrest/projects/ktx/ktx/packages/cli/src/context/ingest/tools/warehouse-verification/sql-execution.tool.ts

只读审阅，不要修改文件。

输出格式：
1. 总体结论：通过 / 有条件通过 / 不通过。
2. Findings：按严重程度列出问题，每条包含文档位置、问题、建议修改。
3. 重点确认：职责边界、proxy cache 安全、ACL/audit、是否需要 ADR、是否遗漏现有能力。
4. 如果无阻塞问题，请给出可落盘的简短修订建议。"
```

Codex 临时自审结论：

- 职责边界基本清楚：本文仍落 `inbox/`，没有把 KTX 上游能力写成 lucy 正式 spec。
- A4 proxy cache 方向合理，但进入代码前必须先写 ADR 或小 spec，明确 cache key、
  ACL 先判定、audit cache_hit、权限 reload 失效策略。
- A2 修改 `CLAUDE.md` 属治理类变更，必须单独出计划并经确认后执行。
- 当前文档不应作为开发批准；它只批准 A0/A1/A3 的前置调研与设计活动。

---

## 9. Claude Code Opus 终审结果（2026-06-22 补跑完成）

### 9.1 执行状态

原定 `2026-06-22 02:00:00 Asia/Shanghai` 的 launchd 任务确实被触发：

- launchd 显示 `runs = 1`、`last exit code = 0`。
- `inbox/claude-final-review-2026-06-22-0200.log` 记录到：
  `starting Claude Code Opus final review`。
- 但 02:00 任务没有生成终审报告，也没有把结果追加回本文档。

因此在 `2026-06-22 08:31 CST` 左右手动补跑同一 Claude Code Opus 终审命令，
本次补跑成功完成，并将结论整理如下。

### 9.2 总体结论

Claude Code Opus 终审结论：**有条件通过（Conditional Pass）**。

作为“改善活动 / 前置调研”闸门，本文档定性正确、责任边界清楚，明确拒绝把
KTX 上游 schema 与内部规则落入 lucy 的反模式。**A0 / A1 / A3 / A5 的调研与设计
可以进入**。

但在批准 **A2 修改 `CLAUDE.md`** 和 **A4 proxy cache 写代码**之前，存在几个必须
先澄清或修订的问题：

- 重流量客户端可能直连 KTX `:7878`，不经过 Lucy MCP Proxy `:7879`，因此 proxy
  缓存可能截不到当前 1,965 次调用来源。
- `kx_catalog` 是 proxy 注入工具，不在 `CLAUDE.md` 目标 agent 的工具面里。
- A4 cache key / ACL / audit 约束需要比本文草案更严格。
- A2 中关于 `entity_details` 与 sample values 的表述需要修正。

### 9.3 Findings

#### F1【高 / 阻塞 A4 立项前提】重流量客户端可能直连 KTX `:7878`，proxy 缓存截不到

计划中的 A4 把缓存放在 Lucy MCP Proxy `:7879`。但现有 onboarding 与 `.mcp.json`
默认指向 KTX MCP `:7878`。如果报告中的 1,965 次调用主要来自直连 `:7878` 的
Claude Code 会话，那么 proxy 缓存即使在合成测试中命中，也不会降低真实观测到的
`sl_read_source` / `connection_list` 调用量。

建议修改：

- A0 增加逐客户端 endpoint 路由核查：记录 `.mcp.json` / Claude Code / 其他客户端
  到底指向 `:7878` 还是 `:7879`。
- A4 go/no-go 前置两条：
  1. A1 稳态基线确认重复调用不是一次集中测试造成的测量假象。
  2. 重流量客户端已切到 `:7879`，或明确 A4 只为未来 proxy 化客户端预留。

#### F2【高 / 影响 A2 可行性】`kx_catalog` 不在 `CLAUDE.md` 目标 agent 的工具面里

`kx_catalog` 是 Lucy MCP Proxy 注入并直接服务的工具，只在经 `:7879` 的路径上
可见。`CLAUDE.md` 注入给 KTX 内置运行时 agent；直连 `:7878` 的外部 Claude Code
客户端也只看到 KTX 原生工具。

因此，把“优先使用 `kx_catalog`”写进 `CLAUDE.md`，可能会让 agent 调用一个不存在的
工具。

建议修改：

- 如果 A2 面向 `CLAUDE.md` agent，规则只写其实际可见的 KTX 原生工具，例如
  `discover_data` / `sl_read_source` / `sl_query`。
- 如果 A2 面向经 proxy 的外部客户端，相关约定不应写入 `CLAUDE.md`，而应放在
  客户端 prompt 或 `kx_catalog` 返回内容中。

#### F3【高 / 安全语义】A4 必须 ACL-first；cache key 不能使用 “user id 或 permission snapshot hash”

跨权限泄漏的真实风险不是“同 input 下结果内容随用户变化”，而是“cache 命中绕过
ACL 判定”。因此本文已有的“表级 ACL 必须先于 cache 命中判断执行”是 A4 的核心
安全前提。

需要收紧的点：

- cache key 不应写 `user id 或 permission snapshot hash`，应强制复用
  `permission_snapshot_hash`。
- cache key 还应包含数据快照 / 索引版本，例如 scan snapshot、semantic layer
  reindex 版本、wiki 更新时间等可获得版本信号；若某工具暂不可得，必须在 ADR 中
  登记风险，并通过事件失效 + 短 TTL 兜底。
- TTL 只能作为兜底上限，不能独立承担 schema / 权限漂移防护；失效策略必须绑定
  reindex、`access.yaml` reload、wiki 保存等事件。

#### F4【中 / 正确性】A2 中 `entity_details` 与 sample values 表述需修正

Claude Code 复核指出：MCP 面的 `entity_details` 不返回 `sampleValues`。样例值更应由
`dictionary_search` 等 profile/value 工具覆盖。

同时，KX 的维表和视图多为 manifest 为主、overlay 较薄；仅调用 `sl_read_source`
未必覆盖物理列、类型、PK/FK 等信息。

建议修改：

- A2 改为：“同一轮内，且本轮无需物理列 / 类型 / PK / FK 时，才跳过
  `entity_details`。”
- 把“需要 sample values 时调用 `entity_details`”改为“需要样例值时考虑
  `dictionary_search`”。

#### F5【中 / audit schema】A4 应新增 `served_from` 维度，不要复用 `outcome`

现有 audit 的 `outcome` 语义是 `ok` / `error` / `denied`。缓存命中与否不应塞进
`outcome`，否则会污染现有统计口径。

建议在 A4 ADR 中增加独立字段，例如：

- `served_from = forwarded | cache`

命中缓存时仍必须写入 `permission_snapshot_hash`，保证“为什么放行”可复盘。

#### F6【中 / 事实修正】`maxRows` vs `rowLimit` 不是版本漂移，而是两个并存工具面

Claude Code 复核认为：

- MCP 面 `context-tools.ts` 使用 `maxRows`，默认 1000。
- ingest 面 `warehouse-verification/sql-execution.tool.ts` 使用 `rowLimit`，默认 100。

因此日志中的 `maxRows` 对应 MCP 面，不必把它解读为运行版本漂移。

建议修改：

- §2 中删除“版本漂移”措辞。
- A0 改为确认外部客户端实际命中哪个工具面，而不是围绕 `maxRows` / `rowLimit`
  做版本差异调查。

#### F7【中 / 落位】A4 应先作为 `webui/docs/07` 的增量 ADR，而非孤立 inbox 笔记

A4 触动 proxy spec 的 audit schema、ACL/cache 交互、失效钩子、cache key 组成等契约。
按仓库治理规则，进入代码前应先修订 `webui/docs/07-mcp-auth-proxy-spec.md` 或新增
挂靠该 spec 的 ADR，并在 `docs/project-overview.md` 注册索引。

#### F8【低】A3 之前先确认 eval harness 是否已采集逐 case 工具调用计数

如果现有 eval harness 已采集 per-case tool-call 计数，A3 只是补断言；否则 A3 包含
harness 改造，工作量和性质都会变化。

#### F9【低】`connection_list` 的最廉价解法可能是 A2 行为约束，不一定是缓存

当前项目实际只返回 1 个 connection。缓存安全但收益低；更省的做法可能是运行时约束：
单 connection 项目不反复调用 `connection_list`。

#### F10【低】`discover_data` 描述会提示后续工具调用的说法需要核对

当前 KTX MCP `context-tools.ts` 中 `discover_data` 的 tool description 不包含“后续调用
`sl_read_source` / `entity_details`”的提示。本文相关说法应标注为待 A0 核对或删除。

#### F11【低 / 正向确认】A4 候选工具与源码 `idempotentHint` 标注一致

`connection_list` / `sl_read_source` / `entity_details` / `wiki_read` 带
`idempotentHint: true`，而 `discover_data` / `sql_execution` / `sl_query` 没有。

这支持 A4 只缓存前者、不缓存 SQL 或语义查询结果的方向。后续 ADR 应显式引用
`idempotentHint` 作为可缓存候选工具判据。

### 9.4 共识与争议矩阵

| 项 | Claude Code 终审评价 | 闸门 |
|---|---|---|
| A0 版本对齐核查 | 方向对，但需改为确认客户端 endpoint / 工具面；删除“版本漂移”误判 | 【双方接受，可进入前置活动】 |
| A1 复盘脚本固化 | 低风险、必要，是 A4 go/no-go 的证据基础 | 【双方接受，可进入前置活动】 |
| A2 收紧 `CLAUDE.md` 使用侧约定 | 方向可取，但 `kx_catalog` 工具面错位、`entity_details` 例外需修正；修改 `CLAUDE.md` 必须单独计划 | 【有条件接受，先补前置条件】 |
| A3 tool-budget eval | 设计合理，但需先确认 harness 是否已有逐 case 工具计数 | 【双方接受，可进入设计】 |
| A4 proxy 只读缓存 | 工具选择方向正确，但必须先确认流量走 proxy、补 ADR、收紧 cache key / audit / 失效策略 | 【有条件接受，先补 ADR 与路由前提】 |
| A5 上游 issue 材料 | 正确区分上游建议与 lucy 临时缓解 | 【双方接受，可进入】 |
| 不建议做的事 | 完全认同：不转正式 spec、不手抄 schema、不把 proxy 专属工具写成 `CLAUDE.md` 必调用路径、不默认开启缓存、不把 TTL 当成独立防漂移机制、不缓存 SQL、不把集中测试当长期结论 | 【双方接受】 |

### 9.5 最终开发闸门

可以进入前置调研 / 设计：

- A0：版本与路由核查，按 F1 / F6 / F10 调整范围。
- A1：usage 复盘脚本固化。
- A3：tool-budget eval 设计，先核对 harness 能力。
- A5：KTX 上游 issue 材料整理。

必须留给 Forrest 仲裁或补前置后才能动：

- A2：修改 `CLAUDE.md`。必须先澄清目标 agent 工具面、移除或改写 `kx_catalog`
  规则、修正 `entity_details` / `dictionary_search` 例外，并单独走计划确认。
- A4：proxy cache 写代码。必须先确认真实流量是否走 `:7879`，再出 `webui/docs/07`
  增量 ADR，明确 ACL-first、cache key、失效钩子、audit `served_from`。

最终判定：

> 本文档可作为“改善活动阶段”的启动依据，但不构成 A2 / A4 的开发批准。

---

## 10. 分批执行状态（2026-06-22 15:15 CST）

### Batch 0：A0 版本与路由基线

状态：**已完成**。

交付：

- `inbox/ktx-mcp-route-baseline-2026-06-22.md`

结论：

- 当前 `project-lucy` 的 `.mcp.json` 指向 `http://localhost:7878/mcp`，即直连 KTX。
- Lucy proxy `:7879` 可能存在，但当前项目配置没有经过 proxy。
- 因此 A4 proxy cache 不能被假设会降低本项目当前观测到的 1,965 次 KTX MCP 调用。
- KTX CLI 为 `@kaelio/ktx 0.12.0`，本机 KTX clone commit 为
  `e550091a7631a119c6a2589ee282f7c79946deaf`。
- MCP 面 `sql_execution` 使用 `maxRows`，ingest 面使用 `rowLimit`；这不是版本漂移证据。

闸门影响：

- A1 可以继续。
- A4 代码开发仍未放行；进入 A4 前必须先明确是否把重流量客户端切到 proxy，或明确 A4
  只服务未来 proxy 化客户端。

### Batch 1：A1 usage 周报脚本

状态：**已完成首版**。

交付：

- `inbox/ktx_mcp_usage_weekly_report.py`
- `inbox/ktx-mcp-usage-weekly-report-2026-06-22.md`
- `inbox/ktx-mcp-usage-weekly-report-2026-06-22.json`

验证：

- `python3 -m py_compile inbox/ktx_mcp_usage_weekly_report.py` 通过。
- `python3 inbox/ktx_mcp_usage_weekly_report.py --days 7 ...` 已生成 Markdown / JSON。

本次周报关键输出：

- KTX `tool_use = 1,965`。
- KTX `tool_result = 1,965`，按 `tool_use_id` 严格配对，未混入非 KTX result。
- `sql_execution = 863`，占 43.9%。
- `sl_read_source = 616`，占 31.3%。
- `connection_list = 167`，distinct result payload 为 1。
- `SELECT without LIMIT and not aggregate = 421 / 849 = 49.6%`，聚合识别口径为
  `count/sum/avg/min/max/group_concat/json_arrayagg/json_objectagg/GROUP BY`。

闸门影响：

- A1 形成可重复观测基线。
- A2 / A3 / A4 后续调整都应使用该脚本或其后续版本复核前后差异。
- A2 修改 `CLAUDE.md` 仍需单独计划确认。
- A4 proxy cache 仍需先补 ADR / 路由前提 / ACL-first / 版本化 key / 事件失效设计。

### Batch 2：A3 eval / tool-budget 设计

状态：**设计已完成，可进入最小开发批次**。

交付：

- `docs/design-eval-tool-budget.md`
- `docs/project-overview.md` 已注册索引。

当前事实：

- `scripts/eval-runner.mjs` 已经能从 Claude Code `stream-json` 中解析 `tool_use`，并把
  `{ id, name, input }` 保存到 `parsed.toolCalls`。
- 现有 `tool_assertions` 支持 `required_tool` / `forbidden_tool` / input regex，但不支持
  次数预算或重复 `sourceName` 预算。
- WebUI `eval_run_case` 当前不保存 tool summary / budget failures。
- 现有 drift 分类中，包含 `tool` 的 failure 会被归为 `tool_error`；A3 预算失败必须用
  `budget:` 前缀并优先归为 `logic_regression`，避免误判为基础设施错误。

建议进入的开发小批次：

1. Runner 增加 `toolSummary` 纯函数和预算型 `tool_assertions`：
   `max_total_tool_calls`、`max_tool_calls`、`max_repeated_tool_input`、
   `max_tool_calls_by_input`。
2. Runner summary / Markdown 输出 `toolSummary` 与 `budget:` failure。
3. WebUI runner mapping 增加 `budget:` → `logic_regression` 分类；可选保存
   `tool_calls_raw` / `tool_summary_raw` / `budget_failures`。
4. 先给 KX Financial 少量 case 试点预算断言，再扩大到 raw SQL fallback case。

仍未放行：

- A2 修改 `CLAUDE.md`。
- A4 proxy cache 开发。
- 一次性给所有 eval case 批量添加预算断言。

### Batch 3：A3 eval / tool-budget 最小开发

状态：**已完成首批实现**。

交付：

- `scripts/eval-runner.mjs`
- `scripts/eval-runner.test.mjs`
- `webui/server/eval/db.ts`
- `webui/server/eval/runner.ts`
- `webui/server/__tests__/eval-runner-contract.test.ts`
- `evals/kx_financial/eval/kx_financial-eval-cases.yaml`

实现内容：

- Runner 新增 `summarizeToolCalls()`，每个 case 输出 `toolSummary`。
- `tool_assertions` 新增预算型断言：
  - `max_total_tool_calls`
  - `max_tool_calls`
  - `max_repeated_tool_input`
  - `max_tool_calls_by_input`
- 预算失败统一输出 `budget:` 前缀，并作为 `budgetFailures` 返回。
- WebUI eval DB 新增可空字段：
  - `tool_calls_raw`
  - `tool_summary_raw`
  - `budget_failures`
- WebUI runner mapping 保存 tool summary / budget failures。
- WebUI drift 分类中，`budget:` failure 优先归为 `logic_regression`，避免被误判为
  `tool_error`。
- KX Financial 首批试点预算断言已加入：
  - `kx-routing-001`
  - `kx-schema-001`
  - `kx-filter-001`

验证：

- `node scripts/eval-runner.test.mjs` 通过。
- `npm run lint:spec` 通过；仅保留既有 `access-role-policy` warning。
- `npm run smoke:p0:business-eval` 通过。
- `cd webui && npm test -- eval-runner-contract` 通过。

后续仍未放行：

- A2 修改 `CLAUDE.md`。
- A4 proxy cache 开发。
- 将预算断言一次性扩展到所有 KX / Superstore case。
