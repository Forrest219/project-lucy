# Lucy Catalog 业务语义暴露 实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | v0.2-draft / 2026-11-07 |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。配套 Spec v0.2-draft。本阶段只评审与修订本 Plan，**暂不执行任何实现 Task** |
| 授权边界 | **不授权改代码**。须满足功能清单池 §2.2：R1 形态 → R2 对抗式评审 → R3 O1／O2／O3 闭合 → R4 委托人开发授权 |
| 验收 | Spec SC-01–SC-13 逐条有证据；`npm run lint:spec-docs` 退出 0；相关 vitest 全绿；越权描述不泄漏断言通过。**不构成发布取证，不表示可上线** |
| 目标分支 / 产品线 | `lucy-v0.30` / `0.30.0` |
| 需求来源 | 清单 P0-2；需求池 REQ-030-023 |
| Spec | [lucy-20261107-catalog-business-semantics-spec.md](../specs/lucy-20261107-catalog-business-semantics-spec.md) |
| 与既有 Spec 的关系 | 串联 REQ-030-027／P0-1（口径轴）、REQ-030-024／P0-3（表级门闩）；**不冲突** REQ-030-012／P0-A（列级裁剪）——本条**不返回任何列**；若日后要在 catalog 返回列预览，须先复用 012 的暴露集读取器，不得另起裁剪口径 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) 落盘清单与 Plan Mode |

## 1. 目标

把语义层**已存在**但从未被暴露的表级业务描述，装配进 MCP 目录响应，使 Agent 选表时不再只能靠表名字符串相似度猜测；同时守住「描述不泄漏不可见对象」与「目录体积有硬上限」两条纪律。

## 2. 开工前置

1. Spec v0.1 评审通过（或修订至可交付开发）。
2. **O1**（catalog 检索入参）、**O2**（synonyms 字段）、**O3**（长度上限与是否带 `grain`／`descriptions.ai`）由委托人裁定并回写 Spec。
3. 明确**开发授权**。
4. 术语标准补登记 Source Description／Source Grain／Description Coverage／Description Missing Marker（Spec Terminology 落位）。
5. 基线：`npm run lint:spec-docs` 绿（存量 WARN 除外）。
6. **客户现场 `_schema` 描述覆盖率基线**：在客户容器内统计 `descriptions.db` 非空比例，作为 S3 回退策略的输入（**不得假设与本仓 demo 口径一致**）。

## 3. 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `webui/server/proxy/source-descriptions.ts`（建议） | 新建 | manifest 描述装载 + 目录条目装配纯函数（可测、无 IO 副作用） |
| `webui/server/proxy/acl.ts` | 修改 | `lucyCatalog` 组装调用装配器；既有四字段与排序不变 |
| `webui/server/proxy/query-guardrails.ts` | 修改 | 复用既有 YAML 遍历器：其 `SourceYaml` 类型补 `descriptions`／`grain` 字段（当前该类型**无 description 字段**） |
| `webui/server/paths.ts` | 可能修改 | 若需按可见连接装载 `_schema` 的既有路径解析 |
| `webui/docs/00-product-terminology-standard.md` | 修改 | 新术语登记 |
| `webui/server/__tests__/catalog-business-semantics.test.ts` | 新建 | SC-01–SC-12 覆盖 |
| `webui/server/__tests__/kx-acl.test.ts` | 修改 | 保持既有「catalog 只暴露 ID」断言不回归（增字段后仍需断言不含其它域名字样） |

**不修改**：`webui/server/proxy/mcp-proxy.ts` 的 `initialize` Visible Scope（D8 首期不带描述）；ACL 裁决逻辑；KTX 源码；`live-tables.ts`（兜底源见 O3，本期不接线）。

## 4. 任务分解

### S0：决策闭合与夹具

- 回写 O1／O2／O3。
- 准备最小 `_schema` 夹具：有描述、无描述、空 `descriptions.db`、超长描述、不可见 source 有描述。
- **验证**：Spec 决策表无「开工前必答」空项；夹具覆盖上列五种。

### S1：描述装载（纯函数）

- 实现 manifest 描述索引装载：只读 `descriptions.db` 与 `grain`；装载失败返回空索引而非抛错。
- 实现 `assembleSourceEntry` / `assembleCatalogSources`：含缺失回退与配额截断。
- **验证**：SC-01、SC-03、SC-04、SC-05、SC-08、SC-10 单测红→绿。

### S2：目录响应接线

- `lucyCatalog` 改为调用装配器；**既有四字段、顺序、排序键不变**。
- 保留连接未就绪过滤与 `examples` 组装现状。
- **验证**：SC-02、SC-07、SC-09、SC-11、SC-12。

### S3：可见性纪律与回归

- 不可见 source 的名称与描述在响应全文均不出现（含 `descriptions.ai` 文本）。
- 复核 `kx-acl.test.ts` 既有形状断言不回归。
- **验证**：SC-06 ＋ 现有用例全绿。

### S4：门禁与形态

- `npm run lint:spec-docs` / `lint:terminology` / `lint:ia-boundary` / `lint:spec` 全绿。
- **验证**：SC-13。

## 5. 验收

验收条目即 Spec §7 的 SC-01–SC-13。阶段对应关系：

| 阶段 | SC |
|---|---|
| S1 | SC-01、SC-03、SC-04、SC-05、SC-08、SC-10 |
| S2 | SC-02、SC-07、SC-09、SC-11、SC-12 |
| S3 | SC-06 |
| S4 | SC-13 |

任一 SC 未执行，不得把本 Plan 标成已完成。测试文件变绿**不等于**客户现场语义层描述已覆盖——客户侧覆盖率是独立观测项（见开工前置第 6 条）。

## 6. 完成定义

同时满足才算完成：

1. SC-01–SC-13 均有记录在案的通过结果。
2. 目录响应形状契约测试通过：既有四字段与排序不变，新增字段按 D2 命名。
3. 可见性断言通过：不可见 source 的名称与描述均不出现在响应中。
4. 体积上限行为有测试覆盖（截断而非丢条目）。
5. 用户可见文案与术语标准新增行一致；`lint:terminology` 退出码 0。
6. `lint:spec-docs` 对本 Spec 与本 Plan 无形态违规。

## 7. 风险

| 风险 | 表现 | 处置 |
|---|---|---|
| 元数据侧信道 | 描述泄漏不可见对象 | 描述与 source 同生共死；SC-06 全文断言 |
| 目录体积膨胀 | 描述撑爆响应 | 只取 `descriptions.db`；总量硬上限；超限截断不丢条目 |
| 描述覆盖不均 | 客户侧可能大量 `missing` | 安全回退；覆盖率只观测；先取客户侧基线再定上限 |
| 与既有形状契约冲突 | `kx-acl.test.ts` 断言「catalog 只暴露 ID」 | 只**增**字段；SC-02 要求四字段与顺序不变 |
| 误把描述当权限 | Agent 用描述推断可见性 | 术语 Forbidden；SC-06 兜底 |
| 与 P0-1／P0-3 重复建设 | 三条都动「选表」 | 分工：P0-1＝命中后口径、P0-3＝多表命中门闩、本条＝选表前的信息供给 |

回滚：S2 先撤装配调用（回到既有 `lucyCatalog` 组装），S1 纯函数无调用方时可保留。不需要数据迁移回滚——本条不改任何已发布资产，只读 manifest。
