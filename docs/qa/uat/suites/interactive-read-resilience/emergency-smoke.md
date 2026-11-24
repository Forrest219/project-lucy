# emergency-smoke — 最新 Docker 镜像应急交付 UAT 场景测试方案

| 元数据 | 内容 |
|---|---|
| 文档名称 | 应急交付 UAT（emergency-smoke） |
| 文档类型 | Checklist／UAT runbook |
| 版本 | v1.1（补测增量：规模夹具、冷读、完整名册、目录取消、证据卫生） |
| 撰写日期 | 2026-11-24 |
| 撰写人 | Cursor Agent |
| 选择器 | **`emergency-smoke`**（应急缩窗；非正式功能合同分母） |
| 总账／合同引用 | 复用 [P1-75／IRR](suite.md) 冻结预算与夹具口径；复用 [P1-80 启用表三态](../enabled-tables-load-state/cases.md) 文案与防呆；**不**改写 INDEX 正式套件判定 |
| 配对客户清单 | 跑次证据目录内 `customer-checklist.md` → 回填为 `customer-checklist-filled.md` |
| 本机入口（demo 默认） | WebUI `http://127.0.0.1:55176`；MCP Proxy `http://127.0.0.1:57881` |

## 目标

对刚刚重建完成的最新 Docker 镜像执行只读／受控闭环验收，判定是否允许作为**应急版**交付客户，并产出用于回填客户验收清单的全部一手证据。

## Non-claim（强制，写进跑次首页）

本选择器 **`emergency-smoke` PASS** 时，**仅**可主张：在通过规模前置的本机 Docker 仿真上，Gate 0＋S1–S5 所列症状门禁已过。

**明确不可主张、不可回写：**

- ≠ [`UAT-READ-RES-07`](cases.md)／正式 G2（50 独立 Agent × 多窗多轮）PASS
- ≠ P1-75 SC-01–08 功能合同收口
- ≠ [`UAT-SUITE-INTERACTIVE-READ-RESILIENCE`](suite.md) 在 [INDEX](../../INDEX.md) 标 PASS
- ≠ P1-78 MCP 问询性能 release 门禁
- ≠ K8s／客户现场升级可上线
- ≠ 「已消除全部 503／永远不再出现忙碌」

S4 若使用单身份多路并发，证据与客户清单第 5 行必须注明「单身份并发，非正式 50 Agent 分母」。若委托人要求对外主张「50 身份同窗」，则必须升到正式 50 Token 夹具，否则本项标 **BLOCKED**，不得勾选客户清单第 5 行。

---

## 执行前提与防呆铁律

1. **严禁修改交付镜像内容**：全程使用干净重建镜像，不挂载任何代码热补丁、故障注入或诊断探针脚本（如需抓诊断，仅读取镜像自带的标准观测日志、响应头与页面可见状态）。
2. **禁止破坏数据**：启用表测试严禁点击「移出无效启用」、严禁执行 PUT enabled-tables、严禁修改真实业务 Manifest。Skill 撤权／单文件换代仅允许在**隔离仿真卷**上对合成夹具操作，测后按夹具还原说明恢复。
3. **Fail-Fast 阻断**：Gate 0 不通过立即终止；任何场景出现假阳性、越权、超过 30 秒长尾或不可恢复的页面中止／持续不可用，直接标 **FAIL** 并保留现场证据。
4. **规模硬前置**：开跑前必须 `npm run uat:scale-baseline` 退出码 0；任一维度不达标 → 整包 **BLOCKED**，禁止缩夹具凑绿，禁止把定向小夹具结果回填为「正式规模已过」。
5. **WebUI 面**：凡主张页面结果，必须真实前台 Chrome（建议 1920×1080）＋即时计时，与 API 耗时分列。仅 HTTP smoke 不得勾选客户清单第 1／2／3 项。
6. **凭据**：WebUI 管理员与 MCP Agent Token 仅从委托人交接或本机私有配置读入进程，**不得**写入仓库证据、清单或跑次 Markdown。
7. **失败旅程不得剔除（v1.1）**：任何 `match:false`、`isError:true` 或脚本报错的旅程／样本，必须在 JSON 中保留原始记录，并写 `excluded_reason`（仅允许"测试脚本度量名错误"且须修正后**重跑通过**）。禁止用「只统计通过项」的汇总字段（如 `journeysVerified`）直接决定 verdict；verdict 须由全部样本推出。
8. **证据卫生（v1.1）**：开跑前清空或新建证据目录；仅保留本轮产物。禁止混入历史截图或探测残留（如旧 `page-*.png`、404/401 探测）。截图文件名须含场景与时间且 `capturedAt` 落在本轮窗口内。
9. **计时字段有效性（v1.1）**：任何 `ms` 恒为 0、缺 `server_timing` 或缺客户端起止时间戳的轮次视为**无效样本**，该子项不得判 PASS。

---


## Gate 0：镜像成分与防呆核验（必须先过）

### 检查动作

1. 确认容器 healthy；核对 `/api/livez`、`/api/readyz`、`/api/health` 均返回 200。
2. 以 **镜像／进程回执为真源** 核验：`gitSha`、`gitDirty=false`、镜像 `sha256`（digest）、`bundledKtxVersion`。将完整 `/api/health` 与 `/api/readyz` 正文落入证据。
3. 执行 `npm run uat:scale-baseline`（只读 COUNT）；退出码必须为 0。记录实际 Agent／角色／Skill／表／Wiki／审计等计数。夹具目标与 [fixtures.md](fixtures.md)／[scale-baseline.md](../../scale-baseline.md) 对齐（历史正式档常见：500 Agent／200 角色／≥100 Skill 且 IRR 正式档常校准至 107 可解析 Skill／可见 Source 以本轮 `lucy_catalog` 实数为准，常见对照 1,403）。
4. 发起 1 次纯 MCP `initialize`（经反代），检查下发的指引文本：**不得**含未验收的业务上下文新规则（断言 `contextAdoption: false` 或等价：指引中无 P1-77 类默认业务上下文采用段落）。将指引文本校验结果写入 Gate 0 回执（可截断脱敏，保留判定字段）。
5. **可见范围规模（v1.1 新增，硬前置）**：`uat:scale-baseline` 只数库内计数，**不代表** MCP 身份可见范围。须用 **场景 3 的测试身份** 调 `lucy_catalog`，记录 `connections` 数与 `sources` 数；与本轮冻结的现场档（现场对照：约 1,403 Source、单份 Manifest 最大约 2.3 MB、合计约 6.4 MB）比对。若可见 Source < 冻结下限（默认 1,000），整个 S3／S4 标 **BLOCKED（scale_not_visible）**，不得以 3 源结果主张 4a／4b／5 行。
6. **宿主 git 考古仅作辅助备注**（例如对照候选是否包含已知修复批次）：**不**作为单独 Fail-Fast 条件。仅当 health 回执的 `gitSha` 与本轮约定候选不一致时 Fail-Fast。

### 通过标准

- 第 1–4 项全部一致；`gitDirty=false`；规模断言退出 0；首条 initialize 指引校验通过。
- 产出：`gate0-image-fingerprint.json`。

### 本轮参考指纹（开跑时重采，以当次回执覆盖）

| 字段 | 开跑前快照（须重采确认） |
|---|---|
| WebUI | `http://127.0.0.1:55176` |
| MCP Proxy | `http://127.0.0.1:57881` |
| health.gitSha | `2c7d1493992729f7b3399ddd47ec8e19ae17298f` |
| health.gitDirty | `false` |
| image digest（示例） | `sha256:92227f0e76b2ea58b16f928a887c9aad0d1ef83a9eb7139ab3e0ca277ff2adb8` |
| bundledKtxVersion | `0.16.0` |
| 证据目录 | `inbox/emergency-release-<短 gitSha>/`（本轮建议 `inbox/emergency-release-2c7d1493/`） |

---

## 场景 1：管理站四页冷读与热读回归

**对应客户清单第 1 行。** 合同语义＝可重试忙碌＋限时恢复，**不是**零 503。

### 环境档位

- 正式规模卷（通过 Gate 0 规模断言）。
- **正常档**：2 CPU／2 GiB。
- **紧张档**：1 CPU／2 GiB（仅抽样 overview／catalog）。

### 测试步骤（真实 Chrome 前台 + Network）

1. 容器重启就绪后，依次冷读 `/overview`、`/catalog`、`/admin/agents`、`/admin/roles`，每个页面重复 3 轮；校验页面主标题防串页。
2. 在 1 CPU／2 GiB 限核档对 `/overview` 与 `/catalog` 各做 2 次真实冷槽读取。

### 通过标准

- **2 CPU 档**：四页全部首响 200（或等价成功），概览系统状态与待处理事项正常渲染；无 `DISPLAY_READ_TIMEOUT`；无浏览器约 10 秒中止。
- **1 CPU 档**：允许偶发 `503 DISPLAY_SNAPSHOT_BUSY`（必须在约 4 秒返回且带 `Retry-After: 1`），自动重试必须恢复 200 并渲染完整内容；绝不允许拖到约 10 秒被前端中止。稳态 eventLoop 峰值记录落盘（供内部诊断；**不**写入客户勾选句）。
- ### v1.1 补测步骤（S1-B：冷读与现场接口）

3. **冷读**：每个档位在容器重启后、首次访问前记录 `cache`／`builds`；四页首轮须出现至少一次 `cache;desc=miss` 或 `builds>=1`，否则该轮标 `not_cold`，不得当冷读证据。
4. **完整名册（现场接口）**：在真实 Chrome 中触发现场同款完整名册请求 `GET /api/admin/agents?view=roster`（**不带** `projection=summary`），3 轮。记录：状态码、客户端耗时、`server-timing`、`Retry-After`、响应体字节数（`content-length` 或实际读取字节）。同轮再请求 `projection=summary` 作对照。
5. **无人保存 503 专项**：在**无任何保存操作、`builds=0`** 的条件下，1 CPU 档连续 10 次读完整名册；统计 `DISPLAY_SNAPSHOT_BUSY` 出现次数及 `busy` 原因（若响应或日志暴露）。
6. **忙碌路径必须被打到**：1 CPU 档若 S1-B 全程 0 次 503，须追加受控事件循环压力（仅用镜像外的并发请求，不改镜像）重试，直到观察到至少一次 `DISPLAY_SNAPSHOT_BUSY` 或确认压力已达上限；仍无则 `busy_path_unexercised=true`，**客户清单第 1 行只可写"未触发忙碌路径"，不得写"忙碌可恢复"**。

### v1.1 补充通过标准

- 完整名册：记录首响与字节数；**首响为 503 即 FAIL**（不适用 1 CPU 容忍条款，该条款仅限四页摘要读取）；字节数仅记录，**不设通过线**，但须在回执标注是否 ≥ 4 MB（对照现场约 4.9 MB）。
- 无人保存专项：出现 ≥1 次 503 → 该子项 **FAIL**，保留 `busy` 原因；0 次 → PASS。
- 产出追加：`s1b-cold-and-full-roster.json`。

产出：`s1-webui-pages.json` + 四页最终渲染截图。

---

## 场景 2：启用表范围三态诚实展示回归

**对应客户清单第 3 行。** 步骤与文案对齐 [enabled-tables-load-state/cases.md](../enabled-tables-load-state/cases.md)。

### 测试步骤（真实 Chrome；仅拦截前端 GET `/api/connections/:id/tables`）

1. **健康态**：直开 `/connections/enabled-tables`，确认已选表正常，无缺 Manifest 与无效启用。
2. **Pending**：挂起 tables 请求 → 「正在读取表清单…」；无缺 Manifest；「移出无效启用」不可见。
3. **Error**：返回 500／503 → 「表清单读取失败，请重试。」及重试入口；无假阳性、无移出按钮。
4. **Empty**：成功空表 → 允许真实缺 Manifest／无效启用提示（**严禁点击移出**）。
5. **恢复**：解除拦截并重试／硬刷新 → 恢复真实已选表清单。

### 通过标准

- 五子态全部 PASS；磁盘零变更（无 enabled-tables 写入）。
- 产出：`s2-enabled-tables-p180.json` + 各状态截图。

---

## 场景 3：纯 MCP 暖态握手、目录核对与真实查数

**对应客户清单第 4a／4b 行。** 暖态微基准要求**完整指引、零基础指引**。

### 环境档位

正式规模卷，2 CPU／2 GiB；正式 `lucy_admin`（或等价只绑定该角色的合成 Agent）身份；**无 WebUI 会话**。

### 测试步骤

1. 经反代顺序发起 200 次新会话 `initialize`。
2. 经反代与直连各发起 20 路同发新会话 `initialize`。
3. 执行 2 条完整 MCP 旅程（`initialize` → `tools/list` → `lucy_catalog` → `lucy_query`），覆盖两个独立数据库连接。

### 通过标准

- 顺序 200：200／200 返回**完整指引**；客户端 P50 ≤ 200 ms、P99 ≤ 2 s；无 >30 s；**本场景不允许基础指引计入成功**。
- 20 路并发（反代 & 直连）：20／20 完整指引；P50 ≤ 200 ms、P99 ≤ 2 s；无 >30 s。
- 业务准确性：独立 `lucy_catalog` 与本轮冻结的授权 Source 数一致（历史对照常见 1,403，以本轮 Gate 0／R0 冻结值为准）；两条连接查询结果精确匹配独立 SQL 基线（历史对照常见 1,000 与 3）。
### v1.1 补测步骤（S3-B：规模、冷态、独立目录、取消）

4. **规模前置复核**：每次 S3 前重新读取 `lucy_catalog.sources` 数，写入回执；低于 Gate 0 第 5 项下限则 BLOCKED。
5. **旅程判定修正**：两条旅程必须覆盖 **两个不同 `connectionId`**；若测试身份只授权一个连接，标 BLOCKED（`second_connection_unavailable`），不得用同连接另一张表替代。每条旅程度量名按 `lucy_read_source` 返回的真实语义键填写；脚本报错须修正重跑。
6. **冷态握手**：容器重启后首次 `initialize` ×1，再顺序 20 次；单独记录首次与分位。
7. **冷态独立 `lucy_catalog`**：重启后首次调用 ×1；再并发 5 路、10 路各 1 轮。记录每次客户端耗时与服务端 `local_handler` 耗时。
8. **客户端取消**：发起 `lucy_catalog`（规模档）后在 50 ms／500 ms／2 s 三个时点主动断开 TCP；断开后 10 秒内：(a) 发起 1 次合法 `lucy_query` 须成功，(b) 服务端并发容量／在途工作数回落（以标准诊断读数或同窗握手 P99 不劣化 2 倍为证），(c) 审计中该次调用应有明确终态记录（当前版本无 `client_aborted` 终态时，记 `audit_terminal_state=ok|absent` 原样落盘，**不得**因 absent 单独判 FAIL，但客户清单不得写"断开可观测"）。
9. **握手截止一致性**：S4 中凡完整指引耗时 > 1.0 s 的握手，必须同时记录其服务端 `instructions_build` 与是否触发降级；若客户端 P50 > 1 s 而降级计数为 0，须在回执写明原因（口径差异或截止未生效），**不得**直接判 PASS。

### v1.1 补充通过标准

- 规模档（Source ≥ 冻结下限）：顺序 200 的 P99、并发 20 的 P99、冷态首次与独立 `lucy_catalog`（含 5／10 路并发）**任一 > 30 s 即 FAIL**；其余分位线由委托人在开跑前冻结并写入夹具，缺省沿用本节 P50 ≤ 200 ms／P99 ≤ 2 s 仅适用于暖态握手，**不外推到独立目录**。
- 取消子项：(a)(b) 通过为 PASS；任一失败标 FAIL。
- 产出追加：`s3b-scale-cold-abort.json`。

- 产出：`s3-mcp-handshake.json`、`s3-stage-summary.json`。

---

## 场景 4：同窗混合压力与写中名册可用性（应急缩窗）

**对应客户清单第 2／5 行。** 本场景为 **`emergency-smoke` 缩窗**，≠ 正式 SC-07／G2。

### 测试步骤（同一 Lucy 进程，2 CPU／2 GiB，完整自然窗 ≥ 60 秒）

1. 同时并发：多路新 MCP 握手 + 多路真实 `lucy_query`（默认应急口径：单身份 50 路握手 + 50 路问数；若升到 50 独立 Agent 须在回执声明并满足 Token 分母）。
2. 并发窗口中：会话 A 对某 Agent 发起**纯备注**保存；独立治理会话 B 在真实 Chrome 前台连续读取 Agent 名册（`/admin/agents`）。
3. 同窗以 1 秒间隔轮询 `/api/livez` 与 `/api/readyz`。

### 通过标准

- 握手与问数全部合法成交；允许高负载瞬间按约 1 秒截止线降级为基础指引，但降级后仍须完成合法查询；严禁超时失败或 >30 s 长尾。**不得**用本场景降级成功去粉饰场景 3 暖态 P50 失败。
- 会话 B 在纯备注写入期间名册首响全成功（记录是否出现可重试忙碌及是否恢复）；会话 A 保存确认后，会话 B 首读立即可见新备注。
- 同窗 livez／readyz 全 200；事件循环峰值落盘（内部证据）。
### v1.1 补充（S4-B：写后首读与计时）

- 写后首读**必须以名册 HTTP 读取为准**：会话 A 保存确认后，会话 B 首读须在名册响应体内核到新备注；exec／数据库侧校验只能作辅证，**不得替代**。`rosterAfterWrite` 中任一 `noteVisible:false` 即 FAIL（若 summary 投影本就不含备注字段，须改读含备注的投影并写明投影名）。
- `rosterDuringWrite` 每条须有有效客户端耗时（见防呆第 9 项）；全为 0 视为无效样本。
- 写中名册读建议用真实 Chrome；脚本读取须在回执标注 `reader=script`，且客户清单第 2 行注明。
- 握手降级与耗时的对应关系按 S3-B 第 9 项记录。
- 产出：`s4-50way-overlap.json`（必须含身份口径字段：`identityMode=single|fifty_agents`；追加 `reader`、`rosterAfterWrite[*].projection`）。

---

## 场景 5：Skill 撤权、单文件换代与安全隔离

**对应客户清单第 6 行（仅 Skill／对象权限）。**

### 测试步骤

1. 建立 1 条已认证的旧 MCP 会话，确认可发现并读取目标 Skill 正文。
2. 收窄该 Skill 的对象权限（撤权）；分别用旧会话与新建会话再次尝试发现、读取；并各自执行 1 次合法 SQL 问数。
3. 对 1 份普通 Skill 依次做原子替换与删除，各发起 1 次新握手；用**页面／工具可见结果**断言（新描述可见／删除后不可见），**不**依赖诊断挂载的「新增解析计数」。若标准观测无法取得解析计数，记 `observationGap=true`，**不**因此单独 Fail（除非发现／读取语义失败）。

### 通过标准

- 撤权后新旧会话均无法发现或读取被撤回 Skill；两条会话均仍查得正确基线值（与场景 3 SQL 基线一致）。
- 原子替换后首读见新描述；删除后首读不再出现该条目。
- 产出：`s5-revocation-generation.json`。

---

## 证据包合同（缺一不可）

Agent 执行完毕后，必须将原始产物打包至统一目录（本轮：`inbox/emergency-release-2c7d1493/`，若 `gitSha` 变更则改目录名与之对齐）并输出汇总。**缺任一项不得勾选客户清单第二节结论，不得生成可对外发送的 filled 清单。**

| # | 文件 | 必含内容 |
|---:|---|---|
| 1 | `gate0-image-fingerprint.json` | `/api/health`、`/api/readyz` 完整回执；镜像 sha256；`gitSha`／`gitDirty`；`uat:scale-baseline` 退出码与计数摘要；首条 initialize 指引校验（含 contextAdoption／等价否定结论）。宿主 git log 仅可选备注。 |
| 2 | `s1-webui-pages.json` + 截图 | 2 CPU 与 1 CPU 档四页逐轮导航耗时、API HTTP 状态、server-timing、Retry-After、事件循环峰值；四页最终渲染截图（标题防串页）。 |
| 3 | `s2-enabled-tables-p180.json` + 截图 | 健康／pending／error／empty／恢复五态断言与对应截图。 |
| 4 | `s3-mcp-handshake.json` + `s3-stage-summary.json` | 顺序 200、反代／直连 20 路逐请求客户端耗时（P50／P99／Max）；完整指引计数（须＝发出数）；服务端 total／catalog_resolve／skills_load 分位；Source 数；两连接 SQL 核对。 |
| 5 | `s4-50way-overlap.json` | 同窗握手／查数成功率、P50／P99／Max、基础指引降级计数、`identityMode`、纯备注写中／写后名册观察、探针通过率、eventLoop 峰值。 |
| 6 | `s5-revocation-generation.json` | 撤权前后新旧会话 Skill 发现／读取／查数原始响应；替换／删除后的可见性断言；`observationGap`（若有）。 |
| 6a | `s1b-cold-and-full-roster.json`、`s3b-scale-cold-abort.json`（v1.1） | 冷读标记、完整名册状态码／耗时／字节数、无人保存 10 次统计、规模档目录与取消子项原始记录。 |
| 7 | `customer-checklist-filled.md` | 严格基于 1–6 自动回填的客户清单终版；每项实测值注明来源文件名；第 5 行含身份口径说明。 |

### 客户清单回填卫生（v1.1）

- 用户面文字禁止出现：`gitSha`、身份名（如 `demo_agent`）、内部 Skill 名、`eventLoop` 数值、原始 dict／JSON 片段。这些只留在证据 JSON。
- 子项被 BLOCKED、`not_cold`、`busy_path_unexercised`、`observationGap` 时，对应行的实测结果必须写明该限定，结论格保持未勾选或标"受限通过"，**不得**写成无限定的 PASS。
- 第 1 行须分别写：四页摘要读取结果／完整名册结果／忙碌路径是否被触发。
- 第 4a／4b 行须写明可见 Source 数与连接数；3 源规模不得使用"暖态握手已验收"的无限定措辞。

### 回填映射（文件二 → 文件一）

| 客户清单行 | 主要来源 |
|---|---|
| 1 四页／紧张档恢复 | `s1-webui-pages.json` |
| 2 写中名册 | `s4-50way-overlap.json` |
| 3 启用表五态 | `s2-enabled-tables-p180.json` |
| 4a 暖态握手 | `s3-mcp-handshake.json` |
| 4b 目录与查数 | `s3-mcp-handshake.json`、`s3-stage-summary.json` |
| 5 高负载抽样（应急档） | `s4-50way-overlap.json` |
| 6 Skill 撤权 | `s5-revocation-generation.json` |
| 发送门禁 | 上表 1–7 齐套 |

---

## 判定出口

| 结果 | 条件 | 对外动作 |
|---|---|---|
| **PASS（应急）** | Gate 0＋S1–S5 全过；证据 1–7 齐套；客户清单可回填且 Non-claim 未越界 | 可发送 `customer-checklist-filled.md` 作为应急仿真回执 |
| **FAIL** | 任一必做症状门禁失败、假阳性、越权、>30 s 长尾、不可恢复中止 | 不得发送；保留失败证据 |
| **BLOCKED** | 规模断言失败、入口不可达、缺凭据／缺浏览器、委托人要求 50 Agent 但夹具不足等环境前置 | 不得降级凑绿；不得勾选对应客户行 |

**v1.1 追加判定**：S1-B、S3-B、S4-B 任一 FAIL → 整体 FAIL；任一因规模或连接不足 BLOCKED → 整体 BLOCKED（不得降级为"仅 3 源 PASS"对外）。

跑次记录可另存 `docs/qa/uat/suites/interactive-read-resilience/runs/YYYY-MM-DD-<agent>-emergency-smoke.md`，但 **不得**仅凭本选择器把 INDEX 中 IRR 套件标为功能合同 PASS。
