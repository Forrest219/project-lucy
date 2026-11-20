# Agent 名册摘要夹具、规模与预算

版本：v0.2-draft；2026-11-20。当前仅设计，未造数、未冻结实际候选基线。本文件是本套件数据与预算的唯一正文；Spec 规定的 byte／API／页面目标在此细化，修改须同步 Spec、具名记录，不追结果放宽。

## 1. 已知事实与明确未知

| 维度 | 109 实测 / 页面观测 | 证据边界 |
|---|---|---|
| Agent／角色 | 71 Agent；53 Role 含 47 正式／6 参考模板 | 2026-11-20 探查；不是当前容器数据 |
| 实际权限展开 | 总计 13,815 条 capability | 来自完整 Agent API；不能用 Role 引用数代替 |
| 完整权限字节 | 4,740,771 B | 各 Agent effectivePermissions 紧凑 UTF-8 JSON 重编码和；完整 body 4,833,709 B |
| 单角色宽度 | 页面至少有一个角色 207 source／9 conn | 不是全局 Manifest／启用表总数；单 Agent 最大 capability 数未知 |
| 未知 | 每 Agent capability／source／谓词分布、全局来源总数、Token 总数、access_log 行数、现场 CPU／磁盘 | 禁止默认等于本地 fixture，禁止宣称本夹具精确复刻现场 |

本套件只主张保留**已知总展开规模下限**，不主张已经还原现场分布或 CPU／I/O 成本。必须同时运行下述 BAL／SKEW 两种合成权限分布；仅满足总数／字节的夹具不够。后续如获得经授权脱敏的逐人分布，须先在候选 B 测量前上调／细化 fixture，不能在看到收益后挑选容易的分布。

## 2. 数据档（实际编译后才算达标）

| 维度 | B109 | W2 | W5 | 来源 |
|---|---:|---:|---:|---|
| Agent 数 | 71 | 142 | 355 | B109 对齐已知现场；倍率档为设计 |
| 正式 Role 数 | 47 | 94 | 235 | 不把参考模板计入正式分母；参考模板另记实际数 |
| 连接数下限 | 9 | 18 | 45 | B109 保留已知角色的 9 连接宽度，倍率为设计 |
| Manifest 来源下限 | 263 | 526 | 1315 | 借用 RACS 既有历史下限设计；不是 109 全局实测 |
| 已启用来源下限 | 259 | 518 | 1295 | 同上；必须至少一个正式角色覆盖 ≥207 来源、≥9 连接 |
| 实际 capability 总数下限 | **13815** | **27630** | **69075** | 核心门槛；真实编译结果求和，不允许直接插 DTO |
| 完整权限紧凑 JSON 字节下限 | **4740771** | **9481542** | **23703855** | 同样编码与投影求和；保证保留对象展开负载 |
| 每 Agent 配置凭据 | 3 | 3 | 3 | 合成设计；总计 213／426／1065，不冒称现场值 |
| 最近 30 天 access_log 下限 | 200000 | 400000 | 1000000 | 复用 RACS 设计下限；不是现场行数 |
| access_log 全历史下限 | 1000000 | 2000000 | 5000000 | 含窗口内与窗口外；防小空库假快 |

### 2.1 两种分布与倍率复制（必做，不是现场分布）

每个 71 Agent 的基准副本均为启用、引用有效 Role、成功编译的合法对象；权限编译失败不计入规模。正式 Role 固定 47 个，至少 30 个被 Agent 实际引用。两种分布都含共享子组（至少 36 Agent 复用预定公共 Role）和分散子组（至少 20 个不同正式 Role 被引用），每人最多 3 个 Role，不能用全体同一个廉价模板覆盖全部测试。

| 约束（每个基准副本） | BAL：均衡形态 | SKEW：偏斜形态 |
|---|---|---|
| 实际成功 capability 总数与完整权限字节 | 均满足 §2 的 B109 下限 | 同左 |
| 每人宽度 | 至少 57 Agent 各 ≥150 capability；至少 15 Agent 各 ≥200 | 至少 15 Agent 各 ≥200；其余保留预定合法非空授权 |
| 最宽单人 | ≥2000 capability，且不超过副本 capability 总数的 25% | 单人占副本 capability 总数的 25%–50% |
| 跨来源／连接与行限制 | 至少一个合法 Agent 经所引用 Role 覆盖 ≥207 source／≥9 connection；至少 8 Agent 具有真实 Constraints；包含同表多 Role OR 后个人 Constraints AND | 同左，所有谓词须在真实表中可解析／执行且在现行编译上限内 |

正式 Role 的 47 个中还须存在一个可编译 Role 覆盖 ≥207 source／≥9 connection，以保留现场已知单角色宽度。不能只靠多人／多角色相加满足这一已知事实。

W2／W5 分别由 **2／5 个互不相交的基准副本**构成，连接／Schema／Role／Agent ID 采用固定长度确定性重命名。每个副本的角色绑定图、每人 capability／source 数和谓词结构与基准一致；不得再把每人允许来源数乘 K。表中全局数量因此为 K 倍；报告实际字节可能因合法身份字段有小幅差异，仍须满足字节下限。对子副本去除重命名映射后，权限图谱 fingerprint 必须一致。

所有 B109／W2／W5 都分别有 BAL 与 SKEW 两组，共 6 组，不能用一个分布的 PASS 覆盖另一个。除总数还需保存每人向量和副本索引，校验各 Agent 的 normalized capability identity、source／connection／tool 集合、rowGrant／finalRows、Role 绑定与 Constraints。校验真实编译结果的重复项和无效项，不靠重复 DTO 堆数。

禁用、过期、撤销、未绑定、角色冲突、合法零权限、解析失败、单对象删除和故障注入在**单独的功能副本**验证，不污染这 6 组性能 fixture；恢复后重新核对 manifest。预期拒绝用例的通过不等于正常组“请求失败可以忽略”。

### 2.2 字节下限与防填充

字节精确定义为 `permissionCompactBytes = Σ Buffer.byteLength(JSON.stringify(agent.effectivePermissions), "utf8")`，每个性能 Agent 必须编译成功且字段存在。rawFullBytes／rosterBodyBytes 是完整 HTTP body，分母不得混用。保持与现场 4,740,771 B 同一重编码口径；跨候选 body 的格式或 opaque 摘要差异须另列。

主体规模来自合法的来源／工具组合和真实行权限结构。名字、ID、Schema、表名、工具说明采用候选 B 测量前冻结的常规短值；禁止长名称／大描述／冗余字符串 padding、重复 capability、无效谓词填充字节。若合法结构达不到下限，先调整实际授权宽度／可执行谓词再冻结，达不到即 R0 BLOCKED，不能声称已保留现场负载。

note ≤256 字、名称 ≤64 字、每 Agent Role ≤3 只用于固定预算夹具；产品不能静默截断真实字段。输入配置内容、编译图谱、逐人字节和生成算法版本必须在候选 B 测量前封存；不能为凑 20% 比率临时扩大旧 roster。

## 3. 构造与规模 oracle

1. 隔离项目建议 `lucy-uat-ars-<batch>`，虚构 ID 前缀 `uat_ars_<batch>_`；端口和卷动态选空闲并记录。9 个以上逻辑连接可指向专用真实数据库的不同 Schema／表，不连接现场；KTX 与 Lucy 走真实配置／编译路径，不修改 KTX 源码。
2. 用幂等配置种子和当前 Lucy 管理路径创建角色／Agent；密钥在仓库外私有目录生成，仅引用、不得输出。需要直接导入配置时只作用于该项目独立卷，走正常 reload／编译，记录输入哈希。用真实 MySQL 容器建最小可读表，合法 MCP 正反例走真实数据。
3. 原始访问日志可在**停写的专用测试库**中批量种子生成，记录 schema、id／ts 水位、user_id、token 关联、usage／protocol／eval 分类；不写运行中客户库，不复制真实审计内容。有效窗口至少覆盖 7d／14d／30d 各组，窗口外历史须存在。
4. 通过候选 A 原完整列表及单对象有效权限接口做 oracle，候选 B 同一原完整 API 必须语义等价；每 Agent 保留 ID、roles 数、source／connection／tool／capability 数、有效权限紧凑 UTF-8 字节、rowGrant／finalRows 形态计数、snapshotHash、warning 分类。禁止把后端新摘要函数当 expected 生成器。
5. `scale.json` 记录总和与 per-Agent p50／p95／max；`per-agent-scale.json` 记录分布；`fixture-manifest.json` 记录 seed、配置／Manifest／启用表摘要、真实表数、凭据数、审计行数／窗口水位、孤儿或失败条目数。rawFullBytes 与 permissionCompactBytes 分开；只有 permissionCompactBytes 用于 §2 字节下限。加入 profile、副本编号、去重结果、每人图谱 fingerprint 和 Role 共享度；只比总和不得通过。
6. 改前改后使用同一配置内容与数据库快照，保持原始审计 ts／id 和分类不变；窗口仍以各自真实 asOf 计算，具体实时时钟规则见 §5.1。项目路径／mtime／代次／generatedAt 等 opaque 字段可不同，不能要求跨容器 snapshotVersion 字符串相等；每个候选内摘要／旧 roster／statistics 必须同代匹配。合法 MCP 验证独立于性能时段，之后恢复功能副本，不给性能基线追加访问日志。
7. 负控：将 fixture 的来源与授权缩至很窄、只剩相同数量账号，再跑裁判；R0 必须拒绝，不得沿用原 manifest 的计数。该负控只测测程，不能作为功能成功证据。

## 4. 固定 Agent 数的宽度实验

另设 `WIDTH-L／WIDTH-H`：Agent 始终 71、名称／备注／角色绑定和 Token 数相同，改变所引用角色允许的来源／工具／行谓词，真实编译后 WIDTH-H 满足 B109 capability／字节下限、完整权限字节至少为 L 的 2 倍。两档都能合法读取，不靠 invalid 权限取得快响应。WIDTH-L 是专用小宽度对照，不主张达到 B109 下限；R0 对它验证预定图谱及与 H 的倍率关系，不能把其较低下限用于替代六组正常 B109／W2／W5。

每种 BAL／SKEW 分布都执行宽度实验，完整权限字节翻倍之外，WIDTH-H 的实际 capability 总数也须至少为 WIDTH-L 的 2 倍，排除只拉长谓词／名称取得体积翻倍。新摘要体积增长 ≤5%；记录同槽冷构建和摘要＋statistics 热旅程，热态不 parse／重投影完整 DTO；冷态一次完整 payload 序列化如实记录。摘要 hash／代次变化、数字位数增长是合理小增量；若现有摘要结构因为权限变宽回传 sources／capabilities，ARS-10 直接 FAIL。冷编译耗时单独报告，不承诺与宽度无关。

## 5. 资源、基线与负载

- 所有性能预算只应用于候选 A／B 的正常组；legacy 组合、预定错误和故障测试使用单独功能副本，不继承新端性能收益判据，也不能用其小夹具称保留现场规模。
- 正常盘：Docker Desktop 的单 Lucy 容器 `2 CPU／4 GiB`；专用真实数据库独立固定配额；记录 Docker Desktop 总额、Mac 芯片、镜像摘要、Lucy/KTX 版本、gitSha／dirty diff 摘要、浏览器版本、连接方式与 viewport。前后相同资源，无第三方重建／种子任务。
- 候选 A：实施本条前冻结的当前 0.30 构建（含原 P1-58）；候选 B：同基线只引入本条必要改动。**109 的 0.25 不作为本条收益分母**。若共享分支有其他改动，使用隔离 checkout／构建上下文固定差集，不 checkout／覆盖共享工作区。
- 每档每候选：cold navigation 至少 5 次；API 热态每组至少 30 次（摘要、statistics、旧 roster、默认完整、最宽单 detail 分组）；前台无客户端数据缓存 SPA、热 SPA、手动刷新、名称 Drawer、编辑页各至少 20 次；权限快照冷／失效首读各 5 次；同数据 A→B 后再 B→A 交错确认。样本数、顺序和异常必须保留。
- 单模块串行浏览器，API 测量不与浏览器计时重叠；健康／事件循环可低频旁观但不把探针当页面证据。此次不是 RACS 的 10 rps 联合压力，不自行在共享环境施压。
- 冷定义分别记：新浏览器 context 无 React Query 缓存；服务端权限快照首次构建／代次失效；进程重启。HTTP 静态文件缓存和 OS 页缓存独立记录，**不称 OS 冷缓存**，不对共享宿主 drop_caches。不能证明的冷层只写未知。
- 每次读取 10s 截止；最多一次已有可恢复重试，且所有额外等待／退避／重试共用剩余最多 5s，整个逻辑读取从首次发出起 15s 硬截止（不是两次各 10s 再加退避）。超时计失败；模块内版本补读也共用该预算，不另启无限循环。该预算是未来测程约束，不改产品全局 HTTP 配置。

### 5.1 Docker 实时时钟与可比性

Docker 功能／浏览器验证不得 monkeypatch Date.now、冻结进程时钟或重写旧日志 ts。生成时记录真实 T0，审计行置于 T0−2d／−10d／−20d／−40d 等固定桶，距离 7d／14d／30d 边界至少 48h；A/B 同一轮须在 24h 内完成。超时窗或发现跨边界行则该组无效，恢复原始种子再完整重跑，不单独改时间戳修绿。

性能组凭据有效期远离观察区间（≥30d），不存在过期翻转。到期／同时间戳／边界另在受控时钟单元测试和独立 Docker 功能副本覆盖。A/B 的 windowStart／End、asOf、generatedAt 如实保留；比较分类计数和原始行集合，不要求两次 wall-clock 字符串一样。每次运行以实际窗口和固定 id ceiling 独立只读核对 oracle，不能由新 summary 函数给 expected。

每个 profile 在候选 B 测量前冻结输入和归一化编译 fingerprint；W2/W5 证明是副本复制后再压测。全量 JSON／权限 oracle 采集在性能计时外，采完再清客户端缓存／按冷层定义准备；不能用采集全量 API 把缓存预热后称冷读。

## 6. 性能预算（提案，未达标主张）

| 指标 | B109 | W2 | W5 |
|---|---:|---:|---:|
| 摘要 body，identity 编码 | ≤256 KiB | ≤512 KiB | ≤1280 KiB |
| 摘要 body／同档原 roster body | ≤20% | ≤20% | ≤20% |
| 摘要 API 热态 p95 | ≤200ms | ≤300ms | ≤500ms |
| 快照首次构建／失效首读 max | ≤1000ms | ≤2000ms | ≤3000ms |
| 前台名册 primaryReady p95 | ≤1000ms | ≤1500ms | ≤2000ms |
| 前台业务统计 statsReady p95（正常可用组） | ≤2000ms | ≤3000ms | ≤5000ms |
| 名称抽屉 drawerReady p95（各档各 profile 的最宽单对象） | ≤2000ms | ≤3000ms | ≤5000ms |
| 编辑页 permissionReady p95（各档各 profile 的最宽单对象） | ≤2000ms | ≤3000ms | ≤5000ms |
| 正确率／有效请求成功率 | 100%／100% | 100%／100% | 100%／100% |

每个 profile、候选、场景单独判定；p95 用 nearest-rank `sorted[ceil(0.95*n)-1]`，5 次冷导航的 p95 因而等于该组最大值。Drawer 和编辑页必须使用各组真实最宽对象，各至少 20 次，不能随机取最小 Agent 代替。

摘要与同档旧 roster 的 body 均在 `Accept-Encoding: identity` 下实测完整 envelope，避免 gzip 和 header 字节口径混淆；另记浏览器 transferSize／decodedBodySize。前后默认完整 API 等价，不能为凑 20% 把 baseline 填大。WIDTH-H/L 另须过 §4 的 ≤5% 线。同槽构建计数／payload parse 必须覆盖摘要＋statistics 的整个请求链；cold prewarmer 的全量序列化／内存另列，不隐去。v0.2 新增 statsReady 出口，阻止“名册快但统计永远 pending”假绿，其余原预算未放宽。

绝对预算与同档相对不回退必须同时成立。摘要页面的改前分母是旧 AgentList 的同场景 roster 页面；摘要 API 分母是旧 roster；抽屉和编辑按同 ID／窗口对照。p95 同时恶化 >20% 且 >50ms 判回退。改前超时／错误组保留“无有效基线”，不计算收益倍率；改后仍须满足绝对线、正确性和正常性能组 100% 成功率。预定参数错误／越权／不存在／局部故障只进独立正确性组，按预期错误判定；不能把正常组失败事后改归故障组。预算达不到即 FAIL 回设计，修改预算须在终稿或后续具名裁决中记录旧值、原因和授权，不得测后自动上调。

纯 MCP 正反例只判本条功能未改变授权／合法可用；持续压力下 MCP／livez SLO 属 RACS-R 组合，不复制第二套系统预算。

## 7. 清理与保留

仅停止／删除本批专用 compose 项目与专用卷，先列项目／端口／卷／Token 归属再执行；不能按模糊前缀删除其他会话资源。保留 fixture 必须具名、给用途／期限／空间并登记 runs；否则清理后核对无残留，记录 demo／109 未写。清理验证失败时 ARS-12 未完成，不写整套 PASS。
