# 答复可核对性 实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | **v0.4-draft** / 2026-11-07（v0.4 修订 2026-11-09） |
| 状态 | **v0.4；R2-F＋R3＋R4 已闭合（2026-11-09）**。实现已落地；独立复审 **Approve with nits**；SC-16／17／21／22 夹具证据已补全（2026-11-13）；**功能合同已收口**。O1＝A／O2＝A。本条收口不表示可上线 |
| 授权边界 | **已获开发授权（R4，2026-11-09）**：按本 Plan 执行实现 Task；不表示可上线 |
| 验收 | Spec SC 有证据；lint:spec-docs 0。**不表示可上线** |
| 目标分支 / 产品线 | `lucy-v0.30` / `0.30.0` |
| Spec | [lucy-20261107-answer-verifiability-spec.md](../specs/lucy-20261107-answer-verifiability-spec.md)（**v0.4-draft**） |
| 需求来源 | P0-4；REQ-030-022 |
| 评审记录 | [Codex 对抗评审](../reviews/2026-11-09-answer-verifiability-codex-review.md) |
| 落位依据 | DEVELOPMENT.md |

## 变更记录

| 版本 | 说明 |
|---|---|
| v0.1-draft | 首立 S0–S4 骨架 |
| v0.2-draft | 批次 R1：导出 summarizeFilters 注意事项 |
| v0.3-draft | R1 triage：生产点覆盖（含 Hive）、失败合同、保真装配、决策→SC 矩阵、instructions 双出口；O1／O2 影响表（不代裁定） |
| v0.4-draft | R2 triage：全链路保真（P1–P4）、P0-1 请求不可变证据形成／传递、SSE 最终写回与 JSON-RPC error 夹具、改写前／后分离、SC-21…23 映射；**不代裁定 O1／O2**；**不宣称 R2-F／R4** |

## 1. 目标

把来源／口径／截止期披露提升为纳入路径上**强制可见**的 `answer_verifiability` 块；禁止成功查数静默无块；首期诚实 `not_checked`；数值保真覆盖解析→归一→投影→写回；P0-1 引用绑定请求 pin 证据。

## 2. 开工前置

1. ~~R2-F~~ → **已闭合（2026-11-09，委托人明示确权）**
2. ~~R3~~ → **已闭合：O1＝A、O2＝A（2026-11-09）**
3. ~~R4~~ → **已授予（2026-11-09）**；可改运行代码与测试
4. 与 018 落点／Spec 162 字段保护对齐；P0-B 未授权前不得接真实 freshness（O2＝A）

## 3. 文件结构（实现时；当前禁止改代码）

| 文件 | 动作 | 独占注意 |
|---|---|---|
| `webui/server/proxy/answer-verifiability.ts`（新建建议） | 纯函数 `buildAnswerVerifiability`／`projectBlockLossless`／`wireFidelityCheck`／失败 reason 常量；CaliberSummary 归一 | 可与 mcp-proxy 并行开发；**契约单测主阵地** |
| `webui/server/proxy/mcp-proxy.ts` | KTX JSON／**SSE 最终写回**成功路径接入；**Hive** 成功 `lucy_query` 接入；门禁当拍写入 `requestPinnedCaliber`＋`argsBeforeRewrite`；B-ASSEMBLE 取代原文回落；保存 `originalWire` | **高冲突区**：勿与其他 P0 实现者同时大改同一函数；按符号分段 |
| `webui/server/proxy/caliber-binding*.ts` | **只读消费**门禁当拍证据；本条不改 P0-1 门禁语义，但装配侧禁止响应期重读会话填引用 | 与 P0-1 实现者协调接口形状；本条不抢改注册表提交路径 |
| `webui/server/proxy/audit-privacy.ts` | 可解释 filters 摘要（新导出或新函数）；**不得**把仅 `{kind,length}` 当作用户口径 | 与审计去值共用时保持审计更严、公开块更可解释 |
| `webui/server/proxy/mcp-proxy.ts` `buildRoleAwareInstructions` | 动态 instructions 增加「须引用可核对块／不得隐藏」 | 与 md 同步 |
| `webui/config/data-qa-instructions.md` | fallback 同步条款 | 与动态数组同步 |
| 测试 | 单元 + 本机接口夹具（KTX JSON／**SSE**／Hive／失败 error／保真／双键／在途 supersede） | 见 §5 |

**明确不改（本条默认）**：`writeCertifiedRouteResponse`（排除路径）；KTX 源码；审计表 schema（D10）；P0-1 注册表提交／begin 协议（仅消费 pin 证据）。

## 4. 决策 → 任务 → 文件 → SC 矩阵（AV-09）

| 决策／分支 | 任务 | 主文件 | SC | 证据夹具 |
|---|---|---|---|---|
| D6／B-OK 成功不变量 | S1 构造 + S2 投影 | answer-verifiability.ts；mcp-proxy.ts | SC-01, SC-06b | **KTX JSON** 成功最终写回 |
| D6／SSE 成功写回 | S2 SSE 路径 | mcp-proxy.ts SSE 归一＋最终事件 | SC-21 | **KTX SSE** 最终写回（本机接口；非整库旅程） |
| D2／D4 三载体＋structuredContent 省略 | S2 | 同上 | SC-06b | structuredContent 缺失／非对象 |
| D7／B-RESOLVE 完整来源 | S1 | answer-verifiability.ts | SC-02, SC-13 | 多源；缺 table |
| D8 口径最小集＋改写前／后分离 | S1 + 调用点 | answer-verifiability.ts；mcp-proxy 快照点 | SC-03 | `>100` vs `<100`；断言改写前快照 ≠ 改写后 args；系统约束分列 |
| D8／§5.2.1 请求 pin 证据 | S1 + 门禁当拍携带 | mcp-proxy／caliber 消费 | SC-03, SC-22 | 证据字段齐全；**在途＋supersede** 仍引用 A |
| D3／AV-07 not_checked | S1 | 同上 | SC-04, SC-05 | 注入 mtime 仍 not_checked |
| D9／§5.6 全链路保真 | S2 | projectBlockLossless + wire 对照 | SC-14, SC-23 | 原始 wire→最终 wire；text 与 structuredContent **分别**夹具（大整数＋超长小数）；禁 Number deepEqual 假绿 |
| B-DENY | S2 短路 | mcp-proxy.ts | SC-07 | degraded／不可见源 |
| B-UPSTREAM-ERR／JSON-RPC error | S2 短路 | mcp-proxy.ts | SC-15 | JSON 与 **SSE** 错误写回各一；无块 |
| B-HIVE-OK | S2 Hive 接入 | maybeWriteHiveDivertedResponse | SC-17 | Hive 成功 lucy_query |
| B-OUT-OF-SCOPE | S2 不调用 | 排除路径 | SC-16 | read_source／explain／freshness／certified／template |
| D4／018 共存 | S2 | 投影 | SC-18 | next_step + answer_verifiability |
| Spec 162 保护 | S2 | meta 合并 | SC-19 | repair／truncated／provenance 仍在 |
| D5 instructions | S3 | buildRoleAwareInstructions + md | SC-08 | 两端快照 |
| D10 审计不平行造事实 | S2 文档断言 | — | SC-19／SC-20 | 无新审计列 |
| O1＝B／C（仅裁定后） | S5（可选） | WebUI | SC-09–11 | 另开 |
| O2≠A（仅裁定+P0-B 后） | 另升版 | freshness | 新 SC | **本条默认不做** |
| 矩阵可追溯 | S0／S4 | Spec§6–8＋本表 | SC-20 | 文档＋夹具清单 |
| lint | S4 | — | SC-12 | lint:spec-docs |

### 4.1 夹具输出断言最低集（AV-09）

| 夹具 | 必断言 |
|---|---|
| KTX JSON 成功 | HTTP／MCP success；三载体合同；块 schema_version＝`"1"` |
| KTX SSE 成功 | 最终写回事件可解析为同一 result 合同；块存在且与 JSON 路径一致 |
| JSON-RPC／MCP error | `isError` 或等价 error；无 `answer_verifiability`；无来源泄露 |
| 改写前／后 | 装配所用 `userFilters` 来自改写前；`systemConstraints` 反映改写后注入 |
| 请求快照引用 | `caliberBinding` 字段＝门禁当拍 pin；supersede 后仍为 A |
| 数值保真 | 最终 wire 中 text 与 structuredContent 分别保留夹具字面量；失败路径不得 success |

## 5. 任务分解

| 阶段 | 内容 | 依赖 | 产出 |
|---|---|---|---|
| **S0** | 确认 R2-F／R3／R4；冻结 §4.1 纳入集；O1／O2 书面结果回写 Spec | 授权 | 决策纸 |
| **S1** | 纯函数：schema_version、SourceIdentity[]、CaliberSummary 类型／归一、Cutoff、`RequestPinnedCaliberEvidence` 校验、失败枚举 | S0 | 单测绿 |
| **S2** | 无损投影 P1–P4；KTX JSON／**SSE 最终写回**；Hive 成功；门禁当拍 pin＋originalWire；B-ASSEMBLE／B-RESOLVE；Spec 162 保护；SC-21…23 夹具 | S1 | 接口夹具 SC-01／13／14／15／17／18／19／21／22／23 |
| **S3** | 动态 instructions + fallback md 同步（可见引用／禁隐藏） | S0 | SC-08 |
| **S4** | 回写 SC 证据索引；lint:spec-docs；确认排除路径无回归；核对 §4 矩阵无空行 | S2–S3 | SC-12／16／20 |
| **S5** | **仅当 O1＝B／C**：只读核对入口或宿主渲染合同 | O1 裁定 | SC-09–11 |

顺序约束：S1→S2→S4；S3 可与 S2 并行。**禁止**在 S0 前改运行代码。

## 6. 验收

- Spec SC-01–SC-08、SC-12–SC-23 证据齐全；SC-09–11 按 O1。
- 夹具至少覆盖：KTX JSON 成功、**KTX SSE 成功**、Hive 成功、权限拒绝、解析失败、装配／保真失败、**JSON-RPC error（JSON＋SSE）**、排除路径、大整数＋超长小数分载体、018 双键、Spec 162 共存、**在途＋supersede**。
- **不表示可上线**；**本 Plan 不构成终稿确权或开发授权**。

## 7. 完成定义

纳入路径成功查数必有合法可见可核对块；失败合同可打假；Hive／SSE 无旁路；首期截止期诚实；全链路保真与 P0-1 请求证据有夹具。

## 8. 风险与回滚

| 风险 | 缓解 | 回滚（授权实现后） |
|---|---|---|
| eval JSON 打断 | 单块加键；SC-06a | 关闭投影 feature flag（若实现时加） |
| 大整数／结构化损坏 | §5.6；SC-23 | 同上 |
| SSE 漏接 | SC-21 门禁 | 修复 SSE 最终写回接入 |
| 在途贴错口径 | §5.2.1；SC-22 | 强制 request-scoped pin |
| Hive 漏接 | SC-17 门禁 | 修复分流接入 |
| 误接 freshness | O2／P0-B 守卫 | 删除 checked 分支 |
| 与并行 P0 改 mcp-proxy 冲突 | §3 独占注意 | 按符号 rebase |

## 9. 非目标（实现时勿顺手做）

- 认证路由／模板纳入（除非升版）
- P0-B 物理探测
- 新审计表
- 改 ACL
- 代裁定 O1／O2 或宣称 R2-F／R4
