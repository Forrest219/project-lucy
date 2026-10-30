# 登录账户页实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v1.3** / 2026-10-30 |
| 目标版本 / 优先级 | 不绑定产品版本号 / P1 |
| 主 Spec | [登录账户页 Spec](../specs/lucy-20261030-login-accounts-spec.md)（**v1.2**） |
| 台账号 | 无。不进入 v0.25 升级台账，不另派 WebUI 流水号 |
| 需求来源 | 2026-10-30：登录账户页改成名册、新建对话框和单账户抽屉。旧路径替换到 `/admin/accounts`。接口保持 `/api/admin/admins` |
| 状态 | **v1.3：S1–S2 已落地**（2026-10-30）。SC-01–SC-18 全部有通过记录（组件测试、导航测试、术语检查）。**未做浏览器走查、移动窄屏、Docker 重建和客户交付**；组件测试通过不等于这一页已经在运行中的容器里改版 |
| 授权边界 | 2026-10-30 第 3 轮批准按 v1.2 实现 Plan S1–S2。实现不超出该范围：未动 `/api/admin/admins` 及其子路径，未新增身份源配置页，未在抽屉里编辑显示名，未改 SEC-03-V05 的断言范围 |
| 验收 | SC-01–SC-18 全部通过，记录见 §5 |
| 实施主体 | Lucy WebUI。不修改 KTX 源码 |
| 已拍板决策 | Spec §4 的 D1–D19 已冻结。v1.2 只收紧 SC-10、SC-11、SC-12、SC-17，不改决策 |
| 待确认 | 无 |

## 1. 目标

把登录账户页收成一张名册。所有者用「新建账户」创建，用「管理」维护一个账户。四条保护在按钮上不可执行，并说明原因。删除须输入登录账户 id。单点登录未启用时不展开绑定字段。

三个交付物：

1. **路径与名册**（S1）——`/admin/accounts`，旧路径替换，页头主操作，当前登录标记。
2. **新建与抽屉**（S1）——对话框、账户抽屉、保护、输入 id 后删除、条件绑定。
3. **入口对齐**（S2）——手册、发版清单、走查登记和既有 SEC-03-V05 改走新入口。

实施原则：

- 接口路径和错误码不动。保护判断与 L25-06 的所有者底线、本地密码底线同向，界面可以更严。
- 术语以术语标准 §4.11.1 为准。
- 运维仍然不能治理登录账户。
- 不做移动窄屏验收，不重建 Docker。

## 2. 开工前置

D1–D19 已按 Spec §4 冻结。v1.2 按第 2 轮残留收紧三处验收：SC-10 对最后一名本地密码所有者同时断言禁用、删除和降权；SC-11 用字段缺失的正例证明它计入本地密码所有者；SC-12 与 SC-17 要求删除确认按钮可聚焦，且气泡关闭时说明节点仍在。术语标准 §4.11.1 已登记「当前登录」「新建账户」「管理」和删除确认。

第 3 轮已定稿，S1–S2 可以改页面。实现仍须遵守：

- 不改 `/api/admin/admins` 及其子路径。
- 不新增身份源配置页。
- 不在抽屉里编辑显示名。
- 移除本地密码在条件不成立时不渲染，而不是渲染成禁用按钮。
- 不可执行按钮使用 `aria-disabled="true"`，以便悬浮和聚焦能看到原因。
- 不把 SEC-03-V05 扩成新的整库旅程；只让它从新入口完成原来的创建和运维拒绝断言。

**退出条件**：第 3 轮已确认 F01、F02、F05 闭合。可以按 S1 改页面。

## 3. 现状依赖与文件落点

### 3.1 复用

| 复用 | 位置 | 说明 |
|---|---|---|
| 账户接口 | `GET` / `POST` / `PATCH` / `DELETE /api/admin/admins`，`PUT` / `DELETE .../oidc-binding` | 请求体和错误码不变 |
| 当前登录人 | `useAuth().status.me.id` 与 `me.role` | 「当前登录」和所有者判断 |
| 单点登录开关 | `status.methods` 含 `oidc` | 与登录页隐藏「使用单点登录」同一信号 |
| 绑定读取 | `OidcBindingPanel.tsx` 的 `readLoginMethods`、`readBinding` | `loginMethods` 缺失视为仍有本地密码 |
| 新建对话框壳 | `AgentList.tsx` 的 `pl-modal-backdrop` / `pl-modal-panel` | 标题改为「新建账户」 |
| 抽屉壳 | 现有 `pl-drawer-panel` | 一次一个账户 |
| 密码策略 | `assertPasswordPolicy`，至少 10 个字符 | 失败显示接口文案 |
| 按钮外观 | `.pl-btn:disabled` | `aria-disabled="true"` 使用同一套半透明和光标 |

### 3.2 计划修改文件

| 文件 | 改动 | 阶段 |
|---|---|---|
| `webui/src/pages/admin/AdminAccounts.tsx` | 名册、页头「新建账户」、新建对话框、抽屉、保护与删除确认 | S1 |
| `webui/src/components/admin/OidcBindingPanel.tsx` | 整页面板不再由本页渲染。绑定分组可留在抽屉内；无引用的页面级导出删掉 | S1 |
| `webui/src/app/App.tsx` | `/admin/accounts` 渲染本页；`/admin/admins` 替换到新路径 | S1 |
| `webui/src/app/navigation.ts` | 侧栏 `to` 与 `active` 改为 `/admin/accounts` | S1 |
| `webui/src/lib/breadcrumbs.ts` | 本页面包屑仍是「系统设置 / 登录账户」，匹配新路径 | S1 |
| `webui/src/app/app.css` | `.pl-btn[aria-disabled="true"]` 与 `:disabled` 同貌 | S1 |
| `webui/docs/design-system/10-components-button.md` | 补 `aria-disabled` 与悬浮原因这一句 | S1 |
| `webui/src/__tests__/admin-accounts.test.tsx` | 按 §3.3 改旧断言，并覆盖 SC-03、SC-05、SC-08–SC-10、SC-12–SC-14、SC-16、SC-17 | S1 |
| `webui/src/__tests__/admin-accounts-oidc.test.tsx` | 按 §3.3 改旧断言，并覆盖 SC-06、SC-07、SC-11、SC-15、SC-18 | S1 |
| `webui/src/__tests__/navigation.test.ts` | 按 §3.3 改 `:109` 与 `:229`。SC-02 | S1 |
| `webui/src/app/App.tsx` 的路由测试，或现有登录路由测试 | SC-01 的两段：直接打开旧路径；登录后 `from` 为旧路径。`login-oidc.test.tsx` 里 `returnTo: "/admin/admins"` 保持不变 | S1 |
| `docs/SYSTEM_HANDBOOK.md` | 第 220、1142、1315、1340 行的页面路径改为 `/admin/accounts` | S2 |
| `webui/src/__tests__/help-center.test.tsx` | 第 185 行路径表和第 259 行恢复说明与手册同步 | S2 |
| `docs/runbooks/webui-release-ux-checklist.md` | 登录账户一行的路径改为 `/admin/accounts` | S2 |
| `docs/ui-ux-feedback/README.md` 与 `docs/ui-ux-feedback/pages/admin-admins.md` | Route 与 Browser Check 改为 `/admin/accounts`。Status 保持 Open，直到 SC 通过后再改 | S2 |
| `webui/tests/real-e2e/admin-auth.spec.ts` | 按 §3.3 改 SEC-03-V05 与 SEC-04-V11 | S2 |

### 3.3 必须改掉的旧断言

这些断言按今天的页面编写。实现后会失败。只改入口和选择器，安全语义保留。

| 位置 | 今天在断言什么 | 改成 |
|---|---|---|
| `admin-accounts.test.tsx` 第 92 行 `getByLabelText("登录账户")`，以及第 104–109 行页内「禁用」「启用」「删除」「创建账户」 | 名册同屏有创建表单和行内禁用、删除 | 名册上是「新建账户」和「管理」。打开对话框后才有「登录账户」输入和「创建账户」。打开抽屉后才有「禁用」 |
| `admin-accounts-oidc.test.tsx` 第 162 行 `admin-oidc-bindings` | 页面上有整块 OIDC 身份绑定 | 打开「管理」后，在抽屉里断言绑定事实。页面上没有这个标题 |
| 同文件第 250 行，唯一所有者夹具点击 `oidc-password-remove-admin_zhang` | 唯一所有者可以移除本地密码 | 该夹具改为断言按钮不存在。另用 SC-11 里「还有另一名本地密码所有者」的夹具断言 `PATCH` body 为 `{ removeLocalPassword: true }` |
| `navigation.test.ts` 第 109 行 `to: "/admin/admins"` | 侧栏目标是旧路径 | `to` 改为 `/admin/accounts` |
| `navigation.test.ts` 第 229 行 `findGroupIdForPathname("/admin/admins")` | 旧路径直接归到系统设置 | 改为断言 `/admin/accounts`。旧路径不作为侧栏目标 |
| `admin-auth.spec.ts` SEC-03-V05 | 打开 `/admin/admins`，页内标题「添加登录账户」，直接填表 | 打开 `/admin/accounts`，点击「新建账户」，在对话框里创建。运维仍然看不到「新建账户」和「禁用」 |
| `admin-auth.spec.ts` SEC-04-V11 第 148–150 行 | 行内按钮「禁用」 | 对该行点「管理」，在抽屉里点「禁用」，再断言「已禁用」。会话立即失效的断言不变 |

本落盘已经修改、实现阶段只核对不重写口径的文件：

| 文件 | 已写入的内容 |
|---|---|
| `webui/docs/00-product-terminology-standard.md` | §4.11.1 |
| `docs/README.md`、`docs/plans/README.md` | 索引 |

不修改：`webui/server/auth/routes.ts`、`admins-store.ts`、L25-06 Spec、历史实施记录。命令面板关键词保持现状。

## 4. 阶段

### S1 页面

1. 按 Spec §5 和 §6 改名册、对话框和抽屉。保护函数与伪代码同序。
2. 接上替换路由和侧栏。
3. 补按钮的 `aria-disabled` 外观，并在按钮规范里写上这一句。
4. 组件测试覆盖 SC-01–SC-18 里不依赖手册文案的条目。SC-10 的双所有者夹具必须分别点击 A 的禁用、删除和降权。SC-11 的字段缺失行必须同时看到两名所有者的「移除本地密码」。SC-12 的删除确认在气泡关闭时就能读到说明，并且按钮可以聚焦。允许态检查请求体，拒绝态检查次数为 0。

**退出条件**：SC-01–SC-18 的组件与导航断言通过。运维夹具下看不到治理控件。旧路径的最终位置是 `/admin/accounts`。

### S2 入口对齐

1. 手册、帮助中心夹具、发版清单、走查登记中的页面路径改为 `/admin/accounts`。
2. SEC-03-V05 改为打开新路径，点击「新建账户」，在对话框里创建运维账户；运维会话看不到「新建账户」和「禁用」。接口 403 断言保持。SEC-04-V11 改为从抽屉禁用，会话失效断言保持。

**退出条件**：§3.3 的旧断言都已迁移。SEC-03-V05 仍证明运维不能治理登录账户。SEC-04-V11 仍证明禁用后另一浏览器会话立即失效。

## 5. 验收

验收条目就是 Spec §7 的 SC-01–SC-18。

| 阶段 | SC |
|---|---|
| S1 | SC-01–SC-18 |
| S2 | 无新 SC。手册路径、SEC-03-V05 和 SEC-04-V11 与 S1 的页面一致 |

任一 SC 未执行，不得把本 Plan 标成已完成。组件测试通过不等于这一页已经在运行中的容器里改版。

### 5.1 通过记录（2026-10-30）

| SC | 通过记录（测试名） | 文件 |
|---|---|---|
| SC-01 | 打开旧路径后地址栏变成 `/admin/accounts`，页头是「登录账户」／登录守卫把旧路径记成 `from`；登录后回到这个旧路径仍落在 `/admin/accounts` | `src/__tests__/admin-accounts-route.test.tsx` |
| SC-02 | 侧栏「登录账户」指向 `/admin/accounts`，旧路径不再是侧栏目标 | `src/__tests__/navigation.test.ts` |
| SC-03 | 所有者看到页头「新建账户」，页面没有旧的常驻标题 | `src/__tests__/admin-accounts.test.tsx` |
| SC-04 | 运维名册只有四列，没有登录方式、新建账户、管理和禁用 | `src/__tests__/admin-accounts-oidc.test.tsx` |
| SC-05 | 开放模式保留原说明，没有「新建账户」和「管理」 | `src/__tests__/admin-accounts.test.tsx` |
| SC-06 | 单点登录未启用时新建对话框只有四个字段，页头下一句说明 | `src/__tests__/admin-accounts-oidc.test.tsx` |
| SC-07 | 单点登录已启用时，未勾选不出现三项，勾选后三项必填且密码可留空 | `src/__tests__/admin-accounts-oidc.test.tsx` |
| SC-08 | 当前登录的行有标记，抽屉标题是该登录账户 id | `src/__tests__/admin-accounts.test.tsx` |
| SC-09 | 当前登录账户的禁用与删除不可执行，且不发请求 | `src/__tests__/admin-accounts.test.tsx` |
| SC-10 | 唯一一名启用且有本地密码的所有者：禁用、删除和降权都不可执行／两名启用所有者中只有一人有本地密码：底线落在有本地密码的那一侧／两名启用所有者都有本地密码时，当前人可以把自己改为运维 | `src/__tests__/admin-accounts.test.tsx` |
| SC-11 | 「移除本地密码」的出现条件（未绑定的运维／已绑定但身份源关闭／只有单点登录／字段缺失的唯一所有者／字段缺失，另有明确本地密码／已绑定的运维／不是最后一名本地密码所有者）+ 允许态断言 `PATCH` body 为 `{ removeLocalPassword: true }` | `src/__tests__/admin-accounts-oidc.test.tsx` |
| SC-12 | 删除确认在登录账户 id 一致前不发出 `DELETE`／删除比较五格（`xingchen`、首尾空格、首尾换行、`Xingchen`、中间换行） | `src/__tests__/admin-accounts.test.tsx` |
| SC-13 | 接口拒绝时把接口文案留在抽屉或确认框里 | `src/__tests__/admin-accounts.test.tsx` |
| SC-14 | 保存密码调用 `PATCH`，成功后显示「本地密码已更新。」 | `src/__tests__/admin-accounts.test.tsx` |
| SC-15 | 未勾选时 `POST` 不带 `oidcBinding`／勾选并填齐三项、密码留空时 `POST` 带 `oidcBinding` 且不带 `password` | `src/__tests__/admin-accounts-oidc.test.tsx` |
| SC-16 | 用户可见文案不含禁用词 | `src/__tests__/admin-accounts.test.tsx` |
| SC-17 | 两组不可执行按钮都断言：可聚焦、气泡关闭时节点在 DOM、气泡文本与节点相同 | `src/__tests__/admin-accounts.test.tsx` |
| SC-18 | 抽屉里的身份绑定四格（未启用无绑定／未启用有绑定／启用无绑定／启用有绑定） | `src/__tests__/admin-accounts-oidc.test.tsx` |

同批执行的机器门禁：`lint:terminology`、`lint:spec`、`lint:ia-boundary`、`lint:version`、`lint:handbook-baseline`、`lint:handbook-coverage`、`lint:handbook-anchors`、`webui` 的 `build`。`lint:spec-docs` 仍因仓库里已有的三份他人文档 exit 1，与本功能无关。

**未执行**：浏览器走查、移动窄屏、Docker 重建、`e2e:real:verify`、客户环境。SEC-03-V05 与 SEC-04-V11 的选择器已按 S2 改完，但 e2e 未在本轮跑。

## 6. 完成定义

同时满足才算完成：

1. SC-01–SC-18 均有记录在案的通过结果。
2. 所有者打开 `/admin/accounts` 时，主画布是名册，新建在对话框里，绑定在一个账户的抽屉里。
3. 当前登录账户不可禁用或删除。最后一名启用所有者、最后一名本地密码所有者的禁用、删除和降权不可执行。还有另一名合格所有者时，降权和禁用会发出对应 `PATCH`。
4. 删除在登录账户 id 一致前不发出 `DELETE`。
5. 单点登录未启用时，新建对话框没有身份源、主体、联系邮箱。
6. `/api/admin/admins` 的路径和 L25-06 错误码保持不变。
7. 手册和发版清单中的页面路径是 `/admin/accounts`。打开 `/admin/admins` 后地址栏是新路径。

完成定义不包含浏览器走查、移动窄屏和 Docker 重建。若实现会话的工作约定要求看页面，只看桌面宽度的 `/admin/accounts`：名册、新建对话框、自己的抽屉和删除确认。不把窄屏写入验收。

## 7. 风险

| 风险 | 表现 | 处置 |
|---|---|---|
| 原生 `disabled` 收不到悬浮 | 原因气泡永远不出现 | D10：`aria-disabled="true"`，点击不发请求 |
| 保护只做在界面上 | 并发下仍可能点到已过期的允许态 | D15：接口拒绝显示在抽屉或确认框 |
| 移除密码仍用旧确认句 | 未绑定时承诺「只能使用单点登录」 | 该按钮不渲染；渲染时使用 Spec §6 的新确认句 |
| 运维看到登录方式或绑定 | 超出 L25-06 的所有者视图 | SC-04：运维只有四列 |
| 旧书签 404 | 手册和登录回跳仍写 `/admin/admins` | D2 的替换路由；S2 改用户可见文档 |
| 登录回跳停在旧路径 | 守卫先于替换把 `returnTo` 记成旧路径 | 进入旧路径后必须再替换。SC-01 断言最终位置 |
| 对话框和页头各有一个 primary | 同组两个主按钮 | 主按钮只在各自的动作组里：页头一个，打开的对话框提交一个 |
| 改到接口路径 | 客户端和 e2e 的 API 断言一起断 | S1 不改 `routes.ts` |
| SEC-03-V05 仍找「添加登录账户」 | 既有安全测试变红 | S2 改选择器，不断言范围 |

回滚：先恢复 `AdminAccounts.tsx`、路由和侧栏，再恢复手册中的路径。没有数据迁移。术语标准 §4.11.1 可以留下，因为它描述已批准的呈现，不改变旧页面的运行。

## 8. 落盘清单勾销

对照 [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「新增 Spec / Plan 的落盘清单」：

| # | 结果 |
|---|---|
| 1 | Spec 在 `docs/specs/lucy-20261030-login-accounts-spec.md`，Plan 在 `docs/plans/lucy-20261030-login-accounts-plan.md` |
| 2 | Spec 含「核心流程（伪代码）」 |
| 3 | Spec 头部有文档类型 / 版本与状态；Plan 头部有状态、授权边界、验收 |
| 4 | 本 Plan 含目标、开工前置、验收、完成定义、风险 |
| 5 | Spec 的 Terminology Compliance 含 `This feature follows` 与 `New terms:` |
| 6 | Spec 的 Design System Compliance 含规定四段 |
| 7 | 已登记 `docs/README.md` 与 `docs/plans/README.md` |
| 8 | 不适用。本功能不新增命令或 CI job |
| 9 | 台账号无。文件名是本功能的身份。不写入 v0.25 升级台账，不另派 WebUI 流水号 |
| 10 | 2026-10-30 已跑。本 Spec 与本 Plan 无形态违规。`lint:terminology`、`lint:spec`、`lint:ia-boundary` 通过。`lint:spec-docs` 仍报仓库里已有的 `docs/specs/lucy-ci-restoration-spec.md`、`docs/plans/2026-10-29-ci-restoration-plan.md`、`docs/plans/2026-10-30-l25-11-publish-window-task.md`，与本功能无关，不写入基线。门禁结果不代替本表 |
| 11 | Spec 含「闭口层级」。层级是功能合同。出口是 SC-01–SC-18。上线关系写明本条收口不表示可上线 |
