# 系统间 MCP 查数：容量保留、大明细背压与开发者水位（设计稿）

| 元数据 | 内容 |
|---|---|
| 文档类型 | 设计稿（Design）；定稿后另开功能 Spec／落地 Plan；**不构成**开发授权 |
| 版本 | **v1.0（设计协商定稿）** |
| 日期 | 2026-11-27 |
| 委托人 | xingchen |
| 方案 | **方案 2** — 同进程：`integration` 保留槽外可借并发 + 落地 SC-06 流式体积／内存背压 + 真实压测水位 + Python／Java 接入指引 |
| 需求池 | [`REQ-0119`](../backlog/entries/REQ-0119-integration-mcp-capacity-backpressure.md) |
| 上游关联 | [P1-82／REQ-030-103](../specs/lucy-20261124-mcp-data-plane-isolation-ha-spec.md)（四层容量已落地；**SC-06 授权下期**）；[P1-78／REQ-030-099](../specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md)；错题本：MCP／503／event-loop 相关 lessons |
| 状态 | 设计已确认；**Spec／Plan／UAT v1.0 已定稿**（2026-11-27）。**开发未授权**前禁止改运行代码 |

## 0. 已裁定决策

| 议题 | 裁定 |
|---|---|
| 使用场景 | **系统间程序化查数**（Python／Java HTTP），不是对话式 Agent 宿主；仍用 Lucy **Agent Bearer Token** 鉴权与 ACL |
| 与对话式差异 | 可能拉**大量明细**自行加工；风险＝并发占满 + **大响应撑爆内存／堵 MCP** |
| 负载档 | 团队级约 **10–40** 并发查数 |
| 交付层 | 真实压测测水位 + 开发者指引 + **加强现有防护**（非仅文档） |
| 进程拆分 | **本轮不做**；本轮收口后在**隔离环境**另做 B1 拆进程对照压测，再决定是否立项 |
| 官方 SDK | **本轮不做** PyPI／Maven；只交付 MCP HTTP 协议指引 + 最小示例 |
| REST 查数 API | **不做**；数据面仍为 MCP `lucy_*` |
| 拒绝策略 | **立即拒绝、不排队**（沿用 P1-82）；带 `retryAfterMs`／可机读原因 |

## 1. 现状评估（设计输入）

### 1.1 Python／Java 是否已支持

| 语言 | 官方 Lucy SDK | 今日可用路径 |
|---|---|---|
| Python | 无 | MCP HTTP + Bearer（MCP Python SDK 或自建 `httpx`／`requests`）；现场已有 `Python-urllib` 调用痕迹 |
| Java | 无 | 同上，需自建／选用 MCP HTTP 客户端；仓库无 Lucy JAR |

- 数据面：`LUCY_PUBLIC_MCP_URL`（如 demo `http://127.0.0.1:57881/mcp`），工具 `lucy_catalog`／`lucy_read_source`／`lucy_query` 等  
- Admin OpenAPI：管控面（建 Agent／发 Token），**不是**查数 API  
- 参考：`webui/docs/07-mcp-auth-proxy-spec.md`、`docs/user-guide/mcp-reference.html`

### 1.2 负载与阻塞风险（为何要本设计）

- WebUI + MCP **同 Node 进程**；大明细今日可能经 `readUpstreamBody()` **整包缓冲**后再门控（P1-82 **SC-06 未落地**）  
- 已有：token 4／agent 8／connection 16／global 24、问询预算、上游超时、部分 503 降级  
- 缺口：无 interactive／integration 公平保留；无流式体积背压；系统调用可与员工抢同一 global，并可能拖死 event loop → **正常人无法使用**（委托方首要担心）

## 2. 目标与非目标

### 目标

1. 明确系统集成方走 MCP HTTP 查数的支持边界与推荐做法（Python／Java）  
2. 在团队级并发下测出可公布的**安全水位**  
3. 大处理量／大明细高峰时：**优先保住员工 interactive 问数／WebUI 主路径**；对 integration **有界快速失败**  
4. **落地 SC-06**：流式字节上限 + 全局 in-flight 响应内存预算，禁止先完整缓冲再拒绝  

### 非目标（本轮）

- WebUI↔MCP **进程拆分**、KTX worker 池、多副本、零停机升级  
- 官方语言 SDK 发版、REST `lucy_query`  
- 改变 ACL／行权限语义或绕过治理  

### 硬边界

**本轮收口 ≠ UAT PASS ≠ 可上线 ≠ 进程级 HA。**  
**不宣称**因本轮获得 QPS 线性提升或零停机升级。

## 3. 架构（同进程两轴防护）

```text
员工 interactive MCP / WebUI
        │
        ├──► MCP Proxy
        │       ├─ 轴 A 并发：interactive 保留槽 R；integration 仅用 global−R
        │       └─ 轴 B 体量：流式字节上限 + 全局内存预算（SC-06）；按 workload 分档硬顶
        │
系统 integration（Python／Java）
        │
        └──► 既有：上游超时、问询预算、四层容量墙（token→agent→connection→global）
```

### 3.1 身份与 workloadClass

| 类 | 含义 | 默认 |
|---|---|---|
| `interactive` | 对话／IDE／员工问数 | **未打标默认** |
| `integration` | 系统间 API 调用 | 运维为专用 Agent **显式打标** |

- 系统方使用**独立 Agent + Token**，与员工 Agent 分离  
- 「不通过 Agent」指不经过对话 Agent 宿主，**不是**取消 Token／ACL  

### 3.2 轴 A — 并发保留槽

| 规则 | 说明 |
|---|---|
| `global` 硬顶 | 默认 24（可配；以压测校准对外数字） |
| 保留槽 `R` | 建议默认 `ceil(global×0.5)`，可配；专供 `interactive` |
| `integration` 可借 | 仅 `global − R`；打满 → 立即 `query_concurrency_exceeded` + `retryAfterMs` |
| 队列 | **不建等待队列** |
| 元数据 | 拒绝响应可区分 reserved／workload（具体字段在 Spec 钉死；优先复用 `_meta.lucy`） |

### 3.3 轴 B — 大明细背压（SC-06，本轮必做）

| 规则 | 说明 |
|---|---|
| 流式读取 | 边读边计字节；越上限即中止；**禁止**先 `readUpstreamBody` 完整缓冲再拒 |
| 全局内存预算 | 所有 MCP 上游 in-flight 缓冲合计超预算 → 拒绝新的大响应／admission |
| 分档硬顶 | `interactive` 较小；`integration` 更高但仍有硬顶 |
| 覆盖工具 | 凡上游语义执行入口（至少 `lucy_query`、`lucy_read_source`） |
| 客户端指引 | 超限须过滤／分页／缩窗；**禁止**对同一大查询无节流重打 |

默认行数／字节数字 **由 §5 压测校准后写入 Spec／指引**，设计稿不写未测对外承诺值。

### 3.4 轴 C — 时间

沿用上游空闲／硬截止与问询预算；指引要求客户端超时与退避。

## 4. 受影响画像

| 画像 | 判定 | 说明／补偿 |
|---|---|---|
| 问数方（员工 interactive） | ↑ | 高峰不被大明细／系统调用挤死 |
| 问数方（系统集成） | ↓ | 高峰／超大体量更多拒绝 → 补偿：机读错误、`retryAfterMs`、分页指引、独立 Agent 与更高但有顶的配额 |
| 运维方 | ↑ | 水位表、`mcpCapacity`／event-loop 观测、integration Agent 打标规程 |
| 治理方／管理层 | ＝ | 本轮不改授权模型叙事 |

## 5. 真实压测（出对外水位）

环境：Docker demo／scale；**混压**；全程 `stability-sentinel`。

| 场景 | 内容 | 通过线 |
|---|---|---|
| T1 基线 | 仅 interactive 小查询 | 对照成功率／p95 |
| T2 团队并发 | integration 约 10–40 路查询 | 可借槽满后有界拒绝；interactive 仍成交 |
| T3 大明细 | 故意宽拉／大响应 | 流式触顶；无 event-loop 假死；interactive 仍可用 |
| T4 停压恢复 | 停 integration 后立刻重试 | 同 PID 恢复；capacity 回落 |
| T5 哨兵 | event-loop p99／尖峰 | 持续越线 FAIL |

复用／扩展：`mcp-inquiry-performance`、`scale-baseline`、`stability-sentinel`、`/api/health`→`mcpCapacity`。

## 6. 开发者指引（交付物）

短文档 + Python／Java **最小可运行示例**（非官方包）：

1. MCP URL、Bearer、独立 `integration` Agent、session、`lucy_catalog`→`lucy_query`  
2. 与对话式差异：大明细必须过滤／分页  
3. 失败处理：`query_concurrency_exceeded`、体量拒绝、超时 → 退避／缩范围  
4. **实测水位表**（来自 T1–T5）  
5. 观测：运维看 health；集成方看拒绝计数  

## 7. 验收（本轮）

| ID | 条件 |
|---|---|
| A1 | integration 打满可借槽：立即拒绝 + 机读 scope／`retryAfterMs`；无无限挂起 |
| A2 | T3：流式触顶；进程不因整包缓冲假死；interactive 小查询成功 |
| A3 | T2 混压：interactive 成功率相对 T1 不低于 Spec 约定阈值 |
| A4 | T4 同 PID 恢复；sentinel 未持续越线 |
| A5 | 指引含 Python＋Java 示例、水位表、退避；写明无官方 SDK |
| A6 | health／容量摘要可观测与 integration 拒绝相关的聚合 |

## 8. 治理与工作顺序

1. 常青需求池入条（`REQ-0119`，已入）→ 本设计定稿审阅  
2. 正式 Spec（含 SC-06 + 保留槽 + 画像）+ Plan → **终稿确权** → **委托人开发授权**  
3. 实现 + 单测  
4. Docker T1–T5 → 填水位表  
5. 发布开发者指引  
6. **另场（本轮之后）**：隔离环境 **B1 拆进程对照压测**（同负载：同进程基线 vs 分进程）；输出是否正式开 P1-82 B1 Spec／授权——**不在本轮出口**

### 进程拆分说明（后续项，非本轮）

- 今日平滑升级＝保卷 recreate + drain，**非整机零停机**；拆进程 alone ≠ 平滑升级  
- B1＝故障域隔离；B2＝KTX 池／金丝雀才接近少断流升级  
- 拆进程主收益是**爆炸半径**，不是 QPS 魔法；大明细仍要 SC-06  

## 9. 关键实现锚点（供后续 Spec／Plan）

| 关注点 | 路径 |
|---|---|
| 容量协调器 | `webui/server/runtime/mcp-execution-capacity.ts` |
| MCP Proxy／`readUpstreamBody` | `webui/server/proxy/mcp-proxy.ts` |
| P1-82 Spec（SC-06） | `docs/specs/lucy-20261124-mcp-data-plane-isolation-ha-spec.md` |
| 压测／哨兵 | `scripts/e2e/run-mcp-inquiry-performance.mjs`、`scripts/uat/stability-sentinel.mjs` |

## 10. 变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-11-27 | 委托人确认场景＝系统间查数＋大明细风险；方案 2；§1–§4 分段批准；本轮不拆进程；收口后隔离环境做拆进程压测 |
