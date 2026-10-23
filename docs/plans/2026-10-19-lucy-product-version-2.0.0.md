# Lucy 产品版本落地为 2.0.0

| 元数据 | 内容 |
|---|---|
| 状态 | 仓库版本已落地，运行中容器未重建 |
| 批准 | 2026-10-19。授权「系统版本升为 v2.0」之后，批准落地值使用 `v2.0.0` |
| 仓库事实源 | `2.0.0` |
| 界面标签 | `v2.0.0` |
| 本次不做 | 提交、构建镜像、重建运行中的 Docker、改 KTX、改 Helm Chart 包版本、做 Lucy 2.5 功能 |

本文件是后续执行时的唯一清单。执行前先读第 4 节和第 5 节；验证只跑第 6 节列出的命令。

## 1. 批准口径

产品版本是不带 `v` 的三段数字。批准值是 `2.0.0`。侧栏把同一字符串格式化成 `v2.0.0`。`v2.0`、`2.0`、`2.0.0-beta` 不能写入 `VERSION`。

| 表面 | 落地值 |
|---|---|
| `VERSION`、npm、`LUCY_VERSION`、Helm `appVersion`、`/api/health` 的 `lucyVersion`、审计导出 `manifest.appVersion` | `2.0.0` |
| WebUI 侧栏 `sidebar-version` | `v2.0.0` |
| 以后客户镜像 tag 的产品段 | `customer-amd64-2.0.0-YYYYMMDD-<gitSha>` |

这次是明示批准的主版本切线：`0.17.0` → `2.0.0`。它不是 version-matrix 里的「第二段 +1」或「第二段 +10」。`2.0.0` 只更换产品线名称，不表示权限模型、配置或 KTX 有破坏性变更。

切线之后，列车规则改写到 `2` 这条线上：

| 触发 | 递增 |
|---|---|
| 下一次客户交付包 | 第二段 +1：`2.0.0` → `2.1.0` |
| 大能力、破坏性配置或捆绑 KTX 主版本变化 | 第二段 +10：`2.0.0` → `2.10.0` |
| 补丁段 | 保持 `0`，直到矩阵另定 hotfix 规则 |
| 再进主版本 | 需要新的明示批准，目标形如 `3.0.0` |

## 2. 保持不动的版本

| 名称 | 保持值 | 原因 |
|---|---|---|
| Git 分支 `lucy-v2.0` | 分支名 | 不是产品版本 |
| Helm Chart `version` | `0.2.4` | 图表包版本，与 `appVersion` 分开 |
| 捆绑 KTX | `0.16.0` | 本次不升级运行时 |
| `webui/package.json` 的 `version` | `1.0.0` | npm 包版本，客户不看 |
| `scripts/gates/p1-release-readiness.mjs` 的 `version` | `2.0.0` | 证据契约 `lucy-p1-release-readiness-v2`，碰巧同号，不是产品版本 |
| [Lucy 2.5 升级建议](2026-10-18-lucy-2.5-upgrade-proposal.md) 与 [升级 E2E 方案](2026-10-19-upgrade-e2e-implementation-plan.md) | 原文件 | 功能备忘，不是这次切版 |

## 3. 落地范围

### 3.1 门禁投影

`scripts/release/lucy-version-governance.mjs` 要求这些值与 `VERSION` 完全一致。

| 文件 | 字段 |
|---|---|
| `VERSION` | 全文。第一个改，并与本表其余行同一次改完 |
| `package.json` | `version` |
| `package-lock.json` | 根 `version`，以及 `packages[""].version` |
| `Dockerfile` | `ARG LUCY_VERSION` |
| `docker-compose.yml` | build arg 与运行时 `LUCY_VERSION` 两处默认值 |
| `deploy/k8s/helm/lucy/Chart.yaml` | `appVersion`。Chart `version` 保持 `0.2.4`。既有 annotation「appVersion 0.17.0」保留；追加一条「产品版本切到 2.0.0」 |
| `deploy/k8s/helm/lucy/values.yaml` | `image.tag`、`lucy.version`。tag 注释中的客户 tag 示例改为 `customer-amd64-2.0.0-YYYYMMDD-<sha>` |
| `webui/vite.config.ts` | 读不到 `VERSION` 时的返回值 |
| `webui/server/lucy-version.ts` | `FALLBACK` |
| `webui/src/lib/lucyVersion.ts` | `FALLBACK`；注释示例改为 `v2.0.0` |

Helm 还会拒绝 `lucy.version` 与 `Chart.appVersion` 不一致。这些文件一起改为 `2.0.0`：

| 文件 | 字段 |
|---|---|
| `deploy/k8s/helm/lucy/examples/values.local-test.yaml` | `image.tag`、`lucy.version` |
| `deploy/k8s/helm/lucy/examples/values.k3s-test.yaml` | `lucy.version` |
| `deploy/k8s/helm/lucy/examples/values.customer.example.yaml` | `image.tag` 示例、`lucy.version` |
| `deploy/k8s/gate/values.gate-fresh.yaml` | `image.tag`、`lucy.version` |
| `scripts/gates/helm-lucy-gate.sh` | `assert_env_value` 的 `LUCY_VERSION`。`LUCY_BUNDLED_KTX_VERSION` 继续断言 `0.16.0` |

### 3.2 读取当前产品版本的测试

| 文件 | 改什么 |
|---|---|
| `scripts/release/lucy-version-governance.test.mjs` | 构建脚本失败信息里的 `customer-amd64-0.17.0` 与 `VERSION=0.17.0`。同文件用 `0.17.0` 检验「合法三段版本」的用例保留 |
| `webui/src/__tests__/app-shell.test.tsx` | 两处侧栏期望：`renders a global help button`、`does not break the 系统手册 footer entry after the sidebar rewrite`，由 `v0.17.0` 改为 `v2.0.0` |
| `webui/server/__tests__/admin-audit.test.ts` | `Spec 137 audit evidence pack` / `exports normalized filters...` 里的 `manifest.appVersion` |

`webui/src/lib/lucyVersion.test.ts` 与 `webui/server/__tests__/lucy-version.test.ts` 用 `0.17.0` / `0.18.0` 做格式样例，保留。

### 3.3 当前基线文档

| 文件 | 改什么 |
|---|---|
| `docs/governance/version-matrix.md` | 当前基线、包名、发布元数据模板、§1.1 的递增例子。写明 2026-10-19 这次是批准切线 |
| `deploy/k8s/K8S_CONTRACT.md` | 保留 Chart `0.2.2`–`0.2.4` 对应产品 `0.17.0` 的历史行。当前行改为 Chart `0.2.4`、产品 `2.0.0`、KTX `0.16.0`。新包推荐 tag 的产品段改为 `2.0.0`。正文里的 `LUCY_VERSION` 基线改为 `2.0.0` |
| `deploy/k8s/helm/lucy/README.md` | 产品版本一句 |
| `deploy/k8s/helm/lucy/UPGRADE.md` | 开头 Current chart 中的 Lucy 版本。Chart 号仍写 `0.2.4` |
| `CHANGELOG.md` | 新增 `## 2.0.0`，只记录产品线从 `0.17.0` 切到 `2.0.0`。既有 `## 0.17.0` 与 Unreleased/M31 保留 |
| `docs/runbooks/customer-k8s-test-package-principles.md` | 2026-10-09 的基线句是历史快照，保留。追加一句：此后以 `VERSION` 为准，当前为 `2.0.0` |
| `docs/runbooks/customer-v2-k8s-first-admin-delivery-flow.md` | 保留「版本来自 `VERSION`」。追加一句：自本批准起，`VERSION` 为 `2.0.0` |

### 3.4 保留的 `0.17.0`

这些是已经发生的构建、审计或语法样例：

- 带 `20260902-b262798` 的镜像 tag 与 tar 路径。出现在客户镜像 runbook、离线交付 spec、部署 quickstart、preflight checklist、`scripts/gates/build-k8s-delivery-package.sh` 的用法注释。
- `CHANGELOG.md` 里 `## 0.17.0` 的正文。
- 审计快照、UAT 计划、已关闭 WO、2.5 建议书里对当时界面的描述。
- 不读取 `VERSION` 的测试夹具：`scripts/e2e/__tests__/*` 的 `chartVersion` / `lucyVersion`、`scripts/gates/customer-release-readiness.test.mjs`、`scripts/gates/k8s-gate-negative.test.mjs`、`scripts/gates/customer-release-workflow.test.mjs`、`scripts/release/release-artifacts.test.mjs`。
- 代码注释里的「v2.0 只做本地密码」：那是发布列车范围，不是版本常量。

## 4. 落地顺序

工作区已有与本次无关的未提交改动。只改第 3 节列出的文件。不提交，除非另有提交指示。不构建镜像。

1. 改完 3.1 和 3.2，再跑验证 V1–V4。投影改到一半时 `lint:version` 会失败，那是中间状态，不在半截时把失败当成验收结果。
2. 改完 3.3，再跑 V5、V6。
3. 按第 7 节填写验证记录。任一门失败就停，修完该门再继续，不跳到镜像构建。

## 5. 验证边界

本次验证证明仓库事实源、Helm 渲染和单元测试里的产品版本是 `2.0.0`，并且 KTX 与 Chart 包版本没有被带改。

本次验证不证明运行中的容器已经显示 `v2.0.0`。已运行容器仍显示构建时写入的 `v0.17.0`，直到下一次按新 `VERSION` 构建。那次构建、`npm run demo:upgrade`、客户 amd64 出包和浏览器点击，都不在本方案里。

## 6. 验证机制

六扇门按顺序执行。前一扇未通过，不解释后一扇的结果。

| 门 | 证明什么 | 通过标准 |
|---|---|---|
| V1 | 全部提交投影与 `VERSION` 一致 | 退出码 0，输出含 `OK VERSION=2.0.0` |
| V2 | 版本规则与「错误 tag / 错误环境变量会被拒绝」仍有效 | `lint:version:test` 退出码 0 |
| V3 | 侧栏标签与审计 manifest 读到新版本；格式样例仍绿 | 下列 vitest 退出码 0 |
| V4 | Helm 渲染注入 `LUCY_VERSION=2.0.0`，KTX 仍为 `0.16.0` | `gate:k8s-static` 退出码 0 |
| V5 | 活文档的当前基线已改，历史样本还在 | 检索结果能按 6.5 的两类分完，没有第三类 |
| V6 | 非产品版本没有被误改 | 6.6 的四条命令输出与「保持值」一致 |

### 6.1 V1 投影门

```bash
npm run lint:version
```

通过：标准输出含 `[lucy-version] OK VERSION=2.0.0`。失败：先看缺的是 3.1 哪一行，补齐后再跑。不通过修改治理脚本放行。

### 6.2 V2 规则门

```bash
npm run lint:version:test
```

通过：Node 测试全部 pass。这一门同时覆盖「`customer-amd64-2.0.0-...` 才是合法客户 tag」和「与 `VERSION` 不一致的 `LUCY_VERSION` 在 Docker 构建前失败」。

### 6.3 V3 表面门

在 `webui/` 下直接调用 vitest，跳过 `pretest` 的术语检查。术语检查与版本字符串无关。

```bash
cd webui
npx vitest run --maxWorkers=1 \
  src/lib/lucyVersion.test.ts \
  server/__tests__/lucy-version.test.ts \
  src/__tests__/app-shell.test.tsx \
  server/__tests__/admin-audit.test.ts \
  -t "renders a global help button|does not break the 系统手册 footer entry after the sidebar rewrite|exports normalized filters, completeness evidence"
```

通过：上述四文件里被 `-t` 选中的用例，加上两个 lucy-version 文件的全部用例，都 pass。`app-shell` 与 `admin-audit` 里名称不匹配的用例不会运行，这是本方案的范围。

### 6.4 V4 Helm 门

仓库根目录：

```bash
npm run gate:k8s-static
```

通过：脚本退出码 0。它会渲染 local-test 与 k3s-test，并检查 `LUCY_VERSION` 为 `2.0.0`、`LUCY_BUNDLED_KTX_VERSION` 为 `0.16.0`。本机没有 Helm 时，这一门记为「未执行」，不能记为通过。

### 6.5 V5 残留分类

```bash
rg -n "0\\.17\\.0" --glob '!package-lock.json' --glob '!**/pnpm-lock.yaml' --glob '!webui/package-lock.json'
```

每条命中只能属于下面一类：

| 类 | 允许留下的样子 |
|---|---|
| 历史样本 | 路径或相邻文本含 `20260902`、`b262798`、`CHANGELOG` 的 `## 0.17.0`、审计/UAT/已关闭 WO、2.5 建议里的当时界面，或 3.4 列出的测试夹具 |
| 格式样例 | `lucy-version-governance.test.mjs`、`lucyVersion.test.ts`、`lucy-version.test.ts` 里用来证明「这是一个合法版本」的 `0.17.0` |

当前基线句、`VERSION`、Helm 当前值、侧栏期望、审计 `appVersion` 期望若仍是 `0.17.0`，验证失败。

另搜一次，确认没有人把产品版本写成两段：

```bash
rg -n "^(v?2\\.0)$" VERSION package.json deploy/k8s/helm/lucy/Chart.yaml deploy/k8s/helm/lucy/values.yaml
```

通过：无命中。`VERSION` 文件内容是 `2.0.0`。

### 6.6 V6 保持值

```bash
awk '/^version:/{print; exit}' deploy/k8s/helm/lucy/Chart.yaml
rg -n "KTX_VERSION=|bundledKtxVersion:" Dockerfile deploy/k8s/helm/lucy/values.yaml | head
node -p "require('./webui/package.json').version"
rg -n "contract: \"lucy-p1-release-readiness-v2\"" -A 2 scripts/gates/p1-release-readiness.mjs
```

通过：Chart `version: 0.2.4`；KTX 仍为 `0.16.0`；webui 包为 `1.0.0`；证据契约版本仍是旁边的 `2.0.0` 且契约名未改。

## 7. 验证记录

执行时把结果写在本节下面，每个门一行。未跑的门写「未执行」和原因。

| 门 | 结果 | 证据 |
|---|---|---|
| V1 | 通过 | 退出码 0，`[lucy-version] OK VERSION=2.0.0` |
| V2 | 通过 | `lint:version:test`：6 pass，0 fail |
| V3 | 通过 | 过滤后的侧栏 2 条与审计 manifest 1 条 pass。版本格式样例另跑 `lucyVersion.test.ts` 与 `server/__tests__/lucy-version.test.ts`：6 pass |
| V4 | 通过 | `gate:k8s-static` 退出码 0，输出 `[helm-lucy-gate] OK` |
| V5 | 通过 | 残留 `0.17.0` 都落在历史样本、格式样例，或与 3.4 同类、不读取 `VERSION` 的测试夹具。`VERSION` 为 `2.0.0`。两段式 `v2.0` / `2.0` 无命中 |
| V6 | 通过 | Chart `version: 0.2.4`，`appVersion: "2.0.0"`，KTX `0.16.0`，webui 包 `1.0.0`，证据契约仍为 `lucy-p1-release-readiness-v2` / `2.0.0` |

六扇门都通过之后，本文件状态改为「仓库版本已落地，运行中容器未重建」。那句话成立之前，不把运行中的系统称为 v2.0.0。
