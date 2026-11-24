# Lucy 0.30 Spec／Plan · 第 1 轮评审记录（形式合规 ＋ 事实性核验）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 0.30 Spec／Plan · 第 1 轮评审记录 |
| 文档类型 | 评审记录（**不是** Spec，**不授权**实现） |
| 版本 / 日期 | v0.2 / 2026-11-07 |
| 状态 | 第 1 轮（形式合规 ＋ 事实性）**已完成 12／13 块**，已完成的分块全部逐条 triage 并回写；**c13 因 MiniMax Token Plan 账号级上限（HTTP 429）未能完成**，待配额恢复后补跑。**代码改动未授权**；第 2 轮对抗式评审待做 |
| 授权边界 | **只记录、不实现**。本文件不改动任何运行代码，不构成开工授权 |
| 评审范围 | `docs/specs/lucy-20261107-*.md` ＋ `docs/plans/lucy-20261107-*.md` 的**动态枚举**全部文档（评审时点共 35 份，含其他会话并发落盘者） |
| 评审门禁依据 | [`docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md`](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) §2.2 的 R1–R4；本文件是 **R1（形态验收）** ＋ R2 第 1 段（事实性核验）的记录 |
| 评审规模 | 13 块；主块 9 ＋ 补块 4；**评审标的 35 份 `0.30` 文档**（评审时点动态枚举，含其他会话并发落盘者）。累计 findings **115 条**，其中 **已修 110 条**、**5 条归他人未跟踪文件不代改**、**c13 未完成**——该块首跑与两次重跑均撞 **MiniMax Token Plan 账号级用量上限（HTTP 429）**；直连端点复核确认 **MiniMax-M3 与 MiniMax-M3.1-Flash 同账号同限**（均在 0.3s 内直接 429），本机 `minimax-claude-gateway.cjs` 只是改名透传、无备用后端。R2 第 1 段（事实性核验）因此**未覆盖 c13 的 4 份文档** |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」 |

## 1. 评审方式与证据纪律

- **评审者**：本机 Claude Code（无头驱动，MiniMax-M3 端点），**只读**执行——不修改任何被评文件、不跑测试、不做 git 写。
- **裁定者**：MiniMax Code（主会话）。每条关键发现**独立复核源码**后才接受；复核不成立的直接驳回并记明理由。
- **分块粒度**：单块 1–2 份文档（更大粒度会触发端点 Token Plan 用量上限），共 13 块（主块 9 ＋ 补块 4）。
- **不收**：风格洁癖、无 `file:line` 证据的断言、纯偏好类意见。
- **原始产出落点**：各块原始 findings 落本机 `inbox/2026-11-07-review-r1-c{n}-report.json`（临时件目录，`.gitignore` 忽略、**不入库**）；**结论与裁定以本文件为准**。

## 2. 分块结果总览

| 块 | 对象 | 报告条数 | 裁定 | 关键问题 |
|---|---|---|---|---|
| c1 | REQ-030-013＋016 行权限编译门禁 | 10 | 全部成立，已修 | ADR 定位漂移（§3.5/§5.5 → **§14.4**）；换码分支改为**不移动任何既有判定**；新增 SC-11 锁 `tables:["*"]` |
| c2 | REQ-030-017 explain 诊断形状 | 9 | 全部成立，已修 | ADR 定位 §2.1 → **§2.1.1（lines 78–82）**；harness E4 断言补 `denyReason`；SC-04 去掉 harness `noLeak` |
| c3 | REQ-030-012 暴露裁剪 | 9 | 全部成立，已修 | 字段级门禁**插入点错误**（会漏无行策略 Source 与通配权限 agent）；`NON_WAIVABLE_CHECKS` **无前缀族机制**；发布分类判定点指错 |
| c4 | REQ-030-001 分文件发布 | 11 | 全部成立，已修 | reindex 调用点漏枚举（3→9 处）；伪代码 `validation` 未定义；**PUT 默认 `dryRun=true` 导致编辑不落盘** |
| c5 | REQ-030-019 Eval 路径断言编排 | 8 | 全部成立，已修 | 预算型字段合同写成严格必填，与 runner **回落规则**相反；失败关闭会**打挂整域列表 GET**；导出 YAML 在 WebUI 无落点 |
| c6 | REQ-030-020 审计旅程→Eval 草稿 | 14 | 全部成立，已修 | 规则1 判据源建在**去值后的** `args_summary` 上（与 runner 不同源）；规则4 把非工具级 denied 也转成 `forbidden_tool`（假失败）；**D8 失败分支无任何 SC 覆盖** |
| c7 | REQ-030-021 批量工具反哺通道 | 15 | 全部成立，已修 | **红基线不可达**（yaml 用短名、runner 按全名严格匹配，该断言永不可能命中）；派生前提与跑批记录不符（工具名带 `mcp__ktx__` 前缀、filters 是 string 形态）；`summary.entries[]` 键名错 |
| c8 | REQ-030-015 语义层孤儿路径治理 | 10 | 全部成立，已修 | 归因 1 用 sourceName 比对 `enabled_tables`（实存 physicalTable），一般连接会**误判 stale**；exclude 分支只写关系图侧，反查侧未剔除，与 SC-04「两处同构」不可实现 |
| c9 | 遗留验收执行 Plan ＋ 空结果下一步指导 ＋ 0.30 清单池 | 15 | 10 条成立已修；**5 条属他人未跟踪文件，不代改** | 空结果 Spec 的 `originalUserFilters` **捕获点缺失**（照伪码实现会把行策略谓词写进模型可见载荷）；空结果 Spec 优先级 P1 与池/需求池的 P0 分叉；清单池有 2 项**转阻塞**的形态违规（文件名＋缺 4 类 Plan 小节） |
| c10 | REQ-030-022 答复可核对性 ＋ REQ-030-023 Catalog 业务语义 | 15 | 全部成立，已修 | 描述覆盖率「30/30」不可复现（实为 **18/18**，副本被重复计数）；`grain` 被写进 Manifest（**实际属 overlay**，写进 Manifest 会被 `OVERLAY_FIELD_IN_MANIFEST` 硬失败）；verifiability 伪码**只有成功路径**、无失败分支与 SC 映射 |
| c11 | REQ-030-024 表级歧义门闩 ＋ REQ-030-025 Eval 选表正确性 | 9 | 全部成立，已修 | Eval 断言 YAML 写 `pattern:` 而 runner 契约是 **`value`** → value 取到 `''` → `new RegExp('','i')` 匹配任意串，**required 恒真、forbidden 恒真**（SC-03／SC-04 假绿）；候选 `source` 要求「限定名」但白名单只出 `sourceName \|\| table`，与 ACL 四元组**形状不闭合** |
| c12 | REQ-030-026 体感仪表盘 ＋ REQ-030-027 口径固化 | 10 | 全部成立，已修 | 027 的 D7「请求的 source 必须等于绑定 source」**无解析规则**（入参根本没有 `source` 字段）；027 §5 规则 3 与 §6／SC-03 **内部矛盾**；体感 Spec 伪码**未展开 `unavailable` 分支** |
| c13 | 两份分支计划 ＋ 核心方向 ＋ 空结果 Plan | — | **阻塞：未完成**——连续 3 次撞 MiniMax Token Plan 账号级 429；端点直连复核确认按模型分额度不成立 | 待配额恢复后重跑 |

## 3. 已修条目明细

### 3.1 c1 · 行权限编译门禁（REQ-030-013＋016）

| ID | 发现 | 裁定 | 修订落点 |
|---|---|---|---|
| F-01 | 上位合同定位漂移 | 接受 | §3.5／§5.5 → **§14.4**（`docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md:123/255/570`） |
| F-02/03/04 | 换码分支会移动既有判定顺序 | 接受 | 改为**不移动任何既有判定**；只在「受行策略约束 ＋ unwrapped 工具 ＋ 工具未授予」分支换码，复用 `acl.ts:3163` 门控，`tables:["*"]` 行为不变；加「顺序不变式」 |
| F-05 | Plan 步骤越界 | 接受 | S4 改为只收紧 BY-19 |
| F-06 | 门禁表不全 | 接受 | 补 `lint:ia-boundary` |
| F-07 | 目录不可用未分态 | 接受 | 拆 `manifest_unavailable`／`catalog_capability_unknown` 两态 |
| F-08 | 浏览器面证据口径 | 接受 | 改为「ROW25-V17 只是合同定义，实跑证据未核实」 |
| F-09 | 子节编号越级 | 接受 | 4.x → 1/2/3 |
| — | 缺 `tables:["*"]` 锁定 | 新增 | 新增 **SC-11** |

### 3.2 c2 · explain 诊断形状合同（REQ-030-017）

| ID | 发现 | 裁定 | 修订落点 |
|---|---|---|---|
| F1 | 「envelope 不被实跑识别」与实跑矛盾 | 接受 | 改为「envelope 已被识别，失败只是 `summary` 断言」；「不被识别」是 BY-19 的形态 |
| F2a/c/d | ADR 定位写成 §2.1 | 接受 | 全部改为 **§2.1.1（lines 78–82）**（Spec 头部、D1、§7、Plan 前置第 2 项、Plan 完成定义，及 README／概览／需求池镜像） |
| F3 | E4 漏 ADR 括注 | 接受 | 补回「（explain 本地诊断仍可成功返回 E1–E3，但不得暗示「执行可取数」）」 |
| F4 | harness E4 断言缺 `denyReason` | 接受 | 补 `diag.executionPath?.denyReason === "row_policy_upstream_unproven"` |
| F5 | SC-04 的 harness `noLeak` 不成立 | 接受 | 去掉 `noLeak`（只扫 secrets／canaries），改为单元白名单扫描 ＋ harness `containsResultRows === false` |
| F6 | §3.1 伪代码与线上响应体口径混淆 | 接受 | 补「本分量 ＋ `mcp-proxy.ts:1612-1644` 叠加字段」口径注 |
| F7 | 文件分工清单不全 | 接受 | 补 `row-policy-cases.mjs` ＋ `row-policy-ac-p1.test.ts` ＋ `mcp-proxy-row-policy-by01-by18.test.ts`（Spec 风险表 ＋ Plan 前置第 6 项 ＋ Plan 风险表） |
| F9 | `rowGrantKind` 未登记术语 | 接受 | Terminology 补 `rowGrantKind`（`none`／`all`／`scoped`） |

### 3.3 c3 · 语义层 Source 级业务暴露裁剪（REQ-030-012）

| ID | 发现 | 裁定 | 修订落点 |
|---|---|---|---|
| F1 | **字段级门禁的插入点错误** | 接受（高） | 既有形状门禁嵌在「非通配表权限 → 有 scoped 行策略 → 仅 `lucy_query`」三层嵌套内（`acl.ts:3163`→`:3193`→`:3197-3200`），`lucy_explain_query` 根本不经过 → 门禁改为插在 `acl.ts:3121-3122` 的 `hasRawQueryArg` 之后、早于 `protectedSources` 分支，**对两工具无条件执行**；SC-04／SC-07 增「无 scoped 行策略的 Source」与「持通配表权限的 agent」两条用例 |
| F2 | **`NON_WAIVABLE_CHECKS` 无前缀族机制** | 接受（高） | 现行判定是 `Set.has`（`publish-gate.ts:130`）＋ `checkIds.includes`（`:98`）的**精确匹配**，塞字面量 `"exposure.*"` 对动态 id **一个都不匹配** → D12 改为「新增 `NON_WAIVABLE_PREFIXES` ＋ 改判定为精确命中**或**前缀命中」；SC-09 断言改用动态 id（`exposure.grain.<某列>`） |
| F3 | 发布上传分类指错 | 接受（高） | 真正决定上传的是 `semantic-assets.ts:1714-1718` 的 `kindForPendingPath` 与 `:637-726` 的 `classifyYaml`（台账 yaml 会落 `UNKNOWN_SHAPE` **硬失败**），不是 `semanticKind()`；D4／E13 改为**四处判定点**（`semanticKind`／`kindForLogicalPath`／`kindForPendingPath`／`classifyYaml`） |
| F4 | 列级发现面漏 4 个上游入口 | 接受（高） | `entity_details`／`sl_validate`（`acl.ts:86-93`）与 `dictionary_search`／`discover_data`（`:180`）**不在 Proxy 本地执行集内**，是直转上游的入口、返回体无任何列级过滤 → §1.3 列为未核实项；Plan 加**硬前置第 5 项**「发现面穷尽性确认」 |
| F5 | 「Catalog 与 Query 双面裁剪」口径 | 接受 | 池原文含 `lucy_catalog` 但其**不返回列**（`acl.ts:1986-1995`）→ 口径统一改为「**发现面（read_source）与查数面（query／explain）**双面裁剪」；Spec §1.1 加括注、需求池加取证更正、概览 §9 与 README 同步 |
| F6 | 授权边界自相矛盾 | 接受 | Plan 前置第 1 项改为「未授权前 **S0–S7 全部**不得开始（含 S0 的术语登记写操作）」 |
| F7 | 台账丢失静默全暴露（fail-open 不可检测） | 接受 | 风险表增行 ＋ RES-06：要求发布门禁记录「期望台账集合」，台账消失即发布失败 |
| F8 | 行号漂移 | 接受 | `3083-3109` → `:3084-3112`（写记录）／`:3113-3129`（抛错） |
| F9 | 伪代码参数顺序反了 | 接受 | `authorizeAndRewrite(toolName, args, identity, ...)` → **`authorizeAndRewrite(identity, toolName, args)`**（真实签名 `acl.ts:3029-3032`） |

### 3.4 c4 · 发布工作台分文件勾选发布（REQ-030-001）

| ID | 发现 | 裁定 | 修订落点 |
|---|---|---|---|
| F1 | reindex 调用点漏枚举 | 接受 | 「只有两种形态」改为「**已枚举 9 处**，形态三种（裸／`--force`／`--json`｜`--force --output json`），**九处均无范围／路径参数**」；Spec §1.4 与 Plan 前置第 4 项同步 |
| F2 | 伪代码 `validation` 未定义 | 接受（高） | 补 `validation = validate_selected_only(projectRoot, snapshot, selection)` |
| F3 | R15 节号错 | 接受 | 20261030 **§4.5.4** → **§4.2**（该句在 `:91`，属 `:83-93`；§4.5.4 是 `:171-179`） |
| F4 | 需求池期望方向行号漂移 | 接受 | `:104` → `:106-108` |
| F5 | 硬约束行号错位 | 接受 | `:106-110` → `:110-114` |
| F6 | 整批失败路径不闭合 | 接受 | 新增**共用** `fail_batch`（回退 ＋ 失败终态记录 ＋ 基线不推进）；2.8 消费快照、2.10 终态记录、2.12 基线 CAS 三处补 try/except 并统一走它 |
| F7 | 门禁漏 `lint:ia-boundary` | 接受 | Plan 门禁表补 `npm run lint:ia-boundary`（本条改 `/publish/workbench` 左栏 IA） |
| F8 | UX 台账镜像滞后 | 接受 | `docs/ui-ux-feedback/pages/publish-workbench.md:269/273/276` 改为「已开 Spec，待评审、未授权实现」；R21 增「开 Spec 时同步改写」 |
| F9 | FC-04 行号错位 | 接受 | `:44` → `:45`（`:44` 是 FC-03） |
| F10 | 引用区间未覆盖点击处理 | 接受 | `682-689` → `682-696` |
| F11 | 六处状态句非逐字一致 | 接受 | 需求池行补「v0.1-draft」；概览 §9 改「待评审；未授权实现」（分号） |

### 3.5 c5 · Eval 路径断言编排面（REQ-030-019）

| ID | 发现 | 裁定 | 修订落点 |
|---|---|---|---|
| F-01 | **预算型字段合同与 runner 回落规则相反** | 接受（高） | runner 有回落：`max_tool_calls` 的 `tool \|\| value`（`:779`）、`max_repeated_tool_input` 的 `max_per_value \|\| max`（`:797`）→ 合同改为「`tool` 或 `value` 至少其一」「`max_per_value` 或 `max` 至少其一」；SC-01 补两条回落断言 |
| F-02 | **失败关闭会打挂整域列表 GET** | 接受（高） | `markStaleCases`（`cases.ts:389` → `:260`）批量回写会经过 `updateCase` → 存量脏断言会让列表 GET 500 → 校验只作用于**用户提交写入**，内部回写跳过或降级 warn；新增 **SC-10** |
| F-03 | **PUT 默认 `dryRun=true` 导致编辑不落盘** | 接受（高） | `cases.ts:435` 是 `request.body.dryRun !== false` → 默认 true，只回 diff 不落盘（`:332`）→ 伪代码保存分支补 **`dryRun: false`**，并注明 dryRun／preview 双态 |
| F-04 | 「7 型」表述已过期 | 接受 | 改为「分支计划已更正为 8 型；**需求池条目正文仍写 7 型**」；Plan 前置第 4 项同步 |
| F-05 | 「导出 YAML」在 WebUI 无落点 | 接受 | 只有 YAML **预览**页签（`CaseEditor.tsx:700-708`），无导出按钮／路由 → 统一改称「YAML 预览（yaml 页签）」；SC-04 改为「保存后回读 YAML 与预览文本逐字一致」 |
| F-06 | 正则不可编译拖到跑批才炸 | 接受 | 路径型增「正则可编译」检查（try/catch）；新增 **SC-11** |
| F-07 | Plan S0 与授权边界矛盾 | 接受 | 前置第 1 项改为「未授权前 **S0–S6 全部**不得开始」（S0 含术语登记写操作） |
| F-08 | 行号少 1 行 | 接受 | `types.ts:2081-2085` → `2081-2086`；`:1949-1970` → `1949-1971` |
| — | 合同判定的「存在」语义未定义（主会话复核时发现，c5 未列） | 补充修订 | runner 的 `numericLimit` 用 `Number.isFinite`（`eval-runner.mjs:715-718`），故 **0 是合法阈值**（`max_per_value: 0` ＝ 不允许任何一次重复）→ 合同里「至少其一存在」必须用 **undefined／null 检查**，不能用真值判断，否则 `max_per_value: 0` 被误判缺失（假失败）。已在 §3.1 合同注记中写死 |

### 3.6 c6 · 审计旅程→Eval 用例草稿（REQ-030-020）

| ID | 发现 | 裁定 | 修订落点 |
|---|---|---|---|
| F1 | **规则 1 判据源与 runner 不同源** | 接受（高） | runner 取**原始入参** `inputValueAtPath(call.input, ...)`（`eval-runner.mjs:804-806`），而 `args_summary.filters` 经 `summarizeFilterItem`（`webui/server/proxy/audit-privacy.ts:148-178`）**已去值**（只剩 `{kind,length}`／`valueCount`）→ 同长度的不同 filter 值摘要完全相同，会**误判重复**；且摘要侧 `filters` 是对象、runner 侧是数组，`input_path` 语义错位。§3.2 规则 1 改为 `countByRawValue`（取原始入参），SC-02 增「同长度不同取值不被误判」反例断言 |
| F2 | **`denied` 一律转 `forbidden_tool`，断言语义错** | 接受（高） | `outcome == "denied"` 还覆盖「角色解析失败」（`webui/server/proxy/admission.ts:326`）与「信封校验失败」（`:341`），`error` 是系统/SQL 错误（`mcp-proxy.ts:2802`）→ 规则 4 改为**只在工具级拒绝时**产出 `forbidden_tool`（新增 `decision_reason` 判据），其余只进 `notes`；SC-03 同步细化 ＋ 反例断言 |
| F3 | **D8 失败分支无任何 SC 覆盖** | 接受（高） | 新增 **SC-10**：读不到素材（turn 不存在／无权）→ 错误返回 ＋ **草稿产出量为 0**；挂到 S1 出口 |
| F4 | 「7 型」表述已过期 | 接受 | 改为「**REQ-030-019 条目正文两处仍留 7 型**；分支计划与需求池变更记录行均已自纠」 |
| F5 | 原话预览可关闭时合成题干可能为空 | 接受 | §3.3 增 `preview` 为空分支 → 走通用模板题干 ＋ `notes` 标注「原话预览不可用」（`audit-privacy.ts:45-47`），**不产空题干、也不归入 D8**；新增 **SC-11** |
| F6 | `actor.hasAuditRead(turnId)` 是自造接口 | 接受 | 改为复用**既有 admin 鉴权**（整个端点 403），不新增按 turn 粒度的授权模型（现行 `webui/server/admin/audit.ts` 无按问询鉴权） |
| F7 | 门禁漏 `lint:ia-boundary` | 接受 | Plan §4.3 门禁表补该命令；完成定义「三个 lint 门禁」→「**四个**」 |
| F8 | `AGENTS.md:69-70` 行号漂移 | 接受 | → `AGENTS.md:71-72` |
| F9 | 草稿落 `inbox/` 但该目录被忽略且可随时删除 | 接受 | D5 增警示；Plan 前置第 7 项改为「草稿区落位确认 **＋ 复核证据落点**」，要求定死保留期与归档路径 |
| F10 | `runner.ts:322-323` 行号漂移 | 接受 | → `:321-322`（`:321` 是路径模板，`:322` 是 args 数组） |
| F11 | D2「不新增 WebUI 端点」与「新增服务端导出端点」措辞冲突 | 接受 | 改为「**不新增 WebUI 前端页面／组件**；新增一个服务端只读导出端点」 |
| F12 | `max_total_tool_calls: 20` 近乎恒真 | 接受 | 规则 3 增口径提醒：`QUESTION_BUDGET_MAX_CALLS = 20`（`question-experience.ts:9`）与被测 Agent 同预算（`:545`、`:613`）→ 单轮场景近乎恒真，定位为「冗余护栏」，**验收不得依赖它触发** |
| F13 | SC-06 只测「草稿在 `inbox/`」这一恒真形态 | 接受 | SC-06 增「并入 `evals/**` 但 `needs_review` 未确认」场景（`review_status` **挡不住 CLI runner**） |
| F14 | 「S2 与 S3 可并行」与依赖链自相矛盾 | 接受 | 依赖图补 `S0 → S1`；改为「实现可并行，但 **S3 需先冻结 S2 的 `derived.assertions` 接口**」 |
| — | SC 编号随新增条目同步 | — | SC-01–SC-09 → **SC-01–SC-11**（Spec 出口句、Plan 头部验收、步骤表、完成定义同步） |

### 3.7 c7 · 批量工具反哺通道（REQ-030-021）

| ID | 发现 | 裁定 | 修订落点 |
|---|---|---|---|
| C1 | **红基线不可达** | 接受（高） | yaml 断言写短名 `tool: lucy_query`（`agent-reliability-eval-cases.yaml:152`），runner 计数键是 `call.name` 的**严格相等**（`eval-runner.mjs:806`），跑批记录名**一律带 `mcp__ktx__` 前缀**（单测即用全名，`eval-runner.test.mjs:277`）→ 该断言**永不可能命中**，「至少一条命中」不成立。Plan 开工前置第 3 项改为「**零命中须先排除工具名不同形**，排除后仍零命中才算 U1 成立」；S0 增加工具名同形核对；工具名对齐归 REQ-030-019 合同变更，本条只识别并报出差异 |
| C2 | **派生前提与跑批记录不符** | 接受（高） | 跑批**直连原始 KTX MCP**（`eval-runner.mjs:20` → `:7878`），记录名是 `mcp__ktx__sl_query`，不是 Proxy 侧的 `lucy_query`（映射见 `09-lucy-r1-mcp-tool-contract.md:201`）→ 白名单改为 `{lucy_query, sl_query}`；`batchShapeOf` 增 **string filters 分支**（上游形态，Proxy 转发前把结构化 filters 规范化为 string），只认结构化对象则形状恒不可判定、候选恒 0 |
| C3 | 派生输入路径错 | 接受 | `summary.entries[]` → **`summary.cases[]`**（`eval-runner.mjs:1952` `cases: entries`；`:2097-2100` latest.json 落 `JSON.stringify(summary)`） |
| C4 | G1「所有不同 filter 集合都塌缩」过度泛化 | 接受 | `String()` 对数组按元素 join，**只有等长集合**才塌缩 → G1 限定为「等长的不同 filter 集合」；SC-04 前提同步限定 |
| C5 | `obs` 元素缺 `tool` 字段 | 接受 | `obs.append` 补 `tool: shortToolName(call.name)` |
| C6 | `question_ref` 口径与 SC-02 冲突 | 接受 | 全文「原始问句」→「**合成问句**」（G3 已说明回连得到的是合成问句）；SC-02 与闭口层级承诺同步 |
| C7 | 形状 key 缺元素数维度 | 接受 | `key` 加 `#n=<元素数>`；1 元素与 3 元素不再落同一 key |
| C8 | 规范化丢弃未知键 | 接受 | 未知键以 `~<键名>` 保留**键名 + 类型占位**（不保留值），避免不同业务语义归一成同一指纹 |
| C9 | G1／G2「本机实测」被写成既成事实 | 接受 | 标注「**推断，待首跑复核**」——实测产物在仓外（`.gitignore:81`），并注明验收以首跑产物为准 |
| C10 | 术语登记既是前置又排在 S0 内 | 接受 | 登记归开工前置第 2 项；S0 只做「已登记」核验 |
| C11 | README 写「S0–S6」但 Plan 只有 S0–S5 | 接受 | `docs/plans/README.md:21` → 「S0–S5」（其余三份 Plan 确为 S0–S6，已逐份核对步骤表） |
| C12 | 多轮条目 id 行号漂移 | 接受 | `:1818` → `:1813` |
| C13 | F6 引用区间不支撑 measures 数组形态 | 接受 | 改口径：`dimensions`／`order_by` 是对象数组、`filters` 双形态、**`measures` 是 source-qualified 字符串**（`:60`／`:61`／`:62` 分列） |
| C14 | SC-10 的 `TOOL_REGISTRY`／`SKILL_FILES` 是占位符 | 接受 | 换成真实路径：`webui/server/proxy/acl.ts`（工具全集 `DEFAULT_KNOWN_TOOLS`，`:161-168`）＋ `.cursor/skills/**` ＋ `webui/config/data-qa-instructions.md` |
| C15 | `path_key` 未经术语登记 | 接受 | 只举已登记的 `traceId`（`00-product-terminology-standard.md:646`） |

### 3.8 c8 · 语义层孤儿路径治理（REQ-030-015）

| ID | 发现 | 裁定 | 修订落点 |
|---|---|---|---|
| C8-1 | **归因 1 的身份口径错** | 接受（高） | `enabled_tables` 存的是**物理表名**（现行实现 `enabled?.has(normalizeRefLike(entry.physicalTable))`，`access-map.ts:2117`），`physicalTable`（`dataforai.superstore_orders`）≠ `sourceName`（`acl.ts:268-269`），只有 lucy-ops 碰巧相等 → 伪代码改为用**反查行自带的 `physicalTable`**（`row-policy-views.ts:661-666`）比对；取不到即落 `undecidable` |
| C8-2 | **exclude 分支与 SC-04「两处同构」不可实现** | 接受（高） | §3.3 增「反查侧同源剔除（同一 `orphanKeys`、同一剔除函数）」，`side.rows` 一并剔除；SC-04 增「反查侧行集合也已被剔除」断言 |
| C8-3 | U1「实跑产物不在仓内」口径失真 | 接受 | U1 拆为 **U1a**（孤儿键清单：**本机产物已有但被截断**，`inbox/e2e/final-rds-20261105/v025/RTV25-06.json` 的 `executorResults.B.detail`）与 **U1b**（两侧快照身份：`configVersion`／`policyVersion`／`capabilityDigest`，**确实未取得**——全文 1294 字节不含该三字段）；Plan 硬前置 2 增「已有证据不得当作缺失」 |
| C8-4 | M3（命名漂移）被判「能」但不可判定 | 接受 | M3 的「能」降为「**不可判定（除非补齐身份映射集）**」——`SourceMapEntry` 无别名集（`acl.ts:268-279`），缺映射事实时 M3 命中**必走 `undecidable`**；Plan 前置 2 的运行期事实由三份增为**四份**（增「身份映射集」） |
| C8-5 | README 步数分叉 | 接受 | `docs/plans/README.md:22` → 「S0–S6」（逐份核对步骤表：该 Plan 确为 S0–S6） |
| C8-6 | 池条目非目标残留「未开 Spec」 | 接受 | 改为「不在本条重建语义层对象；本条未授权实现」 |
| C8-7 | Plan 授权措辞允许 S0 先行 | 接受 | 前置 1 改为「**未授权前 S0–S6 全部不得开始**；取证与术语登记须由 PM 单独明示授权」 |
| C8-8 | F15 函数名与行号归属偏差 | 接受 | 改引 `connection-block.ts:286`（`ensureOpsEvidenceConnectionBlock`），并注明 `:254-268` 是**构造**用的 `buildOpsEvidenceConnectionBlock` |
| C8-9 | F2 把共用 helper 当成 RTV25-06 调用点 | 接受 | 改引 `:1169`（viewList）／`:1170`（access-map），并注明 `:275-278` 是 helper 定义处 |
| C8-10 | F12 引用了已作废的状态列 | 接受 | 改引 `:285`（RTV-06 **通过**行），并注明 `:260` 的「开放：两项 Spec 尚未验收」已于 2026-11-03 作废（同文件 `:239`） |

### 3.9 c9 · 遗留验收执行 Plan ＋ 空结果下一步指导 ＋ 0.30 清单池

**已修（本会话拥有的文件）**：

| ID | 发现 | 裁定 | 修订落点 |
|---|---|---|---|
| F4 | 空结果 Spec 优先级 **P1** 与池/需求池的 **P0** 分叉 | 接受 | Spec 头部改 **P0（清单 P0-5）**，与池 P0-5、需求池 REQ-030-018 同口径 |
| F5 | **伪码无「原始用户 filter」捕获点** | 接受（高） | `applyLucyQueryForcedFilters` 把策略谓词前插进 `record.filters`（`row-policy.ts:738`），改写在 `mcp-proxy.ts:4182-4183`，与 `:5998` 同在 `handlePost`（`:3346`）作用域 → 走到 `withLucyResultMeta`（`:2643`）时 `args.filters` **已是改写后值**。§6 装配伪码补「捕获点必须在改写之前」的前置说明与正确落点，否则实现者照抄即违 D6／SC-14（谓词进模型可见位） |
| F6 | 证据行指错分支 | 接受 | `:5990-6007` 是**会**走 `withLucyResultMeta` 的 `lucy_query` 分支 → 改指真正的分叉点 **`mcp-proxy.ts:4507-4508`**（走 `writeCertifiedRouteResponse`，`:3761-3998`） |
| F7 | 编号体系张冠李戴 | 接受 | `RTV-01–RTV-08` 是**父 Spec** 的体系（同文件 `:8`、`:14` 明写），本呈现 Spec 的编号是 **SC-01–SC-30** → 重开申请须指明**唯一归属**，不得两套并列 |
| F8 | 「四处镜像」计数与枚举不符 | 接受 | 改为「**五处镜像**（Spec 头／Plan 头／docs README／plans README／overview §9）**＋需求池条目状态**（共 6 处现值）」 |
| F10 | `visibleTools` 未标惰性求值 | 接受 | 类型定义处补「必须**惰性取值**：`allowedToolNames` 有成本，只在 **0 行分支**求值（SC-20）」，实现形态写作闭包 |
| F12 | 行号漂移 | 接受 | D6 的 `mcp-proxy.ts:4183-4184` → **`4182-4183`** |
| F13 | 关联分支计划括注不实 | 接受 | MCP next-step 分支计划**只覆盖 W1–W4**、不含遗留验收线 → 关联文档改为需求池 ＋ 功能清单池，并显式标注该边界 |
| F14 | 门禁漏 `lint:ia-boundary` | 接受 | 门禁表补第 4 条 |
| F15 | 「五条纯验收」与 REQ-030-014 需重开矛盾 | 接受 | 改为「**四条是纯验收类** ＋ **第五条是功能缺口**（REQ-030-014，须 PM 批准重开）」 |
| F3 | 清单池镜像分叉（v0.3 vs v0.4） | 接受 | `docs/plans/README.md:7` ＋ `project-overview.md:251` 改为 **v0.4** ＋ §2.2／§2.3 口径，现行＝严格评审进行中 |

**未修（他人未跟踪文件，按共享工作区纪律不代改）**：

| ID | 问题 | 处置 |
|---|---|---|
| F1 | **阻塞**：`docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md` 文件名违反落盘清单第 1 条（Plan 必须 `lucy-YYYYMMDD-<slug>-plan.md`） | 未跟踪时仅 WARN，**`git add` 即转阻塞**。须该文件主人改名（`…-feature-inventory-pool-plan.md`）并同步 `docs/plans/README.md:7`、`project-overview.md:251`、pool 内部自引与需求池链接 |
| F2 | **阻塞**：缺 4 类 Plan 小节（目标／开工前置／完成定义／风险） | 补四节，或移出 `docs/plans/` 并改索引与互链 |
| F11 | 头部缺「验收」元数据行（清单第 3 条） | 补行；`lint-spec-docs.mjs:318-321` 因正则误命中变更表第 18 行而假阴性 |
| F9 | §2.2 仍标「现行裁定…对抗式评审」，已被同日 v0.4 §2.3「暂缓对抗式评审」取代，两处并存易被读成现行路径 | §2.2 加「（已由 §2.3 取代，v0.4）」标记 |

### 3.10 c10 · 答复可核对性（REQ-030-022）＋ Catalog 业务语义（REQ-030-023）

| ID | 发现 | 裁定 | 修订落点 |
|---|---|---|---|
| R1C10-01 | **描述覆盖率「30/30」不可复现** | 接受（高） | 本仓实测：demo-mysql 3 ＋ lucy-ops 12 ＋ mysql-aliyun 3 ＝ **18 个 source／18 个表级 `descriptions.db` 非空**。30 的成因是 `config/semantic-layer/lucy-ops/_schema/main.yaml` 与 `semantic-layer/lucy-ops/_schema/main.yaml` **逐字相同**被重复计数 → E3 改为「**18/18**（demo/ops 口径）＋副本不计」 |
| R1C10-02 | **`grain` 落位错** | 接受（高） | grain 是 **overlay** 字段（实例 `semantic-layer/lucy-ops/ops_calls.yaml:7-8`；运行时 `overlay.grain ?? record.grain`，`semantic-layer.ts:389`）；写进 Manifest 会被 `catalog-assets.ts:492-499` 以 `OVERLAY_FIELD_IN_MANIFEST` **硬失败**。§5.1 拆成「① Manifest（descriptions）＋ ② Overlay（grain）」两段并注明 `human` 键；伪码改 `overlayIndex`；Plan §3 补 overlay 读取器 |
| R1C10-03 | **verifiability 伪码只有成功路径** | 接受（高） | 补四条分支 B1 成功／B2 权限不足（degradedGlobal・不可见 source）／B3 上游 isError／B4 非 `lucy_query` 工具，并逐条映射 SC |
| R1C10-04 | **D1「复用既有 provenance，不重造」与伪码自相矛盾** | 接受（高） | 既有 `provenance.filters` 走 `boundedProvenanceValue` **原值透传**（`mcp-proxy.ts:2706`），**不去值**；去值能力在 `audit-privacy.ts:171` 的 `summarizeFilters`（filter 级，**当前未导出**），已导出的 `summarizeArgsForAudit`（`:187`）是 args 级、口径不同 → D1 改为「**语义复用、字段与去值另定**」，伪码标注来源函数 |
| R1C10-05 | D2 落点未写键名与「同生同灭」不变式 | 接受（高） | D2 抄 018 的 D3 三落点（`content[0].text` 内键 ＋ `structuredContent` ＋ `_meta.lucy`）＋「任一路径失败则三处都不出现」；SC-06 拆成 **SC-06a**（不破坏 eval-runner 单块）＋**SC-06b**（三处一致） |
| R1C10-06 | 需求池 8 处「未开 Spec」残留 | 接受 | 019／020／021／022／023／024／025／026 八条逐条改为「**已开独立 Spec 与 Plan**（v0.1-draft，待评审；未授权实现）」；概览 §9 补 **REQ-030-022／023 两行** |
| R1C10-07 | `manifestIndex` 只按 `sourceName` 建键 | 接受 | 索引键改 **`connectionId.schema.sourceName`**（`permissions.sources` 的键含 connectionId/schema，`acl.ts:2010-2013`）——只按 sourceName 会让 demo-mysql 与 mysql-aliyun 的同名 source 互相覆盖 |
| R1C10-08 | E10 引用的是状态行 | 接受 | 改引 `concept-dictionary-spec.md:38`（不得成为元数据侧信道）＋`:149`（§7 侧信道防护），并注明 `:13` 是状态行 |
| R1C10-09 | README 两行缺「冻结落地」与门禁口径 | 接受 | `docs/README.md` ＋ `docs/plans/README.md` 的 catalog 两行补「**冻结落地**——须过 R1–R4 ＋ O1／O2／O3 闭合 ＋ 另授开发授权」 |
| R1C10-10 | SC-09–SC-11 并成一行、断言条件式 | 接受 | 拆三行并补**证据形态列**；SC-09–SC-11 明确「本条不做 ⇒ 记 **N/A**」；出口判定改为「SC-01–SC-08 与 SC-12 必须全部关闭；SC-09–SC-11 记 N/A」 |
| R1C10-11 | Plan 文件结构表用短名无路径 | 接受 | 补全 `webui/server/proxy/mcp-proxy.ts`、`webui/server/proxy/audit-privacy.ts`（并注明 `summarizeFilters` 未导出、args 级函数不能顶替）、`webui/config/data-qa-instructions.md` |
| R1C10-12 | E2 只引文件名不引行号 | 接受 | 补 `data-qa-instructions.md:34`（先答再补口径）、`:43`（provenance 简短可追溯） |
| R1C10-13 | O2 写「评审闭合」但无结论 | 接受 | 改为「**开工前必答**」，并列出须裁定的三问（探测范围／失败披露／是否走 `lucy_freshness`） |
| R1C10-14 | 描述键缺运行时第三键 `human` | 接受 | §5.1 与术语行注明 `AuthoredText{db?,ai?,human?}`（`model.ts:3-7`、`semantic-layer.ts:400`），**首期仍只取 db** |
| R1C10-15 | E7 引 `:1900-1901` 当四元组模板 | 接受 | 改引 `:1845-1847`（四元组模板），并注明 `:1900-1901` 只是 "Sources:" 标题与其展开 |

### 3.11 c11 · 表级歧义门闩（REQ-030-024）＋ Eval 选表正确性（REQ-030-025）

| ID | 发现 | 裁定 | 修订落点 |
|---|---|---|---|
| F1 | **Eval 断言 YAML 字段名错**（`pattern:` 非契约字段） | 接受（高） | runner 取 `a.value == null ? '' : String(a.value)`（`eval-runner.mjs:735`）、正则分支 `new RegExp(value,'i')`（`:752`）→ 写 `pattern:` 则 value 为 `''`，**`new RegExp('','i')` 匹配任意串**：required 恒真（假通过）、forbidden 恒真（假失败）→ SC-03／SC-04 **假绿**。§5.1 两处 `pattern:` 改 **`value:`** ＋ 补 `reason:`（019 的 `{type;value;reason}` 合同） |
| F2 | 样例带 `tool:` 误导 | 接受 | `*_input_regex` 分支**不读 `a.tool`**（target 是全部 tool 调用的 name＋input 拼接，`:657-661`、`:751-761`；`a.tool` 只在三个预算型里）→ YAML **删 `tool:`**，「是否按工具限定」列 **O 项** |
| F3 | 波次号错 | 接受 | 「实施序 W5／W6」→ **W5／W7**（misreport 计划 `:316` G6=W5、`:317` W6=G7、`:318` G8=W7） |
| F4 | **候选 `source` 形状不闭合** | 接受 | `denialAllowList.sources` 元素是 `source.sourceName \|\| source.table`（`question-experience.ts:1033-1037`），**不含 connectionId／schema**；ACL 侧 `EffectiveSource` 是**四元组**（`acl.ts:752-757`）→ §5.1 增「候选 `source` 的形状」段：**取白名单输出元素本身**，不自行拼 `connection.schema.source`；若要改形态属**白名单通道扩展**，须显式声明并另取授权 |
| F5 | 概览 §9 缺 024／025／026 行 | 接受 | §9 补三行（状态句与各 Spec 头同句） |
| F6 | E2 fallback 条件不精确 | 接受 | 改为「正常路径下仅…全空时返回，**异常路径（catch）同样返回 fallback**」（`mcp-proxy.ts:1907-1909`） |
| F7 | 术语分区指向不唯一 | 接受 | 写明具体分区名「§4.8（访问权限升级）」，并标注**标准内 §4.8 重号待消歧**（`:807`／`:824`） |
| F8 | 六处状态措辞不一 | 接受 | 统一为「**v0.1-draft，待严格评审／验收；冻结落地；未授权实现**」（Plan 头 ＋ `docs/README.md` ＋ `docs/plans/README.md`） |
| F9 | Plan 缺台账号行 | 接受 | 024／025 两份 Plan 头部补「台账号 \| 无（`0.30` 台账未建立；待 PM 指派后再登记）」 |

### 3.12 c12 · 存量用户体感仪表盘（REQ-030-026）＋ 口径固化（REQ-030-027）

| ID | 发现 | 裁定 | 修订落点 |
|---|---|---|---|
| F1 | **D7 的「请求的 source」无解析规则** | 接受（高） | `lucy_query`／`lucy_explain_query` 入参**没有 `source` 字段**（`mcp-proxy.ts:957-1018` 只有 `connectionId`／`measures`／`dimensions`／`filters`／`segments`／`order_by`／`orderBy`／`limit`）→ D7 补解析规则：从 `measures[]`／`dimensions[].field`／`filters[].field`／`segments[]` 的**源限定名前缀**取集合；集合须**恰好等于**绑定 source；**任一 measure 无前缀**（如 `{expr,name}`）→ 视为越界拒绝（不猜指向哪张表） |
| F2 | 概览 §9 缺 REQ-030-026 行 | 接受 | 已随 c11 的 F5 一并补入（三行） |
| F3 | 三套状态措辞并存 | 接受 | 026／027 的 Spec 头／Plan 头／两处 README 统一为「**v0.1-draft，待严格评审／验收；冻结落地；未授权实现**」 |
| F4 | Plan 声称「同句已回写」且镜像清单缺 §9 | 接受 | 改为「**五处现值**」（＋`project-overview.md` §9），并写明统一口径 |
| F5 | **027 §5 规则 3 与 §6／SC-03 内部矛盾** | 接受 | §5 规则 3 拆成两条路径：**按词／触发匹配命中但 source 不可见 → 视为未命中**（不侧信道）；**按显式 `bindingId` 命中但 source 不可见 → `invalid_or_invisible_binding`**（调用者主动指名，错误码不泄露 source 是否存在），并说明为何不构成侧信道 |
| F6 | **体感伪码未展开 `unavailable` 分支** | 接受 | §6 读路径补两态判定：`auditDbAvailable()` 失败 → `emit unavailable_metrics(reason="audit_db_unavailable")`（复用既有 `unavailableQuestionKpi`，`daily-question-kpi.ts:131`），**不得回落成 0／no_data**；空库 → `no_data`（SC-01a）。SC-01 拆为 **SC-01a／SC-01b** |
| F7 | `meanOrRatio(population)` 是双义占位名 | 接受 | 改为 `count(firstSuccess == true) / count(population)`（分母 0 → `no_data`，口径见 §5.2） |
| F8 | E6「`webui/src` 无反馈组件」过宽 | 接受 | 改为「**无用户反馈产品入口**」（`webui/src` 内 feedback 字样均指复制／文案反馈，`Onboarding.tsx:460,495`） |
| F9 | `is_slow_call` 口径来源未指明 | 接受 | 补「依 `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md:329`——`duration_ms>=5000` 或问询墙钟 `>=120000`；本条只读，**不自定阈值**」 |
| F10 | 术语落位用裸编号 §4.8 | 接受 | 写明「§4.8（MCP 调试台 / ACL 裁决可见性）」，并标注**重号待消歧**（`:807`／`:824`） |

## 4. 门禁状态

四门禁在 R1 全部修订完成后复跑，**全部 exit 0**：

| 门禁 | 结果 |
|---|---|
| `npm run lint:spec-docs` | **exit 0**（438 files scanned，872 baseline exemptions） |
| `npm run lint:spec` | **exit 0**（PASS） |
| `npm run lint:terminology` | **exit 0**（passed，1122 files scanned） |
| `npm run lint:ia-boundary` | **exit 0**（passed） |

`lint:spec-docs` 剩余 **16 条 WARN 全部属他人未跟踪的 3 份文档**（`docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md` 5 条、'
'`docs/plans/lucy-20261107-lucy-0-30-core-direction.md` 4 条、`docs/plans/2026-11-06-lucy-v0.25.0-formal-release-plan.md` 7 条），'
'**本轮产出的 35 份文档零 WARN**。WARN 在文件未被 `git add` 时不阻塞；**一旦 `git add` 即转阻塞项**——按共享工作区纪律**不代改**，
须由各自主人处理（见 §5 P5）。

## 5. R1 收尾动作：状态镜像统一 ＋ 版本升 v0.2-draft

R1 修订完成后做了一次**跨文档镜像统一**，把此前并存的 5 套状态措辞收敛为单一现值：

- **规范现值**＝`**v0.2-draft，待严格评审／验收；冻结落地；未授权实现**`（REQ-030-018 为 `**v0.4，待严格评审／验收；冻结落地；未授权实现**`，其版本号不随本轮变动）。
- **统一阶段子句**＝`已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审`（加「0.30 批次」前缀以免与 018 自身两轮「对抗式设计评审」撞义）。
- **同步落点（6 处）**＝Spec 头部、Plan 头部、`docs/README.md`、`docs/plans/README.md`、`docs/governance/project-overview.md` §9、0.30 需求池 REQ 条目；另补 **清单池／核心方向／两份分支计划**的「现行阶段」陈述（原文仍写「暂缓对抗式评审」，属过期事实）。
- **文档版本**＝0.30 全部 33 份功能 Spec／Plan 由 `v0.1-draft` 升 `v0.2-draft`（018 保持 `v0.4`）。
- **开放决策守卫**＝6 份含 O 点的 Spec（022／023／024／025／027／026）统一加一条守卫：**O 项闭合前不得实现对应分支，缺省 fail-closed；闭合须由委托人在开发授权前书面裁定；评审通过 ≠ O 项闭合**。

机器校验见 `inbox/check-mirror.py`（六处镜像逐份比对，现值 100% 一致）。

## 6. 未决与待委托人裁定

| 编号 | 待裁定 | 出处 |
|---|---|---|
| P1 | REQ-030-001 的 **R1–R21 共 21 条既有合同修订**是否批准（未批准即开工＝silently 绕过现行合同） | c4 · Spec §8 |
| P2 | REQ-030-014 归属的行权限视图 Spec（已收口）**是否批准重开** | 遗留验收执行 Plan |
| P3 | REQ-030-027 的 **O1／O2**（发布种类接线、触发匹配算法） | c12 |
| P4 | REQ-030-018 的 **D3 落点反转**（追加 content 块 → 单块内加键）待委托人确认 | c9 |
| P5 | 上述 3 份他人未跟踪文档的形态违规由谁处理 | §4 |

以上 5 项已于 2026-11-07 一并向委托人提交裁定；同时提交「第 2 轮评审员选 Claude Code（配额已耗尽）还是 Codex」的裁定请求。
