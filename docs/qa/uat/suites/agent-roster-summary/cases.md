# Agent 名册摘要用例

当前 v0.3 分批：F66-A 以 Spec BA-01–07 和 [本批 run](runs/2026-11-20-codex-p166-batch-a.md) 为出口；下方 ARS-R0／01–12 保留原完整合同与失败／未执行事实，不作为本批已全过的声明。

v0.2，2026-11-20。委托人已授权开发和 Docker 浏览器执行。本文件定义步骤、判据与证据；逐项实际结果见 [run](runs/2026-11-20-codex-p166-docker.md)，不从用例设计推定 PASS。数据／资源／预算只见 [fixtures](fixtures.md)，合同只见 [Spec](../../../../specs/lucy-20261120-agent-roster-summary-projection-spec.md)。

## ARS-R0 — 候选与规模有效性（SC-08）

- 冻结两候选镜像／版本／dirty diff、资源与输入 seed；核对原 roster 和 detail 真正来自当前容器。
- BAL／SKEW 各自编译 B109／W2／W5 共 6 组；核对每副本每人权限、共享／分散 Role、实际去重 capability 和完整权限字节、谓词形态与原始审计水位；保存 normalized 图谱 fingerprint。W2/W5 是 2/5 个保宽度副本，不允许每人来源再乘倍率。候选 B 测前封存所有输入。
- 下限任一不符或来源不可证明 ⇒ BLOCKED／无有效基线；不继续声称保留现场规模。不通过导入预制 JSON 响应达标。
- 产物：fixture-manifest、scale、per-agent-scale、oracle 摘要。用户／口令只用虚构值且不入日志。

## ARS-01 — 旧 API 与参数兼容（SC-01）

- 相同输入对照默认完整列表、range=7d／14d／30d、旧 `view=roster` 的完整字段、顺序与含义；在受控时钟／数据库水位下比较动态值。
- 验证新摘要仅在显式参数出现时返回；缺省 projection 保持原响应；未知值及不匹配 view 返回 400 BAD_REQUEST；statistics 静态路由不被当成 userId。
- 旧 WebUI／脚本访问新后端仍拿到原完整对象，不能收到 `tokens: []` 或权限缺省伪装；旧 roster/statistics 的原 snapshotVersion 计算及 envelope 不因 sidecar 增加而改变。空 projection、重复／数组投影值、新投影版本未知分别有判据。

## ARS-02 — 单对象和写合同保持（SC-01）

- GET 指定 Agent detail 和 effective-permissions，原字段、完整来源／capabilities／rowGrant／finalRows、Token、version／baseObjectVersion 保持。
- 同 ID 不同 range 的统计窗口正确；已有 POST／PATCH dryRun／保存／Token 请求格式和 ack 没有被摘要参数或缓存改变。旧异常码／认证行为保持。

## ARS-03 — 摘要准确与白名单（SC-02）

- 独立 oracle 逐人计算 source／connection／tool／capability 数和 hash，检查多 Role OR／Constraints AND 后的最终事实；声明 Role 与有效来源分母不混用。
- 检查空权限=成功 0、解析失败=null／原因、声明冲突、legacyWildcard；configured／available 覆盖 Agent 禁用、凭据过期、吊销及临界时间。
- 网络 body 递归断言无 effectivePermissions／capabilities／raw rowGrant／finalRows／tokens[]／allow／constraints；元数据标 summary v1。
- 让权限摘要缓存热命中后跨过凭据过期点再读，available 按响应 evaluatedAt 更新；再让较早的 statistics 缓存结果晚到，逐行与顶卡 available 不得从 0 回升为 1。旧端缺少凭据有效性／观察时间证据时显示未知，不变成“enabled 就全可用”；不把摘要传给旧 Agent[] 汇总函数。

## ARS-04 — 同槽版本、整旅程成本与失效（SC-03）

- 同代同时读 summary、旧 roster、statistics，公开 config／snapshot 版本相等，正常业务统计必须实际 join 成功；不能靠取消版本核对修绿。只做两种 DTO 各自有版本的检查不足以通过。
- 原完整 payload 与小 sidecar 一次构建原子发布；10 并发只一份 PermissionBatch；失败／跨代不发布半份。冷态完整 JSON 序列化一次如实计数，摘要＋statistics 热旅程完整 payload parse／公开 DTO 重投影=0；原完整调用方仍能取回旧字段。
- 缺失或坏 schema sidecar 用受控缓存故障测试：CAS 只淘汰匹配所捕获槽实例的整对槽，同请求至多一次合并重建；新一代槽不能误删；尤其同 key／version 已重建的新实例也不能被旧请求误删。versionOf(key) 在同代重建时不变，必须用 incarnation／内部引用判 CAS；重建失败有界错误。不能每次命中坏槽一直 pending，不能偷偷 parse 大 payload 当轻路径。
- 修改 Role、Agent、启用表、Token 和外部配置触发正常核对；摘要与 Drawer 的 agents 前缀键都失效。正在读取的旧代内容不得回填；合法保存仍完成，不以只测拒绝代替正例。
- 项目／身份切换使受保护缓存隔离；完整、摘要、统计与 Drawer 类型分开，摘要不能覆盖编辑数据。

## ARS-05 — 名册前台与按需名称抽屉（SC-04／11，E1–E9）

- 桌面前台打开真实 `/admin/agents`，首次、无客户端缓存 SPA、热 SPA、刷新分别计时；原窗口下先出可核实名册，统计独立完成。
- 名册阶段 trace 只允许摘要及统计等已有页面必要请求；没有默认完整列表、旧 full roster 或全体详情预取。hover／滚动／筛选不触发单对象权限请求。
- 点击名称打开对象 Drawer，第一次仅新增指定 ID 的 detail（显式 range=7d，agents 前缀独立展示键，保持原标签）；不能调用完整列表再 find，也不重复请求同一对象 effective-permissions。
- 搜索／角色／状态／业务活跃筛选、Token 配置与可用数、禁用／旧通配提示、编辑／新建入口与改前等价；关闭 Drawer 恢复筛选／URL／滚动上下文。
- 网络／渲染 ready 与 E1–E9 截图对应，不能只数缓存中的 tbody 行。

## ARS-06 — 详情等待、缺失与失败恢复（SC-04／11，E10–E16／18）

- 直接打开最宽单对象编辑页，完整权限内容可见；名称抽屉和独立详情的 request／ready 指标分别记录。
- 真实删除隔离 fixture 中一个指定对象后读取：404 有返回名册；真实服务暂不可用／权限不足分别显示错误，不伪报对象不存在。HTTP 404 若非已验证的 AGENT_NOT_FOUND，按真实服务错误处理。
- 在单对象请求 pending／失败时，已有名册可搜索、关闭抽屉后可继续；A→B→关闭的快速切换取消无消费者请求，A 晚响应／旧 placeholder 不得出现在 B。改 Role／Token 后重开 Drawer 必须重读，不能显示已失效权限；恢复服务后可重试成交。
- 名册从 7d 切至 30d 后重新打开名称抽屉，Drawer 仍按原“近 7 天”标签请求 7d，query key 含 7d；不能把名册 30d 统计填入抽屉 7d 标签。切换目标 ID 不串上个对象；缺指标显示不可用，不假“未使用”。

## ARS-07 — 编辑 fresh 与缓存污染负控（SC-05，E15／17／18）

- 先打开摘要名册，再编辑一个有多 Role／Constraints／Token 的 Agent，详情所有字段来自完整对象；没有已知字段被 summary undefined／空数组清空。
- 对合法行限制做真实 dryRun／保存并重新读取、从纯 MCP 验证原授权含义；P1-59 对象版本冲突可恢复草稿，不静默覆盖。Token 动作用专用身份签发／撤销，保留原 runtimeAck 和 operationId 规则。
- 负控：将摘要灌入 detail 缓存的变异必须被类型／行为检查检出；不能只断言同名 query key 不同。

## ARS-08 — 统计／权限部分失败与合法路径（SC-06／11，E3／4／7／12／13／16）

- 慢统计、统计读取失败、统计版本旧于摘要：名册依然可搜索／角色筛选／进详情；依赖统计筛选明确不可用，业务计数未知不变 0。
- 单个权限解析失败保留其他合法 Agent；失败计数=null／原因明确，不显示已核实 0 或“无人有权限”。
- 统计版本永远不匹配的负控必须在已有总预算内结束为不可用＋重试，保留名册；不能永久 pending／自动补读环。恢复统计／配置后用户点击刷新可回到正确值，不清草稿。失败注入须有真实故障证据；组件 mock 仅补边界，不替代成功路径的真库／真编译。

## ARS-09 — 明确的 legacy 状态机（SC-07）

- 用实际旧前端／候选后端，以及候选前端对两类实际旧后端构建组合；记录镜像与能力，不能只改版本字符串。旧格式的 schema、空名册、单角色／多角色、窗口／summary 缺席都有可解析样本。
- summary-v1：投影标记／schema／config＋snapshot 标识齐备；statistics 严格配对，404 为异常不可用；缺标识或未知投影版本不得强转 legacy。
- legacy-roster：旧端忽略 projection 返回原完整 roster，适配保留原版本与统计匹配；只对精确 statistics 路径作一次能力探查。其 JSON NOT_FOUND 或通配 detail 的 AGENT_NOT_FOUND 404 可记缺席；HTML 404、401／403／400／502／503不能记 unsupported。
- legacy-full（含 109）：同一响应的 agents／summary／range／window 有效才成套使用，不再发 statistics；旧端没有 snapshotVersion 不人为填值，也不导致这份原子统计永远 pending。7d→30d→手动刷新各重新请求当前 range 并使用同 body，不串前一轮；无合法窗口只统计不可用，详情可达。
- 旧端缺有效性证据则 available=null；malformed body 不当空列表。能力结论随身份／项目／构建失效，旧请求不能回填。fallback 记内部诊断，字节收益 N/A，不计 summary-v1 性能 PASS。
- NewToken、Onboarding／Step6、MCP 调试台、Audit 原选择 Agent 流程与 helper 保持完整；这些未迁移页不因本条偷偷取得摘要。

## ARS-10 — 字节、前台时延与宽度实验（SC-08／09）

- 先执行 ARS-R0；BAL／SKEW 的 B109／W2／W5 共 6 组均跑同资源改前改后 API 与桌面真实浏览器，样本数和绝对／相对闸见 fixtures。
- 分列 summary／原 roster／完整 list／单 detail 的 body 字节、TTFB／下载／Server-Timing、构建数；摘要＋statistics 全链热命中不绕回完整 JSON；同槽冷构建／full prewarmer 的序列化和内存成本不能从报告隐去。
- 浏览器 primaryReady／statsReady／drawerReady／permissionReady 都按 fixtures 的样本数与预算判定，不能只测名册就绪；请求与 UI 通过本轮导航／ID／版本绑定，不能跨请求减耗时。
- 固定 71 Agent 做 WIDTH-L/H；实际完整权限至少翻倍而摘要字节增长≤5%，权限正确率／单对象完整性不变。
- 负控分别把 fixture 缩成同数量窄权限账号、复制重复 capability、只拉长名称／谓词使字节翻倍、W2 把每人宽度再乘 2，测程都必须拒绝；故意让 Drawer 拉整册或 body 加回 capability，断言必须失败。

## ARS-11 — 纯 MCP 未受摘要替代（SC-10）

- 同个 Docker 候选，用仅有 Proxy Bearer 的普通 Agent（无 WebUI 会话／宿主）真实 initialize，并调用已有合法数据读取工具，结果与专用真实表 oracle 相符。
- 读取未授权表／违反既有行范围仍被拒绝或过滤；收紧 Role 后摘要失效且 fresh 授权正确，不能用 summary 的 hash／count 充当授权事实。
- 恢复／合法钉选等既有逃生仍按原合同可用。该局部功能验证不冒充持续 WebUI 压力下系统共存已过。

## ARS-12 — 原始证据、清理与三台（SC-12）

- candidate／fixture／oracle／API／browser／网络路径／截图／失败样本／verdict 齐备，无真实口令或 Cookie；记录所有错误／超时和有效样本数。
- 独立资源清理或具名保留，并核对共享 demo／109 未写；执行失败不沿用另一轮 PASS。
- 回写 INDEX、Spec／Plan／总账等现值与 e2e-ledger GAP；完整 F66 PASS 只在 R0／01–12 全完成后产生，不修改 P1-58／59 的验收结论。

## 浏览器计时与就绪定义

所有浏览器轮次均须真实前台可视，导航前后及等待期间确认焦点／visibility，意外切后台则该轮失效重跑并保留记录。系统 Chrome 1920×1080，不做移动窄屏。即时用页面 `performance.now()`／同等高精度时钟，不把远程工具往返当精确渲染时间。

- `primaryReady`：导航点击／reload开始→本轮摘要请求成功、匹配目标配置版本且可见名册的 ID／名称／角色／凭据数符合 oracle；首次进入含冷静态页面的计时与无客户端缓存 SPA 分列；旧列表缓存未核对不能满足。
- `statsReady`：本轮目标 range 的统计可用且版本与名册匹配；不计入 primaryReady，不改统计时间。
- `drawerReady`：名称点击→指定 ID／range 的单对象内容与完整响应核对后可见；局部错误另判，不把旧 Drawer 内容算新对象成功。
- `permissionReady`：进入编辑页→目标 ID 的完整授权来源／行限制可见且受完整响应支持；主区不再处于加载占位。用预先冻结的可见来源样本与完整响应 digest 对照，不要求把屏外每个 DOM 节点一次性渲染来证明完整 API。
- 刷新／代次场景：在测试配置变更前冻结新指纹和可见改名标识，必须等对应新名称／计数，旧行数相同不能提前满足。测试结束还原隔离 fixture。

longtask 点击前布防，记录数量／最大／总时长；DOM 节点、JS parse／绘制可作诊断，API 与页面各自判据不混用。新建／编辑的写动作不做自动重放。
