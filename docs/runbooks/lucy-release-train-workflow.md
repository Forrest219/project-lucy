# Lucy 发版列车 Workflow

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Release Train Workflow |
| 文档类型 | Release / Process Spec |
| 版本 | v0.4 |
| 撰写日期 | 2026-10-23；v0.2 增补配套评审链接与 §7 待办出处；v0.3 按评审意见修订：§4.1 补 `ktx-upgrade-compat` 注脚、§3.0 补 actionlint 配置与退出码口径、§3.2 补 context 新鲜度前置、§3.3 补 Release 非空壳要求、§7 修正工作区口径；v0.4 更正 §3.2 的 context 新鲜度前置条件（推 `lucy-v2.0` 不触发工作流） |
| 适用范围 | Lucy 2.0 → 2.5 及以后每个版本的分支治理、合并、切线、构建、客户交付与归档 |
| 配套评审 | [`docs/reviews/2026-10-23-lucy-v2.0-release-readiness-review.md`](../reviews/2026-10-23-lucy-v2.0-release-readiness-review.md)（本版的就绪度评审、待决策项 D1/D2 与执行清单） |
| 关联 | [`docs/governance/release-ci.md`](../governance/release-ci.md)（CI 门禁定义）· [`docs/governance/version-matrix.md`](../governance/version-matrix.md)（版本与兼容性事实源）· [`docs/runbooks/customer-v2-upgrade-release-checklist.md`](customer-v2-upgrade-release-checklist.md)（客户交付 C01–C20）· [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)（开发治理）· [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md)（2.5 范围 L25-01–L25-14）· [`docs/plans/2026-10-19-lucy-product-version-2.0.0.md`](../plans/2026-10-19-lucy-product-version-2.0.0.md)（2.0 切线先例） |
| 本文件不做 | 不重复定义 CI 门禁内容（见 release-ci.md）；不重复定义版本投影清单（见 version-matrix.md §1.1）；不重复定义客户交付清单（见 C01–C20） |

本文件是**流程**事实源：谁在什么分支上、按什么顺序、带着什么证据、经过哪些门，才能产出一个可交付客户的版本。CI 定义"门禁跑什么"，本文件定义"什么时候必须跑、什么算通过、谁负责"。

---

## 0. 一句话模型

发版列车有五段，每段有唯一的放行判据：

```
P0 冻结  →  P1 合流 main  →  P2 开 2.5 线  →  P3 开发循环  →  P4 切线构建  →  P5 交付归档
   ↑              ↑                                                        ↑
 就绪判据      必需检查 + 留痕                                        放行凭据（三元组）
```

**不可跳段。** 上一段的放行判据没满足，下一段不启动。

---

## 1. 分支模型

| 分支 | 角色 | 生命周期 | 允许进入 | 禁止 |
|---|---|---|---|---|
| `main` | **发布主线** | 长期 | 已通过 P0 就绪判据的合并；发版批次 | 未经 PR 的直推；未冻结 Spec 的实现；`VERSION` 与实际内容不符的提交 |
| `lucy-v2.5` | **2.5 集成分支** | 长寿命，与 2.5 同寿 | Spec 已冻结的 L25 实现；回归修复 | 未冻结 Spec 的实现；直接改客户交付物 |
| `feature/lucy-2.5/<L25-id>-<slug>` | **单需求实现线** | 短命（≤5 天） | 一个 L25 的完整实现 + 测试 + 文档 | 跨需求混改；顺手重构；改无关文件 |
| `lucy-v2.0` | **已冻结交付证据线** | 已冻结 | 无（只读） | 任何新提交 |
| `hotfix/lucy-<version>-<slug>` | **线上 P0 修复线** | 短命 | 从 `main` 切出 | 从 `lucy-v2.5` 切（未发布内容不构成 hotfix 基准） |

### 1.1 命名

沿用仓库既有前缀，不新造：

- 需求实现：`feature/lucy-2.5/L25-09-audit-contract`
- 缺陷：`fix/<slug>`；审计：`audit/<slug>`；杂项：`chore/<slug>`；文档：`docs/<slug>`
- agent 命名空间（`codex/`、`cursor/`）只用于 agent 自发工作，**合并规则与人工分支完全相同**，不得作为跳过复核的理由。

### 1.2 `main` 只在发版时前进（关键约束）

`main` 的内容 = **已发布版本 + 已验收并准备发版的批次**。2.5 的日常开发全部发生在 `lucy-v2.5` 上；只有当一个批次准备随下一个版本交付时，才合回 `main`。

**为什么不能把 2.5 日常合回 `main`：** 版本矩阵 §1.1 规定产品版本只在客户可见交付时递增，`VERSION` 在开发期保持上一发布值。若 `main` 长期装着 2.5 功能而 `VERSION` 仍是 `2.0.0`，就会产出一个"版本号说 2.0.0、内容含 2.5 功能"的镜像——客户镜像 tag 是 `customer-amd64-<VERSION>-<日期>-<sha>`，版本段会撒谎，`sha` 段虽然能区分，但审计与合规叙事会出现版本号与事实不符的窗口。

`main` 保持"发布主线"语义，客户永远能从 `main` 复现出已交付的镜像。

---

## 2. 版本号治理（先说清，因为它最容易出事）

### 2.1 事实源与投影

事实源是仓库根 `VERSION`。投影共 11 处，清单见 [`docs/plans/2026-10-19-lucy-product-version-2.0.0.md`](../plans/2026-10-19-lucy-product-version-2.0.0.md) §3.1–3.2。**一次改完，不允许分两次提交。** 唯一判据：

```bash
npm run lint:version        # 通过：输出含 [lucy-version] OK VERSION=<v>
npm run lint:version:test   # 通过：Node 测试全绿（含"错误 tag 被拒绝"用例）
```

`scripts/release/lucy-version-governance.mjs` 同时强制：产品版本必须是严格 `X.Y.Z`（无 `v` 前缀、无预发布后缀）；客户镜像 tag 与 release tag 必须与 `VERSION` 匹配。

### 2.2 「2.5」是功能波次名，不是产品版本号

版本矩阵 §1.1 只承认两条递增规则：

| 触发 | 递增 |
|---|---|
| 客户交付包 / 离线镜像 / K8s tar | 第二段 +1（`2.0.0` → `2.1.0`） |
| 大能力、破坏性配置或捆绑 KTX 主版本变化 | 第二段 +10（`2.0.0` → `2.10.0`） |
| 补丁段 | 保持 `0`，直到矩阵另定 hotfix 规则 |

2.5 波次含 L25-09 审计运行时契约（v1.0-frozen）、L25-10 新数据源 Hive、L25-11 语义资产批量维护、L25-14 行权限管理——按矩阵自身的分类，这属于"大能力 + 新增执行路由 + 权限模型扩展"，落在**第二段 +10**。

**默认结论：2.5 波次交付时，产品版本切到 `2.10.0`。**

分支名仍可叫 `lucy-v2.5`——**分支名不是产品版本**。2026-10-19 切线文件 §2 已把这条写成既有原则（"Git 分支 `lucy-v2.0`：分支名，不是产品版本"）。

若坚持要 `2.5.0`，必须补一次**明示批准的切线文件**（仿 `2026-10-19-lucy-product-version-2.0.0.md`），改写 version-matrix §1.1 与 CHANGELOG，并明确承认这是对 +1/+10 规则的例外。**默认按 `2.10.0` 执行，不额外开口子。**

### 2.3 切线时点

**不在开分支时切版本，在候选出包时切。** 理由：版本矩阵 §1.1 原文——"日常 `main` 提交不自动 bump"。

- `lucy-v2.5` 开分支时 `VERSION` 仍是 `2.0.0`。
- P4 切线时才把 `VERSION` 从 `2.0.0` 改到 `2.10.0`，并同步 11 处投影、CHANGELOG、version-matrix 基线行。
- Chart 的 `version`（包版本）独立于 `appVersion`（产品版本），当前 `0.2.6`；**Chart 内容变了要升 `version`**，工具修复不强行升。

---

## 3. 列车五阶段

### P0 冻结（合并 `lucy-v2.0` → `main` 之前）

P0 的判据是"**这条分支可以安全成为 `main`**"。逐项如下：

| ID | 门 | 判据 | 怎么验 |
|---|---|---|---|
| P0-1 | 工作区干净 | `git status --porcelain` 无输出 | 有未提交改动时**不进入 P1**。未提交的改动在合并中会丢失或半途混入 |
| P0-2 | CI 工作流文件可加载 | `actionlint .github/workflows/lucy-release.yml` 无 error | 见 §3.0，这是**文件级**失效：GitHub 拒绝加载整个工作流，所有 job 静默消失，run 0 秒失败并提示"likely failed because of a workflow file issue"。GitHub 侧不给出具体行号，必须本地用 actionlint 拦 |
| P0-3 | 合并门禁绿 | `spec-and-webui` / `docker-smoke` / `k8s-static` / `k8s-upgrade-gate` 全绿 | 在分支上至少一次完整绿跑 |
| P0-4 | 版本投影一致 | `npm run lint:version` 绿 | 见 §2.1 |
| P0-5 | Spec 文档同步 | `npm run lint:spec` 退出 0 | 路由表与 `webui/docs/03-api-spec.md` 对齐 |
| P0-6 | 合并方式可留痕 | 走 PR，不直推 | §3.1 |
| P0-7 | `main` 受保护 | 禁止直推 / 禁止 force push / 必需检查已挂 | §3.2 |

**P0-1 特别提醒：** 本仓库当前有多个 agent（Kimi Code、Codex CLI）在同一工作区并行写入。合并前必须确认没有 agent 正在提交，否则会把半成品合进 `main`。合并瞬间前跑一次 `git status --porcelain` 并确认 HEAD 未变。

### 3.0 P0-2 的根因与防复发

`real-e2e` job 曾在 **job 级 `env:`** 里写 `LUCY_EVIDENCE_SIGNING_KEY_FILE: ${{ runner.temp }}/...`。GitHub 的 context 可用性里，`runner` context **不包含在 job 级 `env`** 中——只有 step 级 `env` 才能用。后果不是该 step 失败，而是**整个工作流文件在加载阶段被拒**：所有 job 消失，run 以 0 秒失败。2026-10-18 的 `e8e931e` 引入此后，分支上的每一次 CI 都没真正跑起来。

已修为：把该变量下沉到"Verify, then archive and sign"这一步的 step 级 `env:`，并在原地留注释说明原因。

**防复发：把 actionlint 纳入本地提交前检查。**

仓库已放 `.github/actionlint.yaml`，声明 `lucy-protected` 与 `amd64` 为本仓库的自托管 runner 标签。**没有这个文件，actionlint 只会报 2 条 finding，但退出码是 `1`**——因为它不认识自定义标签。那不是工作流缺陷，却会让 `actionlint || exit 1` 这类 pre-push 钩子每次推送都被挡下。配置生效后本仓库的退出码为 `0`，此时"零 finding"与"可直接用作钩子"才是同一件事。

```bash
# 提交前必跑（建议挂 pre-push hook）
actionlint .github/workflows/lucy-release.yml   # 全局安装：brew install actionlint
echo "exit=$?"   # 本仓库期望 0
```

### 3.1 P1 合流 `main`

| 项 | 规定 |
|---|---|
| 通道 | PR：`lucy-v2.0` → `main`。**禁止直推 `main`**（直推绕过必需检查与留痕，是"符合企业发版规范"里最先要拿掉的一条） |
| 合并方式 | **保留提交粒度**：用 merge commit 或 fast-forward；**禁用 squash** |
| 理由 | 镜像 `/app/BUILD_REVISION` 记录源码提交，客户交付证据靠"提交 ↔ 镜像 digest ↔ 包 SHA256"三元组对齐。squash 会把 214 个提交压成一个，2.0 整条线失去 bisect 与 blame 能力，交付事故无法定位到具体变更 |
| PR 描述必须包含 | ① 本版放行范围 ② 已执行的验收项与证据路径 ③ 未执行项写"待验"及原因 ④ 版本号与 KTX 版本 |
| 合并后 | 在 `main` 的合并提交上打 `v2.0.0` tag，并建 GitHub Release（见 §3.3） |

**关于 diff 体积：** 本次合并是 214 个提交、942 个文件、+133911/-8340 行。**不要靠读 diff 做复核**——复核依据是门禁结果 + 验收证据 + 本文件 P0 判据。PR 页面 diff 过大时应改看提交列表与验收表。

### 3.2 P0-7 / 保护 `main`

`main` 必须开启分支保护（当前仓库**没有**任何保护，也没有 ruleset）。企业发版规范的最小配置：

| 规则 | 值 | 为什么 |
|---|---|---|
| Required status checks | `spec-and-webui`、`docker-smoke`、`k8s-static`、`k8s-upgrade-gate` | 与 release-ci.md §2 建议的必需检查一致；前两项覆盖版本/Spec/安全基线，后两项覆盖交付形态（H1 静态、H3/H4 真实 N-1 升级） |
| Require branches to be up to date | 开 | 避免用过期基线合并 |
| Require approvals | **0（见下方偏离说明）** | 发布主线本意是不允许自审自合；但本仓库协作者**只有 `Forrest219` 一人**（admin），审批数 ≥1 会让 main **永久死锁**——唯一管理员需要一份自己给不出的审批。增补第二个有写权限的协作者后，应把审批数提到 ≥1 并保留 `enforce_admins = true` |
| Restrict pushes | **不设 restrictions**（见下方偏离说明） | 设成"仅维护者名单"在单人仓库里等于把唯一管理员也排除在外——`enforce_admins = true` 时管理员连自己的 PR 都合不进去，main 再次死锁。**实际约束来自 Required checks**：直推一个没跑绿四个 context 的提交会被 GitHub 直接拒掉，所以"绕过门禁直推"这条路是堵死的；能直推的只有已经跑绿、且与 `main` 同步的提交 |
| Allow force pushes | 关 | |
| Allow deletions | 关 | |
| Tag protection (`v*`) | 禁止删除 / 禁止移动 | tag 是放行凭据的锚点，移动等于伪造证据 |

> **偏离说明（2026-10-24 实际执行）：** 仓库协作者只有 `Forrest219`（admin），故实际下发的是
> `required_approving_review_count = 0` + `enforce_admins = true` + `restrictions = null`。
> 这样四项 Required checks、禁 force push、禁删除**对管理员同样强制**，而不会因为「需要一份无法产生的审批」或
> 「把管理员排除在可推名单外」把 main 锁死。**这是能力受限下的折中，不是「允许自审自合」的追认**——审批门待增补第二个协作者
> 后立即恢复（届时 `restrictions` 可一并收紧）。
>
> 仓库级标签保护走 **ruleset**（`POST /repos/{owner}/{repo}/rulesets`，`target: "tag"`），
> 不是 `PUT /repos/{owner}/{repo}/tags/protection`——后者是**组织级**接口，个人仓库返回 404。

> **前置条件（顺序不可调换）：** GitHub 要求 Required checks 的 context 在近期（约一周内）有 check-run 报告，否则该 API 会拒绝。`main` 最后一次 CI 是 2026-10-11，已超出新鲜度窗口。
>
> ⚠️ **推 `lucy-v2.0` 拿不到报告。** `on.push.branches` 只含 `main`，推 `lucy-v2.0` 不触发本工作流——此前那些 `lucy-v2.0` 的 "push" run 是工作流文件损坏时 GitHub 无法解析触发条件、被动兜底创建的产物。验证工作流本身可调度要走 PR 的 `pull_request` 事件；若 API 以 "not found in the last 7 days" 拒绝，说明 context 需要在默认分支上有一次报告来刷新，即合并后由 `main` 的 push run 立即刷新，再开保护。

可直接执行（需仓库 admin）：

```bash
gh api -X PUT repos/Forrest219/project-lucy/branches/main/protection \
  -F required_status_checks[strict]=true \
  -f 'required_status_checks[contexts][]=spec-and-webui' \
  -f 'required_status_checks[contexts][]=docker-smoke' \
  -f 'required_status_checks[contexts][]=k8s-static' \
  -f 'required_status_checks[contexts][]=k8s-upgrade-gate' \
  -F required_pull_request_reviews[required_approving_review_count]=0 \
  -F enforce_admins=true \
  -F restrictions=null \
  -F required_linear_history=false \
  -F allow_force_pushes=false \
  -F allow_deletions=false
```

> ⚠️ `required_approving_review_count` 必须是 **0**。写成 1 会让唯一管理员拿不出审批 → main 永久死锁
> （见上方偏离说明）。增补第二个协作者后，才把它改成 1 并把 `restrictions` 收紧。

### 3.3 P1 尾部：打标记与归档

合并到 `main` 后立刻做，否则这条线没有不可变锚点：

```bash
git fetch origin && git checkout main && git pull --ff-only
git tag -a v2.0.0 -m "Lucy 2.0.0 — 产品版本切线自 0.17.0"
git push origin v2.0.0

gh release create v2.0.0 \
  --title "Lucy v2.0.0" \
  --notes-file <(sed -n '/^## 2\.0\.0/,/^---/p' CHANGELOG.md) \
  --target <main-commit-sha>
```

**tag 是意图标记，`release-package` 的产出物才是放行凭据。** tag 打在还没跑完门禁的提交上并不自动构成发布；判据见 §4。

**不得留空壳 Release。** 若因 §4.3 的 runner 缺失导致 `release-package` 未运行（`release-package` 依赖 `customer-release-readiness`，后者依赖 `real-e2e`），Release 正文**必须**写明证据来源与边界：① 证据来自本地出包路径（`scripts/gates/build-k8s-delivery-package.sh` + 原生 amd64 人工验收）；② **未经 GitHub 门禁链验证**；③ 未执行的 CI 门禁项逐条列出。留空或写成"已发布"会与本节的自洽框架冲突，构成证据边界失述。

### P2 开 2.5 线

| 动作 | 命令 / 规定 |
|---|---|
| 开分支 | `git checkout -b lucy-v2.5 origin/main`（从 `main` 切，不从 `lucy-v2.0` 切） |
| 版本 | **不改 `VERSION`**，仍是 `2.0.0`（§2.3） |
| 第一件事 | **不是写代码，是把 Spec 从 v0.1-draft 推到冻结**（§3.4） |
| 登记 | 在 2.5 建议书里把每个 L25 的状态从"待评审"改为"已冻结 / 授权实现"，并写明冻结版本号与日期 |

### 3.4 P3 开发循环：每个 L25 的推进节奏

2.5 建议书当前状态：L25-09 审计契约主 Spec 已 v1.0-frozen，但**只冻结设计，未授权实现**；L25-10 / L25-11 / L25-12 / L25-13 / L25-14 的 Spec 均为 v0.1-draft，**待评审、暂不开发**。因此 2.5 分支的第一阶段是**评审与冻结**，不是编码。

单个 L25 的标准闭环：

```
① Spec 冻结  →  ② 实现分支  →  ③ 验收（Spec 的 V 矩阵）  →  ④ 合回 lucy-v2.5
                                                                   ↓
                                              ⑤ 批次回归 + 证据归档  →  ⑥ P4 时随版本合回 main
```

| 环节 | 规定 |
|---|---|
| ① Spec 冻结 | 必须含「核心流程（伪代码）」小节与 Terminology Compliance（`docs/governance/DEVELOPMENT.md` 硬要求）。未冻结不建实现分支 |
| ② 实现分支 | `feature/lucy-2.5/<L25-id>-<slug>`，从 `lucy-v2.5` 切。一个 L25 一条线，≤5 天 |
| ③ 验收 | 按该 Spec 自己的 V 矩阵逐条过，写"未执行"及原因，不留空 |
| ④ 合回 | 回 `lucy-v2.5`，不是回 `main`（§1.2） |
| ⑤ 批次回归 | `lucy-v2.5` 上的完整门禁；证据按 L25 归档到 `docs/uat/` 或 `docs/specs/` 对应位置 |
| ⑥ 合回 `main` | 只在 P4 发版时做 |

**排期优先级**（取自 2.5 建议书自身的建议，不另造）：

1. **安全审计与升级可靠性优先**：L25-09 审计运行时契约、L25-07 客户升级 E2E 自动化、L25-13 升级候选验证环境。
2. **语义资产批量维护 L25-11** 优先于纯展示类。
3. **纯展示类**：L25-01 ~ L25-04、L25-08 访问关系图、L25-12 帮助中心。

理由：提案自己写明"优先于纯展示优化，安全审计与升级可靠性仍优先"。

**范围纪律：** 2.5 的边界是"补治理台 WebUI + 若干运行时增量"，**不把 Lucy 做成对话框**，不改权限裁决与问询预算引擎，不改 KTX 源码。越界的想法记入建议书，不在实现分支夹带。

### P4 切线与候选构建

| 步骤 | 动作 | 门 |
|---|---|---|
| P4-1 | 决定版本号（默认 `2.10.0`，§2.2）；如走例外路径，先出切线批准文件 | 批准文件落 `docs/plans/` |
| P4-2 | 改 `VERSION` + 11 处投影，**一次改完** | `npm run lint:version` 绿；`npm run lint:version:test` 绿 |
| P4-3 | 收敛 CHANGELOG：`Unreleased` 段落转为 `## 2.10.0`，保留 **Breaking / Deprecated / Added / Changed / Fixed** 标注约定 | 人工复核 |
| P4-4 | 更新 version-matrix 基线行（产品版本、包名、发布元数据模板、§1.1 递增例子） | 人工复核 |
| P4-5 | Chart 内容变了 → 升 Chart `version`（`0.2.6` → `0.2.7`）；`appVersion` 跟产品版本 | `npm run gate:k8s-static` 绿（校验 `LUCY_VERSION` 与 `LUCY_BUNDLED_KTX_VERSION`） |
| P4-6 | 合回 `main`（此时 `main` 才前进，§1.2） | 走 PR，必需检查绿 |
| P4-7 | 在 `main` 的发版提交上打 `v<版本>` tag，推送 | tag 保护已开 |
| P4-8 | CI 从 tag 触发全量发版门禁 | §4 门禁矩阵 |

**候选与放行分离**（`docs/specs/lucy-20261018-enterprise-security-and-real-e2e-spec.md` §8.3）：

- `customer-amd64-native` 只构建**一次**候选镜像，tag 为 `candidate-amd64-<版本>-<日期>-<sha>`，G1/G2/G3/G4/G4b/G8 的结果**绑定该 digest**。
- `release-package` **只 promote 已测 digest**（`docker buildx imagetools create`），**不重建**。promote 后对该 digest 重跑 G1/G2/G4b/G8。
- **禁止 gate 之后再 build。** 重建出来的是没测过的镜像。

**构建硬约束**（`AGENTS.md`）：客户镜像是 linux/amd64 **单架构**；构建发生在 arm64 Mac 时允许 `lucy-amd64` builder + QEMU 跨架构，但**必须完整过 G1–G4 硬门禁**，ELF 架构门禁不得以元数据代替；禁止 `FROM --platform=$BUILDPLATFORM`，禁止 `docker buildx create --use`（污染本机 demo 默认 builder）。

### P5 客户交付与归档

| 步骤 | 动作 | 门 |
|---|---|---|
| P5-1 | 出包 | `bash scripts/gates/build-k8s-delivery-package.sh --image-tag project-lucy:customer-amd64-<版本>-<日期>-<sha> --version-suffix <日期>-rN --output <绝对路径>/delivery.tar.gz [--customer <slug>]` |
| P5-2 | 逐项过 C01–C20 | 每个最终包**分别**记录 PASS/FAIL/PENDING 与证据路径，**不得沿用上一包结论** |
| P5-3 | 引导密钥成套 | 供应方在同次出包生成或复用 `webui-bootstrap-token`；私有附件与软件包成套交付；**不得把补密钥留给部署人员** |
| P5-4 | 原生验收 | 真实 amd64 K3s/K8s 上跑 P0-3 至 P0-6：dry-run → 部署 → 业务验收 → 恢复演练 → 再次升级。**放行身份在 P0-2 一次性写定**，之后不再出包 |
| P5-5 | 放行三元组 | ① 源码提交 ② 镜像 digest ③ 包 SHA256。缺任一项不得称"可部署" |
| P5-6 | 归档 | GitHub Release + 证据包 + 验收表；`productionReady` 必须为 `true` 才可对外 |

**当前状态提示（2026-10-23）：** 客户 20260828-v1 的候选包 `20261021-r7`（镜像 `a93880e`）在 Mac 上已过 G1–G4b 与 G8，但 `productionReady` 仍为 `false`，原生 amd64 的 P0-3 至 P0-6 尚未执行。按 P5-4，这一包**现在还不能放行**。

---

## 4. 门禁矩阵

### 4.1 阻断关系

```
spec-and-webui ──┬─→ business-eval-catalog ──┐
                 ├─→ ktx-diff-audit            │
                 ├─→ docker-smoke ─┬─ demo-db-smoke ─┐
                 │                 └─ postgres-demo-db-smoke ─┤
                 └─→ headless-config ───────────────────────┤
                                                            ├─→ customer-release-readiness ─→ release-package
k8s-static ─────────────────────────────────────────────────┤             ↑
k8s-upgrade-gate ──────────────────────────────────────────┘             │
                                            customer-amd64-native ────────┤
                                                  real-e2e ────────────────┘
```

**图外还有第 14 个 job：** `ktx-upgrade-compat`（`npm run compat:ktx-upgrade`）不参与上图阻断链——它的触发条件是 `workflow_dispatch` 且 `inputs.ktx_version != '0.16.0'`，**只在手动触发并更换捆绑 KTX 版本时运行**，默认的 PR / tag 推送均不执行。其上游依赖 `docker-smoke`、`headless-config`、`demo-db-smoke`、`postgres-demo-db-smoke`、`business-eval-catalog`，用途是在合流前验证 KTX 候选版本的兼容性。上图 13 个 job + 本 job = 工作流实际 14 个 job；§4.2 的表按 14 个 job 逐项列出。

### 4.2 必过门与阻断范围

| Job | 覆盖 | 阻断范围 |
|---|---|---|
| `spec-and-webui` | `lint:version`、`smoke:p0:delivery-isolation`、`lint:spec`、`security:baseline`、术语 lint、WebUI 全量测试与构建 | 合并 `main`、任何发版 |
| `docker-smoke` | `smoke:p0:docker` | 合并 `main`、任何发版 |
| `k8s-static` | H1 静态门 + MCP URL 负例矩阵 + 交付包测试 + 负例测试 | 合并 `main`、任何发版 |
| `k8s-upgrade-gate` | H3/H4：真实 N-1 baseline（ref ≠ HEAD）、Pod `imageID`、UID 0/10001 fixtures、sentinel 保留 | 合并 `main`、任何发版 |
| `headless-config` | `smoke:p0:headless-config`：无头客户配置（bind mount、`LUCY_CONTENT_ROOT`） | 阻断（`customer-release-readiness` 与 `ktx-upgrade-compat` 的依赖） |
| `demo-db-smoke` | `smoke:p0:demo`：MySQL demo + 容器内 SQLite 文件探针。**不是**真实用户 E2E 门 | 阻断（`customer-release-readiness` 与 `ktx-upgrade-compat` 的依赖） |
| `postgres-demo-db-smoke` | `smoke:p0:postgres-demo`：PostgreSQL demo。**不是**真实用户 E2E 门 | 阻断（同上） |
| `customer-amd64-native` | 原生 amd64 单架构候选构建 + G1/G2/G3/G4/G4b/G8 + `BUILD_REVISION` 校验 | 仅 tag / 手动触发 |
| `real-e2e` | 受保护 runner 上的真实用户 E2E：安全、浏览器旅程、真实客户端、证据签名 | 仅 tag / 手动触发；**唯一放行链的一环** |
| `customer-release-readiness` | **唯一客户放行聚合门**：独立复验证据与签名归档 | 仅 tag / 手动触发 |
| `release-package` | 只 promote 已测 digest + 重跑 G1/G2/G4b/G8 + 产出 release notes / SBOM / 部署文档 | 仅 tag / 手动触发 |
| `ktx-diff-audit` | 上游 KTX 差异审计 | 报告用，不阻断 |
| `business-eval-catalog` | 业务 eval 目录可解析 | 阻断（是 `customer-release-readiness` 的依赖） |
| `ktx-upgrade-compat` | `compat:ktx-upgrade`：以候选 KTX 版本重跑兼容性面 | **仅手动触发且 `inputs.ktx_version != '0.16.0'` 时运行**；默认 PR / tag 推送不执行 |

### 4.3 受保护 runner 是硬依赖（当前缺口）

`real-e2e` 跑在 `[self-hosted, lucy-protected, linux, amd64]`。**当前该仓库注册的 self-hosted runner 数量为 0。** 后果是链条性的：

```
无受保护 runner
  → real-e2e 永远无法调度（BLOCKED，不退化为 headless smoke 或本地/arm64 结果）
  → customer-release-readiness 依赖 real-e2e，同样无法完成
  → release-package 永不执行
  → GitHub 路径无法产出客户放行包
```

这不是配置疏忽，是**基础设施缺口**。要恢复 GitHub 发版路径，必须先 provisioning 一台 amd64 节点，具备：kubectl/helm 访问隔离 E2E namespace、真实 Claude Code + OpenClaw CLI（`real-e2e-clients.yaml` v5 要求的最小产品对，Hermes 不计入两个产品）、测试用模型凭据、证据签名密钥。

**在此之前，客户交付只能走本地出包路径**（`scripts/gates/build-k8s-delivery-package.sh` + 人工原生验收），且必须在放行材料里写明"未经 GitHub 门禁链验证"。这一点不能含糊——它是审计叙事的一部分。

---

## 5. 回滚

| 层级 | 手段 | 禁止 |
|---|---|---|
| 代码 | `git revert` 合入 `main`；出 patch 版 | 直接改已发布 tag 指向的提交 |
| 镜像 | `release-package` 重新 promote 一个**已测过**的 digest | gate 后 rebuild |
| 客户环境 | **停机备份（`initial-backup.json` + `backup-*.tgz`，哈希校验）→ 恢复旧卷 + 旧镜像 → 验证业务 → 再次升级** | **Helm rollback 不能代替安全状态恢复**（C16） |
| 客户现场 | 重试**不覆盖**初始备份；失败后用**新的包名、提交、摘要**，从出包入口整段重跑 | 在旧包上补做原生验收后放行 |

**触发回滚的条件**：原生验收出现 FAIL；生产放行后出现业务连续性或安全断言失败；客户升级后业务不连续且 24 小时内无法定位修复。

**回滚演练是发布的一部分**，不是出事后的动作：C16 要求在原生环境完成"恢复旧卷 + 再次升级"，且与放行包同一个身份。

---

## 6. 命令速查

```bash
# 提交前（本地）
npm run lint:version && npm run lint:version:test   # 版本投影
npm run lint:spec                                    # 路由 ↔ 文档
npm run gate:k8s-static                              # Helm 渲染 + 负例
actionlint .github/workflows/lucy-release.yml         # 工作流文件可加载

# 合流
git checkout main && git pull --ff-only
git merge-base --is-ancestor origin/main lucy-v2.0 && echo "FF possible"
# 走 PR，不直推

# 开 2.5
git checkout -b lucy-v2.5 origin/main

# 出包
bash scripts/gates/build-k8s-delivery-package.sh \
  --image-tag project-lucy:customer-amd64-<版本>-<日期>-<sha> \
  --version-suffix <日期>-rN --output <绝对路径>/delivery.tar.gz \
  [--customer <slug>]

# 最终归档独立复验
python3 scripts/gates/verify-customer-upgrade-package.py \
  --tar <绝对路径>/delivery.tar.gz --report <绝对路径>/verification.json
```

---

## 7. 本文件产出的待办（合并前必须清零）

2026-10-23 对仓库与 GitHub 的实际核对结果。**逐条证据与待决策项见配套评审** [`docs/reviews/2026-10-23-lucy-v2.0-release-readiness-review.md`](../reviews/2026-10-23-lucy-v2.0-release-readiness-review.md)。

就 P0 判据本身：**P0-2（工作流文件可加载）已修并校验通过；P0-4（版本投影）与 P0-5（Spec 文档同步）当前为绿；P0-1、P0-3、P0-6、P0-7 尚未满足。**

| # | 事项 | 现状 | 归属 |
|---|---|---|---|
| 1 | CI 工作流文件 `runner.temp` 越界 | **已修**：job 级 `env` → step 级 `env`；actionlint 零 error | 本次已改 |
| 2 | 工作区有未提交改动，且有 agent 并发写入 | **8 个修改 + 2 个新增**未提交（其中 5 个修改来自其他 agent）；Kimi Code / Codex CLI 在同一仓库活动。其中 `webui/docs/03-api-spec.md` 是 `lint:spec` 通过的**硬依赖**，不随合流落地则合流后的 `main` 会在该必需检查上失败 | P0-1：判据是 `git status --porcelain` 无输出，**10 项须一并落盘**（只落盘 8 个修改、留下 2 个新增同样不满足），并确认无 agent 正在提交 |
| 3 | `main` 无分支保护、无 ruleset | 404 Branch not protected | §3.2 执行 |
| 4 | 无 `v2.0.0` tag、无 GitHub Release | 远端只有 `customer-delivery-20261009-v1` | §3.3 补齐 |
| 5 | 受保护 runner 数量 0 | `real-e2e` 永久 BLOCKED | §4.3 provisioning，**需决策是否本期做** |
| 6 | 客户包 `productionReady=false` | 原生 amd64 P0-3–P0-6 未执行 | P5-4 |
| 7 | 版本矩阵缺 hotfix 规则 | 补丁段规则未定义 | 需要 hotfix 时先补矩阵 |
| 8 | 2.5 Spec 全部未冻结 | L25-10/11/12/13/14 为 v0.1-draft | P2 之后按 §3.4 逐条冻结 |

---

## 8. 术语

本文件沿用 [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md)，未引入新的产品概念。"发版列车""合流""切线""放行三元组"是流程术语，不是产品术语。
