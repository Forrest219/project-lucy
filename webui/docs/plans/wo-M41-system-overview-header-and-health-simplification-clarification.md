# WO-M41 System Overview Header And Health Simplification — Clarification Questions

> 移交 coder 前必答；每条都有默认建议（详见 SPEC §10）。

## Q1. 「系统状态」摘要行是否替代现有 ServiceHealthStrip？

**默认建议**：是。ready / warning 态用一句摘要替代现有 ServiceHealthStrip：
- 摘要行：一句话健康度，落在 PageHeader 之后；视觉权重低
- ServiceHealthStrip：不再渲染；如无其他引用，可删除组件实现

理由：本工单的核心是降低重复和信息密度。摘要行 + ServiceHealthStrip 并存会继续重复 Lucy MCP / KTX / 语义覆盖 / Agent，违背截图反馈。

## Q2. danger 态是否渲染摘要行？文案是否要更具体？

**默认建议**：danger 态不渲染摘要行，只渲染现有 `pl-service-health-critical` alert。alert 文案需要更具体：
- `系统异常：Lucy MCP 未就绪，请检查 Endpoint 配置。`
- `系统异常：KTX Runtime 不可用，请检查运行时配置。`
- `系统异常：Lucy MCP 与 KTX Runtime 不可用，请检查接入。`

理由：danger 需要高权重 alert，不需要再有一条轻提示摘要；具体失败组件能减少排障成本。

## Q3. 自动刷新彻底删除后，是否仍保留 `coreFetching`？

**默认建议**：保留。它仍是「刷新」按钮的 disabled 状态 + 文本（`刷新` ↔ `刷新中...`）的依据。

## Q4. 「刷新」按钮放在右侧 actions 还是标题下方？

**默认建议**：右侧 actions 区（与现有 Onboarding 内其它 CTA 一致）。视觉权重为 secondary，不抢标题。

## Q5. 摘要行是否需要视觉强调（左边色条 / 背景色）？

**默认建议**：不引入新边框 / 背景；用 `data-tone="ready" | "warning"` 给现有 `pl-page-intro` 加 modifier。如未来需要色块再升级。

## Q6. 测试中过期 token 如何写可重复断言？

**默认建议**：

```ts
import { vi } from "vitest";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});
```

fixture 直接构造 `expires_at = "2026-06-24T00:00:00Z"`；用 `vi.setSystemTime` 让当前时间固定在 2026-08-01，断言过期 token 不计入。

## Q7. demo 数据 `demo_huadong_manager` 当前是否计入？

**默认建议**：不计入（这是 SPEC §1 背景明确要求）。其 token `expires_at=2026-06-24T00:00:00Z` 截至 2026-08-01 已过期，新语义下不计入「可用 Token」。

> 注：本工单不修改 `/api/admin/agents` 返回数据；只改前端筛选语义。

## Q8. summarizeServiceHealth 是否拆组件？

**默认建议**：不拆组件，但 helper 不能返回 plain string。`summarizeServiceHealth` 返回结构化 view model，例如 `{ tone, semantic: { done, total, gap }, agents: { enabled, total, gap } }`；React 渲染层拼 JSX。

理由：摘要中的 `Lucy MCP`、`KTX Runtime`、`Agent` 等专业术语必须加 `notranslate` / `translate="no"`，plain string 无法满足 DOM 防翻译要求。

## Q9. 「上次更新」彻底删还是放进 toast？

**默认建议**：彻底删（包括 state、ref、effect、UI）。刷新成功 / 失败由 `toast.success` / `toast.error` 承担。

理由：用户关心的是「状态是否最新」，而不是「刷新发生在哪一秒」；toast 已经覆盖。

## Q10. `RefreshMenu` 删除后，组件函数整体从文件删除还是改成 `null` 导出？

**默认建议**：整体删除（包括函数体 + 上方注释 + Props 类型）。理由：彻底收口，避免遗留代码。

## Q11. 「系统异常」摘要行 + alert 同时渲染？

**默认建议**：否。danger 态下：

```jsx
{overall === "danger" && (
  <section className="pl-panel pl-service-health-critical" role="alert" data-testid="ops-service-health-critical">
    ...现有 alert
  </section>
)}
{overall !== "danger" && summary && (
  <div data-testid="ops-service-health-summary" data-tone={summary.tone}>
    ...由 summary view model 拼 JSX，并为 Lucy MCP / KTX Runtime / Agent 加 notranslate
  </div>
)}
```

理由：danger 用 alert 表达高权重；ready / warning 用摘要表达轻提示。两者不要同时出现。

## Q12. MCP 接入区 fallback 文案是否需要复用既有 token？

**默认建议**：复用现有文案，不变。具体触发条件 `endpointInfo.status === "fallback"` 或 `configured === false` 仍由现有 `McpConfigSection` 内部判断。

## Q13. 「刷新」按钮 disabled 时长？

**默认建议**：disabled 由 `coreFetching`（任一核心 query 在 fetching）决定。fetching 中按钮文案变 `刷新中...`，其它状态为 `刷新`。

## Q14. 摘要行是否需要"控制台日志"链接？

**默认建议**：保留，作为摘要行尾部的弱链接（`Link to="/admin/audit"`，视觉与现有 `pl-card-cta` 一致）。点击跳转 `/admin/audit`。

## Q15. 顶部清爽化测试是否可以全局查询文本？

**默认建议**：不可以。顶部断言必须 scope 到 `data-testid="page-header"`：

```ts
const header = screen.getByTestId("page-header");
expect(within(header).queryByText(/环境:/)).not.toBeInTheDocument();
expect(within(header).queryByText(/上次更新/)).not.toBeInTheDocument();
```

正文区域仍允许出现 `KTX Runtime`、语义覆盖、可用 Token、Endpoint 等合法信息。

## Q16. 测试断言 "刷新按钮是普通按钮" 怎么写？

**默认建议**：

```ts
const button = screen.getByTestId("onboarding-refresh-button");
expect(button).toBeInstanceOf(HTMLButtonElement);
expect(button).not.toHaveAttribute("aria-haspopup");
expect(button).not.toHaveTextContent("▾");
expect(["刷新", "刷新中..."]).toContain(button.textContent?.trim());
```

理由：用 `data-testid` 锚定避免脆弱文案断言；`aria-haspopup` 缺失直接证明下拉已删除。
