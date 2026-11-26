# Chart 停止宽限与 P1-63 预算对齐 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Chart 停止宽限与 P1-63 预算对齐 Spec |
| 文档类型 / 版本 | Spec（事故修复／客户 K8s Chart）／**v0.1-draft** |
| 日期 / 目标版本 | 2026-11-24／产品线 `0.30.0`（`lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-85**／REQ-030-106／**P1（事故修复／快修；有 K8s 台强杀或审计丢失证据后再议提 P0）**。**不入核心分母** |
| 台账号 | 无。挂现行 `0.30` 执行总账 |
| 阶段 | S1 |
| 状态 | S1｜v0.1-draft。委托人 2026-11-24 授权起草 Spec／Plan／UAT；终稿未确权；开发未授权；测试台 NOT RUN；OQ-1（旧 Chart 首升编排归属）待裁定；P1-83 步骤 1⑥ 改前基线须先于候选 Chart 落台；不入核心分母；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 撰写人 / 委托人 | Kimi Code／xingchen |
| 基于材料 | [P1-63 Spec](lucy-20261119-process-drain-lifecycle-spec.md)；[P1-83 Spec §6 D-1](lucy-20261124-k8s-self-healing-spec.md)；`webui/server/runtime/process-drain.ts`；`deploy/compose/docker-compose.demo.yml`；`deploy/k8s/helm/lucy/`；`scripts/gates/helm-lucy-gate.sh`；`scripts/gates/k8s-gate-negative.test.mjs`；[Kubernetes Pod Termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-termination/) |
| 适用范围 | Lucy 官方 Helm Chart 渲染的 Pod 停止宽限、静态门禁及 B 层 K8s 合同台上的真实 SIGTERM 验证。本条是 `AGENTS.md`「Docker 对齐」的明示例外，沿 P1-83 的客户 K8s 立项，不新建交付形态 |
| 实施主体 | Lucy（Chart、渲染门禁与交付说明）。不改 KTX 源码，不改 P1-63 的进程内排空算法 |
| 与既有 Spec 的关系 | P1-63 拥有「排空 ≤20 秒、整实例退出 ≤40 秒、外部停止宽限 ≥45 秒」的运行时合同；本条只把外部宽限落到 Helm Chart 并验证。P1-83 SC-09 消费本条的改前／改后证据，决定是否需要 `preStop`；本条不吞并 P1-83 的自愈、探针或故障注入合同 |
| 配对计划 | [Plan](../plans/lucy-20261124-k8s-stop-grace-plan.md) |
| 测试台 | [`UAT-SUITE-K8S-STOP-GRACE`](../qa/uat/suites/k8s-stop-grace/suite.md) |
| 输出位置 | `docs/specs/lucy-20261124-k8s-stop-grace-spec.md` |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 2026-11-24 初稿。按总账已裁范围写入默认 60 秒、下限 45 秒、`Recreate` 结构化断言、真实 SIGTERM 与审计守恒验收；明确不加入 `preStop`。补入两项防伪边界：静态渲染不等于 K8s UAT；新 Chart 的 60 秒不会回写旧 Pod，旧 Chart 首升编排归属列为 OQ-1。仅文档，未改 Chart、门禁或测程 |

## 闭口层级

- 层级：功能合同
- 性质：事故修复／客户 K8s Chart／优雅停机。
- 本条承诺：由含本条改动的 Helm Chart 创建的单副本 Pod，默认获得 60 秒停止宽限（合法配置不得低于 45 秒），并保持 `strategy.type: Recreate`；在 P1-63 声明的可捕获、可响应 SIGTERM 的退出路径上，不得因外部宽限不足而在 40 秒退出预算内被强杀，已受理审计事实须守恒，恢复后纯 MCP 合法主路径可成交。
- 本条出口：SC-01–SC-06，及 `UAT-KSG-R0／01–06` 的必做证据。静态渲染、单测和 Code Review 均不能单独构成功能合同收口。
- 不在本条出口：P1-63 的准入屏障与 20／40 秒内部算法、P1-83 的假活自愈和 liveness／startupProbe 观察路径、`preStop` 的最终取舍、多副本与零停机、SIGKILL／OOM／节点故障无损、P1-52 全量升级可靠性、Helm 之外的交付方式、客户现场验收。旧 Chart 首升编排是否纳入本条由 OQ-1 决定，未裁前不得主张已覆盖。
- 上线关系：本条收口不表示可上线。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None。「停止宽限」「改前基线」「首升」「审计守恒」为工程与测试台术语；不新增 WebUI 文案或 API 用户可见错误。

## 交互合同豁免

- 原因：本条不改变用户可见 WebUI 表面；只修改 Helm values、Deployment Pod spec、静态门禁和 K8s 交付文档，不改变任何 WebUI 页面、路由、组件、按钮或布局。
- 不改变：页面路由、组件、按钮、文案与布局；纯 Chart／API／MCP 验收不强制浏览器，不得用 HTTP 或 `helm template` 结果主张任何 WebUI 页面已通过。

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。4 画像逐行判定；不新增导航或 WebUI 操作。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | P1·问数面：K8s 默认 30 秒可能早于 P1-63 的 40 秒退出预算强杀在途查询；P1·报告面：仍经历单副本替换窗口 | 新 Chart Pod 的合法宽限 ≥45 秒；可响应 TERM 的在途工作获得既有排空机会，恢复后无 WebUI Cookie 的纯 MCP 可重新成交；报告路径本身不变 | P1·问数面 ↑／P1·报告面 ＝ | SC-04／05；UAT-KSG-04／05 | — |
| P2 治理方 | 语义、Wiki、Skill、Role／ACL 配置路径不变，但旧 Pod 停机可能中断管理读写 | 配置面与授权语义不变；同一 PVC 与既有身份在替换后继续可用，不新增配置步骤 | ＝ | SC-04／05；UAT-KSG-04／05 的同卷与管理读核对 | — |
| P3 运维方 | Chart 未显式设置宽限，渲染门禁也不检查 `Recreate`；排查时难以区分配置缺口与进程内故障 | 默认 60 秒、低于 45 秒渲染失败、`Recreate` 与字段位置有结构化门禁；可核对 TERM、退出码、审计水位与失败请求数 | ↑ | SC-01–SC-06 | — |
| P4 管理层 | 无新增业务操作；停机审计是否完整缺少 K8s 证据 | 仍无新增业务操作；可查看审计守恒证据，但不把工程信号当作业务价值指标 | ＝ | SC-04／06；UAT-KSG-04／06 | — |

**产品级复核**：当前没有 `↓` 判定。60 秒是上限而非固定等待时长；正常退出仍可更早完成。若实测显示本条使 P1·问数面或 P3·交付运维面退化，须重判并补补偿路径，不得以「配置更规范」抵销主路径不可用。

## 1. 问题陈述与静态事实

| 事实 | 核对位置 | 结论 |
|---|---|---|
| P1-63 的运行时预算为排空 20 秒、supervisor 清理 10 秒、孤儿清理 5 秒、收尾 5 秒，总退出 40 秒，外部停止宽限至少 45 秒 | `webui/server/runtime/process-drain.ts:22-27`；[P1-63 Spec §2](lucy-20261119-process-drain-lifecycle-spec.md) | 既有合同，不在本条改数 |
| Docker demo 已设置 `stop_grace_period: 45s` | `deploy/compose/docker-compose.demo.yml:73-74` | 仅证明 Docker 配置，不可替代 K8s 证据 |
| Chart 的 Deployment 已固定 `strategy.type: Recreate`，Pod spec 未设置 `terminationGracePeriodSeconds` | `deploy/k8s/helm/lucy/templates/deployment.yaml:36-43,69` | K8s 默认 30 秒与 P1-63 的 45 秒外部预算不齐 |
| Chart 未设置 `preStop` | 同文件主容器 `lucy` | 本条不加入；是否需要在 P1-83 SC-09 取得停机失败请求数后另裁 |
| `helm-lucy-gate.sh` 已有通用渲染断言，但无停止宽限与 `Recreate` 的结构化断言 | `scripts/gates/helm-lucy-gate.sh:154-183` | 本条补差集，不复制一套新门禁入口 |
| Chart 当前包版本为 `0.2.10`，产品 `appVersion` 为 `0.30.0` | `deploy/k8s/helm/lucy/Chart.yaml:20-21` | 只改 Chart 时只递增 Chart 包版本，不推导产品升版 |
| `K8S_CONTRACT.md` 的兼容矩阵仍把 `0.2.9` 标为 Current，未列 `0.2.10` | `deploy/k8s/K8S_CONTRACT.md:15-30` | 实现时须把 `0.2.10` 历史行与新版当前行一次补齐，不保留新漂移 |
| 删除 Pod 默认宽限为 30 秒；`kubectl delete pod --grace-period` 可显式覆盖 | [Kubernetes Pod Termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-termination/) | 正式用例不得用命令行覆盖值冒充 Chart 默认 60 秒 |
| Deployment 更新 Pod template 不会 retroactively 修改旧 ReplicaSet 已创建 Pod 的 spec | K8s 工作负载机制；现行 H3 直接 `helm upgrade --atomic --wait`，见 `scripts/gates/k8s-upgrade-gate.sh:110-116` | 旧 Chart 首升与合规新 Pod 后续升级必须分开验证，见 OQ-1 |

准确表述是「P1-63 的 45 秒外部预算在 K8s Chart 未落地」，不是 P1-63 已违约，也不是已经取得 K8s 强杀或审计丢失证据。优先级提升须有实测证据。

## 2. 目标与非目标

**目标**

1. Chart 默认渲染 `terminationGracePeriodSeconds: 60`，并允许运维显式选择不低于 45 秒的整数。
2. 对所有通用渲染 profile，以结构化方式断言宽限位于 Pod spec、数值 ≥45、`strategy.type: Recreate`，并防止注释或错误层级造成假阳性。
3. 对非法值、缺失字段、错误层级、非法更新策略和交付包布局建立负控。
4. 在 B 层原生 amd64 K3s 合同台上，用真实 SIGTERM 验证 `delete pod`、升级与回滚路径的宽限、在途请求、审计和恢复。
5. 把停机期间失败请求数与原始证据交给 P1-83 SC-09；本条不预设 `preStop`。

**非目标**

- 不修改 `process-drain.ts`、entrypoint、supervisor、探针或自愈逻辑。
- 不加入 `preStop`，不用固定睡眠代替 P1-63 的准入关闭与在途排空。
- 不支持多副本、`RollingUpdate`、无 PVC 或零停机升级。
- 不新建 K8s 合同台，不用本机 Docker、kind arm64 或 QEMU 结果替代正式 B 层证据。
- 不承诺首次旧 Chart 升级已由新宽限保护；该路径按 OQ-1 裁定后验收，未闭合不得写 PASS。

## 3. 设计合同

### 3.1 Values 与渲染位置

新增顶层 Chart value：

```yaml
terminationGracePeriodSeconds: 60
```

| 规则 | 合同 |
|---|---|
| 默认值 | `60`，即 P1-63 的 45 秒外部下限加 15 秒余量 |
| 合法覆盖 | 整数且 `>=45`；`45`、`60`、`75` 均合法，不把通用门禁误写成「必须等于 60」 |
| 非法值 | 缺失、空值、`<45`、负数、零、小数、非数字文本均渲染失败；不得被 `default` 静默回退为 60 |
| 渲染类型 | YAML 数值，不是字符串 |
| 渲染位置 | `Deployment.spec.template.spec.terminationGracePeriodSeconds`（Pod spec），不是 container 字段 |
| 更新策略 | `Deployment.spec.strategy.type` 继续硬编码 `Recreate`，不开放为 values |
| `preStop` | 本条渲染结果不得新增 `lifecycle.preStop` |

模板先验证原始值，再把规范化整数渲染到 Pod spec。不得使用会把 `0` 当作空值并回退到 60 的写法。

### 3.2 结构化静态门禁

复用 `scripts/gates/helm-lucy-gate.sh` 的 `assert_universal_contract`，使 local-test、k3s-test、secure、Secret 等所有经过通用合同的渲染都执行以下检查：

1. 每个渲染文件恰好定位一个 `kind: Deployment` 文档。
2. 按文档边界和 Helm 固定 YAML 层级读取 `spec.strategy.type` 与 `spec.template.spec.terminationGracePeriodSeconds`，拒绝全文件 `grep` 命中注释、其他文档或 container 错误层级所形成的假阳性。
3. `strategy.type == "Recreate"`，宽限只有一个且为整数 `>=45`。
4. 不新增 `preStop`。
5. 默认 60 秒由正向测试单独断言；通用门禁只断言下限，另以 `--set terminationGracePeriodSeconds=75` 证明更高合法值不会被误拒。

实现采用现有 `awk`，按 `kind` 与缩进层级读取 Helm 的稳定输出，不新增 `yq`、Node、Python 或 vendored 依赖，仓库与交付包继续运行同一脚本。它不是通用 YAML 解析器；输入格式变化时须失败而非猜测。`k8s-gate-negative.test.mjs` 可用项目已有 `yaml` 包对结果作独立结构化复核。

### 3.3 改前／改后时序与身份

- 静态 TDD 与 Chart 修改只发生在终稿确权和开发授权之后。
- **候选 Chart 落台前置**：P1-83 步骤 1⑥ 已用现行 Chart 和镜像取得 `delete pod` 带在途请求的改前证据，包括有效宽限、TERM、退出码、是否强杀、在途结果、审计水位和停机失败请求数。基线未成立时，不得部署候选 Chart 骗取「改后」对照。
- 改前基线不要求一定出现强杀或审计丢失；只记录事实。若出现，该证据供优先级复评。
- 本条不改产品运行代码，原则上复用同一镜像 digest；Chart 包版本、values 摘要和运行中 `imageID` 仍须绑定到跑次，不得虚构新镜像。

### 3.4 真实 SIGTERM 与审计守恒

正式用例分两类，均在隔离 namespace／PVC、真实 KTX 与合成数据库上执行：

| 类别 | 构造 | 判定重点 |
|---|---|---|
| 正常在途 | 真实数据库延迟查询（约 10 秒）在 `kubectl delete pod` 前已受理 | 查询只执行一次且结果正确；KTX 在结果终结前不被提前停止；审计已受理行保留 |
| 有界最长路径 | 复用 P1-83 版本化外部注入器，使 P1-63 的 20 秒排空截止及后续清理真实发生；不得在产品内新增 fault switch | 记录各阶段时间与 40 秒预算；在 60 秒默认宽限内不得因宽限不足出现 SIGKILL／137；超出 P1-63 合同的无响应进程不属于本条优雅排空承诺 |

`kubectl delete pod` 不传 `--grace-period`，不使用 `--force`，以验证 Pod 自身 60 秒。TERM、Endpoint、`readyz`／`livez`、Pod UID、`containerID`、`StartedAt`、`lastState.terminated`、事件和日志按同一时间轴保存。

审计守恒是指：**删除前已受理、尤其已返回成功请求的唯一 ID 集须在恢复后逐条核对恰好一次，且 `ledger_seq` 水位不回退；不得只比总行数，让新增行掩盖丢失，也不能把未受理或停机后被明确拒绝的新请求伪记为成功。** 单副本停机窗内的新请求可以有界失败；失败请求数不得被写成必须为零，它是 P1-83 SC-09 判断 `preStop` 的输入。

每次替换后至少验证：同一 PVC 与配置仍在；新 Pod Ready；合法管理读成功；纯 MCP 在无 WebUI Cookie 下完成 `initialize`→`tools/list`→合法只读查询，结果与独立 SQL 一致。浏览器不适用。

### 3.5 升级、回滚与旧 Chart 首升

合规路径至少执行「宽限合规 Chart N → 另一合规修订 N+1 → rollback N → 再升级 N+1」，每个旧 Pod 终止前都核对其有效宽限，不能只看新 Deployment 的字段。两个修订可使用 60／75 秒形成可区分证据；镜像 digest 保持不变，Chart 修订号独立。

**首升特殊边界**：从缺字段的旧 Chart 首次升级时，旧 Pod 的终止仍受其自身 spec／删除请求约束，新 Chart 的 60 秒不会回写。故：

- 不得用「新 Deployment 已渲染 60」证明旧 Pod 首升已受保护。
- OQ-1 未裁前，首升不得记入本条 PASS。
- 若 OQ-1 裁定由本条承担首升，本条必须扩白名单到相应升级编排与测试，完成旧 Pod 的 60 秒保护后再收口；只改 Chart 不足。
- 若裁定由 P1-52／升级编排承担，本条保留首升基线和证据交接，合规 Chart 之间的升级／回滚仍必须通过。

## 4. 核心流程（伪代码）

```text
on helm_render(values):
  raw = required(values.terminationGracePeriodSeconds)
  if raw is not integer_text or int(raw) < 45:
    fail_render("terminationGracePeriodSeconds must be an integer >= 45")
  deployment.spec.strategy.type = "Recreate"               # 不变
  deployment.spec.template.spec.terminationGracePeriodSeconds = int(raw)
  assert no new containers[*].lifecycle.preStop             # 本条明确不做

on static_gate(rendered_documents):
  deployment = exactly_one(doc.kind == "Deployment")
  assert deployment.spec.strategy.type == "Recreate"
  grace = deployment.spec.template.spec.terminationGracePeriodSeconds
  assert grace exists exactly_once_at_pod_level and is_integer(grace) and grace >= 45
  assert no new preStop
  # 独立正向测试另证 default == 60；override == 75 也通过

on candidate_deploy(baseline_evidence, candidate):
  require P1_83_step_1_6_baseline_exists_before_candidate_deploy
  require OQ_1_scope_decision_for_first_upgrade
  require same_candidate_image_digest_and_recorded_chart_values_digests
  deploy isolated_native_amd64_k3s(candidate)

on responsive_SIGTERM_path(action):                         # delete pod / compliant upgrade / rollback
  require action does not override grace and is not forced
  record effective_old_pod_grace, TERM, in_flight, audit_watermark, endpoint, probes
  run existing_P1_63_drain_and_cleanup_unchanged
  assert no grace_related_SIGKILL_inside_declared_budget
  assert accepted_audit_ids_rows_and_watermark_survive
  assert new_pod_ready_on_same_PVC
  assert management_read_and_pure_MCP_query_match_independent_SQL
  record stop_window_failure_count_for_P1_83_SC09           # 不要求等于 0

never:
  use helm template or Code Review as K8s UAT PASS
  use new_pod_grace as proof that an old_chart_first_upgrade_was_protected
  use Docker / arm64 / QEMU as formal B-layer evidence
```

## 5. 验收（SC）

| ID | 可打假的标准 | 对应 UAT |
|---|---|---|
| SC-01 | **改前基线与身份闭合**：候选 Chart 落台前已存在 P1-83 步骤 1⑥ 原始证据，且时间、镜像 digest、Chart／values 摘要、namespace／PVC 可追；基线是否出现强杀据实登记，不作为前置结论 | UAT-KSG-R0 |
| SC-02 | **正向渲染**：默认、local-test、k3s-test 与通用 profile 的 Pod spec 渲染数值 60 且 `Recreate`；45 与 75 合法，通用门禁是 `>=45` 而非等于 60；无新增 `preStop` | UAT-KSG-01 |
| SC-03 | **结构化负控与交付包等价**：`<45`、零、负数、小数、非数字、缺失、错误层级、注释假阳性、`RollingUpdate` 均不能通过；仓库与交付包布局的同一静态脚本均有效，既有 H1a／H1b 断言不回退 | UAT-KSG-02 |
| SC-04 | **live spec 与 delete pod**：运行中 Deployment／旧 Pod 的有效宽限与候选一致；正常在途和有界最长路径均有真实 TERM 证据，无宽限不足导致的提前强杀，在途与审计按 §3.4 判定；同卷恢复后管理读与纯 MCP／SQL 成交 | UAT-KSG-03／04 |
| SC-05 | **升级／回滚**：合规 Chart N→N+1→rollback N→再升级 N+1 每次终止的旧 Pod 均有有效宽限与 TERM／退出证据，`Recreate`、单副本、RWO PVC、审计和主路径不回退。旧 Chart 首升按 OQ-1 的归属完成或通过证据交接，不得混记 | UAT-KSG-05 |
| SC-06 | **交付说明与证据交接**：`K8S_CONTRACT.md` 写明 60＝45+15、下限与首升边界；Chart 包版本独立递增，`appVersion`／KTX 不因此改变；UPGRADE／NOTES 不宣称零停机；P1-83 SC-09 获得 TERM、退出码、是否强杀、在途、审计水位及停机失败请求数；本条未加入 `preStop` | UAT-KSG-06 |

SC-01–SC-06 全部关闭且测试台必做项 PASS 才可申请功能合同收口。静态检查成功只覆盖 SC-02／03，不能把套件提前写成 PASS WITH GAP。

## 6. 开放项

| ID | 问题 | 草案建议与影响 |
|---|---|---|
| OQ-1 | 旧 Chart 首次升级到含 60 秒的新 Chart 时，谁负责保护旧 Pod：本条扩展升级编排，还是 P1-52／既有升级编排负责？ | **建议归 P1-52／升级编排**，保持本条「仅 Chart 宽限与门禁」的快修边界；本条提供首升基线并保证合规 Chart 之间的路径。若裁定归本条，须扩白名单、实现和 UAT，不能只改 Chart。OQ-1 是终稿前置；未裁前首升不纳入任何 PASS 叙事 |

除 OQ-1 外无新增开放项：默认 60、下限 45、`Recreate`、不加入 `preStop` 均沿总账既有裁定。

## 7. 依赖

| ID | 依赖 | 状态与用途 |
|---|---|---|
| D-1 | P1-63 进程排空合同 | 既有 20／40／45 秒预算是本条唯一数值来源；本条不重写 |
| D-2 | P1-83 步骤 0／1b／1，尤其步骤 1⑥ | 候选落台前必须有改前基线；P1-83 的版本化注入器供最长路径复用。台建设与测程授权当前暂缓，缺则相关 UAT BLOCKED |
| D-3 | B 层 K8s 合同台 | 原生 amd64 单节点 K3s、固定版本、RWO、隔离 namespace／PVC；不得用 Docker／arm64／QEMU 代填正式证据 |
| D-4 | P1-52 升级编排 | OQ-1 建议的首升责任方；不在本条默认改其脚本 |
| D-5 | P1-83 SC-09 | 消费本条改前／改后证据决定是否需要 `preStop`；本条不代决 |

## 8. 授权边界

- 本次授权仅为起草 Spec／Plan／UAT 及必要的索引、总账勾连；**不是终稿确权、开发授权、测程授权、出包授权或客户变更授权**。
- 修改 `values.yaml`、`deployment.yaml`、`helm-lucy-gate.sh`、K8s 交付文档及对应测试前，须 OQ-1 闭合、终稿确权并另获开发授权。
- 候选 Chart 落台还须 P1-83 步骤 1⑥ 基线在先，并另获 B 层测程授权。无原生 amd64 台时保持 BLOCKED，不降级到 Docker。
- 本条不默认构建新镜像、不默认出包、不提交、不推送、不操作客户实例。

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 新 Chart 的 60 秒被误当作旧 Pod 首升保护 | OQ-1 终稿前置；SC-05 分开合规修订与首升证据 |
| `default` 把 0／空值静默变成 60，或小数被截断 | 先校验原始值再规范化；SC-03 全覆盖非法值 |
| 全文件 grep 命中注释或 container 字段形成假绿 | 文档边界＋Pod 层级的 `awk` 读取；缺失／错层／注释负控 |
| 只验渲染便宣称真实排空通过 | SC-04／05 强制真实 K8s SIGTERM；INDEX 只认完整跑次 |
| 把任何 137 都归为宽限不足，或把 143 都归为优雅完成 | 同时核对 TERM、时间轴、退出原因、在途与审计，不以退出码单点判因 |
| 为追求零失败请求而引入固定 `preStop` 睡眠 | 失败请求数只作 P1-83 SC-09 输入；本条禁止新增 `preStop` |
| 60／75 秒上限被误读为每次必须等待那么久 | 文档写明是上限；记录实际退出时长，正常路径可提前结束 |
| 与 P1-83 同改 Chart、门禁和交付文档互相覆盖 | 实施时按文件串行整合并跑双方回归；本条不修改 P1-83 白名单外的运行时逻辑 |
| 合同台与客户集群存在版本／CNI／存储差异 | 只主张 B 层合同台证据；客户现场仍属交付层，不外推可上线 |
