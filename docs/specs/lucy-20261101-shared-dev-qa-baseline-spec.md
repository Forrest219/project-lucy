# 共享开发 QA 基准线（三机对齐）Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 工程治理合同 / **v1.1** |
| 日期 / 目标版本 | 2026-11-01 / 不绑定产品版本号 |
| 功能编号 / 优先级 | **无** / **P2**（开发环境对齐）。不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 登记册 |
| 状态 | **v1.1 基线落地闭口（Mac mini／2026-11-01）**。SC-D* 与权威机 SC-L* 关闭；SC-M*（其余两机）未完成，不得宣称三机对齐。分层合同冻结：A／B／C；禁止演示整包升格。本条收口不表示可上线 |
| 决策来源 | 三机开发碎片化；Mac mini 为连接与语义基准意向；`AI Workspace/98-解决方案/9-演示环境配置` 为演示数据面与配置面权威；委托人确认「交集方案、非整包升格」并批准起草；Codex CLI 第 1 轮退回后修订 |
| 需求来源 | 三台电脑代码经 GitHub 同步，但连接与数据问答用例资产因私有 gitignore 漂移；需共用云端 RDS，又不得把演示／POC 全集绑进产品发布门禁 |
| 实施主体 | 仓库文档与私有开发资产同步约定；不改 Lucy 产品运行时语义、不改发布硬门禁命令集（除非另批发布取证） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「Onboarding」「红线」 |
| 外部权威（仓外） | `~/Nutstore Files/AI Workspace/98-解决方案/9-演示环境配置/`（`rds-mysql/` 数据面、`lucy-mcp/` 配置面） |
| 实施计划 | [`docs/plans/lucy-20261101-shared-dev-qa-baseline-plan.md`](../plans/lucy-20261101-shared-dev-qa-baseline-plan.md) |
| 审阅记录 | [`docs/reviews/2026-11-01-codex-review-shared-dev-qa-baseline.md`](../reviews/2026-11-01-codex-review-shared-dev-qa-baseline.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：开发机在数据问答相关对齐上遵守 **A／B／C 分层**；**B 层**为强制公共开发回归核；**C 层**可挂演示与 POC，但不得升格为 Lucy 产品发布硬门禁；连接事实统一为只读 `mysql-aliyun` 指向共享 RDS。出口分三档且不得混用：文档定稿 SC-D01–SC-D08；基线落地 SC-L01–SC-L10；各机套用 SC-M01–SC-M03。
- 本条出口：文档定稿以 SC-D01–SC-D08 为准（本回合可关闭）；基线落地以 SC-L01–SC-L10 为准（S1–S2，另授权后执行）；各机套用以 SC-M01–SC-M03 为准（S3，按机记账，未完成不得宣称「三机已对齐」）。
- 不在本条出口：客户环境发布取证、Docker demo 栈改造、把 `asset_finance`／`poc_zhio` 写入 CI 硬门禁、浏览器／窄屏、镜像构建与部署、向 RDS 灌数或改表、完整 Agent LLM eval 全量通过（属可选加测，见 §7.2）。
- 上线关系：本条收口不表示可上线；文档定稿不表示 Manifest 已生成或本机已冒烟通过；任一档收口都不表示可上线。

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- **Shared QA Tier A（共享数据面）**：三机共用的阿里云 RDS MySQL 只读数据面；不以本机 MySQL／`demo-mysql` 作为多人真相源。
- **Shared QA Tier B（公共开发回归核）**：强制对齐的最小连接／语义／Wiki／Eval 集合。
- **Shared QA Tier C（演示／POC 扩展）**：`9-演示环境配置` 中的演示与客户向 POC 资产；默认可挂演示机，不进 Lucy 发布硬门禁，不强制进入开发基线。
- **B-tier Manifest（B 层清单）**：版本化清单：必选表、可选表、批准的 C 增量、文件白名单与 sha256、冒烟命令正本指针；**不含密码**。
- **Document Freeze（文档定稿）**：Spec／Plan 经审阅可按 Plan 实施；不等于落地 SC 通过。
- **Baseline Landing（基线落地闭口）**：权威机已生成 Manifest 正本并通过 B 层冒烟。
- **Per-machine Align（各机套用完成）**：某开发机按 Manifest 套用且 B 必选投影冒烟通过。

沿用：连接、连接 ID（`mysql-aliyun`）、Schema、启用表范围、语义层、Wiki、Eval、只读账号、发布取证、功能合同。

Forbidden:

- 把「演示环境配置整包」称作「发布测试集」或「P0 发布门禁」。
- 为同一 RDS host 另起第二个 MySQL `connectionId` 作为对齐标准。
- 在本 Spec／Plan／Manifest 正文写入密码、Token 明文或 `.ktx/secrets/` 文件内容。
- 将「文档定稿」写成「三机已对齐」或「基线落地闭口」。

Protected DOM／路径：`mysql-aliyun`、`dataforai`、`chatbi`、`asset_finance`、`poc_zhio`、`demo-mysql`、`ktx.yaml`、connectionId、enabled_tables。

---

## 1. 背景

1. 仓库 Onboarding：`ktx.yaml`、`.ktx/secrets/`、`semantic-layer/mysql-aliyun/`、多数业务 Eval／Wiki 为**本机私有**，不进共享 git。
2. `9-演示环境配置` 已拆 **RDS 数据面** 与 **lucy-mcp 配置面**，并承载 `asset_finance`、`poc_zhio` 等演示扩展。
3. 本机仓库已跟踪 `evals/superstore`（`--list-cases` 现为 **17** 条）、`evals/chatbi_intl`、`evals/golden`；本机当前缺少私有 `semantic-layer/mysql-aliyun/`。演示目录语义包当前主要为 C 层，不是 Superstore 语义全集。
4. 委托人要求：共用云端 RDS，但不要把演示目录整包升格为发布 Lucy 的测试内容。

## 2. 目标

1. 冻结 A／B／C 分层与升格禁令。
2. 以 Mac mini + `9-演示环境配置` 的**交集**定义 B 层（不是并集）。
3. 拆清文档定稿／基线落地／各机套用三档出口；给出可证伪白名单、同步边界与 B 层冒烟口径。
4. 明确 C 层与产品发布测的边界。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 把 `poc_zhio`／全量 `asset_finance` 写入 CI／发布硬门禁 | 属 C 层 |
| 修改 Lucy 产品代码路径以「内建」私有语义 | 工程对齐合同，不是产品功能面 |
| 在 git 中提交密码、Token、客户原始大包 | 红线 |
| 要求三机 `access.yaml`／Agent Token／`audit.sqlite` 一致 | 本机身份即可 |
| 废除 `demo-mysql` Docker stub | CI／沙箱仍需要 |
| 本条直接改 RDS DDL／灌数 | 属 `rds-mysql` 运维窗 |
| 以 `npm run eval`（默认 KTX `:7878`）作为 B 层必选冒烟 | 路径风险；B 层必选冒烟见 §7.2 |

## 4. 分层合同

### 4.1 Tier A — 共享数据面

| 项 | 合同 |
|---|---|
| 引擎 | 阿里云 RDS MySQL 8（实例以 `9-演示环境配置/README.md` 现网速查为准） |
| 角色 | 团队共享只读真相源 |
| 账号 | 只读；密码仅本机 `file:` secrets |
| 禁止 | 本机 MySQL／`demo-mysql` 作为三机数据问答真相源；未授权 DDL／DML |

### 4.2 Tier B — 公共开发回归核

| 项 | 合同 |
|---|---|
| `connectionId` | 固定 `mysql-aliyun` |
| **B 必选表** | `dataforai.superstore_orders`、`dataforai.superstore_returns`、`dataforai.superstore_people` |
| **B 可选表** | 仅当 Manifest `options.chatbi.enabled=true` 时追加 chatbi 表；默认 `false` |
| 语义 | 仅 Superstore 相关 `semantic-layer/mysql-aliyun/` 文件（白名单列出）；来源字段：`exported-from-authority` 或 `adapted-from-demo-mysql` |
| Wiki | 白名单默认含 `wiki/global/demo-superstore.md`（若权威包另有等价 Superstore playbook，须写入白名单并替换，不得静默多拷） |
| Eval | 必选套件文件：`evals/superstore/eval/superstore-eval-cases.yaml`；`--list-cases` 期望 **17** 条。`evals/golden/superstore.yaml` 可为参考，不计入必选执行数 |
| 同步 | 仅白名单文件；密钥除外 |

### 4.3 Tier C — 演示／POC 扩展

| 项 | 合同 |
|---|---|
| 内容 | `asset_finance`、`poc_zhio` 及演示剧本增量 |
| 落点 | `9-演示环境配置/` 与 Demo 主机；开发机可选挂载，须在本机记录 `tier_c_additions` |
| 发布 | **不得**因本条进入 Lucy 发布硬门禁 |
| 同 host | 作为同一 `mysql-aliyun` 的 schema／表增量，不新建第二 MySQL 连接 |

### 4.4 启用表合并规则（关闭 R6）

记：

- `B_required` = §4.2 三张 superstore 表
- `Manifest.B_optional` = 当前正本 Manifest 显式开启的可选表（默认空；chatbi 开关关闭则为空）
- `Machine.B_optional_retained` = 本机先前已启用、且仍希望保留的可选表（可空）
- `C_additions` = 本机已批准的 C 层表集合（可空）

**`mode=merge`（默认）实际启用表：**

```text
actual = B_required
       ∪ Manifest.B_optional
       ∪ Machine.B_optional_retained
       ∪ C_additions
```

语义：

1. 正本新打开的可选表 → 进入 `actual`。
2. 正本关闭某可选开关时，**不自动删除**本机已记录在 `Machine.B_optional_retained` 中的对应表；须操作者显式从 retained 集合移除，或使用 `mode=reset-to-b-only`。
3. **反例（须在 runbook 写明）**：Manifest 关闭 chatbi，本机 retained 仍含 chatbi 表，普通 merge 后 `actual` 仍含该表；对齐比较仍只要求 `B_required ⊆ actual`，报告中标注「本机保留可选表，超出正本可选集」。

**`mode=reset-to-b-only`：**

```text
actual = B_required ∪ Manifest.B_optional
Machine.B_optional_retained := empty
C_additions := empty
```

对齐比较时只投影 **`B_required ⊆ actual`**。伪代码中的 `ensure_ktx_connection` 使用合并后的 `actual`，不是覆盖成仅 `B_required`。

### 4.5 升格规则

1. C → B：修订本 Spec B 层列表 + 显式批准。
2. B → 发布硬门禁：另开发布取证／gate 变更；本条不自动升格。
3. 更换 RDS 实例：同步更新演示 README 现网速查与 Manifest host。

### 4.6 Manifest 正本（关闭 R5）

| 项 | 合同 |
|---|---|
| 正本路径 | `~/Nutstore Files/AI Workspace/98-解决方案/9-演示环境配置/lucy-mcp/07-共享开发B层/MANIFEST.md`（落地 S1 创建目录；**坚果云持久**，非 `inbox/`） |
| 工作副本 | 允许复制到各机仓库 `inbox/shared-dev-qa-baseline/`（可删；不得自称正本） |
| 保管人 | 星辰（委托人）；版本字段 `manifest_version` + `exported_at` |
| 冲突裁决 | 以坚果云正本 `manifest_version` 较大者为准；同版本比 `exported_at` |
| Runbook | `docs/runbooks/shared-dev-qa-baseline.md` 为 **S1 必选**产物，必须指向正本路径 |

## 5. 核心流程（伪代码）

```text
procedure AlignDevMachine(machine, mode = "merge"):
  assert secrets_not_in_git(machine)
  assert host_ktx_version_aligned()          # npm run verify:host-ktx
  manifest := read_manifest_canonical()      # Nutstore 正本；无密码
  assert manifest.has_file_whitelist_and_sha256()
  assert package_matches_whitelist(machine.staging_pack)
  assert package_rejects(C_files_not_in_additions, secrets_files, unknown_files)

  B_required := manifest.b_required_tables
  Manifest_optional := manifest.b_optional_tables_if_enabled
  Retained_optional := machine.b_optional_retained   # may be empty
  C_additions := machine.recorded_tier_c_additions   # may be empty
  if mode == "reset-to-b-only":
    C_additions := empty
    Retained_optional := empty
    machine.b_optional_retained := empty
  actual_tables := union(B_required, Manifest_optional, Retained_optional, C_additions)

  ensure_ktx_connection(
    id = "mysql-aliyun",
    host = manifest.rds_host,
    user = manifest.readonly_user,
    password = file_local_secret("mysql-aliyun-password"),
    enabled_tables = actual_tables
  )
  forbid second_mysql_connection_same_host()

  sync_whitelisted_assets(manifest.b_file_whitelist)
  assert target_b_files_match_whitelist_sha256(manifest.b_file_whitelist)
  assert no_unlisted_legacy_b_files_under_managed_paths(manifest.b_managed_globs)
  # managed_globs 例：semantic-layer/mysql-aliyun/**superstore**、wiki/global/demo-superstore.md
  # 未登记遗留 B 文件：拒收 ALIGNED，或经显式 quarantine／删除后再 reindex；不得静默保留
  # 已批准 C 增量路径不在 b_managed_globs 内，不受本条删除

  run ktx admin reindex   # or admin reindex --force when Manifest says so
  assert reindex_scope_includes("mysql-aliyun")
  assert semantic_search_or_read_hits(manifest.expected_superstore_sources)

  run B_smoke_required(manifest)   # §7.2 步骤 1–6 必选；步骤 7 推荐
  assert B_required ⊆ actual_enabled_tables()
  assert not release_gate_requires(manifest.tier_c_ids)
  return ALIGNED
```

## 6. 密钥与同步边界

| 允许 | 禁止 |
|---|---|
| 无密码连接草稿、Manifest、白名单内语义／Wiki／Eval、sha256 | 密码、Bearer Token、`access.yaml` 可用 Token、未脱敏客户大包 |
| host／port／database／username／`file:` 路径约定 | secrets 写入 Spec／Plan／Manifest／runbook 正文 |

包校验反例（须在落地检查清单中执行）：混入未批准 C 文件、白名单外未知文件、任何 `*password*`／`.ktx/secrets/**`／Token 明文文件 → **拒收**，不得 `ALIGNED`。

## 7. 验收矩阵

### 7.1 文档定稿出口（SC-D*）— 本回合可关闭

| ID | 断言 | 证据 |
|---|---|---|
| SC-D01 | Spec／Plan 共用编号 `lucy-20261101-shared-dev-qa-baseline`，索引已登记 | `docs/README.md`、`docs/plans/README.md` |
| SC-D02 | 闭口三档出口已拆分；文档定稿不宣称落地／三机完成 | 本 Spec 闭口层级 |
| SC-D03 | B 必选三表与 C 示例（`asset_finance`、`poc_zhio`）边界写清 | §4.2／§4.3 |
| SC-D04 | 启用表合并规则与 `reset-to-b-only` 写清 | §4.4 |
| SC-D05 | Manifest 正本落坚果云路径，inbox 仅工作副本 | §4.6 |
| SC-D06 | B 层必选冒烟口径完整（命令、期望、失败判据），且不以默认 `npm run eval`→`:7878` 为必选 | §7.2 |
| SC-D07 | 同步后须 `admin reindex` 再冒烟 | §5 |
| SC-D08 | `lint:spec-docs` 对本对文件：**无违规、无 WARN、无新增基线豁免**（不仅看全库 exit 0） | 保留命令输出；对这两路径 grep WARN／fail |

### 7.2 B 层必选冒烟（SC-L* 使用；关闭 R2／R3／N2）

**B_smoke_required = 步骤 1–6。** 其中任一步失败 → 不得 `ALIGNED`。  
**步骤 7 为推荐**，失败不单独阻断 ALIGNED（但建议修复）。  
数值类 Agent 全量 eval **不是**必选；另标 `B_smoke_optional_agent`。

| 步骤 | 必选？ | 命令／动作 | 通过标准 | 失败 |
|---|---|---|---|---|
| 1 | 是 | `npm run verify:host-ktx` | 退出 0，或输出明确「已对齐」；若脚本以非 0 表示落后则失败 | 宿主 CLI 与镜像捆绑版本不一致且脚本判红 |
| 2 | 是 | `ktx connection test mysql-aliyun` | 退出 0 | 非 0 |
| 3 | 是 | `ktx --project-dir "$ROOT" admin reindex` | 退出 0；输出含 `mysql-aliyun` scope 更新或等价成功 | 非 0；或 scope 无 mysql-aliyun |
| 4 | 是 | 对 `superstore_orders`／`superstore_returns`／`superstore_people` 各执行 `ktx sl validate <name> --connection-id mysql-aliyun` | 三个均退出 0 | 任一非 0 |
| 5 | 是 | 目录／源可见：`ktx sl "superstore"`（或 Manifest 记载的等价 catalog 命令） | 输出同时出现三张表／源名（允许额外噪声行） | 缺任一必选源名 |
| 6 | 是 | `node scripts/eval/eval-runner.mjs --list-cases --cases evals/superstore/eval/superstore-eval-cases.yaml` | 精确出现 `# loaded 17 case(s)` | 条数≠17、命令非 0、零执行／跳过装载 |
| 7 | 推荐 | `npm run smoke:p0:business-eval` | 退出 0（内部至少加载 superstore ≥1；与步骤 6 双保险） | 非 0（不单独阻断 ALIGNED） |

**判据细则：**

- 「缺表／缺语义／连错库」导致步骤 2–5 失败 → **失败**，不是「数值漂移」。
- 步骤 6 若 loaded=0 或路径指向空文件 → **失败**。
- **数值漂移**：仅适用于可选 Agent 执行；须记录差异与统一 `snapshot_date` 裁决；不得把「未跑 Agent」记为数值通过。

**可选 `B_smoke_optional_agent`（不阻塞 ALIGNED）：**

- 经 Lucy MCP Proxy `:7879`（Bearer；不写进文档）跑 Manifest 点名的 case ID 子集（建议至少 `superstore-discount-001`、`superstore-ordercount-001`）。
- **禁止**把默认 `npm run eval`（KTX `:7878`）写成 B 必选路径，除非 Manifest 显式改写且经批准。

### 7.3 基线落地闭口（SC-L*）— S1–S2，定稿后另授权

| ID | 断言 |
|---|---|
| SC-L01 | 坚果云正本 `MANIFEST.md` 存在，含 `manifest_version`、host、只读用户名、B 必选表、可选开关默认 false、C 排除列表 |
| SC-L02 | Manifest 含 **B 文件白名单**（路径 + sha256）与 **B 管理路径 glob**；staging 包与白名单一致 |
| SC-L03 | 包内无未批准 C 文件、无 secrets／Token 文件、无白名单外未知文件（反例检查执行并记录） |
| SC-L04 | B Wiki／Eval／语义引用不指向未批准 C 资产；同步后**目标树**白名单文件 sha256 与正本一致；管理 glob 下无未登记遗留 B 文件（反例：旧 Superstore Wiki 残留 → 不得 ALIGNED） |
| SC-L05 | 权威机 `ktx.yaml` 满足 `B_required ⊆ enabled_tables`；无第二 MySQL 同 host 连接；merge／retained 规则按 §4.4 |
| SC-L06 | 权威机完成 §7.2 **必选步骤 1–6** 全绿（步骤 7 推荐） |
| SC-L07 | runbook `docs/runbooks/shared-dev-qa-baseline.md` 已写并指向正本 |
| SC-L08 | 文档声明 C 不进发布硬门禁；本条未改 gate 代码 |
| SC-L09 | `demo-mysql` 未设为多人真相源 |
| SC-L10 | 落地证据落 `inbox/` 工作副本（可删），正本仍在坚果云 |

### 7.4 各机套用完成（SC-M*）— 按机

| ID | 断言 |
|---|---|
| SC-M01 | 该机 Manifest 版本 = 正本 `manifest_version` |
| SC-M02 | 该机 §7.2 必选步骤 1–6 全绿；`B_required ⊆ actual`；目标树 B 白名单 sha256 一致且无未登记遗留 B 文件 |
| SC-M03 | 若挂 C：本机记录 `tier_c_additions`；未挂则集合为空；若保留超出正本的可选表：记录 `b_optional_retained`；比较报告只要求 B 必选投影一致 |

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 定稿与落地混谈 | §闭口三档；SC-D／L／M 分编号 |
| 整包／混包 | 白名单 + sha256 + 拒收反例 |
| 文件齐但索引旧 | 强制 reindex 后再冒烟 |
| 误用 `:7878` eval | §7.2 禁止为必选 |
| 正本进 inbox 丢失 | §4.6 坚果云正本 |

## 9. 修订记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v0.1 | 2026-11-01 | 初稿 |
| v0.2 | 2026-11-01 | 关闭 Codex R1–R5／R7：三档出口、冒烟判据、reindex、白名单、正本路径、lint WARN 判据 |
| v0.3 | 2026-11-01 | 关闭 R6／N1／N2：merge 保留 retained 可选表；同步后目标哈希与遗留 B 文件拒收；步骤 7 明确为推荐 |
| v1.0 | 2026-11-01 | Codex 第 3 轮可定稿；文档定稿出口关闭；落地另授权 |
| v1.1 | 2026-11-01 | 授权落地：Mac mini 完成 S1–S2；SC-L* 关闭；SC-M* 待其余两机 |
