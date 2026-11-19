# Fixtures — UAT-SUITE-BEGIN-ZERO-BINDING

本文件为 v0.3-draft 夹具设计；本轮仅复审闭合参与载体、原子事务与恢复证据槽，没有创建或修改数据库、容器卷、Role、Token 或运行配置。未来经测试执行授权后在隔离 Docker 中构造。

## 1. 环境与身份

| 键 | 约定 |
|---|---|
| 拓扑 | 本机 Docker，独立 compose project／内容卷／审计卷，单 Lucy 实例单副本 |
| WebUI／MCP | 执行时记录实际本机 URL、容器名、端口，不将历史 Mac mini 端口或凭据路径当作当前存在 |
| 版本 | 固定改前与候选完整 gitSha、gitDirty、image digest、资源限制、KTX 版本；配置与夹具指纹 |
| 管理身份 | 仅设置夹具和真实普通发布 HTTP 流程使用；请求记录与普通问数身份分离 |
| 问数身份 | A＝普通全量测试表可读；B＝North 行权限；C＝未授 begin 但授 query；D1＝过期 Token，D2＝吊销 Token，D3＝Agent disabled，D4＝global deny；独立构造各分支，不合并声称通过 |
| 宿主条件 | 问数进程无 WebUI Cookie、person 或 attestation，不允许带入管理身份 |
| 凭据 | 执行者使用预先批准的凭据文件路径，进程内读取；跑次只写路径与非敏感身份 ID，不打印认证头 |
| 实际客户端 | RC1＝下述未经修复适配的既有 Codex CLI 0.165.0；真实 Agent 旅程与模块消费者分开记证据 |

## 2. 数据及独立 oracle

使用 `uat_` 前缀的独立测试表与 source：`uat_begin_zero_orders`。schema 与 connectionId 取执行时真实 demo 连接；下列四条测试数据由独立数据库只读 SQL 核对，不用被测 Lucy 自证结果。

| order_id | tenant | amount |
|---|---|---|
| 1 | NORTH | 10 |
| 2 | NORTH | 20 |
| 3 | SOUTH | 30 |
| 4 | SOUTH | 40 |

Manifest 与真实数据库列一致；语义层预置 `order_count=COUNT(DISTINCT order_id)`、`amount_sum=SUM(amount)`，dimension 为 `tenant`。A 的 oracle＝4／100；B 强制 North 后＝2／30。实际行权限需满足既有上游已证明合同；不能关闭门禁假装行隔离成立。

标准普通问句：“查询测试订单数和总金额”。协议 query 固定为：

```json
{"connectionId":"<实际demo连接>","measures":["uat_begin_zero_orders.order_count","uat_begin_zero_orders.amount_sum"]}
```

begin 合法参数 `{"intentSummary":"查询测试订单数和总金额","question":"查询测试订单数和总金额"}`。不用模糊表词，不把字段／歧义错误误判成 begin 问题。

## 3. 参与状态变体

| 夹具 | 内容与历史 | 必须核对 |
|---|---|---|
| I0 | 全新、无绑定目录、无强制历史 | 可信 inactive，不先人工制造空注册表提交 |
| I1 | 空目录 | 与 I0 等价，不触发额外 reindex |
| I2 | 仅内部空状态／凭据目录 | 无业务绑定、无应保留强制快照，内部文件差异不拖入绑定链 |
| I3 | 来自旧候选的可证明 committed 空记录与空摘要表示 | 指纹及历史证据齐备；不能把未知文件手工改成空来凑前置 |
| I4 | 仅未发布 draft（含字段／触发词无效但 YAML 与 `status: draft` 可解析的变体），此前未启用 | draft 不等于生效绑定，未启用用户仍走零路径；status 本身不可解析不属于可信零 |
| A0 | 已正式提交且能证明生效的一条固定口径绑定 | 限制 order_count，amount_sum 为偏离向量；允许与拒绝都验 |
| L0 | 旧 optional preparing：可信零历史，bindingId／boundKey／snapshot 均空 | 实际读回可证明，无强制半状态；可恢复为非强制 |
| L1 | ambiguous preparing：任一强制字段非空、摘要矛盾或历史不完整 | 归 unknown；不 catch-all 清状态 |
| U0 | 曾有强制绑定，但快照／提交证据不完整 | 必须 unknown，不能认证 inactive |
| T0 | 已有 committed A0 旅程后，正式撤销最后一条绑定 | 旧旅程保持快照，新问询走 inactive |
| C1 | 固定 operationId／turnId 的 B 在 record_only 已落库、有效事务未提交时崩溃 | 重启后无提交回执、无新有效指针／轮次；record_only 不当有效 ID；之后真正新 B 可成交 |
| C2 | 固定 operationId／turnId 的 B 在有效事务与提交回执已落库、响应未返回时崩溃 | 重启后按回执恢复同一 active／预算／指针，至多生效一次；缓存重建不新增 query 门禁 |

参与事实以 `active-generation.json` 为代次权威：无凭据且无业务文件／全部为可解析 draft 的兼容零为 generation 0；无凭据但有 published 或状态不可读文件为 unknown；v2 必须有彼此一致的 participation／publishedBindingCount；旧 committed `fileCount=0` 按 legacy inactive；prepared、损坏、字段矛盾或非 ENOENT 读失败均为 unknown。R0／03／07／11 保存脱敏字段与指纹，不能另写一份参与状态凑预期。

## 正式控制入口

| 目的 | 唯一执行约定 | 断言／禁止事项 |
|---|---|---|
| I0–I4 普通内容发布 | `POST /api/semantic-assets/validate` 取得真实 validationId／planDigest，再 `POST /api/semantic-assets/publish`（携带实际契约要求的覆盖确认及幂等字段），等待发布记录终态；变更健康 Wiki／Manifest，不是手动 reindex | 各阶段 N／B／D；不提交空注册表、不删凭据、不补 reindex 修绿 |
| 首次启用 A0 | 独立卷按父合同 D2／D3 的 YAML 作者路径准备 `caliber-bindings/uat_begin_zero.yaml`（status: published），再调用 `POST /api/semantic-assets/reindex`，带实际 pendingDigest | 必须经过 candidate→KTX→registry commit 与本条参与代次同窗，保存 release／attempt／代次；不直接调用 helper 代替 HTTP |
| 最后撤销 T0 | 已建立旧 committed 旅程后，按父合同 O1 的 YAML 作者路径将最后业务绑定降为 draft（另起删除变体），再走同一 `POST /api/semantic-assets/reindex` | 撤销前旧有效、提交后新会话 inactive、旧会话快照保留；必须验真实转换，不仅预先构造 A0 |
| U0／L1 治理恢复 | 使用父合同既有合法恢复入口，执行前冻结准确请求及完整前后证据 | 强制损坏拒绝和恢复后成交都验；不手工清会话冒充修复 |

管理身份只用于这些控制步骤，问数仍用普通 Token。上述手动入口仅供独立有绑定控制及安全转换，不代表普通绑定发布全生命周期已修复。现行入口若违背本条生效／代次承诺记 FAIL；缺实际可控环境或观测才记 BLOCKED。R0 记录上述 HTTP 请求及 YAML 资产指纹；YAML 仅为正式允许的作者内容夹具，不能写内部注册表凭据或 BindingSession。U0 恢复步骤须执行前核对父合同，不能调用未知接口。

## 真实既有客户端矩阵

| ID | 固定对象／取得方式 | 执行与证据 | 当前状态 |
|---|---|---|---|
| RC1 | 本机修复前既有 Codex CLI **0.165.0**，入口 `/opt/homebrew/bin/codex`，解析到 `/opt/homebrew/Caskroom/codex/0.165.0/bin/codex`；从此既有安装取得，不为降级体改客户端 | 在隔离测试工作目录用该版本 `codex exec` 经真实 MCP 连接 Docker 候选；沿用其正常工具处理器，不注入新消费者替代；普通 Token 仅经批准的测试凭据引用装配。记录 CLI／模型／MCP 配置非敏感指纹、提示契约与轨迹 | 2026-11-19 只读 `codex --version` 核对；未启动 MCP／未问数。版本输出成功，同时提示无法创建 PATH aliases；运行就绪性未由此证明 |
| PC1 | 现有／新增协议消费者，处理旧载荷顺序 | 仅 F 模块兼容证据，覆盖 normal／G1 null／G2 与 G5 record_only | 未实现未执行；不能替代 RC1 |

RC1 实际文件 SHA-256：`a45099154d7fb4a5ed8a56f40966a95deb938e508bab23e6985035c709e9a85a`。执行前校验该版本／摘要；若本机自动升级或实际 MCP 启动不可达，先恢复可验证的原版本或复审替换支持对象，不能静默换当前客户端补绿。暂无其他历史客户端的兼容结论。本稿不把预算事故记录里的 alpha 版本冒充本次已取得对象。R 缺真实对象为 BLOCKED，真实对象产品不兼容为 FAIL。

## 统一路径与覆盖矩阵

本节是 Plan／cases 的**单一范围真源**：N＝不 begin；B＝成功新 begin→query；D＝非阻断降级 begin→query（默认 G1，G2／G5 按下表单列）。所有组最终核对数据 oracle，且每个 begin 独立断言。下列矩阵内的组合全部必做，不能从“代表故障”推导删减已列组合。

| 矩阵行 | 状态／操作 | 路径／故障覆盖 | 用例 |
|---|---|---|---|
| M01 | I0–I3 各自初始、首次普通发布后、再次健康 Manifest 发布后；原／新会话 | 每格 N／B／D(G1) | ZB-03 |
| M02 | I4 有效／无效 draft；无绑定普通内容发布前／进行中／终态后 | 每格 N／B／D(G1)；在途已有数据准入如实单列，终态必须成交 | ZB-04 |
| M03 | I0 可选持久化与归属故障 | N 健康对照；G1／G2／G5 各自独立注入 D→query→解除→B | ZB-05 |
| M04 | A／B／C；D1–D4；预算已用、第二问题、重连、内部恢复重放 | N／B／D(G1)；预算局部 G2、整体 G3、归属 G5 另列；权限拒绝后同一合法身份恢复 | ZB-06 |
| M05 | inactive→A0→T0，旧／新会话 | N 对照；生效点交错 B；转换前后 D(G1)；active／unknown 不套 inactive 降级 | ZB-07／09 |
| M06 | I0 审计与任务补偿 | N／B／D(G1／G2／G5)；G4 作为独立日志故障格，解除后恢复 | ZB-08 |
| M07 | I0 无效 id／缺必填；A0／U0／L1；无凭据 published／不可读候选；无关 source map 故障 | 参数真实拒绝→N 成交；有绑定允许／偏离；候选不确定不当零；inactive 本地 begin 与 query 分开判 | ZB-09；F 覆盖全部工具细粒度负控 |
| M08 | 同资源、同状态、预算足够的性能样本 | N／B／D(G1) 各自健康改前／候选对照；G2／G5 功能成本另列、不混样本 | ZB-10 |
| M09 | I0–I3／L0／L1／T0／U0／C1／C2 真实重启 | 可信零重启后 N／B／D(G1)；T0 旧允许／偏离、新会话 N／B；L1／U0 拒绝及治理恢复成交；C1 不生效、C2 按回执至多生效一次 | ZB-11 |
| M10 | 未修改 RC1 的真实 Agent | N／B／D(G1／G2／G5) 分别取得最终答案；PC1 单独记 F | ZB-12 |

每个格自建前置、自行解除故障并读回健康状态；不依赖前例遗留。可复用故障方法但不复用未确认状态。用例失败仍先清理并保留必要证据；不能依靠重启修绿，真实重启仅 ZB-11。

## 真实局部故障与预算观察

G1–G6 语义以 Spec §3.5 为准。所有故障都必须实际触达被测持久化／逻辑提交：G1 只坏记录阶段可选 turn；G2 在 record_only 已存在后打断有效事务的预算写但保留原预算查询与消费；G5 打断同一有效事务的有效归属／握手关联且预算候选不可先发布；G3 为预算存储整体不可用；G4 为普通调用日志／trace 写失败，不推定所有安全合同同一拒绝。有效事务任一语句失败必须整体回滚，只剩记录阶段的 record_only；提交结果不确定先按 operationId 读 `question_begin_commit`，不得猜成成功或失败。不同逻辑依赖可能同库，若无法隔离注入，按 BLOCKED 报告控制缺口，不用 vi.mock 返回体、全盘写满或关闭预算代替。

F 验全部故障格及每个提交边界的恢复；R 按上述矩阵验组合旅程。G6 inactive 的 BindingSession 强制提交次数必须为 0；active 的拒绝／恢复映射父合同，不重复整套验收。每格保存实际持久化、round／window／calls／busyMs／续查、operationId、record_only／active、有效 turn 指针、提交回执和强制快照前后值。N／重连／D 不新开轮次，但随 query 正常记账；成功新 B 依 D6 切轮次并归档旧耗时。

不新增客户端持久重放协议：外部两次 begin 即使问句或 JSON-RPC id 相同仍为两个独立调用，成功各按 D6。内部同一已受理操作的提交恢复用同一服务端提交标识，只生效一次。分别测试，不能将独立外部调用的正常预算切换判为回归。

## 性能采样与清理

固定资源／数据／版本／Token／模型／预算指纹，改前基线与候选交错成对运行；**每组 N／B／D(G1)，每轮各 100 个独立问题，共三轮**。每组每轮先预热 10 个不入统计的独立问题；随机化种子及交错表预先登记。G2／G5 不混进 D(G1) 样本，必要观测单列。

各组各轮分别按 nearest-rank 算 p95＝排序后的第 ceil(0.95×100) 项，不合并三轮掩盖慢轮。三轮每轮均要求：候选 p95≤该组成对基线 p95＋预先冻结绝对容差 A_ms，且≤基线 p95×(1＋预先冻结相对容差 R)。A_ms／R 和允许资源噪声处理在采样前签定；当前数值待定，不得 PASS。失败和超时保留分母并单列成功率，不能只拿成功样本算绿；合法组任何新增 begin 拒绝即硬判失败。

改前 D 若无法得到合法事实答案，记录改前证伪，不以错误的短耗时作时延基线；D 时延对照使用同候选无故障 B 的成对样本并明确该口径，仍固定双容差。硬判据：N 默认额外工具调用 0、begin 所致增量拒绝 0、inactive 绑定全库构建 0（F 实际调用计数）。主动 B 的一次网络调用单列，不冒称默认额外调用。

每个问题隔离自然预算作用域或记录真实续算，提前保证额度足够，不关闭预算测绿；采样后不排除已发生的预算错误。如夹具错误耗尽预算，完整保留失败轮并修夹具重新登记，不删样本。清理独立 uat_ 数据／Role／Token／卷，先存正式脱敏证据；禁止共享资产操作及 secrets 输出。
