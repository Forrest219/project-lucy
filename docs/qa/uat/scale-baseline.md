# 全局 UAT 模拟数据规模基线（Scale Baseline）

| 元数据 | 内容 |
|---|---|
| 定位 | **全局 UAT 水位 SOT**：所有套件造数与「环境是否够格开跑」的统一下限；不替代各套件 `fixtures.md` 的用例级细节，各套件 fixtures 引用本文件不得另写一套数 |
| 生效日期 | 2026-11-23（委托人确认口径：500 Agent／200 正式角色／2000 表／300 Wiki／100 Skill） |
| 状态 | 生效中；**任何维度不得降低**；提高须更新本文件并在 INDEX 当次跑次注明 |
| 判定属性 | 基线是「开跑前置＋造数目标」，不是 UAT 结果；结果判定仍以各套件 `cases.md` 与 INDEX 为准 |
| 自动化断言 | 仓库 `scripts/uat/check-uat-scale-baseline.mjs`（只读 COUNT，退出码 0＝达标） |
| 既有标定 | 与 [`suites/roles-agent-concurrency-scale/fixtures.md`](suites/roles-agent-concurrency-scale/fixtures.md) 冻结向量、[`suites/large-schema-ingestion/fixtures.md`](suites/large-schema-ingestion/fixtures.md) 规模下限**同口径对齐**，不另立第二套 |
| 环境档位 | 本机 Docker 有 **两档**（lean／scale），开跑前按套件选型；见 §0 |

## 0. 环境档位选型（lean／scale）

本机默认 compose **同一套** `deploy/compose/docker-compose.demo.yml`，按 seed 深度分成两档。**不是**两套独立产品环境；是同一栈上的两种水位。开跑前按套件 `fixtures.md`／INDEX「必做环境」选一档并写进跑次。

| 档位 | 入口 | 规模（约） | 适用 | 不适用 |
|---|---|---|---|---|
| **lean**（默认） | `npm run demo:upgrade` | 模板：约 3 角色／数个 Agent／1 Wiki／少量 Skill／superstore 业务表；**无**百万审计、**无** 2000 表夹具 | 功能烟测、P0 问数六套件多数、连接重载、按钮／复制、页面打开等**不依赖规模前置**的套件 | 凡 `fixtures`／CONVENTIONS 要求全局规模基线的用例 |
| **scale**（全局 UAT 水位） | `npm run demo:upgrade:scale` 或 `npm run uat:scale-baseline:ensure` | §1 下限：500 Agent／200 角色／2000 表／300 Wiki／100 Skill／窗内 20 万·全历史 100 万审计 | 规模／并发／大 Schema／读韧性／自愈／MCP-PERF 等**开跑前置**须 `uat:scale-baseline`＝0 的套件 | 想保持可读小 ACL、快速 `--fresh` 烟测时 |

选型规则：

1. 套件未写规模前置 → 默认 **lean**；写了「全局规模基线／`uat:scale-baseline`」→ 必须 **scale**，未达标记 `BLOCKED`，不得缩夹具凑绿。
2. 两档可共卷演进：先 lean 日常开发，需要时一次 `demo:upgrade:scale`；之后无 `--fresh` 的平滑升级**保留** scale 水位（marker＝`/data/lucy/.lucy-scale-seed`）。
3. `--fresh` 回到 lean 模板；要再上 scale 须带 `--scale` 或重跑 ensure。
4. **MCP-PERF**（§1.1）是 scale 之上的专项 profile，不单独成第三默认档；未装断言前相关用例 `BLOCKED`。
5. 隔离栈（如 `lucy-uat-p18182`）可自选档位，但主张「全局规模已过」时仍须对本卷跑通 `uat:scale-baseline`。

默认端口（两档相同）：WebUI `http://127.0.0.1:${LUCY_DEMO_WEBUI_HOST_PORT:-55176}`；MCP Proxy `http://127.0.0.1:${LUCY_DEMO_PROXY_HOST_PORT:-57881}`。

## 1. 基线总表（下限，不得降低）

| 维度 | 下限 | 计数口径 | 标定依据 |
|---|---:|---|---|
| 配置 Agent 人口 | **500** | `access.yaml` `users:` 全集（含未启用，同 lucy-ops「配置 Agent 人口」口径） | RACS 冻结向量 B=100，500＝5× 设计档 |
| Agent 凭据 | **≥500 个 Agent 各持 ≥3**（合计 ≥1500） | `access.yaml` 持 3+ token 的 Agent 数与总 token 数；固定 3，不随 Agent 倍率重复乘算。基线断言取「足凭据 Agent 数＋总量」，不对共享栈上其它套件的一次性夹具 Agent 做逐 Agent min | RACS 向量 `tokensPerAgent=3` |
| 30 天活跃 Agent | **100** | 窗口（默认 30 天）内去重活跃 Agent，含默认用量∧自追问排除口径 | RACS 向量 B 设计下限 |
| 正式角色 | **200** | `access.yaml` `roles:` 非模板角色；**参考模板另算，不替代正式角色** | B=20 的 10×；委托人 2026-11-23 确认为基线；1000 仅作显式压测扩展档，不进基线 |
| 表（跨夹具库合计） | **2000** | 见 §2 分布；含宽表 | large-schema 下限 1200（MySQL）＋600（Hive）取齐 |
| 其中宽表 | MySQL ≥1 张 **≥1000 列**；Hive 宽表档 1500／1999／2000／3000／5000 列 | `information_schema.columns` 实际列数 | large-schema 既有下限 |
| Wiki 页 | **300** | 仓库 Wiki 全部页（全局＋实例域，每页有 frontmatter `allowed_roles`） | 委托人口径；现网 2 页远低于线 |
| Skill | **100** | skills 根下递归 `.md`/`.markdown` 中 frontmatter 含 `name` 的可解析 Skill 文件（与 `webui/server/skills/loader.ts` 同口径；目录形态不限） | 委托人口径；现网有效 Skill 远低于线 |
| 审计调用行（30 天） | **200,000** | 审计热库调用流水窗内行数，含 80/20 集中分布与边界用例行 | RACS 向量 B 既有演练下限 |
| 审计调用行（全历史） | **1,000,000** | 含窗口外历史（31–365 天） | RACS 向量 B |
| 业务种子数据 | superstore_orders **≥1000**、returns **≥60**、people **≥4** | `gen-demo-data.mjs` seed=42 生成基线（`_baseline.json` 为准） | 既有 demo 种子，主可答数据集 |

### 1.1 MCP 问询性能 profile（MCP-PERF）

> 登记于 2026-11-23（委托人授权补充）。本 profile 是 [P1-78](../../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) 持续压力与长追问的**专项下限**，不放宽、不替代 §1 全局下限；全局下限仍对所有套件生效。

| 维度 | 本 profile 下限 | 计数口径与核验方式 |
|---|---:|---|
| 压测 Agent 身份 | **50** 个可发起真实 Public MCP 问询的独立身份 | 自有 Token、具名 Agent ID、运行时可核对角色绑定；至少 2 个绑定正式 `lucy_admin`，其余按受限角色分组。**不得**由单个直连脚本轮换同一 Token 冒充 50 个身份 |
| 审计调用行（全历史） | **≥1,000,507** | 视图／独立 SQL 实测；seed 造数后复核 |
| 审计调用行（30 天窗内） | **≥200,498** | 同上；含边界行余量以吸收切边漂移 |
| 30 天活跃 Agent | **≥499** | `ops_calls` 视图 distinct `agent_id`（默认用量∧自追问排除口径） |
| 最热单 Agent（窗内） | **≥40,100**（窗内约 20%） | 按 `agent_id` 聚合窗内行数 |
| 集中与边界形态 | 80/20 集中、窗边界前后各一条、同毫秒不同 id、无历史 Agent、仅 90 天前活跃 Agent **全部落齐** | 逐项以视图或独立 SQL 核对存在且归属正确 |
| Wiki | **≥300** 页，且 KTX 索引覆盖 | 另须 `wiki_search` 真实命中合成标记；仅数文件或索引行不算 |
| Skill | **≥100** 个（loader 同口径） | 另须 `lucy_skill_read` 真实读到指定 Skill |
| 正式角色 | **≥200**，含 `lucy_admin` 全局角色与受限角色 | 运行时生效绑定、全局 Source 集合与跨连接正确查询须核对 |
| 表 | 沿用 §2 跨夹具 **≥2000**（含宽表） | 口径仍由 P1-34 拥有 |
| 持续压力到达模型（设计值） | 思考时间＝**截断正态 μ=60 秒、σ=20 秒、截断 [20 秒, 120 秒]**；有效窗口 **12×150 秒**；题档占比 **simple 60%／complex 40%**；思考时间随机种子固定整数 **20261124**（跑次证据记录，同候选族跨跑次不变） | P1-78 判定器从本节读取并写入证据（Spec D23⑥）；期望每窗口每档到达量须 ≥20、每个长链身份在**完整 1800 秒有效窗口内**的计划到达 ≥21（不是每个 150 秒窗口；按上列参数：50 身份×150÷60≈125 次／窗口，complex≈50、simple≈75；单个长链身份 1800÷60≈30 次／全窗口）。**设计值，非实测**：由委托人在 baseline-seed 后具名冻结，冻结前 P1-78 只产生 `SEED_ONLY`；不得随失败样本调整 |
| 长链实例（P1-78 `LONG_FOLLOW`） | 50 身份档 **≥5 个链实例**（`ceil(0.1×50)`），覆盖 `lucy_admin`、受限角色 A、受限角色 B 各至少 1 个 | 模板由 P1-79 提供；链实例＝模板×身份×`runId`（Spec D20）；身份分布仍沿用「压测 Agent 身份」行 |

- **造数与断言**：沿用 §4 三件套（`uat:scale-baseline:seed:access｜wiki-skills｜audit`）与 `npm run uat:scale-baseline`；本 profile 的精确向量与 50 身份断言需扩展 `scripts/uat/check-uat-scale-baseline.mjs`，属测试基建改动，需独立开发授权后落地。到达模型与长链实例两行不是库内计数，由 P1-78 判定器读取并在开跑前做样本可达性校验，不进入该断言脚本。
- **未达标时**：P1-78 的 `SOAK`／`LONG_FOLLOW` 记 BLOCKED，不得缩规模、换身份或用直连脚本替代开跑。
- **备份与还原**：①② 改配置／Wiki 前自动备份，改动前卷内留副本；demo 基座的无关角色、Agent、凭据与业务数据不得被覆盖。

### 1.2 客户超标稳定性基线档（`customer-stability`）与常规伴随哨兵门禁

> 登记于 2026-11-26（委托人确认：未来 UAT 基准线须高于已知客户现网水位，并将外部拨测升级为常规伴随门禁）。本档位是对标客户现网（8 连接／25 Schema／2691 张已发现表／Helm 默认 `2C / 2Gi`）按 **1.2×–1.3×** 抬升后的稳定性前置与门禁，通过 `node scripts/uat/check-uat-scale-baseline.mjs --profile customer-stability` 校验，不降低 §1 与 §1.1 任何既有下限。

| 维度 | 本 profile 下限 / 红线 | 已知客户现网参考 | 计数口径与核验方式 |
|---|---|---|---|
| 数据连接数 | **≥ 10** | 8 个连接 | `ktx.yaml` `connections` 键数（含 `driver`/`username`/`schemas`/`enabled_tables` 完整契约） |
| Schema 数 | **≥ 30** | 25 个 Schema | `semantic-layer/<conn>/_schema/*.yaml` 文件计数（与 `webui/server/semantic-layer.ts` 真实加载口径一致） |
| 跨源已发现表数 | **≥ 3500** | 2691 张表 | MySQL + Hive（及扩展夹具库）合计表数；仅靠 MySQL 不足时须启用 Hive 或 XL 档，不再以 `SKIPPED` 放行 |
| 容器资源上限 | **CPU ≤ 2 核、内存 ≤ 2Gi** | Helm 默认 `2C / 2Gi` | Docker `HostConfig.Memory` / `NanoCpus` 只读校验；防止本机大内存掩盖 V8 Full GC 与 OOMKill |
| 常规伴随哨兵门禁 | **`stability-sentinel.mjs --mode=gate` 退出码 0** | 外部 `monitor.log` 拨测 | 压测／Soak 期间以 **15s** 频率全程采样 `/api/livez`、`/api/readyz`、`/api/health`（含顶层 `data.uptimeS`、`selfHeal`、`eventLoop.{p99Ms,maxMs}`、`displayBusy.{busy,graceServes}`、`mcpCapacity`）及周期性 `/api/auth/login`（`1883-soak` 自动注入隔离栈管理员 0600 凭据；`mip-uat` 透传 `LUCY_SENTINEL_ADMIN_ID`/`PASSWORD_FILE`）；任一非预期 502/503、`readyz != 200`、登录失败、`uptimeS` 回退、`selfHeal.phase !== normal`、连续 3 轮 `eventLoop.p99Ms > 250ms` 或单次 `maxMs > 1000ms` 判 FAIL（单纯 `health.status=degraded` 且 `readyz=200` 仅作观测统计，不误杀预期 KTX reload 窗口） |

- **双模式复用**：`scripts/uat/stability-sentinel.mjs` 同时支持 `--mode=observe`（线上 30s 观测，输出 JSONL 与单行告警）与 `--mode=gate`（UAT 15s 伴随门禁，输出 `summary.json` 并按红线返回退出码 0/1），消除线上拨测与 UAT 门禁的观测割裂。
- **压测叠加动作**：在 `customer-stability` 稳定性 Soak 期间，需叠加「多连接并发刷新 + 问数并发」，以复现并拦截连接刷新与事件循环阻塞叠加触发 P1-81 看门狗摘流/重启的退化。

## 2. 表分布口径（合计 ≥2000）

| 夹具库 | 下限 | 结构 |
|---|---:|---|
| MySQL `uat_scale_mysql`（demo-db） | 1200 | `t_00001…t_01200` × 10 列 ＋ 宽表 `w_1000`（1000 列）；可选 XL 档 `uat_scale_mysql_xl` 12000 张 × 3 列 |
| Hive `uat_scale_hive`（HMS＋HS2，经 Doris 外部目录） | 600 | `t_0001…t_0600` × 30 列 ＋ 宽表 `w_1500／w_1999／w_2000／w_3000／w_5000` |

- 表数按元数据对象计（大 Schema 接入验的是元数据规模，行数不设下限）；**行量水位由「审计调用行」与「业务种子数据」两维兜底**，不得用「表多但全空」冒充达标。
- 造数入口：[`scripts/uat/seed-large-schema-fixtures.sh`](../../../scripts/uat/seed-large-schema-fixtures.sh)（幂等）。

## 3. 与既有标定向量的关系（防止第二套口径）

- Agent／角色／凭据／行量／到达率：`UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE` 冻结向量 B 为唯一标定源；本基线取 **B 或 5× 档**，RACS 套件内部仍可跑 2×／5× 组合压测，不受本基线约束。
- 角色基线 200：高于 RACS 5× 档（100），低于压测扩展档（1000）；RACS 页性能预算（RPB-W3 API ≤200ms／RPB-W2 页 ≤500ms）须在 200 角色夹具下复测通过后，本基线才算「可开跑」。
- 表／宽表：`UAT-SUITE-LARGE-SCHEMA` 下限不得降低的既有口径不变，本文件只做跨库合计。

## 4. 自动化断言与造数

断言（开跑前置）：

```bash
npm run uat:scale-baseline            # 只读 COUNT，逐项 EXPECTED/ACTUAL
node scripts/uat/check-uat-scale-baseline.mjs --strict   # SKIPPED（如 Hive 未起）也判非零退出
```

**推荐入口（幂等，避免每次手工初始化）**：

```bash
npm run demo:upgrade:scale            # 平滑升级镜像后 ensure 水位；已达标则跳过
npm run uat:scale-baseline:ensure     # 仅 ensure（栈须已 healthy）；--force 强制重灌
```

- 默认 **lean demo 模板不变**；规模档是显式 opt-in（`--scale`／`demo:upgrade:scale`），不是默认 seed。
- ensure 顺序：MySQL 大 Schema → access → Wiki／Skill → 审计行 → 只读复核 → 写 marker `/data/lucy/.lucy-scale-seed`。
- 后续 `npm run demo:upgrade`（无 `--fresh`）保留卷内水位；`--fresh` 清掉 lucy 数据卷后需再带 `--scale` 或再跑 ensure。
- Hive 默认不灌（基线允许 SKIPPED）；设 `UAT_SCALE_INCLUDE_HIVE=1` 才灌。

造数三件套（幂等；固定 seed=20261123；凭据均为一次性实验口令，仅限本机；一般由 ensure 编排，不必手敲）：

```bash
node scripts/uat/seed-scale-access.mjs        # ① access.yaml：200 角色／500 Agent×3 凭据（停→备份→写→启）
node scripts/uat/seed-scale-wiki-skills.mjs   # ② Wiki 300 页＋Skill 100 个（停→写→启，KTX 重启索引）
node scripts/uat/seed-scale-audit-rows.mjs    # ③ 审计行：窗内 20 万＋余量／全历史 100 万（不停机，VACUUM INTO 备份＋WAL 灌库）
```

- ①② 改配置/Wiki 需重启生效（`ensurePolicyRuntime` 与 KTX 索引均在启动时重建）；③ 走 `access_log` 主表，视图即时可见，无需重启。
- 审计行量两项与 30 天活跃 Agent 在断言脚本中分别按 WARN／FAIL 判定：行量未达标归 RACS 套件造数后复核；活跃 Agent 为本基线对象计数，缺即 FAIL。
- 共享 demo 栈上其它套件的一次性夹具（如 UAT-CTX 的 `ucda-*`）不参与逐 Agent 凭据 min 判定，基线只看「足凭据 Agent 数 ≥500＋总量 ≥1500」。
- 退出码：0＝已检查项全部达标；1＝有缺口；2＝环境不可用（Docker 未起或目标容器缺失）。

## 5. 维护规则

1. **不得降低**任一下限；发现达标成本过高时，走委托人变更确认后改本文件。
2. 造数脚本必须幂等、固定 seed，产物可重生成；夹具口令仅限本机实验（同 [`large-schema-ingestion/fixtures.md`](suites/large-schema-ingestion/fixtures.md) 约定）。
3. 新增规模维度（如连接数、到达率）或专项 profile（如 §1.1 MCP-PERF）先登记进本表再进套件 fixtures；套件只引用，不复制第二套数字。
4. 密钥与凭据只写文件路径，禁止把 token／密码写入本树、inbox、截图说明或回复。

## 6. 受影响画像

| 画像 | 影响 | 说明 |
|---|---|---|
| 问数方 | ＝ | 纯测试夹具，不触问数主路径 |
| 治理方 | ↑ | 角色／Agent 规模上到 200／500 后，页性能与 ACL 编译成为必验项，覆盖显著增强 |
| 运维方 | ↑ | 运维问数（lucy-ops）连接获得非空数据，Q4/Q5/Q6 类用例不再以空库冒充通过 |
| 管理层 | ＝ | 无直接影响 |
