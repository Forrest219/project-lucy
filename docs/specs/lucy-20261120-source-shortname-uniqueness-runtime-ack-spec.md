# 同连接跨 Schema 短名唯一性与保存运行时确认修复 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v0.4 |
| 日期 / 产品线 | 2026-11-20 / 0.30.0 |
| 功能编号 / 优先级 | P1-64／REQ-030-085；事故修复；不入核心分母 |
| 台账号 | 无 |
| 状态 | v0.4。功能合同已收口（SC-01–10通过；合并候选全库TypeScript0错误，782项Vitest及29项概念模块回归通过，真实前台浏览器计时完成）；本轮增量已提交；未推送／发布；不入核心分母；本条收口不表示可上线。 |
| 授权边界 | Task 1–6 与 Task 7 UAT 执行已获授权；禁止本轮 git commit／push（除非另授）；不改 KTX；不放宽 Source Map 判重 |
| 需求 / 计划 | [REQ-030-085](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) · [总账 P1-64](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [Plan](../plans/lucy-20261120-source-shortname-uniqueness-runtime-ack-plan.md) |
| 复现证据 / 测试台 | 改前 [Docker 复现](../qa/uat/suites/source-shortname-conflict/runs/2026-11-19-codex-docker-repro.md)；本轮 [合并最终候选复验](../qa/uat/suites/source-shortname-conflict/runs/2026-11-20-codex-combined-final.md) · [UAT-SUITE-SOURCE-SHORTNAME-CONFLICT](../qa/uat/suites/source-shortname-conflict/suite.md) |
| 评审修订 | 2026-11-20 Cursor 评审：撤销「无 WebUI 变更」豁免；补陈旧预览与 `compileError` 残留；画像证据分层；出口扩至 SC-01–10 |
| 终审记录 | [同候选整包最终评审](../reviews/2026-11-20-p160-p164-combined-final-review.md)；本条功能收口，当前整包不放行用户更新。 |

## 闭口层级

- 层级：功能合同
- 本条承诺：同一 Connection 跨 Schema 的合法同名物理表经扫描、校验、上传和启用后获得稳定且唯一的 `sourceName`；冲突输入不会被静默写入；Source Map 编译失败不会再被相关保存响应报告为 `runtimeAck=true`；启用表与连接创建的 WebUI 成功反馈以 `runtimeAck===true` 为准，不得仅凭 `written`／HTTP 200 宣称成功。
- 本条出口：SC-01–10 的分配、最终文件集合、发布锁内复核、保存 ack、WebUI 认读、局部故障注入和真实进程 API 检查。
- 不在本条出口：完整 MCP／Agent 旅程、客户现场六对冲突、SelectDB／Hive 元数据适配、跨模块或系统级故障演练、升级与发布取证；这些分别由已登记的 UAT 或后续发布取证承担。
- 上线关系：本条收口不表示可上线

## 1. 已证实问题与根因

2026-11-19 独立 Docker＋真实 MySQL 跑次已证实：

1. `weather.city` 基线可用后，扫描 `ods.city` 仍生成裸 `city`；validate、upload 和启用表保存均接受。随后 `tools/list` 为 403，其余四条 MCP 调用为 `isError=true`，统一原因是 `source_map_compile_failed:duplicate_source_name:hive-1:city`。
2. 保存响应同时给出 `written=true`、`policyRuntimeAck=true`、`runtimeAck=true`。只把夹具改为 `ods_city` 后，不重启容器，五条路径恢复，两个物理表均可查询。
3. 生成端 `webui/server/schema-structure.ts:187` 没有连接级保留短名；上传端 `webui/server/catalog-assets.ts:590` 只看单份文件；编译端 `webui/server/proxy/acl.ts:411` 却按 `(connectionId, normalize(sourceName))` 判重。
4. `commitEffectivePolicy()` 已将 Source Map 编译失败写入 `degradedAgents/issues`，但 `webui/server/index.ts:2027` 与 `:1774` 只检查 `policyVersion` 和 `degradedGlobal`，遗漏该失败类别。
5. `runtimeAck` 在既有合同中是 Policy Runtime ack 的兼容别名，不是 Catalog、Policy、Execution 三者的总 ack。本条不改这个字段分工。
6. 启用表页 `TableWhitelist.tsx` 保存成功路径只认 `written`；连接创建 Drawer 成功 toast 认 `executionRuntimeAck` 提示但不认 `runtimeAck`／`policyRuntimeAck`。因此即便 API 修好 ack，WebUI 仍可能对治理方／运维方展示假成功。

本方案不通过放宽或删除 Source Map 判重换取可用性；同名来源指向不确定物理表时仍必须失败关闭。

## 2. 修复决策

| 编号 | 决策 | 合同 |
|---|---|---|
| D1 | 唯一性范围 | 仅在同一 Connection 内分配和校验 `sourceName`；不同 Connection 可继续使用同名。比较规则与 ACL 一致：去首尾空白、去反引号／单双引号并转小写。 |
| D2 | 保留既有引用 | 重扫同一 Schema 时，优先保留目标 Manifest 中“物理表→sourceName”的既有有效映射；不因另一冲突文件后来被删除而把已分配短名自动改回裸名。 |
| D3 | 新增冲突表命名 | 未冲突的新表继续使用裸表名；冲突时依次尝试 `<schema>_<table>`、`<schema>_<table>_2`、`<schema>_<table>_3`。只改本次扫描中需要避名的表，不改冲突另一方或其他已有文件。分配只看**磁盘上**其他 Manifest：若先扫后扫的 Schema 均尚未上传，两边预览都可能得到裸名；先上传一方占用裸名后，另一方必须**重新扫描**或按校验建议改名后再传，过期预览上传按 D5 拒绝，不算生成器缺陷。 |
| D4 | 确定性 | 对本次物理表集合排序后分配；保留名、其他 Manifest 的保留名和本轮已分配名使用同一归一化规则。二次前缀冲突和大小写冲突必须避让。 |
| D5 | 最终集合校验 | validate 以“候选内容替换目标文件、其他文件不变”的最终文件集合判重。候选文件引入或保留的冲突返回 `DUPLICATE_SOURCE_NAME`；upload 返回 400，目标文件与发布记录不得前进。错误文案须同时给出冲突双方物理表与可执行建议（重扫或采用 `suggestedSourceName`）。 |
| D6 | 旧冲突可增量修复 | 最终集合中与本候选无关的既有冲突以 `PREEXISTING_SOURCE_NAME_CONFLICT` 诊断／警告返回，不阻断一个能减少旧冲突的合法修复上传；候选本身仍有冲突时不得借该规则放行。这样多组旧冲突可逐份修复，不形成“必须先一次修完全部”的死锁。 |
| D7 | 关闭校验写入竞态 | 外层 validate 只做早期反馈；正式 upload 必须在现有 `withPublishCoordinator` 发布锁内重新 validate 并使用这次结果，之后才创建发布记录、写临时文件和 rename。两个并发候选不能都凭锁前快照通过。 |
| D8 | 引用兼容 | 不自动改名已有 Manifest，不批量改写 overlay、Role、已保存查询或审计历史。新增冲突表此前没有可用的无歧义短名引用，其新引用使用分配后的 `sourceName`；重扫稳定性由 D2 保证。旧冲突的人工修复须显式修改短名，产品不猜测应迁移哪些引用。 |
| D9 | 保存 ack（API） | 连接创建和启用表保存时，只要 `PolicyRuntimeStatus.issues` 含 `source_map_compile_failed:*`，`policyRuntimeAck=false` 且兼容别名 `runtimeAck=false`。响应新增 `policyRuntimeIssues` 保留具体原因；既有 `written=true`、磁盘不回滚和 HTTP 200 语义不变。 |
| D10 | 既有行为不变 | 不把 `runtimeAck` 改成三个 ack 的合取，不把 `catalogRuntimeAck`／`executionRuntimeAck` 强制改为 false，不改变 Access 写入对普通单 Agent Role 编译失败的既有处理。Source Map 编译器继续判重并失败关闭；不改 KTX。 |
| D11 | WebUI 认读 ack | 启用表保存（`TableWhitelist`）与连接创建成功反馈（`CreateConnectionDrawer`）对齐 Spec 14 §0.3：`runtimeAck===true` 才可展示无条件成功；`runtimeAck!==true`（含缺失）须 error／warning，并可读展示 `policyRuntimeIssues` 中的 `source_map_compile_failed:*`（或等价摘要）。不得仅凭 `written`／HTTP 200／步进到 success 步冒充“已可用”。组件／交互测试继续保留；本轮另按 UAT-SNC-12 做真实前台浏览器与即时计时。 |

### 2.1 校验响应增量

- `CatalogAssetErrorCode` 新增 `DUPLICATE_SOURCE_NAME`；错误信息列出冲突短名、候选物理表、既有物理表和可执行的改名建议。
- `CatalogAssetWarningCode` 新增 `PREEXISTING_SOURCE_NAME_CONFLICT`，只用于 D6 的无关旧冲突。
- `CatalogAssetValidateResponse` 新增 `sourceNameConflicts[]`，每项至少含归一化 `sourceName`、冲突条目（`targetPath`、`schema`、`physicalTable`）、`involvesCandidate`；候选冲突另给 `suggestedSourceName`。
- 连接创建和启用表保存响应新增 `policyRuntimeIssues[]`，元素复用现有 `PolicyDegradeIssue`，不另造原因字符串。Source Map 失败可能对多个 `agentId` 各写一条**相同 reason**；调用方按 `reason` 去重展示即可，服务端不强制聚合，但不得省略任一条原始 issue。
- 以上均为新增字段／错误码，不删除或改型既有字段。没有冲突时 `sourceNameConflicts=[]`；无策略问题时 `policyRuntimeIssues=[]`。

## 3. 核心流程（伪代码）

```text
normalize(value):
  return trim(value).removeBacktickAndQuotes().toLowerCase()

allocateSourceNames(connectionId, schema, scannedPhysicalTables):
  files = readAllSchemaManifests(connectionId)
  target = files[schemaManifestPath(connectionId, schema)]
  reserved = normalized sourceNames from every file except target
  existingByPhysical = normalized physicalTable -> sourceName from target

  used = set(reserved)
  result = {}
  for physicalTable in stableSort(unique(scannedPhysicalTables)):
    bare = physicalTableName(physicalTable)
    old = existingByPhysical[normalize(physicalTable)]
    if old exists and normalize(old) not in reserved:
      candidate = old                              # D2；保留有效旧引用
    else if normalize(bare) not in used:
      candidate = bare
    else:
      base = schema + "_" + bare
      candidate = firstAvailable(base, base + "_2", base + "_3", ...)
    assert normalize(candidate) not in used
    result[physicalTable] = candidate
    used.add(normalize(candidate))
  return result

validateCandidate(connectionId, schema, candidateContent):
  baseErrors = existingShapePathAndConfigChecks(candidateContent)
  if baseErrors not empty: return invalid(baseErrors)

  target = schemaManifestPath(connectionId, schema)
  finalEntries = readAllSchemaManifestEntries(connectionId)
  finalEntries.replace(target, parse(candidateContent))
  conflicts = groupByConnectionAndNormalizedSourceName(finalEntries)
              .filter(group has more than one physical entry)

  candidateConflicts = conflicts.where(any entry.targetPath == target)
  unrelatedOldConflicts = conflicts - candidateConflicts
  errors = candidateConflicts.map(to DUPLICATE_SOURCE_NAME with suggested name)
  warnings = unrelatedOldConflicts.map(to PREEXISTING_SOURCE_NAME_CONFLICT)
  return {
    valid: errors empty,
    errors: baseErrors + errors,
    warnings: existingWarnings + warnings,
    sourceNameConflicts: conflicts
  }

uploadCandidate(request):
  early = validateCandidate(request)                # 只作早期反馈
  rejectInvalidOrUnconfirmedOverwrite(early)
  return withPublishCoordinator("manifest_upload", () => {
    current = validateCandidate(request)            # D7；锁内权威复核
    rejectInvalidOrUnconfirmedOverwrite(current)
    createReleaseAndJournal(current)
    atomicWriteAndExistingReloadPipeline(current)
  })

ackKtxWrite():
  status = commitEffectivePolicy()
  sourceMapFailed = status.issues.any(reason startsWith "source_map_compile_failed:")
  policyRuntimeAck = status.policyVersion != ""
                     and not status.degradedGlobal
                     and not sourceMapFailed
  return existingResponse + {
    policyRuntimeAck,
    runtimeAck: policyRuntimeAck,
    policyRuntimeIssues: status.issues
  }
```

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。以下为设计目标，尚无修复后证据。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 两个合法物理表并存后，纯 MCP 五条路径全部被编译拒绝 | 两表以稳定唯一短名共存；原 weather 查询不变，ods 使用分配后的短名可继续查询 | ↑ | 生成／ack 合同：SC-01／02；**可用性以 UAT-SNC-02／03／07 为准**（SC-08 仅证明扫描／上传／保存 API，不含 MCP） | — |
| P2 治理方 | 扫描和上传看似成功，保存后才发现整连接不可用；并发上传也可穿过单文件校验；过期预览易踩坑 | 生成时自动避名；手工冲突在写前得到冲突对象和改名／重扫建议；已有合法映射不被批量改写；启用表 WebUI 不再仅凭 written 假成功 | ↑ | SC-01–05／10；UAT-SNC-04／05／06／08 | — |
| P3 运维方 | `runtimeAck=true` 与实际 Source Map 拒绝分叉；启用表 toast 只看 written | API 返回 false 与 `policyRuntimeIssues`；启用表／连接创建 WebUI 认读 ack，假成功关闭 | ↑ | SC-06／07／10；UAT-SNC-07 | — |
| P4 管理层 | 保存“成功”不能代表合法用户可查 | ack、编译诊断、WebUI 反馈与真实 MCP 结果可分别核对 | ↑ | SC-06–08／10；UAT-SNC-02／07 | — |

本方案不新增对合法主路径的拒绝；D5 只拒绝会破坏最终 Source Map 的候选写入（含过期裸名预览），已有合法查询须继续成交。没有 `↓` 判定，也不触发负向补偿或产品级最差口径复核。

## 4. 验收标准

| 编号 | 可打假的标准 | 主要证据层 |
|---|---|---|
| SC-01 | 无冲突保留裸名；同 Connection 冲突分配 `<schema>_<table>`；前缀再冲突分配 `_2`／`_3`；大小写与引号归一化一致；不同 Connection 不互相占用；同一输入重复分配结果相同 | 本机 Vitest |
| SC-02 | 重扫保留目标文件的有效旧映射，包括此前已分配的带前缀名；不改其他 Manifest、overlay、Role 或已保存查询夹具；旧映射本身与其他文件冲突时不继续保留无效映射 | 本机 Vitest＋文件夹具 |
| SC-03 | validate 能列出候选最终集合中的冲突对象与建议（含重扫／`suggestedSourceName`）；upload 对候选冲突返回 400／`DUPLICATE_SOURCE_NAME`，目标文件字节、发布记录和旧 MCP 可用性不变；合法 `ods_city` 可上传；目录列举或任一既有 Manifest 读取／解析失败同样不得按“无冲突”放行 | 本机 API＋真实文件 |
| SC-04 | 两个不同 Schema 的同名候选在锁前都可通过时，发布锁内复核只让一个写入，另一个明确失败；最终文件集合无新增冲突，无半份 release／journal 推进 | 本机并发 API／局部故障注入 |
| SC-05 | 磁盘预置至少两组无关旧冲突时，逐份上传唯一短名可依次减少冲突，候选未引入冲突的文件不因无关旧冲突被拒；所有旧冲突均出现在诊断中，最后一次修复后集合无冲突 | 本机 API＋文件夹具 |
| SC-06 | 对启用表保存与连接创建分别注入 Source Map 编译失败：既有 `written=true`／HTTP 200 兼容语义保留，但 `policyRuntimeAck=false`、`runtimeAck=false`，`policyRuntimeIssues` 含原始 `source_map_compile_failed:*`；不得被非空 `policyVersion` 或其他 ack=true 覆盖 | 本机真实进程 API |
| SC-07 | 冲突消除并重新提交后两个保存路径恢复 `policyRuntimeAck=true`／`runtimeAck=true`；`catalogRuntimeAck` 与 `executionRuntimeAck` 仍按各自事实返回；普通 `role_resolution_failed` 的既有 Access 写入语义不变 | 本机真实进程 API＋回归 |
| SC-08 | 在真实进程中依次完成 weather／ods 扫描、validate、upload、启用表保存，生成结果分别为 `city`／`ods_city`，最终集合无冲突，保存 ack 为 true，策略运行时无 Source Map issue；不通过手工改生成 YAML 获得通过。**本条不含 MCP**；P1 可用性见第 5 节 UAT | 本机真实进程 API |
| SC-09 | 既有重复 Source Map 仍按原拒绝码失败关闭；相关 schema-structure、catalog-assets、policy-compile、canonical-source-key、Spec 178、连接创建和启用表回归通过，TypeScript 类型检查通过 | 本机自动化 |
| SC-10 | 启用表保存与连接创建的 WebUI：当响应 `runtimeAck!==true` 时不得展示无条件成功 toast／success 步；须 error 或 warning，并暴露 Source Map issue 摘要；`runtimeAck===true` 时既有成功路径不变。组件测试与 UAT-SNC-12 真实前台浏览器＋计时共同覆盖 | 本机 Vitest（组件）＋UAT-SNC-12（真实前台浏览器／计时） |

SC-01–10 全部通过只表示本条功能合同候选可进入收口评审，不表示 UAT PASS 或可上线。完整 MCP 与合法用户恢复路径必须另按第 5 节全真执行。

## 5. 修复后 UAT 验收

测试台沿用 `UAT-SUITE-SOURCE-SHORTNAME-CONFLICT`，详细步骤见 [cases.md](../qa/uat/suites/source-shortname-conflict/cases.md)。必做范围：

1. **R0／01 基线**：候选镜像身份和关键源码哈希一致；独立 Docker＋真实 MySQL；weather 单表的 tools/list、catalog、read、query 可用；begin 按当前 P1-60 工具面合同验收。
2. **02 原始事故转绿**：不手改扫描 YAML，ods 自动生成 `ods_city`；validate／upload／启用表保存成功且 ack 真实；不重启容器，公开 MCP 路径全部成功（当前 P1-60 零绑定隐藏 begin，按 tools/list＋精确 begin_not_available 验兼容，不算调用成功），weather.city 与 ods.city 的 `COUNT(id)` 各为 1。
3. **03 引用稳定**：重扫 weather／ods 后短名不漂移，既有 Role、overlay 和已保存查询夹具仍可读、可查。
4. **04 负向写入保护**：手工提交裸 `city` 冲突时 validate 明确失败、upload 400、磁盘不变，先前合法 MCP 路径仍可用；错误含重扫／建议短名提示。
5. **05 二次前缀冲突**：预置 `ods_city` 占用后，ods.city 分配 `ods_city_2`，两表真实可查。
6. **06 并发竞态**：两个锁前同名候选只有一个能发布，另一个明确失败；最终无冲突且既有 MCP 不受影响。
7. **07 ack 负控与恢复**：以磁盘夹具注入旧冲突，保存不得返回 `runtimeAck=true`，须带具体 issue；经 API 修复后无需重启，ack 与公开 MCP 路径恢复。WebUI 认读由 SC-10 与 UAT-SNC-12 真实前台浏览器／计时共同覆盖。
8. **08 多组旧冲突**：至少六组合成旧冲突可逐份修复，不被无关旧冲突阻断；最后一组修复后编译与查询恢复。该用例只证明合成六组，不冒充客户现场六对逐一核验。运行时 `compileError` 可能只暴露最后一对——完整清单以治理校验 `sourceNameConflicts[]` 为准。
9. **09 回归与证据**：原始响应、磁盘前后摘要、策略 issue、查询结果和清理状态留档；INDEX 只在全部必做项真实通过后改为 PASS，任一失败保持 FAIL。

10. **10 旧别名防抢占**：已有 ods_zebra→ods.zebra 后新增 ods.ods_zebra；旧别名仍查原表，新别名 ods_ods_zebra 查新表且不同值可辨。
11. **11 大写物理名**：aux.City 的 columns／namesOnly 扫描自动避名为 aux_City；物理名和实际SQL保留大小写。
12. **12 真实前台反馈**：启用表保存／创建连接两入口各验成功、未确认、恢复，记录导航和反馈时延、可见／焦点与API分列；不得出现未确认的成功Toast。

禁止以 Code Review、Vitest、容器重启、手工修绿后跳过 02、只验证“拦住冲突”或只检查 ack 字段代替全真 UAT。本轮须执行 UAT-SNC-12 真实前台浏览器／计时；不做移动窄屏测试。

## 6. 非目标与风险

- 不自动迁移已经损坏的线上资产，不猜测 overlay／Role／已保存查询的改名意图；提供的是可增量、可诊断的修复路径。
- 不把编译错误聚合成新的 ACL 拒绝码；`sourceNameConflicts[]` 是治理校验诊断，运行时的原有 `source_map_compile_failed:*` 保持兼容。
- **残留**：`acl.ts` 多冲突时仍可能只保留最后一个 `compileError` 字符串；本条不改该聚合行为。多组冲突的完整对象清单以 validate／`sourceNameConflicts[]` 为准；`policyRuntimeIssues` 至少含最后一对对应的 `source_map_compile_failed:*`。
- 不处理多进程、多副本或共享卷写者；并发保证只限当前单实例、单副本边界。
- 读取既有 Manifest 失败或内容根暂时不可列举时不得把“没有读到”当成“没有冲突”；校验应失败并给出可读原因，不能 fail-open。
- 生成与上传之间若外部文件集合变化，以锁内复核为准；调用方需按冲突响应重扫或改名，不得静默覆盖他人文件。
- 先扫后传的过期裸名预览被 D5 拒绝是预期行为，不是生成器回退。
- 本复现使用 MySQL 共享链路；客户 SelectDB／Hive 元数据路径及现场资产仍需各自的发布取证，不在本条出口。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- `DUPLICATE_SOURCE_NAME`：拟新增的上传校验错误码；沿用已登记的 `sourceName`、`Connection`、`Manifest` 术语。
- `PREEXISTING_SOURCE_NAME_CONFLICT`：拟新增的旧冲突诊断码，只表示与本次候选无关、允许增量修复的磁盘问题，不表示运行时已健康。
- `sourceNameConflicts` 与 `policyRuntimeIssues`：拟新增 API 机器字段，不是新的 WebUI 产品概念；不得把它们显示成“运行时已生效”。

## 交互合同

- 范围：启用表保存页与连接创建 Drawer 的成功／失败反馈；对齐 Spec 14 §0.3 的 `runtimeAck` 认读（D11／SC-10）。
- 改变：当 `runtimeAck!==true` 时，不得展示无条件成功 toast 或把创建流程标为已可用成功；须 error／warning，并可读暴露 Source Map issue 摘要。
- 不改变：页面路由、组件布局主结构、按钮排布、空态、浏览器全页旅程；本轮须执行 UAT-SNC-12 真实前台浏览器／计时；不做移动窄屏测试。
- 文案须遵守术语标准；不得把 `policyRuntimeIssues` 说成“运行时已生效”。


## 2026-11-20 最终评审整改（R1–R3；委托人已授权）

- R1：分配前先预留本次扫描仍存在的所有有效旧映射，再为新物理表分配；新增表名等于旧短名不得抢占旧来源。D2／SC-02 含此反例。
- R2：物理表身份保留真实大小写；只有 sourceName 占用比较使用归一化。allocator 的返回键与 builder 查询键须一致；City／city 为两个物理表时也不能合并。D1／D4／SC-01 含字段与 namesOnly 两分支。
- R3：并发 UAT 不再把任意非 200 当通过。PUBLISH_COORDINATOR_BUSY 只记为忙拒绝，须在窗口释放后重试同一过期候选并收到 400／DUPLICATE_SOURCE_NAME；其他 5xx 直接 FAIL。保留 SC-04 的受控锁内复核单测。
- 本轮按新的浏览器规则补充 UAT-SNC-12：独立 Docker 上真实前台浏览器，实际操作启用表页及连接创建 Drawer；分别覆盖 ack=true、Source Map issue 导致 ack=false、恢复后合法路径。记录导航→关键内容、点击保存→结果可见的端到端时间，与同次 API 耗时分列，检查 visible／hasFocus；不使用 API mock。
- 新增 UAT-SNC-10（旧别名防抢占并查原表／新表不同值）、11（大写物理表自动避名并查数）；现有 R0／01–09 继续执行。新跑次以本轮完整分母登记，旧 PASS 与改前 FAIL 均保留。
- SC-10、D11 与第 5 节旧的“仅组件／默认不跑浏览器”约定仅作为 v0.2 历史口径；本轮明确由真实前台浏览器＋计时取代该豁免。

当前工具面说明：P1-60 已生效时，零绑定夹具的 begin 不公开，强制调用只接受精确 begin_not_available，不能将其写成可调用路径成功；本轮公开四主路径必须全部成功。该兼容分支由 runner 独立回归固定。

## R1–R3阶段历史验收记录（SC-09修复前，2026-11-20）

R1–R3整改、169项Vitest与5项判定器回归完成；[完整Docker／浏览器跑次](../qa/uat/suites/source-shortname-conflict/runs/2026-11-20-codex-r1-r3-final.md) R0／01–12 PASS，另补视口断言复跑。SC-09仍未满足：全库TypeScript 49条基线错误（新增0），不修改合同或静默豁免；因此功能合同未收口。Spec头部状态为现值，之前确权与授权叙述为历史记录。

## SC-09修复后验收记录（2026-11-20）

委托人授权继续处理49条类型错误；宿主与最终候选容器均0错误，strict与include未改。413项Vitest、29项概念核心回归通过；新增角色／Agent依赖反例覆盖模板与defaults变化。最终镜像40104b7f的[完整Docker与前台浏览器跑次](../qa/uat/suites/source-shortname-conflict/runs/2026-11-20-codex-sc09-final.md) R0／01–12 PASS。SC-09已满足，先前三台账类型缺口关闭；当前开发状态看头部。

最终[SC-09修复后终审](../reviews/2026-11-20-p1-64-sc09-final-review.md)通过本条功能合同收口；当前候选整包仍受已纳入P1-60未关闭问题约束，本条收口不等于用户更新放行。
