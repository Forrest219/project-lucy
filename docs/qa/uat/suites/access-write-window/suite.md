# UAT-SUITE-ACCESS-WRITE-WINDOW — 大目录访问配置写窗口韧性

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-ACCESS-WRITE-WINDOW` |
| 总账／需求 | **REQ-0117**（P1，不入核心分母） |
| 授权 | 委托人 2026-11-26 明示开发授权（含 Task 0 只读测试基建先行，P1-78 同型口径）；acl.ts 有限扩权（仅 `commitEffectivePolicyUnlocked` 缩小重编译面）同日批准 |
| 修复合同 | [Spec](../../../../specs/lucy-20261126-access-write-window-resilience-spec.md)／[Plan](../../../../plans/lucy-20261126-access-write-window-resilience-plan.md) SC-01–SC-10 |
| 目标 | 隔离 compose 栈（2000 启用表＋500 Agent 规模水位＋宽角色 Agent）验证：写窗时长基线、重叠写有界等待与诚实拒绝、同对象 409、写窗内展示读恢复、读己之写、纯 MCP 不回归、前台浏览器 E1–E18 |
| 范围 | 隔离栈 `lucy-req0117-uat`（`scripts/uat/access-write-window-stack.mjs`）；不改共享 demo 状态 |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做

| ID | 对应 Spec | 要点 |
|---|---|---|
| `UAT-AWW-R0` | 环境 | 隔离栈 healthy；管理员登录；夹具就绪（2000 表＋水位）；规模口径见 fixtures |
| `UAT-AWW-01` | SC-01 | 修复前红基线存档（两症状），复跑于当前镜像仅作规模锚点 |
| `UAT-AWW-02` | SC-02／SC-08 | 无冲突重叠写经有界等待成交（200）；写窗总时长／pending 子窗口达标（OQ-3 冻结值） |
| `UAT-AWW-03` | SC-03 | 等待超限/超队诚实拒绝：503＋`Retry-After`＋持有者信息（`wait:false` 或超队注入） |
| `UAT-AWW-04` | SC-04 | 同对象重叠写：等待后取得锁触发既有 409（OBJECT_TARGET_CHANGED 族），前端「对象已被修改」且编辑内容不丢失 |
| `UAT-AWW-05` | SC-05／SC-06 | B1 分支：单写窗内 0 次无指引错误终态；重叠写窗口错误终态占比 ≤ 硬阈值；读己之写（创建结算后列表含新角色；跨写响应拒绝守卫不回归） |
| `UAT-AWW-06` | SC-07 | 主路径成交：2000 表角色创建 `written=true` 且 `runtimeAck=true`（屏障覆盖至 policy ack 未收窄），页面无错误终态 |
| `UAT-AWW-07` | SC-09 | 纯 MCP 不回归：数据面工具语义、拒绝码、预算行为不变（initialize/tools/list/lucy_query + 越权拒绝码） |
| `UAT-AWW-08` | SC-10 | 前台浏览器 E1–E18（1920×1080，即时计时，与 API 耗时分列） |

其余 7 类语义写入口忙即拒绝不回归（SC-02 后半）由单测覆盖（`publish-coordinator.test.ts` REQ-0117 块），本套件 API 侧以 manifest 上传重叠写抽样核对。

## 边界

- 隔离栈专用卷；`clean` 后共享 demo 不受影响；禁改共享 demo 常驻状态。
- 浏览器验证必须真实前台＋即时计时（CONVENTIONS「WebUI：浏览器＋计时强制」）。
- 功能合同收口 ≠ UAT PASS ≠ 可上线。
