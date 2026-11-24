# Fixtures — UAT-SUITE-MCP-DATA-PLANE-HA

## 候选与规模

| 项 | 要求 |
|---|---|
| 候选身份 | 记录完整源码 SHA、`gitDirty`、Lucy／数据库镜像 digest、KTX 版本、测程 hash；改前与改后只允许合同内差异 |
| 全局规模 | 全维度继承 [`scale-baseline.md`](../../scale-baseline.md) §1，不在本文件复制第二套数字；开跑先执行 `npm run uat:scale-baseline`，不达标维度对应必做用例记 `BLOCKED` |
| Agent／Token | 使用基线已有 Agent 与其全部 Token。A、B、C 为不同 Agent，各自使用独立 Role 与真实 Token；A 另开多个独立 downstream Session，禁止通过共用身份冒充跨 Agent |
| 数据连接 | 至少两个彼此独立的只读合成 MySQL 连接，分别提供合法 Source 和独立 SQL 核对值；核对 `COUNT(*)`／聚合结果，不写死未经当次 SQL 验证的答案 |
| 卷与网络 | 独立 Compose project、容器、网络和原生卷；只绑定环回随机端口，不修改共享 demo 或客户数据 |
| 资源 | 默认 2 CPU／2 GiB；需要紧张档时单独报告并在用后恢复，不得一边加资源一边宣称同档改善 |

## 身份与查询矩阵

| 身份 | 连接 | 用途 |
|---|---|---|
| Agent A | conn-a | 多 Token、多 Session、混合上游语义工具，尝试占满自身配额并穿透到连接／全局 |
| Agent B | conn-a | 验证同连接仍有有限合法成交；连接整体饱和时应快速繁忙而非无界等待 |
| Agent C | conn-b | 验证 conn-a 的慢查询、熔断或故障不扩散到 conn-b |
| Canary | conn-a／conn-b 各一最小权限身份 | 只做真实握手、发现和合法小查询，不复用 WebUI Cookie |

每个角色只授权本场景需要的 Source 与工具。保留一个无目标 Source 权限的 Agent D，用于区分容量拒绝和权限拒绝。

## 真实故障构造

| 故障 | 构造方式 | 命中证据 |
|---|---|---|
| 慢查询 | 在 conn-a 的合成视图中使用只读 `SLEEP()` 或目标库等价机制；不改变生产数据 | 数据库 PROCESSLIST／等价在途记录与 Lucy operation／attempt 关联 |
| WebUI 局部 503 | 复用 P1-75 的真实冷展示槽＋受控 CPU 压力，或既有展示核验／构建故障路径；不打桩返回 503 | 前台真实错误、API `DISPLAY_SNAPSHOT_BUSY` 及目标作用域事件 |
| 客户端断连 | 在接纳后、上游执行中、响应提交前分别真实断开 TCP | 服务端断连、上游取消请求与真实 close 分时点记录 |
| 响应超限 | 合成只读大结果，逐块传输超过当次 OQ-3 上限；另构造多个单独未超限但合计超全局预算的响应 | 上游流停止点、实际字节数、全局内存租约与其他 Agent 小查询结果 |
| 共享存储异常（仅观测分类用） | 对独立卷实施真实 I/O 限制或受控锁持有，不修改审计内容 | 既有 `AUDIT_UNAVAILABLE`／存储错误与响应屏障；不得伪造成功内容 |
| KTX／连接故障 | 只停止或隔离当次专用 conn-a 的执行资源，不碰 conn-b | conn-a 错误与 conn-b 正确结果；不允许用整容器停止冒充分连接故障 |

## 探针与账本

| 数据 | 字段 |
|---|---|
| 请求关联 | `operationId`、`attemptId`、`traceId`、Agent id、Token hash prefix、downstream Session 指纹、connectionId、工具名 |
| 容量事件 | `capacityScope`、配置／实际限额、获取时刻、拒绝时刻、取消请求、上游 close、最终截止、释放时刻 |
| 响应 | HTTP 状态、JSON-RPC `isError`、既有 reason、耗时、实际字节、是否自动重试、最终业务结果 |
| 审计 | `request_admitted`／`response_prepared`／终态序号、outcome、decision reason、`indeterminate` 事实、无敏感正文的断言 |
| 资源 | Node RSS／事件循环、KTX 与数据库实际在途、容器 CPU／内存、探针自身耗时 |
| WebUI | 前台焦点、导航→错误可见、解除→正确内容可见、网络回执与截图；API 计时另列 |

原始逐次回执优先于汇总。所有 Token、数据库密码和私有配置只从仓库外目录读取；证据中只保留 hash prefix 与脱敏字段。

## 清理

每个跑次结束后：停止专用发压与观察器，等待真实工作终结，恢复资源限额和故障注入，删除专用容器／网络／卷与临时凭据。核对无 `uat_mcp_ha_` 残留、无测试 Agent／Role／Token／连接残留，且共享 demo 未被修改。
