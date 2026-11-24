# FDE 管理站超时复核 · P1-75／P1-77

| 项目 | 记录 |
|---|---|
| 日期 | 2026-11-23 |
| 对象 | [P1-75 v1.2](../specs/lucy-20261123-interactive-read-resilience-spec.md) · [P1-77 v1.1](../specs/lucy-20261123-default-business-context-adoption-spec.md) |
| 证据 | FDE `20261123-lucyadm-timeout-investigation/findings.txt`、`public-probes.jsonl` 和 `enabled-tables-tri-state/FINDINGS.md`，以及 `lucy-v0.30` 当前工作树源码、Spec 与测试台 |
| 评审裁决 | P1-75 继续按产品合同验证。优先打假动态指引的调度截止和共享冷构建的响应截止。P1-77 以独立候选验证，保留按题新增负载门槛。启用表范围误报已受控复现，列为独立修复建议。 |
| 证据等级 | FDE 窗口为现场观察，三态为 Docker 受控复现，本轮为静态评审。正式候选判定见[测试台](../qa/uat/INDEX.md)。 |

## 审查意见

| 审查项 | 结论 | 核对依据与意见 |
|---|---|---|
| 握手与共享事件循环 | 部分覆盖，主线程机制仍待实测 | 四条握手的目录与 Skill 阶段占全调用 92.9%–95.5%。这是阶段墙钟。6,482,102 字节来自事后核验的 24／26 份 Manifest，不能确定事故时实际读取字节或 CPU 热点。当前候选已从握手移出描述增强。权限投影、样例裁剪、Skill 全量新鲜扫描及同步解析仍在路径上。并发上限 20 限制在途工作量，同进程定时器和协作取消无法抢占已执行的同步段。`skills_load` 可跨文件读取、同步解析及 ACL，其墙钟不可直接归给大 Manifest。见 [Spec §1 和 §2.2](../specs/lucy-20261123-interactive-read-resilience-spec.md#1-现场证据与待验证假设)、[截止实现](../../webui/server/proxy/mcp-proxy.ts#L2311)、[目录分支](../../webui/server/proxy/acl.ts#L2211)、[Skill 新鲜扫描](../../webui/server/skills/loader.ts#L117)。 |
| 备注写中名册 | 合同已覆盖，正式验收待执行 | 正常纯备注保存且已提交视图与授权输入可核验时，独立观察会话应取得一致旧视图，成功回包后首读应见新备注。真实授权变化或核验不可用仍执行原保护。Docker 历史跑次确认写入同窗报忙，不能由 `builds=0` 推出实际原因为 `write_pending`。见 [Spec §2.1](../specs/lucy-20261123-interactive-read-resilience-spec.md#21-名册在正式备注保存期间持续可用)。 |
| 无写冷读、核验与慢构建 | 用例已覆盖，当前实现存在响应截止缺口 | FDE 未发写入与纯 MCP 问数，现场其他流量未知。P99 2.324–2.579 秒、最大约 3.79 秒来自健康样本，无法与失败读取逐请求归因。当前定期元数据／全摘要间隔仍为 1 秒／30 秒，新鲜度分别为 3 秒／31 秒。摘要核验执行文件读和 SHA-256，需与目录 YAML 解析分开计时。恢复等待预算为 1.5 秒，冷构建 `await started` 没有独立的请求响应期限。SC-08 B3 已要求真实构建扣留 12 秒时受影响读在浏览器中止前返回明确结果，候选有可直接打假的用例。浏览器的 10 秒是代码上限，现场没有可信的原始失败请求计时。见 [SC-08](../qa/uat/suites/interactive-read-resilience/cases.md#uat-read-res-08)、[快照构建等待](../../webui/server/display-snapshot.ts#L817)、[文件摘要](../../webui/server/display-revisions.ts#L79)、[浏览器预算](../../webui/src/lib/displayQueryOptions.ts#L42)。 |
| 观测与环境 | 合同已覆盖逐请求观测，取证完成度待核对 | `busyByReason` 是聚合计数，`lastRequest` 也不能代表并发下每个请求。用 SC-01 取得实例／进程、请求关联键、作用域、代次、忙因、队列／调度、实际退出与前台恢复。按同一时间窗比较诊断开关、容器实际适用的 CPU 限流计数增量、文件 I/O 耗时和 CPU profile，分别识别核验未按时启动、等待 I/O、同步 CPU 工作和构建占用。现场采样仅支持事故归因；产品验收在隔离 Docker 完成。见 [Spec §2.3](../specs/lucy-20261123-interactive-read-resilience-spec.md#23-观测与证据边界)、[快照诊断](../../webui/server/display-snapshot.ts#L1041)。 |
| P1-77 候选隔离 | 独立质量功能，候选隔离须由产物证明 | C5、SC-08 约束握手内新增读取，SC-07 PERF／MIX 约束真实答题速度与按题上下文负载。当前工作树的 `staticCoreRuleLines` 无条件拼入 P1-77 文本，合流树不能直接作为 P1-75-only 候选 A。A 的构建和真实完整／基础 `initialize` 指引应先封存，再以独立 B 验证。见 [P1-77 合同](../specs/lucy-20261123-default-business-context-adoption-spec.md#2-合同)、[指引装配](../../webui/server/proxy/mcp-proxy.ts#L2205)。 |
| 启用表范围误报 | 独立缺陷，已受控复现 | FDE 对照中 pending、HTTP 500 和 HTTP 200 空表均显示缺少 Manifest 与无效启用；同一 demo 健康对照正常。候选修复须按连接区分加载、失败、已确认空，保护已有启用配置及草稿，在目录未核验时禁用受影响连接的清理操作。后端目录枚举和单文件读取也分别把错误降为 `[]` 和 `""`，HTTP 200 空表自身不足以证明文件缺失。若保留“缺少 Manifest”，以可核验的文件缺失为依据。见 [前端目录投影](../../webui/src/pages/connections/TableWhitelist.tsx#L310)、[缺失判断](../../webui/src/pages/connections/TableWhitelist.tsx#L479)、[后端扫描](../../webui/server/enabled-tables.ts#L285)。 |
| 受影响画像（四类） | 两份 Spec 均已覆盖，补偿效果待验 | P1-75 问数方在动态降级时失去预载范围，最差子面判 `↓`，由 SC-03 在纯 MCP 真实宿主证明按需发现和正确查数可达。治理方的名册和权限读取、运维方的按请求定位、管理层的概览内容分别挂 SC-04／05／07／08、SC-01／06／08、SC-08。P1-77 改变问数方的口径和规程质量与速度，把宿主采纳证据挂 SC-01／07，治理与运维子面维持现行入口。若 PERF 或补偿失败，按最差子面复核。见 [P1-75 画像](../specs/lucy-20261123-interactive-read-resilience-spec.md#受影响画像)、[P1-77 画像](../specs/lucy-20261123-default-business-context-adoption-spec.md#6-受影响画像)。 |

## 建议的验证顺序

1. 在同一 Docker 候选先校准 SC-01。运行实际大 Manifest 的冷／热和不同字节档，记录阶段墙钟、排队、CPU profile、事件循环延迟。SC-03／06 保留异步慢 I/O 对照，追加能触发真实解析或投影的工况，验证依赖可用时的动态决策、完整首响应、同进程探针和合法纯 MCP。把独立 `lucy_catalog` 到首次正确查询纳入同一旅程。
2. 先跑 SC-08 B3，再按 A、B1／B2 定位无写核验。若 B3 证伪，给请求等待设置早于前台中止的明确上限，同时保持底层构建去重和容量记账，结束时重验代次与授权，故障解除后在原时限恢复。若真实热区是重复解析，先考虑按已核验内容代次复用解析结果、请求时独立校验授权。若单次冷解析仍压垮同进程预算，再评估有界 Worker 或可分片计算。若主要是 I/O 或核验队列，则优先收敛扫描范围、队列与调度。调整方案按同样的撤权和外部文件变化负例复验。
3. 现场归因可以与 Docker 并行。获准的短窗关联脱敏前台 HAR、进程阶段记录和资源指标。以限流计数的窗口增量和卷操作延迟判断资源假设。无现场采样也可按原 Docker 合同判定产品侧修复；事故是否关闭需要对应现场证据。
4. 启用表范围独立登记后，复用 FDE 四组做真实前台计时，并补后端读失败、同页其他连接正常可用和原草稿保留。P1-77 等候选 A 的正式 G1／G2 结果，再以 B 跑双宿主及 PERF／MIX。
