# 编译失败的工具发现 Spec

| 元数据 | 内容 |
|---|---|
| Spec 编号 / 版本 | 178 / v0.1 |
| 日期 | 2026-10-18 |
| 状态 | **已实现**（串行计划批次 1；提交 `9331580` `feat(proxy): deny tools/list when role compile fails`）。验收用例 `webui/server/__tests__/spec-178-tools-list-compile-denial.test.ts` |
| 范围 | T1。承接 Spec 177 的诊断字段 |
| 治理 | [DEVELOPMENT](../../docs/governance/DEVELOPMENT.md)、[术语标准](00-product-terminology-standard.md) |
| 依据 | [串行计划](../../docs/plans/2026-10-18-mcp-audit-serial.md) 批次 1 |

## 1. 保持不变

- `initialize` 仍是协议握手，HTTP 200。握手成功不表示问数可用。
- `tools/call` 的拒绝正文保持现有 `Access denied: …` 形态。本 Spec 不把工具调用改成另一套信封。
- 角色声明不存在时，准入层现有的 HTTP 403 保持不变。
- 停用、吊销、过期 token 的现有拒绝保持不变。
- 任一角色编译失败，整身份拒绝。不跳过失败角色。
- 不修改启用表范围与普通 selector 的交集。那是 T7。
- 不改运行中的配置、容器或语义目录。
- 客户端响应不包含 `sourceMapConnectionIds`，也不包含 Spec 177 的诊断 JSON。

## 2. 编译失败的 tools/list

角色声明存在，但 `effectivePermissions` 失败，且原因属于下面之一时，`tools/list` 不得返回 `tools: []` 的成功结果：

- `role_resolution_failed` 及其后缀
- `source_map_compile_failed`
- `policy_degraded_deny`

响应：

- HTTP 403
- JSON-RPC `error.code` 为 `-32003`
- `error.message` 与准入层一致：原因以 `role_resolution_failed` 开头时，正文为 `Access denied: role_resolution_failed`；其他原因正文为 `Access denied:` 加上该原因字符串
- 信封里的 `id` 使用请求 id，作为关联标识

上游已经返回工具清单、上游不可用而走本地清单、过滤抛错，这三条路径都先做上述判断。编译失败优先于「过滤失败」和「空清单成功」。

## 3. 合法空清单

`effectivePermissions.ok === true` 且可见工具数为 0 时，`tools/list` 仍返回 HTTP 200 和 `tools: []`。

审计：`outcome=ok`，`decision_reason=allowed`。不得把这种情况记成编译失败。

## 4. 审计

编译失败的 `tools/list`：

- `outcome=denied`
- `decision_reason` 和 `error_detail` 使用完整机器原因，例如 `role_resolution_failed:chatbi-analyst`
- `compiler_reason` 使用 Spec 177 的 `formatIdentityCompilerReason`
- `role_ids` 保持空。已编译的前序角色不写入有效角色

## 5. 测试

至少覆盖：

- selector 零匹配：角色 YAML 存在，`tools/list` 为 403，响应体没有 `result.tools`，审计为 `denied`，`compiler_reason` 含 `selector_zero_match`
- 编译成功的身份：`tools/list` 仍为 200
- 编译成功但可见工具为空：`tools/list` 为 200 且 `tools` 为空，审计不是 `denied`
- 同一编译失败身份的 `initialize` 仍为 200
- 既有幽灵角色、停用身份的 403 用例仍然通过
