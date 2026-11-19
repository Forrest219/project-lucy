# 同连接跨 Schema 短名唯一性与保存运行时确认修复 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让同 Connection 跨 Schema 的同名物理表获得稳定唯一短名，并确保 Source Map 编译失败不会被连接创建或启用表保存报告为 `runtimeAck=true`。

**Architecture:** 在 Lucy 服务端增加连接级短名注册表读取、确定性分配与最终集合判重；生成端保留有效旧映射，上传端在现有发布锁内复核候选最终集合。两条 `ktx.yaml` 写入路径只补 Source Map issue 对 Policy ack 的约束，不改全局 ACL 拒绝语义和三个 ack 的字段分工。

**Tech Stack:** TypeScript、Fastify、YAML、现有 publish coordinator／ACL／Catalog reload、Vitest、Supertest、Python UAT runner、host-native Docker、真实 MySQL；不改 KTX，不新增依赖。

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施 Plan / v0.1-draft |
| 功能编号 | P1-64／REQ-030-085 |
| 状态 | v0.1-draft。仅修复方案与验收设计；终稿未确权；开发未授权；测试台最近跑次 FAIL（缺陷已复现），修复后复测 NOT RUN；不入核心分母；≠ 可上线。 |
| 授权边界 | 仅核对和文档；以下任务均未执行，运行代码、配置、测试 runner、构建、修复后 UAT、提交与发布均须另行授权 |
| 验收 | [Spec](../specs/lucy-20261120-source-shortname-uniqueness-runtime-ack-spec.md) SC-01–09；[UAT 用例](../qa/uat/suites/source-shortname-conflict/cases.md) R0／01–09 |
| 原始证据 | [2026-11-19 Docker 复现](../qa/uat/suites/source-shortname-conflict/runs/2026-11-19-codex-docker-repro.md) |

## 目标

1. 同 Connection 的 `sourceName` 在生成、上传校验和 Source Map 编译三处使用同一归一化与唯一性事实。
2. 新生成的冲突表自动获得 `<schema>_<table>` 或确定性的数字后缀；已有合法映射和引用不因重扫漂移。
3. 冲突上传在写盘前失败，锁内复核消除校验到写入的竞态；旧冲突可逐份修复。
4. Source Map 编译失败在连接创建与启用表保存中返回真实 ack 和可定位 issue，合法路径仍能成交。
5. 用原始 Docker 事故剧本和新增对抗用例同时证明“约束生效”与“合法用户纯 MCP 仍可用”。

## 开工前置

1. 本 Spec／Plan 完成终稿确权，委托人另发具名开发授权；2026-11-19 的排查与复现授权不继承为开发授权。
2. 开工时冻结候选 HEAD、工作树 diff、镜像 digest、关键源码哈希和 2026-11-19 FAIL 证据；共享工作树已有其他任务改动，先核对并禁止覆盖或代改。
3. 确认 D1–D10，尤其是：只给新增冲突表避名、无关旧冲突允许增量修复、`runtimeAck` 仍是 Policy ack 别名、普通单 Agent Role 编译失败的 Access 写入语义不变。
4. 沿用单实例、单副本；不引入分布式锁，不改 KTX、数据库 schema、客户配置、现有 demo 数据卷或部署制品。
5. 测试文件与 runner 修改也须在授权范围内；不新增 npm 命令或 CI job，因此无需新增测试门禁命令登记。若后续新增命令，先补 `docs/governance/test-layers-and-release-gates.md` §2／§8。
6. 默认不做浏览器测试。若实现改为新增 WebUI 文案或交互，先回本 Spec 撤销豁免并补交互合同，不能隐式扩大范围。

## 实施任务（当前全部未执行）

### Task 1：以失败测试冻结短名分配与兼容规则

**Files:**
- Create: `webui/server/__tests__/source-name-registry.test.ts`
- Modify: `webui/server/__tests__/schema-structure.test.ts`
- Test reference: `webui/server/__tests__/schema-structure-batch.test.ts`

**Step 1：写分配器失败测试**

覆盖以下独立断言：
- 无冲突时 `weather.city → city`；已有 `city` 时 `ods.city → ods_city`；已有 `ods_city` 时使用 `ods_city_2`。
- `City`、`` `city` ``、`"city"` 与 `city` 按 ACL 规则冲突；另一 Connection 的 `city` 不占位。
- 目标 Manifest 的 `ods.city → ods_city` 在重扫时保持，即使裸 `city` 已释放；无效旧冲突映射不保留。
- 同一组乱序输入产生同一 YAML 键分配。

**Step 2：运行测试并确认改前失败**

Run:
```bash
cd webui && npx vitest run server/__tests__/source-name-registry.test.ts
```
Expected: FAIL，原因是注册表模块尚不存在；不得先写实现再补一个天然通过的测试。

**Step 3：写预览兼容失败测试**

在 `schema-structure.test.ts` 增加真实临时项目或显式 registry dependency fixture：weather 已占用 `city`，ods 扫描预览应生成 `ods_city`；重扫同一目标保持分配结果。

Run:
```bash
cd webui && npx vitest run server/__tests__/schema-structure.test.ts
```
Expected: 新断言 FAIL，当前仍生成裸 `city`；旧断言继续通过。

**Step 4：提交该测试切片（仅在委托人要求提交时）**

```bash
git add webui/server/__tests__/source-name-registry.test.ts webui/server/__tests__/schema-structure.test.ts
git commit -m "test: cover connection-scoped source name allocation"
```

### Task 2：实现连接级短名注册表和生成端分配

**Files:**
- Create: `webui/server/source-name-registry.ts`
- Modify: `webui/server/schema-structure.ts:187-232,1107-1151`
- Modify: `webui/server/proxy/acl.ts:469-471`（只复用同一 normalize helper，不改拒绝流程）
- Test: `webui/server/__tests__/source-name-registry.test.ts`
- Test: `webui/server/__tests__/schema-structure.test.ts`

**Step 1：实现最小注册表读取与纯分配函数**

提供与 Spec 伪代码一致的：
- `normalizeSourceRef(value)`；
- `readConnectionSourceManifests(projectRoot, connectionId, candidate?)`；
- `allocateSourceNames(schema, physicalTables, registry)`；
- `findSourceNameConflicts(entries)`。

目录读取使用现有 `resolveContentPaths`，只扫描该 Connection 的 `_schema/*.yaml`。候选按目标路径替换，不叠加旧目标。目录列举、任一既有 Manifest 读取或 YAML 解析失败都使本次校验失败并说明目标，不得被当成空注册表或无冲突；候选自身的既有解析错误仍先走原单文件错误码。用对应失败测试固定该 fail-closed 分支。

**Step 2：接入 `buildMinimalSchemaManifest` 与 `previewSchemaStructure`**

保留现有前三个参数，新增可选分配上下文以兼容直接调用；生产 `previewSchemaStructure` 必须读取真实连接级注册表并传入。表集合取 columns 与 `ensureTables` 的并集，稳定排序后分配；列、类型、降级和 deferred 行为不变。ACL 只改为复用归一化 helper，保持 `duplicate_source_name` 与失败关闭不变。

**Step 3：运行分配与既有扫描测试**

Run:
```bash
cd webui && npx vitest run \
  server/__tests__/source-name-registry.test.ts \
  server/__tests__/schema-structure.test.ts \
  server/__tests__/schema-structure-batch.test.ts \
  server/__tests__/doris-external-catalog.simulation.test.ts \
  server/__tests__/large-schema-ls19-24.test.ts
```
Expected: 全部 PASS；新增断言证明 `city／ods_city／ods_city_2` 与重扫稳定，旧扫描功能无回归。

**Step 4：提交该实现切片（仅在委托人要求提交时）**

```bash
git add webui/server/source-name-registry.ts webui/server/schema-structure.ts webui/server/proxy/acl.ts webui/server/__tests__/source-name-registry.test.ts webui/server/__tests__/schema-structure.test.ts
git commit -m "fix: allocate unique source names across schemas"
```

### Task 3：实现最终集合校验与发布锁内复核

**Files:**
- Modify: `webui/server/catalog-assets.ts:41-100,590-682,826-865`
- Modify: `webui/server/__tests__/api.catalog-assets.test.ts`
- Create: `webui/server/__tests__/catalog-source-name-conflict.test.ts`

**Step 1：写校验、零写入和旧冲突修复失败测试**

覆盖 SC-03／05：
- weather 已有 `city` 时，ods 裸 `city` 的 validate 为 false，含 `DUPLICATE_SOURCE_NAME`、两个物理表和 `ods_city` 建议；upload 400，目标哈希与上传记录不变。
- 候选 `ods_city` 通过；大小写冲突与二次前缀冲突按同一规则处理。
- 目标旧文件被候选替换而非重复计入。
- 预置两组无关旧冲突，逐份唯一化均可上传，`sourceNameConflicts` 保留诊断；候选仍冲突时不能借旧冲突警告放行。

Run:
```bash
cd webui && npx vitest run server/__tests__/api.catalog-assets.test.ts server/__tests__/catalog-source-name-conflict.test.ts
```
Expected: 新断言 FAIL，当前裸 `city` 仍 `valid=true` 且可上传。

**Step 2：写发布锁竞态失败测试**

构造两个不同 Schema 的同名候选，使锁外 validate 都有机会接受；并发 upload 后要求恰好一个成功，另一个 400，最终无冲突，失败方没有推进 release／journal。测试必须验证锁内第二次校验，不得只 mock 锁外响应制造绿。

Run:
```bash
cd webui && npx vitest run server/__tests__/catalog-source-name-conflict.test.ts
```
Expected: 当前实现可让两个候选都基于旧快照通过，新增竞态断言 FAIL。

**Step 3：实现校验与锁内重验**

在 `validateCatalogAsset` 中加入最终集合判重及新增响应字段；在 `uploadCatalogAsset` 的 `withPublishCoordinator` 回调起点重新校验并检查 overwrite，后续 release、journal、临时文件、rename 全部使用锁内 validation 和 safety。保持现有原子写、内容镜像、Catalog reload 和恢复日志语义。

**Step 4：运行上传与发布协调回归**

Run:
```bash
cd webui && npx vitest run \
  server/__tests__/api.catalog-assets.test.ts \
  server/__tests__/catalog-source-name-conflict.test.ts \
  server/__tests__/semantic-batch-functional-contract.test.ts \
  server/__tests__/semantic-batch-journal-lifecycle.test.ts \
  server/__tests__/display-invalidation.test.ts
```
Expected: 全部 PASS；400 分支无目标文件和发布状态推进，合法上传及既有发布恢复不变。

**Step 5：提交该实现切片（仅在委托人要求提交时）**

```bash
git add webui/server/catalog-assets.ts webui/server/__tests__/api.catalog-assets.test.ts webui/server/__tests__/catalog-source-name-conflict.test.ts
git commit -m "fix: validate manifest source names before publish"
```

### Task 4：修复两条保存路径的 Source Map ack

**Files:**
- Modify: `webui/server/index.ts:1768-1790,2020-2058`
- Create: `webui/server/__tests__/source-shortname-runtime-ack.test.ts`
- Modify: `webui/server/__tests__/api.create-connection.test.ts`
- Modify: `webui/server/__tests__/api.save.test.ts`

**Step 1：写 ack 负控和恢复测试**

对两条路由分别构造真实 Source Map 编译失败，断言 HTTP／`written` 兼容行为不变，但 `policyRuntimeAck=false`、`runtimeAck=false`、`policyRuntimeIssues` 含原始原因。移除冲突后重新提交，两个 ack 恢复 true；`catalogRuntimeAck`／`executionRuntimeAck` 按各自夹具事实独立返回。另保留普通 `role_resolution_failed` 的 Access 写入回归，证明未全局改 `evaluateRuntimeAck`。

Run:
```bash
cd webui && npx vitest run server/__tests__/source-shortname-runtime-ack.test.ts
```
Expected: FAIL；当前非空 `policyVersion` 且非全局降级时仍返回两个 true。

**Step 2：实现共享的窄判定**

在 `index.ts` 用同一辅助函数计算两条 `ktx.yaml` 写入路径的 ack：非空版本、非全局降级、无 `source_map_compile_failed:*` issue。响应附 `policyRuntimeIssues`；不改 `evaluateRuntimeAck`、ACL degrade 分类、磁盘回滚策略或 execution canary。

**Step 3：运行 ack 与 ACL 回归**

Run:
```bash
cd webui && npx vitest run \
  server/__tests__/source-shortname-runtime-ack.test.ts \
  server/__tests__/api.create-connection.test.ts \
  server/__tests__/api.save.test.ts \
  server/__tests__/policy-compile.test.ts \
  server/__tests__/policy-runtime-i6.test.ts \
  server/__tests__/canonical-source-key.test.ts \
  server/__tests__/spec-178-tools-list-compile-denial.test.ts
```
Expected: 全部 PASS；Source Map 失败时 ack 为 false，恢复后为 true，既有 ACL 拒绝码与普通 Role 失败语义不变。

**Step 4：提交该实现切片（仅在委托人要求提交时）**

```bash
git add webui/server/index.ts webui/server/__tests__/source-shortname-runtime-ack.test.ts webui/server/__tests__/api.create-connection.test.ts webui/server/__tests__/api.save.test.ts
git commit -m "fix: reject runtime ack after source map compile failure"
```

### Task 5：运行标准自动化与真实进程 API 合同验收

**Files:**
- Modify if API documentation is required after implementation: `webui/docs/03-api-spec.md`
- Verify only; no runtime file is authorized by this task alone.

**Step 1：运行类型检查和聚焦回归**

Run:
```bash
cd webui && npm run typecheck && npx vitest run \
  server/__tests__/source-name-registry.test.ts \
  server/__tests__/schema-structure.test.ts \
  server/__tests__/catalog-source-name-conflict.test.ts \
  server/__tests__/source-shortname-runtime-ack.test.ts \
  server/__tests__/api.catalog-assets.test.ts \
  server/__tests__/api.create-connection.test.ts \
  server/__tests__/api.save.test.ts \
  server/__tests__/policy-compile.test.ts \
  server/__tests__/canonical-source-key.test.ts \
  server/__tests__/spec-178-tools-list-compile-denial.test.ts
```
Expected: typecheck exit 0，全部测试 PASS。

**Step 2：运行项目标准文档门禁**

Run:
```bash
npm run lint:spec-docs && npm run lint:spec && npm run lint:terminology && npm run lint:ia-boundary && npm run lint:e2e-ledger
```
Expected: 全部 exit 0；共享工作树中他人的未跟踪草案 WARN 单独记录，不得代改或写成自己的行为通过。

**Step 3：执行 SC-08 真实进程 API 验收**

在隔离项目与真实 MySQL 上，不经手改 YAML，完成 weather／ods 扫描、validate、upload 和启用表保存；保存原始 API 响应、最终 Manifest、策略 issue 与文件摘要。预期 `city／ods_city`、最终无冲突、两个 ack 为 true。该步骤仍不是 MCP UAT。

**Step 4：补 API 文档并复核注释**

实现若增加上述响应字段，同步 `webui/docs/03-api-spec.md` 与相关类型；检查修改函数附近的旧注释，确保不再描述“只按非全局降级确认”或“单文件校验即可”。不创建额外总结文档。

### Task 6：扩展原始 runner 并执行修复后 Docker UAT

**Files:**
- Modify after separate test-runner authorization: `scripts/uat/reproduce-source-shortname-conflict.py`
- Verify: `docs/qa/uat/suites/source-shortname-conflict/{suite,cases,fixtures}.md`
- Create after a real run: `docs/qa/uat/suites/source-shortname-conflict/runs/YYYY-MM-DD-<agent>-docker-fix-retest.md`
- Update after a real run: `docs/qa/uat/INDEX.md`、`docs/governance/e2e-ledger.md`

**Step 1：保留复现模式并增加验证模式**

增加显式 `--mode repro|verify`，原 `repro` 继续证明旧候选缺陷，`verify` 执行 R0／01–09。关键源码哈希比较加入 `catalog-assets.ts`、`index.ts`、`source-name-registry.ts`；任何镜像／宿主不一致立即停止。断言不得靠删除原始失败证据或放宽结果翻绿。

**Step 2：构建独立 host-native 候选镜像**

Run:
```bash
docker buildx build --builder default --load -t project-lucy:snc-candidate .
```
Expected: 本机架构构建成功；不得使用 `lucy-amd64` builder，不重建或修改现有 demo 容器与 volume。

**Step 3：执行完整修复后 UAT**

Run:
```bash
SNC_IMAGE=project-lucy:snc-candidate \
  python3 scripts/uat/reproduce-source-shortname-conflict.py --mode verify
```
Expected: R0／01–09 全部 PASS；02 不手改 YAML 即生成 `ods_city`；04 冲突写入被拒且旧 MCP 可用；07 ack 负控为 false 且修复后恢复；08 六组旧冲突可逐份修复；容器、网络、私有目录全部清理。

**Step 4：登记真实结果**

将脱敏原始响应和 summary 留档到本次 `runs/`，逐条记录 R0／01–09。只有全部必做项通过才把 INDEX 改为 PASS；任一失败保持 FAIL，环境无法全真则 BLOCKED 并另请降级授权。Spec 状态、总账镜像和测试台各按自己的 SOT 更新，不用 UAT 结果倒推功能合同收口。

### Task 7：终审与完成登记

**Step 1：运行交付物上的最终检查**

重复 Task 5 的类型检查、聚焦测试和文档门禁；若标准全量测试被运行，按相同基线比较新增／既有失败，不把既有红灯混入本条，也不静默修复无关问题。

**Step 2：核对 diff 与文件清理**

Run:
```bash
git status --short
```
Expected: 只包含获授权的实现、测试、文档和真实 UAT 证据；删除本轮产生的临时日志、缓存、候选容器及私有夹具，不删除他人已有文件。

**Step 3：按授权进行代码终审与状态更新**

完成实现 CR；分别更新 Spec／Plan 同句状态、总账、两份 README 索引、需求池和 e2e 勾连。功能合同收口、UAT PASS、发布取证和可上线分别表述，缺少任何一层都不得冒称下一层。

## 浏览器验证

不适用：本方案不改变用户可见 WebUI 表面，只改服务端生成、校验、API 响应与 ack；按仓库默认不执行浏览器或移动窄屏测试。若实施引入页面或文案变化，先补交互合同并重新取得对应验证授权。

## 验收

- **功能合同**：SC-01–09 逐条有本机自动化或真实进程证据；至少覆盖分配稳定、二次冲突、最终集合、锁内竞态、六组旧冲突增量修复、两条保存 ack 负控与恢复。
- **测试台**：独立 Docker＋真实 MySQL 的 R0／01–09 全真执行；02 原始事故不手改 YAML 转绿，04 约束生效时旧合法 MCP 仍可用，07 ack 与实际可用性一致。
- **兼容**：已有合法短名、overlay、Role、已保存查询和普通 Role 编译失败处理不变；ACL 判重与失败关闭不放宽。
- **证据边界**：Vitest／CR 不是 UAT；合成六组不等于客户现场六对；功能合同收口、UAT PASS 和可上线不得互相推导。

## 完成定义

- 本轮文档交付完成＝配对 Spec／Plan、用例草案、总账／需求池／三台账和索引登记完成，形态门禁通过；不代表修复完成。
- 未来实现完成＝全部 Task 的获授权改动完成，SC-01–09 有证据，标准检查通过，实现 CR 完成。
- 未来 UAT 完成＝同一候选镜像的 R0／01–09 全部真实通过并登记 INDEX；失败或 NOT RUN 均不得写成修复已验收。
- 发布仍需另行发布取证；本条任何完成状态都不表示可上线。

## 风险

| 风险 | 控制与验收 |
|---|---|
| 自动改名破坏既有引用 | 只处理新增冲突表；目标文件有效映射优先保留；SC-02、UAT-SNC-03 |
| 前缀二次冲突或大小写绕过 | 统一 ACL 归一化、确定性 `_2`／`_3`；SC-01、UAT-SNC-05 |
| 锁外校验与写入之间发生竞态 | 发布锁内重新 validate；SC-04、UAT-SNC-06 |
| 旧冲突全局拦截导致无法逐份修复 | 候选冲突硬拒绝、无关旧冲突只诊断；SC-05、UAT-SNC-08 |
| 为修 ack 改变既有字段语义 | 仅两条 `ktx.yaml` 写入路径识别 Source Map issue；SC-06／07 |
| 只证明拒绝、主路径仍不可用 | 每个负控都配合法成交与恢复断言；UAT-SNC-02／04／07 |
| 测试脚本吃旧断言造成假绿 | 保留 repro 模式，verify 使用新断言并核对镜像源码哈希；Task 6 |

## 假设与刻意不做

- 采用“新增冲突表自动避名”而非“冲突双方统一改名”，因此不需要多文件原子改名和引用批量迁移。
- 无关旧冲突允许增量修复是必要逃生路径；它不表示运行时健康，最后仍须全部消除才能 ack=true。
- 不改 KTX、ACL 拒绝码、execution canary、前端页面、客户配置和部署拓扑。
- 当前只形成草案，不选择或启动执行会话；待终稿确权和开发授权后再按任务顺序实施。
