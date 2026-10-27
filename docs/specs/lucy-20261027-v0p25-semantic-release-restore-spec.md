# Lucy v0.25 语义发布历史版本与整批恢复 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / v0.4-claude-final |
| 日期 / 目标版本 | 2026-10-27 / v0.25 |
| v0.4 修订 | 根据 Claude Code 最终聚焦复核补删除后的强制索引重建与读回、reindex 前全量 upsert 范围、可恢复终态审计协议，并明确校验作用域、目录级重命名、差异快照和遗留布局；见 §11.3 |
| v0.3 修订 | 根据 Claude Code 第二轮只读复核补受控镜像删除与实际 KTX 扫描范围、单表 YAML 导入写入口、reindexing 启动结算及四项一致性边界；发现与处置见 §11.2 |
| v0.2 修订 | 根据 Claude Code 只读审查收口 absent 删除、release／快照／幂等持久化顺序、索引范围披露、审计前置、记录字段、协调器重入、trigger 归一化、真实写入口与保留竞态；审查发现及处置见 §11.1 |
| 功能编号 / 优先级 | L25-15 / P0，语义批量修改的可逆性与运维安全能力 |
| 状态 | 设计完成、待需求审查；暂不开发，不代表实现或验收通过 |
| 授权来源 | 2026-10-27 Forrest 要求将批量修改后的历史版本恢复落盘为新功能并完成 Spec、Plan |
| 规划入口 | [Lucy v0.25 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) §2.9 |
| 关联设计 | [L25-11 语义资产批量维护](lucy-20261020-v2p5-semantic-batch-operations-spec.md)，共享发布协调器、校验、CAS、失败恢复与审计，不替代其合同 |
| 实施计划 | [L25-15 实施 Plan](../plans/2026-10-27-lucy-v0.25-semantic-release-restore-implementation-plan.md) |
| 实施主体 | Lucy；复用 KTX 既有公开接口，不修改 KTX 源码 |

本文件定义拟实现行为，不代表当前平台已经支持，也不授权编码、浏览器验证、镜像构建、部署或发布。本次仅形成设计与实施计划；SRR-01–SRR-22 全部未执行。

## 1. 背景、现状与问题

### 1.1 用户问题

批量修改语义并成功发布后，用户可能发现口径改错、误改范围过大，或希望回到某次发布前的内容。此时需要回答三个问题：

1. 能否按发布批次恢复，而不是逐表寻找和手工拼回 YAML？
2. 恢复前能否看清本批目标、后续改动冲突和全局索引将一并纳入的其他待同步变更？
3. 恢复失败、重复提交或进程中断时，能否避免二次损坏并保留可审计证据？

该能力属于批量运维的 P0 安全闭环。没有它，发布失败可以依靠故障恢复处理，但“发布成功后后悔”仍缺少平台内的受控路径。

### 1.2 当前实现证据与差距

2026-10-27 对当前源码做静态核查，结论只代表所读源码，不冒充任何运行镜像或客户环境的实机验收：

| 当前能力 | 已核实事实 | 与本功能的关系 |
|---|---|---|
| 发布失败恢复 | `webui/server/semantic-recovery-journal.ts` 在正式写入前保存原 bytes / absent、预期新 digest 和顺序；写盘失败后按实际字节恢复，发现第三方内容时阻断覆盖 | 只解决一次写入过程中的故障恢复；日志终结后不是长期版本历史，不能直接充当本功能数据源 |
| 发布记录 | `webui/server/semantic-assets.ts` 的 release sidecar 明确不存 YAML 原文，记录状态、文件 digest、Diff 和校验结果 | 无法从历史记录重建批次前完整内容，需要独立、持久、受保留策略约束的快照 |
| 发布生效 | 全部目标写完后关闭恢复日志，再记录 `reindexing` 并异步 reindex，终态为 `published` 或 `reindex_failed` | 可复用状态机和索引路径；恢复也必须如实区分文件保存与 Agent 生效 |
| 单表 YAML 历史 | 单表每表保留最近 5 版；“恢复此版本”返回未保存的导入草稿，仍需用户保存 | 不是整批恢复，也不覆盖 Manifest 或跨表同批一致性；本功能不改变其交互和保留规则 |
| 共享写入与冲突保护 | L25-11 已定义共享发布协调器、CAS、幂等、全局索引范围和恢复阻断 | 本功能复用这些能力，不新建并行发布引擎，不在本 Spec 顺带修补其遗留项 |

因此，本功能不是给现有“恢复此版本”换文案，也不是把 recovery journal 长期保留后就宣称支持历史恢复。

## 2. 产品决策与恢复语义

### 2.1 核心定义

- **批次前快照**：一次正式内容写入前，在共享发布临界区内持久化的完整原状态。覆盖本批全部实际目标，每项包含项目相对路径、原 bytes 或显式 `absent`、原 digest、预期新 digest 或预期 `absent`、资产类型和可解析时的完整表身份。`null` digest 只表示文件不存在，CAS 中必须与文件实际不存在对应。
- **恢复到本批次发布前**：以用户所选发布批次的批次前快照为目标，对该批次实际写入的文件做整批逆向恢复。它不是“撤销之后所有批次”，也不是把平台恢复到某个全库时间点。
- **恢复也是新发布**：每次恢复产生新的 `webui_restore` 发布批次和新的批次前快照。原发布记录的状态、Diff、文件清单和审计历史不被改写；可通过恢复批次自己的快照做反向恢复，包括恢复批次曾删除文件的场景。
- **默认不覆盖后续或外部改动**：提交时，所选批次的每个目标当前 digest / absent 必须等于该批次预期新 digest / absent。任一目标不匹配即整批阻断、零正式写入；若需回到更早历史，按由新到旧顺序恢复中间批次。本期不提供强制覆盖。

例：同一文件依次经历 A、B 两次发布。直接恢复 A 会因当前内容等于 B 的发布后内容而冲突；先恢复 B，再恢复 A，才能按受控链路回到 A 发布前。恢复 B 本身也可再被恢复，从而回到 B 发布后。

“批次”按一次写操作的**全部实际写盘目标**界定，不按页面或表数量界定。单表保存若同时改写 overlay 和共享 Schema Manifest，两者都必须进入同一快照；预检还须列出共享 Manifest 影响的其他表，但只恢复该批次实际写入的文件，不扩写其他 overlay。单表保存批次可以成为恢复来源。

### 2.2 可恢复来源

只有同时满足以下条件的发布记录可选择恢复：

1. 已发生至少一个正式内容写入；
2. 已到达 `published` 或 `reindex_failed` 终态；
3. 同实例的批次前快照完整、可读且通过 digest 核验；
4. 当前没有未解决的恢复阻断，发布协调器可用。

| 来源 / 状态 | 处理 |
|---|---|
| `published` | 可预检；最终仍须通过快照、CAS、完整校验和保留状态检查 |
| `reindex_failed` | 可预检；内容已经写入，CAS 以磁盘内容为准，恢复后重新索引。不强制先修复旧索引，旧失败与新恢复状态分别保留 |
| `promoting` / `reindexing` | 暂不开放，提示等待当前批次到达终态；`promoting` 用于本功能覆盖的内容写入批次，不用于纯手动 reindex |
| `blocked` / `promote_failed` | 不作为历史恢复来源；沿用原有失败恢复和修复入口 |
| 纯手动 reindex | 没有内容写入和批次前内容快照，不提供恢复按钮 |
| 本功能上线前的历史记录 | 显示“快照不可用”，不回填、不猜测历史内容 |
| 快照过期、清理、缺失、损坏或实例不符 | 显示“快照不可用”及可披露原因，不伪称可恢复 |

对于当前尚无发布记录的正式内容写入口，实施时必须先在共享协调器内建立一致的 releaseId、快照和终态记录，再开放对应恢复能力；不得只覆盖批量导入路径。S0 必须一次性核实并冻结“写入口→真实写点→快照接入点”清单，当前至少包括单表保存、**单表 YAML 导入／单表版本恢复落地（`writeSourceYamlImport`）**、Manifest 上传、批量导入和整批恢复；SRR-01 以冻结清单逐项验收，实施时发现新写点须先补清单和设计评审。连接 ID 重命名属于目录级语义变更，本期不生成可恢复快照、不作为恢复来源，但其目录 rename 必须纳入共享发布互斥或在恢复期间显式阻断，并受路径 CAS / 范围复核约束。

### 2.3 索引与无关变更

恢复只修改所选批次快照中的内容根目标及其一一对应的受控 KTX 镜像目标，不修改无关文件。但 KTX 索引是全局范围，恢复后的 reindex 可能同时纳入其他已经存在于磁盘的待同步变更。当前 KTX 实际读取的是 `projectRoot/semantic-layer/` 兄弟视图，不是内容根；通用内容镜像又是“只 upsert、永不删除”，因此恢复删除必须按 §5.2 做计划内受控镜像删除，不能指望普通镜像同步撤销 Agent 侧旧语义。遗留布局 `LUCY_CONTENT_ROOT=.` 下两面是同一路径，双面 CAS、journal 和回读退化为单面，受控镜像写入／删除不得重复执行。

本功能区分两个可验证概念：

- **完整索引范围**：恢复计划完成受控写入／删除，并执行与 `prepareSemanticLayerForKtx` 相同口径的**全量内容根→兄弟视图 upsert 后**，实际由 `ktx admin reindex` 扫描的 `projectRoot/semantic-layer/` 全量适用文件集合。预检按“当前兄弟视图 ∪ 内容根现存文件 + 恢复计划”推导候选集合；提交在镜像操作后显式执行同一全量 upsert，再枚举实际集合并比对。该集合必须可枚举、可核对；无法取得或与计划不一致时整批阻断。
- **既有待同步变更**：完整索引范围中当前内容与上次成功索引内容不同的文件。内容根存在但尚未镜像的文件单列为一类已知待同步变化；其他当前平台没有持久索引 digest 账本而无法可靠判定的差分标为 `unknown`。不得宣称能完整逐文件判定，不以新建索引账本作为前置，也不以空列表冒充“无其他变更”。

恢复预检必须分区展示：

- **本次恢复目标**：将恢复、删除或保持不变的快照目标，以及逐文件前后 digest / absent；
- **全局索引范围与既有待同步变更**：全量 upsert 后实际 KTX 兄弟视图的完整扫描范围、已知变化和 `unknown` 覆盖率。UI 必须说明“无法逐文件确认的内容也可能被本次索引纳入”，不得宣称“只有这些文件会生效”。

提交时使用同一完整范围定义重新枚举并校验。范围无法取得或校验时整批阻断；不得把恢复包装成局部生效。空 diff 不创建空恢复批次，也不借空恢复同步其他待处理变更。

## 3. 目标与非目标

### 3.1 本期目标

- 所有正式语义内容写入口在写盘前持久化批次前快照，写快照失败则零正式写入。
- 发布历史提供可恢复性状态、恢复预检、确认提交、状态追踪和只读恢复包导出。
- 整批 CAS、完整校验、原子写盘、受控运行镜像同步／删除、失败恢复、reindex、幂等与审计形成闭环。
- 支持 `absent` 的语义：批次新建的文件可在内容根和 KTX 兄弟视图中成对恢复为删除，批次删除的文件可在两面恢复原 bytes；含删除的计划使用 `reindex --force` 清空后全量重建并做语义读回，镜像、索引删除或读回结果未知不得记 `published / confirmed`。
- 以固定保留策略控制存储，不承诺无限历史。

### 3.2 非目标

- 不重建本功能上线前的历史，不从旧 recovery journal、单表版本、release Diff 或 Git 记录猜测批次前快照。
- 不提供任意恢复包上传、跨实例恢复、强制覆盖冲突或“一键回到任意全库时间点”。
- 不追踪 CLI / Git 的完整版本历史；只把其后续内容变化识别为 CAS 冲突。
- 不回滚连接、启用表范围、角色、行级策略、Token、审计、数据库数据或 KTX 源码；连接 ID 目录重命名不作为可恢复批次，但须按 §2.2 与恢复互斥。
- 不改变现有单表“恢复此版本”为未保存草稿的合同，不合并 Wiki 历史版本。
- 不宣称文件系统和 SQLite 索引具有共同原子事务，不新增多写者或多副本支持。
- 不顺带修改 L25-11 的 `confirmOverwrite` 等既有遗留项；相关问题仍按原 Spec 和独立任务处理。

## 4. 快照数据与保留合同

### 4.1 存储格式

快照存放在：

```text
.ktx-ui/semantic-release-snapshots/<releaseId>/snapshot.json
```

建议逻辑结构如下，字段可在实施时按统一类型风格细化，但语义不得减少：

```ts
type SemanticReleaseSnapshot = {
  schemaVersion: "semantic-release-snapshot/v1";
  snapshotId: string;
  releaseId: string;
  instanceId: string;
  createdAt: string;
  actor: string;
  entries: Array<{
    order: number;
    targetPath: string;          // 已规范化的项目相对路径
    assetKind: "overlay" | "manifest";
    identity?: { connectionId: string; schema: string; table: string };
    originalBase64: string | null; // null 仅表示原目标 absent
    originalDigest: string | null;
    expectedNewDigest: string | null; // null 仅表示批次后目标应为 absent
  }>;
  snapshotDigest: string;        // 对约定规范化内容计算，不含本字段自身
};
```

规范性要求：

1. 快照与恢复日志可以在同一临界区由共享构建器生成，但生命周期、读取模型和清理策略必须独立；不能以恢复日志已 `completed` 为由删除历史快照。快照捕获是**调用方已持有共享发布临界区时执行的函数**，不得自行再次取锁。持锁断言必须核对本进程持有的 holder 身份（holder 引用及 pid / acquiredAt），同时适用于 `withPublishCoordinator` 和裸 `acquirePublishCoordinatorLock`；不得只看 AsyncLocalStorage 标记或锁文件存在性。
2. 目标路径必须由服务端按内容根解析并防止越界，API 不接收宿主绝对路径。快照不得进入 Agent 检索、发布候选、普通 staging GC 或语义维护包。
3. 先构建完整序列化内容并计算精确落盘字节数（包括 Base64 膨胀和 manifest），完成容量预检与腾位后，才使用同目录临时文件 + rename 原子写入；写后回读并核验 `snapshotDigest`、entry 数量、路径和原 bytes digest。任何失败均在首个正式写入前阻断发布。
4. 快照以实际写盘目标为准，不把只读依赖、未选择文件或全局索引范围混入恢复写盘集合。原 digest 与预期新 digest 均以 `string | null` 表示存在 / absent，禁止用空字符串 digest 代替 absent。
5. 实例标识使用 `.ktx-ui` 下首次生成并持久保存的 UUID；已有部署级持久唯一 ID 可作为来源，显式环境配置只作受控覆盖，禁止回退到所有部署共享的 `lucy-default`。实例 ID 用于防误恢复，不是安全边界。
6. 发布记录必须保存自己的 `snapshotId`；关联失败视为必要记录持久化失败，不得继续正式写入。历史记录缺失时显示未知或不可用，不从 `published` 推导“有快照”。

### 4.2 保留策略

固定采用以下三个上限，任一先到即清理最旧的可清理快照：

- 最多 **20 个发布记录仍存在的可恢复批次**；只计与仍存在的 `published / reindex_failed` 内容批次记录关联的快照，`blocked / promote_failed / promoting` 不占用该计数，但也不因此获得长期保留承诺；
- 自快照创建起 **30 天**；
- 快照总量 **512 MiB**，按实际序列化落盘字节计算，包含 manifest、Base64 原内容和元数据。

发布历史侧车当前只保留最近 100 条记录。记录已淘汰的快照归为 `orphan`：不可作为恢复来源、不占 20 个可恢复名额，但仍计入 30 天与 512 MiB，并作为最旧非活跃对象优先清理；不得因记录缺失而绕开容量或永久滞留。

所有限值与 TTL 必须落到 `SEMANTIC_BATCH_LIMITS` 共享事实源，不得在 API、UI 或清理任务中另写常量。

清理与活跃引用规则：

1. 活跃引用使用持久 lease 明确登记 `leaseId / snapshotId / kind / expiresAt`，kind 至少覆盖 `publish / restore / preview / export`。预览 lease 与 30 分钟有效期一致；导出 lease 到流结束；启动时仅清理已过期 lease。
2. 快照清理和 lease 变更与快照创建使用同一串行机制，防止“检查后又被引用”的竞态。活跃 lease 不得清理；清理不得删除或修改历史发布记录。
3. 新快照先按精确预计字节数逐出最旧、非活跃快照并预留一个可恢复批次名额，再原子落盘；腾位后仍不足 512 MiB 则不落新快照且零正式写入，禁止“先落盘超限再清理”。
4. 快照被清理后，可用性投影显示“快照不可用”及 `expired / count_limit / size_limit / orphan`；缺失或损坏记录 `missing / corrupt`，实例不符记录 `instance_mismatch`，不得伪造成正常过期。
5. 普通 staging GC 不得读取快照目录。恢复包导出使用短期 lease，不延长原快照的 30 天保留期。

### 4.3 发布记录兼容与持久化顺序

新增恢复批次使用 `trigger=webui_restore`。发布记录增加以下可选字段：

- `snapshotId`：本批次自己的批次前快照；普通内容发布也必须填写；
- `restoreOfReleaseId`：仅恢复批次，所选择的来源批次；
- `restoreSourceSnapshotId`：仅恢复批次，来源批次快照，区别于本批次自己的 `snapshotId`；
- `restorePlanDigest`：仅恢复批次，已确认的恢复计划 digest；
- `recoveryRequired`：是否存在未核验的故障恢复或终结对账义务；
- `activationStatus=unconfirmed / confirmed`：文件、索引和必要终结记录是否已形成已确认生效结论；
- `terminalAuditPending`：内部终态审计是否尚待追加或核对。为 true 时，公开状态投影必须保持“生效待确认”，即使内部记录已为满足审计守卫而写入 `published / confirmed`。

`snapshotUnavailableReason` 是快照可用性投影 / 清理元数据，不回写来源发布记录。旧记录缺少 `recoveryRequired / activationStatus / snapshotId` 时显示 `unknown` 或快照不可用，不从 `published` 反推 confirmed 或存在快照。

本功能覆盖的内容写入批次必须在首个正式写入前持久化一条可见记录，状态为 `promoting`、`activationStatus=unconfirmed`。该状态表示已建立写前意图但写入与索引尚未终结，不表示正在 reindex；纯手动 reindex 不使用该状态。规范顺序为：

1. 创建 `promoting` 记录和幂等 `intent`；
2. 创建快照并成功把 `snapshotId` 写入该记录，再创建故障恢复日志；
3. 持久化受理审计后才允许正式写入；
4. 写入与镜像完成后转 `reindexing`，最终按真实结果转 `published / reindex_failed`；失败转 `promote_failed` 并保留快照关联和恢复状态。成功终态必须另按 §8 的 `terminalAuditPending` 可恢复协议终结。

步骤 1–3 任一失败都必须在零正式写入时结清为明确失败；不得静默忽略 release 更新返回的“记录不存在”。启动恢复除处理未终结 journal 外，还必须核对 **`promoting`、`reindexing` 以及 `terminalAuditPending=true` 的 `published`** 记录、幂等状态、快照关联、journal、终态审计和实际 bytes：`promoting` 未写入可明确结清，已全部写入可从 `reindexing` 继续，无法证明时置 `recoveryRequired=true` 并阻断。`reindexing` 在 journal 已完成且内容根／镜像 digest 一致时，可从既有索引阶段重跑一次以确认终态；若不能安全重跑或索引结果仍未知，结清为可重试的 `reindex_failed / activationStatus=unconfirmed`，不得无限停留 `reindexing`，更不得猜 `published / confirmed`。pending 成功终态按 §8 核对并补全或降级，不得因内部 `published` 跳过对账。

历史恢复不修改来源批次状态；可恢复性由快照和当前状态计算，不在来源记录上写“已恢复”来抹除历史。`webui_restore` 必须在服务端 release 类型、列表筛选归一化、前端 `coerceTrigger` 和 CSV 标签中全程保留；旧记录缺 trigger 仍按既有规则归为 `webui_publish`。

## 5. 恢复预检、提交与失败处理

### 5.1 预检

预检在只读阶段重建并持久化恢复计划，固定有效期 **30 分钟**，绑定实例、操作者、来源 releaseId、snapshotId 和当前基线，并登记防止快照被清理的 preview lease。计划至少包含：

- 来源批次、快照、创建时间、原操作者和原触发类型；
- 每个目标的完整身份、相对路径、原状态、当前状态、恢复后状态及 digest / absent；共享 Manifest 的全部影响表单独列出；
- `restore / delete / unchanged` 分类和可定位 Diff；
- 冲突目标及原因；
- 完整索引扫描范围、已知待同步变化和 `unknown` 覆盖率；
- 完整校验结果、计划 digest、过期时间和可提交 verdict。

`unchanged` 与 no_change 必须按以下顺序判定：

1. 首先对全部 entry 做 CAS。当前为 `originalDigest != expectedNewDigest` 所描述的批次前内容，说明已被外部改回，仍是冲突，不得当作 no_change。
2. 只有 `originalDigest == expectedNewDigest`（含二者均为 absent）的 entry 才是本来源批次的 `unchanged`；混合场景中它仍参与全目标 CAS，但不进入实际写盘集合。
3. 只有全部 entry 都是上述 `unchanged` 时才返回 no_change，不创建恢复记录、幂等意图或 reindex。部分 unchanged、部分有差异时仅写差异目标。

预检本身不写正式文件、运行镜像或索引。任何目标当前 digest / absent 已偏离所选批次预期新 digest / absent 时，可以返回带冲突的预览供查看，但 verdict 必须阻断。

### 5.2 提交与 CAS

提交只接受 `previewId + planDigest + idempotencyKey`，不接收客户端提供的恢复内容或目标路径。服务端使用与批量发布相同的协调器获取 / 释放原语，新增 `semantic_restore` kind，并让锁覆盖写入和后台 reindex 直到终态；快照、journal 等 helper 不再次取锁。服务端在临界区内依次执行：

1. 重新检查当前会话语义发布权限、实例、操作者、预览有效期和恢复阻断；已 `applied` 的合法幂等重放只返回既有批次状态，不要求旧预览仍有效；
2. 重读来源批次和快照并核验完整性，重建计划并比对 `planDigest`；
3. 重算全部内容根目标及校验依赖 digest / absent，确认目标仍等于所选批次的发布后内容；对将写入或删除的 KTX 兄弟视图目标也核验其 digest / absent 与内容根基线一致，不一致则阻断而非覆盖未知镜像内容；
4. 对完整恢复计划和恢复候选的实际 KTX 兄弟视图索引范围运行既有统一校验及合同门禁；
5. 若非 no_change，先持久化 `promoting` release 和幂等 `intent`，再持久化本次恢复自己的快照、release.snapshotId 和覆盖内容根／镜像实际写入的故障恢复日志；
6. 在首个正式写入前持久化 `outcome=staged` 的受理审计；失败则结清 `promote_failed` 和幂等 `failed`，零正式写入；
7. 仅对实际有差异的目标再次做基线比较，再原子写盘或删除，并同步运行镜像。恢复目标为 absent 时，调用**恢复计划专用、仅删除同一相对路径**的受控镜像删除函数，并在删除后回读确认两面均 absent；不得改变 `content-mirror` 面向其他场景的“永不删除”策略，不得按目录清扫或删除计划外文件；
8. 镜像同步后重新枚举实际 `projectRoot/semantic-layer/` 扫描集合并与计划比对，随后把幂等意图转为 `applied`、release 转为 `reindexing`，执行一次现有增量 reindex，按真实结果及必要终结审计写入 `published / confirmed` 或 `reindex_failed / unconfirmed`。

任一项失败都不得跳过。恢复预检后的另一个 WebUI 写入、单表保存、单表 YAML 导入、Manifest 上传、CLI / Git 修改，包括 `absent → 存在`，均使 CAS 失败并要求重新预检。内容根已删除但镜像未删除、镜像删除结果未知或实际扫描范围不一致时，只能按失败恢复或 `reindex_failed / unconfirmed` 处理，不得记 `published / confirmed`。

### 5.3 幂等

幂等记录按实例 + 操作者 + 客户端幂等键索引，绑定 `previewId / planDigest / sourceReleaseId / attemptId`，至少保留 **24 小时**，并明确三态：

| 状态 | 写入时点与重放规则 |
|---|---|
| `intent` | 在 `promoting` 记录之后、快照与正式写入之前持久化。重放必须回读 release、snapshotId、journal 和实际状态；只能返回真实进行中的批次或进入启动对账，不得仅凭 key 返回 accepted。若 release 已结清 `promote_failed` 且零正式写入可证明，先把幂等结清为 `failed`，再允许同键同计划新 attempt；结果未知则置 `recoveryRequired` 并禁止自动重试 |
| `applied` | 正式写入和镜像核验完成后持久化。重放返回同一 releaseId 的当前状态，不重复写盘或 reindex；release 不存在或关联不一致属于异常，不得伪装成功 |
| `failed` | 明确失败时结清并保留原因。只有能够证明零正式写入时，同键同计划才可建立新 attempt；写入结果未知或 `recoveryRequired` 时禁止自动重试 |

- 同键不同计划返回冲突。每次重新预检生成新的 planDigest，UI 必须同时使用**新幂等键**；预览过期后的路径是“重新预检 + 新幂等键”，不是复用旧键换计划。
- 已 applied 的断线重连可以越过旧预览有效期直接查询原批次；新提交仍必须持有有效预览。
- 幂等命中不能绕过当前权限、实例和恢复阻断检查；未过期记录不得因当前 500 条容量上限被静默提前淘汰。达到上限且没有可清理过期记录时，拒绝新 intent 并零正式写入。
- 已过期的幂等记录可清理，但不得作为永久历史或快照替代品。

### 5.4 写入与索引失败

- 写盘、删除、镜像同步／删除或必要记录失败时，停止后续步骤，复用恢复日志按实际字节逆序恢复本批次已改的内容根和镜像目标；不覆盖第三方新内容。故障日志必须记录受控镜像目标的原 bytes / absent 与 digest，使镜像删除后也能恢复原 bytes。
- 本功能需要显式扩展 L25-11 §7.2 第 4 条的“预期新 digest”类型：recovery journal 的 `newContent / expectedNewDigest` 必须允许 `null` 表示预期 absent。`restoreEntry` 以当前 absent == expected absent 判定删除已落地，再按原 bytes 恢复；原目标也 absent 时为 unchanged，其他内容才是第三方冲突。该扩展只补删除方向，不改变既有实际字节判定原则，须在实施记录中单独评审。
- 无法完整恢复时置 `recoveryRequired=true`，阻断后续发布和手动索引，并使受影响资产的 Lucy 读取 / 查询按既有合同失败关闭。
- 启动时先处理未终结恢复日志以及 `promoting / reindexing` 记录，再开放发布；在快照、release 关联、rename、delete、镜像删除、日志更新、索引和终结记录边界不得猜成功。`reindexing` 按 §4.3 重跑索引确认或结清为可重试 `reindex_failed`，不得无限停留。
- reindex 失败保留已经恢复的文件，状态为 `reindex_failed` 和“生效状态待确认”；重试索引不重复恢复写盘，范围变化必须重新预检。
- `published` 只在正式文件、运行镜像（包括计划内 absent）、实际 KTX 扫描范围、索引和必要终结记录均满足既有合同后成立。HTTP accepted 只表示受理，不等于已生效。

## 6. API 与错误合同

以下为本功能拟新增或扩展的接口，当前不可用：

| 接口 | 合同 |
|---|---|
| `POST /api/semantic-assets/releases/:id/restore/preview` | 当前管理员会话；返回 previewId、sourceReleaseId、snapshotId、planDigest、expiresAt、恢复目标、冲突、完整索引范围、已知待同步变化、unknown 覆盖率、校验结果和 verdict；不写正式内容 |
| `POST /api/semantic-assets/releases/:id/restore` | body 仅含 previewId、planDigest、idempotencyKey；服务端重建并提交计划，返回新 releaseId 和真实受理 / 进行中状态 |
| `GET /api/semantic-assets/releases/:id/restore-package` | 重新鉴权并核验快照后流式导出 ZIP，内含 `semantic-release-snapshot/v1` manifest、全部原 bytes / absent 和 digest；不提供对应上传恢复接口 |
| `GET /api/semantic-assets/releases/:id/status` | 复用现有状态查询，扩展恢复批次的 `promoting`、文件保存、索引和生效状态，不新建另一套状态端点 |
| 发布历史列表 / 详情 | 扩展可恢复性、不可用原因、恢复来源关联和 `webui_restore` 类型 / 筛选；旧数据保持兼容 |

建议稳定原因码：

| 原因码 | HTTP | 含义 |
|---|---:|---|
| `semantic_snapshot_unavailable` | 409 | 快照未捕获、清理、缺失、损坏或不可读 |
| `semantic_release_not_restorable` | 409 | 来源状态或无内容写入不满足恢复条件 |
| `semantic_restore_conflict` | 409 | 当前 digest / absent 与所选批次发布后状态不一致 |
| `semantic_restore_plan_stale` | 409 | planDigest、目标或依赖基线已变化 |
| `semantic_restore_preview_expired` | 410 | 30 分钟预览已过期，需重新预检并使用新幂等键 |
| `semantic_restore_instance_mismatch` | 409 | 快照或预览不属于当前持久实例 |
| `semantic_restore_idempotency_conflict` | 409 | 同一幂等键绑定了不同计划 |
| `semantic_idempotency_capacity` | 409 | 500 条未过期记录已满，不能提前淘汰，拒绝新 intent |
| `semantic_recovery_required` | 409 | 既有或本次恢复故障尚未核验完成 |
| `semantic_publish_busy` | 409 | 共享发布临界区被占用 |

所有接口复用 WebUI 管理员会话、请求来源和 CSRF 防护；Agent MCP Token 不可调用。每次预览、提交、状态轮询和导出重新检查当前权限。错误响应不返回宿主绝对路径、凭据或越权对象的原始 YAML。

## 7. 发布历史交互

在现有发布历史页增加整批恢复入口，不改变 Catalog、单表编辑器和发布工作台既有分工：

1. 每条内容发布记录显示“可预检恢复 / 快照不可用 / 当前不可恢复”等状态及原因；纯手动 reindex 不显示恢复动作。
2. 有权限且来源合格时，从行操作打开“恢复发布批次”Drawer。首屏说明“恢复到本批次发布前”，并展示来源时间、操作者、目标数量和保留信息。
3. Drawer 分开展示“本次恢复目标”和“全局索引范围与既有待同步变更”；已知变化、unknown 覆盖率和共享 Manifest 影响表分别可见。冲突、校验失败和完整范围不可枚举使用明确阻断说明，unknown 不得渲染成空清单。
4. 确认区只有一个 primary“确认恢复”，提交绑定当前 planDigest；每次新预览生成新幂等键。冲突或过期时禁用并给出“重新预检”入口。
5. 提交后跳转到新恢复批次状态，不把 accepted / promoting 显示为已生效。新记录显示“恢复自 <releaseId>”和触发方式“整批恢复”，原记录保持原状态。
6. 触发方式筛选和 CSV 均独立区分 `webui_restore`，不得混入普通 `webui_publish`；旧记录兼容规则不变。
7. 提供“导出恢复包”只读动作；快照不可用时禁用并说明原因。该包用于审阅和受控留存，不提供页面导入入口。
8. 全部对象身份、releaseId、路径、digest、格式名和 URL 使用翻译防御；键盘焦点、加载、空态、错误和长列表沿用现有 Drawer 与数据网格规范。

## 8. 权限、审计与安全边界

- owner / operator 沿用现有语义发布权限，不新增角色或开放模式。撤权后的已有 previewId、下载 URL 和幂等键不能继续使用。
- 快照和恢复包可能包含未发布或已删除的业务语义，必须按受控管理资产保护；普通应用日志不记录原始 YAML。
- 审计包含 actor、operationId、sourceReleaseId、newReleaseId、sourceSnapshotId、newSnapshotId、planDigest、对象数量、分项结果及原因码，放在现有 `details` 等受控字段中，不放 YAML、凭据或宿主路径。

审计事件沿用 `SemanticBatchAuditOutcome` 映射，不把新动作硬塞进 `published`：

| 事件 | outcome / publishEffect | 持久化时点与失败处理 |
|---|---|---|
| 恢复预检完成 | `validated` / false | 只读预览完成后；失败不生成有效预览 |
| 恢复包导出 | `exported` / false | 导出前；失败不提供下载 |
| 提交受理 | `staged` / false | **首个正式写入前**；失败则 release=`promote_failed`、幂等=`failed`，零正式写入 |
| 冲突或校验阻断 | `blocked` / false | 返回阻断前；不得创建内容写入效果 |
| 写盘、删除、镜像、故障恢复或 reindex 失败 | `failed` / false | 保留实际文件、恢复和索引状态，activationStatus=`unconfirmed` |
| 恢复全部生效 | `published` / true | 仅正式文件、镜像、索引和必要终结记录均确认后；来源历史不变 |

终态审计与 release 终结必须按现有 fail-closed 合同形成可恢复终结流程；任一方失败时，最终可读取状态不得保持 `published / confirmed`，应置 `activationStatus=unconfirmed`、`recoveryRequired=true` 并进入启动对账。不得忽略审计失败或把 accepted 记成发布成功。

- 快照实例 ID 只用于防误恢复，不是机密或安全边界。digest 用于完整性核验，不冒充作者签名或不可抵赖证明。
- 恢复包只读导出为 ZIP，内含 `semantic-release-snapshot/v1` manifest、全部原 bytes / absent 和 digest；导出前自检完整性。最多 200 个 entry、metadata 1 MiB、解压内容 512 MiB、ZIP 544 MiB，使用 `restorePackageMaxEntries / restorePackageMaxMetadataBytes / restorePackageMaxUnpackedBytes / restorePackageMaxZipBytes` 独立键进入 `SEMANTIC_BATCH_LIMITS`，不得复用或改写维护包导入的 200 / 256 KiB / 16 MiB / 20 MiB 门禁。采用流式下载；超限或无法流式导出时明确失败，不返回截断包。快照本身不设 200 entry 上限，超限快照仍可恢复但不可导出，UI 显示独立原因 `semantic_restore_package_limit`。
- 不得允许修改包后上传绕过服务端快照、权限、CAS 和校验。本期提供服务端格式说明与完整性校验，不另建离线校验工具。

## 核心流程（伪代码）

以下为规范性顺序。helper 表示复用或扩展的共享服务，不是现有函数签名；关键分支映射 SRR-01–SRR-22。

```text
captureBatchSnapshotBeforeFormalWrites(actor, releaseId, completePlan):
  assertCallerAlreadyHoldsPublishCoordinator()  // 本函数不得再次取锁
  requireCurrentSemanticPublishPermission(actor)
  requireNoUnresolvedRecovery()
  requireVisiblePromotingReleaseExists(releaseId)
  targets = sortUnique(completePlan.actualWriteTargets)
  if targets.empty: return no_content_snapshot

  entries = []
  for target in targets:
    current = readBytesOrAbsentWithinResolvedContentRoot(target)
    entries.push({
      projectRelativePath: target.relPath,
      assetKind: target.kind,
      identity: target.identityOrUndefined,
      originalBytesOrAbsent: current,
      originalDigest: sha256OrNull(current),
      expectedNewDigest: sha256OrNull(target.newBytesOrAbsent)
    })  // null 只表示 absent；删除与反向恢复使用同一比较规则

  snapshot = buildSemanticReleaseSnapshotV1(
    releaseId, persistentInstanceUuid(), actor, entries
  )
  serialized = canonicalSerializeWithExactByteLength(snapshot)
  evictOldestUnpinnedSnapshotsForExactCapacity(serialized.byteLength,
                                                20, 30days, 512MiB)
  if cannotFitAfterEviction: blockBeforeSnapshotOrFormalWrites()
  atomicWriteSnapshotThenReadBackAndVerify(snapshot)
  persistReleaseSnapshotMetadataOrFail(releaseId, snapshot.id)
    // 必须确认记录存在且关联成功；任何失败均不进入正式 write / delete / mirror
  return snapshot

previewRestore(actor, sourceReleaseId):
  requireCurrentSemanticPublishPermission(actor)
  source = readRelease(sourceReleaseId)
  require source.status in {published, reindex_failed}
  require source.hasFormalContentWrites
  snapshot = readAndVerifySnapshot(source.snapshotId)
  require snapshot.instanceId == persistentInstanceUuid()
  require snapshot.availableAndWithinRetention

  changes = []
  conflicts = []
  for entry in snapshot.entries:
    current = readBytesOrAbsent(entry.targetPath)
    if sha256OrNull(current) != entry.expectedNewDigest:
      conflicts.push(entry.targetPath)  // 含外部改回批次前；不得当 no_change
    unchanged = entry.originalDigest == entry.expectedNewDigest
    changes.push(classifyRestoreDeleteOrUnchanged(entry, current, unchanged))

  fullIndexScope = enumeratePostRestoreProjectRootKtxSiblingScanSetOrBlock(
    currentKtxSiblingView, changes
  )  // 不是内容根集合；与实际 ktx admin reindex 读取面一致
  knownPending, unknownCoverage = discloseKnownPendingWithoutGuessing(
    fullIndexScope
  )
  plan = buildRestorePlan(snapshot, changes, fullIndexScope)
  checks = runSharedValidationAndContractGate(plan.postRestoreCandidate,
                                               fullIndexScope)
  preview = persistActorAndInstanceBoundPreview(
    plan, checks, conflicts, ttl=30min
  )
  acquireSnapshotLease(snapshot.id, kind=preview, expiresAt=preview.expiresAt)
  return previewWithSeparateTargetsFullScopeKnownAndUnknown(
    preview, knownPending, unknownCoverage
  )  // 预检不写正式文件、镜像或索引

submitRestore(actor, sourceReleaseId, previewId, planDigest, idempotencyKey):
  requireCurrentSemanticPublishPermission(actor)
  withRestoreCoordinatorLockHeldThroughAsyncReindex(kind=semantic_restore):
    requireNoUnresolvedRecovery()
    replay = findIdempotent(actor, persistentInstanceUuid(), idempotencyKey)
    if replay.exists and replay.planDigest != planDigest:
      conflict semantic_restore_idempotency_conflict
    if replay.state == applied:
      release = requireExistingReleaseAndSnapshotLinkage(replay.releaseId)
      return currentStatusWithoutRewriteOrReindex(release)
    if replay.state == intent:
      return reconcileExistingIntentByReleaseJournalAndActualBytes(replay)
      // promote_failed + 零写入已证明：先结清 failed，再允许同键同计划新 attempt
    if replay.state == failed and not replay.zeroFormalWritesProven:
      return recoveryRequiredWithoutAutomaticRetry(replay)

    preview = readPreview(previewId)
    require preview.actor == actor
    require preview.instanceId == persistentInstanceUuid()
    require now < preview.expiresAt
    require preview.sourceReleaseId == sourceReleaseId

    source, snapshot = rereadAndVerifySourceAndSnapshot(sourceReleaseId)
    rebuilt = rebuildRestorePlanAndProjectRootKtxSiblingScope(source, snapshot)
    require rebuilt.planDigest == planDigest == preview.planDigest
    require noDependencyDigestChanged(rebuilt, preview)

    for entry in snapshot.entries:
      currentDigest = sha256OrNull(readBytesOrAbsent(entry.targetPath))
      if currentDigest != entry.expectedNewDigest:
        blockEntireRestore semantic_restore_conflict
        // 零正式写入；不提供 force overwrite

    checks = rerunSharedValidationAndContractGate(rebuilt)
    if checks.hasBlockingOrIncompleteResult:
      persistBlockedNewReleaseWithoutFormalWrites()
      return blocked

    if every(entry.originalDigest == entry.expectedNewDigest for entry in snapshot.entries):
      return no_change_withoutReleaseIdempotencyOrReindex()
    changedTargets = rebuilt.entriesWhereOriginalDigest != expectedNewDigest
    requireKtxSiblingBaselinesMatchContentRootOrBlock(changedTargets)

    newReleaseId = persistPromotingReleaseOrFail(
      trigger=webui_restore,
      restoreOfReleaseId=sourceReleaseId,
      restoreSourceSnapshotId=snapshot.id,
      activationStatus=unconfirmed
    )
    persistIdempotentIntentOrFail(newReleaseId, planDigest, attemptId)

    try:
      captureBatchSnapshotBeforeFormalWrites(actor, newReleaseId, rebuilt)
      persistFailureRecoveryJournalAllowingExpectedAbsentOrFail(
        newReleaseId, changedTargetsAndTheirKtxSiblingTargets
      )  // 两面都记录原 bytes / absent 与 digest，支持受控镜像删除后的故障恢复
      persistRequiredAcceptedAuditOrFail(outcome=staged, publishEffect=false)
        // 以上任一失败：release=promote_failed、idempotency=failed、零正式写入
    catch prewriteFailure:
      markPromoteFailedAndIdempotentFailedOnlyIfZeroWritesProven()
      return failure

    try:
      for target in changedTargets:
        compareCurrentBaselineAgainOrStop(target)
        if target.postRestoreState == absent:
          atomicDeleteOnlyResolvedContentRootTarget(target)
          deleteOnlyExactPlannedKtxSiblingTargetAndVerifyAbsent(target)
          // 不修改通用 content-mirror 的 never-deletes，不目录清扫
        else:
          atomicReplaceFromVerifiedSnapshotBytes(target)
          upsertExactKtxSiblingTargetAndVerifyDigest(target)
        updateFailureRecoveryJournalForBothSurfaces(target)
      actualScope = enumerateActualProjectRootKtxSiblingScanSetOrBlock()
      require actualScope == rebuilt.fullIndexScope
      markIdempotencyAppliedOnlyAfterFormalWritesAndMirror(newReleaseId)
      persistExistingReleaseOrFail(newReleaseId, reindexing)
    catch writeDeleteMirrorOrRequiredRecordFailure:
      restoreContentRootAndKtxSiblingUsingJournalByActualBytes()
      if thirdPartyContentOrOutcomeUnknown:
        markRecoveryRequiredAndClosePublishManualIndexAndAffectedReads()
      persistPromoteFailedOrUnconfirmedWithoutReindex()
      return failure

    completeFailureRecoveryJournalButRetainLongTermSnapshot()
    result = runExistingIncrementalReindexOnce(rebuilt.fullIndexScope)
    if result.failed:
      persistFailedAuditAndRelease(reindex_failed, activationStatus=unconfirmed)
      return filesRestoredButActivationUnconfirmed(newReleaseId)

    verifyFormalAndMirrorDigestsAndRequiredTerminalRecords()
    finalizeTerminalAuditAndPublishedWithRecoverableOutcome(newReleaseId)
      // 任一终结步骤失败：不得保持 published/confirmed；标 unconfirmed + recoveryRequired
    return published(newReleaseId)

startupBeforeOpeningPublishOrManualReindex():
  recoverAllUnfinishedFailureJournalsByActualBytesIncludingExpectedAbsent()
  for release in readAllPromotingAndReindexingReleases():
    reconcileReleaseSnapshotIdempotencyJournalAndActualBytes(release)
    if release.status == promoting and zeroWritesProven: markPromoteFailed()
    else if allWritesAndMirrorProven:
      result = resumeFromReindexingWithoutRepeatingWrites()
      if result.unknownOrFailed: markReindexFailedAndUnconfirmedRetryable()
    else: markRecoveryRequiredAndBlock()
    require release not leftIndefinitelyInReindexing
  retainTerminalSnapshotsIndependentlyFromFailureJournals()
  removeOnlyExpiredSnapshotLeases()
  quarantineCorruptSnapshotsAndExposeSnapshotUnavailable()
  evictOrphanThenOtherInactiveSnapshotsByRetentionPolicy()
  neverReconstructPreFeatureHistoryFromDiffsOrSingleTableVersions()
```

## 10. 验证机制与验收矩阵

### 10.1 证据要求

未来实施按四层取证：快照 / CAS / 状态单元测试；临时内容根上的 API 集成与文件 hash 断言；真实打包 KTX 的合成语义集成；经单独授权的 linux/amd64 单副本客户形态验证。Mock 只用于故障注入，不能独自证明 KTX 索引、Agent 生效或客户交付。

每项记录候选产品版本、完整构建提交 / dirty 状态、镜像 ID、依赖版本、fixture hash、来源和新 releaseId、snapshotId、前后目标及未选文件 hash、实际结果和错误。`passed / failed / not_run / blocked_environment` 分开；只用合成或脱敏资产，不访问客户真实库。本次未执行任何功能验收。

| 编号 | 场景 / 必须断言 | 状态 |
|---|---|---|
| SRR-01 | S0 冻结清单中的单表保存、单表 YAML 导入／版本恢复落地、Manifest 上传、批量导入和恢复均按“写入口→真实写点”在首个正式写入前创建 promoting 记录与完整快照；覆盖原 bytes、absent、预期新 digest / absent、资产类型和表身份；快照或 snapshotId 关联失败零写入；各入口互斥且快照 helper 以本进程 holder 身份断言持锁，不在 with / acquire 两入口自锁或误 busy | 未执行 |
| SRR-02 | `published / reindex_failed` 且有内容写入才可预检；`blocked / promote_failed` 走失败恢复，`promoting / reindexing` 等待，纯手动 reindex 无恢复动作；`recoveryRequired / activationStatus` 与旧记录 unknown 正确归一化；恢复 trigger 可独立筛选且不混入普通发布 CSV | 未执行 |
| SRR-03 | 30 表发布成功后恢复到该批次发布前；只写本批内容根目标及一一对应的受控镜像目标，两面 digest / absent 一致，实际 KTX 扫描范围一致且索引成功后才显示已生效，Agent 经 Lucy Proxy 可检索恢复后的合成语义 | 未执行 |
| SRR-04 | 批次新建文件在内容根与 KTX 兄弟视图成对恢复为删除，批次删除文件在两面恢复原 bytes；expectedNewDigest=null 可用于 CAS 和反向恢复；通用 content-mirror 仍不全局删除，计划外文件不变；镜像未删或结果未知不得 published；路径越界或身份歧义阻断 | 未执行 |
| SRR-05 | 全部 originalDigest==expectedNewDigest 时 no_change，不创建空发布、幂等或索引；混合 unchanged 仅写差异目标且全目标仍做 CAS；外部改回 originalDigest!=expectedNewDigest 所描述内容必须冲突而非 no_change | 未执行 |
| SRR-06 | 来源批次后另一批次修改任一相同目标：恢复预检可见冲突，提交 409，整批零正式写入，不提供强制覆盖 | 未执行 |
| SRR-07 | 预检后单表保存、单表 YAML 导入、Manifest 上传、另一会话或 CLI / Git 修改目标 / 依赖，含 absent→存在：CAS / stale 阻断，旧预览和确认不可复用 | 未执行 |
| SRR-08 | 同目标连续 A、B 发布：先恢复 B 再恢复 A 成功；每次恢复生成新批次和可读 snapshotId，可反向恢复，来源历史和审计不被改写；单表保存同时改共享 Manifest 时实际写集与影响表披露一致 | 未执行 |
| SRR-09 | Drawer 分开列出恢复目标、实际 `projectRoot/semantic-layer/` 兄弟视图的完整索引扫描范围、已知待同步变化与 unknown 覆盖率；披露范围与镜像同步后的实际 reindex 扫描集合一致，无关文件 hash 不变，unknown 不显示为空清单或“无其他变更” | 未执行 |
| SRR-10 | 完整索引范围、依赖或校验范围无法取得时整批阻断；不得只显示来源批次文件或用内容根集合冒充实际 KTX 扫描集合后放行 | 未执行 |
| SRR-11 | 恢复后候选存在 YAML、模型、关联或合同门禁错误：正式文件、镜像和索引不变；合法性、完整度和执行证据不混淆 | 未执行 |
| SRR-12 | 预览 30 分钟到期、planDigest 不符、来源或实例改绑均拒绝；重新预检生成新 planDigest 和新幂等键，不能修改时间戳续期；preview lease 到期前防清理、到期后可释放 | 未执行 |
| SRR-13 | intent / applied / failed 三态下重复点击、HTTP 重试和断线重连不重复写盘 / 索引；intent 对应 promote_failed 且零写入可证明时先结清 failed 并允许同键同计划新 attempt；快照或 journal 失败后同键重试不得返回死 releaseId；applied 重放须核对真实 release；同键不同计划冲突；500 条上限不提前淘汰未过期记录，24 小时后可清理 | 未执行 |
| SRR-14 | 未登录、失效会话、Agent Token、CSRF / 来源不符、其他操作者预览 ID，以及预览后撤权：预览、提交、轮询和导出均拒绝且不泄露内容 | 未执行 |
| SRR-15 | 第 N 次内容根／镜像写入、删除或必要记录失败：按实际字节逆序恢复两面；恢复删除目标后再失败能写回原 bytes，不误报第三方冲突；第三方内容不覆盖，恢复不完整触发失败关闭 | 未执行 |
| SRR-16 | 在 promoting、intent、快照、snapshotId 关联、journal、rename、delete、镜像删除、index 和终结记录各边界 kill 并重启：记录可见、关联可读，不猜 published，不误删历史快照；已写可从索引阶段继续，未知状态先阻断；index／终结边界后重跑确认或结清为可重试 reindex_failed，不无限停留 reindexing | 未执行 |
| SRR-17 | 恢复写盘成功但 reindex 失败：保留文件并显示 `reindex_failed / activationStatus=unconfirmed`；重试不重复写盘，范围变化重新预检，原失败 attempt 保留 | 未执行 |
| SRR-18 | 预览 / 导出 / 受理 / 阻断 / 失败 / 终态按 validated / exported / staged / blocked / failed / published 映射；受理审计失败零写入，终态审计失败不留 published / confirmed；来源 / 新批次、双方快照和 planDigest 关联完整，日志无 YAML / 凭据 | 未执行 |
| SRR-19 | 最多 20 个记录仍存在的可恢复批次、30 天、512 MiB 及各边界 +1：按精确序列化字节先腾位再落盘；orphan 不占 20 个名额但计年龄／容量并优先清理；publish / restore / preview / export lease 与清理并发不丢活跃快照；失败批次不占可恢复计数；容量不足不落新快照且零正式写入 | 未执行 |
| SRR-20 | 上线前旧记录缺字段显示 unknown / 快照不可用；缺失 / 损坏 / 过期 / 其他实例均拒绝；持久实例 UUID 不得回退共享默认值，不从 Diff、单表版本或旧 journal 重建 | 未执行 |
| SRR-21 | ZIP 恢复包的 v1 manifest、entry、bytes / absent 和 digest 完整，篡改可检出；restorePackage* 独立限额的 200 entry、1 MiB metadata、512 MiB 解压内容、544 MiB ZIP 边界及 +1 不截断，维护包限值不变；超过 200 entry 的快照可恢复但导出明确失败；流式下载重新鉴权，无上传入口，staging / Agent 检索不读取快照 | 未执行 |
| SRR-22 | 候选 linux/amd64 单副本 Helm 环境完成 30 表发布→恢复→链式恢复、中断重试和索引验证；区分本机 Compose 证据与客户验收，未满足环境时记 blocked_delivery | 未执行 |

### 10.2 完成判定

SRR-01–SRR-21 是功能实现的必要验收，SRR-22 是客户交付证据维度；环境未解锁时不得以本机结果替代，也不得宣称客户交付通过。恢复冲突零写入、故障不虚报成功、历史不可改写和快照不可伪造为 P0 必达项。本 Spec 不新增当前 v2.0 发布门禁，后续实施与客户发布分别沿用当时已批准的门禁。

## 11. 实施依赖、风险与评审重点

实施顺序和文件落点见独立 Plan。关键依赖为 L25-11 的共享发布协调器、统一校验、CAS、幂等、恢复日志、发布记录和审计；若实施时这些合同与当前代码有偏差，应先记录并评审，不得在本功能中静默改变其语义。

重点风险：

1. **快照覆盖不全**：只在批量导入接线会留下单表或 Manifest 盲区，S1 必须做写入口清单和覆盖测试。
2. **把故障日志当历史**：日志清理或状态变化不能决定长期快照可用性。
3. **恢复覆盖后续工作**：必须按来源批次发布后 digest 做全目标 CAS，不只检查计划中的差异项。
4. **全局索引副作用被隐藏**：完整范围不可知时必须阻断，预检须与提交使用同一范围合同。
5. **存储无限增长或清理竞态**：固定三上限，活跃引用和容量不足必须可验证。
6. **状态虚报**：文件恢复、索引成功和 Agent 生效分别记录，恢复包导出和预览不构成发布效果。

需求审查须确认本 Spec 的产品语义、保留参数、API、权限和 SRR 矩阵。审查通过仍不等于开发授权；实施前需单独批准 Plan 的阶段和验证范围。

### 11.1 Claude Code 审查发现与处置（2026-10-27）

Forrest 要求调用 Claude Code 审查后，已使用 Claude Code 2.1.305 以仅 Read / Grep / Glob 的只读权限核对本 Spec、Plan、L25-11 和当前实现。审查结论为“需要修订”；未允许其修改文件或执行测试。v0.2 对发现作如下处置：

| 审查发现 | 处置 |
|---|---|
| P0-1 absent 删除在快照和故障 journal 中不闭合 | 采纳。`expectedNewDigest / newContent` 允许 null，恢复删除后失败可按原 bytes 恢复；补 SRR-04／15。这是对 L25-11 §7.2 第 4 条的显式类型扩展，实施时单独评审，不静默改语义 |
| P0-2 release 与 snapshotId 关联顺序不安全 | 采纳并扩展到全部本功能内容写入口。写前建立 `promoting`，关联失败零写入，启动对账覆盖未终结记录；补 SRR-01／16 |
| P0-3 幂等重放死 releaseId | 采纳。定义 intent / applied / failed、真实 release 回读、零写入失败重试和 500 条容量边界；补 SRR-13 |
| P1-1 待同步变更缺少持久索引账本 | 采纳其证据，不新增账本。改为可枚举完整扫描范围 + 已知变化 + unknown 覆盖率，禁止猜测完整逐文件差分；补 SRR-09 |
| P1-2 审计 outcome 与持久化时点 | 采纳。给出六值 outcome 映射，受理审计前置，终态失败不得 published / confirmed；补 SRR-18 |
| P1-3 release 缺恢复与生效字段 | 采纳。补 snapshotId、双方快照关联、recoveryRequired、activationStatus 与旧记录 unknown；不可用原因放投影，不回写历史 |
| P1-4 协调器嵌套取锁 | 采纳。快照 helper 只断言调用方持锁；恢复使用与批量发布相同的获取 / 释放原语并覆盖后台 reindex；补 SRR-01 |
| P1-5 webui_restore 被归一化折叠 | 采纳。服务端筛选、前端 coerceTrigger 与 CSV 全链路保留新 trigger；补 SRR-02 |
| P1-6 Plan 缺真实写点和共享模块 | 采纳。Plan 补 semantic-layer.ts、catalog-assets.ts、semantic-recovery-journal.ts、semantic-limits.ts 等明确落点 |
| P2-1 保留 lease 与容量顺序 | 采纳。持久 lease、串行清理、精确序列化字节、先腾位再落盘，20 个只计可恢复批次；补 SRR-19 |
| P2-2 默认实例 ID 不区分实例 | 采纳。使用持久 UUID，禁止共享默认 ID；明确不是安全边界；补 SRR-20 |
| P2-3 限值漂移、500 条与 24 小时冲突、包无上限 | 采纳。统一 SEMANTIC_BATCH_LIMITS；未过期幂等不提前淘汰；补恢复包四项上限与流式导出；补 SRR-13／21 |
| P2-4 组件目录不一致 | 采纳。Drawer 落到 `components/semantic-assets/` |
| P2-5 no_change 与全目标 CAS 顺序矛盾 | 采纳。unchanged 仅指 originalDigest==expectedNewDigest；外部改回仍冲突；补混合场景 SRR-05 |
| P2-6 过期预览与幂等键冲突 | 采纳。每次重新预检必须使用新幂等键；applied 重放不受旧预览 TTL 限制；补 SRR-12／13 |

审查提出的四个开放问题同步裁决：单表批次按全部实际写盘目标界定并披露共享 Manifest 影响表；索引披露采用 unknown 兜底而非新建账本；`reindex_failed` 可按磁盘 CAS 直接恢复，不强制先修旧索引；恢复包本期提供服务端格式说明和完整性校验，不新增离线工具。

`promoting` 是本功能对内容写入批次新增的记录状态，用于消除写前不可见窗口，不改变既有 `published / reindex_failed` 的终态含义，也不改变 L25-11 验收状态。除本小节明确登记的 absent journal 扩展与记录状态扩展外，不借本功能修改 L25-11 的其他遗留项。

### 11.2 Claude Code 第二轮复核与处置（2026-10-27）

v0.2 完成后，再次以相同只读权限复核，结论为“需要修订”：新增 1 项 P0、2 项 P1、4 项 P2。经核对 `content-mirror.ts`、`ktx.ts`、`semantic-layer.ts`、发布侧车与共享限值源码，v0.3 作如下处置；本轮仍未修改代码或运行功能测试。

| 第二轮发现 | 处置 |
|---|---|
| P0-1 通用镜像永不删除，恢复 absent 会在 KTX 视图留下旧语义 | 采纳。恢复计划专用受控删除只处理同一相对路径，双面 CAS、journal 和回读核验齐全；不改变通用 never-deletes。完整索引范围改为实际 `projectRoot/semantic-layer/` 兄弟视图，镜像删除或范围不明不得 published；补 SRR-03／04／09／15 |
| P1-1 漏掉单表 YAML 导入正式写入口 | 采纳。`writeSourceYamlImport` 及单表版本恢复落地纳入 S0 冻结清单、共享协调器、promoting、快照和 journal；补 SRR-01／07 |
| P1-2 启动对账漏掉 reindexing | 采纳。启动覆盖 promoting / reindexing；索引阶段可重跑确认，否则结清为可重试 reindex_failed / unconfirmed，不无限停留；补 SRR-16 |
| P2-1 持锁断言依据不完整 | 采纳。以本进程 holder 身份判定，兼容 with / acquire 两种入口，不只看 ALS 或锁文件 |
| P2-2 intent 与 promote_failed 组合可能占用幂等键 | 采纳。零写入可证明时先结清 failed，再允许同键同计划新 attempt；未知状态禁止自动重试；补 SRR-13 |
| P2-3 发布记录淘汰产生孤儿快照 | 采纳。orphan 不可恢复、不占 20 个记录仍存在的可恢复名额，但计年龄／容量并优先清理；补 SRR-19 |
| P2-4 恢复包形态与维护包限值可能混用 | 采纳。明确 ZIP + v1 manifest，使用 restorePackage* 独立键；快照本身不限 200 entry，超限可恢复不可导出；补 SRR-21 |

## Terminology Compliance

This feature follows [webui/docs/00-product-terminology-standard.md](../../webui/docs/00-product-terminology-standard.md).

本草案登记新增术语；实施 UI 文案前同步登记到全局术语标准：

| 概念 | UI 主术语 | 禁止文案 / 边界 |
|---|---|---|
| Pre-release batch snapshot | 批次前快照 | 不称 recovery journal、完整备份或全库时间点；格式为 `semantic-release-snapshot/v1` |
| Restore to before this release | 恢复到本批次发布前 | 不简写成“撤销全部后续修改”；不删除或改写历史发布记录 |
| Batch restore preview | 恢复预检 | 不把预览、导出或 HTTP accepted 称为“恢复成功” |
| Snapshot unavailable | 快照不可用 | 不把旧记录、已清理或损坏快照显示为“可恢复” |
| Restore failure recovery | 故障恢复 | 不与用户主动发起的“整批恢复”混称；前者处理写入故障，后者产生新发布批次 |
| Single-table draft restore | 恢复此版本 | 保留单表未保存草稿含义，不改称“整批恢复” |

Schema、Manifest、semantic overlay、连接、发布、索引和完整表身份沿用现有标准。专业英文术语、对象身份、文件名、路径、releaseId、digest 和 URL 的 DOM 节点必须带 `translate="no"` 与 `notranslate`。

## Design System Compliance

遵循 [按钮规范](../../webui/docs/design-system/10-components-button.md) §2–4：行级只读动作与危险确认分层，确认区仅一个 primary，禁用原因可读；[数据网格规范](../../webui/docs/design-system/11-components-data-grid.md)：完整对象身份、长列表、键盘与焦点；[页面布局模式](../../webui/docs/design-system/20-patterns-page-layout.md)：复用发布历史和 Drawer，不新增第二套发布导航。若恢复目标与全局待同步变更的双区展示超出现有模式，实施时先按治理规范补充临时决策，再落 UI。本文档阶段不执行浏览器或移动窄屏测试。
