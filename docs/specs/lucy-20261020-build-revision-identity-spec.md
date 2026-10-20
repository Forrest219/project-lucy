# Lucy 构建修订标识

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 构建修订标识 |
| 文档类型 | Spec |
| 版本 / 日期 | v1.0 / 2026-10-20 |
| 状态 | 已批准并实现 |
| 关联 | `docs/governance/version-matrix.md` §1.1–§1.2 |

## 1. 目标与非目标

**目标**

- 侧栏和 `GET /api/health` 同时给出产品版本与这次构建对应的源提交。
- 提交标识在构建时写入，运行中的环境变量、Helm values、`LUCY_VERSION` 都不能改写它。
- 构建时拿不到合法提交时显示 `unknown`，不用产品版本冒充提交。

**非目标**

- 不改变产品版本的递增规则。日常 `main` 提交仍然不升 `VERSION`。
- 不把 git 提交显示成新的产品名词。界面直接显示短提交标识。
- 不把客户数据目录 `/data/lucy` 的 git 仓库当成 Lucy 源码提交。

## 2. 表面

| 表面 | 内容 |
|---|---|
| 侧栏产品标签 | 现有 `vX.Y.Z`，`data-testid="sidebar-version"` |
| 侧栏下一行 | 7 位小写十六进制；工作区不干净时追加 `-dirty`；否则 `unknown`。`data-testid="sidebar-revision"`。`title` 为完整 40 位，不干净时再加 ` dirty` |
| `GET /api/health` `data.gitSha` | 完整 40 位，或字符串 `unknown` |
| `GET /api/health` `data.gitDirty` | 布尔。`gitSha` 为 `unknown` 时为 `false` |
| `data.lucyVersion` | 保持现有产品版本，语义不变 |

侧栏两行都带 `translate="no"` 与 `notranslate`。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. The sidebar shows the existing product label plus the short git commit. It does not introduce a Chinese product noun for that commit. `unknown` means the build did not record a commit.

## Design System Compliance

引用现有侧栏页脚 `.pl-sidebar-utility` / `.pl-sidebar-version`（`webui/src/app/app.css`）。提交标识放在产品标签正下方、右对齐，沿用 muted `text-xs`。不新增颜色、按钮或导航项。

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

function loadClientBundle():
  if STAMP exists: return the same result as loadRuntime's stamp branch
  git = sourceGit(lucyRepoRoot)
  if git is not NONE: return git          # a real checkout ignores LUCY_GIT_SHA
  return revisionFromBuildArg(LUCY_GIT_SHA, LUCY_GIT_DIRTY)

function revisionFromBuildArg(sha, dirtyFlag):
  if sha does not match SHA: return {gitSha:"unknown", gitDirty:false}
  return {gitSha:sha, gitDirty: dirtyFlag == "1"}

image build:
  # .git is dockerignored, so the image cannot discover the commit itself.
  pass build-arg LUCY_GIT_SHA and LUCY_GIT_DIRTY
  if LUCY_GIT_SHA is non-empty and does not match SHA: fail the build
  write STAMP as "unknown", "<sha>", or "<sha>-dirty"
  do not set ENV LUCY_GIT_SHA
  then build the WebUI bundle, which reads STAMP via loadClientBundle

server process:
  resolve loadRuntime once and reuse it for /api/health
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
| SC-6 | 侧栏短标识是 `gitSha` 前 7 位；`gitDirty` 为真时加 `-dirty`；否则为 `unknown` |
