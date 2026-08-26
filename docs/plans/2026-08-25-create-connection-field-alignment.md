# 新建连接两列表单对齐 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

| 元数据 | 内容 |
|---|---|
| 文档名称 | 新建连接两列表单对齐 |
| 文档类型 | Design |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-25 |
| 撰写人 | Cursor Grok 4.6 |
| 委托人 | xingchen |
| 基于材料 | `http://127.0.0.1:55176/connections` 浏览器实测；用户截图；`webui/src/components/CreateConnectionDrawer.tsx`；既有 subgrid 先例 `webui/src/app/app.css` `.pl-ops-grid` |
| 适用范围 | 只修「新建连接」输入步两列单元格对齐；不改保存/测试连接语义 |
| 输出位置 | `docs/plans/2026-08-25-create-connection-field-alignment.md` |

**Goal:** 新建连接抽屉里每一行两列表单的标签顶边、控件顶边、控件高度对齐；一侧有 hint/error 时另一侧控件不再被撑高或上移。

**Architecture:** 不要再用 `items-start` / `items-end` 去“补”不对称 hint。外层两列改成 3 行轨道（标签 / 控件 / 说明），`Field` 用 CSS subgrid 跨这 3 行，让两列共享行高。仓库里 `.pl-ops-grid` 已经用过同一手法。

**Tech Stack:** React + Tailwind 工具类 + `webui/src/app/app.css` 局部 class；Vitest + Testing Library；浏览器目测。

---

## 核实结论（2026-08-25，抽屉宽 576px / 视口 1920）

按约束本轮**只核实、只更新本计划，未改业务代码**。复测与计划一致，并补上「点下一步」后的主机/端口态。

没有对齐 CSS 补丁。更严重的观感来自两列重排：不对称 hint/error 碰上 `Field` 默认 `display:grid` + `align-items:stretch`。

### 默认空表（未点下一步）

| 两列 | 标签顶边差 | 控件顶边差 | 控件高度差 | 判定 |
|---|---|---|---|---|
| 驱动 \| 只读账号意图 | 0 | **-11.8px**（checkbox 相对 select） | 24.3px（37.3 vs 13） | 控件类型不同，视觉空一截 |
| 主机 \| 端口 | 0 | **0** | 0 | 两侧都无 hint/error，**此时对齐** |
| 用户名 \| 数据库密码 | 0（文字顶边同） | **+11px**（用户名更低） | **+11px**（用户名 49 vs 密码 38） | **默认主伤**。用户名 label 盒 31px、input 49px；密码 20+38+16 |

### 空表点「下一步」（2026-08-25 复测）

| 两列 | 控件顶边差 | 控件高度 | 判定 |
|---|---|---|---|
| 主机（有「必填」）\| 端口（无说明） | **-11px**（端口更低） | 主机 38 / **端口 49** | 截图里主机/端口对不齐是真的，发生在**一侧出红字**时，不是错觉 |
| 用户名（必填）\| 密码（必填） | **0** | 两侧都是 38 | 两侧都是 3 行时反而齐 |

根因：外层 `grid-cols-2` 把两个 `Field` 拉成同高；内层 `label.grid` 把多出来的高度摊到每一行。有 hint/error 的一侧 3 行（20+38+16）；没有的一侧 2 行被摊成 31+49。哪一侧缺说明行，哪一侧的 input 就被拉高、下移。

禁止方案（会更糟）：

- **`items-end`**：矮的那一列整块沉底 → 标签和输入一起错位（端口/密码看起来“飞上去”）。这就是“修完更严重”的典型结果。
- **只加 `items-start` / `content-start`、不占住说明行**：输入能对齐，但单元格底边锯齿更明显，用户说的「单元格对不齐」仍在。
- **给用户名补一句假 hint**：文案噪音，校验后一侧变 error 仍会再次拉伸。

## Non-Goals

- 不改测试连接是否可选、不改保存语义。
- 不把 `Field` 抽成全站 Form 组件（只动本抽屉）。
- 不改主机/端口宽度比、不做窄屏专项。
- 不 `git commit`，除非用户当场要求。

---

### Task 1: 锁住错误对齐（回归断言）

**Files:**

- Modify: `webui/src/__tests__/create-connection-drawer.test.tsx`
- Modify: `webui/src/__tests__/create-connection-drawer.test.tsx` 可顺带读 `app.css`（同 wiki 测 subgrid 的写法）

**Step 1: 写失败测试**

在 `CreateConnectionDrawer` describe 里加两条（jsdom 量不到真实 px，只锁结构与 CSS）：

```tsx
it("keeps paired fields on a shared 3-row subgrid", () => {
  renderDrawer();
  const pair = screen.getByTestId("create-connection-username").closest(
    ".pl-connection-field-pair"
  );
  expect(pair).not.toBeNull();
  expect(pair?.querySelectorAll(":scope > .pl-connection-field--pair")).toHaveLength(2);
  const userField = screen.getByTestId("create-connection-username").closest(
    ".pl-connection-field--pair"
  );
  expect(userField?.querySelector(".pl-connection-field-message")).toBeInTheDocument();
});

it("reserves a message row even when username has no hint", () => {
  renderDrawer();
  const userField = screen.getByTestId("create-connection-username").closest("label");
  const passField = screen.getByTestId("create-connection-password").closest("label");
  expect(userField?.querySelector(".pl-connection-field-message")?.textContent ?? "").toBe("");
  expect(passField?.querySelector(".pl-connection-field-message")?.textContent).toContain(
    "仅本次提交使用"
  );
});
```

再加一条 CSS 契约（抄 `wiki.test.tsx` 读 css 文本的方式）：

```tsx
it("uses subgrid for connection field pairs", async () => {
  const css = await import("../app/app.css?raw");
  const text = typeof css === "string" ? css : (css as { default: string }).default;
  expect(text).toMatch(/\.pl-connection-field-pair\s*\{[^}]*grid-template-rows:\s*auto\s+auto\s+auto/s);
  expect(text).toMatch(/\.pl-connection-field--pair\s*\{[^}]*grid-template-rows:\s*subgrid/s);
});
```

若 Vite 的 `?raw` 在本仓库 Vitest 不可用，改成 `readFileSync` 读 `webui/src/app/app.css`（`wiki.test.tsx` 已有同类读文件断言）。

**Step 2: 跑测试确认先失败**

Run:

```bash
cd webui && npx vitest run src/__tests__/create-connection-drawer.test.tsx
```

Expected: 新用例 FAIL（还没有 `.pl-connection-field-pair`）。

---

### Task 2: CSS — 两列共享标签/控件/说明三行

**Files:**

- Modify: `webui/src/app/app.css`（放在 `.pl-drawer-body` 附近，不要塞进 `@media` onboarding 块）

**Step 3: 写入下列 class（完整，按此粘贴）**

```css
  /* 新建连接：两列 Field 共享标签 / 控件 / 说明行轨，避免一侧 hint 把另一侧 input 拉高。 */
  .pl-connection-field-pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto auto;
    column-gap: 0.75rem; /* gap-3 */
    row-gap: 0.375rem;   /* gap-1.5 */
  }
  .pl-connection-field {
    display: grid;
    gap: 0.375rem;
    font-size: 0.875rem;
  }
  .pl-connection-field--pair {
    display: grid;
    grid-template-rows: subgrid;
    grid-row: span 3;
    gap: 0; /* 行距由 pair 的 row-gap 统一，避免双计 */
    min-width: 0;
  }
  .pl-connection-field-control {
    display: flex;
    min-height: 38px;
    align-items: center;
  }
  .pl-connection-field-control > .pl-input,
  .pl-connection-field-control > select.pl-input {
    height: 38px;
    min-height: 38px;
  }
  .pl-connection-field-message {
    min-height: 1rem;
    font-size: 0.75rem;
  }
```

说明：`min-height: 1rem` 让没有 hint 的一侧仍占第三轨；有 hint 时该行变高，**两列一起变高**（subgrid），控件行高度不变。

**Step 4: 不要改** `.pl-input:focus` 的 `ring-2`。焦点环是描边，修齐 layout 后它不应再带动邻居。

---

### Task 3: Field + 四组两列改用 pair

**Files:**

- Modify: `webui/src/components/CreateConnectionDrawer.tsx`（约 378–524 的四组 `grid grid-cols-2`，以及底部 `Field`）

**Step 5: 替换本地 `Field`，并加 `FieldPair`**

```tsx
function FieldPair({ children }: { children: ReactNode }) {
  return <div className="pl-connection-field-pair">{children}</div>;
}

function Field({
  label,
  children,
  error,
  hint,
  pair = false
}: {
  label: string;
  children: ReactNode;
  error?: string | null;
  hint?: string;
  pair?: boolean;
}) {
  const message = error ? (
    <span className="text-danger">{error}</span>
  ) : hint ? (
    <span className="text-fg-muted notranslate" translate="no">
      {hint}
    </span>
  ) : null;
  return (
    <label className={pair ? "pl-connection-field pl-connection-field--pair" : "pl-connection-field"}>
      <span>{label}</span>
      <div className="pl-connection-field-control">{children}</div>
      <span className="pl-connection-field-message">{message}</span>
    </label>
  );
}
```

要点：

- **永远渲染** `.pl-connection-field-message`（空也要有节点），这样 subgrid 第三行稳定存在。
- 全宽字段（连接 ID / 数据库 / 初始 Schema）走 `pair={false}`，自己 `gap-1.5`，不进 subgrid。
- 两列里每个 `Field` 传 `pair`。

**Step 6: 四处 `grid grid-cols-2 gap-3` 换成 `FieldPair`**

1. 驱动 + 只读：只读侧去掉 `h-[38px]`（高度改由 `.pl-connection-field-control` 负责），checkbox 仍 `flex items-center gap-2`。
2. 主机 + 端口：`pair`。
3. 用户名 + 密码：`pair`；密码的 `relative` 包层保留在 control 槽里。
4. 高级配置里引擎 + 传输协议：`pair`（两侧都有 hint，现在碰巧齐；改完防止以后一侧删 hint 再裂）。

驱动/只读不要拆成两行，也不要换成 Switch。subgrid 后标签在同一行轨，checkbox 在 38px 控件槽里垂直居中，这是可接受的「控件形态不同」，不是格子错位。

**Step 7: 再跑测试**

```bash
cd webui && npx vitest run src/__tests__/create-connection-drawer.test.tsx
```

Expected: PASS。顺手：

```bash
cd webui && npm run lint:terminology
```

---

### Task 4: 浏览器验收（本任务明确要求）

**Step 8: 打开** `http://127.0.0.1:55176/connections` → 新建连接，默认空表。

用 CDP `getBoundingClientRect` 验收，阈值 **≤1px**（select 可能仍有亚像素）：

- 默认空表：用户名 vs 密码的 `label.y`、`input.y`、`input.height` 对齐（今日默认差 11px，修完须 ≤1px）。
- 默认空表：主机 vs 端口保持 0。
- 空表点「下一步」：主机有红字、端口没有时，两列 input 的 `y`/`height` 仍对齐（今日端口会被拉成 49px、下移 11px）。
- 驱动 vs 只读：`label.y` 对齐；只读 **控件槽**（`.pl-connection-field-control`）与 select 的 `y`/`height` 对齐（checkbox 方块本身仍小于 38px，这是预期）。
- 点「下一步」只让密码出红字、用户名已填：两列 input 的 `y`/`height` 仍对齐（第三行变高但控件行不动）。
- 聚焦用户名：`ring-2` 可以 outwardly 变大，**未聚焦**密码的 layout `y` 不得跟着变。

失败判据：再出现「无 hint 一侧 input 变成 49px」或「有 hint 一侧整列上移」。

---

## 验收标准

- 默认态与「一侧 error、一侧没有」两种态，两列标签顶边、输入顶边、输入高度对齐（≤1px）。
- 主机/端口不被「修」出新的错位。
- 既有创建/预览/测试连接单测仍过。
- 不引入 `items-end`。
