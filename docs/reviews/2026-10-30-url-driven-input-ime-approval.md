# URL 驱动输入法组合中断 — 审批记录

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-10-30 |
| 对象 | [Spec](../specs/lucy-20261029-url-driven-input-ime-composition-spec.md) v0.1-draft → **v1.0**；[Plan](../plans/2026-10-29-lucy-url-driven-input-ime-composition-plan.md) v0.1 → **v1.0** |
| 授权 | 用户授权审批并定稿 |
| 结论 | **通过，已定稿。** D1–D6 按原稿推荐项拍板，并修正一处会把缺陷带回来的同步协议 |
| 实施 | 设计已批准，可按 Plan S1–S7 开工。SC-01–SC-23 全部未执行。不授权镜像、部署或客户交付 |

## 核对

对照当时工作树，§2.1 的 13 处行号、`clearFilters`（`Audit.tsx:1693`）、C-1（`AuditReconciliation.tsx:313`）、C-2（`CaseEditor.tsx:291`）都还在。Release workflow 里跑 `lint:terminology` 的 job 是 `spec-and-webui`（约第 96 行），不是 v0.1 Plan 写的第 68 行或 `spec-and-unit`。

## 裁定

| 编号 | 裁定 |
|---|---|
| D1 | (a) 局部状态镜像 |
| D2 | 13 处全量，门禁不留白名单 |
| D3 | 静态门禁为主，真浏览器探针不进 CI |
| D4 | 每次按键即写 URL。Audit / 配置审计 / Token / 发布历史保持 push；目录保持 `replace: true` |
| D5 | 同批修 C-1、C-2 |
| D6 | `99-governance.md` 记临时决策，并新增 `14-components-filter-input.md` |
| 编号 | 不另派 L25。这是修订线缺陷修复，不进 2.5 功能台账 |

## 定稿时改掉的设计缺口

1. **回声会打断输入法。** v0.1 在 URL 变化时无条件 `setDraft(urlValue)`。连续按键时，较早的 `"z"` 可能在草稿已经是 `"zh"` 之后才落地，React 会在组合中改 `node.value`。v1.0 的 §5.3 把自身回声、晚到的旧值和真正的外部导航分开。`HelpCenter` 的无条件 effect 只说明形状，不能照抄。验收补了 SC-22。
2. **写 URL 时的 trim 也会打回输入框。** 统一搜索（`Audit.tsx:1564`）和目录 `q`（`Catalog.tsx:265`）现在先 trim 再写入。镜像后如果 URL 是 trim 过的，反向同步会抹掉用户刚打的空格。v1.0 要求 URL 与输入框保存原文，查询消费点再 trim。验收为 SC-23。
3. **Token 搜索框复用了下拉框哨兵。** `Tokens.tsx:54` 把 `"all"` 当成清空。搜索框若继续走这条路径，键入 all 会被删参并抹空。文本 `all` 必须留下；下拉框哨兵不动。
4. **七个字段不能各自拿渲染期的 `searchParams` 快照去 `setSearchParams`。** hook 必须函数式更新，并提供 `reset`。清除筛选在参数原本为空时不会触发 effect，所以必须显式 `reset`。

## 未改的边界

URL 参数名与含义、后端 API、DOM 与文案、KTX 源码都不在本次修改里。Safari / Firefox 仍未实测；SC-17 的验收浏览器是 Chrome。jsdom 仍然不能充当 SC-17 的证据。
