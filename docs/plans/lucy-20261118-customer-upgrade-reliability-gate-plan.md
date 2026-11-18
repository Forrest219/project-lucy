# 客户镜像升级可靠性分层门禁 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划（发布取证 Plan）/ **v0.1-draft** |
| 日期 / 目标版本 | 2026-11-18／产品线 `0.30.0` |
| 状态 | **v0.1-draft。仅登记与起草发布取证方案，评审前不开发、不执行 UAT。正式升级可靠性门禁在候选镜像生成后绑定同一 digest、Chart/values、N-1 数据与运行配置；A 层原生 amd64 容器数据与资源压力、B 层标准 K8s 持续升级为每个候选必跑，C 层客户隔离预演按验证边界触发；镜像前预检不替代镜像后验收。终稿未确权；未获开发授权；未授权不改运行代码、CI、门禁脚本与测试台；测试台 not_registered；不入核心分母；≠ 可上线** |
| 主 Spec | [`docs/specs/lucy-20261118-customer-upgrade-reliability-gate-spec.md`](../specs/lucy-20261118-customer-upgrade-reliability-gate-spec.md) |
| 总账 | **P1-52**／REQ-030-073；**不入核心分母**；编号避让在途 P1-50／51 与 REQ-030-071／072 |
| 授权边界 | **当前只允许本 Spec／Plan 文档起草。** 评审前不得修改运行代码、CI、门禁脚本、夹具或测试台，不得构建候选、执行 A/B/C 或 UAT。终稿确权后仍须另获开发授权才可执行 Task 1–7；真实 A/B/C、测试台登记与跑次另按 Task 8 的执行授权边界处理；客户侧任何写操作另获现场授权 |
| 验收 | Spec SC-01–SC-18。单测／合同测试只证明 harness；真实 A/B/C 证据只认绑定同一候选 digest 的结构化 verdict；实现完成 ≠ 发布取证通过 ≠ 可上线 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「功能闭口与发布取证」「强制流程：Plan Mode」「新增 Spec / Plan 的落盘清单」 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 初稿。拆分评审、harness 实现、发布接线和真实执行四层；全部 Task 未开工。测试台 not_registered |

## 1. 目标（Context for Developer）

**问题**：现有单测、H3/H4、新装 real-e2e 和慢盘 Docker 各自提供局部证据，但没有在候选镜像生成后，以同一 digest、客户规模 N-1 数据和持续 SLO 对客户升级作失败关闭的统一判定。

**目标**：实现 Spec 的构建前预检＋构建后 A/B 必跑＋C 按验证边界触发；产生可独立复验的 `upgrade-reliability.json`，并接入唯一客户发布聚合门禁和全部出包入口。

**架构**：候选镜像只构建一次。A 层在原生 amd64 容器复现数据与资源风险；B 层在一种标准 K8s 合同台验证探针、Ready、Service 和升级／回退；C 层只补足供应方不能等价模拟的客户条件。统一证据验证器绑定身份、原始样本和 verdict，通过后才 promote 同一 digest。

**技术栈**：现有 Node.js 22 / `node:test` / Bash（macOS bash 3.2 兼容）/ Docker / Helm / kind 或受保护 K3s / GitHub Actions；不新增第三方运行时依赖，不改 KTX。

**明确不交付**：业务运行时修复、探针放宽、客户生产升级、完整客户集群复制、浏览器 UI、新部署形态。

## 2. 开工前置（Non-negotiable boundaries）

1. 已登记总账 P1-52／REQ-030-073；Spec／Plan／索引已落盘。
2. **R1／R2 评审尚未完成，终稿未确权，开发未授权；当前 Task 0 也只作为后续评审清单，不主动执行。**
3. Task 1 前必须完成：终稿确权、OQ-1…OQ-6 闭合、委托人另发开发授权，并把决策写回 Spec／Plan 正式版。
4. OQ-3 必须在开工前选定 B 台。若选受保护 K3s，使用按 registry digest 拉取的路径；若选 kind，必须先写出运行中 imageID 与候选身份闭合证明，不能以 tag 相同代替。
5. 客户私有画像、完整 values、备份与凭据保存在受控位置；仓库只放统计示例、digest 和脱敏证据。
6. 不改 `webui/src/**`、`webui/server/**`、KTX、业务 schema 或 Helm 产品探针。测试发现需要修改时停止并回原功能条目。
7. 既有 P1-39／P1-47 的结果不被本条覆盖；默认 FAIL 不能用暂停组或聚合规则洗绿。
8. 正式 A/B/C 运行、客户现场操作与 UAT 跑次不属于开发授权的自然附属；Task 8 前核对委托人要求的执行授权。
9. 不自动执行 git commit／push／tag／release；任何 git 写操作须委托人另行要求。

## 3. Task 分解

> **本轮不执行以下 Task。** Task 0 供评审使用；Task 1–7 需开发授权；Task 8 另核真实执行授权。

### Task 0｜评审与定稿（仅文档；当前待评审）

**Files:**
- Modify: `docs/specs/lucy-20261118-customer-upgrade-reliability-gate-spec.md`
- Modify: `docs/plans/lucy-20261118-customer-upgrade-reliability-gate-plan.md`
- Modify: 总账、需求池与两个索引的状态镜像

**Steps:**
1. 形式评审：逐项核对 DEVELOPMENT 落盘清单、发布取证层级、伪代码、授权边界、索引和术语。
2. 内容评审：重点攻击 digest 闭合、数据等价、kind/K3s 身份、C 触发、观察窗、Recreate 与平滑升级口径、回退数据兼容性。
3. 闭合 OQ-1…OQ-6；把场景 deadline、首版数据下限和 B 台选择写成唯一值，不留实现者二选一。
4. 取得终稿确权；本步仍不授权开发或 UAT。

**Expected:** Spec／Plan 正式版与镜像状态句一致；评审记录落 `docs/reviews/` 并回链；无任何 harness／CI／UAT 改动。

### Task 1｜证据 schema 与失败关闭核心（TDD）

**Files:**
- Create: `scripts/e2e/contracts/upgrade-reliability-v1.schema.json`
- Create: `scripts/gates/upgrade-reliability-contract.mjs`
- Create: `scripts/gates/upgrade-reliability-contract.test.mjs`
- Modify: `scripts/gates/root-test-registry.json`
- Modify: `scripts/gates/root-test-registry.test.mjs`（仅在登记规则需要时）

**Steps:**
1. 先写 SC-01／02／11／13／15／16 的反向测试：缺 digest、换 digest、换 Chart／values、unknown 冒充 within、必需 C 缺失、BLOCKED／NOT RUN／PASS WITH GAP、状态与退出码矛盾、collect 覆盖 release、敏感字段。
2. 运行 `node --test scripts/gates/upgrade-reliability-contract.test.mjs`，确认因模块／schema 不存在而 FAIL；保留测试输出。
3. 实现纯函数 `classifyCustomer(...)`、`validateUpgradeReliabilityEvidence(...)`、`decideUpgradeReliability(...)`，只消费结构化输入，不读 stdout。
4. 实现 schema 与 `releaseReady` 计算：所有必需层干净 passed、raw samples 完整、身份未变、未过期时才为 true。
5. 重跑同一测试，预期全 PASS；再运行 `npm run test:root-contracts`，预期无新增失败。

**Expected:** SC-01／02／11／13／15／16 的纯逻辑部分；没有真实镜像运行证据，不写 A/B PASS。

### Task 2｜客户画像与版本化验证边界

**Files:**
- Create: `scripts/gates/customer-upgrade-profile.mjs`
- Create: `scripts/gates/customer-upgrade-profile.test.mjs`
- Create: `deploy/k8s/gate/customer-profile.example.json`（仅合成统计）
- Create: `deploy/k8s/gate/upgrade-reliability-envelope.json`
- Modify: `scripts/gates/root-test-registry.json`

**Steps:**
1. 先写 within／outside／unknown／invalid 四组测试，以及数据更小、盘更慢、CPU 更低、存储类型未知、profileDigest 改变等边界反例。
2. 运行 profile 测试并确认 FAIL。
3. 实现画像校验、`profileDigest`、边界版本和分类；任何必需数值缺失保持 unknown，不填默认乐观值。
4. 在 envelope 写入定稿后的首版下限；example 只能使用合成数据，不复制客户内容。
5. 重跑 profile 与 contract 测试，预期全 PASS。

**Expected:** SC-04／11 的判定逻辑；画像变化能产生新 digest 并使旧证据失配。

### Task 3｜A 层：原生 amd64 数据与资源压力 runner

**Files:**
- Create: `scripts/gates/upgrade-reliability.mjs`
- Create: `scripts/gates/upgrade-reliability-probe.mjs`
- Create: `scripts/gates/upgrade-reliability-probe.test.mjs`
- Modify: `scripts/uat/cold-start-slow-disk.mjs`
- Modify: `scripts/uat/cold-start-slow-disk-seed.cjs`
- Modify: `scripts/uat/rebuild-probe-budget.mjs`
- Modify: `package.json`（新增定稿命令 `gate:upgrade-reliability`）
- Modify: `docs/governance/test-layers-and-release-gates.md`

**Steps:**
1. 先给 probe 写状态码、耗时、p99／max、readyz≥3s、Ready 抖动、非预期 5xx、401 不纳入性能样本等测试并确认 FAIL。
2. 实现统一采样器和 SLO 判定；原始样本逐条落盘并计算 SHA256，不从摘要反推原始样本。
3. 扩种子：按画像生成主表、全部关联子表、索引、派生状态和用户长尾；输出实际数据形状，不足下限即非零退出。
4. 把候选 digest、实际交付配置和资源证明接入现有 COLD／RPB 场景；默认组与缓解组分别出结果。
5. 在 `upgrade-reliability.mjs` 组合 A 场景，但本 Task 只跑 probe／种子／参数解析的自动化测试，**不执行正式 A 层发布跑次**。
6. 运行 `node --test scripts/gates/upgrade-reliability-probe.test.mjs scripts/gates/customer-upgrade-profile.test.mjs scripts/gates/upgrade-reliability-contract.test.mjs`，预期全 PASS。
7. 在测试门禁文档登记新命令、产物和正式运行边界。

**Expected:** SC-03／04／06／08／09／10 的 harness 已可实现；当前没有真实候选 A PASS。

### Task 4｜B 层：同 digest 的标准 K8s 持续升级

**Files（K3s 定稿选项）:**
- Create: `deploy/k8s/security-e2e/upgrade-candidate.sh`
- Modify: `deploy/k8s/security-e2e/values.security-e2e.yaml`
- Modify: `scripts/gates/k8s-upgrade-gate.sh`
- Modify: `scripts/gates/k8s-gate-negative.test.mjs`

**Files（kind 定稿选项）:**
- Modify: `scripts/gates/k8s-kind-h3-gate.sh`
- Modify: `scripts/gates/k8s-upgrade-gate.sh`
- Modify: `scripts/gates/k8s-gate-negative.test.mjs`

**Common Files:**
- Modify: `scripts/gates/upgrade-reliability.mjs`
- Modify: `scripts/gates/upgrade-reliability-probe.mjs`

**Steps:**
1. 先加负例：另建 `ci-n`、只核对 tag、最终一次 health 200、升级后一次 readyz 超时、Ready→NotReady、Service endpoints 归 0、外部 503、回退后数据不兼容，均必须 FAIL。
2. 按定稿 B 台实现 N-1 安装与同档数据卷准备；候选只按身份部署，不在 B job 内构建。
3. 升级前启动连续采样，覆盖 rollout、首次 Ready、完整观察窗、受控回退和再次升级。
4. 将容器探针、K8s 状态、Service/Ingress、主路径写入同一 scenario result；任一采样器失效则 blocked，不能静默少一路。
5. 明确 Recreate 维护窗与平滑升级两种断言，禁止把 Recreate 停机写成平滑通过。
6. 本 Task 只运行 shell／合同／负例测试：`npm run test:k8s-gate-negative` 与 `npm run test:e2e-harness`；正式 B 场景留 Task 8。

**Expected:** SC-07／08／09／10／12／15 的 B harness 与反例；不再有“最终 Ready 即升级可靠”的旁路。

### Task 5｜聚合门禁与 release workflow 接线

**Files:**
- Modify: `scripts/gates/collect-gate-results.mjs`
- Modify: `scripts/gates/customer-release-readiness.mjs`
- Modify: `scripts/e2e/verify-evidence.mjs`
- Modify: `scripts/gates/customer-release-readiness.test.mjs`
- Modify: `scripts/e2e/__tests__/evidence-verifier.test.mjs`
- Modify: `scripts/gates/customer-release-workflow.test.mjs`
- Modify: `.github/workflows/lucy-release.yml`
- Modify: `docs/governance/release-ci.md`

**Steps:**
1. 先写聚合反例：没有 `results/upgrade-reliability.json`、A/B 任一失败、指定客户 unknown、必需 C 缺失、digest 不同、证据过期、暂停组替代默认组，全部 `releaseReady=false`。
2. 运行相关测试并确认新反例 FAIL。
3. 把 `upgrade-reliability` 加入必需结构化证据和 READINESS_STEPS；不解析 child stdout，不允许 `|| true` 形成通过。
4. 新增或调整 release job，使其依赖 `customer-amd64-native` 并消费候选 digest；`customer-release-readiness` 与 `release-package` 传递依赖该 job。
5. 保持现有同一 digest promote；Job 失败、runner 不存在或产物缺失均不可调度／blocked，不退回 headless。
6. 运行 `npm run test:e2e-harness`、`npm run test:ci-workflow-contracts` 和 actionlint 既有入口，预期全 PASS。
7. 更新 Release CI 文档的 DAG、证据和失败关闭表。

**Expected:** SC-02／13／14／15／17 的发布链接线；尚无真实 release run，不写客户可发布。

### Task 6｜全部出包入口与最终归档复验

**Files:**
- Modify: `scripts/gates/build-k8s-delivery-package.sh` 及既有测试
- Modify: `scripts/gates/verify-k8s-package.sh`（适用时）
- Modify: `scripts/gates/verify-customer-upgrade-package.py` 及既有测试（适用时）
- Modify: `docs/runbooks/customer-amd64-image-build-checklist.md`
- Modify: `docs/runbooks/customer-v2-upgrade-release-checklist.md`
- Modify: `docs/governance/test-layers-and-release-gates.md`

**Steps:**
1. 先加入手工出包无 verdict、通用 verdict 冒充指定客户、归档 values 改变、docker save/load 后身份漂移等反例。
2. 所有客户出包入口调用同一验证器；公共发布与客户定向交付分别判定，不共享指定客户通过结论。
3. 归档后核对 image digest、Chart／values／deliveredConfig 摘要；变化则作废旧证据并要求重跑相应 A/B/C。
4. checklist 增加新门禁与证据指针，但明确人工勾选不能替代机器 verdict。
5. 运行对应既有 Node／Python 回归，预期全 PASS。

**Expected:** SC-14／17；没有 CI 之外的未验证出包旁路。

### Task 7｜实现期总回归与差别审查（仍非正式 UAT）

**Files:**
- Modify: 本 Spec／Plan、总账、需求池、`docs/README.md`、`docs/plans/README.md` 的实现状态镜像

**Steps:**
1. 运行 `npm run test:root-contracts`。
2. 运行 `npm run test:e2e-harness` 与 `npm run test:ci-workflow-contracts`。
3. 运行 `npm run test:k8s-gate-negative`、`npm run gate:k8s-static`。
4. 运行 `npm run lint:spec-docs`、`npm run lint:spec`、`npm run lint:terminology`、`npm run lint:ia-boundary`。
5. 核对 diff 白名单：无 WebUI 业务运行时、KTX、schema、产品探针与无关修复。
6. 状态只写“门禁实现完成／待真实执行”，不得写发布取证通过。

**Expected:** 实现期自动化全绿；SC 中要求真实镜像的项仍保持未验，不用单测冒充。

### Task 8｜真实 A/B/C、测试台与发布取证（另核执行授权；当前禁止）

**Files:**
- Create（获授权后）: `docs/qa/uat/suites/customer-upgrade-reliability/{suite,cases,fixtures}.md`
- Create（真实跑后）: `docs/qa/uat/suites/customer-upgrade-reliability/runs/<date>-<runner>-<candidate>.md`
- Modify: `docs/qa/uat/INDEX.md`
- Modify: `docs/governance/e2e-ledger.md`
- Create（运行产物）: `inbox/e2e/<runId>/results/upgrade-reliability.json` 与原始样本

**Steps:**
1. 先核对真实执行授权、干净提交、候选 digest、N-1 身份、画像与 runner；不满足则保持 blocked。
2. 执行 N-1 对照和环境反证；对照失败或限制未生效时，后续结果全部无效。
3. 执行已知事故构建／冻结坏实现负控，必须被拦；不被拦则先修门禁，不能跑候选收绿。
4. 在原生 amd64 上运行 A 全场景，保留默认与实际交付配置两组（适用时）。
5. 在定稿标准台上运行 B 全场景和持续采样；遵守完整观察窗与场景 deadline。
6. 根据边界决定 C；需要 C 时另获客户侧授权，只在隔离命名空间／PVC 执行。
7. 独立复验结构化证据并运行 `npm run gate:customer-release -- --candidate <identity.json> --run <run.json>`；缺失或失败不得出包。
8. 登记套件、跑次、INDEX 与 e2e-ledger；PASS WITH GAP 不能关闭必做 SC。

**Expected:** SC-01–SC-18 的真实证据齐备后才可称本发布取证通过；仍不表示各模块无问题或可上线。

## 浏览器验证

不适用：本条不改变用户可见 WebUI 表面。默认不执行浏览器测试或移动窄屏测试；B/C 的“主路径”使用真实 HTTP、既有管理会话和纯 MCP 客户端，不借浏览器结果替代持续采样。

## 5. 验收

### 5.1 实现期

- Task 1–7 的新增／既有合同测试与文档 lint 全绿。
- 工作流 DAG、聚合反例、出包反例和身份失效反例可证明失败关闭。
- diff 不越过 Spec §11 白名单。
- 实现完成状态不写成 UAT PASS 或可发布。

### 5.2 真实发布取证

- Spec SC-01–SC-18 按真实证据逐项关闭。
- A/B/C、原始样本、verdict 与最终包身份闭合。
- 测试台 INDEX 与跑次一致；必需项没有 FAIL／BLOCKED／NOT RUN／未关闭 GAP。
- 本条通过不表示各模块无问题，更不表示可上线。

## 6. 完成定义

1. 评审稿阶段（本轮）的完成定义只到：Spec／Plan、总账、需求池和索引落盘，文档形态检查无本条新增违规；**没有开发或 UAT 交付**。
2. 开发阶段完成定义：Task 1–7 全绿、发布链失败关闭可证明、无越权 diff；真实候选仍未因此通过。
3. 发布取证完成定义：Task 8 的真实 A/B／必要 C、负控、原始样本和独立 verdict 全过，三台账同句；任何缺失均不完成。
4. 任一阶段都不自动授权 git 提交、客户出包、生产升级或下一阶段。

## 7. 风险

| 风险 | 处理 |
|---|---|
| 实施者把 harness 单测写成真实升级 PASS | Task 1–7 与 Task 8 分离；SC 证据类型和测试台强制区分 |
| B 台另建镜像导致 digest 假闭合 | 工作流传递候选身份＋运行中身份反例；不闭合即 blocked |
| 客户统计画像不完整 | unknown 失败关闭指定客户结论；禁止默认乐观值 |
| 长补算超过固定采样窗 | 最低窗＋完成后稳态＋场景 deadline；提前截断不得通过 |
| 暂停配置洗绿默认配置 | 分组成证据，默认组始终必需；既有 FAIL 不被覆盖 |
| C 影响生产 | 每次另授权；隔离命名空间／PVC；禁止默认生产写压测 |
| 出包入口遗漏 | CI、手工与归档共享验证器并加旁路反例 |
| 需要改业务代码才能过门禁 | 停止本条实现，回原功能条目；不得夹带修复或放宽探针 |
