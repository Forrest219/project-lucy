# readyz 与 MCP 监听就绪一致性 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / **v0.2** |
| 日期 / 目标版本 | 2026-11-18／产品线 `0.30.0` |
| 功能编号 / 优先级 | **P1-46**／REQ-030-067／**P1**（事故修复；前方报告分级为 **P0-03**）。**不入 0.30 核心分母** |
| 台账号 | 无。挂现行 `0.30` 执行总账，不占用 v0.25 登记册 |
| 状态 | **v0.2。终稿已确权、开发已授权（委托人 2026-11-18「授权定稿」）。代码已实现；vitest 守卫通过；测试台 UAT-SUITE-READYZ-MCP-LISTEN＝**PASS**（[2026-11-18-cursor-rml](../qa/uat/suites/readyz-mcp-listen/runs/2026-11-18-cursor-rml-p145-p147.md)）。不入核心分母。≠ 可上线** |
| 决策来源 | 委托人 2026-11-18 要求按仓库规范为前方升级测试报告三则 P0 分别制定 Spec 与 UAT |
| 需求来源 | 前方报告 LUCY-TR-20261118-01 v1.2 §4.1 P0-03；证据 E23 |
| 实施主体 | WebUI 服务端：`webui/server/index.ts`（`app.listen`／`proxy.listen`／`markWebuiWarmupComplete`）、`webui/server/runtime/readiness.ts`。不改 Helm 探针路径（见 OQ-2） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | 延续 [P1-39](lucy-20261117-cold-start-audit-scan-spec.md)（监听前预热、首轮扫描等监听后）。本条只收「对外 Ready 与 MCP listen 对齐」。不解释客户稳态 502／503（归 P1-39／P1-47） |
| 实施计划 | [`docs/plans/lucy-20261118-readyz-mcp-listen-consistency-plan.md`](../plans/lucy-20261118-readyz-mcp-listen-consistency-plan.md) |
| 测试台 | [`UAT-SUITE-READYZ-MCP-LISTEN`](../qa/uat/suites/readyz-mcp-listen/suite.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.2 | 2026-11-18 委托人「授权定稿」：终稿确权＋开发授权；OQ-1＝display 预热可在 MCP listen 之后；进入多 agent 并行实现。同日 Wave1 Agent-46 落地：`index.ts` listen 顺序修正＋vitest 守卫；UAT 未跑 |
| v0.1-draft | 初稿。依据前方报告 P0-03 启动窗口复现起草。终稿未确权；开发未授权 |

## 闭口层级

- 层级：功能合同
- 本条承诺：Kubelet／测试驱动观测到的首次 `readyz` 200，与真实 MCP `initialize` 成功之间不存在「Web 已 Ready、MCP 端口尚未 listen」的空窗；合法 Agent 在首次 Ready 后即可握手。
- 本条出口：SC-01–SC-06。
- 不在本条出口：稳态重建下的探针超时（P1-47）、中断恢复（P1-45）、客户 OpenResty 日志、K8s EndpointSlice 摘除实测。
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: None.

## 交互合同豁免

- 原因：本条只改就绪判定与启动顺序，不改变用户可见 WebUI 表面
- 不改变：页面路由、组件、按钮、文案与布局；`/api/readyz` 路径；成功时仍返回 200＋既有 `data` 形状；warming 时仍可 503

## 1. 问题陈述

当前启动顺序（`index.ts`）：

1. `await app.listen(...)`（Web）
2. **立即** `markWebuiWarmupComplete()` → `isWebuiReady()` 为 true → `/api/readyz` 可 200
3. 随后 display 预热、ledger 恢复、`buildProxy`、**然后** `proxy.listen`

前方证据：readyz 200 后立即 MCP initialize 可失败；稍后重试成功。重试成功只证明窗口结束，不能关闭本项。

## 2. 目标与非目标

**目标**

1. 将「对外 Ready」推迟到 MCP 端口已 listen（或等价：readyz 同时检查 MCP listening）。
2. 保留现有：语义恢复／审计预热仍在 Web listen 之前。

**非目标**

- 不承诺每次启动零失败样本以外的稳态网关问题。
- 不要求修改客户 Chart 的失败阈值（除非 OQ-2 裁定）。

## 3. 方案倾向

| 选项 | 内容 | 备注 |
|---|---|---|
| A | `proxy.listen` 成功后再 `markWebuiWarmupComplete()` | **倾向** |
| B | readiness 增加 `mcpListening`；readyz 要求 Web＋MCP | 与 A 等价或组合 |

## 3.1 核心流程（伪代码）

```text
boot():
  recover journals / warm audit DBs          # 仍在 Web listen 之前
  app.listen(web)
  # 此处不得 markWebuiWarmupComplete
  optional: display prewarm / ledger recover # 可在 MCP listen 前或后，见 OQ-1
  proxy.listen(mcp)
  markWebuiWarmupComplete()                  # 或 set mcpListening=true

readyz():
  if not isWebuiReady(): return 503 warming_up
  # isWebuiReady 仅在 MCP listen 成功后为 true
  return 200
```

## 4. 验收（SC）

| ID | 合同 |
|---|---|
| SC-01 | 启动过程中，在 MCP listen 完成前，`/api/readyz` 不得返回 200 |
| SC-02 | 首次 `/api/readyz` 200 的同一采样窗口内，直连 MCP 端口的 `initialize` 必须成功 |
| SC-03 | 不以「第二次 initialize 成功」关闭本项 |
| SC-04 | 按客户就绪探针周期（默认 5s）连续采样至少 3 次冷启动，SC-02 均成立 |
| SC-05 | Web 管理主路径（登录／`GET /api/project`）在首次 Ready 后仍可用 |
| SC-06 | 对应 UAT 必做项全真 PASS |

## 5. 开放项

| ID | 问题 | 默认 |
|---|---|---|
| OQ-1 | display 预热是否必须在 mark ready 之前？ | **已决**：可在 MCP listen 成功并 mark ready 之后；Ready 只约束 MCP listen |
| OQ-2 | 是否同步改仓库标准 Chart 探针说明？ | 本条默认不改 Chart；交付说明另条 |

## 6. 授权边界

- **终稿已确权、开发已授权（委托人 2026-11-18「授权定稿」）。**
- 实现范围见配对 Plan；默认不改 Helm；禁止未另授权的线上升级。
