# L25-15 第 4 轮复核：可交付开发定稿

日期：2026-10-30。对象：语义发布历史版本与整批恢复 Spec／Plan（复核前为 v0.10）。方法：对照当前源码核对锁释放点、正式内容写入口和 Plan 任务是否与 Spec 相容。未运行功能测试，未改运行代码。

## 结论

**设计定稿，S1–S6 可交付开发。** 产品语义与 v0.8–v0.10 相同。两处阻塞已写入 Spec／Plan **v0.11**。SRR-01–SRR-24 仍全部未执行。本复核不包含编码。S7、浏览器验证、镜像构建和客户交付仍须单独授权。

## 发现与处置

| 编号 | 级别 | 问题 | 处置 |
|---|---|---|---|
| B1 | 阻塞 | §5.2.1 与 Plan S0 第 8 条仍把「reindex 返回即放锁、终态核验在锁外」写成现行事实，并要求 S1–S7 不得改 `semantic-assets.ts` 的锁生命周期、把恢复自足机制当成该偏差的唯一保障。提交 `3b7e8d32`（2026-10-30）已把批量发布的锁留到 `verifyFinalTargetDigests`、`semantic_publish_terminal`、`published` 和 `completeRecoveryJournal` 之后（`semantic-assets.ts` 的 `runReindex` `finally`），手动 reindex 的历史记录也写在 `withPublishCoordinator("manual_reindex")` 内（`index.ts`）。按 v0.10 开工会避开已经盖住的窗口，或把已关闭的偏差继续当成交付前提。 | 采纳。§5.2.1、Plan S0 第 8 条、§3.1 与 SRR-23 改为：该窗口由 `3b7e8d32` 盖住；快照接在同一临界区内部；释放点不得提前。恢复锁仍盖到自身终态。基线复核与未终结批次拒绝保留，因为它们是内容合同。L25-11 的 V01–V22 仍未执行，本功能不把 `3b7e8d32` 写成 L25-11 验收通过。L25-16 的 G31 仍引用放锁前的旧行号；本功能不改 L25-16 登记，也不再把 G31 未改写当作交付前提。 |
| B2 | 阻塞 | 写入口清单仍写成「S0 实施时再冻结」。当前源码里，删除语义文件的 `removeSchema`（`deleteManifest` 或 `deleteOverlays`）和 `removeConnection`（`deleteAssets`）已在 `manifest_upload` 窗口内 `safeRemove`；`writeSourceYamlImport` 只持 `withKtxYamlWriteLock` 与显示屏障，不持发布锁；`applyConnectionIdChange` 会 `renameSemanticLayerDir`，当前无 HTTP 路由、也不持发布锁。只按 v0.10 的五类入口接线，会漏掉可恢复删除，并让导入和连接 ID 变更与恢复交错。 | 采纳。Spec §2.2 与 Plan S1 对照表冻结 2026-10-30 清单。删除语义文件的 Schema／连接删除在 `safeRemove` 前建快照，预期新 digest 为 absent。YAML 导入先进入发布窗口再接快照。`applyConnectionIdChange` 只做互斥，不生成可恢复快照。L25-16 W-A 不写语义 YAML，不进清单。日后新增写点先改清单再编码。SRR-01 补入这两类删除。 |
| L1 | 低 | Spec 状态行仍写「修订至 v0.9」，与头部 v0.10 不一致。 | 采纳。状态行改为 v0.11。 |
| L2 | 低 | Plan S2 第 16 步把启动对账写成只处理 `promoting` 与 `reindexing`，与同节第 14 步和 Spec §8.1 的六类互斥分类冲突。 | 采纳。第 16 步改为执行 §8.1 的 A–F 分类，补写类先于索引续跑类。 |

三轮审阅已经闭合的终态审计顺序、六类启动对账、语义删除集合和写集分离，本轮抽查未发现新的三处落点冲突。

## 定稿边界

- 可开工范围：Plan S1–S6。
- 仍须单独授权：S7 的 linux/amd64 客户形态、浏览器验证、镜像构建、部署与客户交付。
- 验收：SRR-01–SRR-24 保持未执行。设计定稿不产生验收证据。
