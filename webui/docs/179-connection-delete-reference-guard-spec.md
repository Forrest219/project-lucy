# 连接删除前的引用校验 Spec

| 元数据 | 内容 |
|---|---|
| Spec 编号 / 版本 | 179 / v0.2 |
| 日期 | 2026-10-18；2026-10-19 v0.2 |
| 状态 | 已实现 |
| 范围 | T3。删除连接前阻断悬空引用 |
| 治理 | [DEVELOPMENT](../../docs/governance/DEVELOPMENT.md)、[术语标准](00-product-terminology-standard.md) |
| 依据 | [串行计划](../../docs/plans/2026-10-18-mcp-audit-serial.md) 批次 2 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 确认删除前收集引用并在仍有引用时拒绝写入 |
| v0.2 | 预览直接说明挡住删除的引用；确认按钮在仍被挡住时不可用。语义文件单独说明 |

## 1. 保持不变

- 本 Spec 不实现「同时改写引用」。那是 T4。没有该流程时，存在引用就阻断确认删除。
- 不改运行中的 Docker、配置卷或数据。
- 不删除语义目录的现有内容，除非调用方本来就通过 `deleteAssets: true` 删除该连接自己的语义文件，且引用校验已经通过。
- 预览和错误里不输出密码或完整凭据。沿用现有 `redactKtxYamlForPreview`。
- 界面和错误文案用「连接」「角色」「用户」「业务 Wiki」「本地 YAML 资产」。启用表范围随连接一起卸载，不是这里的阻断项，也不要写成「白名单」。

## 2. 引用清单

确认删除前，针对连接 id 收集：

- 角色 `allow.connections` 中等于该 id 的角色
- 角色 `tableSelectors[].connection` 等于该 id 的角色，包括语义目录已经不存在的情况
- 使用上述角色的用户 id。响应里的 kind 仍是 `identity`
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

`blocked` 为 true 当且仅当 §5 的 active 非空。`blockers` 仍列出本地 YAML，即使本次 `deleteAssets: true` 使它们不再挡住删除。

`dryRun` 不是 true 时，只要 `blocked`，就拒绝写入。请求体里的确认字段不能跳过。不得修改 `ktx.yaml`，不得删除凭据或语义文件，不得写入 `write_status=committed` 的配置审计。

没有阻断项时，沿用现有删除结果。

错误使用稳定码 `connection_references_remain`，HTTP 409。响应包含 `blockers`。这是管理接口，可以列出角色 id 和用户 id。`error.message` 用与 §5 相同的中文结论，按本次请求的 `deleteAssets` 决定本地 YAML 资产是否还算挡住删除。界面不展示稳定码。

## 4. 界面

预览已经知道引用时，在确认连接 ID 之前写出结论，并停用「确认删除连接」。原因写在可见提示里，确认按钮用 `aria-describedby` 指向它。

仍挡住删除的类型按这个顺序说，同一类只说一次：角色、用户、业务 Wiki。本地 YAML 资产单独一句：可勾选「同时删除本地 YAML 资产」后一并删除。勾选之后，本地 YAML 资产不再挡住确认；角色、用户、业务 Wiki 仍然挡住。没有任何剩余引用时，不显示这句结论，确认按钮只受连接 ID 是否原样输入约束。

角色 id、用户 ID、业务 Wiki 路径和本地 YAML 路径列在结论附近。角色那一行指向角色权限，并说明这次删除不会改写 `access.yaml`。业务 Wiki 那一行说明这次删除不会改写业务 Wiki。

确认请求若仍返回 `connection_references_remain`，抽屉和 Toast 显示同一句中文结论，不显示稳定码，也不显示英文 “still has references”。

## 5. 核心流程（伪代码）

```text
blockers = 角色连接引用 + 角色表范围引用 + 使用这些角色的用户 + 业务 Wiki + 本地 YAML
active = blockers 去掉「本地 YAML 且本次 deleteAssets 为真」的项
若 active 为空：允许确认删除
否则：拒绝写入，并说明 active 里实际出现的类型
```

勾选「同时删除本地 YAML 资产」只从 active 里拿掉本地 YAML。不重新请求预览。

## 6. 测试

- 角色 selector 指向该连接，语义目录为空：确认删除不改 `ktx.yaml`，预览 `blocked`，blockers 含该角色。
- 只有 Wiki `sl_refs`：同样阻断。
- 有语义文件且 `deleteAssets` 不是 true：阻断。`deleteAssets: true` 且没有角色、身份、Wiki 引用：允许删除。
- 没有任何引用：确认删除仍成功。
- 阻断路径不产生 `connection_delete` 且 `write_status=committed` 的审计行。
- 预览含角色或业务 Wiki 时，输入正确连接 ID 后确认按钮仍不可用，提示说出实际类型，不出现稳定码。
- 只有本地 YAML 时，未勾选「同时删除本地 YAML 资产」则确认按钮不可用；勾选后可以确认。勾选不能跳过角色、用户或业务 Wiki。
- 确认被拒绝时，抽屉里的错误是中文结论，不出现 `connection_references_remain` 或 “still has references”。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

沿用：连接、角色、角色权限、用户、用户 ID、业务 Wiki、同时删除本地 YAML 资产。不把身份写成新的界面主词，用户 ID 用既有「用户」。不把这次阻断写成启用表范围或白名单。

## Design System Compliance

- 引用 `design-system/10-components-button.md`：确认按钮保持 `pl-btn--danger`；被引用挡住时 disabled，原因用可见提示加 `aria-describedby`。
- 引用 `design-system/13-components-toast.md`：结论放在删除抽屉里。确认请求仍失败时，Toast 只重复同一句中文结论。
- 复用 `pl-drawer-error`，不新增颜色或按钮样式。
