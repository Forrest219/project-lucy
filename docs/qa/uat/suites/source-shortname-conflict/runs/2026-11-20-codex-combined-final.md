# P1-64 与 P1-60 合并最终候选：短名及浏览器复验

| 元数据 | 内容 |
|---|---|
| 类型／版本／日期 | Test Report／v1.2／2026-11-20 |
| 套件／条目／执行人 | UAT-SUITE-SOURCE-SHORTNAME-CONFLICT／P1-64／REQ-030-085／Codex |
| 判定 | **PASS**：R0／01–12，共13项；不由本条结果推定P1-60完整R通过 |
| 最终候选 | `project-lucy:p160-p164-final-v5`；linux/arm64；`sha256:30ec4ae032db81201f35f78a8c1b56592ada53d5577862b1d6e7879db25fec3a` |
| 构建身份 | `77e2ad8425ae0e7a2918803e497da10636b14e5a-dirty`；运行代码含P1-60整改、P1-64及类型修复、共同预算SQLite写锁修正；产品版本仍0.30.0 |
| 执行窗口 | `2026-11-20T05:06:38.638996+00:00` → `2026-11-20T05:08:06.872266+00:00` |
| 入口 | `SNC_IMAGE=project-lucy:p160-p164-final-v5 python3 -B scripts/uat/reproduce-source-shortname-conflict.py --mode verify --browser --source-root <本跑次source-reference>` |
| 原始证据 | [summary](2026-11-20-codex-combined-final-artifacts/docker/summary.json)；[最终镜像](2026-11-20-codex-combined-final-artifacts/final-candidate.json)；[38份继承及最终输入哈希比对](2026-11-20-codex-combined-final-artifacts/v5-source-check.json) |
| 清理 | cleanedUp=true；独立容器／网络／私有目录清理，不改共享demo；候选与脱敏证据保留 |

## 用例

| 编号 | 已验证事实 |
|---|---|
| R0 | 源码与独立冻结输入哈希一致、真实MySQL8.4、普通MCP及独立管理员 |
| 01／02 | 原事故不手改扫描YAML转绿，city／ods_city两物理表可查、保存ack=true |
| 03 | 重扫旧别名和Role／overlay／查询引用不漂移 |
| 04／05 | 冲突400且不写入，旧合法MCP仍可用；二次前缀冲突自动避名 |
| 06 | 真实并发恰一成功；具名busy的失败候选原样重试400 DUPLICATE_SOURCE_NAME；失败Manifest不存在、上传记录与journal文件集合不变 |
| 07／08 | 旧冲突ack=false并有具体issue；六组旧冲突逐份修复直到运行态恢复 |
| 09 | 原始响应、摘要、结果和资源清理已留档 |
| 10 | 旧ods_zebra仍指ods.zebra，新表ods.ods_zebra分配ods_ods_zebra；实际COUNT=1／2 |
| 11 | columns及namesOnly均保留aux.City物理大小写并避名为aux_City；真实SQL查数成功 |
| 12 | 两入口×成功／未确认／恢复，真实前台反馈与计时全部通过 |

当前P1-60无绑定时begin不公开；只有tools/list确实隐藏且强制调用精确begin_not_available才认作协议兼容预期，不算工具调用成功。公开工具与实际query仍须成功。SC-04的锁内受控时序另由beforePublishLock回归证明，busy本身不充当唯一性证明。

## 前台浏览器

Chrome157.0.8103.79，headed，1440×1000；每段记录visible＋hasFocus，关键内容和反馈在视口内；无pageerror、无API拦截／假DOM。导航里程碑：启用表页的ods.ods_zebra实际行；连接页的新建连接入口可见且在视口。提交计时从实际点击到同次结果反馈可见；同次API耗时独立分列。单位ms：

| 场景 | 导航→关键内容 | 提交→反馈 | 同次API | ack |
|---|---:|---:|---:|---|
| whitelist-success | 840 | 1557 | 1318 | true |
| connection-success | 95 | 1840 | 1803 | true |
| whitelist-unconfirmed | 82 | 1637 | 1323 | false |
| connection-unconfirmed | 83 | 2374 | 2319 | false |
| whitelist-recovered | 173 | 1723 | 1522 | true |
| connection-recovered | 118 | 2464 | 2356 | true |

[启用表未确认](2026-11-20-codex-combined-final-artifacts/docker/browser/whitelist-unconfirmed.png)／[连接未确认](2026-11-20-codex-combined-final-artifacts/docker/browser/connection-unconfirmed.png)。未确认状态给出Source Map问题，无成功Toast；保存成功提示可能仍在刷新目录，不声明后台刷新已完成。本合同未另设UI时延预算；本表为本机实测，不推断通用p95。

## 固定源码与类型／回归

共享工作树同时存在其他权限编辑任务。一轮R0因工作树acl.ts与冻结候选不同而正确失败，保留历史。最终比较使用独立的旧构建输入快照：五份文件与先前P1-64已验输入逐字节一致，再核对最终镜像；没有删去哈希门禁或把镜像自身当成唯一预期。[来源](2026-11-20-codex-combined-final-artifacts/source-reference/provenance.json)。

全库类型检查在最终镜像内和镜像导出的固定源码检出均退出0；42文件782项Vitest通过，包含补入的完整L0链路、表级歧义、预算真实SQLite竞争及已提交Wiki基线回归；实际概念模块测试另29项通过。[782日志](2026-11-20-codex-combined-final-artifacts/regression-v5-frozen.log)／[29日志](2026-11-20-codex-combined-final-artifacts/concepts-v5.log)／[类型日志](2026-11-20-codex-combined-final-artifacts/typecheck-v5-frozen.log)。严格与include配置、package与lock均与已提交基线一致，没有排除文件或缩小类型范围。[契约](2026-11-20-codex-combined-final-artifacts/v5-dependency-typecheck-contract.json)。

共享工作树的并发新改动不作为最终候选代码。镜像实际server/src/scripts与77e2ad84完整差集已保存：[源码差集](2026-11-20-codex-combined-final-artifacts/candidate-source-diff-v5.json)／[补丁](2026-11-20-codex-combined-final-artifacts/candidate-overlay-v5.patch)。继承的6份Wiki文件已对齐已提交基线；未纳入其他会话未提交的权限／诊断改造。完整开发测试曾直接放进生产镜像尝试，因DOM装载、Git上下文和测试内容根／超时问题未通过；未冒称生产镜像全量Vitest通过，采用标准开发环境固定源码回归加真实Docker UAT。

早期构建将dirty参数误传true而非脚本要求的1，旧镜像身份未用于最终放行。本候选已正确写入dirty并重建前端身份，v3未纳入77e2ad84的表级歧义适配导致P1-60真实R11 FAIL；v4补入该提交两份文件；v5再对齐6份已提交Wiki文件，38份输入比对通过，完整重跑本套件；v3／v4记录保留在artifacts/history-v3及history-v4。构建复用既有依赖层，锁文件不变；不是标准Dockerfile从零构建声明。合成MySQL共享链路不扩大为Hive／SelectDB特有适配或客户现场已验。既有冲突资产仍按合同重扫／上传逐份修复，不自动改写历史资产。

两项功能均已通过后，需求／开发／测试三台账同步完成，见[同候选整包最终评审](../../../../../reviews/2026-11-20-p160-p164-combined-final-review.md)：本条功能收口；当前整包仍有其他已纳入模块的版本与合同缺口，不放行用户更新。
