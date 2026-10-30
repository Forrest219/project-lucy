# Lucy v0.25 语义发布历史版本与整批恢复 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / v0.11-implementation-ready |
| 日期 / 目标版本 | 2026-10-27 / v0.25（v0.5／v0.6 修订于 2026-10-28） |
| v0.11 修订 | 2026-10-30 第 4 轮复核（[复核记录](../reviews/2026-10-30-l25-15-implementation-ready-review.md)）：① 锁生命周期的现行事实改为提交 `3b7e8d32` 之后的源码——批量发布与手动 reindex 的锁已盖住终态核验、终态审计、`published` 与 journal 终结；v0.10 所写「偏差仍在、且为唯一保障」改为历史陈述。快照接在同一临界区内，释放点不得提前。② 按当日源码冻结写入口清单，补入删除语义文件的 `removeSchema`／`removeConnection`，并写明 `writeSourceYamlImport` 与 `applyConnectionIdChange` 当前在发布窗口之外。③ 状态行与 Plan S2 启动对账收窄一并改正。产品语义不变。**设计定稿，S1–S6 可交付开发**；SRR-01–SRR-24 仍未执行。见 §2.2、§5.2.1、§11.8 |
| v0.10 修订 | 根据 2026-10-29 PM 后续决定（登记册提交 `4395f55c`）：PM 决定**暂不设 L25-11 owner 会话**，**G30／G31 与 §5.2.1 的外部工作项一并挂起**——工作项**编号仍为待定且无 owner、无法推进**，恢复条件为 PM 重新指派 L25-11 owner（或授权复审）。据此把依赖状态写准：① 开工**不受影响**（开工前置已于 v0.9 解除，外部工作项从来不在开工前置里等待）；② 交付**不得以该修复落地为前提**，挂起期间它不提供任何保障；③ 因外部修复在可预见期内不会落地，恢复锁持有到终态、基线复核与重叠拒绝三条**成为本功能在此问题上的唯一保障，必须自足**，不得视为临时替代；④ 与 L25-11 维护方协调验收矩阵与回归范围因无 owner 而**无法在本功能内推进**，只作已知依赖登记。规范流程（§10.1 SRR-23）与处置记录（§11.7）同步；见 §5.2.1 与 §11.7。**v0.11 起，本行对「偏差仍在」的陈述以 §5.2.1 的现行源码为准** |
| v0.9 修订 | 根据 2026-10-29 PM 裁定（`docs/reviews/2026-10-29-l25-16-pm-decision-sheet-d7-d8-g34.md`，提交 `fc72a7b9`）更新锁生命周期偏差处置：S0 取 (a) 单独立项修既有路径，**开工前置解除**；但修复动作不在本功能内，登记为**外部工作项依赖（编号待定）**，S1–S7 不得触及 `semantic-assets.ts` 锁生命周期且不得默认其已完成；恢复路径自身仍须持锁到终态，并另以基线复核与重叠拒绝显式阻断交错窗口；见 §5.2.1 与 §11.7 |
| v0.8 修订 | 根据 2026-10-28 最终复审（2 阻塞/4 高/1 中/1 低）修订：§8.1 收敛为唯一四步顺序并明确 pending 的唯一设置点与清除点、启动对账改为六类互斥分类且补写类优先于索引续跑类、索引模式与读回统一消费语义删除集合（含 Manifest 原地回写删表；overlay 删除不构成表消失但仍需扩展不可见读回）、写前失败结算与受控镜像路径补入 SRR 子断言、Plan 状态行同步；见 §11.6 |
| v0.7 修订 | 根据 2026-10-28 复审（2 阻塞/4 高/1 中/1 低）修订：§8.1 终态审计协议收敛为唯一一套顺序并明确 pending 唯一设置点与三个崩溃窗口、索引模式与读回改由「语义删除集合」推导（覆盖 Manifest 原地回写删表）、锁外 intent 分为只读返回与转入锁内结算、写前失败按已持久化对象分别结算、新增「release 已成功但 journal 未终结」启动结算分支、镜像同步内部 prepare 与启动恢复同步纳入受控路径、索引重试镜像写入边界澄清与独立确认对象子断言、补 SRR-04／16／17 子断言；见 §11.5 |
| v0.6 修订 | 根据 2026-10-28 终审（4 条已闭合、6 条部分闭合、3 条新发现）修订：镜像侧允许变化集合改为「恢复镜像目标 ∪ 镜像同步写集」并集、漂移核对前置于全量 upsert 且只复制已核验集合、终态审计协议统一为单一权威顺序并明确 pending 唯一设置点、files-saved 标记前移至 applied/reindexing 之前并纳入失败处理、锁内完整重做三态判定、索引重试补范围确认对象与镜像副作用处置、删除方向读回按 overlay/Manifest 双层合并模型分类、SRR-16／18 补子断言并修正编号误指；见 §11.4 |
| v0.5 修订 | 根据 2026-10-28 独立审阅（Codex 只读对抗式审阅 + 逐条回查源码核实，报告见 [审阅报告](../reviews/2026-10-28-codex-review-l25-15-semantic-release-restore.md)）修订 R01–R10：纠正恢复日志终结时机、区分恢复写集与全量同步写集、统一含删除场景的索引重建模式、定义终态审计可恢复协议、接通恢复批次索引重试链路、消除幂等与发布记录保留冲突、幂等查询前移至取锁之前、登记发布路径锁释放偏差、补目录重命名与遗留布局落点、补 v0.4 处置记录；见 §11.3 |
| v0.4 修订 | 根据 Claude Code 最终聚焦复核补删除后的强制索引重建与读回、reindex 前全量 upsert 范围、可恢复终态审计协议，并明确校验作用域、目录级重命名、差异快照和遗留布局；见 §11.3 |
| v0.3 修订 | 根据 Claude Code 第二轮只读复核补受控镜像删除与实际 KTX 扫描范围、单表 YAML 导入写入口、reindexing 启动结算及四项一致性边界；发现与处置见 §11.2 |
| v0.2 修订 | 根据 Claude Code 只读审查收口 absent 删除、release／快照／幂等持久化顺序、索引范围披露、审计前置、记录字段、协调器重入、trigger 归一化、真实写入口与保留竞态；审查发现及处置见 §11.1 |
| 功能编号 / 优先级 | L25-15 / P0，语义批量修改的可逆性与运维安全能力 |
| 状态 | 2026-10-30 第 4 轮复核通过，修订至 v0.11，设计定稿。S1–S6 可交付开发。本修订不改运行代码。SRR-01–SRR-24 全部未执行。S7、浏览器验证、镜像构建与客户交付仍须单独授权 |
| 授权来源 | 2026-10-27 Forrest 要求将批量修改后的历史版本恢复落盘为新功能并完成 Spec、Plan |
| 规划入口 | [Lucy v0.25 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) §2.9 |
| 关联设计 | [L25-11 语义资产批量维护](lucy-20261020-v2p5-semantic-batch-operations-spec.md)，共享发布协调器、校验、CAS、失败恢复与审计，不替代其合同 |
| 实施计划 | [L25-15 实施 Plan](../plans/2026-10-27-lucy-v0.25-semantic-release-restore-implementation-plan.md) |
| 实施主体 | Lucy；复用 KTX 既有公开接口，不修改 KTX 源码 |

本文件定义拟实现行为，不代表当前平台已经支持。v0.11 关闭 S1–S6 的设计门禁，实施按 [Plan](../plans/2026-10-27-lucy-v0.25-semantic-release-restore-implementation-plan.md) 分阶段进行。本修订不改运行代码。SRR-01–SRR-24 全部未执行。S7、浏览器验证、镜像构建、部署与客户交付仍须单独授权。

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
| 发布生效 | 全部目标写完后把恢复日志推进到「文件已保存、索引／终结结果待确认」阶段，**不关闭日志**；再记录 `reindexing` 并异步 reindex。只有索引、最终 digest、终态审计与 release 状态均可核对后才终结日志，终态为 `published` 或 `reindex_failed` | 可复用状态机和索引路径；恢复也必须如实区分文件保存与 Agent 生效；恢复日志的终结时机不得早于现有 L25-11 §7.2 合同 |
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

对于当前尚无发布记录的正式内容写入口，实施时必须先在共享协调器内建立一致的 releaseId、快照和终态记录，再开放对应恢复能力；不得只覆盖批量导入路径。

**写入口清单（v0.11 按 2026-10-30 源码冻结）**。SRR-01 按本表逐项验收。实施中再发现正式内容写点时，先补本表和设计评审，再改代码。

| 写入口 | 2026-10-30 真实写点 | 快照义务 |
|---|---|---|
| 单表保存 | `semantic-layer.ts` `writeSourcePatch`，在 `withPublishCoordinator("semantic_table_save")` 内 `auditedWriteFile` | 锁内、首个正式写入前建立 promoting、快照和 journal。overlay 与共享 Manifest 全部入批 |
| 单表 YAML 导入／单表版本恢复落地 | `writeSourceYamlImport`。当前只有 `withKtxYamlWriteLock` → `withDisplayWriteBarrier`，**不持发布锁**。路由为 `POST /api/sources/:conn/:schema/:table/import` 且 `dryRun=false` | S1 先进入 `semantic_table_save` 或独立内容写入 kind，再在 `preview.files` 的首个 `auditedWriteFile` 前建立 promoting、快照和 journal |
| Manifest 上传 | `catalog-assets.ts` `uploadCatalogAsset` → `withPublishCoordinator("manifest_upload")` → `writeCatalogAssetIntoWindow` | 锁内、正式 `rename` 之前 |
| 批量导入发布 | `semantic-assets.ts` `publishSemanticAssets`，`acquirePublishLock` kind 为 `batch_import` | 现有 recovery journal 与 promote 之前。释放点保持在 §5.2.1 所述终态之后 |
| Schema 删除且删除语义文件 | `project.ts` `removeSchema`，当 `deleteManifest` 或 `deleteOverlays` 为真：外层 `withPublishCoordinator("manifest_upload")`，内部 `safeRemove` | 对实际将删除的 Manifest／overlay 在 `safeRemove` 前建快照，预期新 digest 为 absent。内存中的 `deletedFilePreImages` 只服务本次回滚，不代替长期快照。不删语义文件的 Schema 删除不入本清单 |
| 连接删除且删除语义文件 | `project.ts` `removeConnection`，当 `deleteAssets` 为真：同一 `manifest_upload` 窗口内删除 `semantic-layer/<conn>/` 下的 YAML | 只对实际删除的语义 YAML 建快照，预期新 digest 为 absent。密钥文件不进语义快照。不删语义文件的连接删除不入本清单 |
| 整批恢复 | 新模块 `semantic-release-restore.ts`，kind `semantic_restore` | 恢复写盘前建立本次恢复自己的 promoting、快照和 journal |
| 连接 ID 变更 | `project.ts` `applyConnectionIdChange` 调用 `renameSemanticLayerDir`。当前无 HTTP 路由，也不持发布锁 | **不生成可恢复快照，不是恢复来源**。S1 在该函数内纳入发布互斥：发布或恢复持锁时拒绝变更，并给出可读原因。变更前后重核路径集合。互斥做在函数上，使以后的调用方继承同一合同 |
| 纯手动 reindex | `POST /api/semantic-assets/reindex`，`withPublishCoordinator("manual_reindex")`，历史记录写在回调内 | 无内容写入，不生成内容快照，不提供恢复按钮 |
| L25-16 W-A | 控制面拒绝 `deleteManifest`／`deleteOverlays`，不写语义 YAML | 不要求内容快照。日后 W-B 若调用 `publishSemanticAssets`，快照走批量导入发布这一行，不另开写点 |

**连接 ID 目录重命名**：属于目录级语义变更，本期**不生成可恢复快照、不作为恢复来源**。但它与恢复共享同一内容根与路径命名空间，因此必须受控：

- 目录 rename **必须纳入共享发布互斥**：rename 与任何语义内容发布／整批恢复必须互斥，不得在同一临界区内外交叠；
- 若不采用同一把锁，则恢复期间必须**显式阻断** rename（恢复持有恢复阻断标记时拒绝 rename，并给出可读原因）；
- rename 受路径 CAS 与范围复核约束：rename 前后目标路径集合必须重新复核，不得让旧路径的恢复计划在 rename 后继续生效；
- 连接 ID 变更期间不得产生恢复写集。它留在上面的冻结清单里，义务是互斥，不是快照。落点函数是 `applyConnectionIdChange`。

**遗留布局 `LUCY_CONTENT_ROOT=.`**：此时内容根与兄弟视图是同一路径，两面退化为单面。实现必须：双面 CAS 退化为单面比较但**不得**放宽 CAS 强度；journal 不得重复登记同一路径；受控镜像写入／删除**不得**重复执行；回读只做一次且结论一致。两种布局都必须有专项测试证明「不重复登记、不重复执行、结论一致」。

### 2.3 索引、写入范围与无关变更

本功能涉及两类互不相同、后果不同的写入，必须在规范、预检披露和验收断言中始终分开，不得合并为一句「同步镜像」：

- **恢复写集（restore write set）**：所选批次快照中的内容根目标，以及其**一一对应**的受控 KTX 镜像目标。这是用户确认的对象，也是全目标 CAS、故障恢复 journal 与失败回滚的唯一主对象。恢复只写恢复写集内的文件，不扩写其他 overlay、不清扫目录、不删除计划外文件。
- **镜像同步写集（mirror sync write set）**：内容根与兄弟视图之间**已存在的漂移**——内容根有该文件、兄弟视图缺失或内容不同。通用镜像同步是「只 upsert、永不删除」的全目录同步（`semantic-layer`／`wiki`／`evals`／`skills`），因此任何一次 `reindex` 都会先执行全量 upsert，把这批漂移文件复制到兄弟视图。这些文件**不是**恢复写入的目标，却会被本次 reindex 一并镜像。

两者的关系是：恢复写集由本功能负责，镜像同步写集是既有平台行为的副作用。恢复不得制造新的镜像同步写集，也不得声称它没有发生；预检必须逐文件披露镜像同步写集，提交时必须证明实际漂移与预检披露一致。

**「不修改无关文件」的精确含义**（P0 承诺，不得含糊表述）：

- **内容根侧**：恢复写集之外的文件内容与 hash 完全不变，可断言、可取证。
- **镜像侧**：允许发生变化的镜像文件恰为**两个集合的并集**——`恢复写集的受控镜像目标`（本次恢复按设计要写入或删除的镜像）∪ `已确认的镜像同步写集`（预检披露并经提交前核对的既有漂移）。除此之外的镜像文件 hash 不变。
  - 恢复镜像目标的变化方向是「镜像跟随内容根的恢复结果」，属于本次恢复的效果；
  - 镜像同步写集的变化方向是「兄弟视图向内容根对齐」，属于既有漂移的收敛；
  - 两类变化必须可区分：预检分区展示、提交后分别核对，不得合并成一句笼统的「同步镜像」。

当前 KTX 实际读取的是 `projectRoot/semantic-layer/` 兄弟视图，不是内容根；通用内容镜像又是「只 upsert、永不删除」，因此恢复删除必须按 §5.2 做计划内受控镜像删除，不能指望普通镜像同步撤销 Agent 侧旧语义。遗留布局 `LUCY_CONTENT_ROOT=.` 下两面是同一路径，双面 CAS、journal 和回读退化为单面，受控镜像写入／删除不得重复执行。

本功能区分两个可验证概念：

- **完整索引范围**：恢复计划完成受控写入／删除，并执行与 `prepareSemanticLayerForKtx` 相同口径的**全量内容根→兄弟视图 upsert 后**，实际由 `ktx admin reindex` 扫描的 `projectRoot/semantic-layer/` 全量适用文件集合。预检按「当前兄弟视图 ∪ 内容根现存文件 + 恢复计划」推导候选集合；提交在恢复写集写盘与镜像操作之后，**显式执行同一全量 upsert**，再枚举实际集合并比对。该集合必须可枚举、可核对；无法取得或与计划不一致时整批阻断。
- **既有待同步变更**：完整索引范围中当前内容与上次成功索引内容不同的文件。内容根存在但尚未镜像的文件单列为一类已知待同步变化；其他当前平台没有持久索引 digest 账本而无法可靠判定的差分标为 `unknown`。不得宣称能完整逐文件判定，不以新建索引账本作为前置，也不以空列表冒充「无其他变更」。

恢复预检必须分区展示：

- **本次恢复目标**：将恢复、删除或保持不变的快照目标，以及逐文件前后 digest / absent；
- **全局索引范围与既有待同步变更**：全量 upsert 后实际 KTX 兄弟视图的完整扫描范围、已知变化和 `unknown` 覆盖率。UI 必须说明「无法逐文件确认的内容也可能被本次索引纳入」，不得宣称「只有这些文件会生效」；
- **镜像同步写集**：将被全量 upsert 复制到兄弟视图的漂移文件清单，逐文件给出内容根路径、兄弟视图路径与两侧当前 digest / absent，并标注这些文件不由本次恢复写入、其变化方向是「镜像向内容根对齐」。

提交时使用同一完整范围定义重新枚举并校验。范围无法取得或校验时整批阻断；不得把恢复包装成局部生效。空 diff 不创建空恢复批次，也不借空恢复同步其他待处理变更。

**镜像同步写集不进入恢复故障 journal**：其内容变化方向是「镜像向内容根对齐」，回滚它会把兄弟视图退回过期状态而非修复损坏。journal 只登记恢复写集（含其受控镜像对应目标）的原 bytes / absent 与 digest；镜像同步写集在预检中披露、在提交时核对一致性即可。

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

**发布记录保留与幂等重放的依赖**：幂等记录至少保留 24 小时，且 `applied` 重放必须回读真实 release（§5.3）。发布侧车的「最近 100 条」截断若不加保护，会在 24 小时内淘汰仍被有效幂等记录引用的 release，使合法重放落入「release 不存在」的异常路径。因此：

- 侧车在执行「最近 100 条」截断时，**必须保留**被未过期幂等记录引用的 release 记录；这些记录可超出 100 条上限继续保留，不受列表截断影响；
- 该保护随幂等记录过期而解除：幂等记录过期后，其引用的 release 才重新可被截断淘汰；
- 列表展示仍只呈现最近 100 条，被保护但超出的记录仅通过 releaseId 直查与状态查询可达，不出现在历史列表中；
- 保护状态必须可核对，不得出现「幂等记录仍有效但其 release 已被截断淘汰」的状态。

该规则只调整发布记录的**淘汰顺序**，不改变发布历史列表的展示条数，也不取消 100 条上限对普通历史的作用。

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
- `terminalAuditPending`：终态审计**是否尚未被核对**（唯一设置点与清除点见 §8.1）。为 true 时，公开状态投影必须保持“生效待确认”，即使内部记录已写 `published / confirmed`。

`snapshotUnavailableReason` 是快照可用性投影 / 清理元数据，不回写来源发布记录。旧记录缺少 `recoveryRequired / activationStatus / snapshotId` 时显示 `unknown` 或快照不可用，不从 `published` 反推 confirmed 或存在快照。

本功能覆盖的内容写入批次必须在首个正式写入前持久化一条可见记录，状态为 `promoting`、`activationStatus=unconfirmed`。该状态表示已建立写前意图但写入与索引尚未终结，不表示正在 reindex；纯手动 reindex 不使用该状态。规范顺序为：

1. 创建 `promoting` 记录和幂等 `intent`；
2. 创建快照并成功把 `snapshotId` 写入该记录，再创建故障恢复日志；
3. 持久化受理审计后才允许正式写入；
4. 写入与镜像完成后转 `reindexing`，最终按真实结果转 `published / reindex_failed`；失败转 `promote_failed` 并保留快照关联和恢复状态。成功终态必须另按 §8.1 的 `terminalAuditPending` 可恢复协议终结。

步骤 1–3 任一失败都必须在零正式写入时结清为明确失败；不得静默忽略 release 更新返回的“记录不存在”。启动恢复除处理未终结 journal 外，还必须按 §8.1 的**互斥分类**核对全部待结算记录（`promoting`、`reindexing`、`terminalAuditPending=true`、终态审计已落库但 release 未到 published、release 已 published 但关联 journal 未终结、以及 `recoveryRequired=true` 的失败记录），并核对幂等状态、快照关联、journal、终态审计和实际 bytes。**同一 release 不得被两条路径重复处理；成功证据补写类必须先于索引续跑类**：`promoting` 未写入可明确结清，已全部写入可从 `reindexing` 继续，无法证明时置 `recoveryRequired=true` 并阻断。`reindexing` 在 journal 已推进到「文件已保存、索引／终结结果待确认」阶段（**不是**已终结）且内容根／镜像 digest 一致时，可从既有索引阶段重跑一次以确认终态；若不能安全重跑或索引结果仍未知，结清为可重试的 `reindex_failed / activationStatus=unconfirmed`，不得无限停留 `reindexing`，更不得猜 `published / confirmed`。journal 仍停在 `write_in_progress` 阶段时，说明写入是否落地**尚不可判定**，必须先按实际字节判定并回滚或结清，不得当作「文件已保存」直接续跑索引。`terminalAuditPending=true` 的记录按 §8.1 的启动对账规则结算，不得因内部 `published` 跳过对账，也不得无限停留在 pending。

历史恢复不修改来源批次状态；可恢复性由快照和当前状态计算，不在来源记录上写“已恢复”来抹除历史。`webui_restore` 必须在服务端 release 类型、列表筛选归一化、前端 `coerceTrigger` 和 CSV 标签中全程保留；旧记录缺 trigger 仍按既有规则归为 `webui_publish`。

## 5. 恢复预检、提交与失败处理

### 5.1 预检

预检在只读阶段重建并持久化恢复计划，固定有效期 **30 分钟**，绑定实例、操作者、来源 releaseId、snapshotId 和当前基线，并登记防止快照被清理的 preview lease。计划至少包含：

- 来源批次、快照、创建时间、原操作者和原触发类型；
- 每个目标的完整身份、相对路径、原状态、当前状态、恢复后状态及 digest / absent；共享 Manifest 的全部影响表单独列出；
- `restore / delete / unchanged` 分类和可定位 Diff；
- 冲突目标及原因；
- 完整索引扫描范围、已知待同步变化和 `unknown` 覆盖率；
- **镜像同步写集**（§2.3）：将被全量 upsert 复制到兄弟视图的漂移文件，逐文件给出内容根路径、兄弟视图路径与两侧当前 digest / absent；
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
8. 恢复写集写盘与镜像操作完成后，执行全量内容根→兄弟视图 upsert。**upsert 前必须先核验漂移集合**：重新枚举内容根↔兄弟视图漂移，与预检披露的镜像同步写集比对（路径集合与内容 digest）；**出现预检未披露的漂移时立即阻断，不得先写入再检查**。核对通过后才执行 upsert，且 upsert **只复制已核验集合内的文件**，不得写入未披露路径。upsert 后再次枚举并确认实际漂移已收敛、且除「恢复镜像目标 ∪ 镜像同步写集」之外无镜像文件被改动。随后重新枚举实际 `projectRoot/semantic-layer/` 扫描集合并与计划比对。
9. **所有触发镜像同步的内部调用必须走受控路径**：索引前的准备步骤（如 `prepareSemanticLayerForKtx`）与启动恢复的镜像同步（如故障恢复中的 runtime mirror 同步）内部都会执行**不受本次写集约束的全量同步**，还会做垃圾清理与历史目录迁移（含 rename／rm）。恢复流程不得直接依赖这些无参全量同步：必须使用**只针对已核验集合**的受控同步变体，或在调用前完成同样的漂移核验并断言其内部同步未超出该集合。清理与历史迁移属于**独立于恢复写集的平台行为**，必须在恢复前完成并纳入范围复核，不得与恢复写入混在同一未核验的副作用中。
10. 把幂等意图转为 `applied`、release 转为 `reindexing`，再按 §5.5 确定的索引模式执行 reindex，按真实结果及必要终结审计写入 `published / confirmed` 或 `reindex_failed / unconfirmed`。

任一项失败都不得跳过。恢复预检后的另一个 WebUI 写入、单表保存、单表 YAML 导入、Manifest 上传、CLI / Git 修改，包括 `absent → 存在`，均使 CAS 失败并要求重新预检。内容根已删除但镜像未删除、镜像删除结果未知或实际扫描范围不一致时，只能按失败恢复或 `reindex_failed / unconfirmed` 处理，不得记 `published / confirmed`。

### 5.2.1 共享临界区锁生命周期（2026-10-30 源码复核）

L25-11 §7.2 要求共享临界区覆盖索引、最终 digest 复核、终结审计、历史与状态持久化。2026-10-29 PM 裁定取 (a)：这条要求落在既有发布路径上，不作为 L25-15 的开工前置。

**现行源码（提交 `3b7e8d32`，2026-10-30）已经盖住该窗口：**

- `publishSemanticAssets` 的后台 `runReindex` 先做 `verifyFinalTargetDigests`、`recordConfigChange`（`changeType: "semantic_publish_terminal"`）、把 release 写成 `published`，再 `completeRecoveryJournal`，然后才在 `finally` 中 `releasePublishLock`。注释「persisted INSIDE the same critical section」与这段顺序一致。
- 手动 reindex 在 `withPublishCoordinator("manual_reindex")` 回调内写入历史记录，回调返回后锁才释放。

v0.5–v0.10 写的「reindex 返回即放锁」是该提交之前的源码。v0.11 以当前源码为准。L25-16 Spec 的 G31 仍引用放锁前的旧行号；本功能不改那份登记，也不把 G31 文本未更新当作本功能的交付前提。L25-11 的 V01–V22 仍未执行；`3b7e8d32` 只说明当前锁顺序，不构成 L25-11 验收通过。

**对本功能的约束：**

1. 批次前快照、promoting 与 journal 接在既有临界区内部、首个正式写入之前。批量发布与手动 reindex 的释放点保持在终态审计、release 终态和 journal 终结之后。实施不得把 `3b7e8d32` 的释放点提前到 reindex 返回时。
2. `semantic_restore` 使用同一协调器。锁覆盖恢复写入、后台 reindex、终态审计与状态持久化，终态落库之后才释放。
3. 提交前重读每个目标的基线，并拒绝与未终结批次重叠。未终结指 `promoting`、`reindexing` 或 `terminalAuditPending=true`。这是内容合同，与锁一起保留。
4. §2.2 清单中的 `writeSourceYamlImport` 与 `applyConnectionIdChange` 当前仍在发布窗口之外。S1 把 YAML 导入纳入发布窗口并接快照；连接 ID 变更只做互斥，不生成可恢复快照。这两处接入完成前，恢复提交以基线复核阻断它们与恢复计划交错。

并发注入计入 §10.1 SRR-23。

### 5.3 幂等

幂等记录按实例 + 操作者 + 客户端幂等键索引，绑定 `previewId / planDigest / sourceReleaseId / attemptId`，至少保留 **24 小时**，并明确三态：

| 状态 | 写入时点与重放规则 |
|---|---|
| `intent` | 在 `promoting` 记录之后、快照与正式写入之前持久化。重放必须回读 release、snapshotId、journal 和实际状态；只能返回真实进行中的批次或进入启动对账，不得仅凭 key 返回 accepted。若 release 已结清 `promote_failed` 且零正式写入可证明，先把幂等结清为 `failed`，再允许同键同计划新 attempt；结果未知则置 `recoveryRequired` 并禁止自动重试 |
| `applied` | 正式写入和镜像核验完成后持久化。重放返回同一 releaseId 的当前状态，不重复写盘或 reindex；release 不存在或关联不一致属于异常，不得伪装成功 |
| `failed` | 明确失败时结清并保留原因。只有能够证明零正式写入时，同键同计划才可建立新 attempt；写入结果未知或 `recoveryRequired` 时禁止自动重试 |

- 同键不同计划返回冲突。每次重新预检生成新的 planDigest，UI 必须同时使用**新幂等键**；预览过期后的路径是“重新预检 + 新幂等键”，不是复用旧键换计划。
- 已 applied 的断线重连可以越过旧预览有效期直接查询原批次；新提交仍必须持有有效预览。
- **幂等查询的时序**：只读重放查询必须在取得共享发布临界区**之前**执行。恢复锁覆盖后台 reindex 直到终态，若在锁内查询，进行中的同键重放会先撞 `semantic_publish_busy` 而无法返回 §5.3 规定的「真实进行中批次」。因此顺序固定为：鉴权与恢复准入检查 → 只读幂等查询 → （需要新 attempt 时）取锁 → 锁内**完整重做**三态判定与恢复准入检查 → 继续提交。
- **锁外查询严格只读**：锁外的幂等查询只允许返回既有批次状态或阻断，**不得**在锁外执行结清、修复或其他写操作；任何需要改变状态的动作（结清 `failed`、对账 `intent`）必须在取得互斥后于临界区内执行。
- 取锁后必须**完整**重做三态判定（含 `failed` 且零写入未证明 → `recoveryRequired`）、计划一致性核对与恢复准入检查，不得只检查 `applied` / `intent`；否则两次查询之间状态变化时，「结果未知」的记录会被当作可新开 attempt，违反「禁止自动重试」。
- 幂等命中不能绕过当前权限、实例和恢复阻断检查；未过期记录不得因当前 500 条容量上限被静默提前淘汰。达到上限且没有可清理过期记录时，拒绝新 intent 并零正式写入。
- 已过期的幂等记录可清理，但不得作为永久历史或快照替代品。幂等记录过期前，其引用的发布记录不得因侧车「最近 100 条」截断而被淘汰（§4.2）。

### 5.4 写入与索引失败

- 写盘、删除、镜像同步／删除或必要记录失败时，停止后续步骤，复用恢复日志按实际字节逆序恢复本批次已改的内容根和镜像目标；不覆盖第三方新内容。故障日志必须记录受控镜像目标的原 bytes / absent 与 digest，使镜像删除后也能恢复原 bytes。
- **恢复日志的终结时机与现有 L25-11 §7.2 合同一致**：全部目标写盘并镜像完成后，日志只推进到「文件已保存、索引／终结结果待确认」阶段，**保持未终结**；只有索引、最终 digest 复核、终态审计与 release 状态均可核对后才终结日志。索引失败时日志同样保持未终结，使索引可被重试而不回滚已经落地的写入。恢复流程不得在 reindex 之前关闭日志，也不得因为已经写完文件就宣告批次结束。
- 本功能需要显式扩展 L25-11 §7.2 第 4 条的“预期新 digest”类型：recovery journal 的 `newContent / expectedNewDigest` 必须允许 `null` 表示预期 absent。`restoreEntry` 以当前 absent == expected absent 判定删除已落地，再按原 bytes 恢复；原目标也 absent 时为 unchanged，其他内容才是第三方冲突。该扩展只补删除方向，不改变既有实际字节判定原则，须在实施记录中单独评审。
- 无法完整恢复时置 `recoveryRequired=true`，阻断后续发布和手动索引，并使受影响资产的 Lucy 读取 / 查询按既有合同失败关闭。
- 启动时先处理未终结恢复日志以及 `promoting / reindexing` 记录，再开放发布；在快照、release 关联、rename、delete、镜像删除、日志更新、索引和终结记录边界不得猜成功。`reindexing` 按 §4.3 重跑索引确认或结清为可重试 `reindex_failed`，不得无限停留。
- reindex 失败保留已经恢复的文件，状态为 `reindex_failed` 和“生效状态待确认”；重试索引不重复恢复写盘，范围变化必须重新预检。

### 5.6 恢复批次的索引重试

`reindex_failed` 的恢复批次必须有一条**明确的、可执行的**索引重试链路，不能依赖手动 reindex 代替：

| 环节 | 合同 |
|---|---|
| 重试入口 | 恢复批次状态接口提供**批次自身的索引重试**动作，绑定原 releaseId 与新的 attemptId；不得用「纯手动 reindex」入口结算恢复批次 |
| 与手动 reindex 的区别 | 纯手动 reindex 产生独立的 reindex 记录、无内容写入、无快照；恢复批次重试必须关联原 releaseId、保留原失败 attempt、沿用 §5.5 的 `reindexMode` |
| 写盘 | 重试**不重复**恢复写集的内容根写入，也不重复对恢复写集的镜像目标执行写入／删除（恢复写集已处于恢复后状态）；只重新执行索引与必要的语义读回。**镜像同步写集方向的全量同步不属于「重复恢复写盘」**，但仍受下方「镜像副作用」行的核验约束 |
| 范围确认 | 重试必须**独立于内容恢复预检**。内容恢复预检以来源批次的发布后 digest 做 CAS，用于构建内容写入计划；恢复已写盘后对原来源再预检通常冲突，而对新恢复批次预检等于构建反向恢复。索引重试因此需要一个**只确认索引范围、不重新计算内容恢复计划**的确认对象：绑定该 releaseId、当前实际 KTX 扫描集合、当前镜像同步写集与 `reindexMode`，范围一致才允许重试；范围变化时要求重新确认而非重新恢复 |
| 镜像副作用 | 索引调用前必须处理 `reindexProject` 内部的 `prepareSemanticLayerForKtx`：它会先执行四类目录的全量同步。重试**不得**借此引入计划外镜像写入——重试前须核验当前漂移集合与该 release 记录的镜像同步写集一致，或使用只针对已核验集合的受控同步路径；核对不一致时阻断并要求重新确认，不得静默同步 |
| 幂等 | 重试使用新的 attemptId 与新的幂等键；原幂等键已被 `applied` 占用，不得用它再次触发索引 |
| 失败保留 | 原失败 attempt 的审计、错误与 `reindex_failed` 记录保留，不被重试覆盖 |

重试同样受 §5.5 的索引模式约束：含删除目标的批次重试时**必须**沿用强制重建模式并执行删除方向的语义读回，不得因为是「重试」而退回增量。

- `published` 只在正式文件、运行镜像（包括计划内 absent）、实际 KTX 扫描范围、索引和必要终结记录均满足既有合同后成立。HTTP accepted 只表示受理，不等于已生效。

### 5.5 索引重建模式与语义读回

索引模式由**恢复是否导致语义层面的表消失**唯一决定，并写入 release 记录，索引重试与启动续跑必须读取同一记录、沿用同一模式，不得各行其是：

| 场景 | 索引模式 | 说明 |
|---|---|---|
| 恢复不导致任何表在合并模型中消失 | 增量 reindex | 与现有发布一致：`ktx admin reindex` |
| **恢复导致至少一张表在合并模型中消失**（含下述两类） | **强制重建**：`ktx admin reindex --force` | 增量 reindex 不会撤销已从索引中移除的语义，必须清空后全量重建 |
| 索引失败后的重试 | 与该 attempt 原记录的模式相同 | 模式持久化在 release 记录中，重试不得改判 |
| 启动时从 `reindexing` 续跑 | 与该 release 记录的模式相同 | 无法安全重跑或模式不可判定时，结清为可重试 `reindex_failed / unconfirmed`，不得猜成功 |

**「语义层面的表消失」的判定（不能只看文件是否 absent）**：

| 消失类型 | 触发条件 | 说明 |
|---|---|---|
| **文件级消失** | **Manifest 文件**本身恢复为 `absent` | 该 Manifest 下的表在合并模型中随之消失 |
| **不构成表消失** | **overlay 文件**本身恢复为 `absent` | overlay 只提供业务扩展；Manifest 中该表仍在，表结构仍可见（见下方读回预期）。**此类目标不进入语义删除集合，但扩展不可见的读回仍然必须执行** |
| **Manifest 内删表** | Manifest 文件被**原地回写**为不再包含某张表（文件本身仍是 `restore`，不是 `absent`） | 例：来源批次向现存共享 Manifest 增加表 B；恢复时回写旧 Manifest 移除 B。**文件未删除，但表 B 从模型中消失** |

两类都必须触发强制重建与读回。**只用「是否有目标恢复为 absent」判定模式是不够的**——Manifest 原地回写删表同样是语义删除，若走增量索引，索引中可能仍残留该表。

因此模式判定必须基于**恢复前后的合并模型差异**推导：比较恢复前后的 Manifest 表集合与 overlay 集合，得出**语义删除集合**（在恢复后不再存在于合并模型中的表），而不是只统计 `absent` 目标。

**删除方向的语义读回（验收义务）**：仅以「文件已 absent」与「CLI 退出码 0」不能证明被删除语义已从 Agent 读取面消失。**凡是存在删除类目标（overlay 删除或语义删除集合非空）的恢复，都必须在索引成功后执行读回**，不限于强制重建的场景；强制重建场景下读回失败一律记 `reindex_failed / unconfirmed`。

读回预期必须**按恢复后的合并模型逐目标判定**，不得一律当作「整张表消失」：

- Lucy 的语义读取是**双层合并**：共享 Schema Manifest 提供表结构与列，overlay 提供业务扩展（`semantic-layer.ts` 的 `readOverlay` 与 `modelFromTable` 共同构成模型）。overlay 文件不存在时返回空对象（`{}`），**表仍存在**；只要 Manifest 中该表仍在，模型照常构建。
- 因此读回预期分为两类：
  - **删除 overlay 的目标**：预期该表的**业务扩展不可见**，但表结构（来自 Manifest）**仍然可见**——断言「该表已不可检索」是**错误的**；
  - **语义删除集合中的表**（文件级消失，或 Manifest 内删表）：预期该表**整体**不再存在，且不可检索、不可读取。
- 只有当恢复后的合并结果中**整个表定义确实不存在**时，才断言整表不可检索／不可读取。
- 读回预期必须**由恢复计划推导并持久化**（记录语义删除集合与每个目标的预期类别），使断言可复核，而不是由实施者临时判断。

读回失败：记 `reindex_failed / activationStatus=unconfirmed`，保留已写文件，**不得**记 `published / confirmed`。

读回通道与断言方式在实施时按既有 Agent 查询面确定，但必须在 SRR-04／16／17 中给出可复核的执行证据；不支持该读回的方言或环境按 §10.2 记 `blocked_environment`，不得以「文件已删除」替代。

模式判定与语义删除集合必须在预检阶段确定并进入 `planDigest`，使提交与重试无法各自判断。

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

### 8.1 终态审计可恢复协议（`terminalAuditPending`）

终态审计与 release 状态更新是两个独立的持久化动作，二者之间存在崩溃窗口。该窗口必须由 `terminalAuditPending` 显式封闭，且不得只靠 UI 隐藏。

**协议步骤（唯一权威顺序，不得存在第二套）**：

1. **落终态审计**：写入终态审计 `outcome=published`、`publishEffect=true`，载荷带 `activationStatus=confirmed`，关联 releaseId / newSnapshotId / planDigest / attemptId。
2. **写 release 终态并置 pending**：release 更新为 `status=published`、`activationStatus=confirmed`、`terminalAuditPending=true`。
3. **核对审计并清 pending**：回读确认同 attempt 终态审计已落库，release 更新 `terminalAuditPending=false`。
4. **终结恢复日志**：journal 终结（见 §5.4 的终结时机）。

**为什么是「先落审计、后写 release」**：审计守卫检查的是**审计载荷本身**的 `payload.recovery.activationStatus === "confirmed"`（`semantic-batch-audit.ts` 的 `assertSemanticAuditPayloadConsistent`），**不读取磁盘上的 release 状态**。因此守卫**不要求** release 事先已是 published——不需要「为满足守卫而先写内部成功记录」这一前置。

**`terminalAuditPending` 的唯一含义与设置点**：

- **唯一含义**：终态审计**尚未被核对**（步骤 3 未完成）。
- **唯一设置点**：步骤 2，与 `status=published / activationStatus=confirmed` **同一次写入**。因此不存在「先写 pending 再写 published」这类额外成功状态写入。
- **唯一清除点**：步骤 3，核对审计落库后置 `false`。
- 步骤 2 失败时 release 仍为 `reindexing / unconfirmed`，**不得**写 `published / confirmed`；按 §5.6 的重试判定处理。

**pending 状态下的处理**：

- 所有公开投影一律显示「生效待确认」，包括发布历史列表、详情、状态 API、CSV 导出与筛选计数；不得在任何出口暴露 `published` 或 `confirmed`；
- 公开投影必须在**服务端**统一实现，不得依赖前端单独隐藏而让状态 API 或 CSV 泄露成功状态；
- 该状态**不得**作为稳定终态存在，必须由启动对账结算。

**步骤 3（清 pending）失败时**：release 为 `published / confirmed / pending=true`，审计已落库但未核对。启动对账按 pending 分支结算。

**步骤 4（终结 journal）失败时**：release 为 `published / confirmed / pending=false`，但 journal 未终结。启动对账按「release 已成功但 journal 未终结」分支**只补 journal 终结**，不改写 release 终态、不重复追加成功审计。

**步骤 1（落审计）失败时**：终态审计未落库，release 仍为 `reindexing / unconfirmed`，**不得**写 `published / confirmed`。此时 release 置 `recoveryRequired=true`，进入启动对账的**阻断与重试判定**分支（见下），由启动流程或 §5.6 的重试路径判定，不得静默悬挂。

**审计事件的唯一身份**：终态审计以 `releaseId + attemptId + "terminal"` 作为唯一键。启动对账重放时若已存在同键审计，**不得重复追加**。

**启动对账的互斥分类（§4.3 与启动伪代码）**：启动时必须先对每个待结算 release 做**互斥分类**，再按分类执行；同一 release **不得**被两条路径重复处理。分类与处置：

| 类别 | 判定条件 | 处置 |
|---|---|---|
| **A 终态证据补写类** | 存在同 attempt 终态审计，但 release 未到 `published` | **只补写 release 终态**，不重跑索引、不重复追加审计 |
| **B journal 补写类** | release 已 `published`，但关联 journal 未终结 | **只补 journal 终结**，不改写 release 终态、不重复追加审计 |
| **C 终态核对类** | `terminalAuditPending=true` | 审计已落库则补写 release 终态并清 pending；审计缺失但证据可核对则先补审计再清 pending；证据不可核对则结清 `reindex_failed / unconfirmed` |
| **D 索引续跑类** | `reindexing`，且**无**同 attempt 终态审计证据 | 才允许从既有索引阶段重跑一次以确认终态；结果未知则结清 `reindex_failed / unconfirmed` |
| **E 零写入结清类** | `promoting`，且零正式写入可证明 | 结清为 `promote_failed` |
| **F 阻断与重试判定类** | `recoveryRequired=true` 的失败记录（含步骤 1 落审计失败） | 保持阻断；证据可核对时允许走 §5.6 重试，否则维持失败关闭 |

分类**互斥且有优先级**：A／B／C 属「成功证据补写类」，必须**先于** D 处理；一旦归入 A／B／C 就**不得**再进入 D 的索引续跑。分类为 D 的记录才允许产生新的索引调用。

结算后不得有记录无限停留在 `terminalAuditPending=true`，也不得留下「审计与 release 状态不一致」「release 成功但 journal 未终结」或「recoveryRequired 悬挂无出口」的记录。

**一致性要求**：§4.3 的启动扫描范围、§8 审计表、本节协议与启动伪代码必须描述**同一套状态转移**。本节是唯一权威定义；其他章节引用本节，不得另行定义顺序或 pending 语义。

- 快照实例 ID 只用于防误恢复，不是机密或安全边界。digest 用于完整性核验，不冒充作者签名或不可抵赖证明。
- 恢复包只读导出为 ZIP，内含 `semantic-release-snapshot/v1` manifest、全部原 bytes / absent 和 digest；导出前自检完整性。最多 200 个 entry、metadata 1 MiB、解压内容 512 MiB、ZIP 544 MiB，使用 `restorePackageMaxEntries / restorePackageMaxMetadataBytes / restorePackageMaxUnpackedBytes / restorePackageMaxZipBytes` 独立键进入 `SEMANTIC_BATCH_LIMITS`，不得复用或改写维护包导入的 200 / 256 KiB / 16 MiB / 20 MiB 门禁。采用流式下载；超限或无法流式导出时明确失败，不返回截断包。快照本身不设 200 entry 上限，超限快照仍可恢复但不可导出，UI 显示独立原因 `semantic_restore_package_limit`。
- 不得允许修改包后上传绕过服务端快照、权限、CAS 和校验。本期提供服务端格式说明与完整性校验，不另建离线校验工具。

## 核心流程（伪代码）

以下为规范性顺序。helper 表示复用或扩展的共享服务，不是现有函数签名；关键分支映射 SRR-01–SRR-24。

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
  mirrorSyncWriteSet = enumerateContentRootVsSiblingViewDriftOrBlock(
    currentKtxSiblingView, contentRoot
  )  // §2.3 镜像同步写集：全量 upsert 会复制的既有漂移，逐文件两侧 digest
  knownPending, unknownCoverage = discloseKnownPendingWithoutGuessing(
    fullIndexScope
  )
  semanticDeletionSet = deriveSemanticDeletionSetFromMergedModelDiff(snapshot, changes)
    // §5.5：由恢复前后合并模型差异推导，含 Manifest 原地回写删表；
    // 不得只统计 absent 目标（文件仍为 restore 的删表同样是语义删除）
  reindexMode = semanticDeletionSet.nonEmpty ? "force_rebuild" : "incremental"
    // §5.5；模式进入 planDigest，提交与重试不得各自判断
  plan = buildRestorePlan(snapshot, changes, fullIndexScope,
                          mirrorSyncWriteSet, reindexMode)
  checks = runSharedValidationAndContractGate(plan.postRestoreCandidate,
                                               fullIndexScope)
  preview = persistActorAndInstanceBoundPreview(
    plan, checks, conflicts, ttl=30min
  )
  acquireSnapshotLease(snapshot.id, kind=preview, expiresAt=preview.expiresAt)
  return previewWithSeparateTargetsFullScopeKnownAndUnknown(
    preview, knownPending, unknownCoverage, mirrorSyncWriteSet
  )  // 预检不写正式文件、镜像或索引

submitRestore(actor, sourceReleaseId, previewId, planDigest, idempotencyKey):
  requireCurrentSemanticPublishPermission(actor)
  requireNoUnresolvedRecovery()
  // 只读重放查询必须在取锁之前：锁覆盖后台 reindex，直到终态才释放；
  // 若在锁内查询，进行中的同键重放会先撞 busy 而无法返回真实进行中状态。
  replay = findIdempotent(actor, persistentInstanceUuid(), idempotencyKey)
  if replay.exists and replay.planDigest != planDigest:
    conflict semantic_restore_idempotency_conflict
  if replay.state == applied:
    release = requireExistingReleaseAndSnapshotLinkage(replay.releaseId)
    return currentStatusWithoutRewriteOrReindex(release)
  if replay.state == intent:
    // 锁外只允许「读取并返回」：若该 intent 仍在真实进行中，直接返回其状态；
    // 若需要结清（例如对应 promote_failed 且零写入已证明），必须转入锁内，
    // 因为锁外不得执行任何写操作，而协调器在未取得锁时只会抛 busy。
    running = readIntentProgressWithoutMutation(replay)
    if running.isStillRunning:
      return currentStatusWithoutRewriteOrReindex(running.release)
    // 否则继续取锁，在锁内完成结清与后续 attempt 判定
  if replay.state == failed and not replay.zeroFormalWritesProven:
    return recoveryRequiredWithoutAutomaticRetry(replay)

  withRestoreCoordinatorLockHeldThroughAsyncReindex(kind=semantic_restore):
    // 取锁后必须完整重做三态判定与准入检查，不能只查 applied / intent：
    // 只读查询与取锁之间状态可能变化，遗漏 failed 分支会让「结果未知」的
    // 记录被当作可新开 attempt，与「禁止自动重试」冲突。
    requireNoUnresolvedRecovery()
    replay2 = findIdempotent(actor, persistentInstanceUuid(), idempotencyKey)
    if replay2.exists and replay2.planDigest != planDigest:
      conflict semantic_restore_idempotency_conflict
    if replay2.state == applied:
      release = requireExistingReleaseAndSnapshotLinkage(replay2.releaseId)
      return currentStatusWithoutRewriteOrReindex(release)
    if replay2.state == intent:
      # 锁内可以执行结清：reconcileExistingIntentByReleaseJournalAndActualBytes
      # 按实际字节与 release/journal 状态对账；
      # 若确认 promote_failed 且零正式写入可证明 → 先把幂等结清为 failed，
      # 再允许同键同计划新 attempt（见下方 failed 分支）
      reconcileExistingIntentByReleaseJournalAndActualBytes(replay2)
      if not replay2.zeroFormalWritesProven:
        return recoveryRequiredWithoutAutomaticRetry(replay2)
      # 零写入已证明：幂等已结清 failed，允许继续走新 attempt 路径
    if replay2.state == failed and not replay2.zeroFormalWritesProven:
      return recoveryRequiredWithoutAutomaticRetry(replay2)
    // failed 且零写入已证明：允许同键同计划新 attempt（沿用锁外同一规则）

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

    // §4.3 步骤 1–3：promoting 记录与幂等 intent 都属于写前持久化，
    // 任一失败都必须在本调用内结清为明确失败，不能只依赖重启清理。
    try:
      newReleaseId = persistPromotingReleaseOrFail(
        trigger=webui_restore,
        restoreOfReleaseId=sourceReleaseId,
        restoreSourceSnapshotId=snapshot.id,
        reindexMode=rebuilt.reindexMode,   // §5.5；重试与启动续跑读取同一记录
        activationStatus=unconfirmed
      )
      persistIdempotentIntentOrFail(newReleaseId, planDigest, attemptId)
      captureBatchSnapshotBeforeFormalWrites(actor, newReleaseId, rebuilt)
      persistFailureRecoveryJournalAllowingExpectedAbsentOrFail(
        newReleaseId, changedTargetsAndTheirKtxSiblingTargets
      )  // 只登记恢复写集（两面原 bytes / absent 与 digest）；
         // 镜像同步写集不在 journal 内，其方向是镜像向内容根对齐
      persistRequiredAcceptedAuditOrFail(outcome=staged, publishEffect=false)
        // 以上任一失败：release=promote_failed、idempotency=failed、零正式写入
    catch prewriteFailure:
      // 按已成功持久化的对象分别结算；结算本身再失败时，
      // 必须持久保留恢复准入义务（recoveryRequired），不得留下无主 promoting 记录
      settlePreWriteFailureByWhatWasPersisted(newReleaseId, attemptId)
        // 按已成功持久化的对象分别结算为 promote_failed / failed；
        // 零正式写入可证明时才允许同键同计划新 attempt
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
      // §2.3 / §5.2 第 8 步：先核验漂移集合，再执行全量 upsert，最后枚举扫描集合
      requireDriftSetMatchesPreviewOrBlockBeforeUpsert(rebuilt)
      runFullContentRootToSiblingViewUpsertWithSameScopeAsPrepareSemanticLayer(
        onlyVerifiedDriftSet(rebuilt)
      )  // 只复制已核验集合内的文件，不写入未披露路径
      requireActualMirrorSyncWriteSetMatchesPreviewOrBlock(rebuilt)
      requireNoOtherMirrorFilesChanged(rebuilt)  // 恢复镜像目标 ∪ 镜像同步写集之外不变
      actualScope = enumerateActualProjectRootKtxSiblingScanSetOrBlock()
      require actualScope == rebuilt.fullIndexScope
      // files-saved 阶段标记必须在 applied / reindexing 之前，且纳入失败处理；
      // 否则窗口内退出会让 journal 停在 write_in_progress，被启动恢复当作可回滚
      completeFailureRecoveryJournalFilesSavedNotClosed(rebuilt)
      markIdempotencyAppliedOnlyAfterFormalWritesAndMirror(newReleaseId)
      persistExistingReleaseOrFail(newReleaseId, reindexing)
    catch writeDeleteMirrorOrRequiredRecordFailure:
      restoreContentRootAndKtxSiblingUsingJournalByActualBytes()
      if thirdPartyContentOrOutcomeUnknown:
        markRecoveryRequiredAndClosePublishManualIndexAndAffectedReads()
      persistPromoteFailedOrUnconfirmedWithoutReindex()
      return failure

    result = runReindexWithModeResolvedFromReleaseRecord(newReleaseId)
      // 模式由 release 记录持久化（增量 / 强制重建），见 §5.5
    if result.failed:
      persistFailedAuditAndRelease(reindex_failed, activationStatus=unconfirmed)
      keepRecoveryJournalOpenForIndexRetry(rebuilt)   // 日志不终结，可重试索引
      return filesRestoredButActivationUnconfirmed(newReleaseId)

    if rebuilt.hasSemanticDeletion:
      // 读回消费持久化的分类预期，不统一断言整表消失：
      // overlay 删除 → 业务扩展不可见但表结构仍可见；
      // 语义删除集合中的表 → 整表不可检索／不可读取
      readback = verifySemanticDeletionAgainstPersistedExpectations(
        rebuilt.semanticDeletionSet, rebuilt.readbackExpectations
      )
      if not readback.ok:
        persistFailedAuditAndRelease(reindex_failed, activationStatus=unconfirmed)
        keepRecoveryJournalOpenForIndexRetry(rebuilt)
        return filesRestoredButActivationUnconfirmed(newReleaseId)

    verifyFormalAndMirrorDigestsAndRequiredTerminalRecords()
    finalizeTerminalAuditAndPublishedWithRecoverableOutcome(newReleaseId)
      // 任一终结步骤失败：不得保持 published/confirmed；标 unconfirmed + recoveryRequired
    completeFailureRecoveryJournalButRetainLongTermSnapshot()
      // 日志只能在索引、最终 digest、终态审计与 release 状态均可核对后终结（L25-11 §7.2）
    return published(newReleaseId)

startupBeforeOpeningPublishOrManualReindex():
  recoverAllUnfinishedFailureJournalsByActualBytesIncludingExpectedAbsent()
  // §8.1：先做互斥分类，再按分类处置。同一 release 不得被两条路径重复处理，
  // 且成功证据补写类必须先于索引续跑类，否则会出现「先重跑索引再补终态」。
  for release in readAllReleasesNeedingStartupSettlement():
    category = classifyByTerminalEvidenceAndJournalPhase(release)
      // A 终态证据补写类：有同 attempt 终态审计但 release 未到 published
      // B journal 补写类：release 已 published 但关联 journal 未终结
      // C 终态核对类：terminalAuditPending=true
      // D 索引续跑类：reindexing 且无同 attempt 终态审计证据
      // E 零写入结清类：promoting 且零正式写入可证明
      // F 阻断与重试判定类：recoveryRequired=true 的失败记录
      // 分类互斥且有优先级：A/B/C 先于 D；归入 A/B/C 即不得再进入 D
    if category == A:
      settleTerminalAuditWrittenReleaseNotUpdated(release)
        // 只补写 release 终态；不重跑索引；不重复追加审计
        // 证据不可核对 → 结清 reindex_failed / unconfirmed
    else if category == B:
      closeJournalOnlyWithoutRewritingReleaseOrReappendingAudit(release)
        // 只补 journal 终结；不改写 release 终态，不重复追加成功审计
        // 证据不可核对 → 置 recoveryRequired 并阻断
    else if category == C:
      settlePendingTerminalAuditByReconcilingEvidence(release)
        // 审计已落库且证据可核对 → 补写终态并清除 pending
        // 审计缺失但其他证据可核对 → 先补终态审计，再更新 release 终态并清除 pending
        // 证据不可核对 → 结清 reindex_failed / unconfirmed，不得猜 published
    else if category == D:
      reconcileReleaseSnapshotIdempotencyJournalAndActualBytes(release)
      if allWritesAndMirrorProven:
        result = resumeFromReindexingWithoutRepeatingWrites()
        // 续跑沿用 release 记录中的 reindexMode，不得各行其是（§5.5）
        if result.unknownOrFailed: markReindexFailedAndUnconfirmedRetryable()
      else: markRecoveryRequiredAndBlock()
    else if category == E:
      reconcileReleaseSnapshotIdempotencyJournalAndActualBytes(release)
      if zeroWritesProven: markPromoteFailed()
      else: markRecoveryRequiredAndBlock()
    else if category == F:
      settleRecoveryRequiredRecordForRetryOrKeepBlocked(release)
        // 证据可核对时允许走 §5.6 的重试路径；否则维持失败关闭
        // 该分支不得产生新的索引调用，除非明确转入重试流程
    require release not leftIndefinitelyUnsettled
  require no release leftIndefinitelyInReindexing
  require no release leftIndefinitelyTerminalAuditPending
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
| SRR-01 | §2.2 冻结清单中的单表保存、单表 YAML 导入／版本恢复落地、Manifest 上传、批量导入、删除语义文件的 Schema 删除与连接删除、以及整批恢复，均按“写入口→真实写点”在首个正式写入或 `safeRemove` 前创建 promoting 记录与完整快照；覆盖原 bytes、absent、预期新 digest / absent、资产类型和表身份；快照或 snapshotId 关联失败零写入；各入口互斥且快照 helper 以本进程 holder 身份断言持锁，不在 with / acquire 两入口自锁或误 busy。`applyConnectionIdChange` 与纯手动 reindex 不产生内容快照。不删除语义文件的 Schema／连接删除不产生内容快照 | 未执行 |
| SRR-02 | `published / reindex_failed` 且有内容写入才可预检；`blocked / promote_failed` 走失败恢复，`promoting / reindexing` 等待，纯手动 reindex 无恢复动作；`recoveryRequired / activationStatus` 与旧记录 unknown 正确归一化；恢复 trigger 可独立筛选且不混入普通发布 CSV | 未执行 |
| SRR-03 | 30 表发布成功后恢复到该批次发布前；**恢复写集**（本批内容根目标及一一对应的受控镜像目标）两面 digest / absent 一致，实际 KTX 扫描范围一致且索引成功后才显示已生效，Agent 经 Lucy Proxy 可检索恢复后的合成语义；**恢复写集之外的内容根文件 hash 完全不变** | 未执行 |
| SRR-04 | 批次新建文件在内容根与 KTX 兄弟视图成对恢复为删除，批次删除文件在两面恢复原 bytes；expectedNewDigest=null 可用于 CAS 和反向恢复；通用 content-mirror 仍不全局删除，计划外文件不变；镜像未删或结果未知不得 published；路径越界或身份歧义阻断；**恢复导致语义删除集合非空时必须使用 `--force` 强制重建，并完成删除方向语义读回**——删除 overlay 的目标断言**业务扩展不可见但表结构仍可见**，语义删除集合中的表才断言**整表不可检索／不可读取**；**语义删除集合必须由恢复前后合并模型差异推导，包含 Manifest 原地回写导致的删表（文件仍为 restore，不是 absent）**；**删除 overlay 文件不构成表消失——该表结构仍可见，但业务扩展不可见的读回仍必须执行**；读回预期由恢复计划推导并持久化，读回失败记 `reindex_failed / unconfirmed` 不得 published | 未执行 |
| SRR-05 | 全部 originalDigest==expectedNewDigest 时 no_change，不创建空发布、幂等或索引；混合 unchanged 仅写差异目标且全目标仍做 CAS；外部改回 originalDigest!=expectedNewDigest 所描述内容必须冲突而非 no_change | 未执行 |
| SRR-06 | 来源批次后另一批次修改任一相同目标：恢复预检可见冲突，提交 409，整批零正式写入，不提供强制覆盖 | 未执行 |
| SRR-07 | 预检后单表保存、单表 YAML 导入、Manifest 上传、删除语义文件的 Schema 删除或连接删除、另一会话或 CLI / Git 修改目标 / 依赖，含 absent→存在：CAS / stale 阻断，旧预览和确认不可复用。连接 ID 变更使路径集合变化，旧恢复计划失效 | 未执行 |
| SRR-08 | 同目标连续 A、B 发布：先恢复 B 再恢复 A 成功；每次恢复生成新批次和可读 snapshotId，可反向恢复，来源历史和审计不被改写；单表保存同时改共享 Manifest 时实际写集与影响表披露一致 | 未执行 |
| SRR-09 | Drawer 分开列出恢复目标、实际 `projectRoot/semantic-layer/` 兄弟视图的完整索引扫描范围、已知待同步变化与 unknown 覆盖率；**并单列镜像同步写集**（全量 upsert 会复制的既有漂移，逐文件两侧 digest）；披露范围与镜像同步后的实际 reindex 扫描集合一致；**内容根侧无关文件 hash 不变；镜像侧允许变化的恰为「恢复写集的受控镜像目标 ∪ 已确认的镜像同步写集」**，两类变化方向不同且可分别核对；除此之外的镜像文件 hash 不变；unknown 不显示为空清单或“无其他变更”；**索引前内部 prepare 的全量同步、启动恢复的 runtime mirror 同步、垃圾清理与历史目录迁移（含 rename／rm）都必须走受控路径，不得超出已核验镜像集合，且清理与迁移须在恢复前完成并纳入范围复核** | 未执行 |
| SRR-10 | 完整索引范围、依赖或校验范围无法取得时整批阻断；不得只显示来源批次文件或用内容根集合冒充实际 KTX 扫描集合后放行 | 未执行 |
| SRR-11 | 恢复后候选存在 YAML、模型、关联或合同门禁错误：正式文件、镜像和索引不变；合法性、完整度和执行证据不混淆 | 未执行 |
| SRR-12 | 预览 30 分钟到期、planDigest 不符、来源或实例改绑均拒绝；重新预检生成新 planDigest 和新幂等键，不能修改时间戳续期；preview lease 到期前防清理、到期后可释放 | 未执行 |
| SRR-13 | intent / applied / failed 三态下重复点击、HTTP 重试和断线重连不重复写盘 / 索引；intent 对应 promote_failed 且零写入可证明时先结清 failed 并允许同键同计划新 attempt；快照或 journal 失败后同键重试不得返回死 releaseId；applied 重放须核对真实 release；同键不同计划冲突；500 条上限不提前淘汰未过期记录，24 小时后可清理；**进行中的同键重放必须返回真实进行中批次而不是 busy**（只读幂等查询在取锁之前，取锁后二次核验） | 未执行 |
| SRR-14 | 未登录、失效会话、Agent Token、CSRF / 来源不符、其他操作者预览 ID，以及预览后撤权：预览、提交、轮询和导出均拒绝且不泄露内容 | 未执行 |
| SRR-15 | 第 N 次内容根／镜像写入、删除或必要记录失败：按实际字节逆序恢复两面；恢复删除目标后再失败能写回原 bytes，不误报第三方冲突；第三方内容不覆盖，恢复不完整触发失败关闭 | 未执行 |
| SRR-16 | 在 promoting、intent、快照、snapshotId 关联、journal、rename、delete、镜像删除、index 和终结记录各边界 kill 并重启：记录可见、关联可读，不猜 published，不误删历史快照；已写可从索引阶段继续，未知状态先阻断；index／终结边界后重跑确认或结清为可重试 reindex_failed，不无限停留 reindexing；**`terminalAuditPending=true` 的记录必须被启动对账结算**（审计已落库则补终态、审计缺失但证据可核对则先补审计、证据不可核对则结清 reindex_failed / unconfirmed），**不得无限停留在 pending**；**启动续跑必须沿用 release 记录持久化的 `reindexMode`，含删除目标的批次续跑仍走强制重建并完成删除方向语义读回**；journal 停在 `write_in_progress` 时必须先按实际字节判定，不得当作「文件已保存」直接续跑；**必须覆盖「release 已 published/confirmed 但关联 journal 未终结」的崩溃断点**——启动对账只补 journal 终结，不改写 release 终态、不重复追加成功审计；**必须覆盖「终态审计已落库但 release 未到 published」的断点**——只补 release 终态，不重复追加审计；**启动对账必须按 §8.1 的六类互斥分类执行，补写类优先于索引续跑类，补写类记录不得产生新的索引调用**；**promoting 或 intent 持久化异常时，必须在本次调用内、不依赖重启地按已持久化对象分别结清**，结清本身再次失败时恢复准入义务仍持久存在 | 未执行 |
| SRR-17 | 恢复写盘成功但 reindex 失败：保留文件并显示 `reindex_failed / activationStatus=unconfirmed`；**恢复批次自身提供索引重试入口，绑定原 releaseId 与新 attemptId，不重复恢复写盘、不用纯手动 reindex 代替，原失败 attempt 保留**；范围变化重新预检；**重试沿用该 release 记录的 `reindexMode`，含删除目标的批次重试仍为强制重建并执行删除方向语义读回**；**索引重试使用独立的范围确认对象，不触发正向或反向的内容恢复**，范围变化须重新确认而非重新恢复；**重试前内部 prepare 的镜像同步不得超出已核验集合，未确认漂移时零镜像写入** | 未执行 |
| SRR-18 | 预览 / 导出 / 受理 / 阻断 / 失败 / 终态按 validated / exported / staged / blocked / failed / published 映射；受理审计失败零写入，终态审计失败不留 published / confirmed；来源 / 新批次、双方快照和 planDigest 关联完整，日志无 YAML / 凭据；**终态审计以 `releaseId + attemptId + "terminal"` 为唯一身份，启动对账重放不得重复追加成功审计**；**`terminalAuditPending=true` 的记录在发布历史列表、详情、状态 API、CSV 导出与筛选计数中一律显示「生效待确认」，不得暴露 published / confirmed** | 未执行 |
| SRR-19 | 最多 20 个记录仍存在的可恢复批次、30 天、512 MiB 及各边界 +1：按精确序列化字节先腾位再落盘；orphan 不占 20 个名额但计年龄／容量并优先清理；publish / restore / preview / export lease 与清理并发不丢活跃快照；失败批次不占可恢复计数；容量不足不落新快照且零正式写入 | 未执行 |
| SRR-20 | 上线前旧记录缺字段显示 unknown / 快照不可用；缺失 / 损坏 / 过期 / 其他实例均拒绝；持久实例 UUID 不得回退共享默认值，不从 Diff、单表版本或旧 journal 重建 | 未执行 |
| SRR-21 | ZIP 恢复包的 v1 manifest、entry、bytes / absent 和 digest 完整，篡改可检出；restorePackage* 独立限额的 200 entry、1 MiB metadata、512 MiB 解压内容、544 MiB ZIP 边界及 +1 不截断，维护包限值不变；超过 200 entry 的快照可恢复但导出明确失败；流式下载重新鉴权，无上传入口，staging / Agent 检索不读取快照 | 未执行 |
| SRR-22 | 候选 linux/amd64 单副本 Helm 环境完成 30 表发布→恢复→链式恢复、中断重试和索引验证；区分本机 Compose 证据与客户验收，未满足环境时记 blocked_delivery | 未执行 |
| SRR-23 | 共享临界区与目录级变更互斥。批量发布与手动 reindex 的锁按 §5.2.1 盖住终态核验、终态审计、`published` 与 journal 终结，实施不得把 `3b7e8d32` 的释放点提前。`semantic_restore` 锁同样盖到自身终态之后才释放。提交前重读基线，并拒绝与 `promoting`／`reindexing`／`terminalAuditPending=true` 的批次重叠。并发注入覆盖：恢复与批量发布、手动 reindex、YAML 导入、删除语义文件的 Schema／连接删除、以及 `applyConnectionIdChange`。连接 ID 变更与语义发布／整批恢复互斥，变更期间给出可读原因，变更前后重核路径集合；变更不产生恢复写集、不是恢复来源 | 未执行 |
| SRR-24 | 两种布局分别验证：正常布局下**恢复写集**与**镜像同步写集**分离成立——恢复写集进 journal 且可逆，镜像同步写集不进 journal 且变化方向为镜像向内容根对齐；**遗留布局 `LUCY_CONTENT_ROOT=.` 下双面退化为单面**：journal 不重复登记同一路径、受控镜像写入／删除不重复执行、回读只做一次且结论一致、CAS 强度不被放宽；**发布记录保留保护**——被未过期幂等记录引用的 release 不因侧车 100 条截断被淘汰，幂等过期后解除保护 | 未执行 |

### 10.2 完成判定

SRR-01–SRR-24 是功能实现的必要验收，SRR-22 是客户交付证据维度；环境未解锁时不得以本机结果替代，也不得宣称客户交付通过。恢复冲突零写入、故障不虚报成功、历史不可改写和快照不可伪造为 P0 必达项；**恢复日志终结时机、删除方向语义读回、`terminalAuditPending` 结算、恢复写集与镜像同步写集分离**为 v0.5 新增的 P0 必达项。本 Spec 不新增当前 v2.0 发布门禁，后续实施与客户发布分别沿用当时已批准的门禁。

## 11. 实施依赖、风险与评审重点

实施顺序和文件落点见独立 Plan。关键依赖为 L25-11 的共享发布协调器、统一校验、CAS、幂等、恢复日志、发布记录和审计；若实施时这些合同与当前代码有偏差，应先记录并评审，不得在本功能中静默改变其语义。

重点风险：

1. **快照覆盖不全**：只在批量导入接线会留下单表或 Manifest 盲区，S1 必须做写入口清单和覆盖测试。
2. **把故障日志当历史**：日志清理或状态变化不能决定长期快照可用性。
3. **恢复覆盖后续工作**：必须按来源批次发布后 digest 做全目标 CAS，不只检查计划中的差异项。
4. **全局索引副作用被隐藏**：完整范围不可知时必须阻断，预检须与提交使用同一范围合同。
5. **存储无限增长或清理竞态**：固定三上限，活跃引用和容量不足必须可验证。
6. **状态虚报**：文件恢复、索引成功和 Agent 生效分别记录，恢复包导出和预览不构成发布效果。

产品语义、保留参数、API、权限和 SRR 矩阵的定稿结论见 §11.8。S1–S6 的设计门禁已关闭。S7、浏览器验证、镜像构建与客户交付仍须单独授权。

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

### 11.3 独立审阅发现与处置（2026-10-28）

2026-10-28 按 Forrest 授权，由本机 Codex（`codex-local`，read-only sandbox，approval-policy=never）对 v0.4 的 Spec 与 Plan 做对抗式设计审阅，MiniMax Code 对全部 10 条发现逐条回查源码独立核实，结论为「退回修订」：**4 项阻塞、4 项高、1 项中、1 项低**。完整报告见 [独立审阅报告](../reviews/2026-10-28-codex-review-l25-15-semantic-release-restore.md)。

审阅确认 L25-15 的**产品语义本身成立**（恢复语义、可恢复状态、30 分钟预览、24 小时幂等、保留三上限、只读恢复包），退回针对的是规范文本内部矛盾、与现有代码事实不符、以及新增条款未贯穿到执行流程与验收矩阵。v0.5 作如下处置；本轮仍未修改运行代码或执行功能测试。

| 审阅发现 | 严重性 | v0.5 处置 |
|---|---|---|
| R01 Spec 错述现有 journal 生命周期，伪代码把提前终结写成规范流程 | 阻塞 | **采纳。** 纠正 §1.2 现状描述为「文件已保存、索引／终结结果待确认」阶段且**不关闭日志**；新增 §5.4 条款明确日志只有在索引、最终 digest、终态审计与 release 状态均可核对后才终结；伪代码改为写盘后 `completeFailureRecoveryJournalFilesSavedNotClosed`，索引失败 `keepRecoveryJournalOpenForIndexRetry`，终结步骤之后才 `completeFailureRecoveryJournalButRetainLongTermSnapshot`。与 L25-11 §7.2「不能提前 completed」对齐 |
| R02 全量 upsert 写计划外文件，与「不修改无关文件」冲突 | 阻塞 | **采纳。** §2.3 重构为两个独立概念：**恢复写集**（本功能负责，进 CAS／journal／失败回滚）与**镜像同步写集**（既有漂移，由全量 upsert 复制，不进 journal）；「不修改无关文件」精确化为「内容根侧不变；镜像侧仅镜像同步写集内变化且方向为镜像向内容根对齐」。预检新增镜像同步写集披露；§5.2 第 8 步显式执行全量 upsert 并核对与预检一致；SRR-03／09 断言相应精确化 |
| R03 删除恢复同时被要求强制重建和增量索引，缺负向读回 | 阻塞 | **采纳。** 新增 §5.5 统一四种情形的索引模式（普通恢复=增量、含删除=强制重建、重试沿用、启动续跑沿用），模式持久化在 release 记录并进入 `planDigest`；新增**删除方向语义读回**义务：被删表在 Agent 读取面必须不可检索／不可读取，失败记 `reindex_failed / unconfirmed`；Plan 增补 force 分支；SRR-04／16／17 增补子断言 |
| R04 终态审计协议被引用但未定义，pending 成功记录被启动流程漏掉 | 阻塞 | **采纳。** 新增 §8.1 定义终态审计可恢复协议：审计落库→release 终态更新两步顺序、`terminalAuditPending` 语义、**公开投影一律显示「生效待确认」且必须服务端统一实现**、审计事件唯一身份 `releaseId + attemptId + "terminal"` 防重复追加、三条启动对账结算规则；启动伪代码新增 `readAllReleasesWithTerminalAuditPending()` 结算循环；§4.3 引用改为 §8.1；SRR-16／18 增补子断言 |
| R05 「重试索引」不是现有接口已提供的能力 | 高 | **采纳。** 新增 §5.6 定义恢复批次自身的索引重试链路：绑定原 releaseId 与新 attemptId、不重复恢复写盘、不用纯手动 reindex 代替、范围变化须重新预检、使用新幂等键、保留原失败 attempt、沿用 §5.5 索引模式；SRR-17 增补 |
| R06 100 条 release 保留与 24h 幂等重放无共同保留合同 | 高 | **采纳。** §4.2 增加发布记录保留与幂等重放的依赖条款：侧车 100 条截断必须保留被未过期幂等记录引用的 release；随幂等过期解除；列表展示仍限 100 条；§5.3 交叉引用；SRR-24 增补断言 |
| R07 幂等查询置于排他锁之后，进行中重放不可达 | 高 | **采纳。** §5.3 增加「幂等查询的时序」条款；伪代码把只读幂等查询**前移到取锁之前**（鉴权与恢复准入 → 只读查询 → 取锁 → 锁内二次核验）；§5.2 相应调整；SRR-13 增补断言 |
| R08 既有共享路径实际在终结前释放锁，Plan 未处理该复用偏差 | 高 | **采纳（登记为显式依赖而非顺带修复）。** 新增 §5.2.1 专节登记该偏差：既有批量发布与手动 reindex 在 reindex 返回后即释放锁，与 L25-11 §7.2 合同不符；本功能**不**顺带修改 L25-11 语义，但必须在 S0 产出显式偏差清单并二选一裁决——列为开工前置单独授权修复，或在本功能内显式阻断该交错窗口；~~未裁决不得进入 S1~~（**v0.9 已由 PM 裁定取 (a)，该阻塞项解除**，见 §11.7）；新增 SRR-23 承载并发注入证据 |
| R09 v0.4 的目录重命名互斥与遗留布局去重无 Plan／验收落点 | 中 | **采纳。** §2.2 把连接 ID 目录重命名的互斥要求展开为可执行条款（纳入共享发布互斥或恢复期间显式阻断、路径 CAS 与范围复核、不产生恢复写集、不作为恢复来源）；遗留布局 `LUCY_CONTENT_ROOT=.` 的单面退化补「不重复登记、不重复执行、回读一次、CAS 强度不放宽」；新增 SRR-23／24 承载 |
| R10 §11.3 悬空引用与 Plan S0 版本漂移 | 低 | **采纳。** 补本节作为 v0.4／v0.5 的真实处置记录，使修订依据可追溯；Plan S0 的输入版本同步改为 v0.5 |

**v0.4 处置记录的补记**：v0.4 修订（删除后强制索引重建与读回、reindex 前全量 upsert 范围、可恢复终态审计协议、校验作用域、目录级重命名、差异快照、遗留布局）此前**没有任何处置记录**——本节即为其处置依据。这七项能力此前只写入目标声明，未贯穿规范流程、Plan 任务与 SRR 断言；本轮发现 R02、R03、R04、R09 正是该缺口的直接体现。v0.5 已逐项补齐落点。

**v0.5 未改变的产品语义**：恢复语义、来源资格、批次界定、整批 CAS、恢复生成新批次、30 分钟预览、24 小时幂等、20 批／30 天／512 MiB 保留、只读恢复包、无 force overwrite、无历史上传，均与 v0.4 一致。本次修订不改变首期范围。

### 11.4 终审发现与处置（2026-10-28）

v0.5 完成后再次由本机 Codex 做独立终审（read-only sandbox，approval-policy=never），MiniMax Code 逐条回查源码核实。终审判定 **R01–R10 中 4 条已闭合、6 条部分闭合**，并新增 3 项发现；结论为「仍需修订」，尚不具备开发基线条件。终审确认 **S0 的冻结清单、锁偏差裁决与阶段授权已正确表述为待办，S0 尚未执行本身不计为缺陷**。

v0.6 作如下处置；本轮仍未修改运行代码或执行功能测试。

| 终审发现 | 原严重性 | v0.6 处置 |
|---|---|---|
| R01 伪代码仍先标记幂等 applied／reindexing 再标记 files-saved，与源码顺序不一致且该标记在失败处理块之外；§4.3 续跑条件仍以「journal 已完成」描述 | 阻塞 | **采纳。** 伪代码把 `completeFailureRecoveryJournalFilesSavedNotClosed` 前移至 `markIdempotencyApplied` 与 `persistExistingRelease(reindexing)` **之前**并纳入失败处理块；§4.3 续跑条件改为「journal 已推进到文件已保存／索引待确认阶段（**不是**已终结）」，并补明 journal 停在 `write_in_progress` 时必须先按实际字节判定、不得当作「文件已保存」直接续跑索引 |
| R02 §2.3 镜像侧「允许变化集合」只写了镜像同步写集，遗漏恢复写集自身的受控镜像目标；且漂移核对晚于全量 upsert 副作用，未披露漂移已写入时无法证明已消除 | 阻塞 | **采纳。** §2.3 把镜像侧允许变化集合改为**并集**：`恢复写集的受控镜像目标 ∪ 已确认的镜像同步写集`，两类变化方向不同且可分别核对；§5.2 第 8 步改为**先核验漂移集合、出现未披露漂移立即阻断、upsert 只复制已核验集合内的文件**；伪代码相应增 `requireDriftSetMatchesPreviewOrBlockBeforeUpsert` 与 `requireNoOtherMirrorFilesChanged`；SRR-09 断言同步改为并集表述 |
| R03 新增读回断言把「删除一个文件」统一解释为「整张表消失」，未区分 overlay 与 Manifest | 阻塞 | **采纳。** §5.5 语义读回改为按双层合并模型逐目标判定——删除 overlay 断言**业务扩展不可见但表结构仍可见**，删除 Manifest 中表才断言**整表不可检索／不可读取**；读回预期由恢复计划推导并持久化；SRR-04 断言同步分类；Plan S0 新增第 10 条冻结该预期模型 |
| R04 §8.1 自身顺序矛盾：步骤 1–3 规定「先审计后更新 release」，而 pending 定义又假定「内部已写 published 但审计未落库」；§4.3 扫描 pending 的 published 与 §8.1 的 pending reindex_failed 不一致 | 阻塞 | **采纳。** §8.1 重写为**单一权威顺序**：先落终态审计（守卫检查的是审计载荷 `payload.recovery.activationStatus`，不读磁盘 release），后更新 release 终态；`terminalAuditPending` 的**唯一设置点**改为「release 已写 published/confirmed 但终态审计写入失败或未核对」；补两个失败分支（落审计失败 → reindex_failed/unconfirmed/pending；清 pending 失败 → 启动对账只补 release 终态不重复追加审计）；§4.3 扫描范围改为「`terminalAuditPending=true` 的记录」，不再限定 published；启动伪代码结算规则同步 |
| R05 索引重试「范围变化需重新预检」与内容恢复预检冲突（对原来源预检会 CAS 冲突，对新批次预检等于构建反向恢复）；且 `reindexProject` 内部的 `prepareSemanticLayerForKtx` 会全量同步，与「不重新执行镜像写入」冲突 | 高 | **采纳。** §5.6 表格新增两行：**范围确认**——建立**独立于内容恢复预检**的索引范围确认对象（绑定 releaseId、实际扫描集合、镜像同步写集、reindexMode），范围一致才允许重试；**镜像副作用**——重试前须核验当前漂移集合与该 release 记录一致，或改走只针对已核验集合的受控同步路径，不一致时阻断并要求重新确认；Plan S0 新增第 11 条冻结该确认对象契约 |
| R06 发布记录保留保护 | 高 | **已闭合**，本轮无残留。 |
| R07 锁内二次核验遗漏 `failed` 分支与恢复阻断复查；锁外 `intent` 分支可能执行结清等写操作 | 高 | **采纳。** §5.3 新增「锁外查询严格只读」条款（锁外不得结清、修复或改状态）；伪代码锁内分支补齐 `failed` 且零写入未证明 → recoveryRequired、`failed` 且零写入已证明 → 允许同键同计划新 attempt，并**重新执行恢复准入检查** |
| R08 锁生命周期偏差 | 高 | **已闭合**（已转为 S0 开工前置 + SRR-23 并发注入义务），本轮仅发现编号误指，见 N03。 |
| R09 目录重命名与遗留布局 | 中 | **已闭合**，本轮无残留。 |
| R10 版本漂移 | 低 | **已闭合**，本轮无残留。 |
| N01 删除读回断言扩大为整张表消失 | 高 | **已并入 R03 处置**，见上。 |
| N02 SRR-16／SRR-18 缺新增义务的子断言 | 中 | **采纳。** SRR-16 补「启动续跑沿用持久化 reindexMode、含删除目标续跑仍走强制重建并完成删除方向读回、journal 停在 write_in_progress 时先按实际字节判定」；SRR-18 补「终态审计唯一身份防重复追加」与「pending 记录在列表／详情／状态 API／CSV／筛选计数一律显示生效待确认」。 |
| N03 §5.2.1 并发注入证据误指 SRR-24 | 低 | **采纳。** 改为 SRR-23。 |

**v0.6 未改变的产品语义**：与 v0.5 一致。本次修订只消除规范内部矛盾、补齐子断言与明确待办边界，不改变首期范围、不新增功能。

### 11.5 复审发现与处置（2026-10-28）

v0.6 完成后再次由本机 Codex 做独立复审，MiniMax Code 逐条回查源码核实。复审判定 **R01 已闭合；R02／R03／R05／R07／R10 部分闭合；R06／R08／R09 已闭合且无回归；N02／N03 已闭合**，并新增 F01（高）／F02（高）。结论为「仍需修订」。复审同时确认 **S0 的写入口冻结、锁偏差裁决、读回预期模型、索引重试确认对象与阶段授权均已正确列为待办，S0 尚未执行本身不计为缺陷**。

v0.7 作如下处置；本轮仍未修改运行代码或执行功能测试。

| 复审发现 | 原严重性 | v0.7 处置 |
|---|---|---|
| R04 §8.1 正文保留两套互斥顺序（先置 pending → 落审计 → 清 pending，与先落审计 → 更新 release），pending 设置点不唯一，失败分支引用旧步骤；Plan 复制了同一冲突 | 阻塞 | **采纳（v0.7 部分修正，v0.8 完成收敛）。** 明确依据：审计守卫检查的是**审计载荷**的 `payload.recovery.activationStatus`，**不读磁盘 release**，因此不需要「为满足守卫先写内部成功记录」。v0.8 最终收敛为唯一四步顺序：落终态审计 → 写 release 终态并置 pending → 核对审计并清 pending → 终结 journal；`terminalAuditPending` 具备唯一含义、唯一设置点与唯一清除点。§8.1 声明自身为唯一权威定义，其他章节只引用不另定义；Plan S2 第 14 项同步 |
| R03／N01 Manifest 原地回写删表没有可执行的读回触发路径：模式仍按「至少一个目标恢复为 absent」判定，而该场景文件是 restore 不是 absent，却受「整表不可检索」约束 | 阻塞 | **采纳。** §5.5 引入**语义删除集合**：由恢复前后**合并模型差异**推导（比较 Manifest 表集合与 overlay 集合），得��在恢复后不再存在于合并模型中的表。新增「Manifest 内删表」类型（文件原地回写移除某表，文件仍为 restore）；模式判定与强制重建、读回触发**一律以语义删除集合为准**，不再只统计 absent 目标。读回断言改为「语义删除集合中的表才断言整表不可检索／不可读取」。SRR-04 同步；Plan S0 第 10 条与 S2 第 12 项同步 |
| R02 漂移核验只覆盖显式 upsert，未贯穿索引前 `prepareSemanticLayerForKtx` 的全量同步、清理与历史迁移，也未覆盖启动恢复的 `syncRuntimeMirror` | 高 | **采纳。** §5.2 新增第 9 步：**所有触发镜像同步的内部调用必须走受控路径**——索引前准备步骤与启动恢复的 runtime mirror 同步内部均执行无参全量同步，并含垃圾清理与历史目录迁移（rename／rm）；恢复流程不得直接依赖这些全量同步，必须使用只针对已核验集合的受控变体，或在调用前完成同样核验并断言未超出该集合。清理与迁移被明确为**独立于恢复写集的平台行为**，须在恢复前完成并纳入范围复核。Plan S0 新增第 12 条冻结该口径 |
| R05 「不重新执行镜像写入」与「允许对已核验集合走受控同步」边界笼统；SRR-17 缺独立确认对象与内部 prepare 先写后查的子断言 | 中 | **采纳。** §5.6 镜像写入行改为：**不重复**恢复写集的内容根写入，也**不重复**对恢复写集的镜像目标执行写入／删除；镜像同步写集方向的全量同步**不属于**「重复恢复写盘」，但仍受「镜像副作用」行的核验约束。SRR-17 补三条子断言：索引重试使用**独立的范围确认对象**且不触发正向／反向内容恢复、范围变化须重新确认而非重新恢复、**重试前内部 prepare 的镜像同步不得超出已核验集合，未确认漂移时零镜像写入** |
| R07 锁外 `intent` 分支无条件返回 reconciliation helper，而该 helper 需执行结清——与「锁外只读」冲突；需要结算的 intent 没有转入锁内的路径 | 高 | **采纳。** 伪代码锁外 `intent` 分支改为**只读分流**：先 `readIntentProgressWithoutMutation` 判断是否仍在真实进行中，是则直接返回其状态；否则**继续取锁**，在锁内执行对账与结清。锁内 `intent` 分支补齐结清后的流转：确认 promote_failed 且零写入已证明 → 幂等结清 failed → 允许同键同计划新 attempt；否则 recoveryRequired。Plan S2 第 9 项同步 |
| F01 幂等 intent 持久化失败落在写前结清块之外，遗留 promoting 记录无本次调用内的明确结算路径 | 高 | **采纳。** 伪代码把 `persistPromotingReleaseOrFail` 与 `persistIdempotentIntentOrFail` 一并移入写前 `try` 块，与快照、journal、受理审计同层；`catch prewriteFailure` 改为 `settlePreWriteFailureByWhatWasPersisted(newReleaseId, attemptId)`，**按已成功持久化的对象分别结算**，结算本身再失败时**持久保留恢复准入义务**（recoveryRequired），不得留下无主 promoting 记录，也不得只依赖重启清理。Plan S2 第 10 项同步 |
| F02 release 成功之后、journal 关闭之前的崩溃缺少启动结算分支（release=published/confirmed/pending=false 但 journal 未终结，两个扫描集合都不覆盖） | 高 | **采纳。** §8.1 启动对账扩展为**三类记录**：`terminalAuditPending=true`、**终态审计已落库但 release 未到 published**、**release 已 published 但关联 journal 未终结**。第三类的结算规则为**只补 journal 终结**，不改写 release 终态、不重复追加成功审计；证据不可核对则置 recoveryRequired 并阻断。启动伪代码新增两条对应循环；§4.3 启动扫描范围同步；SRR-16 补两个精确断点子断言 |
| R10 Plan S0 仍以 v0.5 主 Spec 为输入与裁决对象（版本漂移回归） | 低 | **采纳。** Plan S0 第 1 条与第 5 条同步为 v0.7。 |
| R01／N02／N03／R06／R08／R09 | — | 复审判定已闭合，本轮**无回归**；对应子断言保持。 |

**v0.7 未改变的产品语义**：与 v0.5、v0.6 一致。本次修订只消除规范内部矛盾、补齐子断言与明确待办边界，不改变首期范围、不新增功能。

### 11.6 最终复审发现与处置（2026-10-28）

v0.7 完成后第三次由本机 Codex 做独立复审，MiniMax Code 逐条回查源码核实。复审判定 **9 组已闭合、5 组部分闭合（R04／R03+N01 仍为阻塞，R02 为高，F01 为中，R10 已闭合）**，并新增 G01（高）／G02（高）／G03（低）。结论仍为「仍需修订」。复审再次确认 **S0 各项开工条件均已正确列为待办，S0 尚未执行本身不计为缺陷**。

v0.8 作如下处置；本轮仍未修改运行代码或执行功能测试。

| 最终复审发现 | 原严重性 | v0.8 处置 |
|---|---|---|
| R04 §8.1 仍并存两套顺序：步骤 2 一次写 pending=false，而「设置点」条款又要求步骤 2 之前置 pending=true 并「清 pending」；§4.3 字段定义仍保留「为满足审计守卫而先写 published」的旧解释 | 阻塞 | **采纳。** §8.1 **重写为唯一四步顺序**：落终态审计 → 写 release 终态并置 pending → 核对审计并清 pending → 终结 journal。`terminalAuditPending` 收敛为**唯一含义（终态审计尚未被核对）、唯一设置点（步骤 2，与 published 同一次写入）、唯一清除点（步骤 3）**，删除了「先写 pending 再写 published」这类额外成功状态写入。§4.3 字段定义同步改写，删除旧解释。步骤 1 失败时明确 release 不得写 published/confirmed，转入 F 类阻断与重试判定 |
| R03／N01 伪代码与 Plan 仍按「是否含删除目标」判定模式（未消费语义删除集合）；§5.5 表格把「删除 overlay 文件」归为表消失，与读回预期「表结构仍可见」矛盾；读回伪代码只读 `deletedTargetIdentities` 未接入分类预期 | 阻塞 | **采纳（v0.7 部分修正，v0.8 完成收敛）。** 伪代码改为 `deriveSemanticDeletionSetFromMergedModelDiff(...)` 后判定模式；§5.5 表格把 overlay 删除单列为「**不构成表消失**」并注明其扩展不可见读回仍须执行；读回伪代码改为消费**持久化的分类预期**（`rebuilt.semanticDeletionSet` + `rebuilt.readbackExpectations`），并把读回义务扩展到**所有存在删除类目标的恢复**（不限强制重建场景）。Plan S2 第 5 项同步 |
| R02 受控镜像路径未贯穿三处落点：Plan 只给索引重试 prepare 明确任务，启动对账任务与 SRR-09／24 未列内部 prepare、runtime mirror、迁移／清理的子断言与执行时点 | 高 | **采纳。** Plan S4 第 7 项补「启动恢复路径中的 runtime mirror 同步必须同样走受控镜像集合」「垃圾清理与历史目录迁移须在恢复前完成并纳入范围复核」；SRR-09 补「索引前内部 prepare 的全量同步、启动恢复的 runtime mirror 同步、垃圾清理与历史目录迁移（含 rename／rm）都必须走受控路径，不得超出已核验镜像集合，且清理与迁移须在恢复前完成并纳入范围复核」；SRR-24 同源断言 |
| F01 写前失败结算缺验收断言：SRR-13／15／16 未要求验证「本次调用内、不依赖重启」的分别结清与「结清再失败时恢复准入义务仍持久存在」 | 中 | **采纳。** SRR-16 补两条子断言：promoting 或 intent 持久化异常时必须在本次调用内、不依赖重启地按已持久化对象分别结清；结清本身再次失败时恢复准入义务仍持久存在。规范流程与 Plan S2 第 10 项已在 v0.7 修正，本轮补齐验收侧 |
| G01 终态审计写入失败产生的 `reindex_failed / unconfirmed / pending=false / recoveryRequired=true` 状态未被任何启动扫描集合覆盖，「进入启动对账」只有声明没有入口 | 高 | **采纳。** §8.1 启动对账改为**六类互斥分类**，其中 **F 类＝`recoveryRequired=true` 的失败记录（含步骤 1 落审计失败）**：保持阻断，证据可核对时允许走 §5.6 重试路径，否则维持失败关闭；该分支**不得**自行产生新的索引调用，除非明确转入重试流程。§4.3 启动扫描范围同步纳入 F 类 |
| G02 新增的终态补写循环排在通用 reindexing 续跑循环之后，两者集合重叠，同一 release 可能被「先重跑索引再补终态」处理 | 高 | **采纳。** 启动伪代码由四个独立循环改为**单一互斥分类循环**：先 `classifyByTerminalEvidenceAndJournalPhase(release)` 得到 A–F 之一，再按类别处置。**分类互斥且有优先级：A／B／C 补写类先于 D 索引续跑类；一旦归入补写类即不得再进入 D**，从而保证「只补 release 终态／只补 journal 终结」不被索引续跑越过。SRR-16 补「补写类记录不得产生新的索引调用」 |
| G03 Plan 状态行仍写「修订至 v0.6，待复审」，与头部 v0.7 不一致 | 低 | **采纳。** Plan 状态行同步至 v0.8 本轮状态，保留「暂不开发」与授权边界。 |
| R01／R05／R06／R07／R08／R09／R10／N02／N03 | — | 复审判定已闭合，本轮**无回归**。 |

**v0.8 未改变的产品语义**：与 v0.5–v0.7 一致。本次修订只消除规范内部矛盾、补齐子断言与明确待办边界，不改变首期范围、不新增功能。

### 11.7 PM 裁定更新：锁生命周期偏差取 (a)（2026-10-29）

PM 于 2026-10-29 签核 [决策纸](../reviews/2026-10-29-l25-16-pm-decision-sheet-d7-d8-g34.md)（提交 `fc72a7b9`），对 §5.2.1 登记的锁生命周期偏差作出裁定：**取 (a) 单独立项修既有路径**。

裁定落地要求（原文口径）：

1. 锁生命周期须覆盖 `verifyFinalTargetDigests`（终态核验）与 `recordConfigChange({ change_type: "semantic_publish_terminal" })`（终态审计），与 **L25-11 §7.2** 对齐；
2. `semantic-assets.ts` 中那条已不成立的注释「persisted INSIDE the same critical section」须一并更正（锁在 reindex 返回即释放，终态复核也在锁外）；
3. **修复动作不在 L25-15 之内，须另立工作项**（含编号、owner、排期），**不在本功能的开工前置里等它**；
4. 该工作项牵动 **L25-11 已落地的生产接线**⇒ 须同步评估 L25-11 的验收矩阵与回归范围，并**与 L25-11 维护方协调**；
5. 该事实在 L25-16 Spec 登记为 **G31（L25-11 依赖）**；G31 现在有了裁定方向，但**工作项尚未建立**——建谁、归谁、排期需与 L25-11 维护方或 PM 敲定。

**外部工作项的当前状态（2026-10-29 PM 后续决定）：挂起。** PM 于同日决定**暂不设 L25-11 owner 会话**，**G30／G31 与本节这条外部工作项一并挂起**；编号仍为待定，且**不是"只差一个编号"，而是无 owner、无法推进**。**恢复条件**：PM 重新指派 L25-11 owner（或授权复审）。该决定**不影响本功能的开工**（开工前置已解除），但使外部修复在可预见期内不会落地。

**对本 Spec 的影响（v0.10 修订）**：

- **开工不受影响**：开工前置已于前一裁解除，外部工作项从来不在开工前置里等待；挂起不改变这一点。
- **交付不依赖它**：本功能的交付判定**不得**以 G31 关闭或该工作项落地为前提；外部修复挂起期间，它**不提供任何保障**。
- **恢复路径自身的保障必须自足**：`semantic_restore` 锁持有到终态、基线复核与重叠拒绝三条**是本功能在此问题上的唯一保障**，不得视为"外部修复落地前的临时替代"，也不得依赖外部工作项日后补齐。
- **协调动作无法在本功能内推进**：与 L25-11 维护方协调验收矩阵与回归范围，因"暂不设 owner"而**无人承接**，只能作为已知依赖登记，不得列为本功能可完成的动作。
- §10.1 SRR-23 的断言相应更新为：恢复锁持有到终态且不复用既有提前释放点；既有偏差登记为**已挂起**的外部依赖且不得作为交付前提；本功能另以基线复核与重叠拒绝阻断交错窗口，**该机制须自足**，并有并发注入证据。

**v0.10 未改变的产品语义**：与 v0.5–v0.9 一致。本次修订只更新外部工作项依赖的**状态精度**（挂起）与由此产生的一条自足性约束，不改变首期范围、不新增功能、不改变验收矩阵的条数与编号。

**v0.11 对本节的事实更新**：本节写下时，锁在 reindex 返回后释放。提交 `3b7e8d32` 已把该窗口盖住。现行约束以 §5.2.1 为准；本节保留 2026-10-29 的裁定过程。

### 11.8 第 4 轮复核与可交付开发定稿（2026-10-30）

用户要求把 Spec 与 Plan 收到可以交付落地的定稿。复核记录见 [2026-10-30 第 4 轮复核](../reviews/2026-10-30-l25-15-implementation-ready-review.md)。

| 发现 | 处置 |
|---|---|
| B1 锁偏差描述与 `3b7e8d32` 之后的源码相反 | 采纳。§5.2.1、SRR-23 改为现行锁顺序；释放点不得提前 |
| B2 写入口清单未冻结，漏掉语义文件删除，且 YAML 导入与连接 ID 变更在窗口外 | 采纳。§2.2 冻结清单；SRR-01／SRR-07 补入删除与路径变更 |
| L1 状态行仍写 v0.9 | 采纳。状态行改为 v0.11 |
| L2 Plan 启动对账被收窄 | 采纳。Plan S2 第 16 步改回 §8.1 六类分类 |

**定稿结论**：产品语义不变。S1–S6 可按 Plan 开工。本修订不改运行代码。SRR-01–SRR-24 全部未执行，设计定稿不产生验收证据。S7、浏览器验证、镜像构建、部署与客户交付仍须单独授权。

**三轮审阅的共同结论**：三轮审阅发现的不是「设计想错了」，而是**同一种工程缺陷的反复出现**——新增机制写进了声明，却未同时落到规范流程、Plan 任务与 SRR 断言，或三者内容不相容。v0.4 首次暴露该模式，v0.5 修掉 4 条却仍有 6 条部分闭合，v0.6 修掉大部分后复审仍发现 2 阻塞。**根因是逐条修补而非按「落点三处齐全且相容」的系统性检查**。v0.7 已按该标准逐条复核：每个新增机制都必须同时具备规范流程落点、Plan 任务落点与 SRR 断言落点，且三者内容相容。

**v0.5 修订的验收结论**：终审确认 v0.5 的 11 项新增机制中，**4 项三处齐全**（发布记录保留保护、锁偏差裁决、目录 rename、遗留布局退化），**7 项仍存在子断言缺口或流程相容性问题**（已在 v0.6 逐条修正）。这再次印证 v0.4 的失败模式：**新增能力必须同时落到规范流程、Plan 任务与 SRR 断言，且三者内容必须相容而非仅关键词齐全**。

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
