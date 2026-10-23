# Lucy Concept Dictionary Spec（P1）

| Metadata | Content |
|---|---|
| Document name | Lucy Concept Dictionary Spec |
| Document type | Product / Semantic Layer Spec |
| Version | v0.1 |
| Written date | 2026-10-14 |
| Related blueprint | `docs/specs/lucy-20261014-fivetran-context-layer-competitive-analysis.md` v1.4 §3 P1、§7.3、§7.4 |
| Related ACL baseline | `docs/access-control/design-upgrade.md` v1.1.2；`webui/docs/07-mcp-auth-proxy-spec.md` |
| Related work order | `docs/plans/wo-20261014-concept-dictionary.md` |
| Scope | 概念字典 YAML Schema、运行时暴露（冷拉取 + 热注入）、跨域激活门控、ACL 一致性 |

---

## 1. Background

Lucy 语义层是**单表视角**：grain / measures / segments / joins 全挂在 source 上。跨数据域存在同名异义概念——Superstore 的「收入」是 `sales`，KX Financial 的「金额」带 `amount_type` 维度，两者在跨域对比时不可直接等同。

**当前处理方式**：靠 `wiki/` 散文与 `evals/*/` case 说明描述差异。这存在已被反复确认的结构性缺陷——**散文在 LLM context 中极易被忽略**，导致「写了规则但 Agent 照样算错」。

**落位裁定**：概念字典**必须进 `semantic-layer/`**（受发布门禁管控、可参与编译校验），**不得进 `wiki/`**（后者会重蹈散文被忽略的既有失败模式，等于造第二份 wiki 且未修复任何问题）。

## 2. Goals

1. 以强结构化 YAML 定义跨域概念及其在各 source 下的 binding。
2. 运行时通过**冷拉取 + 热注入**双路径交付给 Agent。
3. 热注入严格受 `Effective Data Capabilities` 裁剪，**不得成为元数据侧信道**。
4. 跨域消解规则**仅在 token 可见 ≥2 个 binding source 时激活**。
5. 单源场景遵循完全隔离原则（Ignorance is Bliss）。

## 3. Non-goals

- **不**实现通用本体图 / ontology 引擎（那是 Fivetran 量级，非本项目目标）。
- **不**支持自动 schema 发现或概念自动抽取。
- **不**改变 `acl.ts` 的裁决逻辑或 capability 元组定义。
- **不**允许概念注入绕过 `tableSelectors` 授权。

## 4. Schema

文件落位：`semantic-layer/<connection>/concepts.yaml`（与 overlay 同级，纳入既有内容目录治理）。

```yaml
concepts:
  revenue:
    description: "集团营业收入"
    bindings:
      - domain: kx_financial
        measure: kx.amount
        filter: "amount_type = 'REVENUE'"
      - domain: superstore
        measure: superstore.sales
        filter: null
    conflict_rule: "跨域对比时，优先以 kx_financial 财报口径为准"
```

**字段语义**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `concepts.<key>` | map | 是 | 概念名，须与 measure 命名空间可区分 |
| `description` | string | 是 | 人类可读说明 |
| `bindings[].domain` | string | 是 | 数据域标识 |
| `bindings[].measure` | string | 是 | source-qualified measure 名 |
| `bindings[].filter` | string \| null | 是 | 该 binding 成立所需的固定过滤条件 |
| `conflict_rule` | string | 否 | 跨域冲突裁决规则；缺失时默认「不可跨域对比」 |

**结构化程度要求**：`bindings` 为**结构化硬约束**，参与编译与门禁校验；`conflict_rule` 为自由文本，作人类可读补充，**不受「散文被忽略」风险保护**，实现时不得依赖其单独生效。

## 5. Runtime Exposure（双路径）

### 5.1 路径定义

| 路径 | 机制 | 适用 |
|---|---|---|
| **冷拉取（按需工具）** | 扩展 `lucy_catalog` 或 `entity_details` 返回结构，Agent 判断涉及跨域分析时主动查询 | 概念数量多、绝大多数查询不涉及的概念 |
| **热注入（权限裁剪）** | Proxy 依 `Effective Data Capabilities` 解析当前 token 可见 source，**仅**注入相关概念，禁止全量倾倒 | 当前权限范围内的高频概念 |

注入点为 `buildRoleAwareInstructions()`（`webui/server/proxy/mcp-proxy.ts:1585`）。

### 5.2 长度保护

热注入后 instructions 长度须有上限保护；超限时的截断顺序为：**先截断低频概念，再截断描述文本，最后截断 bindings**。`bindings` 不得先于 `conflict_rule` 被截断——否则会失去跨域消解能力。

## 6. Core Algorithm（跨域激活门控）

```ts
// ── 裁剪：可见性严格 ⊆ Effective Data Capabilities ──────────
function visibleBindings(c: Concept, caps: EffectiveDataCapabilities): Binding[] {
  // 只保留当前 token 实际有权访问的 binding source
  // 不得使用 prefix 或模糊匹配 —— 与 tableSelectors 同口径
  return c.bindings.filter(b => caps.sources.includes(canonicalKey(b.domain, b.measure)));
}

// ── 分档激活 ────────────────────────────────────────────
function resolveConceptExposure(
  c: Concept,
  visible: Binding[],
): { mode: "full" | "alias_only" | "none"; payload: unknown } {

  if (visible.length === 0) {
    return { mode: "none", payload: null };          // 完全不注入
  }

  if (visible.length === 1) {
    // ⚠️ 降级为单表别名 —— 严禁包含任何暗示其他口径存在的表述
    return {
      mode: "alias_only",
      payload: {
        name: c.name,
        binding: visible[0],
        // 刻意不含：conflict_rule、其他 binding、跨域对比描述、
        //          以及任何「该指标可能有多种口径」类提示
      },
    };
  }

  // ≥2 binding：完整注入跨域消解
  return {
    mode: "full",
    payload: {
      name: c.name,
      description: c.description,
      bindings: visible,                            // 仅可见 binding，完整
      conflict_rule: c.conflict_rule,
    },
  };
}
```

### 6.1 Ignorance is Bliss（单源降级裁定）

单源场景下**严禁**注入中性提示（如「该指标在多口径下可能有不同定义」）。理由：LLM 读到此类提示后的典型防御性反应是停止计算并反问用户，或循环调用 `wiki_search` 枚举口径——但该 token 仅有单源权限，**追问后仍调不出第二个源**，导致 Agent 知道歧义却既查不到、也无法消解，平白打断正常单域查询。

**裁定：宁可牺牲准确性，不牺牲可用交互。** 当前可见口径即该 token 权限世界里的唯一真理；只有当且仅当可见 ≥2 个 source、真实歧义上下文存在时，才激活消解指引。

此裁定与「无 DataPlane capability 时 catalog 置空而非展示全量」同构——**fail-closed 体现在「不提供信息」而非「提供半截信息」**。

## 7. ACL Consistency（侧信道防护）

这是本 Spec 风险最高的部分。概念元数据进入 system prompt 后，**未授权用户可能通过 prompt 窥探到无权访问的业务表与口径的存在**。

**硬约束**：

1. **可见性严格 ⊆ `tableSelectors` 授权集合**。token 不可见的 source，其 binding 一律不得进入 instructions。
2. **裁剪口径与 ACL 同源**：不得使用 prefix 或模糊匹配，须走 `canonicalKey` 精确比对，与 `design-upgrade.md` 的 selector 语义一致。
3. **降级路径不得泄漏**：单源降级后的 payload 中，`visible.length` 本身即信息——但「该 token 只能看到 1 个」是权限状态的正常表达，不构成泄漏（与 catalog 源列表按权限过滤同构）。
4. **重编译同步**：role / `tableSelectors` 变更并成功编译后，概念裁剪结果必须同步重算。热路径只读当前原子引用，禁止热路径解析 YAML（遵循 `07-mcp-auth-proxy-spec.md` §5.1.2 既定语义）。

## 8. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| English | 中文主术语 | 说明 | 禁止混淆 |
|---|---|---|---|
| Concept Dictionary | 概念字典 | 跨域概念的 binding 与消解规则 | Wiki（散文载体，本概念禁止落此） |
| Binding | 概念绑定 | 概念在某 source 下的 measure + filter | Join（语义层关联，二者不同） |
| Conflict Rule | 冲突裁决规则 | 跨域口径冲突时的优先级 | Row Policy（行级策略，无关） |
| Alias-only Degradation | 单源别名降级 | 可见 binding <2 时的收敛行为 | Fallback（查询降级，无关） |

## 9. Acceptance Criteria

| ID | 准则 | 验证方式 |
|---|---|---|
| SC-1 | 三档门控行为正确 | 可见 binding ≥2 → `full`；=1 → `alias_only`；=0 → `none`。三档各一组单测 |
| SC-2 | alias_only payload 不含跨域暗示 | 断言 payload 序列化结果**不含** `conflict_rule`、其他 binding 名、以及任何「多口径/可能有不同定义」字样 |
| SC-3 | 可见性严格 ⊆ 授权集合 | 构造 token 不可见某 source，断言其 binding 名不出现于 instructions 全文（含冷拉取路径） |
| SC-4 | prefix 不被接受 | 配置含模糊 domain 前缀的 binding → 编译失败 fail-closed |
| SC-5 | role 变更后裁剪结果同步重算 | role 重编译后 instructions 内容随权限变化；未重编译则不变 |
| SC-6 | instructions 长度有上限保护 | 超限截断时 `bindings` 优先于 `conflict_rule` 保留 |
| SC-7 | 不改 ACL 裁决逻辑 | 本 Spec 不改 `acl.ts`；回归跑既有 ACL 全量单测全绿 |
| SC-8 | 不落 wiki/ | CI 检查 `config/wiki/` 下不出现 `concepts.yaml` 或结构化概念定义 |

## 10. Open Questions

1. `concepts.yaml` 的落位：`<connection>/` 内还是 `<connection>/_concepts/`？前者与 overlay 同级更直观，后者可避免被误认为 overlay 的一部分被引擎加载。**倾向后者，需确认 ktx loader 是否会扫描未知子目录。**
2. `description` / `conflict_rule` 是否需要多语言（当前语义层描述为双语）。
3. 冷拉取路径扩展 `lucy_catalog` 还是 `entity_details`——需评估两者现有返回结构的承载能力。