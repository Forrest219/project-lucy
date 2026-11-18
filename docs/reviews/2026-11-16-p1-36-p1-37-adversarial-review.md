# P1-36／P1-37 Spec 对抗性审阅记录（三轮，GPT 5.6 子代理，非 Codex CLI）

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-36／P1-37 Spec 对抗性审阅记录（R1–R3） |
| 文档类型 | Review |
| 版本 | v1.1 |
| 撰写日期 | 2026-11-17 |
| 撰写人 | Claude（Cursor Agent）；评审执行：GPT 5.6 子代理（只读） |
| 委托人 | xingchen |
| 基于材料 | [P1-36 Spec](../specs/lucy-20261116-trace-span-ledger-spec.md)／[Plan](../plans/lucy-20261116-trace-span-ledger-plan.md)／[UAT 套件](../qa/uat/suites/trace-span-ledger/suite.md)；[P1-37 Spec](../specs/lucy-20261116-mcp-ux-resilience-spec.md)／[Plan](../plans/lucy-20261116-mcp-ux-resilience-plan.md)／[UAT 套件](../qa/uat/suites/mcp-ux-resilience/suite.md)；`webui/server/proxy/*.ts` 等当前代码 |
| 适用范围 | 记录 P1-36／P1-37 在 v0.1→v0.4-draft 期间三轮过程评审的发现、处置与遗留；供委托人决定终稿确权路径与开放项 |
| 输出位置 | `docs/reviews/2026-11-16-p1-36-p1-37-adversarial-review.md` |

## 0. 性质与结论（先读这里）

- **非 Codex CLI 评审。** 委托人授权用 Codex CLI 做 2～3 轮对抗性审阅；本机 Codex 无法连通 chatgpt.com，委托人选择改用另一 Cursor 模型（GPT 5.6）子代理。因此本记录只是**过程评审**：**评审本身 ≠ 终稿确权；≠ 开发授权；≠ UAT PASS；≠ 可上线**。后续（2026-11-17）委托人明示「不需要 codex cli」并「授权你修正后定稿」，终稿确权由此路径取得，见 §8。
- **三轮均为 BLOCK，R3 的修订未再复审。** 发现数逐轮下降，但 R3 仍各有 2～3 个 blocker；v0.4-draft 是对 R3 的修订，**没有第 4 轮证明其闭合**。
- **v0.4-draft 不应被读作「已通过评审」。** 它只表示作者已处理完 R3 全部发现（A 类，文档层缺陷）。B 类（需委托人决策的开放项）已在定稿时闭合，见 §4 与 §8；**R3 修订仍未经第 4 轮复审**，这是定稿时接受的已知缺口。
- 评审是对抗式的：目标是证伪而非确认。评审员发现的代码事实锚点（`mcp-proxy.ts`、`audit.ts`、`request-client-meta.ts` 等）由评审员读取当时代码核对；`mcp-proxy.ts` 有其他工作流的未提交改动，行号会漂移，Spec 以符号锚定。
- 客户数字（23,687 条流水等）全程为**不可核（仓外材料）**，没有被用作验收阈值。

## 1. 轮次总览

| 轮次 | 对象版本 | P1-36 发现 | P1-37 发现 | 判定 | 修订后版本 |
|---|---|---|---|---|---|
| R1 | v0.1-draft | 19（blocker 5／major 13／minor 1） | 20（blocker 5／major 11／minor 4） | BLOCK／BLOCK | v0.2-draft |
| R2 | v0.2-draft | 15（blocker 5／major 8／minor 2） | 14（blocker 2／major 10／minor 2） | BLOCK／BLOCK | v0.3-draft |
| R3（终轮） | v0.3-draft | 8（blocker 2／major 5／minor 1） | 9（blocker 3／major 6） | BLOCK／BLOCK | v0.4-draft（未复审） |

原始评审输出（保留原编号与证据，供追溯）：

| 轮次 | P1-36 | P1-37 |
|---|---|---|
| R1 | `inbox/2026-11-16-p1-36-review-r1.txt` | `inbox/2026-11-16-p1-37-review-r1.txt` |
| R2 | `inbox/2026-11-17-p1-36-review-r2.txt` | `inbox/2026-11-17-p1-37-review-r2.txt` |
| R3 | `inbox/2026-11-17-p1-36-review-r3.txt` | `inbox/2026-11-17-p1-37-review-r3.txt` |

> `inbox/` 是临时目录，可被清理；需要长期留存时请把原始输出另存。

## 2. 发现主题与处置（R1／R2 概览）

R1／R2 逐条原文见上表原始文件，这里只按主题归并并写处置结果。

### 2.1 P1-36（trace 级流水）

| 主题 | 代表发现 | 处置（现状） |
|---|---|---|
| 承诺边界不实 | R1-01、R1-05、R2-02：「每条请求可追溯」与审计响应后异步写、故障丢行的现状矛盾 | 承诺收窄为**已落库行**的 span 扩展与原子性；入口完整性归 S02，漏记由 UAT-TRC-01 用独立发送清单检出；总账出口 R3-05 同步（v0.4） |
| UAT 无法打假 | R1-03、R1-07、R2-03、R2-07、R2-08、R3-04 | 发送清单关联键＝`User-Agent`＋唯一 JSON-RPC id；结构检查补连通、无环、序号连续；每类请求登记必有 span 最小集合；C9 时间对账改为 1 ms 固定容差＋墙钟锚定＋整体平移反例 |
| 数据模型与迁移 | R1-08、R1-13、R2-04、R2-10、R2-12、R3-06、R3-07 | FK `CASCADE`＋`UNIQUE(trace_id,seq)`＋列 `CHECK`（UTF-8 字节、`json_valid`）；`PRAGMA foreign_keys` 开启前盘点子表与孤儿扫描，由 admin 状态接口读服务连接值；`ledger_seq` 经 JOIN 所属行；导出 pending＝0 |
| 理由码口径 | R2-09、R3-02 | §5.4 冻结 v1：17 个粗粒度码＋全函数映射，原始 `decision_reason` 留旧列与 `reason_param`，DB `CHECK` |
| 脱敏与来源 | R1-14、R1-15、R2-06、R2-14、R3-01、R3-03 | 占位符替换不删空、范围限内网；新增 `ip_source`／`trusted_source` 两列（`trusted_source` 现状未落账）；分类同时检查 XFF 与 `X-Real-IP`；`sl_query` 夹具改为条件项，基线无法真实触发则降 vitest |
| 夹具与必做套件 | R2-05 | 夹具就绪门禁（NOT READY）；`hdfs://` 脱敏只走 vitest（O8） |
| 事实与治理 | R1-17、R1-18、R1-19、R2-13、R2-15 | §3 改为按分支的现状矩阵；客户数字全标不可核；状态句镜像统一 |

### 2.2 P1-37（MCP 体验韧性）

| 主题 | 代表发现 | 处置（现状） |
|---|---|---|
| 持续会话失效夹具造不出 | R1-01、R2-02 | **未闭合，转为委托人决策 O7**；在此之前 UAT-MCPX-09／10 BLOCKED，不用 mock 冒充 |
| 缓存键与权限 | R1-03、R2-04、R2-07、R3-03、R3-04 | 键＝有效权限摘要＋`policy_version`＋skills 哈希；摘要预先维护；撤权后不发旧代内容（响应发送前重验）；skills 失效＝写入事件＋文件级后台复核（≤ 30 s） |
| 会话恢复与短路 | R1-04、R2-01、R2-05、R2-06、R2-08、R3-01、R3-02、R3-05、R3-09 | 恢复失败四类各计 1 次；guard 键冻结；内部恢复握手与客户端 `initialize` 两套状态机；open 期 `initialize` 受 T=5 s 频率上限（60 s 内总上游调用 ≤ 44）；任一健康响应清零；短路不刷新窗口、60 s 自动半开 |
| 拒绝路径 | R1-06、R1-08、R2-03、R2-14、R3-07、R3-08 | 未知工具分支先于入参校验；清单＝该身份真实 `tools/list` 集合；入参前移只复制 KTX 必然拒绝的形状；`rejection_fingerprint` 用 canonical 入参的 **HMAC**（服务端密钥不入库） |
| UAT 可执行性 | R1-09、R1-12、R2-11、R2-12、R3-06 | 夹具就绪门禁；≥ 300 Source 大目录；全局 LRU 需 ≥ 17 个测试身份（造不出则 BLOCKED，不降级） |
| 范围与治理 | R1-10、R1-11、R1-13、R1-15、R1-19、R2-09、R2-10 | M1–M6 入出口、M7–M9 伴生；承诺统一收窄为上游会话失效；状态句镜像统一 |

## 3. R3（终轮）逐条状态

状态：**已改**＝v0.4-draft 已落到 Spec／Plan／cases／fixtures；**待复审**＝尚无第 4 轮确认。

### 3.1 P1-36

| ID | 级别 | 发现 | 处置 | 状态 |
|---|---|---|---|---|
| R3-01 | blocker | `sl_query` 脱敏夹具打不到上游（缺 `measures` 被 `validateLucyToolArgs()` 本地拦截） | 改为条件项：基线先用合法入参证明上游真返回含 `sl_query` 的错误；证明不了则降为 vitest，写进跑次，不 mock | 已改，待复审 |
| R3-02 | blocker | 理由码注册表未冻结，要实现授权后才生成 | §5.4 v1 冻结 17 码＋映射规则；DB `CHECK`；UAT 固定场景表命中 `unclassified` 即 FAIL | 已改，待复审 |
| R3-03 | major | 伪造 `X-Real-IP` 会被标 `customer`；UAT 只攻 XFF | D8 要求分类同查两个头；UAT 增反例 B；伪造头影响 ACL／限流地址属**既有风险，只记录、不在本条修** | 已改，待复审 |
| R3-04 | major | 时间对账可整体平移而全绿 | C9c 墙钟锚定；`v2p5-2` 行 `ts` 取根终点同读数；UAT 增平移一年反例 | 已改，待复审 |
| R3-05 | major | 总账出口仍写「每条请求」 | 改为已落库行，入口完整性归 S02 | 已改 |
| R3-06 | major | 另开连接核对 `PRAGMA foreign_keys` 无效 | admin 审计状态接口新增只读 `sqlite.foreign_keys`，UAT 读该值 | 已改，待复审 |
| R3-07 | major | `length(attrs_json)` 是字符数不是字节数 | `CHECK` 改 `length(CAST(… AS BLOB))`＋`json_valid`；UAT 加多字节反例 | 已改，待复审 |
| R3-08 | minor | O1 仍写 C9 容差 20 ms | O1 只决策 SC-09 的 5 ms／3 ms | 已改 |

### 3.2 P1-37

| ID | 级别 | 发现 | 处置 | 状态 |
|---|---|---|---|---|
| R3-01 | blocker | 客户端 `initialize` 的「握手成功」要等 notification，但 notification 是之后的独立请求，无法同步判断 | 拆两套状态机；客户端路径只登记 pending reset，notification 被上游 2xx 接受后才清零；MCPX-10 增缺失／被拒 notification 断言 | 已改，待复审 |
| R3-02 | blocker | `initialize` 永不短路，可无限绕过 4N 上界 | open 期每 T=5 s 至多 1 次上游尝试；60 s 总上游调用 ≤ 44；MCPX-09 增 initialize 洪泛 | 已改，待复审 |
| R3-03 | blocker | 撤权 commit 后仍可能返回旧 instructions，泄露已撤回名称 | 响应发送前重验 generation，变化则重建（至多 1 次）；收窄与放宽同样处理；MCPX-02(a) 改为撤权保密断言 | 已改，待复审 |
| R3-04 | major | 目录 mtime 对 skills 原地改写无效；陈旧窗口未落 Plan | 写入事件换代＋文件级后台复核（≤ 30 s，Plan 冻结）；MCPX-02 增三类失效与外部改文件窗口实测 | 已改，待复审 |
| R3-05 | major | 伪代码仍用易变 `session` 操作 guard | 统一 `gk = guard_key(req)`，进入时固定；加轮换上游 session 后计数不重置的断言 | 已改 |
| R3-06 | major | 全局 1024 LRU 在只有 A／B 两个身份的夹具下不可达 | 夹具增 ≥ 17 身份脚本；造不出则 BLOCKED，不降级推算 | 已改，待复审 |
| R3-07 | major | 无密钥 SHA-256 指纹可被离线字典反推 | 改 HMAC（服务端密钥不入库不导出）、版本前缀、M3 同版本内比较；UAT 加「不等于公开 SHA」负向断言 | 已改，待复审 |
| R3-08 | major | 「清单＝allowedToolNames」与「清单＝真实 tools/list」互斥 | 冻结为同身份同版本真实 `tools/list` 名称集合（`allowedToolNames` 仅是上界） | 已改，待复审 |
| R3-09 | major | 「连续失败」实际跨正常成功累计，误伤间歇故障下的合法用户 | 任一健康上游响应清零；MCPX-09 增「失败→成功→失败」序列 | 已改，待复审 |

## 4. 开放项（B 类，不是文档缺陷）及定稿闭合结果

| 条 | 编号 | 议题 | 影响（定稿前） | 定稿结果（2026-11-17） |
|---|---|---|---|---|
| P1-37 | O7 | 持续会话失效夹具：(a) 取得 O6 证据后复现真实成因；(b) 书面授权仅 demo 的故障注入钩子；(c) 把 SC-09／10 移出出口 | 阻塞终稿确权；UAT-MCPX-09／10 BLOCKED | **取 (c)**：U3 拆 U3a（入出口）与 U3b（持续失效短路，设计冻结、不入出口）；SC-09／10 与 MCPX-09／10 降为伴生，不阻塞收口；可由委托人撤销 |
| P1-37 | O4／O6 | 客户运行版本；KTX 会话失效响应形态 | 开工前须先答 | O4 不阻塞（Docker 对齐，客户版本归发布取证）；O6 转 Plan 步骤 0 取证，阻塞 U3a 实现 |
| P1-36 | O2 | 是否接受「审计响应后异步写」语义与收窄后的承诺（入口完整性归 S02） | 决定闭口层级 | 接受 |
| P1-36 | O6 | span 表保留期与容量预算（当前容量只是假设） | 未冻结不得终稿确权；UAT-TRC-11 的判据 | **冻结（建议值，实测校准）**：span 与父行同寿命、不新增清理；每 trace span 表＋索引平均 ≤ 8 KB，平均 span 数协议 ≤ 6／业务 ≤ 14；超限回到委托人 |
| P1-36 | O7 | `ledger_seq` 是否升级为入口因果序号 | 影响导出重导一致性强度 | 不改；以导出前审计 pending＝0 规避 |
| P1-36 | O8 | `hdfs://` 脱敏（及基线无法真实触发的 `sl_query`）只靠 vitest、不进必做 UAT 是否接受 | 否则需先提供 hive／hdfs 实验环境 | 接受 |

## 5. 评审员已确认无问题的点（R3 复核）

- P1-36：`spans.csv.ledger_seq` 经 JOIN 取得；主状态仍为八桶，拒绝写作 `primary_status=denied`＋`error_category=policy_denied`；协议／wiki 证据现状已改为分支矩阵；客户数字全标不可核；功能合同未写入防篡改、外送、客户现场或整库 Agent 旅程。
- P1-37：§3 代码事实锚点基本准确；F1–F8 均标不可核；P1-36 已登记 `session_lost`／`session_shortcircuit`；两条的状态行、总账、INDEX、e2e-ledger 均保持 NOT RUN，没有用 CR 或单测冒充 UAT。

## 6. 门禁现状（2026-11-17 定稿后）

| 项 | 现状 |
|---|---|
| 过程评审 | 三轮已做，均 BLOCK；R3 修订**未复审**（已知缺口，委托人定稿时接受） |
| 终稿确权 | **已获得**：委托人明示免 Codex 终审、授权代理修正后定稿（见 §8）；Spec 现为 v1.0 |
| 开发授权 | **未获得**；未授权不改运行代码 |
| 测试台 | 两个套件仍 `NOT RUN`；夹具就绪门禁未过（脚本为 Plan 步骤 0 交付物，未交付）；P1-37 MCPX-09／10 为 U3b 伴生，BLOCKED 但不阻塞本条收口 |
| 总账 | `docs/governance/lucy-20261107-lucy-0-30-feature-inventory-pool.md` v1.11 已记；状态句在 Spec、Plan、总账、需求池、e2e-ledger、两个 README 一致 |

## 7. 下一步

1. 委托人另发**开发授权**后，才可进入 Plan 步骤 0（夹具与取证）；P1-37 先做 O6 取证（真实重启 KTX 取失效响应形态），P1-36 先交付夹具脚本与改前基线。
2. 若要启动 P1-37 U3b：先闭合 O7 夹具（取证后复现真实成因，或书面授权 demo 故障注入入口），并另获开发授权。
3. 若对 §8 的任一定稿决策有异议，可撤销：改 Spec §9 对应行与 changelog 即可，不涉及代码。

## 8. 定稿记录

- **授权**：委托人 2026-11-17 明示「不需要 codex cli 了」「授权你修正后定稿」。按仓库规则，终稿确权可由委托人明示取得；**定稿 ≠ 开发授权**，开发授权须另发。
- **代理在授权范围内做的决策**（均写入 Spec §9 与 changelog，可撤销）：
  1. P1-37 O7＝取 (c)：U3b（持续失效短路）整体移出出口，不随本条实现。理由：U3b 是本条唯一新增限制，而其持续失效场景在 demo 无法全真构造；CONVENTIONS 第 3 条不允许用替身凑绿，也不应在不可验证的前提下上线新约束。代价：客户流水里"同会话反复 404"的重试风暴本条不限流，只通过 U3a 扩大恢复范围缓解（每请求至多 1 次恢复＋1 次重试，现状上界不变）。
  2. P1-36 O6＝冻结为每 trace 平均 ≤ 8 KB、span 与父行同寿命、不新增清理。该数字是建议值，未经实测；超限回到委托人，不在本条擅自加清理。
  3. 其余 O 项取 Spec 里的建议值（O1／O2／O4／O5／O7／O8）；客户版本核对（O5／P1-37 O4）归发布取证。
- **已知缺口**：R3 修订（P1-36 8 条、P1-37 9 条）未经第 4 轮复审；P1-37 的 U3b 设计虽冻结，其 R3 相关规则（initialize 频率上限、pending reset 等）也未被任何用例验证过。
