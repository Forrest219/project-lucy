// Shared forbidden-terms audit for the M21 connection module terminology
// refresh. Every fragment in this list was a machine-translation artifact or
// a non-canonical translation that previously slipped into the connection /
// whitelist / test pages. New UI code must never render any of these.
//
// Allowed translations are kept short and explicit:
//   - `Schema` and `Manifest` stay in English inside labels and headings.
//   - `Schema Manifest` is rendered as `Schema Manifest` (English), never as
//     "模式清单" / "舱单" / "财政部舱单".
//   - The connection-test workflow is `连通测试` (page title) / `测试连接`
//     (button label). Never `替代测试`.
//   - Package-level export uses `资产包` / `上传资产包`. Never `报价包`.
//   - Schema-related controls use `Schema` directly. Never `架构` / `模式`.

export const FORBIDDEN_TERMS: ReadonlyArray<string> = [
  // Manifest terminology
  "财政部舱单",
  "模式清单",
  // Package terminology
  "上传报价包",
  "下载报价包",
  "报价包",
  // Connection test terminology
  "替代测试",
  // Schema terminology (English Schema is the canonical term)
  "添加架构",
  "目标架构",
  "目标模式",
  "模式筛选",
  "全部架构",
  // Mixed/legacy phrases that already accumulated in earlier M-stories
  "运行连通测试"
];

export function assertNoForbiddenTerms(container: HTMLElement | Document) {
  for (const term of FORBIDDEN_TERMS) {
    // queryAllByText would throw on multiple matches; use a containment check
    // so we catch a forbidden substring inside longer phrases too.
    const nodes = container.querySelectorAll("*");
    for (const node of Array.from(nodes)) {
      const text = node.textContent ?? "";
      if (text.includes(term)) {
        throw new Error(
          `Forbidden terminology "${term}" found in element <${node.tagName.toLowerCase()}>: ${text.slice(0, 80)}`
        );
      }
    }
  }
}
