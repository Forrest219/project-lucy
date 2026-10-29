# project-lucy 项目概览

| 元数据 | 内容 |
|---|---|
| 文档名称 | project-lucy 项目概览 |
| 文档类型 | Overview |
| 版本 | v1.51 |
| v1.51 更新 | 2026-10-29，L25-16 **外部执行器已因 Token Plan 上限中断退出，实现代码停摆在「未提交／未测试／未取证」状态**（事实更正 ＋ 进展更新；**上一条 v1.50 行为 01:28:34 时点快照，其「在飞」与行数已过时，以本行为准**）：`claude -p` 无头进程（PID 13252）**01:43:46 最后写盘、01:46 写入 `EXIT:1`**，日志末行 `API Error: Request rejected (429) · Token Plan 用量上限 (2067)`，此后至今无改动。**代码规模**（实测，排除既有 `call-monitor.ts`）：**生产 4368 行 ＋ 测试 583 行 ＝ 4951 行**。**只读静态检查**：`tsc --noEmit` 下 **`server/ops/` 零类型错误**，接线文件 `acl.ts`／`mcp-tools.ts`／`index.ts`／`enabled-tables.ts` 亦零错误 ⇒ **中断未留下语法断裂**；其余 75 个类型错误属其它并发会话，与 L25-16 无关。**接线与工具面已成形**：已注册 `lucy_ops_connection_tables`／`lucy_ops_source_import` 两个工具，`acl.ts:2367` 落控制面分类分支（**先于** `lucy_` 前缀分支，符合 Spec 冻结边界），`audit.ts:285` 落 `mcp_control_plane` 执行主体——**工具面恰为 W-A 的 S1–S4 范围，未越界**。**未取证**：VOPS-01–78 **仍全部未执行**，测试文件已写但**未运行**，静态检查**不构成验收**。**口径未变**：Spec v1.1／Plan v0.9、G1–G38、VOPS-01–78、W-A 已授权实现 S1–S4、D8 与 L25-15 S0 仍未签、第 8 轮独立复审未做。⚠️ 版本号为跨会话共享计数器，写前须实读顶部版本行取 current+1 |
| v1.50 更新 | 2026-10-29，L25-16 **W-A 实现代码已在工作树出现（外部执行器在飞，未提交／未测试／未取证）**（事实登记）：外部执行器（`claude -p` 无头进程，PID 13252，cwd = 本仓库，01:00 起）在 `webui/server/ops/` 产出 **14 个新生产 TS 文件 4328 行 ＋ 3 个测试文件 583 行，合计 4911 行**，**未提交／未测试／未取证**。只读一致性抽查 5 条冻结约束全部一致：持久态五态、`aggregateOperationState` 唯一实现、`deleteManifest`／`deleteOverlays` 拒绝、锁顺序，**T-01 幂等表落 `audit.sqlite` 已落地**（`ops-idempotency.ts` 走 `getAuditDb()`）。文档维护会话**不代提交**该批在飞代码。**口径未变**：Spec v1.1／Plan v0.9、G1–G38、VOPS-01–78 全部未执行、W-A 已授权实现 S1–S4、D8 与 L25-15 S0 仍未签；**代码存在 ≠ 实现完成 ≠ 已验收**。⚠️ 版本号为跨会话共享计数器，写前须实读顶部版本行取 current+1 |
| v1.49 更新 | 2026-10-29，L25-16 **定向复审（v1.1 窄范围复核）＋ 实现级缺口 T-01 修复**：PM 决定不开第 8 轮，故做**窄范围定向复审**（**非全量对抗式审阅，不得当作独立复审的等价物**）：查出 **T-01（中高）幂等表的物理落点未冻结**——G34 定案要求「幂等存储与审计表同库同事务」，但 Spec §4.4 只写「独立存储（非配置审计表）」、Plan 的 `ops-idempotency.ts` 未指定物理库，实现者按字面另建独立库即跨库、跨库无事务，G34 落地条款随之落空（文档内部自相矛盾）。**已修**：幂等表物理落点冻结在 `audit.sqlite` 内（与 `config_change_log` 同库不同表），Spec §4.4、Plan §3.2／§4 三处同步，并澄清「独立存储」指逻辑独立而非物理独立。另恢复本行被简化的登记归属指引（**五处登记**：建议书 §2.10、本表 §9 行、`docs/README.md` 的 L25-16 Spec 行与 reviews 表行、`docs/plans/README.md` 的 L25-16 Plan 行）。**未变更口径**：Spec v1.1／Plan v0.9、G1–G38、VOPS-01–78、W-A 已授权实现 S1–S4（不含 S5／只读巡检／提交／推送／部署／客户交付）；**D8 与 L25-15 S0 仍未签**；**VOPS 全部未执行，不产生验收证据**。定向复审报告 `docs/reviews/2026-10-29-l25-16-v1.1-targeted-review.md` 已登记于 `docs/README.md` 的 reviews 表。⚠️ 版本号为跨会话共享计数器，写前须实读顶部版本行取 current+1 |
| v1.48 更新 | 2026-10-29，L25-09 **向前声明：v1.43 行原先引用的那个登录次数已作废，不得再被当作现值引用**（登记册内审计链声明，据台账 owner 建议补记）：① 本表 v1.43 更新行原文引用过一个登录次数——该数是「套件总登录数」被当成「某条腿的登录数」（差 15 倍），是这次误判的根因；台账与实施记录已由 owner 在 `c0498317` 全删，**该数在全仓任何位置均已不存在（`grep` 命中 0）**。② **本表 v1.43 行已于 v1.47 就地移除该引文**；★ 旧变更行按惯例不回改，**此处属例外**，故在本表内**显式声明这次原地修订**，原引文在 git 历史中完整保留。③ **今后任何人不得再把该数当作现值引用。** ④ **现值口径**：**安全腿** 69–70 次打满 source-wide 桶，**管理腿只需 9–11 次**；触发条件是**两条腿启动间隔 < 5 分钟**。**事实口径不变** |
| v1.47 更新 | 2026-10-29，L25-09 **补登 D-34 的三个落地提交 ＋ 删除全仓最后一个误导数字**：① §9 的 L25-09 行实施提交清单补 `6db3a522`（台账 D-34 置 `fixed`）与 `c0498317`（D-34 口径收口）。② **本表 v1.43 更新行内引用的那个误导性登录次数已删除**——该数是「套件总登录数」被当成「某条腿的登录数」，是这次误判的根因；台账与实施记录已由 owner 删净。旧变更行按惯例不回改，但**留在行里的错误数字是最后一个还会被人二次引用的载体**。**事实口径不变**：D-34 已 `fixed`、A01–A12 未执行且不排期、U9 Stage 1 不满足（0/12）、本条不可交付 UAT |
| v1.46 更新 | 2026-10-29，L25-09 **D-34 由 open 转 `fixed`** ＋ **A01–A12「未执行且不排期」的 PM 决定**（事实对齐，据台账 owner 实测与 PM 决定写一次准）：① **D-34 已置 `fixed`**（`fixedIn` = `ea3c52bc`，harness 侧修复，**产品阈值／限流窗口／键一律未动**）。**根因**：打满 source-wide 桶的是**安全腿**（69–70 次），**管理腿只需 9–11 次**；触发条件是**两条腿启动间隔 < 5 分钟**（本表 v1.43 行记的「管理腿自身登录量」口径由本条取代）。**修法**：洪水改走**独立 source**（IPv6 回环 `[::1]`）＋ 按 `Retry-After` **退避重试**；取证 `inbox/e2e/l2510-d34fix`（两腿紧邻启动、间隔 < 1 分钟）⇒ 洪水 48 次全落 `::1`、主体仅 1 次 429，**全量管理腿 16 passed / 9 failed / 26 blocked，与干净基线 `l2509-stage1` 逐字相同**（修复前同场景 1 passed）。⚠️ 仍为本地开发机运行 ⇒ **只证明修复有效、不构成发布级证据**，G-01 保持 open、`blocked_delivery` 不解除。② **A01–A12：PM（2026-10-29）决定本轮不写 spec，记「未执行且不排期」**（主 Spec §18.14）——**仍是刚性 P0**，只是不投入；**U9 Stage 1 本轮不满足（0/12）⇒ 本条不可交付 UAT** |
| v1.45 更新 | 2026-10-29，L25-16 **W-A 实现授权**：PM 授权 Claude Code 落地 S1–S4。S5 与语义发布不在授权内。VOPS-01–78 仍未执行 |
| v1.44 更新 | 2026-10-29，L25-16 **PM 直签，W-A 设计可交付开发**：Spec **v1.1**／Plan **v0.9**。D7 已确认，G34 定为同库同事务加文件写窗口的最小恢复协议，可交付开发范围是连接表与源表导入。W-B 仍不可交付开发。第 8 轮 Codex 复审未做。不授权编码，VOPS-01–78 仍未执行 |
| v1.43 更新 | 2026-10-29，L25-09 **D-34 限流归因更正**（事实对齐，修正本表 v1.40 更新行与 §9 L25-09 行的错误归因）：**「把安全腿的限流洪水登录量记成管理腿的」与「单窗口全量 real-e2e 必撞登录限流」两句均不成立**——`AUTH_RATE_LIMITS.sourceTotal` 冻结 30 次／5 分钟，但**管理腿本身只需 9–11 次登录**；**真正触发条件是「安全腿与管理腿在同一 5 分钟窗口内相继启动」**。对照（`progress.log` 分腿时间线 ＋ `results/management-full-unscoped.json`）：`l2509-stage1` 管理腿隔 **20 分钟**启动 ⇒ 零 429、全量管理腿 **16 passed / 9 failed / 26 blocked**；`l2509-stage1b` 管理腿隔 **1 分钟**启动 ⇒ **9 次 429**、全量管理腿 **1 passed / 17 failed / 33 blocked**。**只更正事实归因，不改 D-34 的 open 状态**；**修法口径待 PM 拍板后由台账 owner 一次写准**，本表不预写 |
| v1.42 更新 | 2026-10-29，L25-16 **第三处事实性更正（G34 定案框架）** + 登记归属扩容 + PM 决策纸登记：**G34 的「二选一」框架已按源码事实修正为「两层叠加」**——`writeKtxYaml`（`webui/server/project.ts:440-460`）是**文件系统写**（互斥靠 `withKtxYamlWriteLock` 进程内队列），**无法纳入 SQLite 事务**，故「同库同事务」只覆盖**幂等存储 ↔ 审计行**，覆盖不了「文件已改、幂等/审计未提交」窗口 ⇒ 正确表述为 **(a) 同库同事务 ＋ 最小恢复协议**（保留「认领与绑定原子」这一有限承诺）**或 (b) 仅完整恢复协议并删除原子声明**；已同步 Spec §7 缺口表 G34、Spec §8 第⑤条、Plan S0 第 11 步、Plan 交付判定段，**并更正 PM 决策纸中把「业务文件写」误述为可纳入事务的那处技术错误**（决策纸「决策一」的选项表与建议段）。另：L25-16 的登记维护归属由**四处扩为五处**（补 `docs/README.md` 的 reviews 表 L25-16 行，该行按 Plan S7 第 6 步属 L25-16 维护会话职责）。**新登记 PM 决策纸** `docs/reviews/2026-10-29-l25-16-pm-decision-sheet-d7-d8-g34.md`（G34／D7／D8 三项签字输入 ＋ 第 8 轮复审与 L25-15 S0 两项连带裁决）。**未变更事实口径**：Spec v1.0／Plan v0.8、七轮、G1–G38、VOPS-01–78 不变；**交付判定仍为未取得「可交付开发」**。⚠️ 版本号为跨会话共享计数器，写前须实读顶部版本行取 current+1 |
| v1.41 更新 | 2026-10-29，L25-11／L25-14 登记册对齐（事实对齐，同类漂移一并修正）：① **L25-11 行**状态由「已实现，未验收」更正为「**独立静态审阅退回，待修订；已实现部分未验收**」，并补 `2e98be74` 落地 D1–D23 生产接线但**尚未复审**——与其 Spec 头部状态行及 `docs/README.md` L25-11 行一致（该 Spec 头部已于 2026-10-28 经 PM 授权做事实对齐，见其 §1.5）。② **L25-14 行**状态补「**Spec／Plan 文档评审已关闭、修订通过**」与「C14–C18 已实施、未验收，C19 待正式验收」——此前只写「已实现，未验收」，漏了评审收口事实与 C14–C18 落地情况。**两条均只改状态陈述，不改冻结合同、不改 V01–V22 状态、不改 Wave 0b 与 `blocked_delivery` 交付阻断** |
| v1.40 更新 | 2026-10-29，L25-09 登记册再对齐（事实对齐，修正本表 v1.36 行与 §9 L25-09 行的两处失准）：① **验收矩阵命名空间更正**——原写「V01–V22 全部未执行」有误，V01–V22 属其他 Spec 的验收矩阵、不属本条（主 Spec §18.8 原文）；本条自身矩阵是 **A01–A12（AUD25 全部 12 个 variant，无 spec 覆盖、全部 blocked）** 与 F-04 全部子例，均未执行。② **D-32／D-33 已置 `fixed`**（`fixedIn` = `00cf44d4`），非「均 open」。③ 补登九个实施／取证提交与 Stage 1 结果（ARV25-V01…V11 共 11 个 variant 真实 passed，V12 待 `k8s-amd64` 仍 blocked）；④ 补记 **D-34**（P2，open，harness 侧，单窗口全量 real-e2e 必撞登录限流）；⑤ 标注取证为**本地开发机运行**（releaseReady=false、非受信 CI runner、`topology=local-process`）⇒ 只证明修复有效、不构成发布级证据，G-01 保持 open。⚠️ **本条自身仍未获验收** |
| v1.39 更新 | 2026-10-29，L25-16 **登记维护归属约定**（治理性，非事实变更）：**L25-16 的四处登记——本表 §9 的 L25-16 行、升级建议书 §2.10、`docs/README.md` 的 L25-16 Spec 行、`docs/plans/README.md` 的 L25-16 Plan 行——由 L25-16 维护会话独占维护**，其他会话不再写这四处 L25-16 行；发现漂移只告知、不代改。理由与已发生的漂移实例见升级建议书 §2.10 末条。本表与建议书的**其他条目**（L25-09、L25-15 等）不受影响。另**回应另一会话的两项提醒**：`docs/README.md:57` 与 `docs/plans/README.md:8` **均已更新为七轮口径**，两行均无两轮审阅一类的旧口径残留——该会话读到的是**滞后快照**。**未变更任何事实口径**：Spec v1.0／Plan v0.8、七轮、G1–G38、VOPS-01–78 不变；**交付判定仍为未取得「可交付开发」**。⚠️ 版本号为跨会话共享计数器，写前须实读顶部版本行取 current+1 |
| v1.38 更新 | 2026-10-29，L25-16 开工前置条件补齐（事实对齐）：**补登 G34 为开工前必答项**——第 6 轮 Codex 判定为「设计层仍未闭合」的**唯一一条**（幂等认领与审计绑定的事务边界未定），此前只登记在 Spec §7 缺口表，**未进入 Spec §8 与 Plan S0 的开工前置口径**；现已补入 Spec §8「开工前仍须」第 ⑤ 条、Plan S0 第 11 步与 Plan 交付判定段。**G34 同时约束 W-A 与 W-B**（W-A 前置集合含 G32–G34，W-B 含 G1–G34 全部）——此前口径只把 L25-11 审阅通过列为 W-B 的额外前置，**漏了 G34 对 W-A 的阻塞**。另：§7.1 与 Plan S7 对 L25-11 状态行的事实对齐措辞已按实际 §1.5 复核更正（冻结项与 V01–V22 状态不变）。**版本号不变（Spec v1.0／Plan v0.8）、验收范围不变（VOPS-01–78）、缺口范围不变（G1–G38）**，仅补齐前置条件口径；**交付判定仍为未取得「可交付开发」**。⚠️ L25-16 为在飞文档，其轮次与验收范围由其维护会话继续推进并回写本表 |
| v1.37 更新 | 2026-10-29，L25-16 登记册对齐（事实对齐，跟进在跑会话的新进度）：Spec **v1.0**／Plan **v0.8**，已按**七轮**独立审阅逐条修订——第 1 轮「退回修订」、第 2–4 轮「需再修订」、第 5／6／7 轮「**不可交付开发**」；第 5–7 轮共 26 条阻塞／高危发现**全部逐条回查源码核实属实**并落修，含两处**事实性更正**（批量校验不产出可发布快照、发布锁不覆盖终态核验）。缺口 G1–G38，验收扩为 **VOPS-01–78**。**仍未取得「可交付开发」结论**——第 7 轮后按 PM 要求停止 Codex CLI，未经第 8 轮独立复审；且需 **D7 与 D8（staged 批次归属与消费）** 的 PM 签字与需求审查签核，不授权代码实现。⚠️ L25-16 为在飞文档，其轮次与验收范围由其维护会话继续推进并回写本表 |
| v1.36 更新 | 2026-10-28，L25-09 登记册同步（事实对齐，经审计增量会话请求代写）：§9 索引表 L25-09 行由「已实现，未验收」更正为「**部分实现，未验收**」，并补登记三项实施提交——`898aa2a1`（P0-1 精确 as-of S 证明与授权保真）、`00cf44d4`（写路径执行凭据与 P0-4 列名漂移，D-32）、`b21b1d4f`（批次 D 文档回写与审计案例证据链自检，新增 D-32／D-33，均 open）；**A01–A12 及全部命名子例、F-04 全部子例、V01–V22 全部未执行**。另记：精确 as-of S 未证明时 P0-4 正式读取返回 409 `RECONCILIATION_AS_OF_S_UNPROVABLE` 属**失败关闭设计行为**（ARV25-V06 断言对象），非新缺陷，取证应走诊断模式缺失集合。⚠️ `docs/README.md` 的 L25-09 行与 L25-09 Spec 交叉审阅状态行归属审计增量会话，本处未代改 |
| v1.35 更新 | 2026-10-28，§9 索引表 L25-16 行补齐审阅报告直链：正文声明「第 1–5 轮」但此前只挂第 1 轮报告，round2–round5 四份报告点不进去；现补为五轮直链（`2026-10-28-codex-review-lucy-ops-control-plane.md` 及 `-round2/3/4/5.md`）。**仅补链接，状态口径与 v1.34 相同**（Spec v0.8／Plan v0.6、第 1–5 轮、第 5 轮「不可交付开发」、缺口 G1–G29、验收 VOPS-01–69） |
| v1.34 更新 | 2026-10-28，L25-16 登记册对齐（事实对齐，跟进在跑会话的新进度）：Spec v0.8／Plan v0.6，已按第 1–5 轮独立审阅逐条修订——第 1 轮「退回修订」、第 2–4 轮「需再修订」、第 5 轮「**不可交付开发**」（Q01／Q02／Q03／F5-01 均已在本版落地修订）；缺口 G1–G29，验收扩为 VOPS-01–69。**尚未取得「可交付开发」结论**——须经第 6 轮复审，且仍需 D7 的 PM 签字与需求审查签核，不授权代码实现。⚠️ L25-16 为在飞文档，其轮次与验收范围由其维护会话继续推进并回写本表 |
| v1.33 更新 | 2026-10-28，L25-15 登记册同步（事实对齐）：Spec／Plan 已按**三轮**独立审阅定稿至 **v0.8**——首轮「退回修订」（4 阻塞 / 4 高 / 1 中 / 1 低）、第二轮「仍需修订」（4 闭合 / 6 部分闭合 + N01–N03）、第三轮「仍需修订」（9 闭合 / 5 部分闭合 + G01–G03），**共 24 条发现全部核实成立并逐条处置**；产品语义本身成立、不撤销。v0.8 收敛终态审计为唯一四步顺序与 pending 单一设置点、启动对账为六类互斥分类（补写类优先于索引续跑类）、索引模式与读回统一消费语义删除集合（含 Manifest 原地回写删表）、写前失败结算与镜像受控路径补入 SRR 断言；验收 SRR-01–SRR-24 全部未执行，**S0 锁生命周期偏差裁决未完成前不得进入 S1**。仅状态陈述对齐，未改 Spec／Plan 冻结合同与验收矩阵 |
| v1.32 更新 | 2026-10-28，登记册同步三项：① 登记 v0.25 L25-16 运维控制面 MCP（`lucy_ops_*`）——PM 已拍板 D1 = C 混合授权（`role.allow.ops` 独立维度 + `user.delegated_from` 委托 + owner 门禁）、D2 = 首期直接做 Phase 1、D3 = preview→commit + 部分成功可重放（同写集原子组 D7）、D5 = 首期拆 W-A／W-B；两轮独立审阅（首轮「退回修订」、第二轮终审「需再修订」N01–N11）已逐条落修至 v0.5，缺口 G1–G19、验收 VOPS-01–58，**待复审确认，未提交需求审查，不授权代码实现**。② 同步 L25-15：Spec／Plan 已按 2026-10-28 独立审阅修订至 v0.5（结论「退回修订」，产品语义成立不撤销），验收扩为 SRR-01–SRR-24，待复审、暂不开发。③ 更正 L25-11 Spec 头部状态行（独立审阅退回 + `2e98be74` 已落地但未复审）——仅状态陈述对齐，不改其冻结合同与 V01–V22 |
| v1.31 更新 | 2026-10-27，按 Claude Code 第三轮只读复核（最终聚焦）将 L25-15 Spec／Plan 修订至 v0.4，补删除后的强制索引重建与读回、reindex 前全量 upsert 范围、可恢复终态审计协议及四项一致性边界；仍待需求审查、暂不开发，SRR-01–SRR-22 全部未执行 |
| v1.30 更新 | 2026-10-27，按 SPEC 状态审计结果回填 10 项实现状态：L25-01／02／03／09／11／14（P0 批次，提交 `21de5168`）、L25-07／08／10／13（P1 批次，提交 `28780eae`）；原「待需求审查／暂不开发」统一更正为「已实现，未验收」，验收矩阵仍全部未执行，交付阻断不变 |
| v1.29 更新 | 2026-10-27，按 Claude Code 第二轮只读复核将 L25-15 Spec／Plan 修订至 v0.3，补受控镜像删除与实际 KTX 扫描范围、单表 YAML 导入、reindexing 启动结算及一致性边界；仍待需求审查、暂不开发，SRR-01–SRR-22 全部未执行 |
| v1.28 更新 | 2026-10-27，按 Claude Code 只读审查将 L25-15 Spec／Plan 修订至 v0.2，收口 absent 删除、写前记录关联、三态幂等、完整索引范围披露、审计、协调器与保留竞态；仍待需求审查、暂不开发，SRR-01–SRR-22 全部未执行 |
| v1.27 更新 | 2026-10-27，登记 v0.25 L25-15 语义发布历史版本与整批恢复独立 Spec／Plan；设计完成、待需求审查、暂不开发，SRR-01–SRR-22 全部未执行 |
| v1.26 更新 | 2026-10-25，PM 签核确认 v0.25 六项 P1 需求审查九项全部通过；需求审查闭环，仍不授权开发、全部功能验收未执行，F-01–F-04 留作实施前待办 |
| v1.25 更新 | 2026-10-25，登记 v0.25 六项 P1 设计基线与需求审查记录：行策略模板与反查、授权摘要、访问关系图、Hive 直连、升级 E2E 自动化及升级候选验证；需求审查 9/9 通过并已签核，不授权开发，全部功能验收未执行，F-01–F-04 留作实施前待办 |
| v1.24 更新 | 2026-10-24，收口 v0.25 首批四个 P0 设计：L25-09 审计全量、L25-14 安全核心、L25-11 语义批量完整闭环及 L25-02／03 审计只读对账展示；全部待需求审查、验收未执行，不授权开发，Wave 0b 未解锁保持 `blocked_delivery` |
| v1.23 更新 | 2026-10-23，同步差异化主张（口径、权限、语境是模型之外的资产）与 vision.md §1.2 的自建 / 外购判据、差异化边界、衡量口径引用；仅定位与文档口径同步，不改变能力边界与交付状态 |
| v1.22 更新 | 2026-10-22，登记 v2.5 L25-14 行权限管理 Spec v0.1-draft（可复用静态行策略模板 + 最终行约束预览 + 行权限视图 + 配置审计）；同步登记行级策略字段绑定存量缺陷 D-03（P1 / open，只登记不修，留 v2.0 线排期）；仅设计草案，验证未执行，暂不开发 |
| v1.21 更新 | 2026-10-22，登记 v2.5 L25-13 升级候选验证环境实施方案 v0.1；仅规划，暂不开发，不改变客户现场以原地升级为主线的放行方式 |
| v1.20 更新 | 2026-10-21，新增数据库支持矩阵（`docs/governance/database-support-matrix.md`）作为数据库支持状态唯一真源；本文件「数据库接入」能力行改为引用它 |
| v1.19 更新 | 2026-10-20，登记 v2.5 L25-11 语义资产批量维护 Spec v0.1-draft；仅设计草案，验证未执行，暂不开发 |
| v1.18 更新 | 2026-10-20，登记 v2.5 L25-10 Hive 直连实施方案；仅规划，暂不开发 |
| 撰写日期 | 2026-06-17；v1.1 更新 2026-06-21；v1.2 更新 2026-06-21；v1.3 更新 2026-06-21；v1.4 更新 2026-06-22；v1.5 更新 2026-06-24（澄清 Lucy 不直接回答问题的定位措辞）；v1.6 更新 2026-07-06（同步交付缺口、headless 边界、运行时 instructions 来源和本机配置治理）；v1.7 更新 2026-07-06（同步 data agent context compiler + governed MCP runtime 定位）；v1.8 更新 2026-07-27（新增 Agent Admin 企业级交付 spec 索引）；v1.9 更新 2026-08-03（新增 Lucy 202608 可靠性交付系统升级蓝图索引）；v1.10 更新 2026-08-03（新增 Lucy 202608 执行总控与 Dynamic RLS POC 索引）；v1.11 更新 2026-08-03（同步 Kubernetes / Helm 单副本 baseline：`deploy/k8s/helm/lucy/`）；v1.12 更新 2026-08-03（将 202608 主线收窄为 Enterprise Governance & Observability）；v1.13 更新 2026-08-03（删除 Dynamic RLS / CLS POC spec / work order，移出 202608 active scope）；v1.14 更新 2026-08-26（索引可选 Agent Chat A3 Design Spec；非默认交付）；v1.15 更新 2026-08-28（索引 API Staging 接入准入 Spec · 计划支持）；v1.16 更新 2026-09-24（索引运维问数连接 Spec 149）；v1.17 更新 2026-10-18（索引 Cloudflare OS 对标差异） |
| 适用范围 | 新成员 onboarding、模块索引、当前能力边界 |

project-lucy 是面向中小企业的 **data agent context compiler + governed MCP runtime**。它把数据库、BI、文档、人工口径编译成 Agent 可安全使用、可审计、可回归的数据服务；底座为 KTX 语义层、wiki、eval cases、skills、Lucy MCP Proxy 和 Lucy WebUI 治理工作台。

差异化主张：**口径、权限、语境是模型之外的资产，模型换代它们不变**。企业 Agent 正从 frontier 闭源模型迁到微调后的开源小模型，差异不在模型本身，而在业务逻辑与企业集成；Lucy 把「这家企业的业务逻辑」沉淀为可执行、可授权、可审计、可回归的外部资产。完整定位、自建 / 外购判据、差异化边界与衡量口径见 [`docs/governance/vision.md`](vision.md) §1.2。

Lucy 自身不直接生成分析结论或回答问题；语义问答由 Claude Code / Codex / Hermes / Cursor 等 Agent 通过 Lucy 提供的受治理 MCP 能力完成。面向产品化交付，用户通过 Docker 部署 Lucy，接入数据库，维护客户 context package，并在 agents 平台配置 MCP endpoint/token 接入数据能力。该目标的验收合同见 `docs/specs/lucy-platform-goal-checklist.md`。

Lucy 当前 context compiler 的四类资产：

| Context Pack | 当前承载 | 说明 |
|---|---|---|
| Semantic Pack | `semantic-layer/` | schema、grain、measures、segments、joins、source metadata |
| Knowledge Pack | `wiki/`、`skills/` | 业务口径、分析路径、领域坑点、reviewer checklist |
| Query Pack | `evals/`、审计 trace、后续 trusted query 资产 | 当前以 eval 和 trace 为基础；BI/dashboard trusted query ingestion 属后续增强 |
| Quality Pack | `evals/`、`.ktx-ui/audit.sqlite`、release gates | business eval、安全回归、MCP contract、审计和发布门禁 |

## 1. 双轨语境

| 文件 | 语境 | 说明 |
|---|---|---|
| Lucy MCP Proxy `initialize` instructions（来源 `webui/config/data-qa-instructions.md`） | 运行时 | 数据问答规则由 proxy 注入给 MCP client |
| `CLAUDE.md` | 开发/运行入口指引 | 只做入口引用，不承载数据问答规则正文 |
| `AGENTS.md` → `docs/governance/DEVELOPMENT.md` | 开发态 | 代码、配置、spec 修改治理规则 |
| `inbox/` | 临时产物 | 一次性审计、过程报告、临时计划，可在进程结束后删除 |

开发规则不得写入 `CLAUDE.md` 或 `webui/config/data-qa-instructions.md`；数据问答规则只维护在 `webui/config/data-qa-instructions.md`，不复制到开发治理文档。

## 2. 当前数据域

| Domain | 主要用途 | 语义层 / 资产 |
|---|---|---|
| Superstore | 零售订单、折扣、利润、退货、区域经理分析 | `semantic-layer/mysql-aliyun/superstore_orders.yaml` · `skills/domains/superstore/*` · `wiki/global/superstore-analysis-playbook.md` · `evals/superstore/*` |
| KX Financial | 柯西公司财报金额、利润表、资产负债表、现金流分析 | `semantic-layer/mysql-aliyun/kx_fact_financial_amount.yaml` · `wiki/global/kx-financial-analysis-playbook.md` · `evals/kx_financial/*` |
| Data Agent POC | 广告收入、活跃、CEO 指标快照和受限财务表验证 | `semantic-layer/poc-mysql-aliyun/*` · `wiki/global/poc-*.md` · `evals/data_agent_poc/*` |

底层数据库以 Aliyun RDS MySQL 8.0.34 为主，当前正式连接 ID 为 `mysql-aliyun`，POC 连接 ID 为 `poc-mysql-aliyun`。

## 3. 核心目录

```text
project-lucy/
├── CLAUDE.md                         # 开发/运行入口指引，不承载数据问答规则正文
├── AGENTS.md                         # Agent 开发入口
├── ktx.yaml.example                  # 共享 KTX 配置模板；真实 ktx.yaml 为本机 ignored 文件
├── docs/                             # 仓库级治理、设计、review、UAT、用户文档
├── inbox/                            # 临时审计/计划/过程产物
├── semantic-layer/mysql-aliyun/       # KTX manifest + overlay
│   ├── _schema/dataforai.yaml         # KTX 扫描生成的物理结构 manifest
│   ├── superstore_orders.yaml         # Superstore overlay
│   └── kx_fact_financial_amount.yaml  # KX 财务事实表 overlay
├── skills/
│   ├── warehouse/                     # 顶层数据问答路由与指标规则
│   ├── reviewer/                      # 高风险回答审查清单
│   ├── domains/superstore/            # Superstore 领域 reference docs
│   └── analysis/                      # 折扣、利润拆解程序性参考
├── wiki/global/                       # 可被 KTX wiki 检索的业务口径文档
├── evals/
│   ├── superstore/                    # Superstore eval + quiz
│   └── kx_financial/                  # KX 财务 eval + quiz
├── webui/                             # Lucy WebUI 本地治理工作台
└── deploy/k8s/helm/lucy/              # K8s / Helm 单副本 chart（2026-08-03 起 supported baseline；不含 HA）
```

## 4. 运行时回答链

数据问答运行时遵循 Lucy MCP Proxy `initialize` 注入的 instructions，正文来源为 `webui/config/data-qa-instructions.md`：

1. 先查 KTX semantic layer：`sl_read` / `sl_query`。
2. 再查 KTX wiki / reference docs：`wiki_search`。
3. 语义层和 wiki 都不能覆盖时才允许 raw SQL fallback，并必须声明假设。
4. 财务指标、跨表 JOIN、领导汇报、因果分析触发 reviewer 检查。
5. 最终回答必须附 Provenance Footer。

## 5. 语义层现状

| Source | 类型 | 当前人工 overlay | 说明 |
|---|---|---|---|
| `superstore_orders` | 事实表 | grain、派生列、9 measures、3 segments、2 joins | Superstore 主事实源 |
| `kx_fact_financial_amount` | 事实表 | 表描述、grain、3 measures、多个 statement/amount segments | KX 财报金额主事实源 |
| `kx_dim_company` | 维表 | manifest 为主 | KX 公司维度 |
| `kx_dim_financial_item` | 维表 | manifest 为主 | KX 财报项目维度 |
| `kx_vw_balance_sheet_detail` | 视图 | manifest 为主 | 资产负债表明细 |
| `kx_vw_cash_flow_statement_detail` | 视图 | manifest 为主 | 现金流量表明细 |
| `kx_vw_income_statement_detail` | 视图 | manifest 为主 | 利润表明细 |

manifest / overlay 分层规则见 `docs/governance/DEVELOPMENT.md`。人工维护的 grain、measures、segments、joins 应写入 overlay，不手改 `_schema/*.yaml`。

## 6. WebUI 模块现状

WebUI 是本地治理工作台，当前导航有 7 个一级模块：

| 模块 | 入口 | 状态 | 说明 |
|---|---|---|---|
| 部署向导 | `/onboarding` | 已实现 | 聚合客户上线主链路、MCP endpoint 和 agent 配置复制 |
| 数据库接入 | `/connections` | 已实现；安全契约待补强 | 连接概览、表白名单、连通测试、ingest |
| 语义层维护 | `/`、`/sources/:conn/:schema/:table`、`/joins/:conn/:schema/:table` | 已实现 | 表目录、表编辑、Join 管理 |
| 业务文档 | `/wiki` | 已实现 | Wiki frontmatter + Markdown 编辑 |
| 审阅与校验 | `/review` | 已实现 | `GET /api/diff`、`POST /api/validate-changed` |
| 质量评测 | `/eval/cases`、`/eval/runs`、`/eval/monitor` | 已实现 | Case 管理、运行历史、趋势监控 |
| 访问治理 | `/admin/agents`、`/admin/audit` | 已实现；role-first admin UI/API 已闭环，Role 模板库 P1 已落地 | Agent、Token、ACL、访问日志、配置审计 |

详细状态表见 `docs/webui/webui-impl-status.md`。`webui/docs/codex/*` 是 M0-M5 执行历史归档，不代表当前全部模块范围。

### 6.1 交付状态快照（2026-07-06）

| 模块 / 能力 | 当前判断 | 交付含义 |
|---|---|---|
| Docker headless customer path | 达到当前交付预期 | 标准入口是 Docker Compose、配置文件、Lucy MCP Proxy、Agent MCP config、smoke/eval 证据 |
| Kubernetes / Helm customer path | 单副本 supported baseline（2026-08-03 起） | 标准入口是 `deploy/k8s/helm/lucy/`、`docs/runbooks/customer-k8s-deployer-quickstart.md`；`Recreate` strategy + RWO PVC；HA 不在本期 |
| WebUI 管理台 | 已实现内部治理能力，但非当前客户标准入口 | 代码和测试作为内部质量门禁；客户承诺需另补 UAT、用户文档和稳定性证据 |
| 数据库接入 | MySQL/PostgreSQL verified；StarRocks/Doris gated；SQL Server/Athena experimental；SQLite verified（仅本地文件）；Oracle roadmap | 支持状态以 [`docs/governance/database-support-matrix.md`](database-support-matrix.md) 为唯一真源；StarRocks live certification 前不能写入 verified matrix |
| API Staging 接入（P1-MasterUidExtension） | **计划支持**（Spec 已落盘；ETL / WebUI / 生产域 **暂不开发**） | 见 `docs/specs/api-staging-admission-spec.md`；不承诺 Lucy 原生 HTTP |
| Semantic layer / Wiki 管理 | 编辑能力已实现，reindex 与 wiki_search 交付证据仍不足 | 不能把 WebUI 维护链路整体标记为 verified 治理闭环 |
| Skill management | 文件资产存在，Skill Editor / 版本化 / 自动加载闭环未开发 | 当前只能作为代码库治理资产，不是产品化 Skill 管理模块 |
| MCP endpoint lifecycle | Proxy、token、config 复制已实现；M18 起 endpoint 由 `LUCY_PUBLIC_MCP_URL` runtime 配置，WebUI 统一从 `GET /api/project.mcpEndpoint` 读取并展示；启停、状态、健康、轮换 UI 未开发 | 当前交付为“runtime-configured 接入配置”，不是完整 endpoint 生命周期管理 |
| Business eval | Catalog/smoke/WebUI run 基础已实现；完整 LLM/agent eval 未形成稳定证据 | 未达到自动质量门禁预期，需具备 agent/model secret 后补跑并归档 |
| Observability / alerting | R1 最小排障端点存在；通用 metrics、告警、日志聚合未开发 | 不属于当前 headless 交付承诺，后续需独立 spec |

## 7. Eval / Quiz 现状

| Domain | Eval YAML | Quiz HTML | 说明 |
|---|---|---|---|
| Superstore | `evals/superstore/eval/superstore-eval-cases.yaml` | `evals/superstore/superstore-quiz-cases.html` | 零售口径、反模式、多轮、路径选择等 |
| KX Financial | `evals/kx_financial/eval/kx_financial-eval-cases.yaml` | `evals/kx_financial/kx_financial-quiz-cases.html` | KX source 路由、财报视图、amount_type、NULL、join 等 |

新增或刷新 eval/quiz 必须遵循 `docs/governance/eval-quiz-conventions.md`。

## 8. 访问治理现状

Lucy MCP Proxy 监听 `LUCY_PROXY_HOST:LUCY_PROXY_PORT`（默认容器内 `0.0.0.0:7879`），实际对外可访问的 endpoint 是部署方通过 `LUCY_PUBLIC_MCP_URL` 注入的 URL（详见 `docs/runbooks/deployment-docker.md` §9 与 `docs/runbooks/customer-deployment-guide.md` §1）。WebUI `/onboarding`、`/connections`、`/admin/agents` 与 Token 首秀页面统一从 `GET /api/project.mcpEndpoint` 读取该值用于展示与复制；前端不再根据浏览器 host、容器端口或 `localhost` 推断 endpoint。MCP proxy 用于：

- Bearer token → userId 映射。
- `tools/list` 过滤与 `kx_catalog` 注入。
- 工具级、connection 级、表级 ACL。
- SQLite audit 记录。

当前 `webui/config/access.yaml` 已含 v1.2 role 模型（例如 `kx_readonly`），Admin UI/API 已按 role-first 写入路径闭环：新建/编辑 Agent 强制 role，legacy `allow` 只读，token 与配置写入进入审计。2026-06-22 P1 增量已补 Role 模板库、模板展开落盘、`lint:spec` 防模板指针漂移、Onboarding MCP 失败原因细分和 `config_change_log` CSV 导出。访问权限升级域档案见 `docs/access-control/`；现行基线 `docs/access-control/design-upgrade.md` v1.1.2。

业务 Wiki 的对象授权仍只由文档 frontmatter `allowed_roles` 决定；管理面在此之上提供三层能力（Spec 193 / Plan M66）：上传预检内直接完成授权（覆盖上传默认保留现有授权，差异只展示不自动采用）、阅读页独立的「管理访问权限」入口（只改写 `allowed_roles`，正文逐字保留）、以及最多 100 篇**显式选择**文档的批量授权（添加角色 / 替换可访问角色）。扩权变更先写 durable security operation 并激活 per-key hold，security operation 提交前该 Wiki key 的 Agent 搜索与读取全部拒绝；崩溃后恢复为 `needs_review` 并继续拒绝，不自动重放或确认扩权。批量不是跨文件事务：整批基线过期零写入零 journal，执行中单篇冲突为单篇结果，成功项不回滚。详见 `webui/docs/193-business-wiki-access-management-spec.md`。

2026-06-22 另验证了「VIEW-as-pseudo-table」变通方案（CIO demo）：role `superstore_region_huadong` 通过 VIEW `dataforai.superstore_orders_huadong` 把表级 ACL 锁定到单一区域，零代理层代码改动；细节见 `docs/access-control/design-governance-baseline.md` §3.2。

## 9. 关键文档索引

| 主题 | 文档 |
|---|---|
| Lucy 产品定位与愿景 | `docs/governance/vision.md` |
| **竞品分析与差异化立项（20261014）** | **`docs/specs/lucy-20261014-safe-log-to-quality-eval-spec.md`**（P0-1 反馈回流浪程）· **`docs/specs/lucy-20261014-release-bom-spec.md`**（P0-2 发布物料清单）· **`docs/specs/lucy-20261014-concept-dictionary-spec.md`**（P1 概念字典）；工单 `docs/plans/wo-20261014-*.md`；分析底稿与评审历史 `docs/specs/lucy-20261014-fivetran-context-layer-competitive-analysis.md` |
| Cloudflare OS 对标差异（20261018） | `docs/specs/lucy-20261018-cloudflare-os-benchmark.md`。公开材料对照，不是功能 Spec；未纳入本地实机截图交叉审阅 |
| Hive 直连（v0.25 L25-10，P1-4，已实现（仅编译侧），未验收） | [Hive 直连 Spec](../specs/lucy-20261025-v0p25-hive-direct-connection-spec.md)、[上游实施方案](../plans/2026-10-20-hive-direct-connection-implementation-plan.md)。Lucy 适配 HiveServer2/JDBC，复用未修改的 KTX Python 语义计算接口；支持状态保持 `planned`；提交 `28780eae`，JDBC 执行与 MCP 入口接入本轮未实施（V03–V17 记 `blocked_environment`），H25-01–08 全部未执行 |
| 审计事实、可靠性与证据闭环（v0.25 L25-09，P0-1，部分实现，未验收） | [审计增量 Spec](../specs/lucy-20261020-v2p5-audit-increment-spec.md)。S01–S08 全量、U1–U12 冻结语义保留；R1–R10／R12 旧规范文档同步完成；实施提交 `21de5168`（基准）及增量 `898aa2a1`／`00cf44d4`(D-32)／`4ef1e1e3`／`71e4e788`／`6db2a879`／`b21b1d4f`／`fd197e5b`／`c2a08eec`／`97d6800a`／`ea3c52bc`(D-34 修复)／`6db3a522`(台账 D-34 置 fixed)／`c0498317`(D-34 口径收口)。**本条验收矩阵为 A01–A12 与 F-04 全部子例，均未执行**（V01–V22 属其他 Spec，不属本条；P0-4 对账自己的 ARV25-V01–V12 中 11 个已 passed、V12 待 `k8s-amd64` 仍 blocked）。**A01–A12（AUD25 全部 12 个 variant）：PM（2026-10-29）决定本轮不写 spec，记为「未执行且不排期」**（主 Spec §18.14）——它们**仍是刚性 P0**（coverage `priority: P0` ＋ Spec §13.2 冻结 ＋ U9「Stage 1＝全量」三处一致），**只是本轮不投入，不是降级、不是豁免、不是取消**；**直接后果：U9 Stage 1 本轮不满足（0/12），本条不可交付 UAT**，ARV25-V01…V11 的 passed 只覆盖只读对账展示一侧；**恢复条件**：PM 重新授权写入 A01–A12 的运行时取证（其中 A01 需先有「可观测的屏障同步点」方案）。台账 D-32／D-33 已置 `fixed`（`fixedIn` = `00cf44d4`）；**D-34 亦已置 `fixed`**（`fixedIn` = `ea3c52bc`）。**根因**（分腿实测）：打满 source-wide 桶的是**安全腿**（69–70 次登录，含故意错密码 33–42 次），**管理腿只需 9–11 次**；触发条件是**两条腿启动间隔 < 5 分钟**。**修法**：① 限流洪水改走**独立 source**（本地实例双栈监听，洪水走 IPv6 回环 `[::1]`，服务端看到 `::1`，主体流量仍是 `127.0.0.1` ⇒ 两个不同的桶）；② 管理腿表单登录被限流时按 `Retry-After` **退避重试**。**取证 run `inbox/e2e/l2510-d34fix`**（两条腿紧邻启动、间隔 < 1 分钟）：洪水 48 次请求全落在 `::1`，主体流量仅 1 次 429；**全量管理腿 16 passed / 9 failed / 26 blocked**，与干净基线 `l2509-stage1` **逐字相同**（修复前同一场景 1 passed）；顺带修好 SEC-05-V02、V05 两个基线失败用例（安全腿 89→91 passed）。⚠️ 仍为**本地开发机**运行（`releaseReady=false`、非受信 CI runner、`topology=local-process`）⇒ **只证明修复有效，不构成发布级证据**；G-01 保持 open，Wave 0b 与 `blocked_delivery` 不解除。 |
| 审计只读对账展示（v0.25 L25-02／03，P0-4，已实现，未验收） | [审计只读对账展示 Spec](../specs/lucy-20261024-v0p25-audit-reconciliation-view-spec.md)。统一完整表身份、预算凭据及配置／活跃 Token 对账；只读复用 S05，不新增预算、配额、金额；提交 `21de5168`，V01–V12 全部未执行 |
| 语义资产批量维护（v0.25 L25-11，P0-3，独立静态审阅退回，待修订；已实现部分未验收） | [语义资产批量维护 Spec](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md)。完整闭环、共享发布协调器与失败恢复；D1–D4 已裁决；基线提交 `21de5168`，其后 `2e98be74` 落地 D1–D23 生产接线、**尚未复审**；V01–V22 全部未执行，Wave 0b 未解锁保持 `blocked_delivery` |
| 语义发布历史版本与整批恢复（v0.25 L25-15，P0，三轮独立审阅后定稿至 v0.8，待最终复核，暂不开发） | [整批恢复 Spec](../specs/lucy-20261027-v0p25-semantic-release-restore-spec.md)、[实施 Plan](../plans/2026-10-27-lucy-v0.25-semantic-release-restore-implementation-plan.md)、[独立审阅报告](../reviews/2026-10-28-codex-review-l25-15-semantic-release-restore.md)。批次前快照、整批 CAS、恢复生成新批次与固定保留；**三轮**独立审阅共 24 条发现全部核实成立并逐条处置（首轮「退回修订」→ 第二轮「仍需修订」→ 第三轮「仍需修订」），**产品语义本身成立、不撤销**；v0.8 收敛终态审计唯一四步顺序、启动对账六类互斥分类、语义删除集合判定，写前失败结算与镜像受控路径补入 SRR 断言；验收 SRR-01–SRR-24 全部未执行；S0–S7 均为后续授权阶段，**S0 锁生命周期偏差裁决未完成前不得进入 S1** |
| 运维控制面 MCP（v0.25 L25-16，P1，Spec v1.1／Plan v0.9，**W-A 已授权实现 S1–S4**，W-B 不可交付开发） | [运维控制面 Spec](../specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md)、[实施 Plan](../plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md)。2026-10-29 PM 授权 Claude Code 落地连接表与源表导入。语义发布留待 D8 与 L25-11。VOPS-01–78 未执行。**定向复审（2026-10-29，窄范围，非第 8 轮全量）**：查出 **T-01（中高）幂等表物理落点未冻结**并已修（幂等表冻结在 `audit.sqlite` 内、与 `config_change_log` 同库不同表）；其余复核项自洽。**口径未变**：Spec v1.1／Plan v0.9、G1–G38、VOPS-01–78、W-A 已授权实现 S1–S4；**D8 与 L25-15 S0 仍未签**。**〔登记归属：本行由 L25-16 维护会话独占维护，其他会话勿写此行；L25-16 的五处登记（含 `docs/README.md` 的 reviews 表 L25-16 行）完整约定见升级建议书 §2.10 末条〕** |
| 升级候选验证环境（v0.25 L25-13，P1-6，已实现，未验收，非门禁） | [升级候选验证 Spec](../specs/lucy-20261025-v0p25-upgrade-candidate-verification-spec.md)、[上游实施方案](../plans/2026-10-22-upgrade-candidate-verification-plan.md)。以一致性备份在隔离环境验证候选迁移与业务／审计连续性；提交 `28780eae`，真实升级与真实备份未执行（记 `blocked_delivery`），RVC-01–13 全部未执行，原地升级仍为客户现场主线 |
| 行权限安全管理（v0.25 L25-14，P0-2，Spec／Plan 文档评审已关闭、修订通过；已实现未验收） | [行权限管理 Spec](../specs/lucy-20261022-v2p5-row-permission-management-spec.md)。P0 仅 R2 最终行约束预览、R4 配置审计、R5 字段诊断；R1 模板与 R3 反查视图归 P1，D1–D7 已裁决；基线提交 `21de5168`，C14–C18 已实施、未验收，C19 待正式验收；V01–V22 全部未执行；D-03 归 0.20.Z 维护线 |
| 行策略模板与按表反查（v0.25 L25-14 R1／R3，P1-1，已实现，未验收） | [行策略模板与反查 Spec](../specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md)。复用 P0 行约束预览与字段诊断，不扩张安全语义；提交 `28780eae`，RTP-01–10、RTV-01–08 全部未执行 |
| 授权摘要与调试深链（v0.25 L25-01，P1-2，已实现，未验收） | [授权摘要 Spec](../specs/lucy-20261025-v0p25-access-authorization-summary-spec.md)。提供只读授权摘要与既有调试台深链；提交 `28780eae`，ASV-01–14 全部未执行，F-01 留作实施前待办 |
| 访问关系图（v0.25 L25-08，P1-3，已实现，未验收） | [Access Map Spec](../../webui/docs/187-access-relation-sankey-spec.md)。只读访问关系视图已落地（落点 `webui/src/pages/admin/AccessMap.tsx`）；提交 `28780eae`，SC-01–14 全部未执行，F-02 留作实施前待办 |
| 升级 E2E 自动化（v0.25 L25-07，P1-5，已实现，未验收，非门禁） | [升级 E2E 自动化 Spec](../specs/lucy-20261025-v0p25-upgrade-e2e-automation-spec.md)、[上游实施方案](../plans/2026-10-19-upgrade-e2e-implementation-plan.md)。覆盖 Docker／K3s／K8s、备份恢复及业务与安全连续性；提交 `28780eae`，真实升级执行未授权（记 `blocked_delivery`），UPG-01–16 全部未执行 |
| 业务 Skill 负责人（v0.25 L25-04，P2，PM 签核通过、S1／S2 已实施，暂不交付） | [业务 Skill 负责人 Spec](../specs/lucy-20261025-v0p25-skill-owner-spec.md)、[实施记录](../reviews/2026-10-26-lucy-v0.25-l25-04-skill-owner-implementation-record.md)。自由文本人员／团队标签，复用预检、CAS 与配置审计，不改变授权；SKO-01–16 仍未执行 |
| 可选 SMTP 通知（v0.25 L25-05，P2 可选能力，PM 签核通过、S1 已实施并完成最终复审签核、S1.1 收口已实施，暂不交付） | [可选 SMTP 通知 Spec](../specs/lucy-20261025-v0p25-smtp-notifications-spec.md)、[实施记录](../reviews/2026-10-26-lucy-v0.25-l25-05-smtp-notifications-implementation-record.md)。默认关闭，仅覆盖审计账本健康提醒和测试邮件，不含忘记密码或部署许可；**S2／S3 本轮实施，S4 不启动、SMTP-26 保持 blocked**；S1 不发信，SMTP-01–26 正式验收全部未执行 |
| v0.25 P1 需求审查与签核入口 | [需求审查清单](../plans/2026-10-25-lucy-v0.25-p1-requirements-review-checklist.md)、[需求审查记录](../reviews/2026-10-25-lucy-v0.25-p1-requirements-review-record.md)。六项 P1 需求审查 9/9 通过并已签核；不授权开发，F-01–F-04 留作实施前待办 |
| Lucy 202608 Enterprise Governance & Observability 升级蓝图 | `docs/specs/lucy-202608-reliable-delivery-upgrade-spec.md` |
| Lucy 202608 升级执行总控 | `docs/specs/lucy-202608-upgrade-execution-control.md` |
| Lucy 202608 Governance & Observability 差距分析 | `docs/access-control/gap-analysis-202608.md` |
| Lucy context compiler / MCP runtime 产品化目标 | `docs/specs/lucy-platform-goal-checklist.md` |
| Docker 部署 | `docs/runbooks/deployment-docker.md` |
| Kubernetes / Helm 部署（单副本） | `deploy/k8s/helm/lucy/`、`docs/runbooks/customer-k8s-deployer-quickstart.md` |
| 客户部署 / 运维手册 | `docs/runbooks/customer-deployment-guide.md` |
| 版本矩阵 | `docs/governance/version-matrix.md` |
| **数据库支持矩阵（支持状态唯一真源）** | **`docs/governance/database-support-matrix.md`** |
| 构建修订（版本信息页 / health `gitSha`） | `docs/specs/lucy-20261020-build-revision-identity-spec.md` |
| 测试分层与发布门禁 | `docs/governance/test-layers-and-release-gates.md` |
| Release CI | `docs/governance/release-ci.md` |
| Docker demo | `examples/docker-demo/README.md` |
| Executive POC（内部 CFO/COO/CIO） | `examples/executive-poc/README.md`、`docs/specs/lucy-poc-demo-isolation-spec.md` |
| 产品文档索引 | `docs/governance/product-docs-index.md` |
| 管理员指南 | `docs/runbooks/admin-guide.md` |
| 用户指南 | `docs/user-guide.md` |
| Agent 接入指南 | `docs/runbooks/agent-integration-guide.md` |
| 可选 Agent Chat（A3，非默认交付；客户 bundle 无悬空入口） | `docs/design/design-lucy-agent-chat-a3.md`、`docs/runbooks/runbook-lucy-agent-chat-a3.md`、`deploy/compose/docker-compose.agent-chat.yml`、`agent-chat/`（仓库维护用；`smoke:p0:delivery-isolation` 保证 Lucy 镜像不含 A3） |
| 安全指南 | `docs/runbooks/security-guide.md` |
| 企业安全整改与真实用户 E2E 上线门禁（2026-10-18，**已批准，按批次实施中**） | [整改 Spec](../specs/lucy-20261018-enterprise-security-and-real-e2e-spec.md)、[实施 Plan](../plans/2026-10-18-enterprise-security-and-real-e2e-plan.md)、[Cursor 提示词](../plans/2026-10-18-enterprise-security-cursor-prompts.md)；修复 P0/P1、恢复 Wiki/Skill 显式隔离并接入客户版本强制门禁 |
| 排障指南 | `docs/runbooks/troubleshooting-guide.md` |
| 开发治理 | `docs/governance/DEVELOPMENT.md` |
| WebUI 当前状态 | `docs/webui/webui-impl-status.md` |
| WebUI 模块使用 | `docs/webui/webui-module-guide.md` |
| WebUI 基础架构 | `webui/docs/01-architecture.md`、`webui/docs/02-arch-spec.md`、`webui/docs/03-api-spec.md`、`webui/docs/04-data-model.md` |
| WebUI 进入性能优化（已实施，2026-10-14 Codex收尾及fixture正式复验完成，未部署） | [Spec 174](../../webui/docs/174-webui-entry-performance-spec.md)、[Cursor实施与验证工单](../../webui/docs/plans/wo-20261013-webui-entry-performance.md)、[审阅修正工单](../../webui/docs/plans/wo-20261013-webui-entry-performance-REVIEW-FIX.md)、[复核与下一步计划](../../webui/docs/plans/wo-20261014-webui-entry-performance-RECHECK.md) |
| WebUI 内置系统手册 / Help Center | `docs/design/design-system-handbook-help.md`、`docs/SYSTEM_HANDBOOK.md` |
| WebUI 侧栏账户菜单 | [Spec 188](../../webui/docs/188-sidebar-account-menu-spec.md)：左下角单一账户入口，收纳系统手册及退出登录；本次仅 Code Review，未运行验证或重建 Docker |
| 业务 Wiki 权限管理 | [Spec 193](../../webui/docs/193-business-wiki-access-management-spec.md) · [Plan M66](../../webui/docs/plans/wo-M66-business-wiki-access-management.md)：上传时授权、单篇独立管理、最多 100 篇显式多选批量授权；**已实施，未验收**；目录继承暂缓 |
| YAML 交付自助运维 / Agent 自检 | `webui/docs/24-yaml-delivery-runbook-spec.md`、`webui/docs/plans/wo-M20-yaml-delivery-runbook.md` |
| MCP Auth Proxy | `webui/docs/07-mcp-auth-proxy-spec.md` |
| 访问日志审计证据硬化 | `webui/docs/137-access-log-audit-evidence-hardening-spec.md`、`webui/docs/plans/wo-202609-02-access-log-audit-evidence-hardening.md` |
| Lucy 查询执行与轮次归因可靠性 | `webui/docs/138-lucy-query-execution-and-turn-correlation-reliability-spec.md`、`webui/docs/plans/wo-202609-03-lucy-query-and-answer-reliability.md` |
| 客户查数体验与使用证据（日志立项） | `docs/plans/2026-10-11-customer-log-next-optimizations.md`、`webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`、`webui/docs/plans/wo-202610-12-query-turn-budget-and-repair.md` |
| 企业级 Data Agent 可回答性与交付标准 | `webui/docs/139-enterprise-data-agent-answerability-and-delivery-standard.md` |
| 业务 Skill MVP（只读 Hub + Agent 读取） | `webui/docs/144-skill-hub-mvp-spec.md`、`webui/docs/plans/wo-202609-23-skill-hub-and-publish-clarity.md` |
| 发布工作台校验口径 | `webui/docs/145-publish-validation-count-clarity-spec.md` |
| 运维问数连接 v1.1（未实现：只读审计视图、运维问数 Skill、连接级 Wiki、Docker demo 的 `demo_ops`） | `webui/docs/149-ops-evidence-connection-spec.md`、`webui/docs/plans/wo-202609-25-ops-evidence-connection.md` |
| **访问权限域档案（入口）** | **`docs/access-control/README.md`** |
| 访问权限升级设计 v1.1.2 | `docs/access-control/design-upgrade.md` |
| 企业完整性 P0 决策备忘 | `docs/access-control/integrity-p0-decision.md` |
| AC-P0 实施计划 | `docs/access-control/plans/wo-202608-59-access-control-p0.md` |
| Agent 权限设计（Module 1 历史） | `docs/access-control/design-agent-permissions-v1.md` |
| 访问治理闭环设计（2026-06 基线） | `docs/access-control/design-governance-baseline.md` |
| 行级 ACL 可行性附录（SUPERSEDED） | `docs/access-control/feasibility-row-acl.SUPERSEDED.md` |
| Agent Admin 企业级交付 spec | `webui/docs/14-agent-admin-enterprise-delivery-spec.md` |
| Eval 设计 | `docs/design/design-eval-monitoring.md` |
| Eval Tool-Budget 设计 | `docs/design/design-eval-tool-budget.md` |
| Eval / Quiz 约定 | `docs/governance/eval-quiz-conventions.md` |
| DB 接入设计 | `docs/design/design-db-connection.md` |
| API Staging 接入准入（一期 · **计划支持**，暂不开发） | `docs/specs/api-staging-admission-spec.md` |
| Spec 审计与整改 | `inbox/spec-audit-2026-06-21.md`、`inbox/spec-remediation-plan-2026-06-21.md` |

## 10. 当前整改优先级

1. ✅ 2026-06-22 P0-1 Admin Role-First 已闭环；访问权限升级见 `docs/access-control/design-upgrade.md` v1.1.2 与 `docs/access-control/plans/wo-202608-59-access-control-p0.md`。
2. ✅ `access.yaml` 等治理配置写入已补 dryRun、diff、输入校验与审计；`config_change_log` 支持 CSV 导出。真实 `ktx.yaml` 已改为本机 ignored 配置，仓库只提交 `ktx.yaml.example`。
3. ✅ 建立 spec 防漂移检查：route/status、API/spec、skill dependencies、eval schema、access role selector，并新增模板指针字段 fail 规则。
4. 补全当前 API / Model 索引，避免 `webui/docs/03-04` 与实现漂移。
5. ✅ P1 headless gates 已新增：`smoke:p1:context`、`smoke:p1:skills`、`smoke:p1:endpoint`、`smoke:p1:observability`、`e2e:agent`、`e2e:agent:local-hermes`、`smoke:p1:business-eval-full`、`smoke:p1:starrocks-certification`、`smoke:p1:release-readiness`。旧 `smoke:p1:agent-e2e*` 只保留为兼容入口。
6. 真实上线前仍需在具备 runtime/secret 的环境补齐 evidence：KTX/proxy runtime context、endpoint live token、observability live URL、完整 all-profile agent E2E、完整 agent eval、StarRocks live certification。本机 Hermes workhorse/moz 数据库到 agent E2E 已通过 `npm run e2e:agent:local-hermes`，机器证据落在 `inbox/p1-agent-e2e-hermes-moz-evidence.json`，人类报告落在 `inbox/p1-agent-e2e-hermes-moz-report.html`；token 每次运行临时生成且仅 hash 写入 ignored access config。
7. 明确 v1 后续范围：Skill Editor、复杂告警系统、Kubernetes/Helm HA 与自动扩缩容不在本轮 headless 达标范围；Kubernetes / Helm 单副本 baseline 已于 2026-08-03 交付至 `deploy/k8s/helm/lucy/`。若进入产品承诺需另补 spec、UAT 和 release gate。
8. 访问治理 UI 的企业级交付优化已落 spec：列表页 MCP 配置交付、新建 Agent 权限透明度、Token 一次性首秀、详情页 sticky 保存和 Effective Permissions tree，见 `webui/docs/14-agent-admin-enterprise-delivery-spec.md`；执行工单见 `webui/docs/codex/wo-M11-agent-admin-enterprise-delivery.md`。
