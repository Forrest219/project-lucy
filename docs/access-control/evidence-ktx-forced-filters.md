# 证据：Lucy 承载的强制谓词契约（AC-P1 Gate C 项 1）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 强制谓词载体证明（bundled KTX） |
| 文档类型 | Test Report |
| 版本 | v2.0 |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | ADR `adr-upstream-forced-predicate.md`；Spec 99 §6；bundled `@kaelio/ktx@0.16.0` |
| 适用范围 | Gate C「上游强制谓词契约」在 **Lucy 仓库内**闭合；**不**依赖向 `kaelio/ktx` 写代码或发 npm 包 |
| 输出位置 | `docs/access-control/evidence-ktx-forced-filters.md` |

## 1. 产品边界（已确认）

| 项 | 决策 |
|---|---|
| `kaelio/ktx` | **非本仓库责任**；不 push、不发 `@kaelio/ktx` 新版本 |
| 契约承载 | **Lucy MCP Proxy** 对 bundled KTX `0.16.0` 做适配 |
| proven | Gate C 已总签（2026-08-09）；默认仍 `false`，置真为运维变更 |

## 2. 结论

| 项 | 结果 |
|---|---|
| 字段名 | Proxy 注入 `forced_filters`（审计 / 前向兼容） |
| Bundled KTX 实际生效路径 | 同步把已绑定谓词编译为 **parenthesized** filter 表达式，**prepend** 到上游 `filters[]`（KTX 对 filters 做 AND） |
| field 安全 | 仅来自 Lucy 编译期已绑定的 `source.column`；unsafe 片段拒绝 emit |
| 用户旁路 | 受保护源上 Proxy 禁止字符串 filters / OR 布尔树（既有 shape gate） |
| BY-01 自动化 | `mcp-proxy-row-policy-by01-by18` + `row-policy-ac-p1`（注入 `forced_filters` + `filters` 含强制谓词） |

## 3. 实现指针

| 位置 | 作用 |
|---|---|
| `webui/server/proxy/row-policy.ts` → `compileForcedFiltersToUpstreamFilterExprs` | 安全编译 |
| `webui/server/proxy/row-policy.ts` → `applyLucyQueryForcedFilters` | 剥离伪造字段；写 `forced_filters`；prepend `filters` |
| `webui/server/proxy/mcp-proxy.ts` → `lucy_query` → `sl_query` | 改写上游 |
| 测试 | `row-policy-ac-p1.test.ts`（BY-05 / unsafe field）；`mcp-proxy-row-policy-by01-by18.test.ts`（wire + 行集） |

## 4. 与 ADR 路径 A 的关系

- ADR 要求专用强制字段 + 外层 AND。Lucy 在 **本进程**同时发出 `forced_filters` 与强制 `filters` 前缀。
- Bundled `@kaelio/ktx@0.16.0` MCP schema **会丢弃未知键** `forced_filters`；因此 **安全边界是 Lucy 写入的 `filters[]` 前缀 + 受保护源 shape gate**，不是上游特权字段实现。
- 若未来上游原生支持 `forced_filters`，可去掉 filters 双写而不改 ACL 编译模型；在此之前 **不**要求 Kaelio 发版。

## 5. 复现

```bash
cd webui
npm test -- --run row-policy-ac-p1 mcp-proxy-row-policy-by01-by18
```

Docker/集成真实行集抽检（临时 proven=true，事后已关）：见 [`inbox/20260809-ac-p1-by01-uat/09-process-and-signoff.md`](../../inbox/20260809-ac-p1-by01-uat/09-process-and-signoff.md)。

## 6. 非目标

- 向 `kaelio/ktx` 提交 / 发布 npm
- 自动在所有环境置 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN=true`（须运维变更）
- 宣称 Dynamic RLS / DB 原生 RLS

— 完
