# Run — 2026-11-20 — kimi-double-dom-risk

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE` |
| 选择器 | **F58-browser-timing 扩展档**（前台浏览器＋即时计时；Roles／Agents 页 DOM 规模风险翻倍验证）；非完整 F58／F59／R |
| Agent | Kimi Code |
| 环境 | WebUI `http://127.0.0.1:55176`；`compose-lucy-1` healthy（重建后候选 `1fb73f72…`） |
| 浏览器 | **系统 Chrome（headed，真实前台窗口）**，Playwright channel=chrome；1920×1080；`visibilityState=visible`／`hidden=false` 逐轮断言 |
| 规模 | API：**469 roles／172 agents**（基线 9/2＋既有 fixture `uat_racs_br_*`/`br2_*` 220/80＋本次新增 `uat_racs_dbl_*` **240/90**）；UI 表行 Roles **463**／Agents **172** |
| 凭据 | env 注入，口令不入库 |
| 原始 JSON | `inbox/uat-racs-dbl-2026-11-20/`（seed-*、browser-timing.json、cleanup-*） |
| 入口 | `scripts/uat/roles-agent-scale-stress.mjs seed --roles 240 --agents 90 --tokens-per-agent 1`（`LUCY_RACS_PREFIX=uat_racs_dbl_`）；`scripts/uat/racs-browser-dom-probe.mjs`（前台计时探针） |
| 总判定 | **PASS（翻倍规模前台计时）** — DOM 风险实测更新：线性增长确认、非线性拐点未出现；≠ 完整 F58／R；≠ 可上线 |

## 造数（真实 API，单会话串行）

| 接口 | n | 状态 | p50 | p95 | max |
|---|---:|---|---:|---:|---:|
| POST /api/admin/roles | 240 | 240×200 | — | — | — |
| POST /api/admin/agents | 90 | 90×200 | 758 ms | 956 ms | 1,091 ms |
| POST /api/admin/agents/:id/tokens | 90 | 90×200 | 416 ms | 503 ms | 1,862 ms |

- 330 写 **0 失败，进程未中断**——复核 R-2 的写中断信号在本路径（单会话串行、约 1.2 写/秒）**未复现**；Cursor 两次中断的触发条件（写速率/并发）仍未知，R-2 维持观察。

## 前台 primaryReady（headed Chrome；点击侧栏 SPA 导航 → 最大表 tbody 行数达标 → `performance.now()` 差）

| 页面 | colder | SPA×3 | 行数 | DOM nodes | longtask（渲染期） | 控制台错误 |
|---|---:|---|---:|---:|---|---:|
| /admin/roles | **361.5 ms** | **181.3／184.4／161.2 ms** | 463 | **12,300** | 每轮 1–2 个，60–166 ms | 0 |
| /admin/agents | **179.8 ms** | **82.4／104.1／83.5 ms** | 172 | **5,230** | 0 | 0 |

- API 同窗口（分列）：roles p50=68 ms／roster 72 ms／agents-full 72 ms／statistics 74 ms。

## 与 223 行档（2026-11-20-cursor-roles-agents-browser-timing）外推对照

| 指标 | 223 行（Cursor） | 463 行（本跑次） | 倍数 | 形态 |
|---|---:|---:|---:|---|
| Roles DOM | 6,124 | 12,300 | **×2.01** | **严格线性**（~26.6 nodes/行） |
| Roles primaryReady colder | 189 ms | 361.5 ms | ×1.9 | 近线性 |
| Roles primaryReady SPA 中位 | ~36 ms | ~181 ms | ×5.0 | 超线性但基数极小 |
| Agents DOM | 2,707 | 5,230 | ×1.93 | 线性 |
| Agents primaryReady SPA | 32–42 ms | 82–104 ms | ×2.5 | 温和超线性 |

## DOM 风险判定（回应 O-1）

1. **DOM 随行数严格线性增长**（~26.6 nodes/行）——全量渲染无虚拟滚动的结构性代价确认，但斜率温和。
2. **primaryReady 在 463 行仍远优于合同线**：p95=184 ms ≪ B 线 1,000 ms／5× 线 2,000 ms；colder 361 ms 同样过线。
3. **渲染主线程可分片**：longtask 60–166 ms/个，无 >200 ms 卡顿任务；consoleErrors=0。
4. **非线性拐点未出现**——按 colder 近线性外推：约 1,000 行 ≈ 780 ms、2,000 行 ≈ 1.6 s 触及 B 线。企业级可接受域内。
5. **风险定级更新**：O-1 从「规模风险观察」下调为「低优先级规模观察」；建议设看守阈值——正式角色行数 **>1,000** 或 fixtures 上调 B 时重测本探针（`scripts/uat/racs-browser-dom-probe.mjs` 已落盘可复用）。
6. 与 kimi 后台 15–29 s 旧测量同候选同量级对照：前后台差 2–3 个数量级，**后台节流放大结论再次坐实**。

## 清理

- 本跑次新增 `uat_racs_dbl_*`（240 roles／90 agents／90 tokens）已删除，verify 回归 **229 roles／82 agents**（`br_*`/`br2_*` 按复核 R-1 保留待委托人决定）；未触碰基线对象。

## GAP

- 未测 1,000+ 行（外推非实测）；未跑 E1–E18 元素矩阵与 2×／5× 联合 R。
- headed Chrome 单窗口顺序测量，未测多浏览器上下文并发渲染竞争。
