# L25-14 行策略模板与按表反查 —— 功能合同收口记录

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01（Asia/Shanghai） |
| Spec | [`docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md`](../specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md)（收口后 **v0.2**） |
| Plan | [`docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md`](../plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md)（收口后 **v0.3**；该 Plan 为六项 P1 Spec 共用，本批只收口其中的 **W1／P1-1／L25-14**） |
| 台账号 | **L25-14**（v0.25 登记册 §2.8；该账号同时登记 P0-2 的 R2／R4／R5 与 P0-2 的 V01–V22，**本批只动 P1-1 相关状态**） |
| 层级 | **功能合同** |
| 结论 | **RTP-01–RTP-10、RTV-01–RTV-06、RTV-08 共 17 条全部关闭；RTV-07 部分通过**——「页面无写 API／键盘／表格／焦点」四项已关闭，**「翻译防御」剩 1 处真实实现缺口**（见 §七）。本条收口**不表示可上线**。2026-11-03：RTV-07 已关闭，「RTV-07 部分通过」与「剩 1 处真实实现缺口」已作废，不得当作现值；现行值为 RTV-01–RTV-08 共 18 条全部关闭（见 §七「2026-11-03 关闭」与 Spec 头部） |
| 授权 | PM 2026-11-01 批准 C 档批次收口 |

---

## 一、本次实际动了什么：范围比登记册上写的窄得多

§8 已有 2026-10-30 的收口记录（已关闭 17 条，RTV-06／RTV-07 保持开放）。本次**逐条复核**了那 17 条是否真的有断言（不直接采信旧记录），再处理剩下的两条。

**复核结论**：17 条**全部有真断言**，逐条落点见 §二。真正需要补断言的是三处此前**只有半个判据**的地方：

| # | 位置 | 旧记录的样子 | 实际问题 |
|---|---|---|---|
| ① | **RTV-08** | `p1-row-policy-views.test.ts`「RTV-08 — one response never mixes two generations」只有一条用例，函数体里只断言四个身份字段是**非空字符串** | 判据的两句——「同次响应**不混用**配置、目录或策略世代」与「刷新后**明确更新**快照身份」——**一句都没有被打假**。字段非空不等于同一个世代 |
| ② | **RTV-06** | `p1-row-policy-reconciliation.test.ts` 三面对账比的是**清单面**（`listRowPolicyTables()`） | 用户逐表读的是**详情面**（`readRowPolicyTableView()`）。详情面此前**没有任何跨面断言**，它与清单面的角色数／Agent 数／快照身份是否一致，无人验证 |
| ③ | **RTV-07** | 「开放：页面为只读；键盘、表格、焦点与翻译防御尚无测试」 | 四样东西**全无断言**。本批补齐前三样 + 翻译防御的可打假部分，并查出**一处真实实现缺口**（§七） |

## 二、出口矩阵结果（逐条 → 用例 → 文件）

**证据等级：本地自动化（vitest）。** 无 CI job 证据，无客户环境证据，无浏览器实测证据。

| 编号 | 结果 | 证据落点（文件 → 用例名） |
|---|---|---|
| RTP-01 | 通过 | `server/__tests__/p1-row-policy-templates.test.ts`「RTP-01 — a template compiles to the same grant as the equivalent inline policy, and the `in` value order does not change the semantic digest」 |
| RTP-02 | 通过 | 同上「RTP-02 — the template ANDs with the inline predicates inside one selector, the Roles OR, and the Agent ANDs on top of the union」 |
| RTP-03 | 通过 | 同上「RTP-03 — a missing reference, an illegal op and empty predicates all fail closed, and the reason is distinguishable from the catalog state」 |
| RTP-04 | 通过 | 同上「RTP-04 — a referenced template cannot be deleted (zero writes), an unreferenced one saves through the dry-run, and an external missing reference fails closed」 |
| RTP-05 | 通过 | 同上「RTP-05 — a template change moves the policyVersion, the runtime confirms it without a restart, and the protected-tool gate does not move」 |
| RTP-06 | 通过 | 同上「RTP-06 — a stale preview cannot be committed; a fresh dry-run is required before the save」 |
| RTP-07 | 通过 | 同上两条：「RTP-07 — the durable intent is persisted before the configuration write and the terminal after it」＋「RTP-07 — a runtime that does not confirm the write rolls the configuration back and never reports the write as acked」 |
| RTP-08 | 通过 | 同上「RTP-08 — a template that cannot be bound is visible with its reason before the save」 |
| RTP-09 | 通过 | 同上「RTP-09 — the template audit carries the actor, the operation id, the before/after digests and the impact surface — and no secret」 |
| RTP-10 | 通过 | 同上 `describe("RTP-10 — an existing configuration without templates behaves exactly as before")` →「the expansion leaves a template-free configuration untouched」 |
| RTV-01 | 通过 | `server/__tests__/p1-row-policy-views.test.ts`「RTV-01 / RTV-02 — the union keeps its shape」→「two restricted Roles stay two OR branches and never become 全部行」 |
| RTV-02 | 通过 | 同上「only a real `all` branch makes the union 全部行」 |
| RTV-03 | 通过 | 同上 `describe("RTV-03 — the four states never share one empty state")` 四条：「无授权: no Role grants the table」「不可满足: the Agent's own row limits prune every branch」「编译失败: the Role that covers the table cannot be compiled」「空筛选: a filter that matches no table」 |
| RTV-04 | 通过 | 同上「the same-named table of another connection never merges」＋「the view is read-only: it never changes the configuration」＋ W8 回归两条「RTV-04 — two tables whose concatenated keys collide stay two tables」「RTV-04 — another Schema's grant is never shown for the requested table」 |
| RTV-05 | 通过 | 同上「one broken Role plus one healthy Role is `partial`, not `unavailable`」＋ W8 回归「RTV-05 — a total compile failure is `unavailable`, never 「0 张表」」 |
| **RTV-06** | **通过（**本次补 1 条**）** | 既有：`server/__tests__/p1-row-policy-reconciliation.test.ts`「RTV-06 — 同快照下三面表集合一致；授权路径数与去重表数分别表达、不混用」（行权限视图／授权摘要／访问关系图三面，逐个相等；去重表数 3 ≠ 授权路径数 5）。**本次新增**：`server/__tests__/p1-row-policy-closure.test.ts`「RTV-06 — 详情面的角色数与 Agent 数等于清单面的同一张表；详情面不串别的表的角色」（补**详情面**这一半） |
| **RTV-07** | **部分通过** | 本次新增 `src/__tests__/row-policy-view-readonly-a11y.test.tsx` 7 条（无写 API／键盘可达 ×2／焦点／表格 Base Contract／翻译防御 ×2）＋ `server/__tests__/p1-row-policy-closure.test.ts`「RTV-07 — 反查视图的两个端点只有 GET；写方法一律 404」；另有 1 条 `it.fails`（**已知实现缺口**，见 §七） |
| **RTV-08** | **通过（本次补 2 条）** | 既有：`p1-row-policy-views.test.ts`「the response publishes the four snapshot identity fields」（**只断言字段非空，判据未被打假**）。**本次新增**：`p1-row-policy-closure.test.ts`「RTV-08 — 一个响应的四个身份字段来自同一份配置与同一代策略；清单面与详情面逐个相等」＋「RTV-08 — 刷新后快照身份明确更新：配置改了，旧身份不再被复用」 |

**实测（2026-11-01 复跑，干净 PATH）**：

| 组 | 文件数 | 用例数 | 结果 |
|---|---|---|---|
| 本批新增 | 2（`server/__tests__/p1-row-policy-closure.test.ts` / `src/__tests__/row-policy-view-readonly-a11y.test.tsx`） | **12**（11 通过 ＋ **1 条 `it.fails`**，见 §七） | 全绿（含 1 条预期失败） |
| P1-1 既有 | 8（`p1-row-policy-templates.test.ts` / `p1-row-policy-views.test.ts` / `p1-row-policy-reconciliation.test.ts` / `row-policy-view.test.tsx` / `row-policy-templates.test.tsx` / `row-policy-dnf-preview.test.tsx` / `role-row-policy-template.test.tsx` / `role-detail-row-policy-save.test.tsx`） | 119 | 全绿 |
| **合计** | **10** | **130 通过 ＋ 1 预期失败** | **全绿** |

## 三、本批补的东西（只加测试，**未改任何运行代码**）

**`webui/src/`、`webui/server/` 下的生产代码一行未改。** 本批只补**矩阵里有、仓里却没有任何断言**的那几句。

| 新增文件 | 条数 | 每条打假的是哪条验收标准 |
|---|---|---|
| `webui/server/__tests__/p1-row-policy-closure.test.ts` | 4 | **RTV-06**（**详情面**与清单面同源：角色数／Agent 数一致、详情面不串别的表的角色、与授权摘要的角色集合不打架）／**RTV-08**（一个响应的四个身份字段来自**同一份配置**与**同一代策略**；清单面与详情面逐个相等）／**RTV-08**（刷新后身份**明确更新**，旧身份不被复用）／**RTV-07**（反查视图的两个端点**只有 GET**，写方法一律 404——「页面无写 API」的服务端一半） |
| `webui/src/__tests__/row-policy-view-readonly-a11y.test.tsx` | 7 ＋ 1 `it.fails` | **RTV-07**：页面只发 GET、无表单、无写控件；五个筛选控件按阅读顺序可聚焦、无正 `tabindex`、普通表格不产生额外 Tab 停靠点；交互控件是原生 `<button>`／`<a>` 而非 `div` 冒充；选中表后焦点留在触发控件上；数据网格 Base Contract（`pl-data-grid`／`pl-data-table`／frame／scroll／`th scope="col"`／选中行 `aria-current`）；翻译防御逐个标识检查 ＋ 全页机器标识扫描 |

### 变异验证：这些用例不是空转

对新补的断言逐条做了**变异测试**（改坏实现 → 对应用例必须转红 → 改回；脚本用完即删，工作树已复原）。**7 个变异全部命中**：

| # | 变异 | 转红的用例 |
|---|---|---|
| M1 | 去掉表身份 `<span>` 的 `translate="no"`（`RowPolicyView.tsx`） | 前端「翻译防御：连接／Schema／表／角色／Agent／字段标识与快照身份都受翻译防御」 |
| M2 | 把选表的 `<button type="button">` 换成 `<div>` | 前端「交互控件是原生 button，不是 div 冒充」 |
| M3 | 给筛选控件加 `tabIndex={1}` | 前端「五个筛选控件按阅读顺序可聚焦，没有正 tabindex 停靠点」 |
| M4 | 给只读页加一个「保存」按钮 | 前端「页面无写 API：所有请求都是读方法，页面上没有写控件，也没有表单」 |
| M5 | 把 `configVersion` 换成常量（`server/admin/snapshot-identity.ts`） | 服务端「RTV-08 — 一个响应的四个身份字段来自同一份配置与同一代策略」 |
| M6 | 详情面丢掉一个角色分支（`server/admin/row-policy-views.ts`） | 服务端「RTV-06 — 详情面的角色数与 Agent 数等于清单面的同一张表」 |
| M7 | 给反查视图端点加一条 `POST` 写路由（`server/admin/routes/row-policy.ts`） | 服务端「RTV-07 — 反查视图的两个端点只有 GET；写方法一律 404」 |

## 四、工程门禁（2026-11-01 实测）

见 §六「复现命令」后的实测表。**全部 exit 0**。

**证据等级说明**：按 `DEVELOPMENT.md`「证据等级门槛：本机 ＋ CI 即可」，功能合同收口**不需要**客户环境证据——只有客户目标服务／真实升级／现场实例才能取得的结论归发布取证与交付层。因此本条**无 CI job 证据、无客户环境证据**这两点**不构成**把本条挂成未收口的理由；反过来，本条**不得**被读成「客户现场已验证」，也**不得**因为收口而放宽发布取证层的判据。本条的全部证据都是**本机自动化级**，**没有**任何一条是客户环境级或 CI job 级。

**selector contract 口径**：门禁当前整体为红是**既有基线**（fail 集 201 条 ＋ 57 条 warn 级 `ORPHAN`）。判据是「**不新增 issue**」——本批新增文件全部落在 `webui/server/__tests__/` 与 `webui/src/__tests__/`，门禁不扫这两个目录，且**未新增任何 `data-testid`**，因此本批新增 **0** 条 issue。

## 五、残余

1. **RTV-07 的「翻译防御」剩 1 处真实实现缺口**——见 §七。按硬约束**未改运行代码**，如实登记并交 PM 决策。
2. **RTV-06 的一半证据借自 L25-08 自己的契约测试**。L25-01（授权摘要）已于 2026-11-01 收口（ASV-01–ASV-14 全部关闭），**L25-08（访问关系图）自身的验收矩阵（Spec 187 的 SC-01–14）仍未执行**。本条**只借用** L25-08 的实现与契约测试作为「同快照表集合一致」的**行为证据**，**不构成对 L25-08 的验收判定**，也**不回开**它。若 L25-08 的实现变更，本条的跨面断言必须重跑。
3. **浏览器实测与移动窄屏验证未执行**——按 Spec §7／§9 与「闭口层级」**不在本条出口**，不构成收口阻塞。
4. **E2E／real-e2e 目录下的用例未被引用为验收证据**：`webui/tests/e2e/specs/p1-row-policy.spec.ts`（含浏览器版 RTV-07）与 `webui/tests/real-e2e/row-policy-templates-v025.spec.ts` 按 Spec 自身约定**不属本条出口**。本条用的是**组件级与服务端级**的自动化断言。
5. **全仓存在既有跨文件隔离 flake**（`context-policy-invalidation.test.ts` 等，聚集在 ktx.yaml／project-root／connections 线），与本条无关，未修也未计入本条失败数。

## 六、不在本次收口里

- **镜像构建、部署、客户交付、客户环境验证**——本条收口**不表示可上线**，也不构成客户包验收。
- **整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级**——归发布取证层。
- **L25-08（访问关系图）自身的验收矩阵**（Spec 187 的 SC-01–14）——本条**不碰**。
- **P0-2 的 R2／R4／R5 与 V01–V22、D-03、C14–C19、Wave 0b、`blocked_delivery`**——本条**不改**这些状态；L25-14 台账只同步 P1-1 相关的那一句。
- **P1-2／P1-3／P1-4／P1-5 的 Spec、Plan 与验收矩阵**——本条**不碰**；共用 Plan 只改了「版本／状态」一行，并写明本批只收口 W1。
- **模板管理的写合同（RTP-04–RTP-07、RTP-09）之外的写入语义**——不属于本条承诺。

## 七、发现但**没有修**的真实实现缺口

**1 处**，落在 RTV-07 的「翻译防御」一项上。

| 项 | 内容 |
|---|---|
| 位置 | **`webui/src/components/admin/RowPolicyDnfPreview.tsx:215-217`**（并集小节标题里的「来源角色」列表） |
| 现象 | 该 `<span>` 渲染 `来源角色：east_role、west_role`，**没有** `translate="no"`、**没有** `notranslate` |
| 与 Spec 的差 | 本 Spec「Terminology Compliance」的 Protected DOM 段要求**角色／Agent／连接／Schema／表／字段标识**均须 `translate="no"` + `notranslate`。同一个角色 id 在同页的**角色链接**上（`RowPolicyView.tsx:758-762`）是受防御的，在**这个列表**里不是——是遗漏，不是有意设计 |
| 影响哪条验收编号 | **RTV-07**（只读与可达性 —— 「翻译防御满足设计规范」） |
| 为什么没有修 | 硬约束：本次是「补验收证据」，**不改生产代码**。按流程记为「真实实现缺口／阻塞」，交 PM 决策 |
| 留下的机器可见痕迹 | `src/__tests__/row-policy-view-readonly-a11y.test.tsx` 里一条 **`it.fails`** 用例「RTV-07 翻译防御（真实实现缺口）：并集小节的「来源角色」列表尚未受翻译防御」——它断言**正确**行为，今天失败；实现修好后该用例会以「预期失败却通过」转红，强制删掉 `.fails`。另有一条全页机器标识扫描用例，把这条缺口登记在**唯一**的已知缺口名单里（`KNOWN_UNDEFENDED`）：**再出现任何新的没受防御的机器标识，那条扫描用例立即转红** |

**2026-11-03 关闭**：上表这 1 处缺口已由 `70f27ba0` 修复——`webui/src/components/admin/RowPolicyDnfPreview.tsx` 的「来源角色：{角色 id 列表}」段现在带 `notranslate` + `translate="no"`（`data-testid="row-policy-dnf-source-roles"`），不再是上表记录的未受防御状态。随之，`src/__tests__/row-policy-view-readonly-a11y.test.tsx` 里那条登记缺口的 `it.fails` 已去掉 `.fails` 并改为正向断言「RTV-07 翻译防御：并集小节的「来源角色」列表受翻译防御」，全页机器标识扫描用例的 `KNOWN_UNDEFENDED` 名单清空。RTV-07 因此关闭，现值见 Spec 头部与 §8.1。**本条不扩大出口**——浏览器实测与移动窄屏、镜像构建与部署、客户环境验证与客户交付仍不在本条出口。

**同一组件在角色详情页上的同一处遗漏**（P0-2 的行权限管理页面）不在本条范围，本条**不碰**。

## 八、复现命令

```bash
cd /private/tmp/ktx-c-tier/webui
CLEAN_PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "minimax" | tr '\n' ':')
env PATH="$CLEAN_PATH" npx vitest run --maxWorkers=1 \
  server/__tests__/p1-row-policy-closure.test.ts \
  server/__tests__/p1-row-policy-templates.test.ts \
  server/__tests__/p1-row-policy-views.test.ts \
  server/__tests__/p1-row-policy-reconciliation.test.ts \
  src/__tests__/row-policy-view-readonly-a11y.test.tsx \
  src/__tests__/row-policy-view.test.tsx \
  src/__tests__/row-policy-templates.test.tsx \
  src/__tests__/row-policy-dnf-preview.test.tsx \
  src/__tests__/role-row-policy-template.test.tsx \
  src/__tests__/role-detail-row-policy-save.test.tsx
```

> 必须用干净 PATH：本机 `/Users/forrest/.minimax/shims/rm` 是 `mavis-trash` 垫片，非交互子进程里 `rm -rf` 会挂死不返回。

**预期输出**：`Test Files 10 passed (10)` ／ `Tests 130 passed | 1 expected fail (131)`。那 1 条 expected fail 是 §七 登记的实现缺口，**不是**本条失败。
