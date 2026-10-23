# 角色编译失败诊断 Spec

| 元数据 | 内容 |
|---|---|
| Spec 编号 / 版本 | 177 / v0.1 |
| 日期 | 2026-10-18 |
| 状态 | 已实现 v0.1。字段锁定，不授权改授权边界 |
| 范围 | T2、T8。不含 T1（`tools/list` 仍可对编译失败返回空清单）、不含 T7（普通 selector 暂不与启用表范围求交集）、不含配置恢复 |
| 治理 | [DEVELOPMENT](../../docs/governance/DEVELOPMENT.md)、[术语标准](00-product-terminology-standard.md) |
| 依据 | 知识库 `00_Inbox/2026-10-18 - lucy MCP 数据面审计/最终审阅结论.md` 与 `lucy-优化任务清单.md` |

## 1. 保持不变的行为

- 任一角色 `compileRole` 失败，整身份拒绝。不得跳过失败角色继续授权。
- `names` 仍是匹配集合。Manifest 里只命中其中一部分时，角色编译成功，只授予命中的 source。未命中的 name 记入诊断，不因此失败。
- 只有整个 selector 匹配数为 0 时，该角色失败，原因码 `selector_zero_match`。
- 对外 MCP 错误正文保持 `Access denied: role_resolution_failed` 或既有 `role_resolution_failed:<roleId>`。不把 source map 里的连接清单放进客户端响应。
- 本 Spec 不把 `tools/list` 改成 403。该行为由 Spec 178 规定。
- 不修改 `enabled_tables` 与普通 selector 的交集规则。

## 2. 结构化诊断

机器字段用英文码。管理界面文案用术语标准：连接、角色、Schema Manifest、启用表范围。启用表范围不要写成「白名单」。

```ts
type RoleCompileStatus = "compiled" | "failed" | "not_run";

interface RoleCompileStep {
  roleId: string;
  ordinal: number;
  status: RoleCompileStatus;
  code?: string;
  stage?: "selector_match" | "role_declaration" | "tool_classification" | "source_scope" | "row_grant" | "other";
  selectorIndex?: number;
  connectionId?: string;
  schema?: string;
  names?: string[];
  matchCount?: number;
  unmatchedNames?: string[];
}

interface IdentityCompileDiagnostic {
  declaredRoleIds: string[];
  steps: RoleCompileStep[];
  failedRoleId?: string;
  contentRoot: string;
  contentRootSource: string;
  sourceMapVersion: string;
  sourceMapConnectionIds?: string[];
}
```

`sourceMapConnectionIds` 只出现在管理员接口。审计库可以保存它，普通 MCP 响应不可以。

失败角色之前的步骤为 `compiled`，失败角色为 `failed`，其后为 `not_run`。`compiled` 只表示该角色编译函数返回成功，不表示整身份已获授权。

`policy-runtime` 的每个降级身份带这份诊断。`issues[].reason` 继续保留现有机器原因字符串，并增加可选 `diagnostic`。

## 3. 审计

沿用 `access_log.compiler_reason` 存管理员诊断 JSON。`decision_reason` 继续放对外裁决字符串，例如 `role_resolution_failed:chatbi-analyst`。

不要为了避免 `role_ids` 空白而填入已编译角色。整身份拒绝时 `role_ids` 保持空。分角色状态只放在 `compiler_reason`。

## 4. 测试

至少一条双角色用例：前者编译成功、后者 selector 零匹配、整身份拒绝、诊断步骤为 compiled / failed / 无 not_run 或有 not_run（当后面还有角色）。另一条：四 name 只命中两张表时编译成功，`unmatchedNames` 有未命中项，授予 source 数为 2。
