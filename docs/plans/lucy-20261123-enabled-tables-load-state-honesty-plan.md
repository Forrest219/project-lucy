# 启用表范围表清单三态诚实展示 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划／**v1.0** |
| 日期 / 功能编号 | 2026-11-23／P1-80／REQ-030-101 |
| 阶段 | S5 |
| 收口范围 | SC-01–SC-07；单测 SC-01–SC-05；测试台 R0／01–05 PASS；浏览器 E1–E9。不含干净发布镜像封存冒烟、手动重试点击演练、前台混合态单独演练 |
| 状态 | S5｜v1.0；功能合同已收口（2026-11-23）。证据＝[收口记录](../reviews/2026-11-23-p180-s5-closure-record.md)＋[浏览器证据](../reviews/2026-11-23-p180-enabled-tables-browser-evidence.md)＋测试台 PASS。委托人批复可收口、不返工；≠ 可上线 |
| 授权边界 | 终稿已确权；开发授权已获得。阶段 0–3 已完成；功能合同已收口 |
| 验收 | [Spec](../specs/lucy-20261123-enabled-tables-load-state-honesty-spec.md) SC-01–SC-07 |
| 关联 | [Spec](../specs/lucy-20261123-enabled-tables-load-state-honesty-spec.md) · [总账 P1-80](lucy-20261107-lucy-0-30-feature-inventory-pool.md) |

## 目标

消除启用表范围页将 `/tables` **未就绪／失败**误判为「扫描为空」从而误报「缺少 Manifest／无效启用」的事故路径；成功空表仍保留既有缺 Manifest 语义。

## 开工前置

1. Spec 终稿确权（Codex CLI 终审或委托人明示）。
2. 开发授权（本 Plan）。
3. OQ-1／OQ-2 若未闭合，采用 Spec 默认建议。

## 实施阶段

### 阶段 0 · 失败单测钉死（SC-01–SC-05）

- 在 `webui/src/__tests__/table-whitelist.test.tsx`（或紧邻新文件）增加：
  - pending：tables handler 永不 resolve；断言无「缺少 Manifest」汇总、无「无效启用」、有加载文案。
  - error：tables 500／`ok:false`；断言失败文案；「移出无效启用」禁用或不可见。
  - empty success：`tables: []`；允许缺 Manifest／无效启用。
  - healthy non-empty：沿用夹具，无假阳性。
  - 双连接混合（SC-05）。
- **先红后绿**：在改 `TableWhitelist.tsx` 前提交／保留失败断言（实现波次内）。

### 阶段 1 · 页面分流（C1–C3）

- 修改 `webui/src/pages/connections/TableWhitelist.tsx`：
  - 停止「`tablesData?.tables ?? []` 且当作已扫描」的合并语义。
  - 按连接读取 `isPending`／`isError`／`isSuccess`（或等价）分支。
  - 页级缺 Manifest 横幅与「移出无效启用」按 Spec C2／C3。
- 文案对齐术语标准（或 Spec Terminology 定稿表）；`translate="no"` 规则不变。

### 阶段 2 · 回归与 demo 冒烟（SC-04／SC-06／SC-07）

- 跑既有 `table-whitelist*.test.tsx` 全绿＋新用例。
- Docker demo：真实前台浏览器对 A／B／C 注入复现（可复用调查方法）；健康刷新对照；**禁止**点「移出无效启用」。
- 页面计时与 API 耗时分列记录（inbox 或 UAT 跑次，测试台挂套另授权时再迁 INDEX）。

### 阶段 3 · 登记镜像

- Spec／Plan／总账／REQ／`docs/README.md`／`docs/plans/README.md` 状态同句；术语标准若新增行则同批。

## 回滚

纯前端展示分支；回滚＝还原 `TableWhitelist`＋相关单测 diff；无数据迁移、无配置格式变更。

## 不做

不修 BUSY／首页超时；不改 tables API 扫描实现（除非 Plan 修订明示）；不改保存链；不挂本条为 0.30 核心分母。

## 浏览器验证

- 路由：/connections/enabled-tables
- 视口：1920×1080
- 状态：E1、E2、E3、E4、E5、E6、E7、E8、E9
- 证据：docs/reviews/2026-11-23-p180-enabled-tables-browser-evidence.md

## 完成定义

- SC-01–SC-07 通过；无假阳性 loading／error。
- **已达成**：功能合同已收口（2026-11-23）；本条收口 ≠ 可上线。
