# Runbook：共享开发 QA 基准线（Tier B）

| 元数据 | 内容 |
|---|---|
| Spec | [`docs/specs/lucy-20261101-shared-dev-qa-baseline-spec.md`](../specs/lucy-20261101-shared-dev-qa-baseline-spec.md) v1.0 |
| Plan | [`docs/plans/lucy-20261101-shared-dev-qa-baseline-plan.md`](../plans/lucy-20261101-shared-dev-qa-baseline-plan.md) v1.0 |
| Manifest 正本 | `~/Nutstore Files/AI Workspace/98-解决方案/9-演示环境配置/lucy-mcp/07-共享开发B层/MANIFEST.md` |
| 工作副本 | 仓库 `inbox/shared-dev-qa-baseline/`（可删，不得自称正本） |

## 1. 分层速记

| 层 | 含义 |
|---|---|
| A | 共享阿里云 RDS（只读） |
| B | Superstore 三表 + 白名单语义／Wiki／Eval（强制对齐） |
| C | `asset_finance`／`poc_zhio` 等演示扩展（可选；不进发布硬门禁） |

禁止把 `9-演示环境配置` 整包升格为 Lucy 发布测。

## 2. 新机套用（默认 `mode=merge`）

1. `git pull` 仓库；确认本机 `evals/superstore/eval/superstore-eval-cases.yaml` 与 Manifest 中 repo-tracked sha256 一致（或可接受的 git 版本差并记录）。
2. 从 Manifest 正本目录复制 `assets/semantic-layer/mysql-aliyun/**` → 仓库 `semantic-layer/mysql-aliyun/`；复制 `assets/wiki/global/demo-superstore.md` → `wiki/global/`（若已跟踪且相同可跳过）。
3. **复核目标树 sha256** 与 Manifest「Authority-machine target hashes」或 pack whitelist 一致；管理 glob `semantic-layer/mysql-aliyun/**` 下不得有未登记遗留 B 文件。
4. 配置 `ktx.yaml`：`connectionId=mysql-aliyun`，host／user 与 Manifest 一致；`enabled_tables` 至少含 B 必选三表；password=`file:<ABS>/.ktx/secrets/mysql-aliyun-password`。
5. 本机写入 secrets（0600）；**不要**把密码放进 Manifest／git／聊天。
6. 若本机曾挂 C 或额外可选表：写入本机记录 `tier_c_additions`／`b_optional_retained`；默认 merge **不删除** retained（见 Spec §4.4）。首装可用 `reset-to-b-only`（仅 B 必选 ∪ 正本可选）。
7. 跑 §3 冒烟。失败不得宣称 ALIGNED。

### 2.1 Manifest 关闭 chatbi 时的 merge 行为

正本关闭 chatbi 后，普通 merge **不会**自动删掉本机 `b_optional_retained` 里已有的 chatbi 表。须显式从 retained 移除或使用 `reset-to-b-only`。对齐比较只要求 `B_required ⊆ actual`。

## 3. B 必选冒烟（Spec §7.2）

在仓库根执行。步骤 **1–6 必选**；步骤 **7 推荐**。

若环境注入了 `GIT_CONFIG_COUNT`／`GIT_CONFIG_KEY_*`，`ktx` 可能报 `allowUnsafeConfigEnvCount`。先清理再跑：

```bash
for v in $(env | awk -F= '/^GIT_CONFIG/{print $1}'); do unset "$v"; done
npm run verify:host-ktx
ktx --project-dir "$(pwd)" connection test mysql-aliyun
ktx --project-dir "$(pwd)" admin reindex
ktx --project-dir "$(pwd)" sl validate superstore_orders --connection-id mysql-aliyun
ktx --project-dir "$(pwd)" sl validate superstore_returns --connection-id mysql-aliyun
ktx --project-dir "$(pwd)" sl validate superstore_people --connection-id mysql-aliyun
ktx --project-dir "$(pwd)" sl "superstore"
node scripts/eval/eval-runner.mjs --list-cases --cases evals/superstore/eval/superstore-eval-cases.yaml
# recommended:
npm run smoke:p0:business-eval
```

通过标准：

- 步骤 6 精确输出 `# loaded 17 case(s)`
- `ktx sl "superstore"` 可见三张源名
- 缺表／缺语义／连错库 → 失败（不是数值漂移）

**禁止**把默认 `npm run eval`（KTX `:7878`）当作 B 必选路径。

## 4. 拒收条件

- 同步包混入未批准 C 文件、secrets、Token 明文、白名单外未知文件
- 目标树哈希不一致或管理 glob 下有未登记遗留 B 文件
- 为同一 RDS host 新建第二个 MySQL `connectionId`

## 5. 完成档位

| 档 | 含义 |
|---|---|
| 文档定稿 | Spec／Plan 已定稿（已完成） |
| 基线落地闭口 | 权威机 Manifest + §3 冒烟（SC-L*） |
| 各机套用完成 | 每机 SC-M*；全部完成前不得写「三机已对齐」 |
