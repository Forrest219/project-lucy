# 交付记录：Lucy CI 恢复（实施证据与验收状态）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy CI 恢复里程碑执行记录与验收状态 |
| 文档类型 | Execution Record（实施证据与验收状态） |
| 版本 | v1.0 |
| 状态 | 日常 CI 已恢复；客户自动发布 **BLOCKED**。**本文不是验收通过声明**，验收由后续流程另行判定 |
| 日期 | 2026-10-29（Asia/Shanghai） |
| 合同 | [`docs/specs/lucy-ci-restoration-spec.md`](../specs/lucy-ci-restoration-spec.md) v1.0 · [`docs/plans/2026-10-29-ci-restoration-plan.md`](../plans/2026-10-29-ci-restoration-plan.md) v1.0 |
| 授权范围 | T00–T04、T06。**T05（Required checks 迁移）与 R01（客户发布设施）未授权，未开工** |
| 实施分支 | `feature/ci-restoration-v025` → [PR #58](https://github.com/Forrest219/project-lucy/pull/58)（base `lucy-v0.25`），已合并 |
| 回移分支 | `feature/ci-restoration-main` → [PR #59](https://github.com/Forrest219/project-lucy/pull/59)（base `main`），已合并（merge commit `731907f8`） |
| 记录归属 | 本记录归档在实施分支 `feature/ci-restoration-v025`。`main` 收到的是 CI 变更本身与治理事实源更新（PR #59） |

> **边界声明**：本记录只汇总已授权范围内的实施与已观测到的远端结果。AC 状态只使用「满足 / 未满足 / 未授权 / BLOCKED」四种取值。未观测到的证据一律不写成结论。

---

## 1. 结论

1. **日常 CI 已恢复。** 四个绿色的 `Lucy CI` 运行：pull request 两次（实施分支 `40851769267`、回移分支 `40854054207`）、push `lucy-v0.25` 一次（`40854095580`）、push `main` 一次（`40856163689` attempt 2），覆盖 AC09 的三类事件。日常 workflow 的 10 个 job 全部 success，`ci-required` 聚合门禁为 success。

2. **客户自动发布仍然 BLOCKED。** 正式交付所需的受保护 amd64 runner、隔离集群、测试模型凭据与签名密钥在本里程碑没有就绪，`real-e2e` 无法被调度，`customer-release-readiness` 与 `release-package` 保持 BLOCKED。日常 CI 变绿不等于客户验收完成。

3. **类型债务是记录下来的基线，不是本里程碑的缺陷。** `main` 的干净基线为 85 条诊断 / 30 个文件，`lucy-v0.25` 线为 75 条诊断 / 34 个文件（见 §6）。没有修改任何产品类型，没有类型 allowlist，没有把类型检查并入 `ci-required`。

4. **本轮修复了 4 个远端失败**：两个 demo 冒烟失败同源（compose secret 文件在容器内不可读），一个是静态门禁的既有 shellcheck 告警，一个是 workflow-contracts 的检出深度。回移到 `main` 时另暴露 2 个 `main` 自身的缺口（依赖清单与 demo 认证），见 §3.6。`push main` 的第一次尝试还遇到一次外部 registry 故障，见 §4.3。逐条根因与证据见 §3。

---

## 2. 交付物

### 2.1 实施分支 `feature/ci-restoration-v025`

| 提交 | 内容 |
|---|---|
| `324ff4f6` | `docs(ci)`: 落定稿的 Spec 与 Plan（合同本身） |
| `2be3f0bc` | `feat(ci)`: 拆分日常 / 发布 / 类型检查三个 workflow |
| `05c86b2f` | `docs(ci)`: 修正 compose source bundle 的交付边界表述与 workflow 描述 |
| `467ff814` | `fix(smoke)`: 让容器用户能读取 compose secret 文件 |
| `5cb8a21c` | `fix(ci)`: 清掉 workflow-contracts 的 shellcheck 告警 |
| `6b9a67b1` | `fix(ci)`: 让类型检查真正报出诊断数量 |
| `1baeefc8` | `fix(ci)`: workflow-contracts 改为完整历史检出 |

### 2.2 `main` 回移 `feature/ci-restoration-main`

| 提交 | 内容 |
|---|---|
| `6c0a639d` | `feat(ci)`: 回移 CI 变更到 `main` |
| `e0e62a35` | `fix(ci)`: 保持 `main` 自己的依赖与 demo 契约（清单、demo 认证、compose secret 挂载） |

两个提交合计改动 23 个文件：三个 workflow、`scripts/gates/` 的聚合门禁与 root 测试登记表、两个 demo 冒烟脚本与 token helper、两份 manifest（只加脚本入口）、`deploy/compose/` 的两个 demo compose、以及治理与合同文档。

回移**不是**把 `lucy-v0.25` 整分支并入 `main`（Spec §1.1 第 7 款）。`main` 只拿到 CI 变更、治理事实源，以及 `dcb08cf0` 中仍然适用的 demo 认证部分（Plan §1.3 要求的逐文件回移）。`lucy-v0.25` 线上的 Spec 149 产品提交没有进入 `main`。

### 2.3 三个 workflow 与治理文档

| 文件 | 说明 |
|---|---|
| `.github/workflows/lucy-ci.yml` | 日常验证。10 个 job + `ci-required` 聚合门禁 |
| `.github/workflows/lucy-typecheck.yml` | 类型检查，独立生命周期，失败不改变日常 workflow 结论 |
| `.github/workflows/lucy-release.yml` | 只保留发布 / 诊断路径 |
| `scripts/gates/root-test-registry.json` | root 测试登记表，替代 `node --test` 全仓扫描 |
| `docs/governance/release-ci.md` | 触发、job、Required checks 与 compose 交付边界 |

---

## 3. 本轮修复的失败与根因

起点是 run `40827813304`（pull request，SHA `05c86b2f`）的 4 个红 job。逐条如下。

### 3.1 `demo-db-smoke` — 503 `BOOTSTRAP_NOT_PROVISIONED`

日志：`POST /api/auth/bootstrap returned HTTP 503 BOOTSTRAP_NOT_PROVISIONED`。

根因：Docker Compose 把 file 型 secret 实现为 bind mount，容器看到的是宿主机文件自身的 mode 与属主，且 Compose 无法为 file 型 secret 重映射 uid/gid。冒烟脚本用 `0600` 写 `webui-bootstrap-token`，属主是宿主机用户；镜像以 `USER 10001:10001` 运行（`Dockerfile:140`），容器读不到该文件。`webui/server/auth/bootstrap-token.ts:7` 的 `readProvisionedToken()` 把读取失败折叠成 `null`，于是 WebUI 报「未配置引导密钥」而不是「读不到」。

这不是原来的 401：401 表示引导密钥被读到但不匹配，503 表示读不到。两者是不同状态。

### 3.2 `postgres-demo-db-smoke` — `EACCES: permission denied, open '/run/secrets/postgres_password'`

日志：`ktx connection test demo-postgres` 退出码 1，ktx 报 EACCES。

根因：与 3.1 同源。`examples/postgres-demo/project-template/ktx.yaml:12` 用 `password: file:/run/secrets/postgres_password` 让容器内的 ktx 读挂载进来的密码文件，文件是 `0600`，容器用户读不到。

本地复现（在 Docker 的 Linux VM 内，用具名卷使 DAC 真正生效）：

```text
mode 600 owner 0:0 → uid 10001 读取：Permission denied（与 CI 日志一致）
mode 644 owner 0:0 → uid 10001 读取：成功
```

### 3.3 修复方式

`scripts/smoke/ensure-webui-bootstrap-token.mjs` 与 `scripts/smoke/p0-postgres-demo-smoke.mjs` 现在把 secret 文件写成容器用户可读的 `0644`。宿主侧的保密性由**目录**承担：helper 自己创建的目录是 `0700`，冒烟临时目录来自 `mkdtemp` 也是 `0700`。`ensureWebuiBootstrapToken` 还会把别的生产者用 `0600` 建出来的文件修正成可读。

未改产品代码、ACL、数据库配置或产品版本。

### 3.4 `workflow-contracts` — actionlint / shellcheck

run `40827813304` 报 `SC2129`（style，2 处）与 `SC2016`（info，5 处），全在 `lucy-release.yml` 既有代码上。

- `SC2129`：连续多行 `echo ... >> "$GITHUB_OUTPUT"`。改为 `{ ...; } >> "$GITHUB_OUTPUT"` 一组，与同一步骤里已有的 `release/image-identity.txt` 写法一致。追加内容不变。
- `SC2016`：发布门禁用 `bash -c '...'` 且内层脚本单引号是**故意**的——外层 shell 不能展开 `IMAGE_REF` / `KTX_VERSION` / `LUCY_VERSION` / `GITHUB_SHA`，内层 bash 才展开。ShellCheck 透过 `gate` 包装看不到这个意图。

处理方式：每条受影响命令上方加 `# shellcheck disable=SC2016` 并写明原因。**没有**用文件级豁免：actionlint 交给 ShellCheck 的脚本前面总会先加一行 `set -eo pipefail`（actionlint `rule_shellcheck.go`），所以放在顶部的指令永远不是文件级的，只会盖住它后面那一条命令；文件级豁免还会顺带盖掉这个 workflow 将来可能出现的真实 SC2016。

门禁命令本身逐字未改，只有重定向分组和指令注释。

验证：actionlint 1.7.7 配 ShellCheck 0.10.0、0.11.0 均无 finding；CI runner 上的 actionlint 步骤通过。

### 3.5 `workflow-contracts` — 浅检出

run `40850643569`（actionlint 修好后第一次跑到这一步）报：

```text
docs/releases/v0.2.0.json: commit 14a8bee16c55b5d9885c8ab4c3464614503735dc
cannot be verified because the checkout is shallow, so the commit is not in
the object database. The ledger cross-check needs full history — check out
with fetch-depth: 0.
```

根因：`workflow-contracts` 用默认 `fetch-depth: 1` 且不取 tag，而登记在册的 `scripts/release/release-ledger.test.mjs` 要把每条发布记录解析到对象库里的 tag 与 commit。门禁如实报了「无法验证」而不是「已验证」。

修复：`workflow-contracts` 改为 `fetch-depth: 0`，与 `spec-and-webui` 已有的做法一致。

### 3.6 `main` 回移时暴露的两处 `main` 自身缺口

PR #59 第一次运行（run `40853385051`）红在 `spec-and-webui` 与 `k8s-static`：

- `npm error Missing: punycode.js@2.3.1 from lock file` —— 回移时连 `webui/package.json` 一起搬了 `lucy-v0.25` 线的 `jose` / `nodemailer` / `smtp-server` 三个依赖，而 `main` 的 lock 没有。**清单回到 `main` 自己的版本**，只加脚本入口，两份 npm lock 未改。
- `not ok 17 - demo compose files mount the bootstrap secret as a file secret` —— `main` 的 `docker-compose.demo.yml` 根本没有引导 secret，而 `main` 自己的 `upgrade-lucy.test.mjs` 断言它有。这是 `main` 上先有的测试与实现不一致，只是此前 `main` 从未运行 root 测试登记表。按 Plan §1.3 逐文件回移 `dcb08cf0` 中仍然适用的部分：demo compose 的 customer 模式与 secret 挂载、postgres compose 的 secret 目录覆盖、demo 冒烟脚本的引导会话、`version-matrix.md` 的单架构表述。

---

## 4. 远端证据

| Run | Event | Ref | SHA | 结果 | 链接 |
|---|---|---|---|---|---|
| `40827813304` | pull_request | `feature/ci-restoration-v025` | `05c86b2f` | failure（诊断基线） | [run](https://github.com/Forrest219/project-lucy/actions/runs/40827813304) |
| `40827813307` | pull_request | `feature/ci-restoration-v025` | `05c86b2f` | failure（类型检查，exit 2） | [run](https://github.com/Forrest219/project-lucy/actions/runs/40827813307) |
| `40850643569` | pull_request | `feature/ci-restoration-v025` | `6b9a67b1` | failure（浅检出，被后续提交取代） | [run](https://github.com/Forrest219/project-lucy/actions/runs/40850643569) |
| `40851769267` | pull_request | `feature/ci-restoration-v025` | `1baeefc8` | **success** | [run](https://github.com/Forrest219/project-lucy/actions/runs/40851769267) |
| `40851769198` | pull_request | `feature/ci-restoration-v025` | `1baeefc8` | failure（类型检查，exit 2，75 条） | [run](https://github.com/Forrest219/project-lucy/actions/runs/40851769198) |
| `40853385051` | pull_request | `feature/ci-restoration-main` | `6c0a639d` | failure（回移第一版，见 §3.6） | [run](https://github.com/Forrest219/project-lucy/actions/runs/40853385051) |
| `40854054207` | pull_request | `feature/ci-restoration-main` | `e0e62a35` | **success** | [run](https://github.com/Forrest219/project-lucy/actions/runs/40854054207) |
| `40854054169` | pull_request | `feature/ci-restoration-main` | `e0e62a35` | failure（类型检查，exit 2，85 条） | [run](https://github.com/Forrest219/project-lucy/actions/runs/40854054169) |
| `40854095580` | push | `lucy-v0.25` | `cae69bbd` | **success** | [run](https://github.com/Forrest219/project-lucy/actions/runs/40854095580) |
| `40854095473` | push | `lucy-v0.25` | `cae69bbd` | failure（类型检查，exit 2，75 条） | [run](https://github.com/Forrest219/project-lucy/actions/runs/40854095473) |
| `40856163689` | push | `main` | `731907f8` | attempt 1 failure（外部 registry 故障，见 §4.3）→ attempt 2 **success** | [run](https://github.com/Forrest219/project-lucy/actions/runs/40856163689) |
| `40856163703` | push | `main` | `731907f8` | failure（类型检查，exit 2，85 条） | [run](https://github.com/Forrest219/project-lucy/actions/runs/40856163703) |

AC09 的三类事件各有一次完整成功：pull request `40851769267`（实施分支）、push `lucy-v0.25` `40854095580`、push `main` `40856163689`（attempt 2）。

### 4.1 绿色 PR 运行 `40851769267` 的 job 明细

| Job | 结果 | 备注 |
|---|---|---|
| `spec-and-webui` | success | WebUI 388 个测试文件 / 4610 个测试通过；terminology lint 扫 1064 个文件；IA boundary lint 通过；build 2260 modules |
| `workflow-contracts` | success | actionlint 无 finding；62 项 workflow 契约 + 294 项登记 root 契约通过 |
| `k8s-static` | success | Helm 静态、打包、负例、entrypoint、E2E harness 契约 |
| `docker-smoke` | success | 容器与 HTTP 冒烟 |
| `k8s-upgrade-gate` | success | 真实 N-1→N、H3/H4 |
| `business-eval-catalog` | success | 静态目录 |
| `headless-config` | success | 配置验证 |
| `ktx-diff-audit` | success | 上游固定 commit `49a4ae6f5b28c904da921afc0ee72da6db7ac202` |
| `demo-db-smoke` | success | 见 §4.2 |
| `postgres-demo-db-smoke` | success | 见 §4.2 |
| `ci-required` | success | 聚合门禁通过 |

`main` 回移分支上的同一次运行（run `40854054207`）job 结构相同，`workflow-contracts` 在 `main` 上跑 62 项 workflow 契约 + 277 项登记 root 契约（`main` 的 83 个 tracked root test 全部在登记表内）。

### 4.2 demo 冒烟确实执行了业务断言（不是只探活）

`demo-db-smoke`（run `40851769267`）：

```text
[p0-demo-smoke] bootstrapped WebUI owner ci-demo
[p0-demo-smoke] demo counts match baseline: orders=1000, people=4, returns=60
[p0-demo-smoke] sqlite file connection test and sql query passed
[p0-demo-smoke] proxy lucy_query returned 4 baseline-matched rows
```

`postgres-demo-db-smoke`（run `40851769267`）：

```text
$ docker compose ... exec -T lucy ktx --project-dir /data/lucy connection test demo-postgres
$ docker compose ... exec -T lucy ktx --project-dir /data/lucy admin reindex --force --output json
$ docker compose ... exec -T lucy ktx --project-dir /data/lucy sl validate superstore_orders --connection-id demo-postgres
[p0-postgres-demo-smoke] proxy lucy_query returned 4 rows
```

引导会话、数据基线比对、连接测试、重建索引、语义层校验与 MCP 查询路径都真实执行。

### 4.3 push `main` 的第一次尝试因外部 registry 故障失败

run `40856163689` 的 attempt 1 红在两个 job，根因都不在仓库内：

```text
docker-smoke
  ERROR: failed to copy: httpReadSeeker: failed open: unexpected status code
  https://registry-1.docker.io/v2/docker/dockerfile/manifests/sha256:b5f3b260...:
  500 Internal Server Error
  → failed to build: failed to solve: failed to resolve source metadata for
    docker.io/docker/dockerfile:1.7

k8s-upgrade-gate
  npm error 404 Not Found
  ERROR: failed to build: failed to solve: process
  "/bin/sh -c npm install -g \"@kaelio/ktx@${KTX_VERSION}\"" did not complete successfully
```

同一棵树在 30 分钟前的 pull request 运行（`40854054207`）里两个 job 都是 success，可以确认这是外部下载抖动，不是本次变更引入的缺陷。

按 Spec §5「外部下载最多有限重试」，对该 SHA 的失败 job 做了 re-run（attempt 2）。attempt 2 中 `docker-smoke`、`demo-db-smoke`、`postgres-demo-db-smoke` 全部 success，`k8s-upgrade-gate` 的结果见 §4 表。attempt 1 的失败与其原因保留在此，不被 attempt 2 覆盖。

断言失败没有、也不会用 re-run 变绿：这一轮两个 job 都没有跑到断言。

---

## 5. 耗时与 runner minutes（AC11）

| 运行 | 事件 / 分支 | 墙钟 | job 分钟合计 | 快速 job |
|---|---|---|---|---|
| `40851769267` | pull_request / `feature/ci-restoration-v025` | 14.2 min | 31.9 min | business-eval-catalog 0.2 / headless-config 0.2 / ktx-diff-audit 0.3 / workflow-contracts 0.3 / ci-required 0.2 / k8s-static 1.1 |
| `40854054207` | pull_request / `feature/ci-restoration-main` | 12.9 min | 26.9 min | business-eval-catalog 0.2 / headless-config 0.2 / ktx-diff-audit 0.2 / workflow-contracts 0.4 / ci-required 0.1 / k8s-static 0.7 |
| `40854095580` | push / `lucy-v0.25` | 14.1 min | 31.0 min | business-eval-catalog 0.1 / headless-config 0.1 / ktx-diff-audit 0.2 / workflow-contracts 0.4 / ci-required 0.1 / k8s-static 1.1 |
| `40856163689` | push / `main`（attempt 2） | 12.8 min（attempt 2 自 re-run 起算）／20.6 min（含 attempt 1 全程） | 27.5 min | business-eval-catalog 0.2 / headless-config 0.2 / ktx-diff-audit 0.3 / workflow-contracts 0.4 / ci-required 0.1 / k8s-static 0.7 |
| `40827813304` | pull_request / 失败基线 | 14.4 min | 31.2 min | 同上量级 |

四次绿色运行的墙钟为 14.2 / 12.9 / 14.1 / 12.8 min，都低于 25 min 目标；快速 job 全部在开跑后约 1 min 内结束，低于 10 min 目标。最慢的 job 始终是 `k8s-upgrade-gate`（12.6–14.0 min，真实 N-1→N kind 升级），其次 `spec-and-webui`（5.1–8.4 min）。

`push main` 那一行给的是 attempt 2 自己的一段：attempt 1 已经 success 的 6 个 job 保留了 attempt 1 的时间戳，所以「最早 job 开始 → 最晚 job 结束」会把 attempt 1 的 8 分钟也算进去。两个数都写出来，避免把重跑的代价藏起来。

`pull_request` 与分支 push 是两组不同的 concurrency key，互不取消，因此同一 SHA 在两条路径上各跑一遍时**两遍都计入**上表，不做合并。

---

## 6. 类型债务基线（AC04）

命令（两个分支一致）：

```sh
webui/node_modules/.bin/tsc --noEmit --incremental false -p webui/tsconfig.json
```

| 分支 | SHA | 运行环境 | 退出码 | 诊断数 | 涉及文件 |
|---|---|---|---|---|---|
| `main` | `99f8c2e1`（干净检出） | 本机 Node 22.23.3 / npm 10.9.9 / TypeScript 6.0.3 | 2 | 85 | 30 |
| `main` | `e0e62a35`（回移分支） | CI ubuntu-24.04 / Node 22.23.4 | 2 | 85 | 30 |
| `main` | `731907f8`（push `main`） | CI ubuntu-24.04 / Node 22.23.4 | 2 | 85 | 30 |
| `lucy-v0.25` 线 | `1baeefc8` | CI ubuntu-24.04 / Node 22.23.4 | 2 | 75 | 34 |
| `lucy-v0.25` 线 | `cae69bbd`（push `lucy-v0.25`） | CI ubuntu-24.04 / Node 22.23.4 | 2 | 75 | 34 |

`main` 的三次测量一致（85 / 30），`lucy-v0.25` 线的两次测量一致（75 / 34），本机与 hosted runner 一致。

本里程碑**没有**修改任何产品类型：没有类型 allowlist，没有排除测试文件，没有 `continue-on-error`，没有把类型检查并入 `ci-required`，类型检查 workflow 的失败不改变 `lucy-ci.yml` 的结论。

为让基线可记录，类型检查步骤修了一处：runner 以 `bash -e` 执行该步骤，失败的 `tsc` 会在那一行中止脚本，导致诊断数从未被打印。现在先捕获退出码再打印计数，退出码不变。

---

## 7. 验收标准逐条状态

| AC | 状态 | 依据 |
|---|---|---|
| AC01 | 满足 | `main` 与 `lucy-v0.25` 的干净检出均可运行；pull request、push `main`、push `lucy-v0.25` 三类事件均有运行记录并写明 ref 与 SHA（§4） |
| AC02 | 满足 | 原失败日志见 §3.1 / §3.2；`40851769267` 中两类 demo 的引导、连接、数据与 MCP 业务断言真实执行（§4.2） |
| AC03 | 满足 | 10 个既有日常 job 全部保留并 success；WebUI 388 文件 / 4610 测试 > 0；新增 `workflow-contracts` 与 `ci-required` 有执行记录（§4.1） |
| AC04 | 满足 | 两个分支的 `tsc --noEmit` 基线已记录（§6）；`lucy-typecheck.yml` 在 PR 上可见（run `40851769198`、`40854054169`）；诊断不为零，不影响日常恢复 |
| AC05 | 满足 | `ci-required` 只读 `needs.*.result`，失败 / skipped / cancelled / timed out / 缺失均为失败，12 条契约测试覆盖（`ci-required-gate.test.mjs`）；实测中 `ci-required` 随 `workflow-contracts` 失败而为 failure（run `40850643569`） |
| AC06 | 满足 | `customer-release-workflow.test.mjs` 随拆分同步升级并通过（未签名、错误 SHA/digest、E2E 缺失、runner 缺失均禁止晋级的断言保留） |
| AC07 | 满足 | 日常与 PR workflow 无 `packages:write`、无客户 Secret、无自托管 runner、无浏览器与模型调用；`packages:write` 只在发布 workflow 的候选镜像与晋级 job 上（契约测试覆盖） |
| AC08 | 满足 | 推送新提交取消旧 PR run 已实测（`40850643569` 被 `40851769267` 取代）；push 与 pull request 的 concurrency key 不同，互不取消；失败与超时均有脱敏证据与清理记录 |
| AC09 | 满足 | CI 改动在 pull request（`40851769267`、`40854054207`）、push `lucy-v0.25`（`40854095580`）、push `main`（`40856163689` attempt 2）上各有一次完整成功，运行记录写明 ref 与 SHA（§4） |
| AC10 | 满足 | Plan §5 的迁移顺序原样保留，本里程碑未执行迁移，未调用保护规则 API，`main` 的 4 项 Required checks 仍为 `spec-and-webui` / `docker-smoke` / `k8s-static` / `k8s-upgrade-gate` |
| AC11 | 满足 | 四次绿色运行的墙钟与 runner minutes 见 §5；快速 job 与完整墙钟均在目标内 |
| AC12 | 满足 | 报告口径为「日常 CI 已恢复 / 客户自动发布 BLOCKED」（§1.2、§8） |

---

## 8. 未完成、未授权与 BLOCKED

| 项目 | 状态 | 说明 |
|---|---|---|
| T05 Required checks 迁移 | **未授权** | 未执行。`main` 的分支保护、ruleset、secret、environment、runner 一律未改。`ci-required` 已存在但**不是** Required check |
| R01 客户发布设施 | **未授权** | 受保护 amd64 runner、隔离 K8s / DB、测试模型凭据、签名密钥、registry environment、实例私有附件闭环均未开工 |
| 客户自动发布 | **BLOCKED** | `real-e2e` 无可用受保护 runner，`customer-release-readiness` 与 `release-package` 不产出客户制品。日常 CI 变绿不构成客户验收 |
| 产品类型债务 | **未满足（有意）** | 75 / 85 条诊断是已记录基线，本里程碑不修 |
| `main` 的 `version-matrix.md` 早期表述 | 观察项 | `main` 的 `version-matrix.md` 曾描述多架构 manifest list，与 `main` 自己的单架构发布 workflow 不符。该漂移先于本里程碑存在，本次回移已随 `dcb08cf0` 的适用部分一并修正 |

---

## 9. 回滚

- 日常验证：`git revert` 实施分支上的 CI 提交，或把 `lucy-ci.yml` / `lucy-typecheck.yml` 删除并恢复 `lucy-release.yml` 的日常触发。
- `main`：PR #59 已合入（merge commit `731907f8`）。回退用反向提交（`git revert -m 1 731907f8`），**不**清空 Required checks，**不**关闭分支保护，**不**改 ruleset、secret、environment 或 runner。
- 失败证据与原因记录保留，不靠重跑成功覆盖先前异常。
- `lucy-v0.25` push 触发是临时入口（Spec §1.1 第 6 款）：该分支并入 `main` 或不再作为集成分支时，必须删除 `lucy-ci.yml` 与 `lucy-typecheck.yml` 里的 `lucy-v0.25` push 触发。本里程碑未把 `lucy-v0.25` 并入 `main`，因此触发仍在。
