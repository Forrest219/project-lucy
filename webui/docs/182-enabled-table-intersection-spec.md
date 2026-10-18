# 启用表范围交集 Spec

| 元数据 | 内容 |
|---|---|
| Spec 编号 / 版本 | 182 / v0.1 |
| 日期 | 2026-10-18 |
| 状态 | 已实现 |
| 范围 | T7。每个角色的有效 source 与连接的启用表范围求交集 |
| 治理 | [DEVELOPMENT](../../docs/governance/DEVELOPMENT.md)、[术语标准](00-product-terminology-standard.md) |
| 依据 | [串行计划](../../docs/plans/2026-10-18-mcp-audit-serial.md) 批次 5，决定 D2 |

## 1. 保持不变

- 不修改运行中的 Docker、配置卷或数据。
- 不实现导入预览。那是 T6。
- 不改 `tools/list` 的拒绝信封。编译失败仍走 Spec 178。
- 不把 `row_access: scoped` 改成 `all`，也不给未启用的表补行级授权。
- `catalog_bound` 已经按启用表过滤。本 Spec 不放宽它。
- 术语用「启用表范围」。

## 2. 交集

启用表范围来自 `ktx.yaml` 里该连接的 `enabled_tables`。比较键与 `catalogBoundSources` 相同：连接 id 用 `normalizeRef`，表用 `normalizeRef(physicalTable)`，形如 `schema.table`。

以下都表示空集，不能退回该连接的全部 source：

- `enabled_tables` 缺省
- `enabled_tables` 为空数组
- source 的连接 id 在 `ktx.yaml` 里没有对应连接

普通 `tableSelectors` 在 `selectorMatches` 之后、零命中判断之前做这层过滤。只有过滤后仍保留的 source 进入有效权限和行级 grant。`catalog_bound` 继续使用现有过滤。两条路径用同一个成员判断，避免以后分开漂移。

## 3. 命中结果

- 八个 source 的 Manifest、启用表两张、selector 点名其中四张，且四张里只有两张在启用表范围内：编译成功，有效 source 只有这两张。另外两张记入该 selector 的 `unmatchedNames`，不进入有效 source。
- selector 点名的表在过滤后一张不剩：该 selector 为 `selector_zero_match`，角色编译失败。身份仍按现有失败关闭规则拒绝。
- 不在启用表范围内的 UID source 不得出现在有效 source 里。
- 没有 table selector 的纯元数据角色不因本规则改变。

## 4. 测试

使用临时目录或现有编译夹具，不读本机真实配置。

- 覆盖第 3 节的两表结果、过滤后零命中、以及空的启用表范围不会得到 Manifest 里的全部 source。
- `catalog_bound` 在启用表为空时仍然不是全表。
- `row_access: scoped` 的剩余 source 仍是 scoped。
- 旧夹具若用 `connections: {}` 却期望 selector 命中，把命中的物理表写进对应连接的 `enabled_tables`。不要为了让旧测试通过而跳过交集。
