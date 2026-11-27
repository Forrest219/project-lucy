# 已完成功能 UAT 收口计划（共享 Docker 分时复用）

| 元数据 | 内容 |
|---|---|
| 文档名称 | 已完成功能 UAT 收口计划（共享 Docker 分时复用） |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-27 |
| 撰写人 | Claude（kscc） |
| 委托人 | 待确认 |
| 基于材料 | lucy-v0.35 相对 main 的 28 个提交盘点；docs/qa/uat/INDEX.md 各套件现行判定；各套件 suite.md／cases.md／最新跑次的「关闭条件」；宿主 Docker 实测水位（2026-11-27） |
| 适用范围 | lucy-v0.35 分支上已完成开发、UAT 未收口的 6 个功能项，推进到 INDEX 判定收口；≠ 可上线主张 |
| 输出位置 | docs/plans/lucy-20261127-uat-closure-shared-docker-plan.md |

## 1. 目标与范围

**Goal**：对 lucy-v0.35 已完成开发的功能，把现有 spike 级 UAT 状态推进到套件收口（INDEX 判定为 PASS，或 GAP 按套件自身写明的关闭条件消除）。**只做测试推进，不改产品代码**；发现缺陷按 Debugger 流程报障，不在本计划内修复。

**收口对象与现状**（判定取自 INDEX.md 2026-11-26 状态）：

| 功能 | 套件 | 现判定 | 未收口项（套件写明的关闭条件） |
|---|---|---|---|
| P1-75 access 写窗口韧性（REQ-0117） | ACCESS-WRITE-WINDOW | **BLOCKED** | AWW-08 前台浏览器 E1–E18 中 E3/E4/E8b/E13/E17 断言未完成（两轮证据已存档 `runs/2026-11-26-claude-aww-browser/`） |
| P1-84 公共入口分类器＋branding 缓存＋SC-07 计数器 | PUBLIC-ENTRY-STATIC | **FAIL** | 单一未决项：事件循环臂完整 ≥3 min 无干扰窗（窗口 A/C 均被共宿主事件污染；隔离窗与 76 s 干净段已达标） |
| P1-90 Schema Manifest 按表追加 | SCHEMA-TABLE-APPEND | PASS WITH GAP | GAP-STA-02-DISCOVER：`discover_data` 被实例敏感元数据策略拒绝；关闭＝策略允许后复验，或委托人明示接受口径 |
| P1-91 overlay 发布护栏与生命周期 | OVERLAY-PUBLISH-GUARD | PASS WITH GAP | GAP-OPG-08-BATCH：batch 维护包 round-trip 未实跑（关闭＝真实 round-trip 跑次或委托人接受佐证口径）；GAP-OPG-02-ENGINE：demo MySQL 引擎不支持三段名（关闭＝引擎支持后补验，或委托人接受 Task 0 实证口径） |
| P1-89 语义层写接口诚实响应 | SOURCE-WRITE-HONESTY | **PASS** | 无（仅回归抽查） |
| P1-88 敏感元数据工具可见性 | MCP-CLIENT-COMPAT | **PASS** | 无（仅回归抽查） |
| listSources readdir 性能改造 | MCP-INQUIRY-PERF | **SEED_ONLY** | 冻结基线已固化；正式臂对基线相对门禁判定后 `LATEST.json` 具名接受（optimization-ab 已有一轮 `mip-mwx6wvyo` 预跑） |

不在范围：K8S-STOP-GRACE（NOT RUN，终稿未确权未授权）、MCP-DATA-PLANE-HA 残余 03（P1-82 另案）、全部 legacy tier 存量套件。

## 2. 共享 Docker 设计（对「很多测试可共用一个 Docker」的如实回应)

**结论：部分成立。** 按「测量噪声等级」分三层，共用发生在层内，不能跨层：

| 层 | 套件 | Docker 策略 | 理由 |
|---|---|---|---|
| L1 功能语义面 | STA、OPG、SWH、MCC | **一栈四套共用**：复用隔离栈 `lucy-uat-p19x`（compose 项目，重建为新镜像后继续用） | 已有先例：2026-11-26 `claude-p19x-isolated` 一栈同日跑三套件全绿；四者均为纯 API/MCP 语义断言，无计时主张，串行执行避免写路径互扰 |
| L2 规模夹具 | AWW | **专属栈** `lucy-req0117-uat`（已在跑，2003 启用表/530 Agent 夹具重建成本高） | 夹具规模即被测对象；不可与 L1 共享（L1 会改写角色/表状态，污染 AWW 的写窗基线） |
| L0 测量敏感 | PES 事件循环臂、MIP 正式臂 | **共享时段而非共享栈**：宿主独占时间窗内串行 | 两者失败根因都是共宿主干扰（PES 窗口 A 被并行 buildx＋磁盘写满毁掉）；与任何其他负载并行跑出的数字不可作判定依据 |

**编排总原则**：同一时刻宿主上只有一个在跑批次；浏览器计时臂（AWW-08、PES 浏览器窗）不与镜像构建重叠；每 Phase 开跑前登记 `gitSha`＋栈健康快照。

## 3. 执行计划（Phase 0–5，每步带验证方式）

### Phase 0 环境体检与磁盘治理（约 0.5 h）

宿主现状实测：Docker 镜像 123.6 GB（**90% 可回收**）＋构建缓存 102.9 GB（**102.8 GB 可回收**）——这正是打挂 P1-84 窗口 A/C 的「宿主磁盘写满」同款风险，必须先治理。

| 步骤 | 验证方式 |
|---|---|
| 0.1 `docker builder prune`＋悬空镜像清理（保留四个活跃栈的镜像） | `docker system df` 回收后 Build Cache <5 GB；宿主可用空间 ≥80 GB |
| 0.2 确认四栈状态：`lucy-req0117-uat`、`lucy-uat-p19x`、`lucy-uat-p18182`、`compose-lucy` healthy | `docker ps` 全 healthy；`node scripts/uat/access-write-window-stack.mjs status` 就绪 |
| 0.3 从 HEAD（`96954db7`）重建收口镜像 `project-lucy:uat-closure`（工作树当前含未提交的 lint/doc 文件，非产品代码，如实登记 dirty 状态） | 镜像构建成功；`gitSha=96954db7` 写入跑次元数据；构建不与任何计时臂重叠 |

### Phase 1 共享栈 L1 批次（`lucy-uat-p19x` 重建为 HEAD 镜像后，四套件串行，约 2–3 h）

| 步骤 | 内容 | 验证方式 |
|---|---|---|
| 1.1 | 栈重建：`lucy-uat-p19x` 换 `uat-closure` 镜像重新 up，R0 体检（health/gitSha/sources/MCP 可达） | `sta-verdict` R0 全 ok；gitSha=96954db7 |
| 1.2 | **GAP-STA-02-DISCOVER 关闭（Plan A）**：在隔离栈实例策略中对 STA 探针身份允许 `discover_data` → 复跑 `run-sta.mjs`（或 STA-02 discover 子检查） | `mcp-discover-visible` check 由 env-gap 变为实跑 ok；INDEX 判定升 PASS；若策略无法放开 → 走 Plan B（委托人明示接受口径，INDEX 记录裁定点） |
| 1.3 | **GAP-OPG-08-BATCH 关闭**：真实 batch 维护包 round-trip（导出→改→导入→发布），复用 `run-opg.mjs` 骨架补 OPG-08 子项 | round-trip 全程 200 且审计行落盘；GAP 消除，INDEX 判定升 PASS |
| 1.4 | **GAP-OPG-02-ENGINE**：demo MySQL 引擎仍不支持三段名则无法在本期关闭；整理 Task 0 实证口径提交委托人裁定（接受→GAP 关闭记录；不接受→保持挂账，不阻塞本 Phase 其他项） | INDEX 该 GAP 行记录裁定结果与日期 |
| 1.5 | SWH／MCC 回归抽查：各跑 2–3 条核心用例（SWH 三态诚实响应、MCC tools/list 投影＋拒绝码）确认 HEAD 未回归 | 抽查用例全 PASS；发现回归即停，报障不修 |

### Phase 2 PES 事件循环臂（L0 独占时段，约 1 h）

| 步骤 | 内容 | 验证方式 |
|---|---|---|
| 2.1 | 选宿主静默窗：其他栈保持运行但无任何测试/构建在途；关闭并行会话（P1-84 教训：并行 buildx 与磁盘写满直接毁窗） | 开跑前 `docker ps` 无异常负载；磁盘 ≥80 GB |
| 2.2 | 重跑 PES 组合窗（生产重工作臂＋MCP 臂＋浏览器＋探测），**完整 ≥3 min 无干扰窗** | 事件循环 p99 ≤400 ms、max ≤800 ms 在完整窗内成立；UAT-PES-R0 缺口消除，INDEX FAIL→PASS |
| 2.3 | 若仍越限：按既有归因框架做单臂隔离定位（H1/H2/H4 先例），产出归因记录，不改代码 | 归因记录落盘 runs/；判定如实登记 |

### Phase 3 AWW-08 前台浏览器补完（专属栈 `lucy-req0117-uat`，约 2–3 h）

| 步骤 | 内容 | 验证方式 |
|---|---|---|
| 3.1 | 栈镜像换 `uat-closure` 重建（含 73c1c6f6 展示重建缩面修复的提交态），夹具幂等重放（2003 表/530 Agent） | R0 就绪；冷读 roles/agents fresh 且毫秒级（对照 193 ms/867 ms 前值） |
| 3.2 | 补完 E3/E4/E8b/E13/E17 断言（写窗内读恢复、编辑保存重叠、版本冲突提示、agents 列表），并完整重放 E1–E18 一轮确保成套 | 截图＋计时 JSON 落 `runs/<date>-<agent>-aww-final/`；写窗内无无指引错误终态；INDEX BLOCKED→PASS |
| 3.3 | 浏览器计时臂不与任何构建/其他栈压测并行 | 跑次记录宿主同时段负载快照 |

### Phase 4 MIP 正式臂（L0 独占时段＋专属栈，约 3–4 h 含 seed 重建）

| 步骤 | 内容 | 验证方式 |
|---|---|---|
| 4.1 | `lucy-mip-uat` 栈幂等重建（seed 可重放）＋HEAD 镜像 | 规模断言默认档＋MCP-PERF profile 全 PASS |
| 4.2 | 正式臂对冻结基线（`baselines/1-lucy-mip-uat-capB-*.json`，29 场景）做相对门禁判定 | 全过线 → `LATEST.json` 具名接受，SEED_ONLY→PASS；C50 initialize 若仍超线 → 维持委托人选项 2 裁定（预算不放宽、挂优化目标），SEED_ONLY 保持并登记复跑轮次 |
| 4.3 | 负控（延迟注入/2× 检出）归入本正式跑次执行 | 负控检出成立 |

### Phase 5 台账与门禁收口（约 1 h）

| 步骤 | 内容 | 验证方式 |
|---|---|---|
| 5.1 | 各套件跑次 md 落盘（元数据表齐备）、INDEX 判定行更新 | 每份跑次含 gitSha/环境档位/逐用例证据；INDEX 与 runs 互相链接 |
| 5.2 | `suite-faces.json` 验收面核对：本批六套件 faces 覆盖核对（AWW 需 webui＋mcp 双面证据齐） | `node scripts/lint/uat-verdict-gate.mjs` 退出码 0（strict 无违规） |
| 5.3 | 在制文件落地决定：uat-verdict-gate 三处挂钩（CI/package/CONVENTIONS）当前未提交，随本批收口一并交委托人决定是否入库 | git status 干净或明确保留清单 |

## 4. 委托人裁定点（不裁则走默认）

| # | 事项 | 默认路径 |
|---|---|---|
| D1 | GAP-OPG-02-ENGINE：是否接受 Task 0 实证口径（KTX 三段名已证、demo 引擎待支持） | 不接受则保持挂账，不阻塞 |
| D2 | GAP-STA-02-DISCOVER：隔离栈策略无法放开时是否接受 read_source＋catalog 佐证口径 | 优先 Plan A（放开策略实跑） |
| D3 | MIP C50 initialize 维持选项 2（预算不放宽）是否延续 | 延续既有裁定 |
| D4 | Phase 0 磁盘治理可回收约 215 GB（镜像 112.5＋缓存 102.8），其中镜像回收需确认不含要留的基线 tag | 只回收悬空层与 build cache，不动活跃栈镜像 |

## 5. 风险与回退

- **磁盘写满毁窗**（P1-84 实录）：Phase 0 强制治理＋每 Phase 开跑前查余量；跑次探测器含磁盘采样。
- **共宿主干扰**：L0 时段独占为硬约束；任何并行会话请求（构建/压测）在 L0 窗口内一律延后。
- **栈重建后夹具漂移**：AWW/MIP 均有幂等 seed；重建后先跑 R0 再进用例。
- **回归发现**：任何抽查发现 HEAD 回归 → 该套件停跑、报障进入 Debugger 流程，不inline修。
- **全程纪律**：不伪造跑次、不改 Spec 合同与 cases 期望、判定如实登记 FAIL/GAP、每份跑次「≠ 功能合同收口；≠ 可上线」语义保持。

## 6. 总时间盒

Phase 0–5 合计约 9–12 小时净执行（不含等待与裁定点），建议两个工作日分四批：批一＝Phase 0＋1；批二＝Phase 2；批三＝Phase 3；批四＝Phase 4＋5。
