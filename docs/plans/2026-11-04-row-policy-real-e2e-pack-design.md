# 行权限真实 e2e 审判包设计（强度 B · 本机 · 两阶段）

| 字段 | 值 |
|------|-----|
| 状态 | 设计已批准（2026-11-04） |
| 强度 | B：ROW25-V01…V22 + RTP25-01…10 + RTV25-01…08 + Security BY-01…19 |
| 环境 | 本机 `prepare-environment`；**不做**客户 K8s |
| 上游门 | 同 run 两阶段（先关后开） |
| 夹具策略 | 方案 2：独立审判包（fork security-e2e 结构，**数据面改绑线上 RDS 只读**） |
| 数据面 | 阿里云 RDS MySQL（AI Workspace「演示环境配置」）；账号 `cw_rds_bot` **只读**；**禁止**对本库 seed／DDL／DML |
| 权威需求 | [`lucy-20261022-v2p5-row-permission-management-spec.md`](../specs/lucy-20261022-v2p5-row-permission-management-spec.md) §9；[`lucy-20261025-v0p25-row-policy-templates-and-view-spec.md`](../specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md) §8；[`v025-coverage.yaml`](../../scripts/e2e/contracts/v025-coverage.yaml) ACCESS 旁线；`scripts/e2e/security/row-policy-cases.mjs` BY-01…19 |

本条收口不表示可上线。本设计只授权「本机真实一推一」的夹具与执行形态，不改功能合同状态。

---

## 1. 目标与通过线

### 1.1 目标

在本机一次准备好的 Lucy 真实实例上，对行权限做强度 B 的真实一推一：管理面写／预览／按表反查与 MCP 数据面允许／拒绝同源，且 Security BY 旁路矩阵与 ACCESS 执行 id 共用同一审判包种子。

### 1.2 通过线（硬）

1. 每个 execution id（`ROW25-*`／`RTP25-*`／`RTV25-*`／`BY-*`）有且仅有一个断言所有者；`coversV025`／`covers` 禁止挂名不验。
2. 两阶段（Gate-Off → Gate-On）都必须按各自断言集合通过；任一阶段失败 → 整轮失败。
3. `blocked`／`skip`／`not_run` **不算通过**。客观缺能力（见 §5）可记 `blocked`，但 **不得** 宣称「强度 B 通过」。
4. 禁止用 mock 浏览器契约（`webui/tests/e2e/specs/p1-row-policy.spec.ts` 等）折算为 B 证据。
5. 禁止在客户签署路径上留下 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN=1`；本轮验证实例可临时打开，与 Gate C「签署前关闭」解耦。

### 1.3 非目标

- 客户 amd64／K8s 台上验收。
- 方案 C 的独立维护线工程扩张（V19／V22 能在本机 Docker Linux 卷跑则纳入；否则 `blocked` 并挡 B 通过）。
- 改写功能 Spec 或把 vitest 结果升格为 e2e 通过。

---

## 2. 架构

### 2.1 独立审判包

新建目录（名称冻结）：

```text
examples/row-policy-e2e/
  project-template/     # ktx（mysql-aliyun）、semantic-layer（superstore_*）、wiki（最小）、webui/config
  gold/                 # 只读推导的基线／集合形状期望（无 seed.sql 写库）
  README.md             # prepare／两阶段／RDS 只读边界／与 security-e2e 的边界
```

从 `examples/security-e2e` fork **结构**（Role／Agent／runner 形状），但：

- **删除** 对本包无用的双库 Postgres seed／`marketing_daily` 主路径；
- **改绑** `mysql-aliyun` + `dataforai.superstore_*`；
- **不提供** 会对本 RDS 执行写入的 `db/seed` 流程。

`examples/security-e2e` 继续服务非行权限 SEC；**不再**作为 ROW25／RTP／RTV 的主证据源。

### 2.2 执行与契约落点

| 部件 | 职责 |
|------|------|
| `scripts/e2e/lib/row-policy-pack.mjs` | 包身份、表／Role／Agent 常量、id→断言注册表、阶段切换 API |
| `scripts/e2e/lib/access-v025.mjs` | 保留 ROW25 描述符；步骤与注册表交叉校验（单测防漂移） |
| `scripts/e2e/lib/row-policy-templates-v025.mjs` | RTP／RTV 描述符同上 |
| `webui/tests/real-e2e/row-policy-v025.spec.ts` | 重写：仅声明自己真正断言的 ROW25 id |
| `webui/tests/real-e2e/row-policy-templates-v025.spec.ts` | 重写：RTP／RTV 逐条或按注册表分测，禁止一次 `coversV025(...全部)` |
| `scripts/e2e/security/row-policy-cases.mjs` | BY 改绑审判包 Token／Agent；判词表不变 |
| `scripts/e2e/prepare-environment.mjs` | 增加 `--pack row-policy`（或等价），指向审判包模板 |
| `scripts/e2e/run-row-policy-b.mjs` | 一键：prepare → 阶段 Off → 阶段 On → 汇总；双阶段全绿才 exit 0 |

### 2.3 数据流

```text
prepare(--pack row-policy)
  → runDir（实例 + secrets + gold + seed）
  → Phase Gate-Off（proven=0）
       → BY 未证明拒绝 + ROW25-V18 等
  → Phase Gate-On  （proven=1，同实例热切换或等价重启同 volume）
       → 允许／过滤／并集／交集／模板／反查／BY 正例
  → collector：分阶段证据 + 总判定
```

预览 API、行权限视图、运行时 `forced_filters` 必须读同一 `policyVersion`／snapshot 身份；draft 预览走内存候选（V12／V13），不得要求先落盘才有预览。

---

## 3. 夹具矩阵

### 3.1 数据面（2026-11-04 修订：选项 1 · RDS 只读）

- **连接 id**：`mysql-aliyun`（与 AI Workspace／现网草稿一致；同 host 不得再建第二 MySQL 连接）。
- **主机**：`rm-bp1q2ui29c6268t8wro.mysql.rds.aliyuncs.com:3306`（备用 IP 见 Workspace 连接草稿）。
- **账号**：`cw_rds_bot`；密码仅 `file:.ktx/secrets/mysql-aliyun-password`（或 prepare 注入的等价 Secret 文件）；**禁止**把密码写进仓库、审判包 YAML、日志或证据。
- **权限**：仅 `SELECT`／`SHOW` —— 本包 **不做** `apply-db`、不建表、不改行；gold 从现网只读聚合推导或固定「期望集合形状」（如 distinct Region ⊆ 授权集合），不得假设可写入种子行。
- **真相表**：`dataforai.superstore_orders`（现网 COUNT≈10194）。
- **行维度字段**：`Region`（列名以库内为准；语义键按现网 overlay）。
- **现网取值（2026-11-04 实测）**：`华东`／`中南`／`华北`／`东北`／`西南`／`西北`。  
  审判包谓词与断言 **改用中文区划**，废除 security-e2e 的 `East`／`West` 字面量（除非某辅助表确有英文区划）。
- **默认对照对**：受限臂 A＝`华东`，受限臂 B＝`西南`（行数足够、互斥；对应旧设计 East／West 角色）。
- **第二启用表（不授权给受限 Role）**：`dataforai.superstore_returns` 或 `dataforai.superstore_people`（须在 ktx `enabled_tables` 中启用，但 scoped Role 的 tableSelectors **不**授予）——用于「启用表不得扩权」。
- **禁止**：把 `fin-db`／`marketing_daily`／本地 Postgres seed 当作本包主数据面；旧 security gold 问数金额 **不得** 直接拿来当 RDS superstore 的 typed gold（表不同）。

### 3.2 模板

| 模板名 | 内容 | 用途 |
|--------|------|------|
| `tpl_eq_east` | `region eq 华东`（RDS 列名 `region`） | V01、RTP 正例、Role 引用（名可保留 east 语义＝华东） |
| `tpl_in_regions` | `Region in [华东, 西南]`（顺序打乱测 digest） | V02 |
| 故意坏：未知字段／度量／非法 op／不存在名 | 各一条 | V04–V07、RTP 负面 |

`access.yaml` 顶层必须有 `row_policy_templates`（当前 security 模板缺失，本包必修）。

### 3.3 Role／Agent（禁止单 Role 双 selector 并集）

| 主体 | 形态 | 用途 |
|------|------|------|
| Role `rp_east` | scoped → `region eq 华东`（模板或内联） | 单 Role 过滤、BY 正／负例 |
| Role `rp_west` | scoped → `region eq 西南` | 与「华东」组成并集（**两个 Role**；west 名＝西南臂） |
| Role `rp_all` | `row_access: all` | V09「其一全部行」 |
| Role `rp_east_plus_inline` | 模板 + 内联 AND | V03 |
| Agent `ag_east` | role=`rp_east` | 运行时仅见华东 |
| Agent `ag_east_west` | roles=`[rp_east, rp_west]` | V08／V12／BY-10 并集（华东∪西南） |
| Agent `ag_all` | role=`rp_all` | V09 正对照（可见六区） |
| Agent `ag_east_constrained` | `rp_east`（或并集）+ Agent `constraints` 收紧到与角色谓词可交／不可交 | V10（交集非空）／V11（交集为空 → 不可满足） |
| 缺失模板引用／未知 roleId | 配置或 API 构造 | V04、预览拒绝 |

未授权表拒绝（启用表不扩权）与「未知 roleId 预览拒绝」保留为独立断言，**不得**再冒充 V04／V05；可挂既有 SEC catalog id（若有）或审判包内非 ROW25 辅助项，并在注册表单列。

### 3.5 typed gold／允许断言（只读约束下）

- **允许路径**：断言结果行的 `Region` 集合 ⊆ 授权集合（如仅 `{华东}`；并集为 `{华东,西南}`）；且集合非空（对照 `ag_all` 能看到授权外区划，证明不是空表假阳性）。
- **拒绝路径**：仍用原因码／空行／Access denied；不依赖可写 canary 行。
- 若需金额类 typed gold：仅允许对 **现网只读查询** 算出的基线（写入 runDir `checker/gold.json`，0600），且生成脚本不得要求写库。

**废除** security 夹具里「同一 Role 两条 tableSelector 拼 East∪West」的写法；该写法已导致 `row_grant_conflict`，不得再作为并集载体。

### 3.4 与旧 covers 的纠偏（必须在实现计划中落地）

| 现状假挂 | Spec 真义 | 本包正确所有者 |
|----------|-----------|----------------|
| V09／V10 挂在「East vs all」对照 | V09=其一全部行并集；V10=个人行限制交集 | 独立用例，用 `rp_all`／`constraints` |
| V04／V05 挂在「未授权表 + 未知 role」 | 模板不存在／字段不存在 | 模板／目录失败用例 |
| 一次 `coversV025(...RTP全部, ...RTV全部)` | 每条 RTP／RTV 自有断言 | 拆测或注册表驱动逐 id |

---

## 4. 两阶段门控

### 4.1 阶段 Gate-Off

- `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN` 关闭（或未设置）。
- **必须通过**：凡 scoped 源上的允许型调用均失败关闭，原因含 `row_policy_upstream_unproven`（V18、BY-09，及注册表标明「未证明拒绝」的 BY／ROW 项）。
- **禁止**：把「被拒绝」写成 allow 通过；禁止跳过本阶段直接 Gate-On。

### 4.2 阶段 Gate-On

- 同 runDir 实例打开 proven（热切换优先；若产品只认启动时环境变量，则同 data volume 重启并校验 policy／seed 未丢）。
- **必须通过**：`ag_east` 只见 `华东`、不见 `西南`；`ag_east_west` 见 `华东∪西南`；`ag_all` 至少还能看见授权外区划（证明非空表假阳性）；个人限制交集与预览一致；模板展开 digest 稳定；RTP／RTV 页面与 API 同源表键；BY 正例（如 BY-01、BY-10）在 proven 下走允许分支。

### 4.3 汇总

- 证据分目录：`evidence/phase-off/`、`evidence/phase-on/`。
- `run-row-policy-b.mjs` 仅当两阶段均无失败且注册表内无「应跑未跑」时 exit 0。
- 总报告显式列出每个 id 的阶段归属与结果；禁止只报告「文件级 passed」。

---

## 5. 例外与能力缺口

| 项 | 处理 |
|----|------|
| V15（审计故障注入） | 审判包内接最小 fault harness；接不上 → `blocked`，**挡** B 通过 |
| V19／V22（大小写敏感 FS） | 优先在本机 Docker Linux 卷执行；本机 APFS 上不可证 → `blocked`，**挡** B 通过 |
| mock UI（`p1-row-policy` 等） | 保留作契约回归，不计入 B |
| 客户 K8s | 不做 |

「挡 B 通过」＝汇总器不得输出强度 B 通过；可输出「部分维度完成」供调试，但文案不得写成验收通过。

---

## 6. 证据与质量门

1. `scripts/e2e/__tests__/` 增加注册表守恒：每个 ROW25／RTP／RTV／BY id 恰好映射一个 owner 文件＋函数（或明确的 phase 列表）。
2. `real-e2e-guard`：审判包 spec 禁止 `page.route` mock。
3. 单测断言：`coversV025` 参数集合 ⊆ 该测试体内真正调用的 `assertion(...)` 所绑定的 id 集合（能静态扫则静态扫，否则约定审查清单 + 抽样门禁）。
4. 术语与选择器遵守现有 WebUI 术语标准与 selector contract；本包新增 testid 必须先登记。

---

## 7. 实施顺序（设计层，非计划细节）

1. 落地 `examples/row-policy-e2e`：ktx／语义层绑 `mysql-aliyun`+`superstore_*`，access 矩阵含模板与华东／西南 Role；**无写库 seed**。
2. `prepare-environment --pack row-policy` + RDS 密码文件挂载 + 阶段切换。
3. 重写 real-e2e 行权限 spec（纠偏 covers；谓词／断言用中文区划）+ 改绑 BY。
4. `run-row-policy-b.mjs` + 注册表守恒单测 + 只读 gold 生成（可选）。
5. 本机实跑两阶段（连线上 RDS）；修到注册表全绿或明示挡 B 的 `blocked` 清单（V15／V19／V22）。

---

## 8. 决策记录

| 决策 | 选择 | 日期 |
|------|------|------|
| 强度 | B（ACCESS 全量 + BY） | 2026-11-04 |
| 上游门 | 同 run 两阶段 | 2026-11-04 |
| 环境 | 本机，非客户 K8s | 2026-11-04 |
| 夹具 | 方案 2 独立审判包 | 2026-11-04 |
| 并集载体 | 多 Role Agent，不用单 Role 双 selector | 2026-11-04 |
| 数据面 | 线上 RDS 只读（选项 1）；谓词用 华东／西南；不 apply-db | 2026-11-04 |
| 一推一同步面 | **本设计批准范围内**：Strength B／`row-policy` 一推一活库统一引用同一阿里云 RDS 只读面（`mysql-aliyun`／`cw_rds_bot`）；本机 demo Docker 不另起合成库当真源。`run.db.dataPlane=rds-mysql-readonly`；冻结 catalog 里历史 `postgres` 数据面要求由「已证明的 mysql 只读可达」在本 pack 上满足，不假装 apply-db seed。**最小化范围外**（含 `security-e2e`／mainline `fin-db` 等）**另开计划** | 2026-11-04 |
| RDS 迁移范围 | **最小化**：仅 Strength B／row-policy；`security-e2e` 需库案与 demo **明确不迁**；禁止 `pack=security` 的 SEC-11 当 RDS 证据；扩迁另开计划 | 2026-11-04 |

### 8.1 一推一数据面迁移台账（RDS 同步）

| 路径 | 状态 | 说明 |
|---|---|---|
| `examples/row-policy-e2e` + `run-row-policy-b` | **已切 RDS** | prepare `--pack row-policy` → `dataPlane=rds-mysql-readonly`；拒 `--apply-db`；`markRunReadonlyProven` 活探 |
| `run-security` observation／capability | **已适配** | RDS 面用 `ag_all`／`ag_east` + superstore；`capabilitySatisfied(postgres)` 在 `readonlyProven` 时对本 pack 放行 |
| `ktx` 子进程 | **已适配** | `sanitizeKtxChildEnv` 剥离 `GIT_CONFIG_*`，避免 Cursor 注入杀 ktx |
| `examples/security-e2e` 非行权限 SEC（无活库） | 保持 | 不强制绑 RDS |
| `examples/security-e2e`／mainline 仍声明 `postgres` + `fin-db`／`--apply-db` 的数据案 | **明确不迁（最小化）** | 合成可写／canary／fault 保留；不是跨环境行权限真源。冻结 catalog 中约 **80** 条仍带 `db`／postgres 前置的数据案继续走 `security-e2e`，不在本最小 RDS 收口内迁移。后续若升为「跨环境数据面合同」另开计划，不夹带本收口 |
| SEC-11 错包防护 | **已落地** | `sec11AllowedOnRun` + `run-security`：错包／未 `readonlyProven` → SEC-11 `blocked`；`run-row-policy-b --execute` 调 `assertRowPolicyBDataPlane` |
| Docker demo-db | **非一推一真源** | 仅 demo／冒烟；不得当作 Strength B 证据 |
