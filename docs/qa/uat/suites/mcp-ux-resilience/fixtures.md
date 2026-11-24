# Fixtures — UAT-SUITE-MCP-UX-RESILIENCE

| 键 | 值 |
|---|---|
| WebUI | `http://127.0.0.1:55176` |
| Health | `http://127.0.0.1:55176/api/health`；`/api/livez` |
| MCP Proxy | `http://127.0.0.1:57881/mcp` |
| Compose | `deploy/compose/docker-compose.demo.yml` |
| Lucy 容器 | `compose-lucy-1` |
| MCP Bearer 文件（本机） | 同 [escape 套件 fixtures](../source-ambiguity-mcp-escape/fixtures.md)：`~/.cursor/mcp.json` 中本机 `lucy` 的 `Authorization`（跑前 `initialize` 探针须 200）。**不**把 token 写入仓库／runs |
| 连接与表 | `demo-mysql`；合法单表度量 `superstore_orders.order_count`；泛化歧义词 `超市`（命中 orders／people／returns，见 escape 套件） |
| 合法多表 join | 语义层已声明 join 的事实表＋维度表（取自 escape 套件 ESC-07 夹具） |
| 稳态定义 | demo 无人工并发请求；`/api/livez` 正常；跑前记录 15 分钟窗口的空闲基线 |
| 握手压力脚本（**待造**） | 顺序 N=200 次 `initialize` 与 20 并发 `initialize`，记录每次耗时；输出 P50／P99／> 30 s 计数；同时生成**发送侧清单**（类别、数量，供 UAT-MCPX-12 核对）。脚本为 Plan 步骤 0 交付物，落 `scripts/uat/`，**本文件不假定其存在** |
| 策略重载夹具（UAT-MCPX-02） | 在稳态下连续 3 次通过 WebUI／API 变更并保存 `access.yaml`（或等价导致 `policy_version` 变化的无害变更，如调整一个测试 Agent 的描述），每次变更期间并发 20 次 `initialize`。**两个测试身份 A／B**：同角色集合、B 另有 Agent overlay 或 capability 差异（Plan 步骤 0 经 WebUI／API 真实创建，用后删除）。**另需多身份脚本**：一次创建／授权／清理 **≥ 17 个测试身份及其 Token**，供 UAT-MCPX-06 的全局 1024 LRU 淘汰用（单身份上限 64，两个身份永远触发不了全局淘汰）；造不出则 UAT-MCPX-06 的全局子项 BLOCKED 停表，不得降级推算。**撤权保密夹具**：只读延迟钩子（或可控构建期窗口）用于让握手构建跨越 commit；**skills 夹具**：对测试身份可见的 Skill 做原地改写／删除／ACL 收窄与外部直接改文件的脚本，并能读取复核周期实测值。权限收窄用例对 A 真实收窄并还原。**用例结束必须还原变更**，不得改动真实 ACL 语义 |
| 会话失效夹具 | **UAT-MCPX-08（真实）**：容器内重启 KTX MCP 子进程，使其丢失全部上游会话；**每个（工具×形态）组合都先新建会话，再各自重启一次**，不得一次重启服务多个工具。Plan 步骤 0 先真实重启并记录实际响应形态（400／404／其他），以实际形态为准，造不出的形态 BLOCKED。**上游调用计数**：优先读 KTX MCP 子进程请求日志；没有则 Plan 步骤 0 交付仅计数、不改行为的只读计数入口。**UAT-MCPX-09／10（持续失效，含四类恢复失败与 `notifications/initialized` 被拒）**：重启只能造一次失效，不满足「恢复握手也失败」；**夹具待 Spec O7 闭合**，未闭合时这两个用例 BLOCKED 停表，不用本机代理或替身冒充 |
| 大目录夹具（UAT-MCPX-07） | Plan 步骤 0 交付造数脚本 `scripts/uat/`：在 demo 内经 WebUI／API 创建连接 `uat-wide-catalog`，使测试身份**可见 ≥ 300 个 Source**（现有 `UAT-SUITE-LARGE-SCHEMA` 是宽表／多表接入，不自动等价于数百个可见 Source，须单独确认），记录 `listSources` 耗时与目录规模；用后删除并确认规模回落。**本文件不假定脚本存在** |
| 重复被拒夹具（UAT-MCPX-06） | 对泛化歧义词 `begin` 后，同会话两次提交相同的未钉选 `lucy_query`（第二次在 60 s 内） |
| 客户基线（参考，非验收值，**不可核：仓外材料**） | `initialize` 日中位数 10 ms→1.6 s（P90 55 s）；门闩拒绝 P95 57 s／P99 192 s；177 次原样重试被拒；557 次 404；业务侧 `lucy_query` 成功率门闩前 92.0%／后 68.1% |
| 指标核对（UAT-MCPX-12） | 不回放客户流量；以本套件前序用例自产行为已知值，发送侧清单由各脚本产出 |

## 已交付夹具与脚本（2026-11-17；以下取代表中「待造」「待 O7」的措辞，表里原文保留作设计依据）

| 夹具 | 实际落位 | 说明 |
|---|---|---|
| 宽目录沙箱 | `scripts/uat/uat-wide-sandbox.mjs`（`up｜restart｜seed-rows｜status｜down`） | **没有**在 demo 里造 `uat-wide-catalog`：改为独立容器 `lucy-uat-wide`＋独立 volume＋独立 MySQL 库 `uat_wide_mcp`（320 Source、20 Agent，三个角色 full／noquery／half 轮转），与 demo 隔离、`down` 一键清除。密码与令牌只在 `$TMPDIR/lucy-uat-wide`（0600） |
| 握手／拒绝基准 | `scripts/uat/mcp-ux-resilience-wide.mjs`（`handshake｜deny｜stages`） | 输出 P50／P95／P99／>30 s 计数与并发突发 |
| 用例运行器 | `scripts/uat/mcp-ux-resilience-uat.mjs`（`mcpx01｜02｜04｜05｜06｜07｜08｜12｜all`）；demo 侧 `mcp-ux-resilience-demo.mjs`（`r0｜mcpx11｜all`） | 共用库 `scripts/uat/lib/mcp-uat-lib.mjs` |
| 多身份（≥17） | 沙箱 20 个 Agent；MCPX-06 的 LRU 另建 17 个 `uat_lru_NN` Agent（沙箱内，随 volume 删除） | 全局 LRU 用 1025 键、4 s 内完成，排除 TTL 干扰 |
| 会话失效 | 运行器内 `killKtx(container)`（`/proc/*/cmdline` 找 KTX 进程、`kill -9`，entrypoint 监督拉起） | 每个工具先新建会话再各自重启一次。只覆盖「重启后旧会话号」形态 |
| 指标取数 | `scripts/uat/mcp-ux-metrics.mjs`＋`scripts/uat/lib/mcp-ux-metrics.mjs`（自测 `node --test scripts/uat/lib/mcp-ux-metrics.test.mjs`） | M1–M6 口径写在库文件头，与 Spec §5 一致 |
| 仍 BLOCKED | UAT-MCPX-09／10 | 夹具待 O7；U3b 不实现 |

## 禁止

- 把 Bearer／密码写入 runs／INDEX／inbox 明文
- 用 vitest／CR 冒充本套件 PASS
- 为凑绿关闭 ACL／门闩／鉴权，或在 demo 里放宽 `policy_version` 之外的任何安全配置
- 遗留策略变更、会话失效夹具、大目录夹具
