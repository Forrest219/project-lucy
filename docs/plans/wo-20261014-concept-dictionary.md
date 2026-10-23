# 20261014-SEM-01 Concept Dictionary Work Order

| Metadata | Content |
|---|---|
| Document name | 20261014-SEM-01 Concept Dictionary Work Order |
| Document type | Work Order |
| Version | v0.1 |
| Written date | 2026-10-14 |
| Spec | `docs/specs/lucy-20261014-concept-dictionary-spec.md` v0.1 |
| Priority | P1 |
| Depends on | 无强依赖，可与 QE-01 / REL-01 并行 |

---

## 前置存在性校验（开工必跑）

```bash
cd /Users/forrest/GitHub/project-lucy

# 热注入点必须存在
grep -q "buildRoleAwareInstructions" webui/server/proxy/mcp-proxy.ts \
  && echo "OK: 注入点存在" \
  || { echo "FAIL: 未找到 buildRoleAwareInstructions"; exit 1; }

# 概念字典必须尚不存在
test -f semantic-layer/demo-mysql/concepts.yaml \
  && echo "FAIL: concepts.yaml 已存在" \
  || echo "OK: 概念字典待建"

# CI 检查点：概念字典禁止落 wiki
test -f config/wiki/concepts.yaml \
  && { echo "FAIL: 概念字典落在 wiki/，违反 Spec §1 落位裁定"; exit 1; } \
  || echo "OK: wiki/ 无违规"
```

## 必读

- `AGENTS.md` → `docs/governance/DEVELOPMENT.md`（**重点：语义层分层、reindex 流程**）
- `docs/access-control/design-upgrade.md` v1.1.2（**canonicalKey / selector 语义，不可绕过**）
- `webui/docs/07-mcp-auth-proxy-spec.md`（ACL 契约；§5.1.2 热路径语义）
- `webui/docs/00-product-terminology-standard.md`
- `docs/specs/lucy-20261014-concept-dictionary-spec.md`（本单权威 Spec）
- `webui/server/proxy/mcp-proxy.ts`（`buildRoleAwareInstructions()` @ :1585）
- `webui/server/proxy/acl.ts`（`canonicalKey` 与 capability 判定）

## 目标

实现跨域概念字典的强结构化 Schema、运行时双路径暴露（冷拉取 + 热注入）、跨域激活门控，以及严格的 ACL 一致性。

## ⚠️ 本单风险最高：ACL 侧信道

概念元数据进入 system prompt 后，**未授权用户可能通过 prompt 窥探到无权访问的业务表与口径的存在**。这是本项目已识别的元数据侧信道风险，实现时 ACL 正确性优先于功能完整性。

## 范围（文件所有权）

**允许修改/新建**：
- `webui/server/semantic/concepts.ts`（新建，Schema 解析与校验）
- `semantic-layer/demo-mysql/concepts.yaml`（新建，CI stub）
- `webui/server/proxy/concept-injection.ts`（新建，热注入与门控）
- `webui/server/__tests__/concept-dictionary.test.ts`（新建）
- `webui/server/__tests__/concept-injection-acl.test.ts`（新建，**权限泄漏测试**）
- `scripts/smoke/verify-20261014-concept-dictionary.mjs`（新建）

**受限修改**：
- `webui/server/proxy/mcp-proxy.ts`（**仅**在 `buildRoleAwareInstructions()` 内接入 concept 注入，不得改动 ACL 判定路径）

**禁止触碰**：
- `webui/server/proxy/acl.ts`（裁决逻辑不得改）
- `config/wiki/**`、`config/skills/**`（概念字典禁止落此）
- `_schema/*.yaml` manifest

## 实施要点

1. **Schema 校验（Spec §4）**：解析 `concepts.yaml`，校验 `bindings[].domain` / `measure` / `filter` 必填，`conflict_rule` 可选。校验失败须 **fail-closed**，不得静默降级为空字典。
2. **可见性裁剪（Spec §6）**：只保留当前 token `Effective Data Capabilities` 中的 binding source。**必须走 `canonicalKey` 精确比对**，禁止 prefix 或模糊匹配（SC-4）。
3. **三档门控（Spec §6）**：
   - 可见 binding ≥2 → `full`（注入 bindings + conflict_rule）
   - =1 → `alias_only`（**仅**该 binding，**严禁**含 `conflict_rule`、其他 binding、任何多口径暗示）
   - =0 → `none`
4. **Ignorance is Bliss（Spec §6.1）**：单源场景**严禁**注入任何「可能存在其他口径」类提示。此为已裁定项，不得自行加回。
5. **长度保护（Spec §5.2）**：超限截断顺序为「低频概念 → 描述文本 → bindings」。**`bindings` 不得先于 `conflict_rule` 被截断**（SC-6）。
6. **重编译同步（SC-5）**：role / `tableSelectors` 变更并成功编译后，概念裁剪结果必须同步重算；热路径只读原子引用，禁止热路径解析 YAML。

## 验收（Spec §9 SC-1..SC-8）

其中三条为权限泄漏硬验证，必须逐条实现：

| 验收项 | 测试要点 |
|---|---|
| **SC-2** | 断言 `alias_only` payload 序列化结果**不含** `conflict_rule`、其他 binding 名、任何「多口径/可能有不同定义」字样 |
| **SC-3** | 构造 token 不可见某 source，断言其 binding 名**不出现于 instructions 全文**（含冷拉取路径） |
| **SC-4** | 配置含模糊 domain 前缀的 binding → 编译失败 fail-closed |
| 其余 | SC-1 / SC-5 / SC-6 / SC-7 / SC-8 按 Spec 覆盖 |

## 验证命令

```bash
cd webui
npx vitest run server/__tests__/concept-dictionary.test.ts \
                server/__tests__/concept-injection-acl.test.ts
npm run lint:terminology

# ACL 未变更回归（SC-7）
npx vitest run server/__tests__/acl-capability.test.ts \
                server/__tests__/kx-acl.test.ts \
                server/__tests__/mcp-proxy-acl.test.ts

cd ..
node scripts/smoke/verify-20261014-concept-dictionary.mjs

# 语义层索引重建（concepts.yaml 变更后必须）
ktx --project-dir "$(pwd)" admin reindex
```

## 不做浏览器测试

依据 `DEVELOPMENT.md`「验证策略：浏览器测试约束」，本工单默认**不做**浏览器 / E2E / 移动窄屏验证。

## 附：待确认（Spec §10 Open Questions）

1. **`concepts.yaml` 落位**：`<connection>/concepts.yaml`（与 overlay 同级）还是 `<connection>/_concepts/`？**倾向后者**，但须先确认 ktx loader 是否扫描未知子目录，避免被误当作 overlay 加载。**开工前须确认。**
2. `description` / `conflict_rule` 是否需要多语言。
3. 冷拉取路径扩展 `lucy_catalog` 还是 `entity_details`——须评估两者现有返回结构承载能力。