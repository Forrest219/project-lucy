# Restore Row-Policy Proxy Wiring Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Row Policy Proxy 接线恢复 Spec |
| 文档类型 | Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-09-23 |
| 撰写人 | Grok |
| 委托人 | xingchen |
| 基于材料 | `9a6af9d` 接线恢复；Spec 99 §6；Spec 100；`inbox/20260923-row-policy-status-review.md` 交叉验证结论 |
| 适用范围 | 把 `68db68a` 抹掉的 `lucy_query` 强制谓词注入和 `lucy_explain_query` 诊断接线恢复到 `main` |
| 输出位置 | `webui/docs/146-restore-row-policy-proxy-wiring-spec.md` |

144 号留给 Skill Hub。本文由 `9a6af9d` 上的 144 号草稿改号落地。

## 1. 背景与问题

2026-08-24 的合并提交 `68db68a` 覆盖了 `webui/server/proxy/mcp-proxy.ts`，抹掉 Row Policy 的 Proxy 接线：

| 被抹掉的接线 | 后果 |
|---|---|
| `lucy_query` 转发前调用 `applyLucyQueryForcedFilters(toolArgs, decision.forcedFilters)` | 限定行谓词不注入；客户端伪造的 `forced_filters` 原样到达上游 |
| `lucyExplainQuery` 调用 `buildExplainForcedPredicateDiagnostics` | explain 丢失 E1–E5 诊断字段 |

`row-policy.ts` 与 `acl.ts` 仍计算 `forcedFilters`。缺的是 Proxy 调用点。默认 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN=false` 时取数仍拒绝；开关打开后才会静默放宽行集。

## 2. Goals

1. `lucy_query` 放行后剥离客户端 `forced_filters` / `forcedFilters`，写入策略编译结果，并把谓词前插到 `filters[]`。
2. `lucy_explain_query` 恢复本地诊断：`semantics = permission_forced_predicate_diagnostic`，不转发上游，不返回数据行。
3. 保留此后 main 已有的 `executionMode: "plan_only"` 与 `executed: false`。
4. 不改变 proven 默认值。本文不授权把 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN` 设为 true。

## 3. Non-goals

- 不恢复同一提交抹掉的 SSE 早段 header flush。
- 不改 ACL 判定、`row-policy.ts` 谓词编译或 KTX 上游行为。
- 不把生产 Role 改成限定行，不打开 proven。

## 4. 恢复设计

ACL 放行之后、目录类工具分支之前：

```ts
if (toolName === "lucy_query") {
  const record = applyLucyQueryForcedFilters(toolArgs, decision.forcedFilters);
  toolArgs = record;
  const params = parsedRpc?.params && typeof parsedRpc.params === "object" && !Array.isArray(parsedRpc.params)
    ? parsedRpc.params as Record<string, unknown>
    : undefined;
  if (params) params.arguments = record;
}
```

`lucyExplainQuery` 用 `extractSourceRefs` 得到请求源；为空时按 capability 的 `physicalTable` 回补。再展开 `buildExplainForcedPredicateDiagnostics`，并保留 `executionMode` / `executed`。

## 5. 验收

```bash
cd webui && npx vitest run --maxWorkers=1 \
  server/__tests__/mcp-proxy-row-policy-by01-by18.test.ts \
  server/__tests__/row-policy-ac-p1.test.ts \
  server/__tests__/ac-security-eval.test.ts
```

期望 33 项全绿：伪造载体被换成策略谓词；explain 带诊断字段；proven=false 仍然拒绝且不转发。
