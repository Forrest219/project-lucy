# 零绑定 MCP 问数隐藏 begin Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / **v0.7** / 2026-11-20 |
| 状态 | **v0.7；终稿已确权；T1–T5 已实现并 commit**（Wave A–D；vitest **109 PASS**；demo 冒烟：tools/list 无 begin＋直调 `begin_not_available`）。预算／ACL 待商议且本条不改；OQ-3 数值待采样前冻结；测试台 NOT RUN；T6／R 另授；不入新增核心分母；≠ 功能合同收口；≠ 可上线。 |
| 功能编号 / 优先级 | P1-60／REQ-030-081；P0 主路径修复；沿用 P0-1 核心分母，不重复计数 |
| 台账号 | 无；挂 0.30 产品线执行总账 |
| 授权边界 | **T1–T5 已授权并已 commit**。**仍禁止未另授**：push；Docker／R／ZB 全真与 INDEX PASS（T6）；关闭预算、改 ACL、隐藏 continue、KTX。预算／ACL 未获变更决议（OQ-4） |
| 总账与需求 | [执行总账](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[需求池](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) |
| 配对 Plan | [实施计划](../plans/lucy-20261119-webui-publish-caliber-registry-repair-plan.md) |
| 测试台 | [UAT-SUITE-BEGIN-ZERO-BINDING](../qa/uat/suites/begin-zero-binding/suite.md)；判定只见 [INDEX](../qa/uat/INDEX.md)，尚无跑次 |
| 评审依据 | [首轮决议](../reviews/2026-11-19-begin-zero-binding-review-decisions.md)；[隐藏决议](../reviews/2026-11-20-begin-hide-decision.md)；[新定位复审](../../inbox/20261120-kimi-begin-hidden-positioning-review.md) |
| 复盘 | [测试漏检与已发现问题未独立跟进](../lessons/2026-11-19-begin-zero-binding-test-gap.md) |
| 适用环境 | Docker 单实例单副本；纯 MCP Token，无 WebUI Session／person／attestation |
| 既有合同 | [P0-1](lucy-20261107-question-type-caliber-binding-spec.md)；[问询审计 173](../../webui/docs/173-audit-one-question-one-inquiry-spec.md)；[问询预算 162](../../webui/docs/162-customer-query-experience-and-usage-evidence-spec.md)；[冻结预算优化 D6](lucy-20261029-question-budget-window-optimization-spec.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：可信 inactive 的普通纯 MCP 问询不暴露 begin，默认 catalog／source→query；强制调用 begin 只得到已定义的当前不可用结果，不新增注册表依赖、状态写入或后续查询门禁；现有预算、续查、ACL、行权限和真实强制快照不变。
- 本条出口：SC-01–SC-12 的模块／协议自动化、真实进程局部状态与发布边界验证。完整 Agent 旅程和系统重启归 R，不倒挂为局部函数出口。
- 不在本条出口：启用后 B／D、D6 轮次改造、有效归属原子事务、新持久表、C1／C2 begin 崩溃恢复、完整有绑定普通发布修复、KTX 修改、出包或线上恢复。
- 上线关系：本条收口不表示可上线；候选准备主张纯 MCP 用户体验恢复时执行 R，结果进入 runs／INDEX。

## 1. 定位与取舍

begin 同时承担原文上报、预算轮次声明和固定口径激活，但当前没有正式启用的口径绑定资产，默认引导每个问题调用 begin 属于超前曝光。本条在可信 inactive 下从 `tools/list`、initialize 和角色指导中隐藏 `lucy_begin_question`，让普通问数直接走 N（不 begin）。

隐藏不等于删除协议处理器，也不等于改写 ACL。已经缓存工具描述的客户端仍可能强制调用，因此必须有独立的无副作用拒绝分支。隐藏会减少显式原文覆盖；保留真实调用审计、推断归属和覆盖分母，不伪造已上报原文。P3／P4 的实际补偿任务仍须验收。

active／unknown 的绑定治理不因本条被清空。启用后是否重新露出 begin、如何处理 B／D、D6 和有效归属事务，是未来正式启用合同的范围，不是当前修复前置。

## 2. 事实与证据边界

- 既有测试曾以组件手动提交和 query 成功代替普通发布后的真实 begin 断言；当前不再用该证据支持隐藏后的行为。
- 当前源码确认普通发布缺少注册表提交，以及缺失／空目录摘要不同；线上 unresolved 的逐次内部原因仍未完全查明。本条解决当前零绑定曝光与主路径，不声称修复全部注册表事故。
- 当前 `LUCY_ENABLE_QUESTION_TOOL=false` 会联合隐藏 begin 与 `lucy_continue_question`，不能直接作为本条实现；续查工具和预算指导必须保持。

## 3. 决策

| ID | 决策 |
|---|---|
| D1 | 可信 inactive 下，`tools/list`、initialize 与角色指导均不含 begin；默认只走 N |
| D2 | 隐藏期合法身份强制 call begin 返回 `reason=begin_not_available`、工具级 `isError=true`；在生成 ID、校验业务参数、写 turn／预算／BindingSession 或加载注册表之前结束 |
| D3 | 参与分类复用现有注册表凭据、当前注册表和 BindingSession，不新增 schema、第二份参与配置或用户开关 |
| D4 | N、重连和隐藏期强制 call 不新开预算轮次／窗口、不清零额度；`lucy_continue_question` 的可见性、续查和指导不变 |
| D5 | active／unknown 不伪称 inactive；旧 committed 强制快照继续约束。隐藏只改变 inactive 的工具曝光与直接调用，不放宽数据面授权 |
| D6 | N、强制 call 和后续 query 分别断言；query 成功不能掩盖隐藏失败或强制 call 副作用 |

### 3.1 参与分类与可见性

| 分类 | 现有证据 | 工具面／调用行为 |
|---|---|---|
| inactive | 可信 committed 空注册表，或无凭据且无业务绑定文件／全部作者文件可解析为 draft；当前 scope 无应保留的强制旅程 | 隐藏 begin；合法强制 call 走 D2 |
| active | 现有可信注册表含至少一条已发布绑定 | 保持现有 begin 与绑定合同；本条不新增工具列表刷新承诺 |
| unknown | prepared／损坏凭据、字段或内容不一致、无凭据但存在 published／状态不可读文件、读取失败，或 scope 强制快照不确定 | fail-hidden，不主动曝光；强制 call 进入既有治理链并返回真实 unresolved，不套用 D2 |

旧 committed `fileCount=0` 可兼容为 inactive，不要求补空提交或 reindex。可信 inactive 不继承既有 `registry.usable=false`、`syncPending` 或 source map 恢复失败为新的 begin／query 门禁；这些信号只约束 active／unknown 治理链。

旧 committed bound 会话即使全局撤销到零，query 仍按旅程快照执行。L0 仅指全局可信 inactive、当前 preparing 的 bindingId／boundKey／caliberSnapshot 全空、previousCommitted 不存在或同样为 no-hit 的旧可选记录，可读时按非强制处理；任一强制字段非空、previousCommitted 为 bound 或历史不完整均为 L1／unknown。L0／L1 分类不得触发新预算轮次或 catch-all 清会话。

### 3.2 身份、授权与预算顺序

现有 Token 有效性、Agent 启停、撤销、工具授予和全局拒绝先按原顺序执行。只有通过这些既有准入且当前为 inactive 的 begin 调用才返回 D2；隐藏不是新的 ACL 授予或拒绝规则。

query／read_source／explain 继续执行现有 ACL、来源、字段、行权限、预算和其他执行准入。无关 source map 故障若独立影响 query，按同条件 N 对照如实归因，不借隐藏 begin 宣称数据面编译问题已修复。

N、MCP 重连和 D2 不改变预算 round／window／calls／busyMs／续查状态；后续合法 query 仍正常消费。预算存储整体不可用且基线 query 也拒绝时保留 `question_budget_unavailable`，不算 begin 增量阻断，也不得关闭预算修绿。

### 3.3 MCP 结果与审计

D2 沿用 JSON-RPC 工具结果，HTTP 200 不代表工具成功。`result.isError=true`，安全载荷至少包含 `reason=begin_not_available` 与 trace；文案说明“当前未启用问询上报，可直接按现有权限查询”，不得回传凭据、服务器路径或不可见绑定对象。

D2 不返回伪造 turnId，不写 conversation turn，不发布新有效归属，不回填旧调用。调用审计记录真实拒绝；后续 query 按现有有效指针／推断／unassigned 规则归属，record_only 不属于本条新增状态。

### 3.4 发布与缓存边界

inactive 的普通 Wiki／Manifest 发布不改变隐藏状态，不要求注册表就绪。draft 或未提交候选不成为 active；无凭据的 published／不可读候选归 unknown。

active 的既有工具面行为保持不变。本条不新增 `notifications/tools/list_changed`，也不承诺已缓存 tools/list 的客户端自动刷新；未来露出合同若要求即时可见，必须另补通知／重列与客户端验收。当前 RC1 只验 inactive 的 N＋隐藏面。

## 4. 核心流程（伪代码）

```text
tools_list_or_initialize(identity, session):
  subject := existing_authentication_and_admission(identity)
  participation := classify_from_existing_registry_credential_and_scope(session)
  visible := existing_allowed_tools(subject)
  if participation is not active:
    visible := visible - lucy_begin_question   # inactive／unknown 均不主动曝光
  keep_lucy_continue_question_and_all_other_visibility_unchanged(visible)
  return existing_protocol_response_without_begin_guidance(visible)

begin(request):
  subject := existing_identity_agent_token_and_tool_authorization(request)
  if subject denied: return existing_denial_without_mutation
  participation := classify_from_existing_registry_credential_and_scope(request.session)
  if participation is unknown:
    return existing_governed_unresolved_without_clearing_state()
  if participation is inactive:
    return tool_error_begin_not_available_with_trace()  # 在 ID／业务参数／存储／注册表副作用之前
  return existing_active_begin_contract(request)         # 本条不改 D6／归属实现

query_or_read_source_or_explain(request):
  apply_existing_auth_acl_fields_row_policy_budget_source_and_admission_rules()
  enforce_real_committed_or_unknown_strong_binding_as_existing_contract()
  otherwise_no_begin_required_or_empty_binding_registry_ready_gate()
```

## 5. 功能验收 SC（F 选择器）

| SC | 本条不变量 | 证据形态 | UAT 映射 |
|---|---|---|---|
| SC-01 | inactive 的 list／initialize／角色指导无 begin；N 合法成交；未露出 begin 但授 query 者可用 | 真实协议与指导装配 | ZB-01 |
| SC-02 | 合法强制 call 返回 begin_not_available；无 ID／turn／预算／BindingSession／注册表副作用，后续 query 成交 | 真实 Proxy、前后状态与调用计数 | ZB-02 |
| SC-03 | I0–I4 与旧空凭据可信零可隐藏；无凭据 published／不可读候选为 unknown | 实际文件、现有凭据与恢复读回 | ZB-03／09 |
| SC-04 | draft／普通发布前中后保持隐藏；N 不新增绑定等待，终态成交 | 真实发布接口与时间线 | ZB-04 |
| SC-05 | N／重连／D2 不切换预算；continue 工具、指导、续查与现有额度保持 | 实存储预算、round／window／计数与续查正负例 | ZB-05／06 |
| SC-06 | Token／Agent disabled／global deny、工具授予及行权限不因隐藏改变 | 权限正反例、拒绝未执行及恢复后成交 | ZB-06 |
| SC-07 | active／unknown 不套 D2；A0 允许／偏离、T0 旧快照、U0／L1 防绕过保持 | 正式控制入口与真实会话状态 | ZB-07／09 |
| SC-08 | 隐藏后显式原文覆盖诚实为 0；调用／推断／缺失分母可复算，运维定位与管理判断补偿可执行 | 实际审计与脱敏任务证据 | ZB-08 |
| SC-09 | D2 不污染后续 query／read_source／explain；无关 source map 故障不新增本地上报门禁 | 最小工具正反例；细粒度变体在 F | ZB-09 |
| SC-10 | N 默认 begin 调用数 0；D2 注册表加载／提交数 0；性能只比较 N，不把预期隐藏拒绝计成产品回归 | 实际计数与固定采样 | ZB-10 |
| SC-11 | 重启后 inactive／active／unknown、L0／L1、T0 新旧会话分类正确；本条无 C1／C2 begin 写入恢复 | 真实局部持久化与进程恢复 | ZB-11 |
| SC-12 | 未修改 RC1 默认 N 成交、list 无 begin；幻觉 call 得 D2 后不反复重试且最终答案正确 | 真实 Agent 全轨迹 | ZB-12 |

## 6. 受影响画像

事实源：[user-personas.md](../governance/user-personas.md)。下表为合同预期，未执行的补偿不是已证成；同画像按最差子面判整体。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向补偿 |
|---|---|---|---|---|---|
| P1 问数方 | 问数面会被可选 begin 故障影响；报告面沿现有 Live Report | inactive 隐藏 begin，N 成交；报告入口及授权不变 | 问数面 ↑／报告面 ＝，整体 ＝ | SC-01／02／12 | — |
| P2 治理方 | 未启用绑定也需理解 begin／注册表；权限面由 Token／工具／表行规则决定 | 可信零无需补空提交；权限与预算配置不变 | 语义口径面 ↑／权限授权面 ＝，整体 ＝ | SC-03／06／07 | — |
| P3 运维方 | 有显式上报关联，但 begin 故障影响问数 | 显式覆盖下降，以请求／trace／身份／版本定位并核恢复；交付路径不变 | 运行观察面 ↓（补偿待验）／交付运维面 ＝，整体 ↓ | SC-08／ZB-08 | 纯 MCP 下用只读调用证据定位强制 call／查询故障，解除隔离问题后同 Token 成交；未成功不收口 |
| P4 管理层 | 可读显式／推断摘要，业务问数可受 begin 阻断 | 显式覆盖下降但分母可复算；N 业务结果可核对 | 口径质量面 ↓（补偿待验）／业务结果面 ↑，整体 ↓ | SC-08、ZB-01／08 | 管理只读摘要区分显式／推断／缺失与真实成败，不声称取得未上报原文；SC-08／ZB-08 必验 |

若补偿任务失败，保留下降并回治理裁决；本稿不代委托人批准无补偿损失。未命中 P1 问数面↓或 P3 交付运维面↓的专项复核，跨画像最差口径仍适用。

## 7. 兼容关系与未来边界

| 既有合同 | 本条处理 |
|---|---|
| P0-1 D11／O1 | inactive 不再暴露或执行 begin；active／unknown 保持既有强制合同。历史 CLOSED 不回写为本条结果 |
| Spec 173／162 | 无 begin 的推断审计和预算路径保持；D2 不创建显式记录或有效归属 |
| 冻结预算优化 D6／§6.1／§6.5 | 本条不改真正新 begin 的既有语义，也不实施新的轮次／归属事务；未来露出时再评审 |

v0.5 的 OQ-2 新表／原子事务和 C1／C2 方案不再属于本条出口。普通 WebUI 有绑定发布修复仍另段，不能倒挂当前零绑定隐藏与 N 恢复。

## 8. 决策状态与实施门槛

- **OQ-1（闭合为复用方案）**：只复用现有凭据／注册表／BindingSession 分类，不新增参与格式或第二份计数。
- **OQ-2（移出本条）**：预算＋有效归属原子事务、新表和 C1／C2 属未来露出合同，不是当前待实施项。
- **OQ-3（数值待冻结）**：N 每组每轮 100 问、三轮各算 nearest-rank p95，预热与随机交错固定；实际基线、资源指纹和绝对／相对容差在采样前冻结，不得测后放宽。
- **OQ-4（待商议但边界明确）**：预算／ACL 没有变更授权；本条不得关闭预算、隐藏 continue、修改授予表或行权限。该待议项不阻断纯隐藏与 N 修复。

终稿确权与 T1–T5 开发授权已获得；实现仍须按 SC 证明。T6／R 未授权执行；测试台保持 NOT RUN，直至另授。

## 9. 评审处置对照

| Finding | 本条落点 |
|---|---|
| F-01 预算轮次 | N／重连／D2 不切换；D6 改造移出本条 |
| F-02 部分写入 | D2 在任何状态写入前返回；G1／G2／G5 不再是当前出口 |
| F-03 画像补偿 | §6 与 ZB-08 保留真实任务验收 |
| F-04 既有客户端 | RC1 只验 N＋隐藏面＋强制 call 后成交 |
| F-05 负控 | SC-03／06／07／09／11 保留 active／unknown、L0／L1 和其他工具边界 |
| F-06 覆盖矩阵 | fixtures M01–M10 全部统一为当前 N＋隐藏面范围 |
| F-07 控制入口 | 普通发布与 A0／T0 正式控制分开，不用 reindex 修绿零绑定 |
| H-01 超前建设 | OQ-2 新表／事务／恢复移出本条 |
| H-02 隐藏控制流 | §4 在写状态前返回 D2，SC 全部同步 |
| H-03 联合开关 | §2／D4／SC-05 明确 continue 不受影响 |
| H-04 工具缓存 | 本条不承诺动态刷新；未来露出另审 |
| H-05 验收口径 | 性能只比较 N，预期 D2 单独判定 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: 无新增产品名称。`begin_not_available` 是协议拒绝原因；inactive／active／unknown 是内部派生状态，不作 UI 产品概念。沿用“问题类型口径绑定”“生效绑定”“问询预算”。

## 交互合同豁免

- 原因：本条仅修改 MCP 工具可见性、协议拒绝和调用指导，不改变用户可见 WebUI 表面
- 不改变：WebUI 页面路由、组件、按钮、布局与交互；不要求浏览器或移动窄屏测试

## Design System Compliance

### Referenced Specs

- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/07-mcp-auth-proxy-spec.md`

### What This Change Follows

沿用 MCP 结果承载位与现有工具名称，不新增 UI；隐藏不改变 ACL 授予表。

### Exceptions (If Any)

无 WebUI 设计改动，按上述交互合同豁免。

### Follow-up Needed

真实 RC1 隐藏与强制调用兼容由 SC-12／ZB-12 验证；未来若新增管理 UI 或动态露出，另补合同。
