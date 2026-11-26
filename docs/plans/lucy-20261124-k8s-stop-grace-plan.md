# Chart 停止宽限与 P1-63 预算对齐 Plan

> 实施时可使用 `executing-plans` skill 按任务逐项执行；执行前仍须满足下方授权边界，不能用执行 skill 代替确权或开发授权。

**Goal:** 为 Lucy Helm Chart 提供默认 60 秒、最低 45 秒的 Pod 停止宽限与 `Recreate` 结构化门禁，并在真实 K8s 上证明可响应 SIGTERM 的路径不因宽限不足破坏 P1-63 的排空和审计守恒。

**Architecture:** 仅在 Chart 层新增一个顶层整数值，在 Deployment 的 Pod spec 渲染该值并保留硬编码 `Recreate`；复用既有 H1 静态门禁与负控，不引入第二套命令或外部 YAML 工具。P1-63 的进程内排空完全不变，B 层 K8s 用例复用 P1-83 的改前基线和版本化注入器，停机失败请求数交回 P1-83 SC-09。

**Tech Stack:** Helm Chart／Go templates、Kubernetes Pod spec、stock bash 3.2／awk、既有 Node `node:test`＋`yaml`、原生 amd64 单节点 K3s、真实 KTX／合成 MySQL／纯 MCP。

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 分阶段实施计划 / **v0.1-draft** |
| 日期 / 功能编号 | 2026-11-24／**P1-85**／REQ-030-106 |
| 状态 | S1｜v0.1-draft。委托人 2026-11-24 授权起草 Spec／Plan／UAT；终稿未确权；开发未授权；测试台 NOT RUN；OQ-1（旧 Chart 首升编排归属）待裁定；P1-83 步骤 1⑥ 改前基线须先于候选 Chart 落台；不入核心分母；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 授权边界 | 当前仅授权文档与索引。修改 Chart、静态门禁、测试或交付文档前须 OQ-1 闭合＋终稿确权＋委托人另发开发授权；候选落台还须 P1-83 步骤 1⑥ 改前基线＋B 层测程授权。不授权出包、客户实例、提交或推送 |
| 验收 | [Spec](../specs/lucy-20261124-k8s-stop-grace-spec.md) SC-01–SC-06；[`UAT-KSG-R0／01–06`](../qa/uat/suites/k8s-stop-grace/suite.md) |
| 关联 | [Spec](../specs/lucy-20261124-k8s-stop-grace-spec.md) · [UAT](../qa/uat/suites/k8s-stop-grace/suite.md) · [P1-63](../specs/lucy-20261119-process-drain-lifecycle-spec.md) · [P1-83](../specs/lucy-20261124-k8s-self-healing-spec.md) · [INDEX](../qa/uat/INDEX.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 2026-11-24 初稿。TDD→Chart 默认值与校验→结构化静态门禁→交付说明→B 层真实 SIGTERM／升级回滚验收；补旧 Chart 首升 OQ-1，不把新 Pod 宽限倒推给旧 Pod。仅设计，不执行实现 |

## 目标

以最小 Chart diff 对齐 P1-63 的外部停止预算：默认 60 秒、任何合法值不低于 45 秒、`Recreate` 不变、无 `preStop`。静态门禁必须在仓库和交付包中等价有效，正式结论必须来自同一候选镜像 digest＋候选 Chart 的原生 amd64 K3s 跑次。

## 开工前置

| 前置 | 当前事实 | 开工规则 |
|---|---|---|
| OQ-1 首升归属 | 新 Chart 不会 retroactively 改旧 Pod；现行 H3 直接 `helm upgrade` | **终稿前置**。建议归 P1-52／升级编排；若归本条，先扩 Spec 白名单与 UAT，不能只执行本 Plan 的 Chart 小改 |
| 终稿确权＋开发授权 | 当前只有文档起草授权 | 未获授权不得改 Chart、门禁、测试或交付文档 |
| P1-83 步骤 1⑥ 改前基线 | 原生 amd64 台与测程授权暂缓 | 静态 TDD 可在开发授权后进行；**任何候选 Chart 落台都必须等基线** |
| B 层 K8s 合同台 | 方向为原生 amd64 单节点 K3s，机器来源暂缓 | 不自行搭台、不用 Docker／kind arm64／QEMU 顶替；缺则 UAT BLOCKED |
| 版本化故障注入 | P1-83 步骤 1b 负责 | 正常 10 秒查询可在本套件构造；有界最长路径复用 P1-83 注入器，不新增产品 fault switch |
| 共享工作树 | P1-75／83 等也修改运行与文档文件 | 实施时按文件串行整合，不覆盖他人改动；本条不改 `process-drain.ts` 等运行时文件 |

开工阅读：Spec v0.1、P1-63 Spec §2／SC-06、P1-83 Plan 步骤 0／1b／1、`deploy/k8s/K8S_CONTRACT.md`、`scripts/gates/helm-lucy-gate.sh`、`scripts/gates/k8s-gate-negative.test.mjs`、UAT `fixtures.md`。

## 任务分解

### Task 0：冻结范围、基线与首升责任（委托人／测程前置）

1. 裁定 OQ-1。若归 P1-52，记录本条只承担合规 Chart 之间的升级／回滚和首升证据交接；若归 P1-85，先修订 Spec／Plan／UAT 的文件白名单，加入真实升级编排，禁止以 Chart-only 方案收首升。
2. 完成终稿确权并取得开发授权。
3. 在现行 Chart＋镜像上完成 P1-83 步骤 1⑥：记录有效宽限、真实 TERM、退出码、是否强杀、在途请求、审计水位、停机失败请求数及原始时间轴。基线可以是「未发生强杀」，不得预设结果。
4. 冻结改前镜像 digest、Chart／values 摘要、K3s／kubelet 版本、namespace／PVC 与证据路径。候选 Chart 的首次部署时间必须晚于基线。

出口：`UAT-KSG-R0` 可执行；没有基线只能做静态开发检查，不能部署候选或登记正式 UAT。

### Task 1：先写渲染与负控失败测试（TDD）

**Files:**

- Test: `scripts/gates/k8s-gate-negative.test.mjs`
- 后续 Modify: `deploy/k8s/helm/lucy/values.yaml`
- 后续 Modify: `deploy/k8s/helm/lucy/templates/deployment.yaml`

在既有测试文件中用根依赖 `yaml` 的 `parseAllDocuments` 定位唯一 Deployment，新增以下测试，不新建测试命令：

1. 默认及 local-test／k3s-test：`spec.template.spec.terminationGracePeriodSeconds === 60`，`spec.strategy.type === "Recreate"`，字段是 number。
2. `--set terminationGracePeriodSeconds=45` 与 `=75` 合法且输出对应数值。
3. `44`、`0`、`-1`、`45.5`、`not-a-number`、空值均渲染失败。
4. 渲染结果无新增 `lifecycle.preStop`。
5. 注释中的 `terminationGracePeriodSeconds: 60` 或 container 错误层级不得满足 Pod 字段断言。

核心断言形态：

```js
import { parseAllDocuments } from "yaml";

function onlyDeployment(manifest) {
  const docs = parseAllDocuments(manifest).map((doc) => doc.toJSON()).filter(Boolean);
  const deployments = docs.filter((doc) => doc.kind === "Deployment");
  assert.equal(deployments.length, 1);
  return deployments[0];
}

const deployment = onlyDeployment(renderChart(["lucy", chartDir]));
assert.equal(deployment.spec.template.spec.terminationGracePeriodSeconds, 60);
assert.equal(deployment.spec.strategy.type, "Recreate");
```

运行：

```bash
npm run test:k8s-gate-negative
```

预期：新增默认 60 秒与合法覆盖用例 FAIL（当前字段为 `undefined`），既有测试不应被改写来迁就新合同。非法值用例须区分「Chart 自身拒绝」与「静态门禁拒绝」，不能用模板校验通过代替门禁负控。

### Task 2：实现 values、模板校验与 Pod 字段

**Files:**

- Modify: `deploy/k8s/helm/lucy/values.yaml`
- Modify: `deploy/k8s/helm/lucy/templates/deployment.yaml`

在 `replicaCount` 附近新增带预算说明的顶层值：

```yaml
# P1-63 whole-instance exit budget is 40s and requires external grace >=45s.
# Default 60 adds 15s headroom. Values below 45 are rejected at render time.
terminationGracePeriodSeconds: 60
```

在 Deployment 校验区与 Pod spec 分别加入原始值校验和规范化输出。实现形态如下；`required`／`regexMatch`／`int` 的实际错误文案以保持 Helm 风格为准，但不得放宽规则：

```gotemplate
{{- $graceRaw := required "terminationGracePeriodSeconds is required" .Values.terminationGracePeriodSeconds -}}
{{- $graceText := toString $graceRaw -}}
{{- if not (regexMatch "^[0-9]+$" $graceText) -}}
{{- fail "terminationGracePeriodSeconds must be an integer >= 45" -}}
{{- end -}}
{{- $graceSeconds := int $graceRaw -}}
{{- if lt $graceSeconds 45 -}}
{{- fail "terminationGracePeriodSeconds must be >= 45 to cover the 40s P1-63 exit budget" -}}
{{- end -}}
```

```gotemplate
    spec:
      terminationGracePeriodSeconds: {{ $graceSeconds }}
      serviceAccountName: {{ include "lucy.serviceAccountName" . }}
```

约束：

- 不使用 `default 60` 处理原始值，避免 0／空值静默回退。
- 校验发生在渲染字段之前；`45.5` 不得被截断成 45。
- `Recreate` 保持原硬编码，不新增 values，不加 `preStop`。
- 只改 Chart，不改 `appVersion`、镜像 tag／digest 或运行时源码。

运行 Task 1 的正向与非法值测试，预期新增用例通过；再运行 `npm run gate:k8s-static`，此时尚未加入结构化门禁的对应断言，不能把该结果当作 Task 3 已完成。

### Task 3：在既有 H1 门禁中加入结构化停止合同

**Files:**

- Modify: `scripts/gates/helm-lucy-gate.sh`
- Test: `scripts/gates/k8s-gate-negative.test.mjs`

在 `assert_universal_contract` 中调用 `assert_deployment_stop_contract`。用 stock `awk` 按 `---` 文档边界、`kind: Deployment`、`spec.strategy` 与 `spec.template.spec` 的固定缩进读取，要求：

```text
deployment_count == 1
strategy_type == "Recreate"
pod_grace_count == 1
pod_grace is digits only and pod_grace >= 45
no newly rendered preStop
missing / duplicate / wrong indentation / comment-only => FAIL
```

实现约束：

- 不做全文件 `grep "terminationGracePeriodSeconds: 60"`；通用门禁只比较 `>=45`。
- 默认 60 由 Task 1 测试断言；另用包含 `terminationGracePeriodSeconds: 75` 的 values 跑完整门禁，证明高值合法。
- 负控至少包含：缺字段、44、字段移到 container、只有注释命中、`type: RollingUpdate`。Chart 模板校验拒绝 44 与门禁拒绝 44 分别取证，不能互相代签。
- `k3s-gate-negative.test.mjs` 的 fake package 继续从包根执行 `scripts/preflight-helm.sh --k3s-only`；因未新增辅助文件，无需改打包文件清单。
- 保持 stock macOS bash 3.2／awk，不引入 `yq`、Node、Python 或第三方解析器到交付脚本。

运行：

```bash
npm run gate:k8s-static
npm run test:k8s-gate-negative
npm run test:k8s-delivery-package
```

预期：全部退出 0；逐一恢复负控后对应场景应失败。保存正向、负控及包布局输出作为开发证据，不据此改 UAT INDEX。

### Task 4：更新 Chart 与交付说明（不扩实现范围）

**Files:**

- Modify: `deploy/k8s/helm/lucy/Chart.yaml`
- Modify: `deploy/k8s/K8S_CONTRACT.md`
- Modify: `deploy/k8s/helm/lucy/UPGRADE.md`
- Modify: `deploy/k8s/helm/lucy/templates/NOTES.txt`

执行内容：

1. Chart 包版本由 `0.2.10` 升至 `0.2.11`（若合入时已变化，只递增当次包版本），`appVersion: "0.30.0"` 与 KTX `0.16.0` 不变；`artifacthub.io/changes` 写明停止宽限，不把 Chart 修订写成产品升版。
2. `K8S_CONTRACT.md`：版本／日期同步；兼容矩阵补 `0.2.10` 历史事实和 `0.2.11` 当前行；Workload constraints 增加 Pod 级 `terminationGracePeriodSeconds` 默认 60、合法值 ≥45，并解释 `60=45+15`。
3. 明确「宽限是上限而非固定等待」「不承诺零停机」「不含 `preStop`」「新值不回写旧 Pod」以及 OQ-1 裁定后的首升操作责任。
4. `UPGRADE.md` 的 Expected downtime 与 `NOTES.txt` 显示当前宽限和 `Recreate`，不得承诺所有请求零失败或所有版本首升自动受保护。
5. 若 OQ-1 归 P1-52，文档只链接首升编排，不在本条偷改 `scripts/deploy/`；若归本条，先回到 Task 0 扩白名单再实施。

复核：`helm lint`、`npm run gate:k8s-static`、`npm run test:k8s-gate-negative`、`npm run test:k8s-delivery-package`，并检查 Chart／contract／UPGRADE 版本与措辞无互相矛盾。

### Task 5：绑定候选并执行 B 层 UAT（测程授权后）

**Files:**

- Use: `docs/qa/uat/suites/k8s-stop-grace/{suite,cases,fixtures}.md`
- Create at run time: `docs/qa/uat/suites/k8s-stop-grace/runs/YYYY-MM-DD-<agent>-p185-<tag>.md`
- Create at run time: `docs/qa/uat/suites/k8s-stop-grace/runs/evidence/<run-id>/`

1. 确认 Task 0 基线先于候选落台；本条复用同一产品镜像 digest，记录 Chart 包版本、values 摘要和实际 `imageID`。若实现改了镜像内容，停止并重新评审范围，不能沿用「Chart-only」身份。
2. 在隔离原生 amd64 K3s namespace／PVC 部署候选，先跑 `UAT-KSG-03` 核对运行中 Deployment 与旧 Pod 的有效宽限。
3. 跑 `UAT-KSG-04`：正常 10 秒真实查询＋P1-83 有界最长注入；`delete pod` 不传 `--grace-period`，不强制删除；记录完整时间轴、在途、审计和失败请求数。
4. 跑 `UAT-KSG-05`：合规 Chart N→N+1→rollback N→再升级 N+1，使用 60／75 形成可区分的旧 Pod 证据。首升按 OQ-1 执行或交接，未决不得判 PASS。
5. 每次替换后做同卷管理读和无 WebUI Cookie 的纯 MCP `initialize`→`tools/list`→合法查询，独立 SQL 核对；不使用浏览器。
6. 跑 `UAT-KSG-06`：核对文档／版本与 P1-83 SC-09 证据交接，导出原始证据后清理隔离资源。
7. 全部必做项通过后才可以把 INDEX 改为 PASS；静态子集通过、环境 BLOCKED 或首升未决均不得写 PASS WITH GAP。

### Task 6：回归、登记与申请收口

1. 重跑 Task 3 全部门禁及 P1-63 既有回归，证明未改运行时排空：`node --test scripts/runtime/process-drain.test.mjs scripts/runtime/docker-entrypoint.test.mjs`。
2. 运行文档与勾连门禁：`npm run lint:spec-docs`、`npm run lint:spec`、`npm run lint:terminology`、`npm run lint:ia-boundary`、`npm run lint:e2e-ledger`。
3. 跑次含 SC-01–SC-06 映射、原始证据哈希、清理回执和未覆盖项；INDEX、Spec、Plan、两份 README、需求池、总账、e2e-ledger 按各自 SOT 更新，不把 UAT PASS 倒写成自动功能收口。
4. 向委托人提交 OQ-1 处置、改前／改后对照和 P1-83 SC-09 交接，申请功能合同收口。是否提交／推送／出包另行授权。

## 浏览器验证

不适用：本条无 WebUI 用户可见面变更。正式验证使用 Helm、K8s API、真实进程、HTTP 管理读和纯 MCP；不做移动窄屏测试，不用浏览器结果替代 K8s 时间轴。

## 验收

- SC-01：改前基线先于候选落台，身份与时间顺序可追。
- SC-02／03：默认 60、下限 45、高值合法、所有非法／错层／注释／策略负控有效；仓库与交付包同脚本通过。
- SC-04／05：真实 SIGTERM 下无宽限不足造成的提前强杀；在途、审计、RWO PVC、管理读与纯 MCP／SQL 均符合 Spec；首升按 OQ-1 闭合。
- SC-06：Chart 包版本独立，交付说明无零停机或 retroactive 假承诺，P1-83 SC-09 收到完整证据。

## 完成定义

本 Plan 的当前交付仅是 v0.1-draft 文档，不代表已实现。未来功能完成必须同时满足：OQ-1 已裁、终稿确权与开发授权、Chart／门禁实现及回归通过、P1-83 改前基线在先、B 层必做 UAT 全绿、证据和 INDEX 已登记、委托人验收。任一缺失都不得标记 S5 或主张可上线。

## 风险

| 风险 | 缓解 |
|---|---|
| Chart-only 被误用来承诺旧 Chart 首升 | Task 0 阻断；OQ-1 未裁不进入终稿；SC-05 独立核对旧 Pod |
| 静态门禁假阳性或交付包漏依赖 | 文档／层级读取、错层与注释负控、fake package 从包根执行；不新增辅助文件 |
| Helm 类型转换把非法值洗成合法 | 原始字符串正则＋整数下限，非法矩阵先写测试 |
| 只验 10 秒查询，未触达 40 秒预算 | 正常与有界最长两臂；最长臂复用 P1-83 版本化注入，构造不出记 BLOCKED |
| 单副本停机失败请求被误判为缺陷或被掩盖 | 全量记录，不要求为零，交 P1-83 决定 `preStop`；不自动重放写请求 |
| 60 秒被误读为固定停机时长 | 文档与实际计时说明它是上限，正常退出可提前 |
| 与 P1-83 同文件修改冲突 | 串行整合 `values.yaml`／`deployment.yaml`／`helm-lucy-gate.sh`／交付文档，跑双方回归 |
| 用低等级环境补缺口 | 无原生 amd64 B 层则 BLOCKED；静态通过不升 INDEX |
