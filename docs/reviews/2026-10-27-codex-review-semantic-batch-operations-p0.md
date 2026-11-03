# Lucy v0.25 P0-3 语义资产批量维护独立审阅

## 结论：退回

PM 授权的 UAT 前静态审阅，日期为 2026-10-27（Asia/Shanghai）。审阅范围为 L25-11 完整闭环与 V01–V22；发现 **1 项阻塞、5 项高、2 项中、0 项低**。退回当前以“完整闭环已实现”为口径的设计交付材料；现有代码不足以支撑完整 UAT。这不撤销既有需求签核，也不建议降低冻结合同。

Spec 已明确 30 表旅程、精确身份、整批阻断、三类校验结论及 Wave 0b 条件，整体设计方向成立。但新建的范围、维护包、校验任务、幂等模块尚未接通生产 API 与页面；生产发布的 CAS、恢复终结及协调器临界区仍不满足正文。因此不能仅把差距归为“等待真实验收”。应先补齐实现与状态说明，再安排完整 UAT。

### 审阅基线与限制

- 设计：[Spec](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md)，当前工作树版本；章节、行号均以本次读取版本为准。
- 指定实施提交：`21de5168f3ab9160402b613a39f6b635eb347f31`；另静态比对当前 HEAD `7382bac4b57116d8260b605c0a4a4d196bf9d7d4`，区分后续修复，代码链接默认指当前 HEAD。明确标注 `21de5168:` 的行号指历史版本。
- 依据：[开发治理](../governance/DEVELOPMENT.md)、[实施计划 §6、§9、§11](../plans/2026-10-25-lucy-v0.25-p0-implementation-plan.md#L207)、P0-2 合同、生产调用链及既有测试源码。测试存在不等于已经执行，也不等于覆盖整个验收项。
- 本轮没有运行功能测试、浏览器、real-e2e、KTX 命令或构建，没有连接数据库、运行实例或客户环境；不新增运行证据。
- 本轮仅创建本报告、更新 `docs/README.md` 对应条目。Spec 正文和 V01–V22 状态不修改；原工作树中已有的 README 改动及未跟踪 `config/` 保留。

## 逐项检查表

下表“静态判断”只评价合同和证据衔接，不是测试结果。**正式验收状态全部仍为未执行**。

| 编号 | 静态判断与后续必须核对的断言 | 正式状态 |
|---|---|---|
| V01 | §3.1、§4 定义完整三元身份与歧义阻断，口径明确；身份单元用例存在，但旧导出仍按路径筛 Schema，新身份服务未接入往返。见 B01 | 未执行 |
| V02 | 跨页全选、筛选清空、未启用表不自动开放均明确；Catalog 尚缺本闭环多选与动作。见 B01 | 未执行 |
| V03 | 30 表主旅程、未选文件 hash、Lucy Proxy Agent 证据明确；生产闭环未接通。Agent 级证据受 Wave 0b 约束，不能由本机替代。见 B01 | 未执行 |
| V04 | 共享文件影响面、跨连接依赖、只读依赖和缺失阻断有正文及伪代码支持；须通过生产导出/导入证明，不能只验 helper。见 B01、H04 | 未执行 |
| V05 | 29 正确 + 1 YAML/引用/类型错误的整批阻断可执行；须固定正式目录、运行镜像和索引前后证据；HTTP 错形 entry 当前会被过滤。见 H05、M01 | 未执行 |
| V06 | §5 与 §9 明确原包/空模板无变化不发布、不索引；生产路径尚未接入候选去重及 `no_change`。现有 real-e2e 标签不能证明该项。见 B01、M01 | 未执行 |
| V07 | 只读修改、改绑、异实例、过期、未知目标覆盖常见误操作；还须明确角色篡改、删 entry 同时删文件等服务端基线对照。见 H04 | 未执行 |
| V08 | 目标/依赖并发变更、absent→存在、旧确认失效要求完整；生产 API 没有接入基线 CAS 与 `planDigest`。见 H01 | 未执行 |
| V09 | 穿越、绝对路径、链接、重复、未知 entry、炸弹、嵌套包的设计边界明确；须从实际 HTTP 入口验证，不能以新解包 helper 的测试替代。历史 D-19 与当前修复须分开。见 B01、M01 | 未执行 |
| V10 | 各限额及 +1、自检往返明确；生产仍有 50 YAML/3 MiB 常量，新共享限额未贯通。见 B01 | 未执行 |
| V11 | 合法性 verdict 与实库证据分离明确；超时执行项 failed、未调度项 not_run，计数守恒。helper 有用例，提交/任务 API 尚未复用。见 B01 | 未执行 |
| V12 | §3.2 与 §9 明确全局待同步变更合并、统一校验、计划变化后重确认；当前工作台仅处理既有磁盘变更，未接入候选批次与计划摘要。见 B01、H01 | 未执行 |
| V13 | 同键同 releaseId、一次写入/索引、异计划冲突和 ≥24h 保留明确；存储 helper 不等于 HTTP 重试闭环。见 H01 | 未执行 |
| V14 | rename、镜像、审计失败及恢复失败拦截可据 §7.2 验收；生产恢复日志过早完成、恢复镜像错误被吞、失败记录写入可阻断回滚。见 H02 | 未执行 |
| V15 | kill 边界、不猜 published、不覆盖第三方及保留恢复材料明确；启动顺序与未终结证据处理仍有缺口。见 H02 | 未执行 |
| V16 | 保存与生效分离、索引重试不重复 promote、范围变化重确认、失败 attempt 保留明确；生产仍按索引退出码写 published，重试关联合同未接通。见 H02、H03 | 未执行 |
| V17 | 会话、Agent Token、ID 归属、持续撤权均覆盖；新 scope/operation 尚无生产入口，不能以旧路由匿名拒绝推定新合同通过。见 B01、M01 | 未执行 |
| V18 | §6 明确合法性、完整度、执行证据三维；实库未要求使用独立 not_applicable，not_run 必阻断。JSON/CSV 及生产共享检查仍需完整证据 | 未执行 |
| V19 | 已定义解析内容根与受控镜像边界；需分别固定默认/定制/旧布局 fixture，包含恢复时镜像核验。见 H02 | 未执行 |
| V20 | 工作台无上传导出边界与既有页面一致；Catalog 多选、候选导入、返回后结果仍缺闭环。见 B01、M01 | 未执行 |
| V21 | 要求真实打包 KTX 与 CLI/单表/批量一致，Mock 不可替代；当前仅能确认共享检查模块存在，不能确认生产复用或 KTX 兼容 | 未执行 |
| V22 | 合成往返/中断恢复须在候选客户 linux/amd64、单副本标准 Helm 路径取证；§10.2 明确 Wave 0b 未解锁保持 blocked_delivery，本机 Compose 不替代 | 未执行 |

### 共享协调器与证据状态专项核对

- **文本一致性成立。** 本 Spec [§7.1–§7.2，L129–139](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L129)、[D4，L369](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L369) 与 P0-2 [核心流程，L350–370](../specs/lucy-20261022-v2p5-row-permission-management-spec.md#L350)、[D6，L538](../specs/lucy-20261022-v2p5-row-permission-management-spec.md#L538) 一致：单表、Manifest、批量、手动索引、角色/行策略保存共用单实例协调器；写入和生效串行，只读预览、独立校验可并行，提交时重核摘要。没有要求多副本或分布式锁。
- **入口持锁已有代码，完整临界区尚不成立。** 可见 `semantic-layer.ts:749`、`catalog-assets.ts:859`、`semantic-assets.ts:1945`、`index.ts:2150`、`admin/access-config.ts:233`，但 H03 说明终结记录仍越出窗口；不能从入口枚举直接推定全部合同成立。
- **三维结果定义成立。** [§6，L112–123](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L112)、V11/V18 及 `semantic-checks.ts:93–108、527–541` 明确阻止 failed/not_run/stale 提交；没有把描述完整当合法性，也没有把“未查询实库”混为必需检查未执行。
- **条件项声明完整。** [V03、V22 与 §10.2，L331–354](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L331) 联合明确 Agent/客户 amd64 证据依赖 Wave 0b，整批交付保持 `blocked_delivery`；无需在 V22 行重复关键词才能成立。本轮不声称依赖已解锁。
- **验收声明完整，但仍有标签误用风险。** 文件头 L8、§7.4 L161/L210、§10.1 L323 和矩阵 L329–350、§10.2 L354 均保留未执行约束。本轮未发现矩阵状态被改为通过。M01、M02 指出日后不得自动回填的来源。

## 发现的问题

### B01［阻塞］生产入口尚未串成 30 表闭环，“已实现”不能作为 UAT 准入事实

**Spec 定位：** [状态 L8、基线说明 L14](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L8)；[§3，L70–82](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L70)；[§8，L218–224](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L218)；[§10 V01–V06/V10–V12/V20](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L329)。

**代码事实：**

- 生产路由仍调用旧导出 `exportSemanticAssetPackage`，请求仅有 connection/Schema 和通用附件选项，没有 `scopeId/packageKind`（[index.ts:2214–2242](../../webui/server/index.ts#L2214)）；旧导出继续用 `includes` 路径匹配 Schema（[semantic-asset-export.ts:144–149](../../webui/server/semantic-asset-export.ts#L144)）。
- 静态检索全部 `webui/server`、`webui/src` 的非测试引用，新增 `semantic-scopes`、`semantic-maintenance-package`、`semantic-batch-tasks` 没有从生产路由接入；`semantic-checks` 仅被新任务模块引用。未发现 Spec 规定的 scopes/check/operations 路由注册。
- [Catalog.tsx:156–220、508–543](../../webui/src/pages/Catalog.tsx#L156) 仍为既有筛选/逐表入口；[PublishWorkbench.tsx:236–280](../../webui/src/pages/publish/PublishWorkbench.tsx#L236) 仍使用 `/api/diff`、`validate-changed`、手动 reindex，没有候选批次与完整计划确认请求。
- 旧导入仍使用 50 YAML/3 MiB（[semantic-assets.ts:266–270、1634–1637](../../webui/server/semantic-assets.ts#L266)）；`validateSemanticAssets` 保存全体 filePreviews，publish 遍历全体 snapshot.files，未接入 §9 的无变化候选剔除（同文件 L1880–1898、L2116–2127）。

**影响：** 模块级身份、包结构、计数或任务测试不能证明用户可以完成下载→修改→导入→工作台确认→生效；V06/V12 也不能由旧发布流程兜底。

**建议：** 保留现有正文合同，补齐 Plan D11–D15、D18–D23 的生产接线及对应接口类型。Spec 状态/实施回写应区分“基础模块已落地”和“完整闭环待实现”，列出尚缺入口和对应 V 编号，不能以 Wave 0b 为由掩盖本地实现缺口。本轮按授权仅更正索引状态。

### H01［高］CAS、覆盖确认与幂等仍未成为生产发布合同

**Spec 定位：** [§4 L87–91](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L87)、[§7.2 L139–144](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L139)、[N11 L169–186](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L169)、[§9 L284–296](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L284)，V08/V13。

**事实与后果：** [publish 请求类型 L241–243](../../webui/server/semantic-assets.ts#L241) 和 [HTTP L2017–2020](../../webui/server/index.ts#L2017) 只接收 `validationId/confirmOverwrite`；预检快照保存候选 hash，未保存原目标/依赖 CAS（[semantic-assets.ts:1880–1898](../../webui/server/semantic-assets.ts#L1880)）。发布时重读文件仅决定覆盖集合（L1963–1969），重跑合法性不等于确认原内容未变；每次另造 releaseId（L1958–1960），未调用持久幂等模块。预览后另一写者改变合法内容时，`confirmOverwrite=true` 仍可能覆盖较新内容；重试不能按冻结合同返回原 releaseId。

另有接线前必须处理的保留问题：[semantic-idempotency.ts:189–192](../../webui/server/semantic-idempotency.ts#L189) 按最多 500 条裁剪，未先确保被裁项已满 24h；高频写入可提前丢失仍有效键，不能仅凭 TTL 字段宣称“至少 24h”。

**建议：** 在同一协调器内构建并重核完整计划，包含依赖、目标 absent 和已确认覆盖集合；以 planDigest 验证确认。幂等意图须先于正式效果持久化，并在断线、重启及快照被消费后仍可找到原 releaseId。容量不足应拒绝新意图或扩容，不能提前淘汰有效键。Spec N11 已正确承认覆盖凭据待落地，实施状态必须据此修订；V13 增补跨重启及超过存储容量但未满 24h 的断言。

### H02［高］恢复证据没有覆盖镜像、索引和终结审计全生命周期

**Spec 定位：** [§7.2–§7.3 L144–157](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L144)、[§9 L293–316](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L293)，V14–V16。

**事实与后果：**

1. rename 失败后的 catch 先 `appendReleaseRecord`，再恢复（[semantic-assets.ts:2142–2147](../../webui/server/semantic-assets.ts#L2142)）。若失败记录本身持久化失败，控制流不会进入该恢复调用。不能宣称“审计/持久记录失败均已恢复”。
2. 全部文件 promote 后立即 `completeRecoveryJournal`（[L2162–2164](../../webui/server/semantic-assets.ts#L2162)），随后才持久化 reindexing、配置审计并启动索引（L2180–2213）。日志 `completed` 会被未终结扫描排除（[semantic-recovery-journal.ts:283–289、310–321](../../webui/server/semantic-recovery-journal.ts#L283)）；在这段窗口退出，启动恢复无法据该日志核对未知的索引/终结结果。
3. 恢复镜像函数直接吞同步异常（[semantic-recovery-journal.ts:156–158](../../webui/server/semantic-recovery-journal.ts#L156)），而调用方随后可记 restored。启动路径还先持久化 restored，后同步镜像（L504–509）。这不满足“镜像恢复且核验完成才解除阻断”。
4. WebUI 已 `listen` 才执行恢复（[index.ts:2399–2410](../../webui/server/index.ts#L2399)）；恢复异常只记日志继续（L2474–2492）。`isRecoveryRequired` 只认 recovery_required 标记，不阻断普通 open journal（[semantic-recovery-journal.ts:523–525](../../webui/server/semantic-recovery-journal.ts#L523)）。静态调用链未见该语义恢复状态进入 MCP admission/读取门禁；目前仅发布、校验 gate、手动索引调用它，不能推定受影响读取已失败关闭。

**建议：** 将“文件已保存”和“索引/终结状态待确认”分别持久化，恢复日志直到所有适用终结证据可核对才关闭；回滚不以失败记录成功写入为前置条件。镜像错误必须保留阻断并核对摘要；恢复初始化完成前拒绝写入，恢复不确定时把状态传播到涉及资产的读取/查询。§9 应补充每个持久化失败后的明确分支，V14/V15 拆出日志完成后/index 前、索引成功后/终结前、恢复镜像失败及启动恢复异常场景，附实际字节与读取拒绝证据。

### H03［高］共享协调器在终结持久化前释放，尚不满足与 P0-2 相同的临界区合同

**Spec 定位：** [§7.1–§7.2 L131–139](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L131)、[§7.2 L153](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L153)，V08/V13–V16；P0-2 [L350–364](../specs/lucy-20261022-v2p5-row-permission-management-spec.md#L350)。

**事实与后果：** 批量发布在 reindex 的 `finally` 释放锁，正常返回后才更新 published/reindex_failed（[semantic-assets.ts:2222–2234](../../webui/server/semantic-assets.ts#L2222)）；手动 reindex 的锁只包住 `reindexProject`（[index.ts:2150–2168](../../webui/server/index.ts#L2150)），`recordManualReindex` 在锁外 L2184–2192。第二个写入口可以在上一批索引完成、终结证据未持久时进入；发布成功又仅依赖 exitCode，没有 §7.2 要求的正式/镜像最终摘要核验。锁模块单测能证明互斥机制，不能证明这些业务回调包含全部阶段。

**建议：** 将最终 digest 核验、终结审计/历史和状态写入纳入同一窗口；所有失败/异常路径在完成恢复或持久化待核验状态后释放。保持正文与 P0-2 一致，不放宽锁覆盖范围；V14/V16 增补“索引已返回、终结写入尚阻塞时，其他四类写入口仍 busy”的证据。

### H04［高］服务端导出基线未锁定角色和完整 entry 集合，V07 需补反篡改用例

**Spec 定位：** [§4 L88–89、§5 L97–102](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L88)、[§9 L265–269](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L265)、V04/V07/V09。

**事实与后果：** 服务端导出记录 entries 没有 role、sharedIdentities 等属性（[semantic-maintenance-package.ts:860–866、902–907](../../webui/server/semantic-maintenance-package.ts#L860)）。核验只遍历上传后剩余 entries，且按上传自报 role 决定是否核对只读内容（L978–1016）。因此只读 entry 改成 editable_overlay 后，不再进入只读 bytes 检查；同时从 ZIP 与 metadata 删除 entry，也没有与服务端原集合逐项对照。解包的“缺失”检查仅针对上传 metadata 登记的文件（L742–747），无法代替服务端导出全集检查。后续目标解析也按上传 role 筛可写项（L839–847）。

该模块目前未接生产路由；这是**接线前能力缺口**，不宣称现网已可利用。实施计划 [§9.3.1 L476](../plans/2026-10-25-lucy-v0.25-p0-implementation-plan.md#L476) 已承认只读角色问题，不能把“未接线”当成完成依据。

**建议：** §5/§9 明确由服务端原始记录核定角色、entry 全集、主/共享身份、路径绑定、target/base/baseline digest 与 selected/dependencies；除允许编辑的 overlay 内容外，其余不可由客户端重新授权。V07 增加 readonly→editable、删 metadata+文件、共享身份/目标基线改写等组合，全部整包拒绝且正式效果为零。保留合法编辑 overlay 可导回的正例。

### H05［高］HTTP 输入过滤会静默丢弃错误 entry，违背整批阻断合同

**Spec 定位：** [§8 L228](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L228)、[§9 L264–269](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L264)、V05/V09。

**事实与后果：** [index.ts:1973–1998](../../webui/server/index.ts#L1973) 对 files/packages 的错误元素使用 `.filter` 丢弃，例如缺少 content 的条目不会交给 `validateSemanticAssets`。若同批仍有合法文件，下游校验只能看见保留下来的集合，不能报告原始错误和完整批次。这与“不忽略错误文件后提交剩余部分”冲突。

**建议：** 请求结构校验必须逐项返回定位并整批拒绝，错误数组类型也应明确拒绝；不改变既定 YAML 合法性规则。V05 增补 29 个合法 + 1 个缺字段/错类型/null entry，以及合法包 + 1 个错形 package，记录输入数、拒绝数、零正式效果。

### M01［中］既有 real-e2e 的 V 标签明显宽于实际断言，存在隐式升级验收状态风险

**Spec 定位：** [§10.1 L323–325](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L323)、[V05–V06/V09/V16/V20、§10.2 L354](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L333)。

**事实：** [semantic-batch-v025.spec.ts:85–87](../../webui/tests/real-e2e/semantic-batch-v025.spec.ts#L85) 为匿名拒绝场景同时挂 V17/V09，未构造恶意 ZIP；L155–157 为页面动作边界挂 V20/V16，未注入索引失败及重试；L197–199 为非法单文件校验挂 V05/V06，但 L231–244 只验证拒绝/发布列表不变，未验证未改包 no_change，也未验证 30 表中 1 错时正式目录、镜像、索引 hash 不变。标签和注释不是完整覆盖证明。

**建议：** §10.1 增加“V 编号→子断言→实际测试/fixture→证据→适用环境”的追踪规则；只有子断言全部满足才能回填整项。V06/V09/V16 应有自己的直接场景，V20 拆工作台边界与 Catalog 完整交互。后续修订测试标签/结果汇总器；本轮不改测试、不运行测试、不回填矩阵。

### M02［中］Spec 状态、历史叙述与后续修复基线混杂

**Spec 定位：** [L8 与 L14](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L8)、[§7.4 L161](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L161)、[N26 L210](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L210)、[§8 L214、§11 L358](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md#L214)。

**事实：** 文件头为“已实现，未验收”，但 L14 仍说“不代表已实现”，L161 称头部仍为 10-24 基线；接口和实施计划仍用未来式，N11 又明确确认凭据待落地。N26 记录的 D-23 修复来自 `2cc79f4`，晚于指定提交 `21de5168`。这些文字不修改矩阵本身，但容易被摘要成“只欠验收”或把后续修复归到原提交。

**建议：** 由 Spec 维护者统一当前状态，给历史只读调查段显式标注日期；补“基础模块/生产接线/后续修复/正式验收/客户交付”分项状态及各自提交。不能删改冻结要求来掩盖差距。本轮仅将 README 实现状态改为“设计审查退回，待修订”。

### 后续已修复事项的边界

- D-23 的 rename 成功/applied 标记失败漏回滚：`21de5168` 时存在，当前 `2cc79f49` 已改为遍历全部 entry、按实际字节判定三态；[恢复用例 L136–186](../../webui/server/__tests__/semantic-batch-recovery.test.ts#L136) 已补。这里仅确认源码修复存在，不能据此关闭 V14/V15 的其余边界。
- D-19 的历史无输出上限：`21de5168:semantic-assets.ts:724–725、741` 可见原始 inflate/gunzip；当前 ZIP 路径已设 `maxOutputLength` 并核对总量（[L725–746](../../webui/server/semantic-assets.ts#L725)）。不把该历史缺陷直接当作当前仍无上限的结论，也不据此推定维护包 V09/V10 通过。
- D-21 角色保存 CAS：当前 PATCH 传 `expectedVersion`（[roles.ts:1255–1257](../../webui/server/admin/roles.ts#L1255)），在共享锁内比较（[access-config.ts:233–260](../../webui/server/admin/access-config.ts#L233)）。不照抄旧计划中的 open 状态作为当前缺陷；这也不能替代语义批量的 H01。

## 验收建议

1. **重新准入前完成静态收口。** 修订状态与反篡改/故障断言，补齐 B01、H01–H05 的实现接线及失败关闭，提交可核对差异；对照实际调用链复审，不能只提交更多 helper 单测。
2. **固定 30 表合成证据集。** 至少覆盖两个连接、两个 Schema 的同名表、无 Schema 文件名、一个共享 overlay、跨范围只读依赖、无 overlay 模板、未启用表，以及未选中的已有待同步变更。保存 fixture hash、完整 refs、依赖/写入集合、产品/构建/依赖版本和各 ID。主旅程逐步记录下载、候选、整批计划、用户确认、正式保存和索引终结，不以 HTTP accepted 结束。
3. **把重点项拆成可判定子场景。** V05 分别注入 YAML/引用/类型/请求结构错误，断言全批零正式写入；V06 同时放入无关待同步变更，仍不得发布或索引；V12 列出全局影响并在确认后改变计划，旧确认必须失败；V01/V07/V09 从真实 API 入口做身份和攻击输入，不直接调用内部 helper 代替。
4. **逐个失败窗口取证。** V08 并发覆盖目标、依赖、absent；V13 包括重复点击、断线、重启、同键异计划与保留容量；V14–V16 分别记录 journal/第 N 次 rename/镜像/审计/index/终结写入前后及 kill 重启。核对已写/已恢复/待修复集合、旧/新/实际 digest、releaseId/attemptId、发布阻断和受影响读取拒绝，确认不覆盖外部新内容。
5. **三维校验结果分别断言。** V11/V18 必须证明描述不全但合法可发布，实库未要求为独立 not_applicable，必需检查 not_run/stale 不能发布；超时和取消计数守恒、JSON/CSV 相符且转义。V21 另取真实打包 KTX 的合成合并/校验证据；不把执行证据维度用于豁免必需合法性检查。
6. **保持环境和验收状态分离。** 获另行授权后再执行上述验证。本机静态/单元/API/Compose 证据分别登记；V03 Agent 级与 V22 客户 amd64 证据在 Wave 0b 解锁后按已验证的单副本 Helm 交付合同补齐。未取得证据前 V01–V22 均继续“未执行”，适用的环境条件单独记 blocked_environment/blocked_delivery；不得自动合并标签或把本报告视为 UAT、real-e2e、客户验收及发布批准。
