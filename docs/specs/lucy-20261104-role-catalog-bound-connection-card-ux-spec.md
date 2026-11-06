# Role「可访问的表」目录绑定连接卡呈现 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 呈现修订 / **v0.2 功能合同已收口** |
| 日期 / 目标版本 | 2026-11-04 / 不绑定产品版本号。不升 Spec 131／150 版本号中的授权代数 |
| 功能编号 / 优先级 | **无** / **P2**（Role 权限「可访问的表」编辑面 IA）。不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 登记册 |
| 状态 | **v0.2 功能合同已收口（2026-11-04）**。D1–D8 已冻结；SC-01–SC-12 关闭（`role-table-grants`＋`role-detail` 39/39；`lint:terminology` exit 0）。实施记录见 [`docs/reviews/2026-11-04-role-catalog-bound-connection-card-ux-implementation-notes.md`](../reviews/2026-11-04-role-catalog-bound-connection-card-ux-implementation-notes.md)。本条收口不表示可上线 |
| 决策来源 | 2026-11-04 对 `http://127.0.0.1:55176/admin/roles/new?tab=tables` 走查：用户问「启用目录绑定」含义；手册无介绍；提出开关应贴近连接而非埋在页底高级设置。讨论冻结：呈现方案 3（连接卡优先）、语义 A（整角色 `names`／`catalog_bound` 二选一，不混用、不按 Schema 独立绑定） |
| 需求来源 | 目录绑定入口难发现；管理员心智是「对某个连接跟随启用表」，与「高级设置里的全局勾选」脱节 |
| 实施主体 | Lucy WebUI：`webui/src/components/RoleTableGrants.tsx` 及相关 Role 详情草稿／测试／selector-contract。不修改 KTX、不改 Spec 131 编译代数、不改 `access.yaml` 字段语义 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」：仓库级呈现修订落 `docs/specs/` |
| 与既有 Spec 的关系 | **修订呈现，不改语义。** Spec 131（[`webui/docs/131-lucy-admin-catalog-bound-role-spec.md`](../../webui/docs/131-lucy-admin-catalog-bound-role-spec.md)）`allow.source_scope: catalog_bound`、connections ∩ enabled_tables、禁止行级 scoped、`lucy_admin` 全连接特例 **保留**。Spec 150（[`webui/docs/150-role-permission-configuration-structure-spec.md`](../../webui/docs/150-role-permission-configuration-structure-spec.md)）三编辑面与保存流程 **保留**；**本条取代** Spec 150 §5.1 中「启用目录绑定位于高级设置」的入口呈现。帮助手册补写不在本条出口 |
| 实施计划 | [`docs/plans/lucy-20261104-role-catalog-bound-connection-card-ux-plan.md`](../plans/lucy-20261104-role-catalog-bound-connection-card-ux-plan.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：Role「可访问的表」以连接卡承载「跟随此连接的启用表」；去掉页底高级设置中的目录绑定入口；底层仍是整角色 `names`／`catalog_bound` 二选一（语义 A），不引入按连接混用或按 Schema 绑定。
- 本条出口：SC-01–SC-12。证据以组件／草稿单测与 selector-contract 更新为主。
- 不在本条出口：帮助手册正文、浏览器／Playwright／窄屏走查、镜像构建、部署、Spec 131 编译与审计事件、按连接混用、按 Schema 目录绑定、恢复 prefix UI、SYSTEM_HANDBOOK。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. 不新增产品概念。沿用：Catalog Bound Scope／启用目录绑定、Exact Table Names／指定表名、Role Connection Allow-list／允许的连接、启用表范围、行级策略、Lucy Admin Role。

控件文案（不登记为新术语）：

| 控件 | 文案 | 说明 |
|---|---|---|
| 连接卡跟随开关 | 跟随此连接的启用表 | 打开＝将该连接纳入 `catalog_bound` 的 `allow.connections`；**首次**从指定表模式打开时触发整角色模式切换确认。产品概念仍称「启用目录绑定」 |
| 进入跟随确认主句 | 确认切换为跟随启用表？ | 替代「确认启用目录绑定？」；机制名可在次句出现 |
| 退出跟随确认主句 | 确认改回指定表？ | 关闭最后一个跟随连接或显式退回时 |
| 确认次句 | 切换后将从空范围开始，当前明确表和行级策略不会保留。 | 与现网确认语义一致 |
| `lucy_admin` 说明 | 跟随全部已配置连接（含日后新增） | 不可逐连接拆开；不得写成 WebUI 所有者／登录管理员 |
| 跟随态只读提示 | 将覆盖该连接当前启用表 | 有可信 N 时可附「约 N 张」；无 N 则省略数字。禁止写成「全部表」「`*`」「前缀匹配」 |

Forbidden:

- 把「跟随此连接的启用表」写成「启用表范围」配置入口（启用表范围仍在连接／白名单侧）。
- 暗示可按 Schema 单独跟随，或同一角色内部分连接指定表、部分跟随。
- 用户可见主文使用 `tables: ["*"]`、`prefix`、静默扩权黑话作主标签。
- 恢复「高级设置」折叠作为目录绑定唯一入口。

`connection id`、`Schema`、表名、`catalog_bound`、`lucy_admin`、`Role` 使用既有 `translate="no"` 与 `notranslate`。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/01-foundations-color.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [ ] 连接卡沿用既有 `rounded-lg border border-border-default` 分区节奏，不新造卡片族
- [ ] 模式切换确认沿用 warning soft／`role="alertdialog"`，不新增硬编码色值
- [ ] 跟随开关不用 `danger`；选中态不误用 `primary` 作整卡高亮底
- [ ] PageHeader／Tab 结构不变；仅「可访问的表」主区重组
- [ ] 文案符合术语标准；专业英文与 id 保留 `notranslate`
- [ ] 不引入移动窄屏专用布局

### Exceptions (If Any)

- None。不新增 Design System 章节。

### Follow-up Needed

- Spec 150 §5.1 入口句改为指向本 Spec（定稿／实施登记时写入，不改 Spec 150 三编辑面合同）。
- Spec 131 §6 Admin UI「高级／source_scope 选项」呈现注记：可见入口以本 Spec 为准；编译语义仍以 Spec 131 为准。

---

## 1. 问题

1. 「启用目录绑定」藏在「可访问的表」页底「高级设置」折叠内，与表树主路径脱节；帮助手册无介绍。
2. 开启后才出现连接勾选，顺序颠倒：管理员先想「哪些连接跟随启用表」，不是先翻高级设置。
3. 语义上目录绑定已是「声明 connections + 吃 enabled_tables」，呈现却像全局神秘开关。

## 2. 目标与非目标

### 2.1 目标

1. 「可访问的表」主区以**连接卡**为组织单位；每张卡提供「跟随此连接的启用表」。
2. 去掉本页「高级设置」中的目录绑定复选框（本条范围内不再作为入口）。
3. 保持语义 A：整角色要么指定表（`names`），要么目录绑定（`catalog_bound`）；首次进入跟随时确认清空明确表与行级策略。
4. `lucy_admin`／`grantAllConnections` 保持全连接特例，不提供逐连接拆开。
5. 行级策略在 `catalog_bound` 下继续禁用并说明原因（既有面板可保留文案，入口与表树状态与本条一致）。

### 2.2 非目标

- 不改 Spec 131 编译、`policy_scope_expanded`、AbsoluteDeny、tools 合同。
- 不支持同一角色内连接级混用（语义 B）或 Schema 级跟随（方案 C）。
- 不恢复 v2 prefix 选择器 UI。
- 不改保存／dryRun／确认权限变更 Drawer 的主干流程（仅摘要展示已有「目录绑定」态）。
- 不在本条补 SYSTEM_HANDBOOK／帮助中心长文（可另开文档工单）。

## 3. 冻结决策

| ID | 决策 | 说明 |
|---|---|---|
| D1 | 呈现方案 3：连接卡优先 | 主区按连接分卡；跟随开关在卡上 |
| D2 | 语义 A：整角色二选一 | 任一连接首次打开跟随 → 整角色进入 `catalog_bound`；不可混用 |
| D3 | 不按 Schema 绑定 | 边界单位仍是连接 ∩ enabled_tables |
| D4 | 移除高级设置目录绑定入口 | 删除或不再渲染 `table-grants-advanced` 内该复选框；若高级区因此为空则移除空折叠 |
| D5 | 确认对话框保留清空语义 | 进入／退出跟随均从空范围开始；明确表与行级策略不保留 |
| D6 | `lucy_admin` 特例不变 | 单一说明＋禁用逐连接开关；connections 仍可为 `["*"]` |
| D7 | 术语不新增 | 控件句「跟随此连接的启用表」；概念名仍「启用目录绑定」 |
| D8 | 本条不改 ACL runtime | 草稿序列化字段与现网 `rolePermissionDraft` catalog_bound 形状一致 |

## 4. 页面结构

适用：`/admin/roles/new`、`/admin/roles/:roleId`（及复制流）的「可访问的表」编辑面；参考模板只读。

### 4.1 指定表态（`scope.mode === "names"`）

- 主区为连接卡列表（搜索可保留在页级或卡外工具条）。
- 每张卡：连接 id（`notranslate`）＋开关「跟随此连接的启用表」（关）＋可展开的 Schema／表树（现网勾选、Schema 全选／清除、失效授权等行为保留）。
- 未打开任何跟随时，草稿为 `names`；序列化不得产生 `source_scope: catalog_bound`。

### 4.2 跟随态（`scope.mode === "catalog_bound"`）

- 表树不渲染；每张卡仅保留连接纳入开关（文案仍为「跟随此连接的启用表」）与只读提示。
- 开＝connection id ∈ `allow.connections`；关＝移出。
- 页级说明可保留／改写现有 `catalog-bound-scope-note`（允许连接数、扩权提示、零连接校验提示）。
- 生效摘要显示「目录绑定」而非勾选表计数（沿用 RoleDetail 现有摘要语义）。

### 4.3 `grantAllConnections`

- 不渲染可切换的逐连接开关（或全部 checked＋disabled）。
- 展示 D6 说明句。

## 5. 切换确认与退回

| 触发 | 行为 |
|---|---|
| `names` 下首次打开任一连接的跟随开关 | 打开确认（进入跟随）；确认后 `mode=catalog_bound`，`connections` 含该连接（或 `lucy_admin` 为 `["*"]`），清空 tables／行级策略 |
| 取消确认 | 开关保持关；草稿不变 |
| `catalog_bound` 下打开／关闭连接（非最后一个关闭） | 无整页模式确认；只改 connections 列表 |
| 关闭最后一个纳入连接，或显式「改回指定表」 | 打开确认（退出跟随）；确认后 `mode=names`，`tables=[]` |
| 取消退出确认 | 保持 `catalog_bound` 与原 connections |

保存前校验：`catalog_bound` 且非 `grantAllConnections` 时至少一连接——沿用 RoleDetail 现有校验文案意向（可改为「启用目录绑定时至少选择一个允许的连接」或等价，不引入新错误码）。

## 6. 与行级策略／摘要

- `catalog_bound`：行级策略编辑面继续禁用；说明指向回到「可访问的表」关闭跟随并指定表（更新文案中的「关闭启用目录绑定」为与本条控件一致的说法，不改能力）。
- 权限变更确认 Drawer：继续结构化展示 `catalog_bound` 变化；不新增 YAML 字段。

## 7. 核心流程（伪代码）

权威编译代数仍见 Spec 131 §4。本条只约束编辑面状态机：

```text
onToggleFollow(connectionId, wantOn):
  if disabled or grantAllConnections: return

  if draft.scope.mode == "names":
    if not wantOn: return
    showConfirm(enter_catalog_bound, seedConnections=[connectionId])
    return

  // already catalog_bound
  if wantOn:
    draft.scope.connections = union(draft.scope.connections, [connectionId])
  else:
    next = draft.scope.connections without connectionId
    if next is empty:
      showConfirm(exit_to_names)
    else:
      draft.scope.connections = next

onConfirm(enter_catalog_bound, seedConnections):
  clear table grants and row policies from draft
  draft.scope = { mode: "catalog_bound", connections: grantAllConnections ? ["*"] : seedConnections }

onConfirm(exit_to_names):
  draft.scope = { mode: "names", tables: [] }
  // row policies already empty when leaving catalog_bound; keep consistent clear

onCancelConfirm:
  discard pending toggle; UI switch reflects draft

serialize(draft.scope):
  // unchanged vs rolePermissionDraft today
  names -> tableSelectors.names (+ derived connections)
  catalog_bound -> source_scope: catalog_bound, connections, no tableSelectors
```

## 8. 验收（SC）

| ID | 验收项 | 证据落点（预期） |
|---|---|---|
| SC-01 | 「可访问的表」可见连接卡上的「跟随此连接的启用表」；页内无「高级设置」内的「启用目录绑定」复选框 | `role-table-grants.test.tsx`／`role-detail.test.tsx` |
| SC-02 | 默认新建为指定表态；可展开表树勾选 | 同上 |
| SC-03 | `names` 下打开跟随 → 出现进入确认；取消后仍为 `names` 且表保留 | 同上 |
| SC-04 | 确认进入后 `scope.mode === "catalog_bound"`，表树消失，种子连接纳入 | 同上 |
| SC-05 | 跟随态再开另一连接无二次整页确认；connections 含两者 | 同上 |
| SC-06 | 关闭至零连接触发退出确认；确认后 `names` 且 tables 为空 | 同上 |
| SC-07 | `grantAllConnections`／`lucy_admin`：无逐连接可写开关；可见全连接说明 | 同上 |
| SC-08 | `catalog_bound` 下行级策略面板禁用提示仍在 | `role-detail`／row-policy 相关测 |
| SC-09 | 序列化：跟随态写出 `source_scope: catalog_bound` 且无 names selectors；指定表态无 `catalog_bound` | `role-permission-draft`／detail 保存断言 |
| SC-10 | 生效摘要在跟随态展示「目录绑定」类文案 | `role-detail`／boundary summary |
| SC-11 | 连接 id／表名等专业节点保留 `notranslate` | 组件测或 lint:terminology |
| SC-12 | `docs/qa/selector-contract.md` 更新：废弃或改注 `table-grants-advanced` 目录绑定入口；登记连接卡跟随开关 test id | 文档 diff + 测使用新 id |

## 9. 落盘清单自检

| # | 项 | 本条 |
|---|---|---|
| 1 | 文件名 `lucy-YYYYMMDD-<slug>-spec.md` | 是 |
| 2 | 核心流程伪代码 | §7 |
| 3 | 元数据含文档类型／版本／状态 | 头部表 |
| 4 | 闭口层级 | 有 |
| 5 | Terminology Compliance | 有 |
| 6 | Design System Compliance 模板 | 有 |
| 7 | 索引登记 | `docs/README.md` |
| 8 | 配对 Plan 同编号 | 有 |
| 9 | 功能编号 | 无 |
| 10 | 不把发布取证写入功能出口 | 是 |
| 11 | stale-status 不裸写已作废句 | 是 |
| 12 | 本条收口不表示可上线 | 写入状态与闭口层级 |
