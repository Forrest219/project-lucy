# Cases — UAT-SUITE-BEGIN-ZERO-BINDING

v0.6，配对 Spec／Plan v0.8；执行授权已获得，逐例结果以 runs 为准。R0＋01–12 共 13 项全部必做。当前范围只有 N（不 begin）、隐藏面和既有安全／预算回归；不包含启用后 B／D、G1／G2／G5 或 C1／C2 begin 写入恢复。F 与 R 分开，不用 mock／源码序锁凑绿。

| ID | 主题 | SC 映射 |
|---|---|---|
| UAT-ZB-R0 | 候选、身份、数据 oracle、现有参与证据和控制入口 | 全部前置 |
| UAT-ZB-01 | N＋隐藏面：list／指导无 begin，合法 query 成交 | SC-01 |
| UAT-ZB-02 | 强制 call 的 begin_not_available 与副作用 0 | SC-02 |
| UAT-ZB-03 | M01：可信零生命周期 N＋隐藏面 | SC-02／03 |
| UAT-ZB-04 | M02：draft 与普通发布 N＋隐藏面 | SC-04 |
| UAT-ZB-05 | M03：重连／重复强制 call、预算与 continue 保持 | SC-05 |
| UAT-ZB-06 | M04：Token／Agent／工具权限、行隔离与 G3 | SC-05／06 |
| UAT-ZB-07 | M05：A0／T0 正式控制、旧快照与撤销后隐藏 | SC-07 |
| UAT-ZB-08 | M06：审计诚实与运维／管理任务补偿 | SC-08 |
| UAT-ZB-09 | M07：unknown 防绕过及其他工具最小回归 | SC-03／07／09 |
| UAT-ZB-10 | M08：N 性能与实际计数 | SC-10 |
| UAT-ZB-11 | M09：L0／L1／T0／U0 系统重启及恢复 | SC-03／11 |
| UAT-ZB-12 | M10：RC1 的 N＋隐藏面与幻觉 call 恢复 | SC-12 |

## 公共执行和判定

- 组合以 [fixtures 单一覆盖矩阵](fixtures.md#统一路径与覆盖矩阵) M01–M10 为准。N＝catalog／source→query；隐藏面＝list／initialize／角色指导无 begin。每例独立前置与清理。
- 合法身份在 inactive 下强制 call begin 必须返回 `isError=true`、`reason=begin_not_available` 和安全 trace；不得生成 ID、写 turn／预算／BindingSession、加载／提交注册表或回填归属。后续合法 query 必须成交。
- HTTP 200 不代表工具成功；强制 call 与 query 分别保存原响应和断言，事实值必须匹配独立数据库 oracle。预算 round／window／calls／busyMs／续查和强制快照按用例前后读回。
- 禁止管理员 Token 问数、补空注册表、补 reindex、删凭据或重启修绿；真实重启仅 11。07 的正式控制入口不是零绑定修复步骤。
- 产品可达却因隐藏失败、注册表门禁或人工补凭据才成交为 FAIL；缺真实环境／客户端／控制条件或 OQ-3 数值未冻结为对应 BLOCKED。不得关闭预算、隐藏 continue 或改 ACL 回避。
- active／unknown 不套 inactive 的 D2；既有授权拒绝与 G3 基线安全拒绝独立判定。预期 D2 不计入 N 的增量拒绝。

## UAT-ZB-R0 — 环境与前置

**前置**：隔离 Docker 候选／改前基线、真实 Lucy／KTX／数据库、普通 MCP Token、管理控制身份分离。

**步骤**：固定 SHA／dirty／image digest／资源／内容根／KTX 与配置指纹；数据库 SQL 核对四行；登记 A／B／C、D1–D4 的真实授予、工具拒绝及预算档；记录 identityKey／sessionId 脱敏关联、round／window／有效 turn 和强制历史。只读现有注册表凭据／bindings／BindingSession 作为参与证据，不创建新格式或第二份计数。核对 RC1 版本／摘要；登记 validate→publish 与 YAML→reindex 控制请求。先跑 N 基线。

**期望**：A＝4／100、B＝2／30；普通问数无 WebUI Cookie／宿主凭证；I0 可信零，无须先提交空注册表。版本核对不冒充 MCP 启动或 query 通过。

**证据／清理**：保存 oracle、实际 HTTP 契约、客户端获取／运行方式及前状态；不打印 Token。缺准确控制条件在开跑前标明对应 BLOCKED，不静默少跑组合。

## UAT-ZB-01 — 默认 N＋隐藏面

**前置**：I0、A／C，分别独立新会话。

**步骤**：initialize→tools/list→核对角色指导→catalog／source→标准 query。C 看不到 begin 但仍授 query。

**期望**：list／指导均无 `lucy_begin_question`；A／C 均返回 4／100；begin 调用数 0；无 need_begin、注册表就绪门禁或 WebUI 确认。

**证据／清理**：list 原文、指导片段、完整工具轨迹／行集；结束会话并清理夹具。

## UAT-ZB-02 — 强制 call 与副作用 0

**前置**：I0、A，身份有效且既有工具授予允许 begin；预算健康并预耗部分额度。

**步骤**：记录 turn／预算／有效归属／BindingSession／注册表前后快照；即使 list 无 begin 仍强制调用，再执行标准 query；另带缺 intentSummary／不存在 bindingId 各强制调用一次，均应走同一 D2 而非进入业务激活。

**期望**：每次均 `isError=true`、`reason=begin_not_available`；无新 ID／turn／轮次／有效指针／BindingSession／握手回填，注册表加载／提交计数 0；query＝4／100，仅正常消费既有预算。

**证据／清理**：三条拒绝与 query 分别留证，保存前后状态和实际调用计数；不补 reindex／重启。

## UAT-ZB-03 — 可信零生命周期 M01

**前置**：I0–I3 各自独立卷与可信历史。

**步骤**：对每个变体，在初始、首次普通发布后、再次健康 Manifest 发布后，各在原／新会话执行 N＋隐藏面和一次合法强制 call。发布严格走 validate→publish并保存终态。

**期望**：每格 list／指导无 begin，强制 call 为 D2 且无副作用，query 与 oracle 相同；不因空目录、旧摘要或 Manifest 变动新增绑定拒绝，无需补空注册表或 reindex。

**证据／清理**：逐组合目录／历史指纹、发布回执、现有参与证据和全部响应；卷销毁前保存必要附件。

## UAT-ZB-04 — draft／普通发布 M02

**前置**：I4 有效／无效但 status: draft 可解析的变体，可信 inactive，数据面健康。

**步骤**：draft 仅落作者内容；每变体执行 N＋隐藏面和强制 call。无绑定普通 Wiki／Manifest 发布前、进行中、终态后重复；另登记无效 draft 的真实发布拒绝。

**期望**：始终无绑定就绪等待且保持隐藏；强制 call 为 D2。既有 STOP／DRAIN 若使 N 暂拒则如实单列，终态后 N 成交。无效 draft 不改变可信零；status 不可读或 published 候选不得按本例放行。

**证据／清理**：实际发布时序与响应；合法作者流程删除 draft，恢复内容并核对健康。

## UAT-ZB-05 — 预算与 continue 保持 M03

**前置**：I0／A，预算开启并预耗部分额度；Role 可见 continue；固定实际阈值。

**步骤**：分别执行 N、MCP 断开重连、重复强制 call；记录 round／window／calls／busyMs／续查及有效 turn。核对 tools/list 中 continue 与预算耗尽指导不变。用受控小阈值触达既有预算终止，再按现有合同调用 continue 并继续合法 query。

**期望**：N／重连／D2 均不新开轮次／窗口、不清零计数或续查，query 正常记账；continue 未被联合隐藏，既有续查仍可达且次数不增加。不得用关闭预算或改写阈值后不复原来修绿。

**证据／清理**：逐步预算读回、list／指导、续查请求与事实响应；恢复独立预算夹具。

## UAT-ZB-06 — 权限、行隔离与 G3 M04

**前置**：A／B／C、D1–D4 独立身份控制；预算启用且阈值固定。

**步骤**：A／B 各跑 N＋隐藏面；C 强制 call 保持既有未授权拒绝，之后 N 成交。D1 过期、D2 吊销、D3 Agent disabled、D4 global deny 分别发 begin／query，核对既有拒绝和未执行；解除 D3／D4 后同合法 Token 成交，D1／D2 用新合法控制 Token 核对恢复。另注入真实预算存储整体不可用，分别执行 N query、强制 call 和后续 query。

**期望**：A＝4／100、B＝2／30；隐藏不授予额外能力，既有授权拒绝优先于 D2。G3 保留 N 基线的 question_budget_unavailable，不能伪装成非阻断成功；恢复后合法成交且旧预算未清零。

**证据／清理**：逐身份授予、前后预算／行集、拒绝未执行和恢复证据；解除控制并清理独立身份。

## UAT-ZB-07 — A0／T0 正式控制 M05

**前置**：I0／A0 独立卷、正式 YAML 作者路径及 `POST /api/semantic-assets/reindex`；现有参与证据可观察。

**步骤**：I0 先验 N＋隐藏；准备 published 绑定并通过真实 HTTP reindex 建立 A0，执行允许／偏离口径并建立旧 committed 旅程。将最后绑定降 draft（删除变体另验），经同一入口撤销；新会话验 N＋隐藏，旧会话分别允许／偏离查询。

**期望**：active 不套 D2，允许口径成交、偏离拒绝；撤销后新会话恢复 N＋隐藏，旧 committed 快照仍允许／拒偏离。inactive 强制 call 的注册表／BindingSession 副作用为 0；不只预造 A0 而跳过转换。

**证据／清理**：YAML 资产、真实请求／release／attempt、现有代次和会话快照；还原独立资产。普通有绑定发布修复不记为本条结果。

## UAT-ZB-08 — 审计与画像补偿 M06

**前置**：I0／A；现有只读日志／审计／版本入口可用。

**步骤**：保存 initialize／工具描述；执行五个独立 N 问题及一次 D2 后 query，读取调用、会话、问询归属和覆盖统计。使用同一脱敏证据包完成下列任务。

**记录与诚实期望**：六组合法 query 均事实成功；显式原文上报＝0，D2 不产生 turn／有效归属；query 的显式／推断／unassigned／缺失按实际规则复算，各桶与真实调用分母一致，不把拒绝调用伪称已上报。

**运维任务补偿**：只用只读 request／trace（若缺如实标缺）／身份／时间／版本定位 D2 与对应 query，说明影响范围并核对同 Token 的恢复事实和候选版本；不得凭预知脚本位置冒称诊断成功。

**管理任务补偿**：独立复算显式／推断／缺失及事实成功／失败，判断零绑定 N 是否恢复、有绑定负控是否仍在，不声称取得未上报原文。

**判定／清理**：两项实际任务均达成才算补偿证成；任一失败则本例 FAIL，保留画像下降并回治理裁决。不得恢复必调 begin 补指标。

## UAT-ZB-09 — unknown 与其他工具 M07

**前置**：I0、A0、U0、L1 各独立卷；可见／不可见身份；无凭据 published／状态不可读候选及无关 source map 故障可独立构造。

**步骤**：对无凭据 published／不可读候选及 U0／L1 发起 begin／query，确认分类不是 inactive，强制 call 走真实治理拒绝而非 D2。A0 验允许／偏离与不可见身份。I0 在 N 和 D2 后分别做 read_source／explain 最小允许及既有 ACL 拒绝向量；再比较无关 source map 故障下隐藏强制 call 与 N query 的结果。

**期望**：unknown 不被认证为零；A0 允许成交、偏离／不可见拒绝；D2 不污染其他工具，字段／行规则按工具实际能力保持。source map 作者编译故障经真实 compiler 证实，生效 ACL 仍健康时 inactive D2 保持无副作用；再激活故障快照，begin／query 均按既有授权优先级拒绝，不把该 ACL 拒绝计为 D2。解除故障并激活恢复后 N 成交；不冒称数据面编译故障已由本条修复。

**证据／清理**：保存真实允许事实／元数据／诊断、拒绝未执行与强制历史；细粒度字段／行变体由 F 覆盖。解除故障，U0／L1 经合法恢复后允许口径成交。

## UAT-ZB-10 — N 性能 M08

**前置**：fixtures 的资源指纹、A_ms／R 双容差、随机种子和预算规则在采样前冻结；功能正例先满足。

**步骤**：改前／候选仅对 N 随机交错成对运行，每组每轮 100 个独立问题、三轮，预热每组每轮 10 问不入统计；逐轮 nearest-rank p95，不跨轮合并。F 独立提供 N 的 begin 调用数与 D2 注册表加载／提交计数。

**期望**：每轮同时满足绝对／相对容差；N 的 begin 调用数 0，D2 注册表加载／提交数 0。失败／超时不删分母；预期 D2 不计入 N 的增量拒绝。未冻结容差或无实际 counter 不得 PASS。

**证据／清理**：逐样本工具序列、耗时、失败类别、三轮统计和基线配对；夹具错误保留完整失败轮，不测后删样本或改阈值。

## UAT-ZB-11 — 系统重启 M09

**前置**：I0–I4／L0／L1／T0／U0 独立卷；授权的真实停止／启动。L0／L1 判据按 Spec §3.1，不得手工把未知历史改空。

**步骤**：各保存指纹→真实停止／启动→先读恢复分类再调用。I0–I4／L0 验 N＋隐藏及 D2 无副作用；T0 旧会话允许／偏离分别查，新会话 N＋隐藏；L1／U0 保持真实拒绝，再经合法恢复并允许口径成交。

**期望**：可信零与 L0 可恢复且成交；L1 不 catch-all 清状态；T0 旧 committed 快照保留，新问询 inactive；恢复幂等、不丢预算／强制快照。本条没有 C1／C2 begin 写入恢复，因为 D2 在写状态前结束。重启不是 01–10 的补救动作。

**证据／清理**：启动身份、恢复前后卷／现有代次／预算及新旧会话响应，记录实际停止启动时间；恢复独立测试环境。

## UAT-ZB-12 — RC1 真实既有客户端 M10

**前置**：fixtures 固定且未经本修复修改的 Codex CLI 0.165.0（RC1）、摘要一致，实际模型／MCP 可用；无 WebUI 身份；环境可信 inactive。

**步骤**：真实 Agent 新会话固定问句走 N，保存 list／指导与完整工具轨迹；若 Agent 幻觉 call begin，记录 D2 后继续 query。另由协议消费者核对 D2 载荷，但不替代 RC1。

**期望**：最终答案＝4／100；默认不调 begin，list／指导无 begin；幻觉 call 后不死循环、不把 begin_not_available 当成功、不要求管理员操作并完成正确答案。不得修改客户端迎合结果，也不要求隐藏期 B／D 成功。

**判定／证据／清理**：缺 RC1／模型／MCP 条件为 BLOCKED；真实客户端无法完成答案为 FAIL。保存版本／摘要、非敏感配置指纹、提示、响应和最终答案；清理独立 Token／Role／数据／卷。
