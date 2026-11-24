# UAT-SUITE-MCP-DATA-PLANE-HA — MCP 数据面执行舱壁与跨 Agent 故障隔离

| 元数据 | 内容 |
|---|---|
| Suite ID / 版本 | `UAT-SUITE-MCP-DATA-PLANE-HA` / v0.1-draft |
| 日期 | 2026-11-24 |
| 总账 / 合同 | **P1-82**／REQ-030-103 · [Spec](../../../../specs/lucy-20261124-mcp-data-plane-isolation-ha-spec.md) SC-01–05／SC-07／SC-08（**SC-06 经委托人 2026-11-24 裁定移出本期出口，授权下期实现**） |
| 目标 | 证明单 Agent 跨 Token／Session 不会耗尽全部问数资源；全局与分连接过载有界；WebUI 局部 503 与 MCP 故障不互相伪装；真实工作结束后容量可恢复 |
| 运行环境 | 本机隔离 Docker＋真实 KTX／两个独立只读合成数据连接＋多 Agent 纯 MCP 客户端＋真实前台浏览器（仅 WebUI 可见面） |
| 剧本 | [用例](cases.md) · [夹具](fixtures.md) · [跑次槽](runs/README.md) |
| 判定 | [INDEX](../../INDEX.md) 为唯一结果事实源。当前 **NOT RUN**（实现已落地待验收，尚无套件正式跑次；本机 Docker 候选验证见 `inbox/p181-p182-docker-verify/`，不替代 UAT） |

## 来源与定位

架构探查确认：WebUI 与 MCP Proxy 共用 Node.js 进程和同步 SQLite；现有查询限制不是整个 Agent 跨 Token／Session 的总限额，也缺少全局与分连接舱壁。既有 [`f5e4b14d` 混压](../interactive-read-resilience/runs/2026-11-24-codex-f5e4b14d-pressure.md)已出现 Web 展示读 503 与独立 MCP 查询超时共存，本套件把这些风险变成可重复的对抗场景，而不把相关性写成单向因果。

与相邻套件分工：

| 套件 | 已有职责 | 本套件不重复 |
|---|---|---|
| `UAT-SUITE-INTERACTIVE-READ-RESILIENCE`（P1-75） | 读路径性能、握手、目录和同窗恢复 | 复用其混压方法与预算，不重新认领性能优化 |
| `UAT-SUITE-MCP-INQUIRY-PERF`（P1-78） | 真实 Agent 完整答复性能基线 | 本套件只做执行容量与故障隔离，不替代业务答复质量门禁 |
| `UAT-SUITE-CORE-AVAILABILITY`（P1-61／62／63／69／70） | 轻探针、重任务、排空、重载与读写等待 | 不重写其状态机；只新增 MCP 执行容量和跨 Agent 对抗 |
| `UAT-SUITE-SELF-HEAL`（P1-81） | 假活识别、同实例恢复和自动替换 | 本套件提供容量事实与触发场景，不重复 watchdog／restart 合同 |
| `UAT-SUITE-STORAGE-READINESS`（P1-71） | 存储风险与后续迁移准备 | 本套件不迁移数据库、不引入多写者 |

## 全真性

- 必须使用真实 Lucy／KTX／数据库和真实 MCP Token。禁止用桩上游、假 503、直接改内存计数或客户端伪造成功代替故障。
- Agent A 必须使用基线内多个真实 Token 与多个 Session，混合至少两类上游语义工具；B／C 使用独立 Agent 和独立凭据。
- 慢查询由合成数据库中的只读 `SLEEP()` 或等价真实机制产生，并用数据库 PROCESSLIST／等价在途证据确认命中。未命中真实执行阶段的相关断言记 `BLOCKED`。
- WebUI 局部 503 由真实资源压力或既有展示故障路径产生；03 必须有真实前台浏览器计时。纯 MCP 用例不强制浏览器。
- 改前与改后使用同一全局规模夹具、镜像资源、客户端、请求序列和独立 SQL 核对值。不得降低规模、删掉慢样本或靠重启伪造恢复。

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-MCPHA-R0、01、02、03、04、06、07、08 | UAT-MCPHA-05（随 SC-06 移下期，本期不列入通过判定）、UAT-MCPHA-09（持续公平性与恢复观察） |

注：UAT-MCPHA-05／SC-06（流式体积上限／全局内存背压）经委托人 2026-11-24 裁定**移出本期出口、授权下期实现**；跑法原文保留，供下期 SC-06 验收使用。

R0 无法证明夹具、独立 SQL、真实在途和故障注入有效时，依赖该事实的用例记 `BLOCKED`，不得判 PASS 或以单元测试替代。

## 持续节奏

| 时机 | 跑哪些 |
|---|---|
| 改前基线 | R0／01–08；保留真实 FAIL／BLOCKED，不预设全部失败 |
| 容量实现候选 | 同一最终镜像执行 R0／01–08 全套，所有必做 PASS |
| 修改 MCP 容量、上游取消／超时、响应缓冲、工具分类或审计关联 | 相关单测＋受影响的必做项；共享结算改动跑全套 |
| 后续 B1／B2／C 阶段 | 另立套件或版本化扩展，不把本单实例结果外推为进程／多副本 HA |

## 当前边界

- 只证明 Docker 单实例、单副本内的执行容量与跨 Agent 隔离，不证明 WebUI 进程退出时 MCP 仍存活。
- 不覆盖审计进程拆分、KTX worker 池、零停机重载、多副本、外置存储或客户拓扑。
- 同一数据库自身故障只能超时、熔断和隔离，不得承诺该连接继续成功；其他 connectionId 必须继续。
- INDEX：**NOT RUN**。
