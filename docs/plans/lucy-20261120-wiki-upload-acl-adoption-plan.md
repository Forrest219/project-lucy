# Wiki 覆盖上传采用 YAML 授权声明 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 声明不同或损坏时，治理方在原上传预检中显式保留／采用合法上传／重新设置后才能提交；全部合法选择、管理访问与纯 MCP 读取主路径可达。

**Architecture:** 保留 Spec 193 服务端授权决议、digest 与写入原语；WebUI 用声明规范键识别差异并撤销隐式默认，只接受当前选择的最新预检。组件／浏览器证明用户动作，API／文件证据证明结果；每例独立夹具。不改 KTX 或批量授权整包。

**Tech Stack:** TypeScript、Fastify、React、Vitest、demo Docker、真实 upload／access API、Lucy MCP `wiki_search`／`wiki_read`。

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施 Plan / v0.2 |
| 功能编号 | P1-65／REQ-030-086 |
| 状态 | S5｜阶段:S5｜v0.2。终稿已确权；开发授权已获得；实现完成；四项验证缺口已整改；改后 Docker UAT＝PASS（见测试台 INDEX）；功能合同已收口；不入核心分母；≠ 可上线。 |
| 授权边界 | 委托人已授权四项缺口整改、真实 UAT、清理与收口复核；本轮追加授权仅 commit 本任务；不 push、不发布，≠ 可上线 |
| 验收 | [Spec](../specs/lucy-20261120-wiki-upload-acl-adoption-spec.md) SC-01–14；[UAT](../qa/uat/suites/wiki-upload-acl-adoption/cases.md) R0／01–12，含全部子例；[终审记录](../reviews/2026-11-20-wiki-upload-acl-adoption-review.md) |

## 目标

1. 加宽、收窄、替换角色、空／缺失、all 及 corrupt 分支均有明确选择路径；合法同键保留原有便捷路径。
2. replace 上传损坏声明可显式保留当前或重新设置；create 损坏声明须重新设置。禁止直接采用损坏声明。
3. 写入结果与当前选择的预检一致；合法纯 MCP 用户可搜索并读取；空授权或明确移除的角色维持拒绝语义。
4. 改后复测逐例独立；历史基线 FAIL 留存，文档终审不能修改 UAT 判定。

## 开工前置

1. 终稿确权及开发／改后 UAT 授权已登记；本轮委托人追加四项验证缺口整改、夹具清理、状态同步与收口复核授权；禁止 commit／push。
2. 开发开始时重新记录候选 `gitSha`、工作树补丁标识；执行 Docker UAT 时记录实际镜像 ID／digest 与产品版本，不能用旧基线替代新候选。
3. 核对 Spec D1–D8、声明比较规则和 corrupt 矩阵；开发前先读 Spec 193 §5.2–5.4／§9.1，以及 Spec 引用的设计系统章节。
4. 明确仅支持单实例进程内并发。本条验证基于本机 Docker；不新增客户交付或 K8s 门槛。

## 实施任务（原实现已完成；本轮按文末四项整改节复核）

### Task 1：冻结组件与服务端断言

**Files:** `webui/src/__tests__/wiki.test.tsx`、`webui/src/__tests__/wiki-access-components.test.tsx`、`webui/server/__tests__/wiki-upload-access.test.ts`。

1. 为差异门禁写组件断言：UAT 07·M1–M9 全部初始无选择、提交禁用、未发 commit；11 的合法同键可保留。不得用发送 `access=preserve_current` 的 API 请求证明发生了用户点击。
2. 为保留／采用／重新设置三条成功路径及 corrupt 矩阵写断言，逐项对齐 SC-02／03／10／11。前端可保留损坏当前声明的拒绝态，不得误称修复。
3. 为 SC-04／05 准备独立文件：当前 B、上传 W、B≠W；验证拒绝后正文、原始声明、文件版本未变。选择模式不同但最终 ACL 相同不应被当成必须 stale 的负控。
4. 聚焦执行以下既有测试入口，先确认新增断言暴露缺陷；已有安全断言不得削弱：

```bash
cd webui
npx vitest run src/__tests__/wiki.test.tsx src/__tests__/wiki-access-components.test.tsx server/__tests__/wiki-upload-access.test.ts --maxWorkers=1
```

预期：新增差异交互断言修复前失败；已有服务端决议、版本、digest、风险确认断言保持通过。此为自动化合同证据，不冒充全真 UAT。

### Task 2：WebUI 显式选择与预检状态

**Files:** `webui/src/pages/WikiEditor.tsx`、`webui/src/components/WikiUploadPreflight.tsx`、`webui/src/lib/wikiAccess.ts`。

1. 按 Spec §2.1 比较声明规范键，区分 missing 与 empty；保留现有运行时集合比较函数的其他用途。
2. 初次解析预检可不带 access；差异／corrupt 不把服务端建议转成可提交选择。提供显式保留、合法采用、重新设置；未选时最终摘要显示待选择。
3. 每次选择变化撤销旧预检资格并重置风险确认；等待最新 preview，丢弃旧请求响应，最终摘要／Diff／效果与当前选择一致。不得把重新预检误当成重新初始化并清除用户选择。
4. stale／版本冲突后保留原始上传体，重新预检并重新确认；失败时显示可达恢复动作。覆盖 E1–E7；不新增入口或视觉模式。
5. 重跑 Task 1 聚焦测试；新增断言与既有安全断言均应通过。

### Task 3：补齐正向路径与风险回归

**Files:** 同 Task 1 的三个测试文件；仅在发现合同缺口且授权覆盖时修改 Task 2 的生产文件，不改 KTX。

1. 显式 `set` 的目标角色须不同于当前与上传；证明无默认回退。
2. 验证 create 合法非空／missing／empty／all，以及 corrupt 在 create／replace 的成功与拒绝分支。
3. 确认最终空／全角色风险确认、选择变化重置、独立管理访问、预检乱序与失败恢复。相同合法声明不新增必选步骤。
4. 复用既有命令，不新增测试脚本；记录 SC-01–14 到自动化断言与将来 UAT 子例的映射。

### Task 4：Docker 全真 UAT（已获执行授权，本轮整改复核 PASS）

**Files:** `docs/qa/uat/suites/wiki-upload-acl-adoption/runs/`、`docs/qa/uat/INDEX.md` 及本条已有状态镜像。

1. 按 [fixtures](../qa/uat/suites/wiki-upload-acl-adoption/fixtures.md) 为每例／每子例建独立 key，或逐次恢复完整基线后重取版本；检查 precondition 后才能执行测量步骤。03、05 不依赖 01／02 的副作用。
2. 同候选完整执行 R0／01–12 及全部子例。07 记录浏览器点击和 E1–E7；01–05／08–10 验 API／文件结果；06 在各合法写入检查点立即验纯 MCP，不能只在整套结束后读一次。
3. 负控记录原始正文／声明／版本；MCP 用有相应通道且角色隔离的 Agent，分别验证合法读与被移除／未授权拒绝。空／损坏保留时验拒绝，再由管理访问恢复后验成功。
4. 清理通过后记录新 verify 跑次；按实际结果维护 INDEX。原基线跑次不重写、不升级为 PASS；不得以手工写 ACL 冒充受测上传或管理访问。

以下浏览器验证已获本轮整改执行授权，并已以真实前台可视会话完成。07 逐编号记录 E1–E7，并覆盖 M1–M9 和三条显式选择；失败恢复／风险确认由 07·E3 与 12 验证。组件测试不替代全真浏览器 UAT；若另授降级，逐项记 GAP 与证据边界。只验桌面，不要求移动窄屏。

## 浏览器验证

- 路由：/wiki
- 视口：1920×1080
- 状态：E1、E2、E3、E4、E5、E6、E7
- 证据：docs/reviews/2026-11-20-wiki-upload-acl-adoption-closure-recheck.md

## 验收

- SC-01–14 均有自动化或真实接口的适配证据，并与 UAT R0／01–12 全子例逐项勾连；本轮改后复核 PASS；[新跑次](../qa/uat/suites/wiki-upload-acl-adoption/runs/2026-11-20-codex-closure-recheck.md)与 INDEX 已同步，旧跑次保留。
- 文档门禁用 `npm run lint:spec-docs`、`npm run lint:spec`、`npm run lint:terminology`、`npm run lint:ia-boundary`；`npm run lint:e2e-ledger` 仅作补充，本条未登记进其硬编码检查集合，须人工核对 P1-65 链接。
- 文档终审、功能合同收口、UAT 判定与发布取证分别登记，任何一项不得互相替代。

## 完成定义

- 本轮文档出口：独立终审通过并已同步终稿确权；四项意见闭合、声明／选择规则一致、隔离可执行、SC↔UAT 无悬空编号、台账与索引现值同句；本轮整改执行完成，最终验证与清理均通过。
- 实现／验证出口：原实现完成，本轮聚焦测试 161 项及严格断言 3 项通过；SC-01–14 有真实接口／前台浏览器／逐写入纯 MCP 证据，最终清理零残留；重新判定功能合同收口，UAT PASS 不替代发布取证。
- 功能合同收口仍不表示可上线；不以本条代替整包发布取证。不 commit／push，除非将来另获授权。

## 风险

| 风险 | 缓解 |
|---|---|
| 治理方覆盖正文多一次选择 | Spec 按 P2 最差子面记 ↓；同一 Dialog 显式保留仍可成交（SC-02），合法同键不加步骤（SC-12），管理访问与失败恢复可达 |
| 空／缺失比较被旧集合相等函数吞掉 | 门禁单独用声明规范键；07·M6／M7 分别验双向变化 |
| 把损坏声明处理成唯一重设路径 | replace 显式保留与修复分别验；create 不提供保留，禁止采用 corrupt |
| 负控被先前成功用例污染 | 03 每次明确 B≠W；05 从独立 B 真正改到 W；前置与测量分开记证据 |
| API 显式参数冒充用户显式选择 | 07 用真实点击／禁用／请求证据；API 只证明授权决议及落盘 |

## 修订记录

以下仅为各阶段历史快照，当前授权／实现／验证结果以头部与本轮新跑次为准。

- v0.2（2026-11-20）：独立终审通过；委托人明示本提示词＝终稿确权。见终审记录。
- v0.2-uat（2026-11-20）：改后 Docker UAT＝PASS WITH GAP。
- v0.2-impl（2026-11-20）：开发授权已获得；Task 1–3 实现完成待 UAT（vitest 161 PASS）；Task 4 NOT RUN。
- v0.2-review（2026-11-20）：按四项意见修订；SC-01–14 对齐 R0／01–12。历史基线 FAIL 保留。

## 四项验证缺口整改（2026-11-20，本轮已授权）

1. 固定 demo 镜像 ID／实际候选、运行中相关文件摘要与未提交补丁；重开 GAP-UAT-P1-65，历史证据原样保留。
2. 将 MCP 搜索、读取分别解析并严格断言目标 key、正文标记、结构化拒绝；每条合法写入即时检查，负控验证不被无关结果／网络错误／空响应误判。
3. 同一真实 Chrome 前台可视会话（headless=false），记录 visibilityState／document.hasFocus、导航→primaryReady、API 时间与截图；补 M1–M9、显式保留／采用／重设、corrupt 与同键 UI、T1 确认重置、T2 乱序、T3 真实失败恢复、T4 empty／missing／corrupt 管理访问恢复。
4. 仅删除本套件专用 Wiki 与本轮 Token，保留共享正式页／Role／Agent；恢复网络设置；核对清理后 API 与容器文件均无残留。
5. 聚焦回归与文档门禁通过后，按实际证据重判收口并同步全部既有状态镜像、INDEX／e2e。发现失败继续整改或如实保留缺口；不 commit／push。

新增受测脚本落 `scripts/uat/`，证据落本套件新跑次附件；不修改 KTX，不扩大到客户部署交付。上述步骤即委托人本次四项整改授权的具体执行范围。

整改结果：主轮 46 项功能／环境通过，中间清理错误原样留痕；补轮 6／6 通过并完成吊销与零残留检查，合并去重为 51 个独立验收 ID 全通过。153 份角色检查分别验搜索／读取，共 306 条工具断言。前台 primaryReady 28 个样本 190.35–5966.84 ms，中位 863.25 ms；API 时间独立记录。详见本轮浏览器证据与新跑次；未改产品运行代码、未 commit／push。
