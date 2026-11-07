# 问题类型口径绑定 实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | v0.2-draft / 2026-11-07 |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**（2026-11-07）。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。配套 Spec v0.2-draft。本阶段只评审与修订本 Plan，**暂不执行任何实现 Task** |
| 授权边界 | **不授权改代码**。须满足功能清单池 §2.2：R1 形态 → R2 对抗式评审 → R3 O1／O2 闭合 → R4 委托人开发授权 |
| 验收 | Spec SC-01–SC-14 逐条有证据；`npm run lint:spec-docs` 退出 0；相关 vitest 全绿；夹具证明偏离请求零上游执行。**不构成发布取证，不表示可上线** |
| 目标分支 / 产品线 | `lucy-v0.30` / `0.30.0` |
| 需求来源 | 清单 P0-1；需求池 REQ-030-027 |
| Spec | [lucy-20261107-question-type-caliber-binding-spec.md](../specs/lucy-20261107-question-type-caliber-binding-spec.md) |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) 落盘清单与 Plan Mode |

## 1. 目标

把「问题类型 → 唯一表 + 固定口径」从逐题改 YAML 的止血手法，落成可发布资产 + Proxy 硬门禁，使命中绑定后的 Agent 无法自行加工口径。

## 2. 开工前置

1. Spec v0.1 评审通过（或修订至可交付开发）。
2. **O1**（发布／加载接线）与 **O2**（触发匹配算法）由委托人裁定并回写 Spec。
3. 明确**开发授权**。
4. 术语标准补登记 Question Type Binding 等（Spec Terminology 落位）。
5. 基线：`npm run lint:spec-docs` 绿（存量 WARN 除外）。

## 3. 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `webui/server/proxy/caliber-binding.ts`（建议） | 新建 | 加载、匹配、集合校验纯函数 |
| `webui/server/proxy/mcp-proxy.ts` | 修改 | `lucy_begin_question` 激活；query／explain 门禁 |
| `webui/server/proxy/question-experience.ts` 或 journey 存储 | 修改 | Active Binding 挂在问询旅程 |
| `webui/server/paths.ts` / publish 扫描（若 O1 要求） | 修改 | 内容根 `caliber-bindings/` |
| `webui/docs/00-product-terminology-standard.md` | 修改 | 新术语 |
| `webui/server/__tests__/caliber-binding*.test.ts` | 新建 | SC 覆盖 |
| 示例 `caliber-bindings/*.yaml`（demo 或 docs 夹具） | 新建 | 测试夹具，非客户秘密 |

## 4. 任务分解

### S0：决策闭合与夹具

- 回写 O1／O2；准备最小 published／draft YAML 夹具。
- **验证**：决策表无「开工前必答」空项。

### S1：纯函数加载与匹配

- 实现 load／match／subset 校验；draft 过滤；歧义 ≥2。
- **验证**：SC-01、SC-04、SC-05 单测红→绿。

### S2：begin_question 激活

- 显式 id、唯一触发、不可见 id、歧义拒绝；写入旅程。
- **验证**：SC-02、SC-03、SC-06、SC-12。

### S3：query／explain 门禁

- ACL 之后、上游之前；错 Source／越集／缺 requireMeasures；行权限字段豁免。
- **验证**：SC-07–SC-11、SC-13；上游计数断言。

### S4：术语与门禁文档

- 术语标准登记；Spec／Plan 状态行；清单池状态回写。
- **验证**：SC-14；清单池 P0-1 行与需求池 REQ-030-027 状态同句。

### S5：对抗式评审与收口准备

- 独立评审；阻断项清零后才可申请开发授权后的合并。
- **验证**：评审记录落 `docs/reviews/` 或 `inbox/` 并回链 Spec。

## 5. 验收

- Spec SC-01–SC-14 逐条有证据（单测或夹具上游计数）。
- `npm run lint:spec-docs` 退出码 0；相关 vitest 全绿。
- 偏离绑定的请求：**本机拒绝且上游执行计数为 0**。
- **不构成发布取证，不表示可上线**。

## 6. 完成定义

- SC-01–SC-14 均有自动化证据（或夹具证据）。
- 未授权前无运行代码合入；授权后合入须附实现笔记。
- **不宣称可上线**。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| O1 未定导致发布后绑定不加载 | 阻塞 S3 合入 |
| 与 Skill prerequisites 双源真相 | Spec D8：Skill 只可选引用 bindingId |
| 触发误伤 | O2 + SC-05 fail-closed |

## 8. 建议实施序（产品线）

本条为 **Spec 批次 S1** 主角。下一批（S2）：P0-2 Catalog 语义暴露 Spec；P0-A 已有 Spec 继续评审。不得插队实现 P2 辅线挤占本条评审带宽。
