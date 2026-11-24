# Cases — UAT-SUITE-COLD-START-SLOW-DISK

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-COLD-R0 | 环境门禁 | 脚本 | `npm run uat:cold-start -- r0 --new-image IMG` | 探到块设备；60MB 直写 ≤ 45MB/s（限速生效）；能清页缓存；镜像身份可读；种子快照在 |
| UAT-COLD-01 | 对照：0.25.0 在同一台限速冷启动台上能起来 | 运行时 | `cold01` | 不退出、重启 0、`/api/health` ≤ 120 秒转 200，之后 60 秒全 200。**不过则 02–05 的结论作废** |
| UAT-COLD-02 | 旧库首次升级：慢盘冷缓存冷启动 | 运行时 | `cold02 --new-image IMG` | 不退出、无 `FST_ERR_HOOK_TIMEOUT`、重启 0、`/api/readyz` ≤ 150 秒转 200；之后 120 秒 livez max ≤ 2000ms／p99 ≤ 1000ms（首次升级补算窗口专用，2026-11-18 放宽），readyz p99 ≤ 1500ms，全 200 |
| UAT-COLD-03 | 已迁移库再次冷启动（Pod 重启） | 运行时 | `cold03 --new-image IMG` | `/api/readyz` ≤ 60 秒转 200；稳态门槛同 02 |
| UAT-COLD-04 | 稳态下页缓存被冲掉（后台轮询冷读） | 运行时 | `cold04 --new-image IMG` | 就绪 20 秒后清页缓存；之后 60 秒门槛同 02 |
| UAT-COLD-05 | 冷启动后合法用户主路径可用 | 运行时＋API | `cold05 --new-image IMG` | 首次升级路径就绪后：管理员认领、`GET /api/project`、建角色／Agent／token、MCP `initialize`、`tools/list`，每步成功且 ≤ 5 秒 |
| UAT-COLD-D1 | 诊断：重建单页冷读耗时 | 脚本（诊断，**不判 PASS/FAIL**） | `pagecost --new-image IMG` | 同一条重建 SQL（LIMIT 400）在限速冷盘／限速热缓存／不限速冷盘下 4 页各自毫秒。改前基线 2695–5902／1–2／21–29。用于解释 02／04 的结果，不是门禁 |
| UAT-COLD-06 | 现场校准 | 发布取证／客户交付 | 客户授权后提供 | fsync 延迟、`audit.sqlite*` 三文件大小、故障启动日志 |
| UAT-COLD-07 | 暂停版首次升级 | 运行时 | `cold02 --new-image IMG --env LUCY_INFERRED_MAINTAINER=off` | 同 02 门槛（放宽首次升级）；MCP 回复通过；**暂停缓解，≠ P1-47 默认 PASS** |
| UAT-COLD-08 | 暂停版重启 | 运行时 | `cold03 --new-image IMG --env LUCY_INFERRED_MAINTAINER=off` | livez max ≤1000ms、p99 ≤400ms；readyz p99 ≤1500ms |

事故对照：2026-11-17 客户升级后，`/api/livez` 1.5–2.2 秒、`/api/readyz` 常 > 3 秒、事件循环 p99 ≈ 2.2 秒、网关 502／503、回滚。本机受控复现：同一库、慢盘冷缓存，0.25.0 33 秒健康，0.30.0 `FST_ERR_HOOK_TIMEOUT` 退出码 1。

---

## UAT-COLD-R0 — 环境门禁

### 前置

Docker Desktop 在跑，`alpine:latest` 与对照镜像可用。已执行过 `seed`。

### 步骤

1. `npm run uat:cold-start -- r0 --new-image <候选镜像>`。
2. 记下脚本打印的块设备、直写速度、两个镜像的 `revision`／`version`。

### 期望

- 直写速度 ≤ 45MB/s（目标 30MB/s 的 1.5 倍内）。快于此说明限速没有作用到该设备，**后续全部 BLOCKED**。
- 页缓存可清。清不了说明没有 `--privileged --pid=host` 权限，**后续全部 BLOCKED**。
- 候选镜像的 `revision` 就是要发布的那一版。

### 清理

脚本自行删除探测卷。

---

## UAT-COLD-01 — 对照：0.25.0

### 前置

UAT-COLD-R0 PASS。

### 步骤

1. `npm run uat:cold-start -- cold01`。脚本从种子快照整卷复制 → 清页缓存 → 带限速启动 0.25.0 镜像 → 每秒采样 `/api/health` → 就绪后再采样 60 秒。

### 期望

- 容器不退出、重启 0。
- `/api/health` ≤ 120 秒转 200，复盘值 33 秒。
- 就绪后 60 秒内 `/api/health` 全部 200。

### 清理

脚本删除运行容器。运行卷留到下一个用例整卷覆盖。

### 备注

本条证明演练台**不是过苛的靶子**：同一台机器上，上一版客户确实能起来。01 FAIL 则台子有问题，02–05 不得出结论。

---

## UAT-COLD-02 — 旧库首次升级的冷启动

### 前置

UAT-COLD-01 PASS。候选镜像已构建，`gitSha` 是被测提交。

### 步骤

1. `npm run uat:cold-start -- cold02 --new-image <候选镜像>`。脚本从**旧 schema** 种子快照整卷复制 → 清页缓存 → 带限速启动候选镜像 → 每秒采样 `/api/livez`、`/api/readyz`（每 5 秒加 `/api/health`）→ `/api/readyz` 转 200 后再采样 120 秒。
2. 读 `inbox/uat-cold-start-<label>/UAT-COLD-02.json` 的 `logFindings`。

### 期望

- 容器不退出、无 `FST_ERR_HOOK_TIMEOUT`／`AVV_ERR_READY_TIMEOUT`、重启 0。
- `/api/readyz` ≤ 150 秒转 200。
- 转 200 之后 120 秒：livez max ≤ 2000ms、p99 ≤ 1000ms（首次升级补算窗口专用，2026-11-18 委托人批准放宽；03／04 仍是 max ≤ 1000ms、p99 ≤ 400ms）；readyz p99 ≤ 1500ms；livez／readyz 全 200。
- 修复后：`logFindings.auditSchemaReady` 非空，含总耗时与 `foreign_key_check` 耗时，且出现在监听日志之前（SC-06）。耗时抄进跑次。**注（2026-11-18 改后跑次实测）：旧库的打开与迁移常在 `recoverSemanticJournals` 之前就已发生，该行恒为个位数毫秒，不能用它读出迁移耗时；迁移量级只能用 02 与 03 的就绪时间差间接估算。**
- 首次升级补算窗口（旧库没有推断问询，等于 67 个用户首次 30 天全量回填）是本条最容易越线的部分；跑次须记录 livez 超过 350ms 的样本时刻，以便对到后台同步段；并抄录 `stats.readyzP50Ms`／`readyzP95Ms`（不判分，用于看占空比让出 SC-17 是否仍在：退化时 readyz 会回到 1.2 秒以上）。
- 监听日志之前不得出现维护器补算的活动（SC-16：首轮扫描等监听之后才启动）；若 02 在 `onReady` 阶段崩溃，先查这一条。

### 清理

脚本删除运行容器。

### 备注

种子库子表为空，`foreign_key_check` 代价被低估。若 `schema ready` 耗时里 `foreign_key_check` 占比显著，须扩种子到子表后复跑。

---

## UAT-COLD-03 — 已迁移库再次冷启动

### 前置

UAT-COLD-02 已跑过，或候选镜像可用。

### 步骤

1. `npm run uat:cold-start -- cold03 --new-image <候选镜像>`。若没有该镜像对应的已迁移快照，脚本先在**正常盘、热缓存**下用候选镜像迁移一次、正常停机、整卷快照。随后从该快照整卷复制 → 清页缓存 → 带限速启动 → 采样。

### 期望

- 同 02 的进程项。
- `/api/readyz` ≤ 60 秒转 200。
- 稳态门槛同 02。

### 清理

脚本删除运行容器。已迁移快照卷保留，`clean` 清除。

### 备注

这是 Pod 重启与滚动升级第二次起来的路径。复盘里「库先迁移完再上慢盘仍崩」正是这一条。

---

## UAT-COLD-04 — 稳态下页缓存被冲掉

### 前置

同 03。

### 步骤

1. `npm run uat:cold-start -- cold04 --new-image <候选镜像>`。启动并就绪后等 20 秒，**不重启**，对宿主 VM 清页缓存，随后采样 60 秒。

### 期望

- 同 02 的进程项。
- 清缓存后 60 秒内：livez max ≤ 1000ms、p99 ≤ 400ms；readyz p99 ≤ 1500ms；全 200。

### 清理

脚本删除运行容器。

### 备注

这条同时打两个后台机制：（1）10 秒轮询：HEAD 的 `id > ? DISTINCT` 是整条索引扫描；（2）启动后全量标脏引发的 30 天整段重建，单页在限速冷盘上同步读 2.7–5.9 秒。

**改前基线的特别处理**：HEAD 在冷启动就崩溃，04 到不了就绪。基线用 `--warm-start`（启动不清缓存，就绪后再清）单独跑，只用于改前对照；**正式门禁不得加 `--warm-start`**。基线结果：就绪后 livez 反复 1.6–9.9 秒，进程不死。

---

## UAT-COLD-05 — 冷启动后合法用户主路径可用

### 前置

UAT-COLD-02 的启动路径（旧库、限速、冷缓存）。

### 步骤

1. `npm run uat:cold-start -- cold05 --new-image <候选镜像>`。就绪后立刻：
   1. `POST /api/auth/bootstrap` 管理员认领；
   2. 带会话 `GET /api/project`；
   3. 建最小角色、Agent、token；
   4. 用 token 对 MCP 代理 `initialize`；
   5. `tools/list`。

### 期望

- 每一步成功，且每步 ≤ 5 秒。
- 任何一步失败说明预热或扫描改动把合法用户主路径变成了不可用，**直接 FAIL**，不得以「约束已生效」抵消。

### 清理

脚本删除运行容器与运行卷里的认领状态（整卷下一用例覆盖）。

### 备注

这是「第一性原理：主路径可用性优先」的对应用例：修复不得以「进程起来了」为唯一标准。

---

## UAT-COLD-06 — 现场校准（发布取证）

### 前置

任务明确要求该项发布取证或客户交付，且已取得现场授权。**我方不对客户实例执行写操作**，也不在业务高峰操作。

### 步骤

1. 请客户在故障或同规格 Pod 内执行 `dd if=/dev/zero of=/data/lucy/.fsync-probe bs=4k count=200 oflag=dsync` 并回传耗时，然后删除该文件。
2. 请客户回传 `ls -l /data/lucy/.ktx-ui/audit.sqlite*`。
3. 请客户回传故障 Pod 启动五分钟的 `[lucy-proxy]`、`[lucy-audit]` 日志。

### 期望

- 回传后据此校准 `UAT_COLD_*` 限速值与种子库规模，再跑 02。
- 明确要求现场校准的任务若缺所需资料，将该项记 `BLOCKED` 并注明具体缺口。产品侧结论依据 R0／01–05。

### 清理

客户删除 `.fsync-probe`。

---

## UAT-COLD-07 — 暂停版首次升级

### 步骤

与 UAT-COLD-02 相同，被测容器加 `--env LUCY_INFERRED_MAINTAINER=off`。

### 期望

- 沿用 02 放宽门槛（livez max ≤2000ms、p99 ≤1000ms；readyz p99 ≤1500ms；就绪 ≤150s）。
- MCP 握手／`tools/list` 成功（可复用 05 子集）。
- **暂停缓解**；不得写成 P1-47 默认配置 PASS。

---

## UAT-COLD-08 — 暂停版重启

### 步骤

与 UAT-COLD-03 相同，被测容器加 `--env LUCY_INFERRED_MAINTAINER=off`。

### 期望

- livez max ≤1000ms、p99 ≤400ms；readyz p99 ≤1500ms。
