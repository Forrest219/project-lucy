# Cases — UAT-SUITE-K8S-STOP-GRACE（v0.1-draft）

| ID | 标题 | 必做 | 对应 SC | 期望摘要 |
|---|---|---|---|---|
| UAT-KSG-R0 | 改前基线、身份与顺序 | 是 | SC-01 | P1-83 步骤 1⑥ 先于候选落台；镜像／Chart／values／台身份闭合 |
| UAT-KSG-01 | 默认与合法覆盖渲染 | 是（静态） | SC-02 | 默认 60；45／75 合法；Pod 数值字段与 `Recreate` 正确；无 `preStop` |
| UAT-KSG-02 | 非法／错层／包布局负控 | 是（静态） | SC-03 | 非法值、缺失、错层、注释、`RollingUpdate` 被拒绝；仓库与交付包等价 |
| UAT-KSG-03 | 运行中有效配置 | 是 | SC-04 | Deployment 与旧 Pod 有效宽限为候选值；镜像 digest、单副本、PVC 可追 |
| UAT-KSG-04 | `delete pod` 正常与有界最长排空 | 是 | SC-04 | 真实 TERM；无宽限不足强杀；在途与审计守恒；纯 MCP／SQL 恢复 |
| UAT-KSG-05A | 合规 Chart 升级→回滚→再升级 | 是 | SC-05 | 每个旧 Pod 的宽限与 TERM 可证；`Recreate`、RWO、审计与主路径不回退 |
| UAT-KSG-05B | 旧 Chart 首升 | 条件必做 | SC-05／OQ-1 | 归本条时旧 Pod 获 60 秒保护并通过；归 P1-52 时交接，不冒充本条覆盖 |
| UAT-KSG-06 | 文档、证据交接与清理 | 是 | SC-06 | 版本独立、无零停机假承诺；P1-83 SC-09 证据齐；无 `preStop`；清理完成 |

---

## UAT-KSG-R0 — 改前基线、身份与顺序

### 前置

- OQ-1 已裁定；Spec 已终稿确权，实现与测程授权已取得。
- 原生 amd64 K3s、隔离 namespace／PVC、真实 KTX／合成数据库可用。
- 候选 Chart 尚未部署到该台。

### 步骤

1. 读取 P1-83 步骤 1⑥ 的原始跑次，记录现行镜像 digest、Chart／values 摘要、旧 Deployment／旧 Pod 的有效宽限。
2. 核对改前 `delete pod` 带在途请求证据：TERM、退出码、是否强杀、在途结果、审计 ID／行数／水位、停机失败请求数及统一时间轴。
3. 记录改前是否发生强杀或审计丢失；没有则写「未观察到」，不得写成「已证明不会发生」。
4. 冻结候选镜像 digest、Chart 包版本、values 摘要和证据目录；确认候选首次落台时间晚于上述基线。
5. 若 OQ-1 归 P1-52，登记首升证据接收位置；若归 P1-85，核对其扩白名单与编排实现已经另行授权。

### 期望

- 基线真实、完整、可复查且先于候选落台；缺任一项 → `BLOCKED`。
- 不得用 Docker 结果、源码评论或新 Chart 的渲染结果替代改前基线。
- 基线是否强杀只作事实与优先级输入，不作为「必须失败才准继续」的人为条件。

### 清理

不改基线原始证据；只清理本套件新建的候选资源，保留基线 namespace／PVC 的处置记录。

---

## UAT-KSG-01 — 默认与合法覆盖渲染

### 前置

Task 1–4 已实现；静态检查可在 B 层台不可用的时候执行，但只产生开发证据。

### 步骤

1. 执行 `npm run gate:k8s-static`、`npm run test:k8s-gate-negative`、`npm run test:k8s-delivery-package`。
2. 对默认、local-test、k3s-test 及通用 profile 的渲染，使用结构化解析定位唯一 Deployment，记录 Pod spec 的宽限、类型、层级和 `strategy.type`。
3. 分别以 `--set terminationGracePeriodSeconds=45` 与 `=75` 渲染并跑通用门禁，记录输出值。
4. 检查主容器没有新增 `lifecycle.preStop`，产品 `appVersion`／KTX 版本未因 Chart 修订改变。

### 期望

- 默认值为 number `60`，位于 `spec.template.spec`；`strategy.type` 为 `Recreate`。
- 45 与 75 均通过且输出原值；通用门禁比较 `>=45`，不是固定等于 60。
- 既有 H1a／H1b 断言不回退；无 `preStop`。
- 本用例通过不代表套件 PASS，INDEX 仍等待正式 K8s 跑次。

### 清理

删除 `inbox/p185-static-*` 中无需保留的临时渲染；保留最终输出摘要与哈希，不留凭据。

---

## UAT-KSG-02 — 非法／错层／包布局负控

### 步骤

1. 分别渲染 `44`、`0`、`-1`、`45.5`、`not-a-number` 和空值，记录 Chart 拒绝结果。
2. 对静态门禁分别构造：缺失宽限、44、字段移到 container、只有注释含 60、`type: RollingUpdate`，逐一执行完整 H1 脚本。
3. 在 fake delivery package 中从包根运行 `scripts/preflight-helm.sh --k3s-only`，重复合法与至少一个负控。
4. 用 75 秒 values 跑完整门禁，证明下限断言不会误拒更高合法值。

### 期望

- Chart 自身非法值校验与门禁负控分别有证据，互不代签。
- 所有非法／缺失／错层／注释／非法策略均被拒绝；不存在仅改注释就能通过的假阳性。
- 仓库与交付包布局均使用同一逻辑且既有断言不回退。

### 清理

删除 fake package 和临时 values；不修改真实交付包。

---

## UAT-KSG-03 — 运行中有效配置

### 步骤

1. 在 R0 之后部署候选 Chart 到隔离原生 amd64 K3s。
2. 读取 Deployment 与当前旧 Pod 的 JSON，记录 Pod 级宽限、`strategy.type`、主容器 `lifecycle`、replicas、PVC、`imageID`、Pod UID、`containerID`、`StartedAt`。
3. 运行合法管理读和无 WebUI Cookie 的纯 MCP `initialize`→`tools/list`→轻量只读查询，独立 SQL 核对结果。
4. 记录任何 Deployment 字段与旧 Pod 字段不一致的情况，分开判断，不能用新模板覆盖旧 Pod 事实。

### 期望

- 当前旧 Pod 的有效宽限与候选 values 一致（默认 60 或合法覆盖），不是 K8s 默认 30。
- 单副本、`Recreate`、同一 RWO PVC、候选镜像 digest 均可追；无 `preStop`。
- 管理读与纯 MCP 基线成交；否则后续用例不得开始。

### 清理

保留当次 JSON；测试 Token 和连接只使用本套件隔离资产。

---

## UAT-KSG-04 — `delete pod` 正常与有界最长排空

### 步骤

**A 臂：正常在途**

1. 记录审计 ID 集、行数与水位，启动真实数据库约 10 秒延迟查询，并证明其已被 Lucy／KTX 受理。
2. 对当前 Pod 执行 `kubectl delete pod`，**不传** `--grace-period`，不使用 `--force`。
3. 同窗采集 TERM、Endpoint、`readyz`／`livez`、事件、当前与 `--previous` 日志、Pod UID、`containerID`、`lastState.terminated` 和退出码。
4. 核对查询只执行一次、结果与独立 SQL 一致、上游在结果终结前未被提前停止。
5. 记录停机期间所有新请求的结果与 `SERVICE_DRAINING` 等错误，不自动重放。

**B 臂：有界最长路径**

1. 在新的隔离 Pod／PVC 上，用 P1-83 版本化外部注入器构造会触达 P1-63 的 20 秒排空截止及后续清理的工作；证明注入生效。
2. 重复 A 臂的删除与时间轴采集，记录排空、supervisor／KTX 清理、孤儿清理和收尾各阶段实际耗时。
3. 若构造不出或不能证明触达对应阶段，记 `BLOCKED`，不得退回只跑 10 秒查询后宣称最长路径通过。

**共同恢复**

1. 等新 Pod Ready，核对同一 PVC；对改前已受理、尤其已返回成功请求的唯一 ID 集逐条核对恰好一次，且 `ledger_seq` 水位不回退，不得只比总行数。
2. 执行合法管理读；纯 MCP 无 WebUI Cookie 重新 `initialize`→`tools/list`→合法只读查询，结果对独立 SQL。
3. 保存停机失败请求数及分类，供 UAT-KSG-06 交接 P1-83 SC-09。

### 期望

- TERM 与旧 Pod 的 60 秒宽限证据完整；在 P1-63 声明的可响应、有界路径上，无宽限不足导致的 SIGKILL／137。
- 不把任何 137 都直接判为宽限问题，也不把任何 143 都直接判为成功；须与时间轴、在途和审计共同判定。
- 已受理审计事实守恒；停机后明确拒绝的新请求不伪记成功，失败请求数不要求为零。
- 管理读与纯 MCP／SQL 恢复成功；只 Ready 不算通过。

### 清理

导出证据后清理本臂注入、临时连接／Token／合成表和隔离 namespace／PVC；保留清理回执。

---

## UAT-KSG-05A — 合规 Chart 升级→回滚→再升级

### 前置

起始与目标 Chart 修订都含合法宽限；推荐起始 60、目标 75，镜像 digest 不变。

### 步骤

1. 从宽限 60 的 Chart N 开始，带真实在途请求执行 `helm upgrade` 到宽限 75 的合规修订 N+1。
2. 在每次操作前保存将被终止的旧 Pod JSON；操作中采集旧 Pod 有效宽限、TERM、退出码、在途、Endpoint、事件与审计。
3. 等替换完成后执行同卷管理读、纯 MCP／SQL 与审计守恒核对。
4. `helm rollback` 回 N，重复全部证据与主路径核对。
5. 再升级回 N+1，重复全部证据与主路径核对。
6. 核对每一步的 `Recreate`、replicas=1、RWO PVC 挂载与是否有 Multi-Attach／异常第二 Pod；记录实际停机时长。

### 期望

- 每个被终止旧 Pod 都以其创建时的有效宽限（60／75）完成可响应 SIGTERM 路径，无宽限不足强杀。
- `Recreate`、单副本、RWO PVC、已受理审计和主路径无合同外退化；Helm rollback 不被误当作 PVC 回滚。
- 任一阶段只验证新 Deployment 字段而缺旧 Pod 证据 → `BLOCKED`，不得 PASS。

### 清理

恢复约定的最终 Chart／values 与镜像 digest；导出证据后清理本用例临时资产。

---

## UAT-KSG-05B — 旧 Chart 首升（OQ-1 条件必做）

### 步骤

1. 从不含 `terminationGracePeriodSeconds` 的旧 Chart 和旧 Pod 开始，先证明旧 Pod 的有效宽限为 30 秒。
2. 按 OQ-1 指定的责任方与已授权编排执行首次升级，带在途请求采集旧 Pod 的 TERM、退出码、时间轴和审计。
3. 升级后按 UAT-KSG-03／04 核对新 Pod、管理读、纯 MCP／SQL 和审计。

### 期望（按裁定分列）

- **归 P1-85**：旧 Pod 在首升中获得不少于 60 秒的实际保护，不能只证明新 Pod 为 60；首升编排及负控全部通过后才可 PASS。
- **归 P1-52**：本用例可记 `SKIPPED`，但必须链接首升基线与 P1-52 接收位置；套件报告明确「本条未覆盖首升保护」，不得用本条 PASS 代替 P1-52。
- **OQ-1 未裁**：`BLOCKED`，不得登记套件 PASS 或 PASS WITH GAP。

### 清理

按首升编排的授权范围清理，不操作客户实例；保留旧／新 Chart、旧／新 Pod 和接收方证据链接。

---

## UAT-KSG-06 — 文档、证据交接与清理

### 步骤

1. 核对 `K8S_CONTRACT.md`：60＝45+15、合法值 ≥45、Pod 字段位置、宽限是上限、无零停机承诺、首升边界与 OQ-1 归属。
2. 核对 Chart 包版本独立递增，`appVersion`／KTX 未因此改变；兼容矩阵包含 0.2.10 历史行和新当前行；UPGRADE／NOTES 一致。
3. 汇总改前／改后 TERM、退出码、是否强杀、在途结果、审计 ID／行数／水位、停机失败请求数、Pod UID／containerID／StartedAt、Probe／Endpoint 原始样本和证据哈希，交接 P1-83 SC-09。
4. 确认实现没有新增 `preStop`，没有改 P1-63 运行时代码；记录实际退出时长，未把 60 秒写成固定等待。
5. 按 `runs/README.md` 写跑次和 SC 映射，先导出证据再清理所有本套件隔离资源、Token、连接和合成数据。

### 期望

- 文档、实现、跑次与 OQ-1 裁定一致；无 retroactive、零停机或「已证明绝不强杀」的过度叙事。
- P1-83 SC-09 可直接消费证据决定是否需要 `preStop`；本套件不代决。
- 清理完成且证据不含 Token、密码、kubeconfig 内容或客户秘密。

### 判定

- R0／01／02／03／04／05A／06 全过，且 05B 按 OQ-1 闭合，才可登记 **PASS**。
- 只有静态结果、缺 B 层、缺最长路径、缺旧 Pod 证据或首升未决，均不得写 PASS WITH GAP。
