# Fixtures — UAT-SUITE-BEGIN-ZERO-BINDING

本文件为 v0.5-draft 夹具设计，对齐 Spec／Plan v0.7-draft：inactive 隐藏 begin，当前只验 N＋隐藏面；预算／ACL 保持现状。本轮仅文档，没有创建或修改数据库、容器卷、Role、Token 或运行配置。未来经测试执行授权后在隔离 Docker 中构造。

## 1. 环境与身份

| 键 | 约定 |
|---|---|
| 拓扑 | 本机 Docker，独立 compose project／内容卷／审计卷，单 Lucy 实例单副本 |
| WebUI／MCP | 执行时记录实际本机 URL、容器名、端口，不把历史端口或凭据路径当作当前存在 |
| 版本 | 固定改前与候选完整 gitSha、gitDirty、image digest、资源限制、KTX 版本；配置与夹具指纹 |
| 管理身份 | 仅用于夹具、普通发布 HTTP 与正式 reindex 控制；与普通问数身份分离 |
| 问数身份 | A＝普通全量测试表可读；B＝North 行权限；C＝未授 begin 但授 query；D1＝过期 Token，D2＝吊销 Token，D3＝Agent disabled，D4＝global deny；独立构造 |
| 宿主条件 | 问数进程无 WebUI Cookie、person 或 attestation，不带入管理身份 |
| 凭据 | 使用预先批准的凭据文件路径，进程内读取；跑次只写路径与非敏感身份 ID |
| 实际客户端 | RC1＝下述未经修复适配的既有 Codex CLI 0.165.0；真实 Agent 与协议消费者分开记证据 |

## 2. 数据及独立 oracle

使用 `uat_` 前缀的独立测试表与 source：`uat_begin_zero_orders`。schema 与 connectionId 取执行时真实 demo 连接；四条数据由独立数据库只读 SQL 核对，不用被测 Lucy 自证结果。

| order_id | tenant | amount |
|---|---|---|
| 1 | NORTH | 10 |
| 2 | NORTH | 20 |
| 3 | SOUTH | 30 |
| 4 | SOUTH | 40 |

Manifest 与真实数据库列一致；语义层预置 `order_count=COUNT(DISTINCT order_id)`、`amount_sum=SUM(amount)`，dimension 为 tenant。A 的 oracle＝4／100；B 强制 North 后＝2／30。不得关闭行权限或预算假装成立。

标准普通问句：“查询测试订单数和总金额”。协议 query 固定为：

```json
{"connectionId":"<实际demo连接>","measures":["uat_begin_zero_orders.order_count","uat_begin_zero_orders.amount_sum"]}
```

隐藏期强制 call 可复用历史合法参数 `{"intentSummary":"查询测试订单数和总金额","question":"查询测试订单数和总金额"}`；缺 intentSummary／不存在 bindingId 也必须在 inactive 下得到同一 D2，不能进入业务激活。

## 3. 参与状态变体

| 夹具 | 内容与历史 | 必须核对 |
|---|---|---|
| I0 | 全新、无绑定目录、无强制历史 | 可信 inactive，不先制造空注册表提交 |
| I1 | 空目录 | 与 I0 等价，不触发 reindex |
| I2 | 仅内部空状态／凭据目录 | 无业务绑定、无应保留强制快照 |
| I3 | 旧候选的可证明 committed 空记录与空摘要表示 | 旧 committed `fileCount=0` 兼容 inactive；不补写或 reindex |
| I4 | 仅未发布 draft，含字段／触发词无效但 YAML 与 `status: draft` 可解析的变体 | draft 不生效；status 不可解析不属于可信零 |
| A0 | 已正式提交且能证明生效的一条固定口径绑定 | 限制 order_count，amount_sum 为偏离向量；允许与拒绝都验 |
| L0 | 旧 optional preparing：可信零历史，当前 bindingId／boundKey／snapshot 全空，previousCommitted 不存在或为 no-hit | 可按非强制处理；不开预算轮次、不清其他状态 |
| L1 | ambiguous preparing：任一强制字段非空、previousCommitted 为 bound、摘要矛盾或历史不完整 | 归 unknown；不 catch-all 清状态 |
| U0 | 曾有强制绑定，但快照／提交证据不完整 | 必须 unknown，不能认证 inactive |
| T0 | 已有 committed A0 旅程后正式撤销最后一条绑定 | 旧旅程保持快照，新问询 N＋隐藏 |

参与证据只复用现有 `active-generation.json`、当前注册表 bindings 与 BindingSession，不新增 v2 字段或第二份计数。无凭据且无业务文件／全部可解析 draft 才是兼容零；无凭据但有 published 或状态不可读文件为 unknown；prepared、损坏、字段矛盾或非 ENOENT 读失败均为 unknown。R0／03／07／11 保存必要脱敏字段与指纹。

## 正式控制入口

| 目的 | 唯一执行约定 | 断言／禁止事项 |
|---|---|---|
| I0–I4 普通内容发布 | `POST /api/semantic-assets/validate` 取得真实 validationId／planDigest，再 `POST /api/semantic-assets/publish`（携带实际契约字段），等待终态；变更健康 Wiki／Manifest | 各阶段 N＋隐藏；不提交空注册表、不删凭据、不补 reindex 修绿 |
| 首次启用 A0 | 独立卷按父合同准备 `caliber-bindings/uat_begin_zero.yaml`（status: published），再 `POST /api/semantic-assets/reindex`，带实际 pendingDigest | 必须经真实 candidate→KTX→registry commit，保存 release／attempt／现有代次；不直接调用 helper 代替 HTTP |
| 最后撤销 T0 | 建立旧 committed 旅程后，将最后业务绑定降 draft（另起删除变体），再走同一 reindex | 撤销后新会话 N＋隐藏，旧会话快照保留；必须验真实转换 |
| U0／L1 治理恢复 | 使用父合同既有合法恢复入口，执行前冻结准确请求及前后证据 | 拒绝与恢复后成交都验；不手工清会话冒充修复 |

管理身份只用于控制步骤，问数仍用普通 Token。上述入口不代表普通绑定发布全生命周期已修复。入口自身违背本条承诺记 FAIL；缺实际环境或观测才记 BLOCKED。YAML 仅为允许的作者内容夹具，不能写内部注册表凭据或 BindingSession。

## 真实既有客户端矩阵

| ID | 固定对象／取得方式 | 执行与证据 | 当前状态 |
|---|---|---|---|
| RC1 | 本机修复前既有 Codex CLI **0.165.0**，入口 `/opt/homebrew/bin/codex`，解析到 `/opt/homebrew/Caskroom/codex/0.165.0/bin/codex`；不为本修复改客户端 | 在隔离测试工作目录用该版本 `codex exec` 经真实 MCP 连接 Docker 候选；普通 Token 仅经批准凭据引用装配。记录 CLI／模型／MCP 非敏感指纹、提示和轨迹 | 2026-11-19 只读核对版本；未启动 MCP／未问数。版本输出时的 PATH aliases 提示不等于运行就绪 |
| PC1 | 协议消费者 | 仅 F 的 D2 载荷证据；不替代 RC1 | 未实现未执行 |

RC1 文件 SHA-256：`a45099154d7fb4a5ed8a56f40966a95deb938e508bab23e6985035c709e9a85a`。执行前校验版本／摘要；自动升级或 MCP 不可达时先恢复可验证原版本或复审替换对象，不静默换当前客户端。R 缺真实对象为 BLOCKED，真实对象产品不兼容为 FAIL。

## 统一路径与覆盖矩阵

本节是 Plan／cases 的唯一范围真源。N＝catalog／source→query；隐藏面＝list／initialize／角色指导无 begin；D2＝合法身份在 inactive 下强制 call 得到 begin_not_available 且副作用 0。所有矩阵组合全部必做，不含启用后 B／D。

| 矩阵行 | 状态／操作 | 当前覆盖 | 用例 |
|---|---|---|---|
| M01 | I0–I3 初始、首次普通发布后、再次健康 Manifest 发布后；原／新会话 | 每格 N＋隐藏＋D2→query | ZB-03 |
| M02 | I4 有效／无效 draft；无绑定普通发布前／中／后 | 每格 N＋隐藏＋D2；在途准入如实单列，终态成交 | ZB-04 |
| M03 | 预算已用、重连、重复强制 call、预算终止与续查 | N／重连／D2 不切换预算；continue 与续查保持 | ZB-05 |
| M04 | A／B／C、D1–D4、G3 | N＋隐藏；既有授权拒绝优先；G3 不关预算回避 | ZB-06 |
| M05 | inactive→A0→T0，旧／新会话 | A0 允许／偏离；撤销后 N＋隐藏；旧快照保持 | ZB-07／09 |
| M06 | I0 审计与画像任务 | N＋D2；显式上报＝0；推断／缺失／真实成败复算 | ZB-08 |
| M07 | 无凭据 published／不可读候选、A0／U0／L1、source map 故障 | unknown 不当零；D2 后其他工具权限保持 | ZB-09；F 覆盖细粒度负控 |
| M08 | 同资源 N 性能样本 | 改前／候选仅 N 成对采样；D2 调用计数另由 F 证明 | ZB-10 |
| M09 | I0–I4／L0／L1／T0／U0 真实重启 | 可信零 N＋隐藏；T0 旧允许／偏离、新 N；unknown 恢复成交 | ZB-11 |
| M10 | 未修改 RC1 | N＋隐藏成交；幻觉 call 得 D2 后完成答案；PC1 单独记 F | ZB-12 |

每格自建前置并清理，不依赖前例未知状态。失败仍先清理并保存证据；不能依靠重启修绿，真实重启仅 ZB-11。

## 预算、权限与故障观察

N／重连／D2 不新开轮次、不清零 calls／busyMs／续查；合法 query 正常消费。每格保存 round／window／calls／busyMs／续查、有效 turn 和强制快照前后值。continue 的工具可见性、指导和既有续查合同不变，禁止原样使用会联合隐藏 begin／continue 的 `LUCY_ENABLE_QUESTION_TOOL=false`。

D2 必须实际到达 Proxy 的隐藏分支，且在 ID 生成、业务参数处理、turn／预算／BindingSession 写入、注册表加载／提交之前返回。用真实前后状态和调用计数证明副作用 0，不用 mock 返回体代替协议调用。

G3 只注入真实预算存储整体不可用；若 N 基线也因此拒绝，保留 question_budget_unavailable，不能归类为 begin 增量阻断或关闭预算修绿。特殊工具既有安全拒绝不因隐藏改变。

## 性能采样与清理

固定资源／数据／版本／Token／模型／预算指纹，改前与候选仅对 N 交错成对运行；**每轮 100 个独立问题，共三轮**。每轮先预热 10 个独立问题且不入统计；随机种子及交错表预先登记。

每轮按 nearest-rank 算 p95＝排序后的第 ceil(0.95×100) 项，不合并三轮。每轮均要求：候选 p95≤成对基线 p95＋预先冻结绝对容差 A_ms，且≤基线 p95×(1＋预先冻结相对容差 R)。A_ms／R 与资源噪声处理在采样前签定；当前数值待定，不得 PASS。失败和超时保留分母并单列成功率。

硬判据：N 的 begin 调用数 0；D2 的注册表加载／提交数 0（F 实际计数）。预期 D2 不纳入 N 的增量拒绝。每个问题隔离自然预算作用域或记录真实续算，提前保证额度足够；夹具错误耗尽预算时保留失败轮并重新登记，不删样本。清理独立 uat_ 数据／Role／Token／卷，先存正式脱敏证据；禁止共享资产操作及 secrets 输出。
