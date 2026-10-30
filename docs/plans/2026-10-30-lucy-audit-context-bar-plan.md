# 访问日志上下文条呈现实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | v1.0 / 2026-10-30 |
| 主 Spec | [访问日志上下文条呈现 Spec](../specs/lucy-20261030-audit-context-bar-spec.md)（v1.0） |
| 状态 | **v1.0 已实现，待审阅** |
| 授权边界 | 用户于 2026-10-30 授权落地本 Spec 的呈现修正，供审阅。不授权客户出包、不改审计 API |
| 验收 | SC-01–SC-08。自动化覆盖组件与访问日志页集成断言。浏览器复核以本次 demo 容器实际页面为准 |
| 已拍板决策 | D1–D6，见 Spec §3 |

## 1. 目标

让 `/admin/audit` 顶部上下文条按业务时区显示固定窗口，标签与数值分开，统计时间只出现一次，暂停操作看起来是按钮。字段合同与暂停冻结行为不变。

## 2. 开工前置

D1–D6 已由 Spec 冻结。无未决阻塞项。不另派 L25 编号。

## 3. 文件落点

| 路径 | 改动 |
|---|---|
| `webui/src/components/audit-trust/AuditTopMetaBar.tsx` | 时区格式化、字段分列、警告色作用在延迟数值上 |
| `webui/src/app/app.css` | 补 `pl-audit-top-meta-*` 样式，复用现有表面与文字 token |
| `webui/src/pages/admin/Audit.tsx` | 传入相对统计时间；去掉时间范围旁的重复统计时间；暂停按钮改为 secondary；口径说明不再两端对齐 |
| `webui/src/__tests__/audit-trust/audit-top-meta-bar.test.tsx` | SC-01–SC-05 |
| `webui/src/__tests__/audit-trust-page-integration.test.tsx` | SC-06、SC-07 |
| `webui/docs/00-product-terminology-standard.md` | §4.7「统计时间」的位置说明 |

## 4. 验收

按 Spec §5 的 SC-01–SC-08。组件测试断言格式与 DOM 分离；页面集成测试断言统计时间只出现一次，以及暂停后的 `data-state`。

## 5. 完成定义

- 上下文条可见正文不再把 ISO 8601 与时区名粘在标签上。
- 五个合同字段仍在。
- `cd webui && npx vitest run src/__tests__/audit-trust/audit-top-meta-bar.test.tsx src/__tests__/audit-trust-page-integration.test.tsx src/__tests__/admin-audit-turns.test.tsx` 通过。
- `npm run lint:spec-docs` 对本新增 Spec / Plan 无形态违规。

## 6. 风险

- 时区格式化依赖 `Intl`。无效时区名回退到运行时本地时区，避免整条崩溃。
- 组件测试原先断言可见正文包含原始 ISO。断言改为可见本地时间，原始 ISO 改在 `title` / `data-iso*`。
- 样式只作用于 `pl-audit-top-meta-*`，不给全局 `pl-status-warning` 补样式，避免连带改到采集范围徽章。
