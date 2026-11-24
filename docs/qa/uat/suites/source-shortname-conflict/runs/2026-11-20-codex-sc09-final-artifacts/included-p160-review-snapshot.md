# P1-60：890a0394 最终交付评审

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-20（Asia/Shanghai） |
| 候选 | `890a0394651cc4c875c559d3211228e20e6232b3` |
| 合同 | [Spec v0.7](../specs/lucy-20261119-webui-publish-caliber-registry-repair-spec.md)、[Plan](../plans/lucy-20261119-webui-publish-caliber-registry-repair-plan.md)、[UAT v0.5](../qa/uat/suites/begin-zero-binding/suite.md) |
| 结论 | **退回修复，当前不建议交付用户更新**；不是以客户环境缺失打回，而是本机已有反例证伪本条合同 |
| 授权边界 | 只读实现／Docker 身份核对、现有定向测试及 inbox 临时评审探针；未改运行代码／产品配置，未发布、重启、构建或执行完整 R |
| 证据等级 | 本机模块／真实本地 Proxy＋替身上游；Docker 仅版本与源码哈希；均不冒充真实数据库／真实 Agent 完整 UAT |

## 1. Findings（按严重程度）

### R-01 [P1] 合同允许恢复的 L0 可选 preparing 仍会阻断查询

- 位置：`webui/server/proxy/caliber-binding-registry.ts:793–815`、`caliber-binding-session.ts:190–191`、`caliber-binding.ts:636–647`。
- 条件：全局已提交空注册表；scope 的 preparing 中 bindingId／boundKey／caliberSnapshot 全空，previousCommitted 不存在，符合 Spec §3.1 的 L0，未启用任何真实强制绑定。
- 实测：`classifyCaliberParticipation()` 返回 unknown；`checkCaliberBindingGate()` 返回 deny／`caliber_binding_unresolved`。这是实际模块与临时持久化状态的反例，不是只读源码猜测，也不是完整数据库 query UAT。
- 原因：分类只放行 never_begun／begun_no_hit；readBindingSession 将一切 preparing 归 lost_or_conflict，新增实现没有检查合同要求的可证明空绑定历史。查询门禁也没有 L0 适配。
- 影响：用户升级后若保留旧可选开题半状态，单纯隐藏工具并不能恢复该会话；原事故拒绝码仍存在。不能要求用户删会话、换 Token 或补 reindex 来满足主路径恢复。
- 退出：只对可证明 L0 安全恢复／适配，L1／旧 bound 仍拒绝或按快照执行；补旧态与重启后真实合法成交证据（SC-03／11，ZB-11）。

### R-02 [P1] 旧空凭据启动恢复后仍被全局注册表故障拖入 unknown

- 位置：`webui/server/proxy/caliber-binding-registry.ts:745–747`；既有 loader／recover 在同文件 §候选装载与恢复。
- 复现：无绑定目录→正常加载及提交空候选→凭据落盘创建内部目录→重置内存模拟注册表恢复→recover→classify。
- 实测：恢复为 `{usable:false, reason:"content_drift"}`，参与分类 unknown。提交前缺目录的 digest／sourceMapVersion 表示与内部目录创建后不同；新增分类在处理可信空兼容前先检查 syncPending／registry=null。
- 对照：Spec §3.1 明确旧 committed fileCount=0 可兼容 inactive，且可信零不能因 syncPending／source map 恢复失败重新进入 begin 门禁。当前未做到。此例不是要求把所有同步失败一律当空，真实强制历史必须保留负控。
- 影响：旧客户端强制调用不再得到约定的 begin_not_available，而进入 unresolved 治理链；需要额外恢复动作。不能以健康空快照的通过代替升级／恢复生命周期。
- 退出：区分可证明历史空与未知强制；补 I3 恢复／普通发布前后／本地拒绝无全库依赖的证据（SC-03／09／11，ZB-03／09／11）。

### R-03 [P2] 参与分类抛异常时反而重新曝光 begin

- 位置：`webui/server/proxy/mcp-proxy.ts:1453–1460`。
- 逻辑：shouldHideBeginQuestion 捕获异常后返回 false，即保留原有 begin 可见性；与 Spec 的 unknown fail-hidden 方向相反。
- 模块故障探针：让分类函数抛错，真实本地 Proxy 的 tools/list 重新包含 lucy_begin_question。此格为模块异常注入，未主张是真实存储故障 UAT。
- 影响：依赖读取异常时把本次要隔离的能力重新交给 Agent，增加再次调用故障工具的机会；不能将整个工具列表保持可用等同于保留 begin。其余工具和 continue 可以继续可见。
- 退出：分类失败按 unknown 隐藏 begin，保留其他工具；分别验证 list、initialize、角色指导及直接调用的安全错误，不产生新状态写入。

### R-04 [P2] 缺 intentSummary 时先进入业务参数校验，未兑现统一 D2

- 位置：`webui/server/proxy/mcp-proxy.ts:6004–6043`；D2 分支在其后 `:6046` 才开始。
- 实测：inactive 强制调用缺 intentSummary，返回字段中没有 begin_not_available；代码实际返回 requires intentSummary。合同 D2 及 ZB-02 明确要求业务参数处理前返回统一不可用，并明确包含该负控。
- 影响：客户端可能被引导修参数后再次调用隐藏能力，错误协议也无法统一识别。该问题没有在探针中显示状态污染，不夸大为数据泄露或权限绕过。
- 退出：既有身份／工具准入后，先做参与态与 D2，再对 active 处理原业务参数；覆盖缺参、显式无效绑定与正常参数，均验证后续合法查询。

### R-05 [P1／交付证据缺口] 本修复仍无可核对的完整 R 跑次

- 当前 [INDEX](../qa/uat/INDEX.md) 的 UAT-SUITE-BEGIN-ZERO-BINDING 为 NOT RUN，最近跑次“尚无”；该 suite 的 runs 仅有 README；Spec 仍明确 T6／R 另授。
- 已检索 inbox、正式 UAT／reviews 中的 P1-60、UAT-ZB 与候选 SHA。找到开发编排、109 vitest／demo 冒烟以及其他 suite 的 Docker 结果，没有找到本修复 R0＋01–12 的独立正式跑次。已向委托人异步询问其他证据位置，现有材料不能推定“从未执行”。
- 特别缺少可交付结论所需的真实数据库 oracle、RC1 完整答案、L0／I3 恢复、continue 续查及画像补偿任务逐例结果；OQ-3 数值仍标待冻结。
- 退出：如已有真实执行，补跑次／必要原始证据及 INDEX 指针；缺项按原冻结用例补验。不得把本评审的局部测试／临时探针登记为 UAT FAIL 或 PASS，也不能只改台账为绿。

## 2. 实际验证结果与限制

| 验证 | 结果 | 可证明范围 |
|---|---|---|
| 现有四文件定向回归 | **109 PASS**，4 files，3.96s | 与开发报告数字一致；是模块／本地 Proxy 测试，其中审计写入有 mock，上游是合成服务，不是全真 UAT |
| 追加评审反例 | **4 FAIL**，29 个复制的既有用例被名称过滤跳过 | R-01–04 可复现；29 skipped 不是产品用例被移出验收，而是本次仅筛选四个新增探针 |
| 容器身份与两文件哈希 | 后次运行容器核心文件匹配 890a0394 | 不是完整镜像／依赖等价证明，不代替 UAT |
| 完整 R0＋01–12／RC1／性能 | 本评审未执行，正式记录未取得 | 不能宣称纯 MCP 完整用户旅程已过或可交付 |

现有回归命令（webui 目录）：

```sh
npx vitest run --maxWorkers=1 server/__tests__/begin-hide-inactive.test.ts server/__tests__/caliber-binding-participation.test.ts server/__tests__/caliber-binding-proxy.test.ts server/__tests__/caliber-binding.test.ts --reporter=dot
```

临时反例命令（webui 目录；只读产品模块，在临时目录造状态）：

```sh
npx vitest run --config ../inbox/20261120-begin-final-review/vitest.config.mts --maxWorkers=1 -t FINAL-REVIEW --reporter=verbose
```

测试执行位置为当前 HEAD `7e8ee884`；所审 mcp-proxy、registry、session、caliber-binding 四个核心文件与 890a0394 无差异。acl.ts 有后续短名修复的四行差异；本报告不把此次测试当成候选精确 checkout／全制品验证。首次沙箱内复跑未正常完成，终止后在允许本地端口的执行上下文重跑；正式统计只取最后完整结果。

## 3. Docker 核对：已重建，但不是旧观测直接盖章

审阅期间容器确实被替换：

| 观测 | 容器／镜像 | 版本事实 |
|---|---|---|
| 初次 | container `511d863b…`，image `sha256:262bc6da…`，启动 2026-11-20 03:00:53 UTC | health 为 `1fb73f72`＋dirty；最初 mcp-proxy 哈希与候选不同 |
| 后次 | container `bc56c7dc…`，image `sha256:c1cd67a0…`，启动 2026-11-20 03:19:12 UTC | health 为 `7e8ee884`＋dirty；mcp-proxy／registry 文件哈希均与 890a0394 匹配 |

因此**撤回以初次旧镜像判断当前 Docker 不含修复的推论**。后次核对已证明两个关键源码匹配，不能再把最初差异误记为最终代码缺陷。仍须固定最终交付镜像摘要、包含的后续提交及 dirty 内容清单，并将对应的真实运行证据关联到同一制品。当前 Docker 是本机 demo，不能把 health ok 写成用户更新验收。

## 4. 证据位置

- [109 项现有回归日志](../../inbox/20261120-begin-final-review/existing-tests.log)
- [4 项反例结果](../../inbox/20261120-begin-final-review/probe-results.log)
- [反例源码](../../inbox/20261120-begin-final-review/probes/)、[临时 Vitest 配置](../../inbox/20261120-begin-final-review/vitest.config.mts)
- [当前 health 身份摘录](../../inbox/20261120-begin-final-review/runtime-identity.json)、[制品核对记录](../../inbox/20261120-begin-final-review/artifact-check.json)

以上 inbox 是过程证据，可删除；本文件已保存必要实际输出与结论，不把 inbox 当唯一事实源。未保存 Token／认证头／客户原文。

## 5. 交付决议

**当前不能按本条合同交付用户更新。** 先修 R-01–04 并保持真实强制、预算、ACL、continue 的负控；再按冻结 suite 取得／补齐真实 R 证据并关联最终 Docker 制品。已有 109 项通过应保留，但不足以覆盖本次四个反例。

本评审不修改 Spec 的终稿确权事实，不将未执行 R 改为 FAIL，不授权修复、构建、发布或用户升级。用户如另给 UAT 记录，可补审其证据；即使已有 UAT 通过，也不能覆盖本次已复现的功能合同反例。
