# 物理新鲜度合同 实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | v0.1-draft / 2026-11-13（O 闭合） |
| 状态 | **v0.1-draft；O1–O3 已闭合（2026-11-13）＝建议包 F；待 R2-F；终稿未确权；冻结落地；未授权实现**。配套 Spec v0.1-draft。本阶段只评审与修订本 Plan，**暂不执行任何实现 Task**。**不是** R2-F，**不是** R4，**不可功能合同收口** |
| 授权边界 | **不授权改代码**。须满足功能清单池 §2.2：R1 形态 → R2 对抗式评审 → R2-F 终稿确权 → R3 开放决策闭合 → R4 委托人开发授权。不得改 P0-4 的 cutoff |
| 验收 | Spec SC-01–SC-10 逐条有证据；`npm run lint:spec-docs` 退出 0。**不构成发布取证，不表示可上线** |
| 台账号 | 无（`0.30` 台账未建立；待 PM 指派后再登记） |
| 目标分支 / 产品线 | `lucy-v0.30` / `0.30.0` |
| 需求来源 | 清单 P0-B；需求池 REQ-030-028 |
| Spec | [lucy-20261109-physical-freshness-contract-spec.md](../specs/lucy-20261109-physical-freshness-contract-spec.md) |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) 落盘清单与 Plan Mode |

## 1. 目标

让 `lucy_freshness` 按声明返回未配置、业务日期水位或失败可见的结果，并且任何路径都不用语义文件 mtime 填物理水位。可核对块保持 P0-4 的 `not_checked`。

## 2. 开工前置

1. **O1／O2／O3 已闭合（2026-11-13）＝建议包 F**（[决策纸](../reviews/2026-11-13-p0-b-o1-o3-decision-package.md)）；Spec §4 已回写。**仍待 R2-F**；未获 R4 前不得实现这三支。
2. Spec 获得 **R2-F**（Codex CLI 终审，或委托人明示确权）。
3. 明确 **R4 开发授权**。D1–D9 已冻结，授权后按冻结合同实现，不再另选。
4. 确认 P0-4 `answer-verifiability` 装配器仍固定 `cutoff.status = not_checked`。本 Plan 不修改该装配器的成功值。**不改 P0-4 已冻结的 `not_checked`。**

> **门禁声明**：本 Plan 现行 **O1–O3 已闭合（建议包 F）；待 R2-F**。**不是 R2-F、不是 R4、不可功能合同收口**，直至 R2-F 完成并另获 R4。

## 3. 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `webui/server/proxy/mcp-proxy.ts` | 修改 | `lucyFreshness` 改为策略结果；不可见 source 保持拒绝 |
| 新鲜度策略纯函数（建议 `webui/server/proxy/freshness-policy.ts`） | 新建 | 声明解析、状态机、说明句；不含页面 |
| 语义 overlay 读取处 | 修改 | 只读取 O1 裁定的声明位置 |
| `webui/server/__tests__/freshness-policy*.test.ts` | 新建 | SC-01–SC-09 |
| `webui/server/proxy/answer-verifiability.ts` | **不改成功 cutoff** | SC-08 用现有装配器做隔离断言 |
| `webui/docs/00-product-terminology-standard.md` | 修改 | 新术语 |

未授权前不创建上述运行时代码。

## 4. 任务分解

### 变更记录（Plan）

| 版本 | 说明 |
|---|---|
| v0.1-draft | 2026-11-09 首立；建议包 F；冻结落地 |
| v0.1-draft（O 闭合） | **R3（2026-11-13）**：委托人会话批准整包采纳建议包 F；开工前置 §2 与 Spec §4 同句。**待 R2-F**；未授权实现。**不改 P0-4 cutoff**。**不构成 R2-F／R4** |

### S0：决策闭合

- O1／O2／O3 已闭合（建议包 F，2026-11-13）；决策纸已签署。**仍待 R2-F／R4 方可实现 S2。**
- **验证**：Spec §4 O 行状态为已闭合；**不改 P0-4** `not_checked`。

### S1：未配置可见，且 mtime 隔离

- 缺声明返回未配置；mtime 只进 `semanticLayerUpdatedAt`。
- **验证**：SC-01、SC-02、SC-03、SC-09。

### S2：业务日期水位（O1–O3 闭合后）

- 合法字段取 `max`；非法策略与失败路径不编造时间；行权限无行时不可用。
- **验证**：SC-04、SC-05、SC-06、SC-07。

### S3：与可核对块隔离

- 水位已校验的夹具上，成功查数块仍是 `not_checked`。
- **验证**：SC-08。

### S4：术语与门禁

- 术语标准；清单池、需求池、索引与 Spec 头部同句。
- **验证**：SC-10。

## 5. 验收

- Spec SC-01–SC-10 逐条有证据。
- 成功路径无 `mode:"metadata_only"`。
- P0-4 cutoff 合同没有被本条改写。
- **不构成发布取证，不表示可上线**。

## 6. 完成定义

- 适用 SC 均有自动化证据。
- 未获 R4 前，O 已闭合分支亦无运行代码。
- 未授权前无运行代码合入。
- **不宣称可上线**；不宣称 P0-4 的截止期已经变成已校验。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 顺手把 checked 水位写入可核对块 | S3／SC-08 单独断言；文件结构写明装配器不改成功值 |
| O2 执行器绕过行权限 | S2 夹具覆盖无可见行 |
| 大表 `max` 拖垮工具 | 独立超时；本版按 O3 建议不缓存 |

## 8. 建议实施序

本条是 P0-4 的伴生真源。可以在 P0-4 已落地的前提下评审本 Spec。实现必须等 R4。不得插进 P0-6／P0-7 的评审带宽之前，除非委托人改序。

## 浏览器验证

不适用：本条不改变用户可见 WebUI 表面，没有页面可打开。
