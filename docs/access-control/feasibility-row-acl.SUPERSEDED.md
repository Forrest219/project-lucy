# Lucy Agent 行级权限（Row ACL）可行性方案

> ## SUPERSEDED（已废止作为实施依据）
>
> | 元数据 | 内容 |
> |---|---|
> | 状态 | **SUPERSEDED** |
> | 生效主设计 | [`design-upgrade.md`](design-upgrade.md) **v1.1.2+** |
> | 废止日期 | 2026-08-08 |
>
> **禁止**依据本文拆 WO / 写 Spec / 改 runtime。下列正文仅作历史讨论留存；与主设计冲突时（含但不限于）：
>
> - Role 间行策略 AND / 「更严优先」合成
> - `mandatory_segments` 作为安全谓词
> - 缺省无 `row_policy` 即全表
> - tools 与 sources **独立并集**（笛卡尔放大）
> - 「编译失败沿用 last-known-good 更宽权限」
> - 用「是否修改过」推断 legacy/v2
>
> **一律以主设计 ADR-AC-01…06 为准。**

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Agent 行级权限可行性方案 |
| 文档类型 | Design（历史附录） |
| 版本 | v1.0（SUPERSEDED） |
| 撰写日期 | 2026-08-08 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | `docs/access-governance-design.md` §3.2/§6.1、`docs/design-agent-permissions.md`、`webui/docs/07-mcp-auth-proxy-spec.md`、`webui/server/proxy/{acl,mcp-proxy}.ts`、`webui/config/access.yaml`（含 `superstore_region_huadong` VIEW 变通）、`docs/lucy-202608-reliable-delivery-upgrade-spec.md`（Dynamic RLS 已移出 202608） |
| 适用范围 | **仅历史参考**；实施与审批以 `design-upgrade.md` 为准 |
| 输出位置 | `docs/access-control/feasibility-row-acl.SUPERSEDED.md` |

---

## 0. 结论摘要（TL;DR）

> **2026-08-08：** 本文整体 SUPERSEDED。访问权限升级请读主设计 v1.1.1（capability tuple、`permission_model_version`、收窄失败语义）。下列「Phase 1 + mandatory segments」等表述 **已废止**。

~~可行，且应分阶段做；下一阶段不要做「动态多租户 RLS」。~~ → 见主设计。

| 判断 | 说明 | 主设计校正 |
|---|---|---|
| 现状 | 表级 ACL；segments/filters 非安全边界 | 仍成立 |
| VIEW 变通 | 可用 | 仍成立（S11） |
| ~~推荐 Phase 1：注入 filters / mandatory segments~~ | ~~…~~ | **废止**；P1 仅 structured policy；无 Segment 安全语义 |
| 工程约束 | Proxy 裁决；fail-closed | 见 ADR-AC-02/06（收窄不得保留更宽旧权） |

---

## 1. 问题定义

### 1.1 用户痛点

同一物理表需要按业务切片授权，例如：

- 区域经理只能看 `region = '华东'` 的订单；
- 事业部 Agent 只能看 `bu_code IN (...)` 的财务事实；
- 同一语义源对不同 Role 暴露不同行集合，而不想为每个切片复制一套 VIEW + overlay + role。

### 1.2 与「表级 ACL」的差距

| 能力 | 表级 ACL（现状） | 行级需求 |
|---|---|---|
| 授权单元 | connection + source/table | 表内行谓词 |
| 裁决时机 | `tools/call` 前，从 args 抽表名 | 查询编译/转发前，**强制**谓词进入上游 |
| Agent 可绕过？ | 不能碰未授权表 | 若只靠「提示 Agent 加 filter」→ **可绕过** |
| 全表扫描 / 聚合 | 授权即全表可读 | 必须保证聚合也只在授权行上计算 |

### 1.3 非目标（本方案边界）

与 `vision.md` / 202608 决策一致地收窄：

1. **不做 Dynamic Multi-tenant RLS**：Lucy 当前无多租户产品形态；不引入 per-request tenant claim 驱动的隔离。
2. **不做结果集后过滤**：对 `SUM/COUNT` 无效且易漏；禁止作为安全方案。
3. **不做「仅文档约束」**：Visible Scope / instructions 注入不是安全边界。
4. **本阶段不做完整 CLS（列级）**：可与 Row Policy 共用 selector 扩展点，但单独验收、单独发版。
5. **不把 KTX upstream 变成第二 ACL**：绕过 Proxy 直连 KTX 仍禁止。

---

## 2. 现状基线（与改动面）

```text
Bearer token → identity.ts → Identity
                         ↓
tools/call → acl.check（tool / connection / 表白名单）
                         ↓ allow
         mcp-proxy 改写 lucy_query → sl_query → KTX
                         ↓
              （无行谓词注入）
```

| 组件 | 路径 | 与 Row ACL 的关系 |
|---|---|---|
| 事实源 | `webui/config/access.yaml` | 扩展 selector / role 字段的唯一落点 |
| 裁决 | `webui/server/proxy/acl.ts` | 解析 Row Policy → EffectivePermissions |
| 注入点 | `webui/server/proxy/mcp-proxy.ts` | `lucyQueryUpstreamArgs` 前后 AND 强制谓词 |
| 审计 | `proxy/audit.ts` + snapshots | snapshot 需纳入 row policy 版本 |
| 语义便利 | overlay `segments` / query `filters` | **可复用表达**，不可单独当 ACL |
| 变通 | VIEW + 独立 source | Phase 0 继续可用 |

`access-governance-design.md` §3.2 已留 `row_filter` 锚点，但原文「缺字段 → 表级全 deny」与**存量兼容**冲突；本方案在 §4.3 修正为更可落地的退化语义。

---

## 3. 需求分层（决定方案选型）

| 层级 | 场景 | 谓词是否随 Agent 变 | 是否需要「运行时 claim」 |
|---|---|---|---|
| **L0 静态切片** | 华东经理固定只看华东 | 否（绑 Role） | 否 |
| **L1 属性绑定** | Role 模板相同，Agent 带 `attrs.region=华东` | 是（绑 Agent/Role 属性） | 否（配置期写死，非请求头） |
| **L2 动态声明** | Token/会话携带 tenant_id，每请求不同 | 是 | 是（多租户） |

**产品建议**：下一阶段交付 **L0，可选试点 L1**；**L2 冻结**，直到多租户 / SSO 进入产品范围。

---

## 4. 方案对比

### 4.1 选项一览

| 方案 | 做法 | 安全强度 | 运维成本 | 推荐 |
|---|---|---|---|---|
| **A. VIEW-as-pseudo-table** | 物理 VIEW + 独立 semantic source + tableSelector | 高（DB 侧裁剪） | 每切片一套 VIEW/overlay/role | **保留为 L0 兜底 / 演示** |
| **B. Proxy 强制谓词（Static Row Policy）** | Role selector 声明 `row_policy`；Proxy 注入 filters/segments | 高（若覆盖所有读路径） | 中（配置 + 语义字段对齐） | **下一阶段主方案** |
| **C. Agent 属性模板（L1）** | `row_policy` 含 `${attrs.region}`，解析时替换 | 高（配置期绑定） | 中高（属性治理） | **Phase 1.5 试点** |
| **D. 结果后过滤** | 查全量再裁行 | **低（聚合泄漏）** | 低 | **否决** |
| **E. DB 原生 RLS** | MySQL/StarRocks session 变量 + 策略 | 视引擎而定 | 高（多连接池、会话身份） | **长期可选加固，不作 Lucy 主闸** |
| **F. 仅 mandatory segment 文档约定** | 要求 Agent 必选 segment | **无** | 低 | **否决** |

### 4.2 推荐架构（B，可选 C）

> **SUPERSEDED：** 下列「filters / mandatory_segments 注入」与「sources Map」模型已废止。现行模型见主设计 **ADR-AC-03 capability tuple**、**ADR-AC-05（无 Segment 安全语义）**。

```text
~~access.yaml row_policy: filters | mandatory_segments~~  → 见主设计 structured policy（P1）
~~tools ∪ × sources ∪~~ → EffectiveDataCapabilities = ∪(tool × source × rowGrant)
```

<details>
<summary>历史原文（勿实施）</summary>

```text
access.yaml
  roles.<id>.allow.tableSelectors[]
    + row_policy: { mode, filters? | mandatory_segments? }

acl.resolveEffectivePermissions
  → sources[] + rowPoliciesBySource: Map<sourceKey, ResolvedRowPolicy>

mcp-proxy tools/call (lucy_query / lucy_explain_query)
  1. acl.check（表级，不变）
  2. applyRowPolicy(args, effective.rowPolicies)  // AND 注入；失败 → deny
  3. rewrite → sl_query

lucy_read_source
  若 source 存在 row_policy → deny（row_policy_requires_query）
  或仅允许「无 row_policy 的 source」（推荐先做 deny）
```

</details>
**为何强制谓词放在 Proxy，而不是 KTX：**（方向仍成立；实现细节见主设计 `authorizeAndRewrite`。）

**为何优先 structured filter，而不是自由 SQL：**（方向仍成立。）~~`mandatory_segments` 复用 overlay~~ → **已废止**（主设计 ADR-AC-05）。

### 4.3 配置草案（Phase 1）

> **SUPERSEDED：** `mandatory_segments` 不得作为安全谓词。P1 仅 `access.yaml` structured policy，初始 op 仅 `eq`/`in`。下列 YAML 为历史示例。

<details>
<summary>历史 YAML 示例（勿实施）</summary>

```yaml
roles:
  superstore_region_huadong_v2:
    description: 华东区域经理 — 行级强制过滤（示例）
    allow:
      connections: [mysql-aliyun]
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names: [superstore_orders]
          row_policy:
            # 二选一或同时使用（同时使用时 AND）
            mandatory_segments:
              - superstore_orders.region_huadong   # 须存在于 overlay.segments
            filters:
              - field: superstore_orders.region
                op: eq
                value: 华东
      tools:
        - lucy_catalog
        - lucy_query
        - lucy_explain_query
        # 注意：含 row_policy 时建议不要授权 lucy_read_source，或由 runtime 拒绝
        - wiki_search
        - wiki_read
```

</details>

**退化 / 兼容语义** → 见主设计 ADR-AC-04（`permission_model_version`），勿再使用「缺省全表」作为新配置语义。

<!-- 原 4.3 其余段落仍可能出现在下文；一律以主设计为准 -->

### 4.4 L1 属性绑定（可选试点）

```yaml
users:
  - id: demo_huadong_manager
    role: superstore_region_manager   # 共享模板 role
    attrs:
      region: 华东

roles:
  superstore_region_manager:
    allow:
      tableSelectors:
        - ...
          row_policy:
            filters:
              - field: superstore_orders.region
                op: eq
                value: "${attrs.region}"   # 仅允许 attrs.* 占位；禁止任意表达式
```

约束：

- `attrs` 只允许标量 string/number/string[]；写入走 admin dryRun + schema whitelist；
- 占位符未解析 → fail-closed；
- **不**从 HTTP header / JWT 动态取 claim（那是 L2）。

---

## 5. 强制执行细节（可行性关键）

### 5.1 `lucy_query` 注入算法

1. 从 args 提取涉及的 `sourceName` 集合（复用现有 `extractTables` / source-qualified keys）。
2. 对每个带 `row_policy` 的 source：
   - 将 `mandatory_segments` **追加**到 `args.segments`（去重）；
   - 将 `filters` **追加**到 `args.filters`（规范化后与 Agent filters 并列；语义为 AND）。
3. 禁止 Agent 通过「同名字段 OR 恒真」绕过：强制谓词由 Proxy 注入，**不提供**「覆盖 / 删除 policy filter」API；若上游语义层对 filters 是 OR 语义，必须在实现前用 eval 验证——**以 KTX/sl_query 实际 AND 语义为准**，若非 AND 则改走 mandatory segment（segment 通常编译为 AND）。
4. 注入失败或 policy 引用非法字段 → `Access denied: row_policy_unresolved:...`，不转发。

### 5.2 `lucy_read_source`（必须处理）

全源读取会绕过 query filters。Phase 1 推荐：

| 策略 | 说明 |
|---|---|
| **R1（推荐默认）** | 若 effective 对该 source 存在 `row_policy` → deny：`row_policy_requires_query` |
| R2 | 全局：凡 role 含任一 `row_policy` 则从 tools 去掉 `lucy_read_source`（admin 保存时 warn） |
| R3 | 仅允许 VIEW source 使用 read_source（退回方案 A） |

### 5.3 Join / 多 source

- 若 query 引用多个 source，**每个**带 policy 的 source 都必须注入各自谓词。
- 若 join 到**未授权**表 → 已有 `table_forbidden`。
- 若 join 到**已授权但无 row_policy** 的维表：允许（常见星型模型）；维表本身若含敏感行，应单独加 policy 或拆 source。
- Phase 1 **不**自动推断「事实表 region → 维表级联」；需要则显式配置。

### 5.4 `lucy_explain_query` / catalog / wiki

| 工具 | 策略 |
|---|---|
| `lucy_explain_query` | 与 `lucy_query` 同路径注入后再 explain，避免解释「未过滤计划」误导；deny 语义一致 |
| `lucy_catalog` | 仍只暴露表级可见源；可在 source 元数据增加 `rowPolicy: true`（可选，防 Agent 误以为全表） |
| Wiki | 继续 `sl_refs ∩ sources`；**不**因行级隐藏整页，除非产品要求（本阶段不做） |

### 5.5 审计与可解释性

- `permission_snapshots` 增加 `rowPolicies` 摘要 + schemaVersion（如 `row_acl/v1`）。
- `access_log` / Trace `policy_decision` 记录：注入了哪些 segment/filter（值可脱敏）、deny reason。
- Admin「权限预览」展示：source 列表 + 每源 Row Policy 人可读摘要。

### 5.6 表达能力边界（Phase 1）

**允许：**

- structured filter：`eq / ne / in / gt / gte / lt / lte`（与现有 lucy_query op 对齐；`contains/like` 默认 **不允许** 进 policy，避免意外过宽或注入）；
- `mandatory_segments`：必须是该 source overlay 已定义 segment 名。

**不允许（Phase 1）：**

- 自由 SQL 字符串 `row_filter`；
- 子查询、跨 source 相关子查询；
- 否定「整表」类绕过开关。

---

## 6. 与 VIEW 方案的分工

| 场景 | 用 VIEW (A) | 用 Proxy Row Policy (B) |
|---|---|---|
| 切片长期稳定、需 DB 侧强隔离 / 性能 | ✅ | 可选叠加 |
| 多 Role 共享一表、谓词少量可枚举 | 成本高 | ✅ |
| Agent 属性参数化（L1） | 难 | ✅ |
| 上游不支持复杂 filter 注入 | ✅ 兜底 | 需验证 sl_query |
| 合规要求「库内不可见」 | ✅（或库 RLS） | Proxy  alone 不足（DBA 直连仍可见） |

**原则**：合规「库内不可见」仍靠 VIEW / DB 权限；Lucy Row Policy 解决的是 **Agent 经 MCP 路径的行隔离**。

---

## 7. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| `lucy_read_source` 泄漏全表 | 高 | R1 deny（§5.2） |
| filters 在上游非严格 AND | 高 | 优先 `mandatory_segments`；上线前对目标连接做契约测试 |
| Agent 用 ad-hoc `expr` measure 绕过 | 中 | 保持现有对 raw SQL 拒绝；收紧 ad-hoc expr 引用列的校验（可 Phase 1.1） |
| 维表 / 字典无 policy 导致侧信道 | 中 | 文档约定 + 敏感维表单独 policy；安全 eval 用例 |
| 配置错误导致「看起来有权限实则全 deny」 | 中 | dryRun preview + lint：segment 必须存在 |
| 与旧锚点「缺字段 deny」误解 | 中 | 本方案 §4.3 明确兼容语义；实施时重写 `access-governance-design` §3.2 |
| 被当成多租户承诺 | 高 | 对外文案用 **Row Policy / 行级强制过滤**，禁用「Dynamic RLS」除非 L2 立项 |
| 30s TTL 撤销窗口 | 低（已知） | 沿用现状；紧急场景仍靠 revoke token |

---

## 8. 实施路线（建议）

### Phase 0（已有，保持）

- VIEW-as-pseudo-table 继续作为演示与强隔离兜底。
- 文档标明局限：不可参数化、组合爆炸。

### Phase 1 — Static Row Policy（建议下一阶段主交付，约 1.5–2.5 周量级，待拆 WO 估点）

| 步骤 | 内容 | 验证 |
|---|---|---|
| 1 | Spec：扩展 `07` / `15` / `access-governance` §3.2；术语登记 `Row Policy` | 评审通过 |
| 2 | 类型 + yaml schema + lint whitelist | `lint:spec` |
| 3 | `acl.ts` 解析 `row_policy` → effective | 单测矩阵 |
| 4 | `mcp-proxy` 注入 + `lucy_read_source` deny | proxy ACL 单测 + 安全 eval |
| 5 | Admin 权限预览展示 Row Policy（只读摘要即可） | UI/API 测 |
| 6 | 用 `superstore_orders` 替换或并行验证华东场景（可不删 VIEW role） | MCP 实机：跨区查询行数为 0 / 聚合不泄漏 |
| 7 | 审计 snapshot schemaVersion | audit 测 |

**验收标准（建议）：**

1. 带 `row_policy` 的 Role：`lucy_query` 不传 region 时仍只能返回授权行；显式 `region=华北` 与强制谓词冲突时结果为空或仍被 AND 限制（不得扩大）。
2. 同表无 policy 的对照 Role 行为与今日一致。
3. `lucy_read_source` 对带 policy 的 source 返回明确 deny。
4. 错误配置（假 segment）→ 保存 dryRun 失败或 runtime fail-closed，**不会**静默放行全表。
5. permission snapshot 可区分「仅表级」与「表级+Row Policy」。

### Phase 1.5 — Agent attrs 模板（可选）

- `users[].attrs` + `${attrs.*}` 替换；
- 2–3 个试点 Role；不开放任意表达式。

### Phase 2+（冻结条件触发后再立项）

- L2 Dynamic claims / 多租户；
- CLS（`column_policy`）；
- DB 原生 RLS 双闸门；
- Join 级联谓词推断。

---

## 9. 对存量文档的影响（实施时）

| 文档 | 动作 |
|---|---|
| `docs/access-governance-design.md` §3.2 | 重写为本方案语义；去掉「缺字段全 deny」默认说法 |
| `webui/docs/07-mcp-auth-proxy-spec.md` | 删除「不实现行级」非目标，改为 Phase 边界 + deny reasons |
| `webui/docs/15-role-admin-spec.md` / `14-...` | 同步非目标与预览字段 |
| `webui/docs/00-product-terminology-standard.md` | 登记 **Row Policy（行级策略）**、与 Segment / Filter 的区别 |
| `docs/vision.md` | 产品愿景更新需产品确认：从「不做行级」改为「表级 + 可选 Static Row Policy」 |
| 202608 系列 | 保持「不做 Dynamic RLS」；本方案不复活已删 POC |

---

## 10. 决策清单（请确认后再拆 WO）

请产品 / 负责人确认：

1. **下一阶段是否采纳 Phase 1 Static Row Policy（方案 B）作为主路径？**  
   - 备选：继续只扩 VIEW，不改 Proxy。
2. **`lucy_read_source` 对带 policy 的 source：是否接受默认 deny（R1）？**
3. **谓词表达：是否接受「structured filters + mandatory_segments」，暂不开放自由 SQL `row_filter`？**
4. **Phase 1.5 Agent `attrs` 是否纳入同一版本，还是严格只做 L0？**
5. **对外是否统一使用「Row Policy / 行级策略」而非「Dynamic RLS」？**（推荐：是）

---

## 11. 关闭方式

1. 评审本可行性方案并勾选 §10 决策。  
2. 通过后由 Thinker 拆：`webui/docs/<nn>-row-policy-acl-spec.md` + `docs/plans/wo-...` / `webui/docs/plans/wo-...`。  
3. Builder 仅在 Spec/WO 批准后改 `acl.ts` / `mcp-proxy.ts` / `access.yaml` schema。  

— 完
