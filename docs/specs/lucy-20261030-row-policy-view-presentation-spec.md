# 行权限视图呈现修订 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 呈现修订 / **v0.1 待审阅** |
| 日期 / 目标版本 | 2026-10-30 / 不绑定产品版本号。功能编号待 PM 指派，不占用 `L25-*`，不升父 Spec 版本号 |
| 功能编号 / 优先级 | **待 PM 指派** / **P1** |
| 状态 | **待审阅**。不授权改页面，不授权改清单响应，不授权改父 Spec §6.2 |
| 决策来源 | 2026-10-30 对 `http://127.0.0.1:55176/admin/row-policies` 的页面探查。12 张表的有效行授予都是「行权限：全部行」。点开 `superstore_orders` 后清单收成 1 行；再勾「仅看受限表」，地址栏丢掉 `sourceName`，表名框仍显示 `superstore_orders`，清单变成「空筛选」 |
| 需求来源 | 行权限视图要先回答「这张表实际受什么行约束」，再允许换一张表。筛选、选表、快照哈希不再挤在同一条阅读流里 |
| 实施主体 | Lucy WebUI 行权限视图（`webui/src/pages/admin/RowPolicyView.tsx` 与其直接使用的展示组件）。清单响应只增加 `grantStatus`。不修改 KTX，不修改行授权代数 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」：仓库级呈现修订落 `docs/specs/` |
| 与既有 Spec 的关系 | **修订父 Spec 的呈现，不修订其语义。** 权威仍是 [`docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md`](lucy-20261025-v0p25-row-policy-templates-and-view-spec.md) §6.2、RTV-01–RTV-08。深链参数名、只读、四种空态互斥、OR-of-AND 不拍平，沿用该文。本 Spec 获批后，父 Spec §6.2 加一行交叉引用，指向本 Spec §5 |
| 筛选输入 | 文本筛选遵守 [`docs/specs/lucy-20261029-url-driven-input-ime-composition-spec.md`](lucy-20261029-url-driven-input-ime-composition-spec.md) §5，使用 `useUrlMirroredField` |
| 实施计划 | [`docs/plans/2026-10-30-lucy-row-policy-view-presentation-plan.md`](../plans/2026-10-30-lucy-row-policy-view-presentation-plan.md) |

> v0.1 供审阅。D1–D10 在拍板前都是提议。拍板前，点表仍写入 `connectionId` / `schema` / `sourceName`，并把这三项同时当作清单筛选。

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. 不新增产品概念。沿用行权限视图、行策略模板、有效行授予、最终行约束、行权限：全部行、受限行授予、不授予该表、无授权、不可满足、编译失败、空筛选、快照不可用、授权摘要、角色权限、Agent、Schema。

控件文案（不登记为新术语）：

| 控件 | 文案 | 说明 |
|---|---|---|
| 页头描述 | 按表查看实际生效的行约束。 | 替换现在那句把任务和只读入口写在一起的长句 |
| 只读提示 | 本页只读。修改请到角色权限。 | 「角色权限」链到 `/admin/roles`。模板入口是页头按钮，不在这句里再写一遍 |
| 表范围 | 全部表 / 仅受限表 | URL 仍是缺省或 `restricted=true` |
| 清单计数 | {n} 张表 | 放在「表清单」标题旁 |
| 空筛选动作 | 清除筛选 | 只在清单筛选参数存在时出现 |
| 脱离筛选 | 当前表不在筛选结果中。 | 详情仍渲染 |
| 快照 | 快照 | 默认折叠。展开后仍是配置版本、策略版本、Source Map 版本、能力摘要 |
| 目录状态 | 目录已加载 / 目录不可用 / 目录能力未知 | 对应 `loaded` / `manifest_unavailable` / `catalog_capability_unknown`。机器值留在 `data-catalog-status` |
| 统一 Agent | 这 {n} 个 Agent 的最终行约束都是行权限：全部行。 | 仅当每个 Agent 的最终行约束都是 `all` |
| 复制 | 复制表身份 | 成功 toast「已复制表身份」。失败沿用 `CLIPBOARD_COPY_FAILED_MESSAGE` |

Forbidden terms:

- 把「空筛选」改成「未筛选」「暂无数据」或「无授权」。
- 编译失败的清单行显示「—」或「无授权」。
- 两个受限角色的并集显示「行权限：全部行」。
- 没有模板引用、也没有内联条件时显示「仅直接写条件」。
- 把 `loaded` 作为目录状态的可见主文案。
- 页头或导航使用「权限拓扑」「行级 RLS」。

`Agent`、`Schema`、连接 ID、表名、角色 id、模板名、能力摘要和机器原因在 DOM 上使用 `translate="no"` 与 `notranslate`。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/11-components-data-grid.md`
- `webui/docs/design-system/14-components-filter-input.md`
- `webui/docs/design-system/20-patterns-page-layout.md`

### What This Change Follows

- [ ] 页头可见主动作只有「行策略模板」一枚，使用 `pl-btn pl-btn--secondary`
- [ ] 「全部表 / 仅受限表」使用 `pl-segmented-control pl-segmented-control--cols-2`，选中态不用 `primary`
- [ ] 清单使用 `pl-data-grid pl-data-table`，外框为 `pl-data-grid-frame` 与 `pl-data-grid-scroll`，并带 `min-w-0 max-w-full`
- [ ] 选中行用 `bg-bg-muted` 与 `aria-current="true"`，不新增颜色
- [ ] 文本筛选的 `value` 来自 `useUrlMirroredField`，不把 `searchParams` 直接绑到 `value`
- [ ] 筛选标签在控件上方，不用 placeholder 充当唯一标签
- [ ] 复制使用 `pl-icon-btn`，`aria-label` 为「复制表身份」
- [ ] 状态同时有文字。不新增硬编码色值
- [ ] 不做窄屏重排。宽表只在网格滚动层内横向滚动

### Exceptions (If Any)

- 父 Spec §6.2 写清单列包含「目录／编译状态」。本 Spec 不在清单上逐表请求目录。编译结果来自清单接口已经算过的并集，目录状态留在单表详情。这是 D8，可单独否决。

### Follow-up Needed

- 审阅通过后，在父 Spec §6.2 末尾加一句：呈现以本 Spec §5 为准，语义仍以该节前文和 RTV 为准。
- 不新增设计系统章节。不改术语标准正文。`New terms: None` 成立。

---

## 1. 背景

父 Spec §6.2 把这一页定义成按表反查的只读视图。现行实现把三件事写成了同一个 URL：

1. 清单筛选 `connectionId` / `schema` / `sourceName`。
2. 当前表，也是这三个参数。三者齐全才请求单表详情。
3. `rowPolicyViewUrlForTable()` 发出的深链，参数名必须仍是这三个。

由此出现两处读数错误：

- 点表名会把清单筛选写成这张表，清单从 12 行变成 1 行。
- `updateFilter` 在修改连接、Schema、角色、Agent 或「仅看受限表」时删除 `sourceName`。输入框使用 `defaultValue`，地址栏已经丢掉表名，框里仍显示旧表名。

页头把四段完整哈希放在标题右侧，说明被挤断。清单没有网格、没有选中态，有效行授予在授予为 `null` 时显示「—」。详情把「仅直接写条件」贴在每一个角色上，包括不授予该表、也没有条件的角色。并集说明挡在结论前面。三个最终行约束同为「行权限：全部行」的 Agent 各抄一遍。

## 2. 目标

1. 点一张表只打开详情，清单保持当前筛选下的全部行，当前行高亮。
2. 深链 `connectionId` + `schema` + `sourceName` 仍打开这张表的详情。这三个参数不再写入清单请求。
3. 清单筛选使用另一组参数，改筛选不关闭当前表。
4. 筛选框的可见值与地址栏一致。
5. 阅读顺序为：页头 → 筛选 → 清单 → 结论 → 角色 → Agent。
6. 空筛选、无授权、不可满足、编译失败、快照不可用继续用各自的句子和徽章。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 改行授权代数、DNF 合并、模板 dry-run、运行时确认 | 父 Spec 与 P0-2 的语义不动 |
| 改 `rowPolicyViewUrlForTable()` 的参数名 | RTV-04 / 授权摘要深链已经对准这三个名字 |
| 在本页编辑角色、模板或条件 | 父 Spec P1-D5：本页只读 |
| 逐表加载目录来填清单列 | 目录读取留在单表详情。否决 D8 时，清单连 `grantStatus` 也不加 |
| 改角色编辑页里 `RowPolicyDnfPreview` 的默认展开和默认句序 | 新行为用可选 prop，默认等于今天 |
| 把「空筛选」改名 | 父 Spec 用它区分「没有命中」和「无授权」 |
| 改清单 API 的查询参数名 | 页面把 `list*` 映射到现有的 `connectionId` / `schema` / `sourceName` |
| 改系统手册里这一页的导航说明 | 现句仍然成立 |
| 新增 Playwright 或窄屏布局 | 验收用组件测试。未要求时不做窄屏 |

## 4. 待拍板决策

| ID | 提议 | 拍板前的现行口径 |
|---|---|---|
| D1 | 点表只写 `connectionId` / `schema` / `sourceName`。清单请求不带这三项，除非对应的 `list*` 筛选有值 | 点表同时收窄清单 |
| D2 | 清单筛选参数为 `listConnectionId`、`listSchema`、`listSourceName`，外加既有 `roleId`、`agentId`、`restricted` | 连接、Schema、表名与当前表共用参数 |
| D3 | 改任一清单筛选都不删除当前表三参数 | `updateFilter` 在非 `sourceName` 的键上删除 `sourceName` |
| D4 | 连接、Schema、表名、角色、Agent 五个文本或下拉的可见值走 `useUrlMirroredField`，`history` 为 `"push"`。原文进 URL，trim 只发生在发请求时 | `defaultValue` + `onChange` 里 `trim` |
| D5 | 连接、Schema 用下拉，选项来自不带 `list*` 的同一次清单接口。角色、Agent、表名保持精确匹配文本框 | 五个无标签文本框 |
| D6 | 徽章「空筛选」和句子「没有符合筛选条件的表。」保留。有清单筛选时显示「清除筛选」 | 只有徽章和句子 |
| D7 | 四段哈希默认折进「快照」。描述改为「按表查看实际生效的行约束。」「行策略模板」为 secondary 按钮 | 哈希与标题同一行，模板是下划线 |
| D8 | 清单行增加 `grantStatus`：`all` / `scoped` / `no_applicable_grant` / `compile_failed`。不请求目录。详情里的目录状态改用 §术语表的中文标签 | 授予为 `null` 时显示「—」；详情写 `目录：loaded` |
| D9 | `templateRefs` 与 `inlinePredicates` 都空时不渲染编写方式徽章 | 无模板时函数默认返回「仅直接写条件」，页面照渲染 |
| D10 | 详情顺序为结论、角色、Agent。并集边界句移到结论下方，句子原文不变。全体 Agent 都是 `all` 时默认收成一句，展开后逐个渲染。角色编辑页不传这些 prop | 角色在上，边界句在结论前，Agent 逐个平铺 |

D1 与 D3 是这一页读数正确的前提。否决 D1 时，可以只做 D3：勾「仅受限表」不再关掉详情，但点表仍会把清单收成一行。否决 D8 时，清单授予列保持今天的三态文案，不显示「编译失败」。否决 D10 时，详情块的顺序和 Agent 折叠保持今天，页头和筛选仍可按 D2–D7、D9 改。

## 5. 呈现规格

### 5.1 页面骨架

```text
Page Header
  标题：行权限视图
  描述：按表查看实际生效的行约束。
  动作：行策略模板（secondary，链到 /admin/row-policy-templates）
  折叠：快照。summary 文案为「快照」。内部仍是 data-testid="row-policy-snapshot"

工具条
  标签在控件上方：连接、Schema、表、角色、Agent
  连接、Schema 为 select，空选项文案为「全部连接」「全部 Schema」
  表、角色、Agent 为文本框，aria-label 仍是「表筛选」「角色筛选」「Agent 筛选」
  连接、Schema 的 aria-label 仍是「连接筛选」「Schema 筛选」
  右侧：全部表 / 仅受限表
  有清单筛选时：清除筛选，data-testid="row-policy-view-clear-filters"
  其下弱提示：本页只读。修改请到角色权限。

表清单
  标题旁：{n} 张表
  网格列：表、角色数、Agent 数、有效行授予
  表列主文是 sourceName，次行是「{connectionId} · {schema}」
  按钮 aria-label 为「{connectionId}/{schema}/{sourceName}」
  选中行 aria-current="true"，背景 bg-bg-muted

单表详情（三参数齐全才出现）
  身份、复制、状态徽章、目录中文标签
  若清单已返回且其中没有这一行：当前表不在筛选结果中。
  结论（有效行授予 / DNF）
  边界句
  角色分组
  Agent
```

清单部分失败、失败集合、加载中、读取失败的 test id 与句子保持今天的实现。

### 5.2 URL

| 参数 | 谁写入 | 谁读取 |
|---|---|---|
| `connectionId` `schema` `sourceName` | 点表、既有深链 | 只用于单表详情。三者齐全才请求 `/views/table` |
| `listConnectionId` `listSchema` `listSourceName` | 筛选控件 | 清单请求时分别映射为 `connectionId` `schema` `sourceName`。空字符串删除参数，不 trim 后写回 |
| `roleId` `agentId` | 筛选控件 | 清单请求同名参数。精确匹配，与今天的服务端判断相同 |
| `restricted` | 分段控件 | 值为 `true` 或缺失。清单请求仍是 `restricted=true` |

清除筛选删除 `listConnectionId`、`listSchema`、`listSourceName`、`roleId`、`agentId`、`restricted`，并调用每个镜像字段的 `reset("")`。不删除当前表三参数。

连接或 Schema 的选项来自另一次清单请求：不带 `list*`，也不带当前表三参数，也不带角色、Agent、`restricted`。Schema 选项再按已选连接在客户端收窄。选项请求失败时，下拉仍显示 URL 里的当前值。

### 5.3 清单授予列

`grantStatus` 由清单接口在已有的 `computeFinalRowsForTable(..., agents: [])` 结果上派生，不新增目录读取：

| 条件 | `grantStatus` | 单元格文案 |
|---|---|---|
| `ok` 且 `kind == all` | `all` | 行权限：全部行 |
| `ok` 且 `kind == scoped` | `scoped` | 受限行授予（{orArms.length} 个分支） |
| `ok == false` 且 reason 为 `row_policy_no_applicable_grant` | `no_applicable_grant` | 无授权 |
| 其他失败 | `compile_failed` | 编译失败 |

机器 reason 放在单元格的 `title` 上，并加翻译防御。不把 reason 当主文案。

### 5.4 详情

结论使用现有 `RowPolicyDnfPreview`。本页传入：

- `boundaryPlacement="footnote"`。边界句仍是常量 `ROW_POLICY_PREVIEW_BOUNDARY`，test id 仍是 `row-policy-dnf-boundary`。
- `children` 放在并集小节和 Agent 小节之间，内容是角色分组。
- `collapseUniformAllRows`。仅当 `finalRowsByAgent` 非空且每一项 `finalRows.kind == "all"` 时，默认渲染统一句和「展开」。展开后仍逐个渲染现有 `row-policy-dnf-agent-*`。其他情况不折叠。

角色编辑页不传这三个 prop。默认仍是边界句在上、没有中间插槽、Agent 不折叠。

角色分三组，空组不渲染标题：

| 组 | 条件 | 标题 |
|---|---|---|
| 参与并集 | `rowGrant != null` | 参与并集 |
| 不授予该表 | 无 `error` 且 `rowGrant == null` | 不授予该表 |
| 编译失败 | 有 `error` | 编译失败 |

组内仍保留 `row-policy-view-role-{roleId}`、`row-policy-view-role-access`、模板与内联条件。角色名仍链到 `/admin/roles/{roleId}`。每个角色和每个 Agent 增加授权摘要链接：

- 角色：`/admin/authorization-summary?kind=role&id={roleId}`，可见文案「授权摘要」
- Agent：`/admin/authorization-summary?kind=agent&id={agentId}`，可见文案「授权摘要」

DNF 多分支时，本页传 `predicateLayout="stacked"`：一支一块，支与支之间的可见文字是「或」，支内谓词仍用「且」连接。test id `row-policy-dnf-union-arm-{n}` 保留。默认布局仍是今天的单行。

复制按钮调用 `copyTextWithToast("{connectionId}/{schema}/{sourceName}")`。

目录标签按术语表映射。`data-catalog-status` 保留机器值。有 `reason` 时，reason 仍以翻译防御原文跟在标签后。

## 6. 核心流程（伪代码）

```text
onSelectTable(table):
  set connectionId, schema, sourceName
  do not change list* , roleId, agentId, restricted

onListFilterChange(key, raw):
  write raw into list* or roleId or agentId or restricted
  do not delete connectionId, schema, sourceName
  text fields use functional setSearchParams(prev)

listRequest(url):
  query.connectionId = trim(url.listConnectionId) if present
  query.schema = trim(url.listSchema) if present
  query.sourceName = trim(url.listSourceName) if present
  copy roleId, agentId, restricted when present
  do not copy url.connectionId, url.schema, url.sourceName

detailRequest(url):
  if connectionId and schema and sourceName are all non-empty after trim:
    request /views/table with those three trimmed values
  else:
    render no detail

renderDetail(detail, list):
  show identity, copy, status badge, catalog label
  if list loaded and no row equals the detail triple:
    show 「当前表不在筛选结果中。」
  show union
  show boundary sentence
  show role groups
  if every agent finalRows.kind is all and there is at least one agent:
    show the uniform sentence, agents hidden until expand
  else:
    show each agent

renderGrantCell(row):
  switch row.grantStatus:
    all -> 行权限：全部行
    scoped -> 受限行授予（N 个分支）
    no_applicable_grant -> 无授权
    compile_failed -> 编译失败

renderListEmpty(status):
  unavailable -> 现有快照不可用句子，不提「没有符合筛选条件的表」
  no_match -> 徽章「空筛选」+ 「没有符合筛选条件的表。」
  other non-ok -> 现有不可判定句子
  if any list filter is set: show 清除筛选
```

`grantStatus == compile_failed` 时不得走 `no_applicable_grant` 的文案。`kind == all` 只在并集结果确为 `all` 时出现。

## 7. 验收

| ID | 断言 |
|---|---|
| SC-01 | 点表后详情请求带三参数；随后的清单请求不带这三项，除非 `list*` 自己有值 |
| SC-02 | 打开 `?connectionId=warehouse&schema=fin&sourceName=fin_ledger` 时详情出现，三个筛选控件值为空 |
| SC-03 | 已有当前表时切换到「仅受限表」，URL 仍含 `sourceName`，表筛选框不显示已被 URL 删除的表名 |
| SC-04 | 五个筛选的可见值来自本地镜像。写入 URL 的是原文。请求参数才 trim |
| SC-05 | `no_match` 的徽章是「空筛选」，句子是「没有符合筛选条件的表。」，且不出现「无授权」「快照当前不可用」 |
| SC-06 | 清除筛选去掉 `list*`、`roleId`、`agentId`、`restricted`，保留当前表三参数 |
| SC-07 | 清单表含 `pl-data-grid` 与 `pl-data-table`。选中行 `aria-current="true"`。按钮 `aria-label` 为三元组 |
| SC-08 | 四态 `grantStatus` 分别显示全部行、受限行授予、无授权、编译失败。编译失败单元格不含「无授权」 |
| SC-09 | 两个受限分支仍是两个 arm，页面不出现 `row-policy-dnf-all` |
| SC-10 | 无模板且无内联条件的角色没有编写方式徽章。有模板引用时仍显示模板名，角色链接仍指向 `/admin/roles/{id}` |
| SC-11 | 角色的授权摘要链接为 `?kind=role&id=`，Agent 的为 `?kind=agent&id=` |
| SC-12 | 全体 Agent 为 `all` 时先看到统一句；展开后 `row-policy-dnf-agent-{id}` 仍在。未传 prop 的预览不折叠 |
| SC-13 | 快照默认折叠，`row-policy-snapshot` 仍在 DOM。模板链接的 class 含 `pl-btn--secondary` |
| SC-14 | 复制调用 `copyTextWithToast`，参数为 `connectionId/schema/sourceName` |
| SC-15 | 页面没有保存、删除、预演按钮。`docs/qa/selector-contract.md` 里已有的 `row-policy-view-*` id 仍在 |
| SC-16 | 清单结果不含当前表时，详情仍在，且可见「当前表不在筛选结果中。」 |
| SC-17 | 边界句原文仍是 `ROW_POLICY_PREVIEW_BOUNDARY` |
| SC-18 | `npm run lint:terminology` 通过 |

SC-01–SC-18 在本 Spec 获批前全部未执行。实现完成不等于验收通过。

## 8. 落盘清单

| # | 要求 | 本文件 |
|---|---|---|
| 1 | Spec 落 `docs/specs/`，命名 `lucy-YYYYMMDD-<slug>-spec.md` | 本文件 |
| 2 | 核心流程（伪代码）或显式豁免 | §6 |
| 3 | 头部含文档类型 / 版本、状态 | 文首元数据表 |
| 4 | Plan 五类小节 | 见配套 Plan |
| 5 | Terminology Compliance 含 `This feature follows` 与 `New terms:` | 上文 |
| 6 | Design System Compliance 四段式 | 上文 |
| 7 | 索引登记 | `docs/README.md`、`docs/plans/README.md` |
| 8 | 新命令 / CI | 无 |
| 9 | 功能编号 | 待 PM 指派 |
| 10 | 落盘后跑 `lint:spec-docs` | 配套 Plan 的开工记录 |
