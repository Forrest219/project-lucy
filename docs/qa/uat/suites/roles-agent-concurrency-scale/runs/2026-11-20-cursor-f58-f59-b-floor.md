# Run — 2026-11-20 — cursor-f58-f59-b-floor

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE` |
| 选择器 | **F58-smoke／F59-smoke** ＋ **F58-B-floor**（fixtures B：roles=20／agents=100／tokens=3；读到达 2 rps；突发 25） |
| Agent | Cursor |
| 环境 | 本机 demo `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881`；`compose-lucy-1`／`compose-demo-db-1` healthy；**共享 demo 卷**（非 fixtures 隔离卷；造数前缀可清理） |
| 候选 | `lucyVersion=0.30.0`；`gitSha=1fb73f72…`；`gitDirty=true`；镜像 `sha256:7a43b139…` |
| 凭据 | 管理员经真实 `/api/auth/login`；口令不入库（env／仓库外文件） |
| 入口 | `scripts/uat/roles-agent-f58-f59-smoke.mjs`；`scripts/uat/roles-agent-scale-stress.mjs`（seed／load／burst／cleanup） |
| 原始 JSON | `inbox/uat-racs-smoke/smoke-2026-11-20T02-30-18-642Z.json`；`inbox/uat-racs-b-floor-2026-11-20/`（prefix `uat_racs_b20_20261120023514`） |
| 总判定 | **SMOKE_PASS** ＋ **B-floor PASS WITH GAP** — ≠ 完整 F58／F59／R；≠ 功能收口；≠ 可上线 |

## 用例优化（相对此前 runner）

| 问题 | 处理 |
|---|---|
| statistics 缓存断言夹在多 range 之间导致假 FAIL | 同 range 先 miss→hit→bypass，再测 14d／30d |
| load 路由 `i%8===7` 时 `i%4` 恒 3，statistics 只打 30d | range 与 bucket 解耦（`floor(i/8)%4`） |
| cleanup 后角色 id 退役无法复用 → seed 409／ROLE_ID_RETIRED | 每次 seed 新 `LUCY_RACS_PREFIX` |
| 凭据写死文件路径 | 支持 `LUCY_DEMO_ADMIN_ID`／`PASSWORD`；禁止打印 secret |
| cases 头仍写「全部 NOT RUN」／suite「无跑次」 | 补选择器边界表；runs 指针更新 |

## F58／F59 smoke（选择器）

| 步骤 | UAT 映射 | 结果 |
|---|---|---|
| health／login | R0 | PASS（`gitSha=1fb73f72` dirty） |
| roles／agents-full／roster 无窗口统计 | RACS-01 | PASS |
| statistics 7d miss→hit（asOf 不变）→refresh bypass；14d／30d 可读 | RACS-01／08 | PASS |
| 未鉴权 roles → 401 | R0 | PASS |
| roles ×25 全 200 | RACS-07 | PASS（p95≈69 ms @ demo 小库） |
| dryRun→save→`access-write-status` committed；同对象一对冲突；描述还原 | RACS-09／10 | PASS |
| MCP initialize | RACS-12 | SKIPPED（未设 `LUCY_DEMO_MCP_TOKEN`） |

## B-floor 造数与压测

| 维度 | 计划 | 实测 |
|---|---:|---:|
| 正式角色（fixture） | 20（B） | 20 |
| Agent | 100（B） | 100 |
| tokens／Agent | 3（B） | 300 签发全 200 |
| 连接／来源／审计历史 | fixtures B | **未放大**（GAP） |
| 读到达 | 2 rps ×60s ×5 会话 | 计划 120／完成 120／丢弃 0；实际 2.0 rps |

### 读取（开放式，fixture 在位）

| 路由 | n | 状态 | p95 | fixtures B 线 |
|---|---:|---|---:|---|
| GET／roles | 60 | 60×200 | **44.5 ms** | ≤200 ms ✓ |
| GET／agents?range=* | 30 | 全 200 | **≤50.7 ms** | ≤200 ms ✓ |
| GET／roster | 15 | 15×200 | **58.0 ms** | ≤200 ms ✓ |
| GET／statistics?range=* | 15 | 全 200 | **≤46.0 ms** | ≤200 ms ✓ |

### 突发（RACS-07，25 并发同键 roles）

| 并发 | 状态 | p50 | p95 | max | 备注 |
|---:|---|---:|---:|---:|---|
| 25 | 25×200 | 456 ms | 568 ms | 569 ms | `builds;desc=0`／`cache;desc=hit`；突发延迟不套用稳态 ≤200 ms 线 |

### 清理

fixture 角色／Agent 删除后 leftover=0；基线回到 9 roles／2 agents。已删 id 退役，后续跑次须新 prefix。

## GAP（明确未覆盖）

- 完整 F58／F59／R 必做；2×／5× 数据／会话／到达联合；审计窗口外历史（RACS-02）
- 浏览器 E1–E28；慢盘；14-B／C／D；纯 MCP Token 共存（本跑 SKIPPED）
- 隔离卷／2 vCPU·4 GiB 资源封顶；改前对照基线相对闸
- 同对象冲突仅 smoke 一对，非 100 对矩阵／DEP-01–11 全表

## 备注

- 未对生产域名施压；未 `down -v`
- 先前 kimi stress（300 roles）仍为补充观察；本跑次以 **fixtures B** 与优化后 smoke 为准
