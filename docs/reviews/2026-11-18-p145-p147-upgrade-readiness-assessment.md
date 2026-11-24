# P1-39／45／46／47 客户平滑升级放行评估

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-39／45／46／47 客户平滑升级放行评估 |
| 文档类型 | Review |
| 版本 | v1.1 |
| 撰写日期 | 2026-11-18 |
| 撰写人 | Cursor（Claude） |
| 委托人 | xingchen |
| 基于材料 | 前方报告 LUCY-TR-20261118-01 v1.2；客户截图（0.30.0 `abb389133356`：readyz 2.4–5.5s、livez 1.5–1.7s、event-loop p99≈2.2s、`KTX MCP probe timed out after 1500ms`）；P1-39／45／46／47 的 Spec／Plan；测试台 INDEX 与各套件 runs；`docs/lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md`；`docs/runbooks/customer-v2-upgrade-release-checklist.md`；`deploy/k8s/helm/lucy/values.yaml` |
| 适用范围 | 决定「当前候选能否交付客户做平滑升级、解决 11-17 升级后回滚的问题」 |
| 输出位置 | `docs/reviews/2026-11-18-p145-p147-upgrade-readiness-assessment.md` |

## 结论

**不放行直接交付客户生产升级（默认配置下 P1-47 仍 FAIL）。**  
**模拟台已证明：带 `LUCY_INFERRED_MAINTAINER=off` 的暂停交付可解 11-17 回滚同形根因** → 可进入「客户前置验证」（amd64 待测包 + values 置 off + 原生升级演练）。

- 11-17 回滚的启动崩溃／整表扫描路径：P1-39／45／46 在限速台已 PASS。
- **满量重建持续停顿**（默认开）：双跑对照 livez max **2693ms**，与客户 p99≈2.2s 同形 → 默认配置**仍不可当作已解决**。
- **暂停配置（`off`）**：同镜像同夹具 livez max **13ms**；RPB-05／06／07 PASS；冷启动暂停配置 R0／01–05 PASS（见 [rpb-pause-uat](../qa/uat/suites/rebuild-probe-budget/runs/2026-11-18-cursor-rpb-pause-uat.md)、[cold-pause-off](../qa/uat/suites/cold-start-slow-disk/runs/2026-11-18-cursor-cold-pause-off.md)）。Helm Chart **0.2.10** 已能下发该 env。
- 候选仍为 **dirty／arm64**；须提交后出 amd64 `*-test`，实例 values 置 `env.LUCY_INFERRED_MAINTAINER: off`。
- **暂停≠P1-47 修复**；正式包发出与客户现网仍走 C01–C20／A4／A5。

## 1. 证据总表（Spec／UAT 检查结果）

| 条目 | 解决的问题 | 测试台判定 | 关键数值 | 评语 |
|---|---|---|---|---|
| P1-39 启动／轮询去整表扫描 | 升级时 `FST_ERR_HOOK_TIMEOUT`、稳态 livez 秒级 | **PASS**（[p145-p147 跑次](../qa/uat/suites/cold-start-slow-disk/runs/2026-11-18-cursor-docker-p145-p147.md)，6/6） | 02 首次升级 livez max 548ms／p99 468ms（放宽门槛 2000／1000）；03 重启 max 7ms；04 max 3ms；05 管理员认领＋MCP 握手通过 | 上次 03／04 FAIL 已转 PASS。**注意**：02 的 p99 468ms 仍高于稳态门槛 400ms，靠委托人已批的首次升级放宽门槛过关 |
| P1-45 重建中断后恢复 | 重建中途被杀后，已建用户永不再重建／覆盖判定被 15 分钟余量误判 | **PASS**（IRR 跑次） | 中断留下的 `in_progress` 重启后恢复为 `complete`；不再用 15 分钟余量 | 即 03／04 转 PASS 的根因修复。IRR-05 未跑 |
| P1-46 readyz 与 MCP 监听一致 | readyz 200 但 MCP 尚未监听，网关 502／503 | **PASS**（RML 跑次） | readyz 200 ⇒ MCP initialize 成功 | RML-04 未跑 |
| P1-47 满量重建探针预算 | 重建时同步 SQL 拖过 3 秒探针预算 | **FAIL**（[rpb r2](../qa/uat/suites/rebuild-probe-budget/runs/2026-11-18-cursor-rpb-p145-p147-r2.md)） | RPB-01 livez max **2968ms**（门槛 ≤1000／p99 ≤400）；客户 3 秒观察者连续失败为 0；RPB-02／03 PASS；RPB-04 BLOCKED | 改前为 8003ms，allocate 与 DELETE 分块后降到 2968ms，仍未达标。Spec OQ-2（只读 worker／`wal_autocheckpoint`）未授权未做 |

文档侧检查：`node scripts/uat/check-e2e-ledger.mjs` PASSED；`lint:spec-docs` 对 P1-45／46／47 相关文件无新增告警（此前我新写的编排 Plan 缺「验收」小节，已补）。其余 lint 违规是仓库存量，非本次引入。三台状态（总账、Spec 头部、INDEX）本次已同句回写：P1-39 为 PASS，P1-45／46 为 PASS，P1-47 为 FAIL。

## 2. 与 11-17 回滚症状的对照

| 客户症状 | 对应机制 | 现状 |
|---|---|---|
| 升级后进程在 onReady 崩溃／长期不就绪 | 启动 `scanFull` 整条索引扫描 | **已修（P1-39）**，COLD-02 通过（首次升级 110 秒就绪，重启 0，对照 0.25.0 为 29.5 秒） |
| 稳态 livez 1.5–2.2 秒、p99≈2.2 秒 | 轮询 `DISTINCT` 整条索引扫描；重建单页数秒 | **已修（P1-39）**，COLD-04 livez max 3ms |
| 重启后短时再卡 | 15 分钟余量使活跃用户被整窗口重算、DELETE 不分片 | **已修（P1-45＋47）**，COLD-03 livez max 7ms |
| readyz 200 但网关 502／503 | MCP 监听晚于 readyz | **已修（P1-46）** |
| readyz 3.8／5.5／2.4 秒 | 满量重建同步 SQL | **部分修**：8003→2968ms，仍可能触到 3 秒 |
| `KTX MCP probe timed out after 1500ms` | `webui/server/admin/mcp-runtime.ts` 内部探针预算 `LUCY_MCP_RUNTIME_PROBE_TIMEOUT_MS` 默认 1500ms，小于事件循环停顿量级，把循环停顿误报成「KTX MCP 降级」 | **未处理**。事件循环不再卡顿后会随之消失，但本条未登记、未验证；**不是**新的根因 |

## 3. 阻塞放行的缺口（须逐项关闭）

| # | 缺口 | 性质 | 建议 |
|---|---|---|---|
| G-1 | P1-47 RPB-01 livez 2968ms（门槛 1000ms） | UAT FAIL，功能合同未收口 | 先定位持续停顿的来源（见下方复核：38／42 个样本 ≥1.5 秒），再授权收敛手段（OQ-2：`wal_autocheckpoint` 调小或只读／写 worker）并重跑 RPB。2026-11-18 复核后**不再建议**「书面接受残余风险」：停顿是持续的而非单次尖峰，与客户现场症状同形。**不得**在不改 Spec 的情况下写成 PASS |
| G-2 | 候选为 dirty、未提交、arm64 本机构建 | 出包硬门禁（C07／C08） | 经委托人同意提交后，用干净树构建 `linux/amd64` 单架构镜像，过 G1–G4；待测包用 `*-test` 后缀 |
| G-3 | 无 K8s／Helm 与 0.25→0.30 真实升级取证 | 缺取证（C12／C15／C16） | 在自备 amd64 原生环境，用原 PVC 做 0.25→待测包升级、备份、恢复演练；记录升级期间 readyz／livez 序列 |
| G-4 | 无客户侧证据（UAT-COLD-06）；限速台只模拟盘速 | 缺取证 | 向客户索取 `dd … oflag=dsync` fsync 延迟、`audit.sqlite*` 三文件大小、故障 Pod 启动五分钟日志；确认客户盘是否比 30MB/s／100 写 IOPS 更差 |
| G-5 | IRR-05、RML-04 未跑；RPB-04 BLOCKED | 套件未跑完 | 补跑，或在套件里写明不适用原因 |
| G-6 | 内部 MCP 探针 1500ms 小于循环停顿 | 开放项（错题已列） | 另入总账再评估；不阻塞，但出包说明里要告知客户该告警可能误报 |

### 3.1 暂停开关与对照实验（2026-11-18 追加，委托人授权）

已实现 `LUCY_INFERRED_MAINTAINER=off`（默认开，行为不变；关闭时不创建后台补算维护器，`inferredRebuild` 状态如实返回 `paused: true`、`complete: false`）。同镜像、同夹具的对照（[跑次](../qa/uat/suites/rebuild-probe-budget/runs/2026-11-18-cursor-rpb-p147-pause-control.md)）：

| 配置 | RPB-01 livez max | ≥1.5 秒样本 | 判定 |
|---|---|---|---|
| 暂停（`off`） | **11ms** | 0／119 | PASS（01／02／03） |
| 不暂停（默认） | **2662ms** | 37／42 | FAIL |

- 根因确认：持续停顿来自后台补算维护器。
- 暂停可作为**客户测试期的逃生阀**，但**不是修复**，不关 P1-47，也不得写成 P1-47 PASS。
- 暂停代价：审计页问询分组／编号不再随新调用更新；问数、管理入口、readyz／livez 不受影响。客户测试包若带暂停，须随包说明。
- 停顿在重建内部的具体段落（WAL 检查点／写片 fsync／冷读）仍未区分，OQ-2 手段选择前需分段计时。

## 4. 风险估计（对客户最终体验）

- **启动路径**（最贴近 11-17 回滚）：Docker 限速台上稳；这是本次修复最扎实的部分。
- **启动后的满量重建**（2026-11-18 复核样本后更正）：客户升级后首次启动要补算 67 个用户的 30 天窗口，是 RPB 覆盖的场景。RPB-01 的 42 个 livez 样本里 **38 个 ≥1.5 秒、20 个 ≥2 秒、3 个 ≥2.5 秒，中位数 1967ms，最大 2968ms**，约每 3 秒一次、贯穿整个 120 秒窗口。这不是「单次尖峰」，而是**持续的 1.5–3 秒同步停顿**，形态与客户现场「event-loop p99≈2.2 秒、livez 1.5–1.7 秒」吻合。客户观察者连续失败为 0 只是因为停顿多落在 3 秒以内，余量只有几百毫秒；客户盘若比限速台稍慢，readyz 就会超 3 秒，仍可能复现 Pod NotReady 与 502／503。因此 P1-47 **不是可接受的残余风险，而是 11-17 症状仍未消除的直接证据**。
- **平滑升级流程本身**（PVC、Secret、引导密钥、Helm 升级／回滚）：本次没有动，也没有新验证；沿用 C01–C20 的既有门禁。

## 5. 建议的下一步（需要你定）

1. 决定 G-1 走 (a) 还是 (b)。我倾向 (a) 再做一轮收敛后重跑 RPB；若时间紧，(b) 需要你明确确认并同步改 Spec 门槛。
2. 同意提交后，我出干净树 amd64 待测包（`*-test`），并列出需要你在 amd64 环境执行的升级演练步骤。
3. 向客户索取 G-4 的三项数据。

## 6. 限制

- 本评估基于本机 Docker 限速模拟，不是客户现场测量。
- 冷启动台与 RPB 台都由我在 arm64 上运行，未触及 Helm／K8s。
- 本文件不构成开发授权；任何运行代码改动需另行授权。≠ 可上线。
