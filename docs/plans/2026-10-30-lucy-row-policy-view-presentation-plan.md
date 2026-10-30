# 行权限视图呈现修订实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.1** / 2026-10-30 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P1**。功能编号待 PM 指派 |
| 主 Spec | [行权限视图呈现修订 Spec](../specs/lucy-20261030-row-policy-view-presentation-spec.md)（**v0.1 待审阅**） |
| 权威语义 | [行策略模板与行权限视图 Spec](../specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md) §6.2、RTV-01–RTV-08。本 Plan 不改行授权代数，不改深链参数名 |
| 状态 | **待审阅**。S1–S4 未开始 |
| 授权边界 | 只交付本 Plan 与主 Spec。**不授权**改页面、改清单响应、改父 Spec §6.2、构建镜像或部署 |
| 验收 | SC-01–SC-18 未执行 |
| 实施主体 | Lucy WebUI。清单类型与 `listRowPolicyTables` 只在 D8 通过时增加 `grantStatus`。不修改 KTX |
| 待拍板 | **D1**（点表不收窄清单）与 **D3**（改筛选不关闭当前表）。D8、D10 可单独否决 |

---

## 1. 目标

让 `/admin/row-policies` 先展示当前筛选下的表，点表只打开详情。筛选框与地址栏一致。结论、角色、Agent 按这个顺序阅读。空筛选、无授权、编译失败和快照不可用继续各说各的话。

四个交付物：

1. **URL 拆分**：当前表三参数与 `list*` 筛选分开。深链仍打开详情。
2. **页壳**：一句描述、secondary 模板按钮、折叠快照、带标签的筛选和分段「仅受限表」。
3. **清单与详情**：网格、选中行、`grantStatus`、角色分组、统一 Agent 句、授权摘要链接。
4. **登记**：审阅通过后在父 Spec §6.2 加交叉引用。新 test id 写入选择器契约。

实施原则：

- 既有 `row-policy-view-*` test id 保持可找到。
- `RowPolicyDnfPreview` 的新 prop 都有默认值，角色编辑页的调用处不改行为。
- 不新增运行时依赖，不新增裸十六进制颜色。
- 文本筛选遵守 URL 镜像字段，不用 `defaultValue`。

## 2. 开工前置

### S0 审阅（当前阶段）

开工前要有书面拍板，至少覆盖：

| ID | 要拍板的句子 |
|---|---|
| D1 | 点表只写当前表三参数，清单请求默认不带它们 |
| D2 | 清单筛选改用 `listConnectionId` / `listSchema` / `listSourceName` |
| D3 | 改清单筛选不删除当前表 |
| D4 | 筛选可见值走 `useUrlMirroredField`，原文进 URL |
| D5 | 连接和 Schema 用下拉，选项来自不带筛选的清单 |
| D6 | 「空筛选」文案不改，只加「清除筛选」 |
| D7 | 哈希默认折叠，模板按钮改为 secondary |
| D8 | 清单增加 `grantStatus`，不逐表读目录 |
| D9 | 没有模板也没有内联条件时不显示「仅直接写条件」 |
| D10 | 详情顺序改为结论、角色、Agent；全体为全部行时 Agent 默认可折叠 |

D1 被否决时，S1 只实施 D3：停止在改筛选时删除 `sourceName`，并改掉 `defaultValue`。点表仍收窄清单。D8 被否决时，S2 不改 `row-policy-views.ts`。D10 被否决时，S3 不重排详情、不折叠 Agent。S0 通过前不改 `webui/src` 与 `webui/server`。

## 3. 文件落点

### 3.1 修改

| 路径 | 改动 | 阶段 |
|---|---|---|
| `webui/src/pages/admin/RowPolicyView.tsx` | URL 拆分、筛选、页头、清单、详情顺序、分组、链接 | S1–S3 |
| `webui/src/components/admin/RowPolicyDnfPreview.tsx` | 可选 `boundaryPlacement`、`children`、`collapseUniformAllRows`、`predicateLayout`。默认保持今天 | S3 |
| `webui/src/components/admin/RowPolicyStateBadge.tsx` | 快照改为 `<details>`，默认关闭。字段与 test id 保留 | S1 |
| `webui/server/admin/row-policy-views.ts` | D8 通过时给清单行增加 `grantStatus` | S2 |
| `webui/src/__tests__/row-policy-view.test.tsx` | 改「预置筛选」断言；补 SC-01–SC-07、SC-16 | S1 |
| `webui/src/__tests__/row-policy-dnf-preview.test.tsx` | 默认行为不变；补折叠与 footnote 的可选 prop | S3 |
| `webui/server/__tests__/p1-row-policy-views.test.ts` | D8 通过时断言四态 `grantStatus` | S2 |
| `docs/qa/selector-contract.md` | 补本 Plan 新增的 test id | S4 |
| `docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md` | §6.2 末尾交叉引用本 Spec | S4 |

### 3.2 不改

- `rowPolicyViewUrlForTable()` 与授权摘要测试里的三参数断言。
- `rowPolicyAuthoringMode()` 的默认返回值。页面在两侧皆空时不调用徽章。
- 角色编辑页对 `RowPolicyDnfPreview` 的调用参数。
- 模板管理页。模板名在本页仍是文本，不发明模板深链。
- KTX、Helm、镜像、术语标准、系统手册。

新增 test id 只使用这些名字：`row-policy-view-clear-filters`、`row-policy-view-outside-filter`、`row-policy-view-copy-identity`、`row-policy-view-agent-uniform`、`row-policy-view-agent-expand`。

## 4. 分阶段实施

### S1 筛选与页壳（D1–D7）

1. 把当前表读取和清单筛选读取拆开。点表与深链只走当前表。
2. 五个筛选改接 `useUrlMirroredField`。下拉的空选项不写参数。
3. 清单请求按 Spec §6 的 `listRequest` 映射。选项请求单独一个 query key，不带筛选。
4. 页头、分段控件、清除筛选、只读提示、折叠快照按 Spec §5.1。
5. 改掉「深链预置三个筛选框」的测试，改为 SC-02。

**出口**：SC-01–SC-07、SC-13 的页头部分。

### S2 清单网格与授予列（D8）

1. 表格换上 `pl-data-grid` / `pl-data-table` 与外框。主列、次行、`aria-label`、`aria-current`。
2. D8 通过时，在 `listRowPolicyTables` 写入 `grantStatus`，单元格按 Spec §5.3。
3. D8 否决时，单元格继续用现有 `describeGrant`，不新增字段。

**出口**：SC-07、SC-08。

### S3 详情阅读顺序（D9、D10）

1. 目录机器值改成中文标签，`data-catalog-status` 保留。
2. 复制按钮调用 `copyTextWithToast`。
3. D9：两侧皆空不渲染徽章。
4. D10 通过时，给预览组件加可选 prop，本页按结论、角色、Agent 组装。全体 `all` 才显示统一句。
5. 授权摘要链接按 Spec §5.4。当前表不在清单里时显示脱离筛选说明。

**出口**：SC-09–SC-12、SC-14–SC-17。

### S4 登记与回归

1. 父 Spec §6.2 末尾增加交叉引用。判定表、RTV、深链参数名不动。
2. 把新 test id 写入 `docs/qa/selector-contract.md`。
3. 跑 `webui` 下行权限视图、DNF 预览、清单视图相关单测，以及 `npm run lint:terminology`。
4. 把主 Spec 与本 Plan 的状态从「待审阅」改为「已落地，SC 待验收」，并写明哪些 SC 有自动化证据。

**出口**：SC-15、SC-18。S4 不把「测试绿了」写成验收通过。

## 5. 验收

验收正文是主 Spec §7 的 SC-01–SC-18。本 Plan 不另起编号。

证据要求：

- SC-01–SC-07、SC-10、SC-11、SC-13、SC-16 落在 `webui/src/__tests__/row-policy-view.test.tsx`。
- SC-08 在 D8 通过时同时落在服务端 `p1-row-policy-views.test.ts` 与页面测试。D8 否决时，页面测试改为断言今天的三态文案，并在状态句里记「SC-08 按否决路径关闭」。
- SC-09、SC-12、SC-17 落在 DNF 预览测试与页面测试。默认 prop 的现有断言保持通过。
- SC-14 断言 `copyTextWithToast` 被以三元组调用。jsdom 不要求真实剪贴板成功。
- SC-15 以选择器契约里原有 id 仍出现在 `RowPolicyView.tsx` 为准，并断言页面没有「保存」「删除」「预演」。
- SC-18 以 `npm run lint:terminology` 退出码 0 为准。
- 浏览器点击验收不在本 Plan 的默认范围内。若审阅把某条 SC 改成必须真浏览器，再单列，不默认补 Playwright。

## 6. 完成定义

同时满足才算本 Plan 做完：

1. S0 的十条决策有拍板记录，否决项写明了退路。
2. 获批的 S1–S3 代码与测试在仓库里，且对应 SC 有断言。
3. 父 Spec §6.2 已加上交叉引用，RTV 表未改。
4. 新增 test id 已写入选择器契约。原有 `row-policy-view-*` id 仍在。
5. SC-18 已跑过。
6. 主 Spec 与本 Plan 的状态句已更新。
7. `rowPolicyViewUrlForTable()` 的查询字符串仍是 `connectionId`、`schema`、`sourceName`。

## 7. 风险

| 风险 | 表现 | 对策 |
|---|---|---|
| 深链测试把三参数又写回筛选框 | SC-02 被旧断言拉回「点表即筛选」 | S1 先改这条测试，再改交互 |
| `list*` 映射时把当前表也带进清单 | 点表后清单仍只剩一行 | SC-01 同时看详情 URL 与清单 URL |
| 镜像字段用 `trim` 写回 URL | 输入法与末尾空格被吃掉 | SC-04 断言 URL 保留原文 |
| D8 把无授权和编译失败写成同一个 `null` | 清单再次出现「—」 | `grantStatus` 在 `ok: false` 时按 reason 分叉，SC-08 覆盖两支 |
| 折叠 Agent 被做成默认 prop | 角色编辑页的预览少了 Agent | 默认不折叠。SC-12 含未传 prop 的用例 |
| 空组仍渲染「仅直接写条件」 | 不授予该表的角色看起来像写了条件 | SC-10。不改 `rowPolicyAuthoringMode()`，只在调用处跳过 |
| 父 Spec 与本 Spec 同时声称清单列含目录 | 实现者去逐表打目录 | D8 否决路径明确不打目录。交叉引用写明目录留在详情 |

回滚：回退 S1–S3 的 WebUI 与清单字段提交即可恢复现行页面。不涉及数据迁移。`grantStatus` 是新增字段，旧页面忽略它。

## 8. 落盘清单（本轮文档）

| # | 结果 |
|---|---|
| 1 | Spec：`docs/specs/lucy-20261030-row-policy-view-presentation-spec.md`。Plan：本文件 |
| 2 | Spec §6 有核心流程（伪代码） |
| 3 | 两份文首元数据含状态、版本；Plan 另含授权边界与验收 |
| 4 | 本 Plan 含目标、开工前置、验收、完成定义、风险 |
| 5 | Spec 的 Terminology Compliance 含 `This feature follows` 与 `New terms:` |
| 6 | Spec 的 Design System Compliance 含四段模板 |
| 7 | `docs/README.md` 与 `docs/plans/README.md` 已登记 |
| 8 | 无新命令、无新 CI |
| 9 | 功能编号待 PM 指派 |
| 10 | 落盘后跑 `npm run lint:spec-docs`。未跟踪草稿只产生 WARN；提交前须无本文件的形态违规 |
