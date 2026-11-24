# Lucy 构建修订标识

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 构建修订标识 |
| 文档类型 | Spec |
| 版本 / 日期 | v1.2 / 2026-10-21 |
| 状态 | 已批准并实现 |
| 关联 | `docs/governance/version-matrix.md` §1.1–§1.2 |

> 页面呈现以[版本信息身份块 Spec](lucy-20261030-version-info-identity-spec.md) 为准：`/admin/version` 的排版、构建提交的可见长度和工作区状态的位置由那份 Spec 规定。`GET /api/health`、构建戳记与侧栏页脚仍以本文为准。

## 1. 目标与非目标

**目标**

- 「系统设置 / 版本信息」和 `GET /api/health` 同时给出产品版本与这次构建对应的源提交。
- 提交标识在构建时写入，运行中的环境变量、Helm values、`LUCY_VERSION` 都不能改写它。
- 镜像构建拿不到合法提交时失败，不写出可运行的 `unknown` 镜像；运行时若戳记缺失/非法仍显示 `unknown`，不用产品版本冒充提交。
- 客户可见的常驻信息收敛为产品版本、构建提交、随包 KTX 版本。工作区脏状态不在客户可见页面展示；`gitDirty` 仍由 `GET /api/health` 返回供内部诊断。排版以[版本信息身份块 Spec](lucy-20261030-version-info-identity-spec.md) §4 为准。不向客户暴露构建时间。

**非目标**

- 不改变产品版本的递增规则。日常 `main` 提交仍然不升 `VERSION`。
- 不把 git 提交显示成新的产品名词。版本信息页可见文本是合法构建提交的前 12 位；完整提交标识在 `title` 与剪贴板。
- 不在侧栏页脚展示产品版本或提交号。依 Spec 188，登录后页脚只保留账户入口，「系统手册」收进展开菜单；开放模式或未登录时保留独立手册入口。
- 不把客户数据目录 `/data/lucy` 的 git 仓库当成 Lucy 源码提交。

## 2. 表面

| 表面 | 内容 |
|---|---|
| 侧栏页脚 | 登录后只显示账户入口，展开后提供「系统手册」和「退出登录」；开放模式或未登录时显示独立手册入口（Spec 188）。不展示产品版本，也不展示提交号 |
| `/admin/version` 产品版本 | `X.Y.Z`，来自 `data.lucyVersion`，不带 `v` 前缀。`data-testid="version-info-product"` |
| `/admin/version` 构建提交 | 可见前 12 位；`title` 与复制是完整 40 位小写十六进制，或非法值按[版本信息身份块 Spec](lucy-20261030-version-info-identity-spec.md) §5 原样 / `unknown`。合法提交可复制。`data-testid="version-info-sha"` |
| `/admin/version` 工作区 | 客户可见页面不再展示工作区状态。`gitDirty` 仍由 `GET /api/health` 返回，供内部诊断使用 |
| `/admin/version` 随包 KTX 版本 | `data.bundledKtxVersion`；空值显示 `unknown` |
| `GET /api/health` `data.gitSha` | 完整 40 位，或字符串 `unknown` |
| `GET /api/health` `data.gitDirty` | 布尔。`gitSha` 为 `unknown` 时为 `false`。戳记文件仍可用 `<sha>-dirty` 记录这一状态 |
| `data.lucyVersion` | 保持现有产品版本，语义不变 |

产品版本、构建提交、随包 KTX 版本带 `translate="no"` 与 `notranslate`。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- 版本信息：系统设置中的只读页面，常驻展示这次运行的产品版本、构建提交和随包 KTX 版本。它是页面名称，不是 git 提交的中文产品名词。

## Design System Compliance

版本信息页使用现有 `PageHeader`、`pl-page-stack` 和 `pl-btn--ghost`。身份块无卡片，不使用 `pl-card`。侧栏沿用「系统设置」分组，新增一项，不新增颜色，不改变 248px 侧栏宽度。页脚 `.pl-sidebar-help-link` 单行显示「系统手册」。

## 核心流程（伪代码）

```text
SHA = ^[0-9a-f]{40}$
STAMP = "/app/BUILD_REVISION"   # absolute, not configurable

function parseStamp(text):
  line = first line, trimmed
  if line == "unknown": return {gitSha:"unknown", gitDirty:false}
  dirty = line ends with "-dirty"
  sha = line without that suffix
  if sha matches SHA: return {gitSha:sha, gitDirty:dirty}
  return INVALID

function sourceGit(repoRoot):
  # repoRoot is the Lucy source tree that contains this repository's .git.
  # Do not walk upward. Do not use cwd. Do not use /data/lucy.
  if repoRoot/.git does not exist: return NONE
  sha = `git -C repoRoot rev-parse HEAD`
  if sha does not match SHA: return NONE
  dirty = `git -C repoRoot status --porcelain` is non-empty
  return {gitSha:sha, gitDirty:dirty}

function loadRuntime():
  # Must not read LUCY_GIT_SHA or any other environment variable.
  if STAMP exists:
    parsed = parseStamp(read STAMP)
    if parsed is INVALID: return {gitSha:"unknown", gitDirty:false}
    return parsed
  git = sourceGit(lucyRepoRoot)
  if git is not NONE: return git
  return {gitSha:"unknown", gitDirty:false}

function revisionFromBuildArg(sha, dirtyFlag):
  if sha does not match SHA: return {gitSha:"unknown", gitDirty:false}
  return {gitSha:sha, gitDirty: dirtyFlag == "1"}

image build:
  # .git is dockerignored, so the image cannot discover the commit itself.
  pass build-arg LUCY_GIT_SHA and LUCY_GIT_DIRTY
  if LUCY_GIT_SHA is empty or does not match SHA: fail the build
  write STAMP as "<sha>" or "<sha>-dirty"
  do not set ENV LUCY_GIT_SHA
  the WebUI bundle does not inline the commit
  # "unknown" remains a runtime display for a missing/invalid stamp file, not a
  # successful image-build outcome. Demo/customer/CI entrypoints must export the sha.

server process:
  resolve loadRuntime once and reuse it for /api/health
  版本信息 reads that response
  a later environment change does not replace the cached value
```

## 3. 验收

| ID | 断言 |
|---|---|
| SC-1 | 有 Lucy 源码 `.git`、且没有 `/app/BUILD_REVISION` 时，运行时标识等于 `git -C <lucy-root> rev-parse HEAD`，并反映 `git status --porcelain` |
| SC-2 | 设置 `LUCY_GIT_SHA` 不能改变 SC-1 的结果，也不能改变已存在的戳记文件 |
| SC-3 | 戳记文件内容非法时，结果是 `unknown`，不得改读 git 或环境变量 |
| SC-4 | 镜像内 `printenv LUCY_GIT_SHA` 为空；`/app/BUILD_REVISION` 与构建参数一致 |
| SC-5 | Helm chart 不注入 `LUCY_GIT_SHA` |
| SC-6 | 「版本信息」常驻展示 `lucyVersion`（不带 `v` 前缀）、构建提交、随包 KTX 版本。构建提交的可见文本与完整值位置按[版本信息身份块 Spec](lucy-20261030-version-info-identity-spec.md) 的 SC-03。客户可见页面不再展示工作区脏状态。侧栏页脚不展示产品版本或提交号 |
