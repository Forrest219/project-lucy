# 行权限视图表清单列密度 Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.1** / 2026-11-02 |
| 状态 | **功能合同已收口（2026-11-02）**。S1–S4 落地；SC-28–SC-29 组件测试关闭；SC-30 三档视口取证通过；`demo:upgrade` 已同步镜像。本条收口不表示可上线 |
| 主 Spec | [`docs/specs/lucy-20261030-row-policy-view-presentation-spec.md`](../specs/lucy-20261030-row-policy-view-presentation-spec.md) **§5.1 / §5.1.1 / SC-28–SC-30**（v0.6 增量；SC-01–SC-27 仍成立） |
| 权威语义 | 父 Spec §6.2、RTV；本 Plan **不改**行授权代数、深链、清单 API、右栏 §5.5 |
| 授权边界 | **已授权**按本文改 `RowPolicyView.tsx`（若 HEAD 已满足则只补测试／文档）、`row-policy-view.test.tsx`、主 Spec §7.1、本 Plan、索引；**已授权** `npm run demo:upgrade`（平滑，保留 volume）与 SC-30 三档 CSS 视口浏览器取证。**不授权**改 KTX、Helm、术语标准正文、移动窄屏专项、push（除非另授） |
| 验收 | SC-28–SC-30：**全部通过**（`row-policy-view.test.tsx` 41/41，含 SC-28／29；视口笔记 `inbox/row-policy-list-density-viewports/NOTES.md`） |

**Goal:** 表清单在双栏左轨上可读：计量列不逐字竖折；三档常用桌面视口优于当前 demo 压缩态。

**Architecture:** 方案 1——保持 `minmax(24rem,34rem)` 左轨；角色数／Agent 数／有效行授予 th+td 全 `whitespace-nowrap`；溢出只在 `pl-data-grid-scroll` 横滑。HEAD 已基本具备实现，本 Plan 以契约测试、镜像同步与视口取证收口。

**Tech Stack:** React + Vitest + demo compose + Cursor/IDE 浏览器视口仿真

## Global Constraints

- 不把左栏轨道加到超过 `34rem`
- 不改列集合与文案；不改右栏 §5.5
- 术语沿用既有表；`npm run lint:terminology` 必过
- SC-30 仅 §5.1.1 三档 CSS 视口，不做移动窄屏

---

## 1. 目标

1. Spec §5.1 与实现一致：`24–34rem` 轨道 + 计量列 nowrap。
2. SC-28／SC-29 有自动化断言。
3. demo 镜像含上述实现；SC-30 三档视口取证优于压缩态。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | 方案 1 与 Spec 增量路径 B 拍板 | **满足**（2026-11-02） |
| P2 | 主 Spec v0.6 §5.1／§5.1.1／SC-28–SC-30 已写入 | **满足**（与本文同次） |
| P3 | 「批准执行」 | **满足**（2026-11-02） |

## 3. 文件落点

| 路径 | 改动 |
|---|---|
| `webui/src/pages/admin/RowPolicyView.tsx` | 核对／必要时补齐轨道与 nowrap；仅当取证仍竖折时加表 `min-width` |
| `webui/src/__tests__/row-policy-view.test.tsx` | SC-28、SC-29 |
| 主 Spec §7.1／状态行 | 证据与收口镜像 |
| 本 Plan／`docs/README.md`／`docs/plans/README.md` | 状态索引 |
| `inbox/row-policy-list-density-viewports/` | SC-30 截图与度量笔记（tmp，可删） |

不改：`row-policy-views.ts`、DNF 组件默认、KTX、Helm。

## 4. 任务

### S1 — RED→GREEN：SC-28／SC-29 组件测试

- [x] **Step 1: 写失败测试**

在 `webui/src/__tests__/row-policy-view.test.tsx` 增加：

```tsx
it("SC-28 工作台左栏轨道为 24–34rem", async () => {
  renderView();
  await waitFor(() => expect(screen.getByTestId("row-policy-view-table-list")).toBeInTheDocument());
  expect(screen.getByTestId("row-policy-view-workspace").className).toContain(
    "xl:grid-cols-[minmax(24rem,34rem)_minmax(0,1fr)]"
  );
});

it("SC-29 计量列表头与单元格 nowrap", async () => {
  renderView();
  const list = await screen.findByTestId("row-policy-view-table-list");
  const headers = within(list).getAllByRole("columnheader");
  // 表 | 角色数 | Agent 数 | 有效行授予
  expect(headers[1].className).toContain("whitespace-nowrap");
  expect(headers[2].className).toContain("whitespace-nowrap");
  expect(headers[3].className).toContain("whitespace-nowrap");
  const row = screen.getByTestId("row-policy-view-table-warehouse-fin-fin_ledger");
  const cells = within(row).getAllByRole("cell");
  expect(cells[1].className).toContain("whitespace-nowrap");
  expect(cells[2].className).toContain("whitespace-nowrap");
  expect(cells[3].className).toContain("whitespace-nowrap");
});
```

（若默认 `renderView()` 的 mock 清单行 test id 不同，改用实际首行 `data-testid`。）

- [x] **Step 2: 跑测确认 / 实现核对**

```bash
cd webui && npx vitest run src/__tests__/row-policy-view.test.tsx -t "SC-28|SC-29"
```

若 RED 因实现缺失：把 workspace class 与 th/td `whitespace-nowrap` 补到 `RowPolicyView.tsx`（与 Spec §5.1 一致）。预期最终 PASS。

- [x] **Step 3: 全文件回归**

```bash
cd webui && npx vitest run src/__tests__/row-policy-view.test.tsx
```

预期：既有 SC + SC-28／SC-29 全绿。

### S2 — demo 平滑升级

- [x] **Step 1: 缓存重建并保留 volume**

```bash
BUILDPLATFORM=linux/arm64 npm run demo:upgrade
```

- [x] **Step 2: 健康与源码一致**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:55176/api/health
docker exec compose-lucy-1 grep -n "minmax(24rem,34rem)" /app/webui/src/pages/admin/RowPolicyView.tsx
```

预期：health `200`；容器源码含 `24rem,34rem`。WebUI：`http://127.0.0.1:55176/admin/row-policies`

### S3 — SC-30 三档视口取证

- [x] **Step 1: 登录后打开行权限视图**（凭据读本机 `lucywebui logi.txt`，回复不写密码）
- [x] **Step 2: 对 MBA13 `1440×900`、MBP14 `1512×982`、Ext1080 `1920×1080` 各测一档**

每档记录：`panelWidth`、各 th 高度／宽度、grant 单元格 `whiteSpace` 与高度；截图落到 `inbox/row-policy-list-density-viewports/`。

通过标准见主 Spec §5.1.1。若仍竖折：给表加 `min-width`（例如足以容纳四列固有宽），再重测，**不**加大 `34rem` 上限。

### S4 — 门禁与文档收口

- [x] `npm run lint:terminology`、`npm run lint:spec-docs`（本增量相关无新增阻塞）
- [x] 主 Spec 状态改为 v0.6 已落地；§7.1 填 SC-28–SC-30 证据；本 Plan／索引镜像同一句现值

## 5. 验收

| ID | 怎么验 |
|---|---|
| SC-28 | 页面组件测试 |
| SC-29 | 页面组件测试 |
| SC-30 | 三档视口浏览器度量 + 截图 |
| 术语 | `npm run lint:terminology` |
| 形态 | `npm run lint:spec-docs` |

## 6. 完成定义

- S1–S4 勾销；SC-28–SC-30 有通过记录
- demo WebUI 地址可打开且容器源码含 24–34rem
- 本条收口不表示可上线

## 7. 风险

| 风险 | 缓解 |
|---|---|
| demo 构建缓存未带上 HEAD | S2 校验容器源码字符串；失败则强制 recreate |
| jsdom 不跑真实布局 | SC-28／29 锁 class；真实可读性靠 SC-30 |
| 横滑被误判为失败 | Spec 明确允许横滑、禁止取消 nowrap |
