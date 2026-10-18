# 连接删除前的引用校验 Spec

| 元数据 | 内容 |
|---|---|
| Spec 编号 / 版本 | 179 / v0.1 |
| 日期 | 2026-10-18 |
| 状态 | 待实现 |
| 范围 | T3。删除连接前阻断悬空引用 |
| 治理 | [DEVELOPMENT](../../docs/governance/DEVELOPMENT.md)、[术语标准](00-product-terminology-standard.md) |
| 依据 | [串行计划](../../docs/plans/2026-10-18-mcp-audit-serial.md) 批次 2 |

## 1. 保持不变

- 本 Spec 不实现「同时改写引用」。那是 T4。没有该流程时，存在引用就阻断确认删除。
- 不改运行中的 Docker、配置卷或数据。
- 不删除语义目录的现有内容，除非调用方本来就通过 `deleteAssets: true` 删除该连接自己的语义文件，且引用校验已经通过。
- 预览和错误里不输出密码或完整凭据。沿用现有 `redactKtxYamlForPreview`。
- 界面和错误文案用「连接」「角色」「启用表范围」。启用表范围不要写成「白名单」。

## 2. 引用清单

确认删除前，针对连接 id 收集：

- 角色 `allow.connections` 中等于该 id 的角色
- 角色 `tableSelectors[].connection` 等于该 id 的角色，包括语义目录已经不存在的情况
- 使用上述角色的身份 id
- Wiki 页的 `sl_refs` 等于该 id，或以 `<id>/` 开头
- 内容根下 `semantic-layer/<id>/` 的 yaml 文件。`deleteAssets: true` 时这些文件不算阻断项，因为它们会和连接一起删除

不存在的语义文件仍要报告角色引用。不要因为文件已经缺失就当成没有引用。

## 3. 阻断

`dryRun: true` 仍返回预览，并增加：

```ts
blockers: Array<{
  kind: "role_connection" | "role_selector" | "identity" | "wiki" | "semantic_asset";
  id: string;
}>;
blocked: boolean;
```

`blocked` 为 true 当且仅当 `blockers` 非空。

`dryRun` 不是 true 时，只要 `blocked`，就拒绝写入。请求体里的确认字段不能跳过。不得修改 `ktx.yaml`，不得删除凭据或语义文件，不得写入 `write_status=committed` 的配置审计。

没有阻断项时，沿用现有删除结果。

错误使用稳定码 `connection_references_remain`，HTTP 409。响应包含 `blockers`。这是管理接口，可以列出角色 id 和身份 id。

## 4. 测试

- 角色 selector 指向该连接，语义目录为空：确认删除不改 `ktx.yaml`，预览 `blocked`，blockers 含该角色。
- 只有 Wiki `sl_refs`：同样阻断。
- 有语义文件且 `deleteAssets` 不是 true：阻断。`deleteAssets: true` 且没有角色、身份、Wiki 引用：允许删除。
- 没有任何引用：确认删除仍成功。
- 阻断路径不产生 `connection_delete` 且 `write_status=committed` 的审计行。
