# Lucy CI 恢复与分层规范

| 项目 | 内容 |
|---|---|
| 状态 | **定稿 v1.0**（2026-10-29）。用户认同交叉评审反对意见后授权实施 T00–T04 与 Release CI 文档修正。不授权 T05 的分支保护或 ruleset 写入，不授权 R01，不授权在本里程碑修复类型债务 |
| 日期 | 2026-10-29（Asia/Shanghai）；同日由 Draft v0.1 修订为定稿 v1.0 |
| 范围 | main 与 lucy-v0.25 的 GitHub Actions、验证入口、检查结果及迁移治理 |
| 配套计划 | [实施计划](../plans/2026-10-29-ci-restoration-plan.md) |
| 现行事实源 | [开发治理](../governance/DEVELOPMENT.md)、[Release CI](../governance/release-ci.md)、[AGENTS.md](../../AGENTS.md) |

## 1. 结论与边界

CI 已启用，需恢复可信反馈，而非重新打开 Actions 开关。推荐先修复现有流水线，再拆分日常验证与客户交付，最后迁移必需检查。第一轮保持现有重型验证覆盖，避免同时修复故障、减少覆盖和切换分支保护而无法归因。

Draft v0.1 的探查没有修改 workflow、业务代码、测试或仓库设置，也没有 push、触发或重跑 CI。定稿授权的实施范围以 §1.1 为准。现行 Release CI 文档在 T03 / 文档修正落地前仍然有效。

本方案不改 KTX 源码、不新增部署形态、不升级 Lucy / KTX 产品版本、不把 compose 或 kind 验证解释为客户现场验收。恢复日常 CI 与完成客户发布自动化是两个独立里程碑。

## 1.1 评审裁定

2026-10-29 交叉评审的反对意见已由用户认同。下列条款覆盖 Draft v0.1 中与之冲突的表述。

1. PostgreSQL demo 的已证实根因是 compose 的 secret 源文件 `deploy/compose/secrets/webui-bootstrap-token` 不存在。失败发生在 `compose up`，容器尚未启动。T01 验证 `dcb08cf0` 的同一命令。只有该命令仍然失败时，才继续查下一个原因。
2. `webui-typecheck` 放在独立 workflow。它本里程碑不是必需检查，失败也不改变 `lucy-ci.yml` 的结论。干净的 `main` 与 `lucy-v0.25` 各出一份基线。基线不是零时，单列债务并停止：不修改产品类型，不把该 job 放入 `ci-required`。日常恢复不等待类型债务归零。
3. `ktx-diff-audit` 留在日常 workflow，并且不是必需检查。若调整实现，只固定上游 commit SHA。不改为仅手动诊断。
4. 本里程碑的远端证据是 CI 改动本身在 pull request、push `main`、push `lucy-v0.25` 上各有一次完整成功。其后的产品提交失败不抹掉已经成功的 CI SHA。不要求连续 5 次完整成功。
5. `ci-required` 第一版只读取 `needs.*.result`。不在聚合 job 里解析测试总数。某个测试命令在零测试时仍退出 0，由该命令自己的契约处理。
6. `lucy-v0.25` 的 push 触发只服务这条集成分支。分支并入 `main`，或不再作为集成分支时，必须删除该触发。同一提交若同时产生分支 push 和 pull request，两次运行互不取消；AC11 记录这一对的 runner minutes。这不是永久的第二条主干。
7. 授权实施 T00–T04，以及把 Release CI §4 里 compose source bundle 的客户可直接部署表述改回当前支持边界。不授权 T05 的分支保护、ruleset、secret 或 environment 写入，不授权 R01，不授权把 `lucy-v0.25` 整分支并入 `main`。实施分支从开工时的 `lucy-v0.25` 切开，分支名不以 `codex/` 开头。
8. 开工时重新采样 HEAD、远端和工作树。`b3fbc92c` 已包含引导登录和运维问数探针。不要按下面 F03 的旧句去寻找未提交的 smoke 修改。

## 2. 现状证据

### 2.1 快照与可比性

2026-10-29 只读查询 GitHub API 及本地 Git：

| 对象 | 事实 |
|---|---|
| main，本地及远端 | `99f8c2e14060a10af037ae444f87844235aeedc9` |
| 当前本地分支 | `lucy-v0.25`，HEAD `dcb08cf0d1455450e83e4b9093849a29839a36cc` |
| 远端 lucy-v0.25 | `191d4892cfa4399552f7b4bcf6666cead2473b48`，落后本地一个提交 |
| main → 本地 HEAD | main 为祖先，HEAD 领先 125 个提交；不能整分支合并来“修 CI” |
| 初始工作树 | 34 个已修改 / 未跟踪路径；含 Spec 149 在途实现，本轮不接管 |
| Actions | enabled=true，唯一 workflow `Lucy release gates` 为 active |
| 样本 | 最近 30 次运行均 failure；API 总数 223，未据此声称全部历史运行失败 |
| 当前分支运行 | branch=lucy-v0.25 查询返回 0；本地修复尚无该分支远端运行证据 |
| main 分支保护 | strict=true、enforce_admins=true；4 个 Required checks 见下表 |
| 自托管 runner | 仓库 runner 查询返回 total_count=0；本轮未配置或验证外部 runner |
| tag 保护 | `protect-release-tags` 保护 `v*`，禁止删除和非快进更新；不等于执行发布门禁 |

并发变化：文档完成前复核发现，其他工作已将 Spec 149 提交为 `b3fbc92c`，当前工作树仅剩本轮两个方案文档未跟踪。本轮没有创建该业务提交；上表记录的是探查起始快照，类型诊断也对应当时工作树。实施时必须重新采样，不能把起始 HEAD 当作最新 HEAD。

代表运行：

- [main：40102252852](https://github.com/Forrest219/project-lucy/actions/runs/40102252852)，2026-10-24 22:23（北京时间）。
- [PR：40670225987](https://github.com/Forrest219/project-lucy/actions/runs/40670225987)，2026-10-28 18:12（北京时间），来源 `fix/n30-semantic-sidecar-atomic-write`，不是本分支。

| Job | main 样本 | PR 样本 | 当前必需检查 |
|---|---|---|---|
| spec-and-webui | success，4m49s | success，5m36s | 是 |
| docker-smoke | success，2m29s | success，2m27s | 是 |
| k8s-static | success，41s | success，45s | 是 |
| k8s-upgrade-gate | success，15m43s | success，14m00s | 是 |
| business-eval-catalog | success | success | 否 |
| headless-config | success | success | 否 |
| ktx-diff-audit | success | success | 否 |
| demo-db-smoke | failure | failure | 否 |
| postgres-demo-db-smoke | failure | failure | 否 |
| customer-amd64-native / real-e2e / customer-release-readiness / release-package | skipped | skipped | 非日常路径 |
| ktx-upgrade-compat | skipped | skipped | 仅手动候选版本路径 |

因此：这两个样本的 4 个必需检查全部成功，但 workflow 整体失败。分支保护通过不等于日常验证全绿。`skipped` 的交付任务也不代表已经完成交付验证。

main 失败日志进一步确认：MySQL job `120898244223` 在容器就绪后报 `GET /api/project returned HTTP 401`。PostgreSQL job `120898244255` 在 `compose up` 阶段失败，日志为 `webui-bootstrap-token` 的 bind 源不存在，容器没有启动。两处都与 `dcb08cf0` 的修复对象相符。T01 用同一命令验证；PostgreSQL 不再作为未知容器故障重新排查，除非该命令在包含 `dcb08cf0` 的干净检出上仍然失败。

### 2.2 静态核查

| 编号 | 发现与证据 | 影响 / 决策 |
|---|---|---|
| F01 | `.github/workflows/lucy-release.yml:3–18`：PR、main push、v* tag、manual；无本分支 push | 开发分支未开 PR 时无自动反馈；补明确维护分支入口 |
| F02 | main / PR 样本均在两类 demo smoke 命令失败 | 优先修复；不能通过删除 job 或忽略退出码获得全绿 |
| F03 | `dcb08cf0` 已加入 demo bootstrap、MySQL WebUI 会话、Ubuntu 24.04、PR 并发取消、GHCR 命名空间修正；其后 `b3fbc92c` 把运维问数探针一并提交 | 作为待验证候选，不能重复开发或在 Actions 变绿前宣称已修复。探查当时的未提交 smoke 差异已进入 `b3fbc92c` |
| F04 | 同一 workflow 有 14 个 jobs，日常验证、KTX 浮动上游审计、发布写权限及受保护 runner 耦合 | 拆分生命周期及权限；保留同 digest 发布约束 |
| F05 | `webui/package.json:9` 的 build 仅 Vite + 预压缩；workflow 无 tsc | build / Vitest 成功不能证明类型检查成功 |
| F06 | `p0-smoke.mjs:176–188` 会再跑 lint、build 和脚本测试；`--skip-webui-suite` 只跳过 Vitest；demo 和 kind 各自构建 | 存在重复工作；先量化再复用，不跨 ABI 复用 node_modules |
| F07 | `ktx-diff-audit` clone 上游默认分支 HEAD | 可重复性不足。留在日常 workflow，固定上游 commit SHA，不参与必需检查，不改为仅手动 |
| F08 | workflow 顶层 `packages: write`；多数 job 无 timeout；Actions 使用 major tag | 写权限下放发布 job；显式 timeout；批准实施时解析并固定官方 Action SHA |
| F09 | `.github/actionlint.yaml` 已登记自托管标签，但 workflow 无 actionlint 步骤 | 将 workflow 语法校验加入日常门禁；本机未发现 actionlint，本轮未执行 |
| F10 | `customer-release-workflow.test.mjs` 直接解析唯一 workflow 的 jobs / needs | 拆分需同步升级契约测试，保持反绕过断言，不能删除测试迁就文件布局 |
| F11 | 现行 Release CI §4 仍把 compose source bundle 写成客户可直接部署制品 | 与 AGENTS 当前支持边界冲突；实施时同步修正文档，不扩大支持范围 |
| F12 | release-package 的 shell 直接展开 `${{ inputs.release_tag }}` | 手动参数应通过 env 传值并校验格式，避免作为 shell 源码插值 |

### 2.3 本轮本地验证及限制

仅额外执行无输出文件的类型检查：

```sh
webui/node_modules/.bin/tsc --noEmit --incremental false -p webui/tsconfig.json
```

结果 exit=2，75 条 TypeScript 诊断、涉及 34 个文件（217 行输出）。包含测试 fixture 类型失配，也有源文件诊断，例如 `CommandPalette.tsx`、`RoleDetail.tsx`、`CallMonitor.tsx`。环境为本机 Node 24.14.1 / npm 11.11.0、现有依赖、含在途修改的工作树；不能把这些数量归因于 main、干净 HEAD 或 CI Node 22。正式实施必须分别建立干净提交基线。

本轮没有安装依赖或运行全量测试、浏览器、Docker、kind、真实客户端。两个历史样本成功只证明其对应提交，不外推本分支通过。

临时证据位于 `inbox/ci-assessment-20261029/`：runs、main-jobs、pr-jobs、branch-runs、protection、runners、permissions、tag-rules JSON，以及 typecheck-working-tree.txt。该目录被忽略，可清理；正式结论与运行链接保存在本 Spec。失败步骤已确认；具体异常以日志摘录及后续干净重现为准，不能仅凭提交说明认定根因关闭。

## 3. 目标与非目标

1. main 与 `lucy-v0.25` 都有无客户凭据、可重复、失败可定位的日常验证。
2. 必需检查覆盖所有应执行的日常任务，不能在下游 failure / skipped 时报告成功。
3. 保持现有 Docker、MySQL、PostgreSQL、K8s 升级覆盖，第一轮不引入路径裁剪。
4. 正式发布保持 amd64 单架构、ELF 实测、同 digest 验证与晋级、签名证据和客户私有附件合同。
5. 日常 CI 不执行浏览器、移动窄屏或付费真实 Agent；已有正式交付 E2E 合同保留，其设施启用另行完成。

不追求本轮升级工具链、多 Node 全矩阵、全测试并行化、覆盖率阈值、自动部署、自动发布、取消历史测试或清理所有业务技术债。

## 4. 目标流水线与执行矩阵

### 4.1 日常 CI：拟新增 `.github/workflows/lucy-ci.yml`

触发：所有 PR；push 到 `main` 和 `lucy-v0.25`；workflow_dispatch。第一轮不加 workflow 级 paths 过滤，不限制 PR 目标分支。`lucy-v0.25` 这一项是临时入口，删除条件见 §1.1 第 6 款。分支 push 验证原始 HEAD，PR 使用 GitHub merge ref 验证集成状态，证据分别标记。两种运行互不取消。同一提交因此可能把 kind 门禁跑两遍；AC11 记录这一对的 runner minutes。

保留现有 4 个 job ID，使分支保护可连续工作；其他日常 job 按下表组织。现有 ID 不得在两个同事件 workflow 中重名，迁移时原 workflow 同步停止日常触发。

| Job / 类别 | 内容 | 依赖 / 建议超时 |
|---|---|---|
| spec-and-webui | root / webui npm ci；version、ledger、delivery-isolation、spec、security baseline、terminology、IA；Vitest、WebUI build | 独立；20m |
| workflow-contracts | actionlint；日常与发布 DAG、安全边界、聚合状态反例；确定性的 root 脚本测试登记表 | 独立；15m |
| k8s-static | 现有 Helm 静态、打包、负例、entrypoint 与 E2E harness 契约测试 | 独立；15m |
| docker-smoke | 现有容器 / HTTP 冒烟，跳过上游已执行的 WebUI suite | needs spec-and-webui；60m |
| k8s-upgrade-gate | 现有真实 N-1→N、H3/H4、uid fixtures，保持 baseline ≠ HEAD | 独立；90m |
| business-eval-catalog / headless-config | 现有静态目录 / 配置验证，不调用模型 | 独立；各 10m |
| ktx-diff-audit | 现有上游差异审计；固定上游 commit SHA | 独立；15m；不是必需检查 |
| demo-db-smoke / postgres-demo-db-smoke | demo bootstrap / 会话及实际数据库 + MCP 路径 | needs docker-smoke；各 30m |
| ci-required | 聚合本 workflow 内全部 job 的 `needs.*.result`；不解析测试总数 | needs 上述全部；`if: always()`；5m |

`ktx-diff-audit` 不是今天四项分支保护中的一项。它仍留在 `lucy-ci.yml` 内，失败时日常 workflow 失败，这和当前行为一致。

`webui-typecheck` 不在本 workflow 内。它使用拟新增的 `.github/workflows/lucy-typecheck.yml`，触发与日常 CI 相同，执行明确的 `tsc --noEmit`，覆盖源文件和测试配置。该 workflow 的失败不改变 `lucy-ci.yml` 的结论，也不进入 `ci-required`。干净基线不是零时，只交付债务清单；不用 baseline allowlist、忽略测试文件或 `continue-on-error` 把诊断显示成成功。把类型检查并入日常 workflow 或必需检查，需要另一次批准，并且当时的干净基线已经是零。

root 测试不得盲目 `node --test` 扫全仓。实施阶段登记每个 tracked test 的运行器、环境、副作用和命令，确定性测试加入 workflow-contracts 或现有契约 job；需 Docker、集群、浏览器、模型或客户配置的测试归到对应层。每项排除必须写明原因，发现有业务修复需求时单列评审。

### 4.2 发布与诊断：保留 `.github/workflows/lucy-release.yml`

- 正式候选路径：仅 `v*` tag 或显式选择 customer-candidate 的手动入口；不因日常 CI 绿灯自动发布。
- 手动入口必须先选择模式：diagnostics 为安全默认、ktx-compat 仅兼容验证、customer-candidate 才进入有写权限的候选链。重跑同一候选需标记 run attempt，禁止覆盖身份不同的 tag。
- 发布路径在同一个 SHA 上重跑所需日常与交付门禁，再执行现有 native candidate → real-e2e → readiness → digest promote → final gates。不得从最近一次任意成功 run 推定当前候选通过，不通过 workflow_run 跨信任边界启动发布。
- `ktx-diff-audit` 留在日常 workflow，并固定上游 commit。报告写明 Lucy SHA、KTX npm 版本与 upstream SHA。diagnostics 模式可以再次运行同一审计，但不替代日常 job。ktx-compat 不触发客户镜像或 package 发布。
- `real-e2e` 的受保护 runner、隔离集群、测试模型凭据及签名公私钥未齐备时，发布路径保持 BLOCKED。增前置设施检查，缺失时尽早失败，禁止消耗数小时排队后用 smoke 替代。
- 日常路径拆出后，发布路径及脚本依赖闭包必须仍完整。可复用同仓脚本，先接受跨独立 run 的重复验证；不为缓存收益牺牲 SHA / digest 绑定。
- 公共 CI artifact 仅包含无密钥软件与脱敏证据。客户特定 C01 / C05 / C20 与 bootstrap 私有附件由供应方打包流程承担；通用镜像构建不会因此变成可部署客户包。启用这部分自动化需独立批准凭据设施。

## 5. 可重复性、安全与诊断

- Hosted 基线 Ubuntu 24.04 / Node 22；实施时固定实测可用的 Node 22 patch（必须满足锁文件 jsdom ≥22.13、Vite ≥22.12 等约束），两份 npm lock 使用 npm ci。根 engines 的 ≥22 不应作为充分兼容证据。不在本任务升级 major。
- 固定 Helm / kind / Action 版本或 SHA，记录 Docker、kubectl、npm 实测版本；建立显式更新任务。KTX 默认保持 0.16.0。
- 缓存只缓存下载内容；key 包含 OS、架构、Node / npm 与锁摘要；不复用宿主 node_modules 到镜像。不从 PR 写入共享发布镜像缓存或拉取未绑定身份的历史证据。
- 干净 runner 只从 example 生成 `ktx.yaml`、`access.yaml`；测试运行时状态、数据库及 Token 放隔离临时目录。拒绝读开发机私有配置或客户数据库；禁止输出 Token、session ID、密码、签名私钥。
- 默认 contents:read，checkout persist-credentials:false；只有 candidate 与 promote job 拥有 packages:write。不用 pull_request_target 执行 PR 代码；自托管 runner 不接收 PR / 不受信 ref。
- 发布凭据与签名步骤绑定受保护 environment；具体环境、审批人和 Secret 只在批准后配置。Secret 内容不属于本次探查输出。
- PR 新提交取消旧 run；main / 维护分支可取消过时的日常验证；发布不自动取消。concurrency key 包含 workflow + 事件 / PR号 / ref，避免 push 和 PR 互相取消。
- 每个 job 有上表 timeout，耗时子进程也有界限；外部下载最多有限重试，断言失败不自动重试变绿。收集证据与清理使用 always，不覆盖原失败。
- 记录 SHA、event、ref、run_id、attempt、工具版本、开始结束、命令退出码、该命令自己报告的测试总数与 skip 数、失败阶段；有镜像时增加 digest。异常和缺失证据分别报告。零测试却退出 0 由该测试命令的契约拒绝。`ci-required` 不读取这个计数。
- artifact 使用明确白名单，日常诊断保留 14 天，发布证据建议 90 天（按仓库配额核定）；日志上传前脱敏，禁止上传整个 .ktx、checker、运行时库或临时凭据目录。

## 6. 核心流程（伪代码）

```text
on event:
  if PR or push(main/lucy-v0.25) or manual(daily):
    checkout exact event revision; record head SHA and merge SHA when present
    materialize only example fixtures; install locked dependencies
    execute all daily jobs (no path-based exclusions in first rollout)
    always run ci-required:
      for job in jobs of this daily workflow, except ci-required itself:
        if result(job) != success: FAIL(job, result); exit nonzero
      PASS daily verification only
  typecheck workflow, same events, separate conclusion:
    run tsc --noEmit on a clean checkout
    record the diagnostic count; never change the daily workflow result
  else if manual(diagnostics/ktx-compat):
    execute only selected diagnostics with pinned identities; never promote
  else if tag(v*) or manual(customer-candidate):
    verify trusted ref + protected environment + required facilities
    if missing runner/credentials/cluster/baseline: BLOCKED; do not promote
    execute release dependency closure at this SHA
    build single linux/amd64 candidate once; bind SHA + KTX + digest
    run native architecture/ELF/runtime gates and real E2E for same digest
    independently verify complete signed evidence
    if any required result missing/failed/blocked: FAIL; do not promote
    promote same digest; re-run final gates; emit credential-free artifacts
    customer-instance packaging separately enforces C01/C05/C20
```

聚合 job 使用 `if: always()`，禁止默认 success() 导致自身 skipped。依赖的 skipped / cancelled / timed_out 都不是 success。初期没有合法路径跳过；未来若引入变更分类，必须另审分类算法及失败默认全量策略。

## 7. 验收标准

| ID | 可验证条件 |
|---|---|
| AC01 | main 与 lucy-v0.25 干净 checkout、无私有配置可运行；分支 push、PR、main push、manual daily 均可观察，证据明确 ref / SHA |
| AC02 | MySQL 401 与 PostgreSQL 缺失 `webui-bootstrap-token` 均有失败日志；`dcb08cf0` 所在干净检出上，同一 smoke 命令成功，并且 bootstrap 与 MCP 业务断言实际执行，不能只看健康探针。命令仍失败时才记录新的根因 |
| AC03 | 所有现有日常 job 保留覆盖并 success；WebUI 测试总数 >0，新增门禁有执行记录 |
| AC04 | 干净 `main` 与 `lucy-v0.25` 的 `tsc --noEmit` 基线分别记录诊断数量和命令。`lucy-typecheck.yml` 能在 PR 上看见。本里程碑不要求诊断为零，也不把该 workflow 纳入 `ci-required` 或日常恢复完成条件 |
| AC05 | `lucy-ci.yml` 内任一依赖的 result 为 failure、skipped、cancelled 或缺失时，`ci-required` 不得成功。聚合 job 不解析测试总数。workflow 未触发导致必需检查缺失时，现有分支保护仍阻止合并；本里程碑不新增保护规则 |
| AC06 | 已有发布反绕过测试适配拆分后继续通过；未签名、错误 SHA/digest、E2E 缺失、runner 缺失均禁止晋级 |
| AC07 | PR / daily 无 packages 写权限、客户 Secret、自托管 runner、浏览器或模型调用；manual diagnostics 不产生客户发布制品 |
| AC08 | 真实新提交覆盖旧 PR run 时可取消；push / PR 不互相取消；失败及 timeout 有脱敏证据和清理记录 |
| AC09 | CI 改动本身在 pull request、push `main`、push `lucy-v0.25` 上各有一次完整成功，运行记录写明 ref 与 SHA。不要求连续 5 次。后续产品提交的失败不抹掉这三次已成功的 SHA。三次证据不自动授权切换 Required checks |
| AC10 | Plan §5 的迁移顺序保留：先并存 `ci-required` 与旧 4 项，再移除旧项；禁止清空保护。本里程碑不执行迁移，T00–T04 也不以迁移完成为出口 |
| AC11 | 单次日常 workflow 的快速 jobs 目标 ≤10 分钟，完整墙钟目标 ≤25 分钟（不含排队，不是 SLA）。至少用 AC09 的三次运行记录墙钟和 runner minutes。同一 SHA 的分支 push 与 PR 若各跑一遍，分别记录，并把两遍合计写明。超标要给出具体 job |
| AC12 | 正式交付设施未完成时报告“日常 CI 已恢复 / 客户自动发布 BLOCKED”；不以绿灯宣称客户验收完成 |

## 8. 方案评审与取舍

- **仅修 demo 并保留单 workflow**：可最快验证 `dcb08cf0`，但留着权限、超时和分支 push 缺口。T01 做验证，T03 仍要分层。
- **定稿：先验证现有故障，再拆日常 / 发布，类型检查单独成 workflow**：保留 kind 路径。`ci-required` 可以加进 `lucy-ci.yml`，但本里程碑不把它写成必需检查。
- **首轮把 Docker / kind / DB 改成 nightly 或按路径跳过**：会降低现有 PR 覆盖。本版不采纳。
- **类型债务归零之后才宣布日常 CI 恢复**：会把未测量的产品类型修复绑进 CI 里程碑。本版不采纳。类型检查可见，但不决定 `lucy-ci.yml` 的成败。
- **把 `ktx-diff-audit` 移出日常 workflow**：会减少当前已经绿的覆盖。本版不采纳。

本版批准实施：保留重型 PR 覆盖；为 `lucy-v0.25` 增加临时 push 触发；日常 / 发布 / 类型检查三个 workflow；`ci-required` 只聚合日常 job 的 result。本版不批准切换分支保护，不批准客户 runner、模型凭据、签名设施或正式发布。

## 定稿记录

2026-10-29 用户认同交叉评审的六条反对意见，并授权把 Spec 与 Plan 定为 v1.0。实施入口是 Plan 的 T00–T04 与 T06。T05 与 R01 的文字保留为后续操作说明，不是本次开工范围。

## Terminology Compliance

遵循 `webui/docs/00-product-terminology-standard.md`。无新增产品术语；CI、job、workflow、SHA、digest、Required checks 为工程术语。PASS / failure / BLOCKED 分别描述验证、执行及前置缺失，不表示客户发布批准。

## 参考

- [GitHub Required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)：workflow 级过滤可能留下 Pending，聚合需显式覆盖失败依赖；未来启用 merge queue 时需新增 merge_group，当前不自行启用。
- [GitHub Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)：job 级 permissions、条件及执行策略。
