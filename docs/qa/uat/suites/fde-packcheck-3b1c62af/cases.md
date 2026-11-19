# Cases — UAT-SUITE-FDE-PACKCHECK

> 来源与权威说明见 [本机复现 Plan v0.2](../../../../plans/lucy-20261119-fde-3b1c62af-local-repro-uat-plan.md)。**期望是产品应有行为（合同）**，所以对已知缺陷，复现成立＝`FAIL（预期）`。冲突时以 Spec 头部状态为准，并在跑次记分叉；不得静默改本表期望。

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-FDE-R0 | 环境与身份门禁 | 必做 | `git worktree`、`/api/health` | 四个 worktree 干净且 SHA 正确；L2 镜像 `gitDirty=false` |
| UAT-FDE-R1 | 合同适用性核对 | 必做 | `upgrade-fix-regressions.test.ts` 8 个 `it.skip` | 每个 skip 有「合同／非合同／待定」＋依据 |
| UAT-FDE-01 | 正式完整导出等待追平（F01） | 可选（B） | FDE `functional-export-catchup.test.ts` | complete CSV／ZIP 在追平后 200；真未追平仍拒绝 |
| UAT-FDE-02 | Hive 慢合法语法回退（F02） | 可选（B） | FDE `functional-verify-hive-slow-legal.mts` | 总预算内读到字段；真超时仍终止 |
| UAT-FDE-03 | 单表 deferred 披露（F03） | 可选（B） | FDE `functional-verify-hive-default-envelope.mts` | 响应披露 deferred／rejections，可续读 |
| UAT-FDE-04 | 宽表整批 deferred 收敛（F04） | 可选（B） | FDE `functional-skipped-skipped-public-behavior.test.ts` | 50 表×400 字段读完；30 表混合权限不中断 |
| UAT-FDE-05 | 滚动窗口唯一归属（AUDIT-01） | 必做（A） | FDE `audit-repros/audit-rolling-window.mts` | 一个调用只属一个问询；编号一致；原始日志不丢 |
| UAT-FDE-07 | 正向结论复核 | 可选 | 既有 IRR／COLD／RPB 套件 | FDE 阈值内通过 |

---

## UAT-FDE-R0 — 环境与身份门禁

### 前置

候选 `3b1c62af32af7b6d045caef7fa10ccc92300ae97` 及三个基线 SHA 在本地对象库。

### 步骤

1. `git worktree add /private/tmp/lucy-fde-3b1c62af 3b1c62af32af7b6d045caef7fa10ccc92300ae97`；对 `ff4762c9`、`3a9f0711`、`84becc34` 各建只读 worktree。
2. 每个 worktree 执行 `git status --short` 与 `git rev-parse HEAD`。
3. 构建 L2 镜像后读 `/api/health` 的 `gitSha`／`gitDirty`。

### 期望

四个 worktree 无改动且 SHA 与目标完整值一致；镜像 `gitSha` 与候选一致且 `gitDirty=false`。任一不满足，后续用例全部 `BLOCKED`。

### 清理

测后 `git worktree remove`。

---

## UAT-FDE-R1 — 合同适用性核对

### 前置

R0 PASS。

### 步骤

1. 列出 `webui/server/__tests__/upgrade-fix-regressions.test.ts` 的 8 个 `it.skip`、各自原因文本、对应 FDE 缺陷。
2. 对 F04：核对「合法宽表最终必须能读完」是否见于 `lucy-20261115-large-schema-ingestion-spec.md` 的 LS 条款与 `UAT-SCALE-*` 规模下限。
3. 对 AUDIT-01：核对「一个调用只属于一个问询」是否见于 `lucy-20261116-trace-span-ledger-spec.md`、`UAT-TRC-*`、`UAT-EQ-*`。
4. 对每个 skip 给出三值：合同／非合同／待定，附依据链接。

### 期望

产出完整对照表交委托人确认。判为「非合同」的行为，仍须以 L2 的真实用户行为定性，不得仅凭 skip 原因下结论。

### 清理

无。

---

## UAT-FDE-01 — 正式完整导出等待追平（F01）

### 前置

R0 PASS；沙箱已起；已读 `webui/server/admin/audit.ts` 3189／4792 附近确认 lag 来源并写入 fixtures；D2 范围内**不含**受控进度替身。

### 步骤

1. 向沙箱写入真实审计日志，使投影进入 `lag>0`。
2. lag 追平时请求正式 CSV 与正式 ZIP（`complete`）。
3. 追平后再写入新事件，请求同一次捕获上界 S 的导出。
4. 同一时刻请求 diagnostic 导出作对照。
5. 持续 lag 不追平时请求 complete 导出。
6. 对 ff4762c9、84becc34 基线重复步骤 1–3。

### 期望

步骤 2、3 返回 200 并封存；步骤 5 保持拒绝；diagnostic 不能代替 complete。

### 判定

步骤 2 或 3 为 409＝`FAIL（预期，复现 FDE-F01）`；步骤 5 被放开＝另记 `FAIL`。无法用真实写入稳定构造 `lag 1→0`＝`BLOCKED`，须另行申请授权。

### 清理

清除沙箱审计数据。

---

## UAT-FDE-02 — Hive 慢合法语法回退（F02）

### 前置

R0 PASS；lab 外部目录可读；延迟注入代理可用（D2）。

### 步骤

1. 通过延迟注入让首个语法的合法拒绝耗时约 7100ms，后两个语法各约 100ms。
2. 经真实表结构预览读取该表，单表预算 8000ms。
3. 对照：快速前两语法拒绝＋第三成功；真正超时；连接被关闭。
4. 对 ff4762c9 基线重复步骤 1–2。

### 期望

步骤 2 在总预算内读到字段；步骤 3 三项各按合同返回。

### 判定

步骤 2 报 timeout 且未尝试第三语法＝`FAIL（预期，复现 FDE-F02）`。

### 清理

撤除延迟注入。

---

## UAT-FDE-03 — 单表 deferred 披露（F03）

### 前置

同 UAT-FDE-02。

### 步骤

1. 以正式 19 秒请求／10 秒调度预算打单表预览，注入延迟使该表预算用尽。
2. 记录响应体、HTTP 状态、客户端后续行为。

### 期望

响应披露 deferred 或 rejections，客户端可多轮续读。

### 判定

空结构且无披露＝`FAIL（预期）`；同时记录正式 HTTP／UI 实际影响，补足 FDE「待验证」缺口，并据此建议是否改判级别。

### 清理

撤除延迟注入。

---

## UAT-FDE-04 — 宽表整批 deferred 收敛（F04）

### 前置

R0、R1 PASS；`scripts/uat/seed-large-schema-fixtures.sh all` 已造 50 表×400 字段，规模不低于 `UAT-SCALE` 下限；延迟注入可用。

### 步骤

1. 注入每次 SQL 约 6000ms 延迟，使首轮调度预算 10000ms 耗尽。
2. 经真实预览 API＋真实客户端 `readCheckedTableColumns`（`src/lib/prepareSchemaStructure.ts`）读全部表。
3. 变体：30 表中 `t0` 权限拒绝，其余合法。
4. 对 84becc34 基线镜像重复步骤 1–3。

### 期望

50 表 20000 字段全部读到；变体中 29 表继续，`t0` 汇总为「有 1 张表没有读到字段」。

### 判定

客户端报「读取表结构没有进展，请稍后重试。」＝`FAIL（预期，复现 FDE-F04）`。

### 清理

撤除延迟注入；宽表种子可保留。

---

## UAT-FDE-05 — 滚动窗口唯一归属（AUDIT-01）

### 前置

R0 PASS；沙箱审计库可写；`lucy-old3a9` 可作 3a9 旧基线；84 基线镜像已建（D3）。**不改系统时钟。**

### 步骤

1. 为同一会话写两条调用：`t1＝now-30d+10s`、`t2＝now-30d+50s`（间隔 40 秒，小于默认 120 秒簇间隔）。
2. 触发重建，确认形成 1 个问询。
3. 真实等待约 35 秒，使 `t1` 滑出 30 天窗口、`t2` 仍在窗口内。
4. 写入当前时刻的另一会话调用，再触发重建（维护器与读时重建各一次）。
5. 请求两个问询详情、调用流水、问询列表。
6. 对 3a9 容器、84 镜像、候选依次执行。

### 期望

`t2` 只属于一个问询；详情编号与调用流水一致；`t1`、`t2`、新调用共 3 条始终保留。

### 判定

`t2` 同时属于两个问询、两详情均 200 但编号 1／2＝`FAIL（预期，复现 FDE-AUDIT-01）`。三向结果与 FDE（3a9 红／84 绿／当前红）比较，分叉记入跑次。

### 清理

清除沙箱审计数据。

---

## UAT-FDE-07 — 正向结论复核

### 前置

R0 PASS；候选 L2 镜像。

### 步骤

1. 跑 `UAT-SUITE-INFERRED-REBUILD-RECOVERY` 的 IRR-01–04。
2. 跑 `UAT-SUITE-COLD-START-SLOW-DISK` 的 COLD-01／02 与 `UAT-SUITE-REBUILD-PROBE-BUDGET` 的 RPB-01–03（RPB 按既有「≥3 次独立冷启动」口径）。

### 期望

IRR 沿用该套件期望；性能按 FDE 阈值：livez max ≤1000ms、p99 ≤400ms，diff p95 ≤3000ms，五路无 3 秒超时。

### 判定

跑次注明本机 arm64 原生、FDE 为 amd64 仿真，数值不可直接对比；不据本机结果推断 amd64 表现。

### 清理

按各既有套件约定。


## 修复候选复验模式（已确认，待执行验收；原 UAT-FDE-* 不改写）

本节对应 P1-57／REQ-030-078 与 [整改 Plan AR-01–AR-10](../../../../plans/lucy-20261119-fde-acceptance-remediation-plan.md)。每条均为新模式必做。所有步骤须记录实际请求、响应与产出物；本轮未执行，仍以 INDEX 最近跑次为现值。

| ID | 步骤与规模 | 期望与证据 | 不通过时 |
|---|---|---|---|
| UAT-FDE-FIX-R0 | 在独立 Docker 运行干净修复候选；记录完整 SHA、gitDirty、image ID／architecture、四处运行源码哈希；确认含 d8c3f097 与整改代码、具备公开测试配置和隔离数据 | `gitDirty=false` 且源码／镜像一致；历史红证据的 SHA 明确。不要求把当前修复候选冒充原 3b1c62af，也不要求无关历史镜像反复重建 | 身份缺失／不一致时 BLOCKED，后续不得主张 PASS |
| UAT-FDE-FIX-R1 | 核对总账 R1／R2／G1–G6／SK1–SK4 与功能验收的映射；逐个记录剩余 skip 的合同与责任 | 每个旧回归要么真实等价证据，要么具名开放项；空断言不算恢复。L1、真实 UAT、受控降级分列 | 必做行为仍无证据则保留未完成；不能以登记代验证 |
| UAT-FDE-FIX-01 | 独立干净实例经正常初始化与真实调用形成审计账本、投影和修订基线；真实 lag／追平、S 后新增事件、持续未追平与 diagnostic 对照；CSV／ZIP 均走正式 HTTP | 追平／S 后事件场景正式导出 200；内容与 manifest、上界 S 一致；持续未追平仍拒绝。diagnostic 不能代 complete；记录基线与缺失集合 | 普通初始化不能建立基线则 FAIL／BLOCKED；不补假基线。进度替身仅按已授权规则先真后降级、明确标记 |
| UAT-FDE-FIX-02 | 真实外部目录：慢合法首拒约 7100ms、后两步各约 100ms；快速拒绝后成功、真超时、连接关闭对照 | 预算内真实读到字段且关闭连接；真超时与连接故障不伪装成功；保留每个 SQL／调用时长和列数 | lab 不具备真实拒绝时先记 BLOCKED；D5 确认后才可指定 SQL 拒绝注入，分列受控降级 |
| UAT-FDE-FIX-03 | 真实预览 HTTP 的单表请求，19 秒 envelope／10 秒调度预算；构造预算耗尽，真实客户端多轮读取；同批其他合法表继续 | 首轮 200 且 deferred 点名；单表连续两次无进展后有点名失败、其他表继续；不得空成功或无限重试；逐响应≤20秒 | HTTP／client 步骤无法构造则 BLOCKED，不用纯 mock 冒充 |
| UAT-FDE-FIX-04 | 真实 50×400 表字段＋延迟代理，含连续截断变体；再运行 30 表 t0 真实权限拒绝／其余合法，实际客户端因预算缩批后遇单表拒绝；直接单表请求另作对照 | 50 表 20000 字段；30 表均被访问、29 表字段读完、最后只汇总 t0。直接单表仍 400；已知表级拒绝可继续，平台鉴权／未知故障中止；逐响应≤20秒 | 改错客户端／mock rejections 不算真实路径。D5 如获确认，仅指定拒绝可受控注入，成功字段必须真实 |
| UAT-FDE-FIX-05 | 独立审计库先真实构造跨 30 天边界簇；真实等待约35秒，触发后台维护器与读时重建适用路径；比对详情、列表、流水及原始日志；另以已有重复状态检验单次重建自愈 | 每次调用恰一个归属，编号沿用，详情与流水一致，原始日志不丢；如读时重建默认关闭，记录配置并只在隔离用例按原合同启用，不改变默认部署 | 小样本通过不代满量；O3 批量标脏不在范围。缩短窗口先真后按已有授权降级 |
| UAT-FDE-FIX-06 | 真实 600 表 `uat_fde_progress`：前50张合法宽表1500列、后550张30列；确认 MySQL lab 的 MyISAM 可支持该宽度；延迟使批次缩至≤5后撤除；同一个真实客户端读完；另跑正常600×30和MySQL1200表原规模用例 | 精确600表／91500字段；请求>100仍持续成交；单响应≤20秒；正常夹具保留原阈值，注入／恢复时长单列；不能为求绿减表数、少读字段或强制改变客户端内部初始批次 | 宽表或时序构造不了则 BLOCKED；L1 600单表替身只作自动化，不补成真实 UAT PASS |
| UAT-FDE-FIX-07 | 同一干净候选，以 P1-47 满量合成夹具构造现存多级跨界问询与交错会话；三次独立冷启动，每次就绪后120秒；复跑 IRR／COLD／RPB 适用完整用例 | 闭包读取精确、唯一归属／编号沿用、闭包外既有问询与关联未删、页／片预算仍生效；livez max≤1000ms／p99≤400ms，readyz p99≤1500ms，3秒观察器连续失败<6；其他原套件阈值不放宽 | 旧镜像 PASS／无跨界样本不抵本项；不得靠放宽探针或暂停默认维护器放行 |
| UAT-FDE-FIX-08 | 真实 Public MCP initialize、tools/list 与授权 lucy_query；查询使用既有固定 demo 结果，另作无权限拒绝；核对原单表与常规批量读 | MCP 合法查询与基准匹配；拒绝仍生效且既有下一步可达；不以初始化200代替查询成交，不以管理员查询代无宿主 MCP | 主路径失败直接 FAIL；不归为缺可选宿主 |

清理：删除临时连接、拒绝／延迟代理规则、隔离容器；保留 uat_ 夹具仅供复跑。不得清空 demo 数据或补造审计证据基线。任一必做项无法全真且无适用授权，停表记 BLOCKED；L1 新增断言与本表结果不混计。
