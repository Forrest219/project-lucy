# 内容根与镜像漂移 Spec

| 元数据 | 内容 |
|---|---|
| Spec 编号 / 版本 | 180 / v0.2 |
| 日期 | 2026-10-18 |
| 状态 | 待实现 |
| 范围 | T5。只读说明编辑事实源和派生镜像，并报告漂移 |
| 治理 | [DEVELOPMENT](../../docs/governance/DEVELOPMENT.md)、[术语标准](00-product-terminology-standard.md) |
| 依据 | [串行计划](../../docs/plans/2026-10-18-mcp-audit-serial.md) 批次 3 |

## 1. 保持不变

- 内容根是编辑事实源。默认是 `<projectRoot>/config`，也可由 `LUCY_CONTENT_ROOT` 或 `ktx.yaml` 的 `paths.content_root` 决定。其下才是 `semantic-layer`、`wiki`、`evals`、`skills`。
- WebUI 和 MCP Proxy 的语义编译读取内容根下的 `semantic-layer`。
- `@kaelio/ktx` 仍读取 `ktx.yaml` 同级的 `semantic-layer`、`wiki`、`evals`、`skills`。该同级目录是派生镜像，不是编辑事实源。
- 同步方向只允许内容根到镜像。镜像里多出来的文件不得复制回内容根。
- 本 Spec 不删除镜像文件，不删除内容根文件，不把旧树合并进内容根。
- 漂移不把存活检查判死，也不放宽数据 ACL。
- 不改运行中的 Docker、配置卷或数据。

## 2. 布局诊断

新增只读函数，返回：

```ts
interface ContentLayoutStatus {
  contentRoot: string;
  contentRootSource: "env" | "yaml" | "default";
  authoring: {
    semanticLayer: string;
    wiki: string;
    evals: string;
    skills: string;
  };
  mirror: {
    semanticLayer: string;
    wiki: string;
    evals: string;
    skills: string;
  };
  mirrorActive: boolean;
  drift: Array<{
    dir: "semantic-layer" | "wiki" | "evals" | "skills";
    relPath: string;
    kind: "mirror_only" | "authoring_only";
  }>;
  driftTruncated: boolean;
}
```

`mirrorActive` 在内容根与项目根是同一目录时为 false，此时 `drift` 为空。内容根与项目根不同时，比较四个目录的相对文件路径。只在镜像中存在的文件为 `mirror_only`。只在内容根中存在的文件为 `authoring_only`。最多返回 200 条，超出则 `driftTruncated` 为 true。

`/api/health` 增加 `contentLayout`，带上上述字段。`status` 不因漂移变成失败。

## 3. 同步

`syncContentToProjectRoot` 仍是内容根到镜像的单向复制。一次同步后，内容根里没有的文件不得出现为新的内容根文件。同步结果在返回值中保留已有的 `copied`、`skipped`、`failed`。

## 4. 测试

- 镜像里有一份内容根没有的语义文件。同步之后，内容根仍然没有该文件，诊断里它是 `mirror_only`。
- 内容根有、镜像没有的文件，同步后镜像出现该文件，诊断不再把它标成 `authoring_only`。
- `LUCY_CONTENT_ROOT=.` 时 `mirrorActive` 为 false，且不把项目根文件报成漂移。
- 不断言、也不执行任何删除。

## 5. 发布工作台提示

`GET /api/diff` 附带 `mirrorOnlySemanticFiles`（`semantic-layer/` 下仅镜像存在的 `.yaml` 相对路径）和 `mirrorDriftTruncated`。诊断失败时这两个字段为空 / false，待同步文件列表仍返回。

`/publish/workbench` 在列表非空时显示：「镜像中仍有内容根已删除的语义文件，本次索引可能继续收录。」路径使用 `notranslate`。此提示不提供删除动作。

同步索引成功后，本批已经入账的待同步路径从进程内列表移除。同步失败时保留，便于重试。这不改变镜像，也不把镜像文件复制回内容根。
