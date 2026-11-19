# 核心可用性 Spec／Plan 文档核对记录

日期：2026-11-19。范围为P1-61／62／63文档，不是实现CR或UAT。现行条目仍是v0.1-draft，终稿未确权、开发未授权。

## 交付范围

- 三组同slug Spec／Plan：轻探针诊断隔离、重任务容量、进程排空；各自一条功能承诺，SC分别9／10／9项。
- [去重核对](2026-11-19-core-availability-gap-assessment.md)逐项回链P1-21／31–34／37–39／45–47／50／52–54／58、Spec174／190／191及D7延期；已有worker/恢复/队列/发布门禁不重复立项。
- 总账P1-61…63、需求池REQ-030-082…084、两级索引、概览§9、UAT INDEX、e2e勾连与新缺口同期登记。测试台F61／F62／F63／R-CAV全部NOT RUN。
- 核对中发现的P1-58／59现值镜像按各Spec头部对齐；P1-47勾连表的旧FAIL改为指向测试台现行2026-11-19跑次，旧日期的历史行保留。仅纠正镜像，没有修改这些功能合同或历史测试结果。

## 17项形态自查

逐项处理见 [suite落盘检查](../qa/uat/suites/core-availability/suite.md)。三份Spec的四画像完整；诊断滞后、排队/拒绝、关停新请求拒绝及退出延长均按最差子面判↓，补偿挂对应SC；纯MCP不要求WebUI Cookie；权限与可靠审计不因可用性放宽。

三个Plan含目标/开工前置/验收/完成定义/风险，任务均写明未执行和授权白名单。三份交互豁免为两行固定格式，Plan各有浏览器不适用小节；不增加浏览器、移动窄屏或新交互测试授权。未新增可执行命令/CI，runner仅拟议；旧状态句与源码基线不改写为本次完成。

## 机器检查

以下为本轮文档检查，不是功能测试：

| 检查 | 结果 |
|---|---|
| `npm run lint:spec-docs` | PASS；未增加形态违规或新豁免 |
| `npm run lint:spec` | PASS；原有非阻塞提示保留 |
| `npm run lint:terminology` | PASS |
| `npm run lint:ia-boundary` | PASS |
| `node scripts/uat/check-e2e-ledger.mjs` | PASS；该脚本为硬编码既有条目检查，不代替新增行核对 |
| 对新6文件直接调用collectDocViolations/checkInteractionContract | 零违规；不依靠未跟踪文件只WARN策略 |
| 新文档相对链接、Spec/Plan/总账/REQ/索引状态同句、新suite与勾连存在性 | 专项检查；结果与摘要保存在下方本轮日志目录 |

原有提示：总账metadata有1条STALE基线项，lint:spec有既有非阻塞eval/access-role-policy提示；未改基线或扩大豁免。完整命令日志与本次前像位于 `inbox/20261119-core-availability-docs/`，正式结论保留在本文件，不依赖临时目录长期保留。

## 边界

本轮所有写入限定Markdown文档及inbox过程材料；tracked运行文件内容指纹与任务开始前一致。没有构建镜像、执行Vitest/UAT、压测、采集新现场证据或修改运行配置。共享工作树原有实现保留，未暂存、提交或回滚它们。

三份草案尚需终稿评审。尤其P1-63必须批准Spec191关停顺序的具名修订，P1-62必须冻结真实三入口许可接缝；文档门禁通过不代替这些设计确认，也不证明客户503根因或可上线。
