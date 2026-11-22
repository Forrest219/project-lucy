# Wiki 覆盖上传采用 YAML 授权声明 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v0.2 |
| 日期 / 产品线 | 2026-11-20 / 0.30.0 |
| 功能编号 / 优先级 | P1-65／REQ-030-086；事故修复／治理主路径；不入核心分母 |
| 台账号 | 无 |
| 阶段 | S5 |
| 状态 | v0.2。终稿已确权；开发授权已获得；实现完成；四项验证缺口已整改；改后 Docker UAT＝PASS（见测试台 INDEX）；功能合同已收口；不入核心分母；≠ 可上线。 |
| 授权边界 | 委托人已授权四项缺口整改、真实 UAT、清理与收口复核；本轮追加授权仅 commit 本任务；不 push、不发布，≠ 可上线 |
| 需求 / 计划 | [REQ-030-086](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) · [总账 P1-65](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [Plan](../plans/lucy-20261120-wiki-upload-acl-adoption-plan.md) |
| 复现证据 / 测试台 | [历史 Docker 基线](../qa/uat/suites/wiki-upload-acl-adoption/runs/2026-11-20-cursor-docker-baseline.md) · [本轮收口复核 PASS](../qa/uat/suites/wiki-upload-acl-adoption/runs/2026-11-20-codex-closure-recheck.md) · [测试台](../qa/uat/suites/wiki-upload-acl-adoption/suite.md) |
| 相关合同 | [Spec 193 §5.2–5.4／§9.1](../../webui/docs/193-business-wiki-access-management-spec.md)（业务 Wiki 访问权限）；本条替代 §5.3 的差异态隐式可提交默认，不废除「覆盖上传不得静默采用上传声明」的安全前提，只补「差异可见＋显式选择＋可逃生」 |

## 闭口层级

- 层级：功能合同
- 本条承诺：治理方用 Markdown（含 YAML frontmatter `allowed_roles`）覆盖上传已有 Wiki 时，若上传声明与现有授权不一致，不得在无披露、无显式选择的情况下提交并剥掉上传声明；选择「采用上传／保留现有／重新设置」后写入结果与预检一致；合法问数方在授权角色下仍可读 Wiki；管理访问权限仍为独立逃生。
- 本条出口：SC-01–SC-14（API 正确性、预检 UI 明示、digest 绑定、管理访问逃生、MCP 可读对照）。
- 不在本条出口：批量授权整包重做、语义层 YAML 上传、发布工作台「已生效」、客户现场规模压测、整包发布取证。
- 上线关系：本条收口不表示可上线

## 1. 已证实问题

2026-11-20 本机 demo Docker（`http://127.0.0.1:55176`）对 `global/demo-superstore.md` 实测：

1. 覆盖上传 Markdown 的 YAML 声明 `allowed_roles: [demo_readonly, lucy_admin, lucy_ops_reader]`，而页面现有为前两者。
2. 服务端建议与 WebUI 默认均为 `preserve_current`；提交成功后磁盘 frontmatter **写回旧 ACL**，上传 YAML 中的 `lucy_ops_reader` 被剥掉。
3. 改选 `use_uploaded` 并使用匹配 digest 提交后，三角色写入成功。
4. 用「保留」预检的 digest 提交「采用上传」→ `wiki_upload_preview_stale`。
5. 不带 `access` 提交 → `wiki_upload_access_required`。
6. 剥掉后走 `POST /api/wiki/:key/access/preview` + `PUT /api/wiki/:key/access`（管理访问权限）可将 YAML 意图补回。

根因锚点：`WikiEditor.computeUploadSelection` 对 replace **恒**返回 `preserve_current`；`resolveUploadAcl(preserve_current)` 用当前声明覆盖上传声明；预检虽有「来自上传文件」选项，差异时仍可在默认路径「看起来成功」却未采用 YAML。

## 2. 决策

目标实况：治理方在本机 demo Docker WebUI `/wiki` 上传；问数方使用仅有 Proxy Bearer 的纯 MCP 客户端（如 Cursor／Claude Code），不要求 WebUI 账号或宿主 attestation。本条不改 MCP 工具入参与 ACL 语义。

| 编号 | 决策 | 合同 |
|---|---|---|
| D1 | 安全前提不变 | replace 不得在用户未显式选择时采用上传声明。create 合法非空声明可从 `use_uploaded` 起算；missing／empty／all 沿用 Spec 193 §5.2 的空授权／全角色确认。 |
| D2 | 全部差异均须选择 | replace 且声明规范键不同，或任一声明 corrupt，初始 `selection=null`，提交禁用；显式选择 `preserve_current`／合法 `use_uploaded`／合法 `set` 后才可继续。覆盖加宽、收窄、角色替换、all 与 roles、roles 与 missing／empty、missing 与 empty 的差异。相同且合法的声明仍可默认保留。 |
| D3 | 差异披露 | 展示现有声明、上传声明及最终将写入；未选择时第三项明确为「待选择（尚未确定）」，服务端建议不得冒充已选结果。声明摘要区分未声明与显式 `[]`（两者运行时均无人可见）。说明默认不会采用上传授权；选择后展示对应最终声明、方向与通道效果。 |
| D4 | 预检绑定 | 每次选择变化重发 preview；等待期间提交禁用，只接受当前目标／原始 Markdown／选择的最新请求结果。commit 沿用 Spec 193 §5.4 的 digest／版本校验；最终 ACL 不匹配返回 `wiki_upload_preview_stale`，零写入。选择模式不同但最终 ACL 与其他绑定事实相同时，digest 可相同，不新增服务端选择模式签名。 |
| D5 | 故意保留 | replace 可显式保留当前声明，包括上传声明 corrupt 时。最终声明保留当前值；当前本身 corrupt 时保持原有拒绝状态，不冒充修复或授权可读。最终 missing／empty／all 仍须既有风险确认。 |
| D6 | 采用与重新设置 | `use_uploaded` 仅接纳合法上传声明，corrupt 禁用并给出原因；replace 可改选 `preserve_current` 或 `set`，create 无现有授权可保留，须 `set`。`set` 使用明确选择的角色，不回退到保留或上传声明；空／全角色须确认。 |
| D7 | 管理访问逃生 | `/wiki` 的「管理访问权限」保持独立可达；可从空授权或异常声明修复为合法角色，不以能通过 MCP 读该页为前提。不得手改 ACL 冒充上传采用。 |
| D8 | 问数主路径 | 对最终合法且非空、拥有相应 Wiki 搜索／读取通道的角色，`wiki_search`／`wiki_read` 仍成交；最终为空、当前 corrupt 被故意保留或角色被明确移除时，拒绝／搜索不可见是预期，治理方可经 D7 恢复后让合法 MCP 用户继续读。 |

### 2.1 声明比较与选择矩阵

比较的是声明，不只是可见角色集合。使用与服务端 `canonicalAclKey` 一致的规范键：`missing`、`empty`、`all` 各自不同；roles 按解析后去重、排序的角色 ID 集合比较；corrupt 不进入自动保留分支。不得直接复用会把 missing 与 empty 视为相等的 `wikiAclEquals` 作本条差异门禁。

| 模式／声明 | 初始选择 | 可达动作 |
|---|---|---|
| replace，合法声明同键（含角色重排／重复被解析归一化） | `preserve_current` | 直接保留；空／全角色仍须确认 |
| replace，合法声明异键 | 无 | 显式保留／采用上传／重新设置 |
| replace，上传 corrupt、当前合法 | 无 | 保留当前或重新设置；禁止采用上传 |
| replace，当前 corrupt（含两边均 corrupt） | 无 | 保留原拒绝状态，或采用合法上传，或重新设置；损坏上传仍不可采用 |
| create，上传 corrupt | 无 | 重新设置；无保留当前动作 |

### 2.2 预检失败与恢复

选择变化时撤销旧 digest 的可提交资格并清空空／全角色确认；旧请求晚到不得覆盖新结果。过期预检或文档版本冲突后保留原始 Markdown 与用户选择，重新预检并展示最新现有／最终声明；重新完成必要确认后可再次提交，禁止自动重试写入。预检请求失败在 Dialog 内说明原因，可取消后重开同一上传入口并重新选文件／选择，不允许以旧预检继续提交（SC-14、E3）。

## 3. 核心流程（伪代码）

```text
onInitialPreview(originalMarkdown, key, mode):
  # 不带 access 发起解析预检，服务端可返回建议与摘要；建议不代表用户选择
  p = requestPreview(key, originalMarkdown, mode, access=omitted)
  showCurrentAndUploadedDeclarations(p)
  needsChoice = mode == replace and (
    isCorrupt(p.current_acl) or isCorrupt(p.uploaded_acl) or
    declarationKey(p.current_acl) != declarationKey(p.uploaded_acl))
  selection = null if needsChoice else initialSelectionPerSpec193(mode, p)
  if selection == null:
    invalidateCommitDigest()
    showFinal("待选择（尚未确定）")
    showAvailableActionsPerMatrix()  # corrupt 也必须有保留／重设的可达路径
    disableCommit()
  else:
    onSelectionChange(selection)

onSelectionChange(selection):
  require selection is allowed by mode and corrupt matrix
  clearRiskConfirmations()
  invalidateCommitDigest()
  requestId = nextPreviewRequestId()
  p = requestPreview(key, originalMarkdown, mode, selection)
  if requestId != latestRequestId or requestContext != currentContext: discard(p)
  else:
    showFinal(p.final_acl, p.direction, p.role_effects)
    bindCommitDigestToCurrentPreview(p)
    enableCommitOnlyIf(selection != null and previewFresh and confirmsOk and roleReady)

onCommit():
  require current preview is fresh and selection is bound to it
  send originalMarkdown, key, mode, selection, expected_version,
       preview_digest, confirmed_empty, confirmed_all
  # 服务端现有合同：Spec 193 §5.4；在共享写入队列内重读目标并重算候选
  require target existence and expected_version match
  resolution = resolveUploadAcl(exists, currentDeclaration, uploadedDeclaration, selection)
  require risk confirmations for resolution.acl
  digest = computeWikiAccessDigest(key, expectedVersion, resolution.acl,
                                  roleChannelVersion, mode, hash(originalMarkdown))
  require digest == preview_digest else wiki_upload_preview_stale with zero writes
  writeThroughExistingWikiMutationPrimitives(resolution)  # 不绕过队列、审计或扩权 hold
```

## 4. 验收（SC）

| ID | 要求 | 必做 UAT 映射（本轮收口复核＝PASS） |
|---|---|---|
| SC-01 | 全部合法差异及 corrupt 初始均无可提交默认；含加宽、收窄、角色替换、all→roles、roles→missing／empty、missing↔empty、roles→all；未选择不得发出 commit | 07·M1–M9、10 |
| SC-02 | 显式 `preserve_current` 成功；磁盘声明＝当前，正文按上传变更；UI 点击与预检披露另有证据 | 01、07·保留 |
| SC-03 | 显式合法 `use_uploaded` 成功；磁盘声明＝上传；收窄后被移除角色不得继续读 | 02、07·采用、06 |
| SC-04 | 以当前 B／上传 W 且 B≠W 准备负控，用保留预检 digest 提交采用上传，返回 `wiki_upload_preview_stale`；正文、ACL、文件版本零变化 | 03 |
| SC-05 | 缺 `access` 返回 `wiki_upload_access_required`；正文、ACL、文件版本零变化 | 04 |
| SC-06 | 未选时现有／上传／待选择可见；选后第三项与最终写入一致；两类无人可见声明可区分 | 07·E1／E5／E7 |
| SC-07 | 管理访问权限从独立准备的 B 改为 W，确有角色增量与版本变化；空／异常页也能恢复合法授权 | 05、10、12 |
| SC-08 | SC-02／03／07／11 及损坏声明修复后，纯 MCP 合法角色搜索命中并读到本次正文；被移除／未授权角色拒绝且搜索不可见；为空／保留 corrupt 时拒绝符合 D8 | 06（各写入检查点）、10、12 |
| SC-09 | create 合法非空声明可从 `use_uploaded` 起算；missing／empty／all 保持既有确认及合法重设路径 | 09 |
| SC-10 | 上传 corrupt 不能采用；replace 可显式保留合法当前值或重设；create 须重设；当前 corrupt 可故意保留拒绝状态或修复；拒绝有明确原因 | 10 |
| SC-11 | replace 显式 `set` 成功，最终值可不同于当前与上传；正文、ACL 与该次预检一致，不得回退 | 08、07·重设 |
| SC-12 | 合法同键声明可默认保留，不新增必选步骤；角色重排／归一化重复不误报差异 | 11 |
| SC-13 | missing／empty／all 的确认不可因新增显式选择而跳过；未确认零写入，确认后成功；确认随选择变更重置 | 09、12 |
| SC-14 | 预检乱序、失败及 stale 恢复不得复用旧摘要提交；合法用户可重新预检／取消重开后成功完成上传 | 07·E2／E3、12 |

交互设计合同 E1–E7 已由本轮真实前台可视 Chrome 复核通过，浏览器计时与 API 时间分列；证据见 [收口复核](../reviews/2026-11-20-wiki-upload-acl-adoption-closure-recheck.md)。

## 交互合同

- 路由：/wiki
- 基准页：/admin/agents
- 一件事：覆盖上传时看清授权差异并显式选择后再写入，管理访问权限仍可补救。
- 状态：首访：可打开上传预检；空：不适用：预检不提供空文档创建；加载：预检解析中可感知；错误：预检过期或缺授权有原因及重新预检／取消重开的可达下一步；0 条：不适用：本条不改列表筛选；成功：显式选择后可提交且将写入可见；部分：现有与上传声明不一致或任一损坏时须先选择，保留／合法采用／重新设置各有可达动作
- 主动作：预检确认提交为 primary；取消与重选为次要，不做多个同组 primary。
- 决定信息：现有授权、上传文件声明、提交后将写入、选择模式、错误原因。
- 术语：已登记，沿用 Terminology Compliance。
- 台账：无新台账
- 状态维度：预检授权选择与管理访问权限分区标明，同一状态维度不得互相否定。

## 元素清单

- E1｜/wiki｜首访｜上传预检与文档页｜可打开覆盖上传预检；管理访问权限入口可识别
- E2｜/wiki｜加载｜上传预检｜解析 Markdown 时可感知
- E3｜/wiki｜错误｜上传预检｜预检过期或缺授权有原因且不落盘；重新预检或取消重开后合法提交可成交
- E4｜/wiki｜成功｜上传预检与管理访问｜显式选择后可提交且将写入可见；管理访问保存后列表 ACL 更新
- E5｜/wiki｜部分｜授权区｜现有与上传声明不一致或任一损坏时须先选择；保留／合法采用／重新设置各有可达动作
- E6｜/wiki｜主动作｜预检页脚｜确认提交为 primary，取消为次要
- E7｜/wiki｜决定信息｜授权区｜现有／上传／将写入三摘要可见；未选时将写入标待选择，不冒充已决定

## 交互评审

- Q1 主任务能否从页头和主工作区开始，而不必先读 Spec：通过
- Q2 PageHeader 是否满足按钮规范 §3 第 8 条，其他 action group 是否各自最多一个 primary，并且与「不做」不冲突：通过
- Q3 空、错误、0 条是否在面板内写明原因；不适用是否写了原因：通过
- Q4 决定信息是否足够；截断或隐藏时能否看见原因：通过
- Q5 控件是否与基准页同一套；新模式是否指向已存在的设计系统章节：通过
- Q6 用户可见术语是否已登记，或已写在本 Spec 的 Terminology Compliance：通过

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 问数面依赖正确 ACL；报告面不涉及本次上传 | 问数面合法角色通过纯 MCP 仍可搜索／读取；明确收窄或空授权继续按原语义拒绝；报告面未变 | ＝ | SC-08；D8；不改 Live Report 路径 | — |
| P2 治理方 | 语义口径面可默认覆盖正文；权限授权面可能忽略 YAML 意图 | 语义口径面在声明差异时多一次确认；权限授权面明确采用／保留／重设，不再静默丢意图 | ↓（最差口径）；语义口径面 ↓／权限授权面 ↑ | SC-01–14；E1–E7 | 有 WebUI 的同一上传 Dialog 显式保留即可继续正文覆盖（SC-02／UAT 07·保留），同键不加步骤（SC-12）；预检失败可恢复（SC-14）；独立管理访问可补救（SC-07）。 |
| P3 运维方 | 无部署面变更 | 无部署面变更 | ＝ | 本条不改探针／镜像／Chart | — |
| P4 管理层 | 无概览指标变更 | 无概览指标变更 | ＝ | 本条不改审计概览合同 | — |

画像复核：P2 两子面方向不同，按最差口径登记 `↓` 并以上述同入口可成交验收补偿；不以授权面收益盖过正文维护成本。P1·问数面与 P3·交付运维面未判 `↓`，不触发额外产品级负向复核；主路径原则由 SC-02／07／08／11／14 正向成交覆盖。未发现需新增画像的实际受影响人群。

## Terminology Compliance

This feature follows [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md).

New terms: none. 复用「管理访问权限」「业务 Wiki」「上传预检」及既有 `allowed_roles`／Agent／Role 术语；专业英文节点继续 `notranslate`。

## Design System Compliance

### Referenced Specs

- [浮层规范 §3–4](../../webui/docs/design-system/15-components-overlay.md)：沿用 Dialog 分区、错误与可达性。
- [按钮规范 §3](../../webui/docs/design-system/10-components-button.md)：页脚一个 primary，选择与取消为次要动作。
- [状态规范](../../webui/docs/design-system/16-patterns-states.md)：加载、失败及可执行恢复。
- [Spec 193 §5](../../webui/docs/193-business-wiki-access-management-spec.md)：上传预检结构与风险确认。

### What This Change Follows

- 预检仍为 Dialog；授权选择落在既有预检分区；不新增平行「第二套上传」入口。

### Exceptions (If Any)

- 无。

### Follow-up Needed

- 实现阶段若新增文案键或视觉组件，按术语标准与 design-system PR 模板补登记。

## 修订记录

以下记录为各阶段历史快照，现值只以头部状态为准。

| 版本 | 日期 | 内容 |
|---|---|---|
| v0.2-recheck | 2026-11-20 | 四项验证缺口实测整改完成：51 个独立验收 ID／153 份角色检查／306 条工具断言均通过，前台浏览器与遗漏子例补齐，233 页／9 个 Agent 清理、补轮 13 个 Token 吊销，最终零残留；重新判定功能合同收口。见 [本轮记录](../reviews/2026-11-20-wiki-upload-acl-adoption-closure-recheck.md)。 |
| v0.2 | 2026-11-20 | 独立终审通过；委托人明示本提示词＝终稿确权（免 Codex CLI）；开发未授权。见 [终审记录](../reviews/2026-11-20-wiki-upload-acl-adoption-review.md)。 |
| v0.2-close | 2026-11-20 | GAP 补跑后 Docker UAT＝PASS；SC-01–14 证据齐；功能合同已收口；≠ 可上线。 |
| v0.2-uat | 2026-11-20 | 改后 Docker UAT＝PASS WITH GAP；浏览器 E1–E7 抽样＋API R0／01–05／08／11 等；见测试台。 |
| v0.2-impl | 2026-11-20 | 开发授权已获得；实现完成待 UAT：`wikiAclDeclarationKey`／`wikiUploadNeedsExplicitChoice`、`computeUploadSelection` 差异／corrupt 起算 null、预检显式保留／采用／重设与「待选择」摘要；聚焦 vitest 161 PASS；改后 UAT NOT RUN。 |
| v0.2-review | 2026-11-20 | 按四项审阅意见补全差异矩阵与同键对照、损坏声明分支、逐例隔离／负控前提、UI 与 API 证据分工及 SC-01–14↔R0／01–12 映射；历史基线不重写。 |
