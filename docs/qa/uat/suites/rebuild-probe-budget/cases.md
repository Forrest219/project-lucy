# Cases — UAT-SUITE-REBUILD-PROBE-BUDGET

| ID | 标题 | 期望摘要 |
|---|---|---|
| UAT-RPB-R0 | 环境门禁 | 限速生效；满量推断夹具就位；探针采样器可用 |
| UAT-RPB-01 | 满量近期用户重启 | 对齐前方 F：满量推断已在库 → 新增近期调用 → 慢盘冷启动 → 就绪后 120s |
| UAT-RPB-02 | 客户 3s 观察器 | 同窗按周期 5s、timeout 3s 打 readyz；连续失败 &lt; 6 |
| UAT-RPB-03 | 已鉴权业务请求 | 同窗连续已鉴权项目／管理 API 全 200；记录 max／p99 |
| UAT-RPB-04 | K8s 摘端点（可选） | 真实集群观察 EndpointSlice；默认 BLOCKED |
| UAT-RPB-05 | 暂停配置满量重建台 | `--env LUCY_INFERRED_MAINTAINER=off`；门槛同 01；**暂停≠默认配置 PASS** |
| UAT-RPB-06 | 暂停下 MCP 回复 | 同窗每 10s：`initialize`→`tools/list`→轻量工具；单次 p99 ≤3s |
| UAT-RPB-07 | 暂停状态披露 | `inferredRebuild.paused=true` 且 `complete=false`；启动日志有暂停警告 |
| UAT-RPB-08 | 客户 11-17 指纹判别（必做诊断） | 同窗抄录：livez≥1.5s 占比、是否「约每 3s 一贯」持续停顿、health `degraded`／`KTX MCP probe timed out after 1500ms` 抖动；**不得**把「单尖峰」写成「客户同形未解」 |
| UAT-RPB-09 | 默认配置多跑稳定性（出包前必做） | 同镜像默认配置连续 ≥3 次独立冷启动；关单须 3／3 的 RPB-01–03 PASS；1 PASS＋2 FAIL（偶发 max 尖峰）记 **FAIL／不稳定**，不得宣称可出镜像 |

---

## UAT-RPB-01 — 满量近期用户重启

### 步骤

1. 准备约满量完整推断记录（前方量级：约 20 万原始调用对应的完整推断）。
2. 新增近期用户调用；慢盘冷启动候选镜像。
3. `/api/readyz` 转 200 后采样 120s：livez／readyz／可选 health。

### 期望

- 达到 suite 门槛表；跑次抄录 max／p99／超时次数。
- **禁止**缩小推断规模后宣称 PASS。

### 改前对照

前方 F：readyz 观察器 1×3004ms；livez max≈2956ms／p99≈2251ms（未达重启门槛）。

---

## UAT-RPB-02 — 客户观察器模型

### 步骤

独立于高频采样，按客户 Chart：周期 5s、timeout 3s、失败阈值 6。

### 期望

- 连续失败 &lt; 6；记录是否出现单次超时。
- 单次超时且连续=1 记入跑次；关单仍须满足 Spec 稳态门槛（SC-03）。

---

## UAT-RPB-03 — 业务请求同窗

### 步骤

就绪后连续已鉴权请求（项目 API 或等价）≥50 次。

### 期望

- 全 200；记录 max；不得用未鉴权 health 代替。

---

## UAT-RPB-05 — 暂停配置满量重建台

### 步骤

与 UAT-RPB-01 相同夹具与限速，唯一差别：被测容器带 `LUCY_INFERRED_MAINTAINER=off`（`--env`，不作用于 premigrate／注入阶段）。

### 期望

- livez max ≤1000ms、p99 ≤400ms；readyz p99 ≤1500ms；全 200；客户 3s 连续失败 &lt; 6。
- **禁止**把本条 PASS 写成套件默认配置 PASS／关 `GAP-UAT-P1-47`。
- 同镜像对照（不设 env）须仍能复现秒级 livez（见跑次对照表）。

---

## UAT-RPB-06 — 暂停下 MCP 回复

### 步骤

在 UAT-RPB-05 同窗内，每 10 秒循环：MCP `initialize` → `tools/list` → 一次 `wiki_search`／`lucy_catalog`（或等价轻量工具）；可行时加一次 `lucy_query`。

### 期望

- 全部成功；单次 p99 ≤3s。
- `lucy_query` 若接不上数据源：降级并在跑次注明，不得省略不写。

---

## UAT-RPB-07 — 暂停状态披露

### 步骤

暂停配置就绪后：读管理审计问询接口的 `inferredRebuild`（或等价）；检索容器启动日志。

### 期望

- `paused: true` 且 `complete: false`。
- 日志含 `LUCY_INFERRED_MAINTAINER=off` 暂停警告。

---

## UAT-RPB-08 — 客户 11-17 指纹判别

对齐错题 [`2026-11-17-k8s-upgrade-event-loop-readiness-timeout`](../../../../lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md) 与客户截图（Pod Ready=False、livez≈2.17s、readyz≈7.55s/`degraded`、health 因 KTX MCP 1500ms 抖动）。

### 步骤

1. 在 UAT-RPB-01 同一 120s 采样窗，对 `samples.json` 统计：`livezMs ≥1500` 样本数／占比、是否贯穿窗口反复出现、最大尖峰时刻 `t`。
2. 同窗或紧接 90s：每约 5s 打 `/api/health`，抄录 `status`（ok／degraded）、`eventLoop.p99Ms`／`maxMs`、以及是否出现 `KTX MCP probe timed out after 1500ms`（或等价 detail）。
3. 对照客户指纹表（跑次必须填）：

| 指纹项 | 客户现场（11-17） | 本跑次 |
|---|---|---|
| livez 1.5–2.2s **持续** | 是（p99≈2.2s） | 是／否；≥1.5s 占比＝ |
| readyz 常 &gt;3s | 是（2.4–7.5s） | 是／否；readyz max／p99＝ |
| health ok↔degraded 抖动（KTX MCP 1500ms） | 是 | 是／否；degraded 次数＝ |
| 客户 3s 观察器连续失败 ≥6 | 现场 Ready=False | 本跑 maxStreak＝ |

### 期望

- **客户同形未解**：≥1.5s 占比高（旧改前对照约 38／42）或 health 因循环停顿反复 degraded → 与 RPB-01 FAIL 一并记「同形未解」。
- **残余单尖峰**：仅 1–2 个样本 ≥1.5s、p99 仍 ≤400ms、maxStreak＝0、health 无持续 degraded → 记「非客户同形；残余尖峰」，**仍不得**单靠本条把套件写成默认配置 PASS（关单看 RPB-01／09）。
- **已解**：≥1.5s＝0、无 degraded 抖动、RPB-01–03 与 RPB-09 全绿。

### 改前对照

客户：livez≈2.17s；readyz≈7.55s degraded；health 90s 内 503／502／ok／degraded 交替。本机改前满量窗：livez 中位≈1967ms、38／42 ≥1.5s。

---

## UAT-RPB-09 — 默认配置多跑稳定性（出包前）

### 步骤

1. 固定候选镜像 digest／`BUILD_REVISION`，默认配置（不设 `LUCY_INFERRED_MAINTAINER=off`）。
2. 连续 ≥3 次独立执行（每次独立冷启动＋注入近期调用＋120s 窗）；允许复用已 premigrate 卷，禁止改夹具规模。
3. 汇总三跑：RPB-01／02／03 是否全 PASS；抄录各跑 livez max／p99 与 ≥1.5s 次数。

### 期望

- **出镜像放行（本套件默认配置）**：3／3 全 PASS。
- **不稳定**：任一次 RPB-01 FAIL（含偶发 max 尖峰）→ 套件不得写默认配置 PASS；跑次写明「1 PASS＋N FAIL」形态。
- 暂停配置跑次不计入本条分子。
