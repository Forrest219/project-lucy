# MCP Playground and ACL Decision Visibility Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | MCP Playground and ACL Decision Visibility Spec |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | Attu 3.0 REST API Playground / tool-call approval 评估；交叉审阅（可行性/可落地性，2026-08-05）；`webui/docs/07-mcp-auth-proxy-spec.md` §6.1.1；`webui/docs/100-overview-health-action-deeplink-loop-spec.md` §5 Canonical Deep Link Registry；`webui/docs/39-data-agent-ops-platform-global-ux-spec.md`；`webui/docs/89-admin-audit-turn-drilldown-spec.md`；`webui/docs/94-admin-audit-clarity-and-drawer-ux-spec.md`；`webui/src/pages/admin/Audit.tsx` |
| 适用范围 | 新增 MCP 调试台（ACL 裁决预览 + 最小受控 smoke）；访问日志裁决原因双行可读化与修复深链 |
| 输出位置 | `webui/docs/99-mcp-playground-acl-decision-visibility-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 99 |
| 关联工单 | `webui/docs/plans/wo-202608-32-mcp-playground-acl-decision-visibility.md` |
| 关联页面 | `/admin/mcp-playground`（新）；`/admin/audit`（增强）；`/admin/agents/:id`（入口）；`/overview`（MCP 接入区次入口） |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-mcp-playground.md`；`docs/ui-ux-feedback/pages/admin-audit.md`（`UX-ADMIN-AUDIT-018`） |
| 上游 Spec | Spec 07；Spec 09；Spec 14/15；Spec 39；Spec 89/94；Spec 100（共享深链登记表） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |
| 范围 | ACL DryRun；裁决原因双行展示契约；Audit/Agent 深链；**必达** `tools/list` 最小 live smoke；导航与术语 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿：自 Attu Playground 评估收敛为 Lucy MCP 调试台 P0 |
| v1.1 | 交叉审阅补齐：与 Spec 100 共享 Deep Link Registry；裁决原因双行 UI/类型硬契约；`tools/list` 最小 live smoke 升为必达；明确 Audit 现况为单行待改造 |

## 0. 与 Spec 100 的组合关系（非重复）

| | Spec 99 | Spec 100 |
|---|---|---|
| 主价值 | 决策可解释性与审计可达性 | 健康建议的行动闭环 |
| 共享接口 | Spec 100 §5 Canonical Deep Link Registry | 同左 |
| 审计 URL | remediation / 入口必须用 Registry 形态（含 `tab=calls`） | acl-deny CTA 同形态 |

禁止两份 Spec 各自发明 `/admin/audit?outcome=denied`（无 tab）或 `/?status=partial` 等弃用链。

## 1. 背景

Attu Playground 证明运维面需要「在对象上下文发一次协议请求并立刻看到结果」。Lucy 对应协议是 **MCP Proxy JSON-RPC**，关键失败面是 **ACL 裁决**。

现状缺口（含交叉审阅）：

1. WebUI 内无法对选定 Agent 做 ACL 裁决预览。
2. `Audit.tsx` 调用流水 / Drawer 仍以 **单行** `decisionReason` 机器码展示，缺少「主文案（中文）+ 次行码」层级，Spec 声称的可解释性无法落地。
3. Agent 详情无「试调」入口；与 overview / 审计深链未统一登记表。
4. 若 live smoke 整段可选，关键链路缺少最小回归保障。

边界：Zero AI Dependency；不替代外部 Agent；默认 DryRun；live 仅白名单。

## 2. 目标

1. `/admin/mcp-playground`：Agent → 工具 → 参数 → ACL 裁决 + 可读原因 + 修复深链。
2. DryRun 复用 Proxy `acl.ts`；`decision_reason` 与审计一致。
3. 访问日志与调试台共用 **DecisionReasonView** 双行契约（§6.4）。
4. **必达**最小 live smoke：`tools/list`（§7）；`kx_catalog` 可同单或 follow-up。
5. Agent / Audit / Overview 入口预填上下文；URL 遵守 Spec 100 §5。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 不内嵌 LLM | Zero AI / Spec 66 另轨 |
| 不做通用 REST/SQL 客户端 | 只覆盖 Lucy MCP + ACL |
| 不开放 `lucy_query` live | 防误打生产 |
| 不持久化 Token | 会话内存 only |
| 不改 Spec 07 码语义 | 只消费 |
| 不推翻 5+1 IA | 访问治理下增一项 |
| 不做浏览器验证 | Vitest + terminology + build |

## 4. Terminology Compliance

遵循 `webui/docs/00-product-terminology-standard.md` §4.8。

| Canonical Term | UI 主术语 | 禁止 |
|---|---|---|
| MCP Playground | MCP 调试台 | API 操场、Playground（单独 H1） |
| ACL Decision Preview | ACL 裁决预览 | DryRun（单独主标签） |
| Live Smoke Call | 受控试调 | 真实调用（无「受控」） |
| Decision Reason | 裁决原因 | 拒绝码（主标签） |
| Decision Reason Code | 裁决原因码 | — |
| Decision Reason Primary Line | （中文主文案，无独立导航名） | 把机器码当主行 |
| Effective Permissions Snapshot | 生效权限快照 | 权限 dump |

Protected：`MCP`、`Agent`、`Role`、`Token`、`ACL`、tool name、裁决原因码、表/连接标识、JSON-RPC method。

## 5. 信息架构与路由

### 5.1 Canonical Route

| 路由 | 行为 |
|---|---|
| `/admin/mcp-playground` | 主页面 |
| `/admin/mcp-playground?agentId=&tool=&mode=dry-run\|live-smoke` | 预填 |

侧栏：访问治理，位于访问日志与配置审计之间；`id=admin-mcp-playground`，label=`MCP 调试台`。

同步：`navigation.ts`、Handbook §1.5、`navigation.test.ts`。

### 5.2 入口矩阵（URL 必须符合 Spec 100 §5）

| 来源 | 行为 |
|---|---|
| 侧栏 | 空上下文 |
| Agent 详情 | `?agentId=` |
| 访问日志 denied（`user=` = Agent id） | `?agentId=<user>&tool=`；必要时带 arguments |
| Overview MCP 区 | 次级「打开 MCP 调试台」 |

Remediation「查看近 7 天同类拒绝」：

`/admin/audit?tab=calls&outcome=denied&hours=168&user=<agentId>`

## 6. ACL DryRun 与裁决展示契约

### 6.1 UI 结构

```text
MCP 调试台
├─ PageHeader
├─ 上下文：Agent · Role · 模式（ACL 裁决预览 | 受控试调）
├─ 请求：工具 + JSON 参数 + 运行
└─ 结果：裁决 · DecisionReasonView · 生效权限快照 · remediation
```

### 6.2 API：`POST /api/admin/mcp-playground/acl-preview`

Request / Response 同 v1.0 示例；`remediation.*.href` **必须**落在 Spec 100 Registry。

规则：不转发 KTX；共享 ACL 函数；禁用/缺失 Agent 可读错误；坏 JSON → 400。

### 6.3 码 → 中文映射

沿用 v1.0 表（`allowed` / `tool_forbidden` / `table_forbidden:*` / … / 未知码）。**单一映射模块**：server 返回 `decisionReasonLabel`；前端 `DecisionReasonView` 以 API label 优先，本地 fallback 仅用于历史 audit 行无 label 时。

### 6.4 DecisionReasonView 硬契约（调试台 + Audit 共用）

交叉审阅阻断点：Audit 现状单行码。本 Spec 要求落地后：

```ts
type DecisionReasonViewModel = {
  code: string;          // 机器码，如 tool_forbidden / table_forbidden:x
  label: string;         // 中文主文案
  detail?: string;       // 可选补充（首个未授权表等）
};
```

**DOM 结构（调用流水列 + Drawer「裁决原因」+ 调试台结果区）：**

```text
[主行] label（中文，可含 detail 短后缀）
[次行] code（font-mono、text-fg-muted、notranslate）
```

- 禁止仅渲染 `entry.decisionReason` 单行作为最终态。
- `allowed` 同样双行：「允许执行」+ `allowed`。
- 未知码：主行「未识别裁决原因」，次行原码。
- 建议组件：`DecisionReasonCell`；`data-testid="decision-reason-label"` / `decision-reason-code`。

### 6.5 Audit 改造范围

| 位置 | 要求 |
|---|---|
| 调用流水「裁决原因」列 | DecisionReasonView |
| Drawer 裁决原因 | 同上 |
| denied 行 / Drawer | 「在调试台复现」→ `/admin/mcp-playground?agentId=&tool=` |
| 问询 Tab L1 | 不强制改列（无单行 reason 则不动） |

## 7. 受控试调

### 7.1 白名单

| 工具 | 本工单 |
|---|---|
| `tools/list`（JSON-RPC method） | **必达**最小 smoke |
| `kx_catalog` | 建议同单；可 defer 但须在 Plan 标明 |

禁止 live：`lucy_query`、wiki 写、未知工具、用户指定 URL。

### 7.2 Token 与确认

会话粘贴 Token；确认 Modal；`POST /api/admin/mcp-playground/live-smoke`；只打本机 MCP endpoint；不回显完整 Token；成功给出 audit 深链（Registry 形态）。

## 8. 安全护栏

本机信任边界；不读 secrets 填 Token；live 单飞 + timeout；禁止任意 URL；结果中表/工具名 `notranslate`。

## 9. Design System Compliance

PageHeader / filter / Drawer / button hierarchy；DryRun primary；Live 入口 secondary + 确认后运行；无纯计数 badge。

## 10. 验收标准

- [ ] 侧栏 / 命令面板可达「MCP 调试台」。
- [ ] DryRun 拒工具/拒表：`allowed:false` + 正确 code；UI 双行 + remediation（Registry URL）。
- [ ] DryRun 允许：`allowed:true`。
- [ ] `/admin/audit` 调用流水与 Drawer：**双行** DecisionReasonView（非单行码）。
- [ ] Agent 详情深链预填 `agentId`。
- [ ] **必达** `tools/list` live smoke 可跑通（或测试替身覆盖服务端路径）；Token 不落盘。
- [ ] 无弃用 audit/catalog 深链由本模块产出。
- [ ] 测试 + `lint:terminology` + `build`；不做浏览器验证。

## 11. 上游关系

| Spec | 关系 |
|---|---|
| 07 | 消费码表 |
| 09 | 工具/参数 |
| 14/15 | Role/Agent remediation |
| 39 | 协议调试面 |
| 89/94 | 裁决展示升级，不推翻 Tab IA |
| 100 | 共享 Registry；`user=` vs `agentId=` 映射 |
| 66 | 非 Copilot |

## 12. 实施分期

| Phase | 内容 | 必达 |
|---|---|---|
| A | 映射模块 + DryRun API + 调试台 UI + 导航 | 是 |
| A2 | Audit DecisionReasonView 双行 + 复现深链 | 是 |
| A3 | `tools/list` 最小 live smoke | 是 |
| B | `kx_catalog` live + audit 参数回填增强 | 可 follow-up |
