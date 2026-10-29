# Lucy CI 恢复实施计划

| 项目 | 内容 |
|---|---|
| 状态 | **定稿 v1.0**（2026-10-29）。授权 T00–T04 与 Release CI 文档修正。不授权 T05、R01，也不授权在本里程碑修复类型债务 |
| 日期 | 2026-10-29（Asia/Shanghai）；同日由 Draft v0.1 修订为定稿 v1.0 |
| 设计 | [Lucy CI 恢复与分层规范](../specs/lucy-ci-restoration-spec.md) |
| 交付边界 | 恢复日常 CI；客户自动发布设施单列，不默认交付 |

## 1. 开工前置与变更策略

1. Spec §1.1 已经批准 T00–T04 和 Release CI 文档修正。开工时重新读取 HEAD、远端、工作树及保护快照，不用 Draft 探查时的旧 SHA 直接改文件。
2. 不 stash、reset、清理或提交不属于本任务的工作树修改。实施分支从开工时的 `lucy-v0.25` 切开，分支名不以 `codex/` 开头。不创建 worktree，除非实施者当时的工作树无法保持这些无关修改不动。
3. 探查时 main 为 `99f8c2e`，`dcb08cf0` 是 demo smoke 修复，其后 `b3fbc92c` 提交了 Spec 149。先审核 `dcb08cf0` 的 11 个文件，只把仍然适用的部分回移到 main。禁止合并整条 `lucy-v0.25` 来恢复 CI，也不假定这 11 个文件可以不看差异直接 cherry-pick。
4. 不复用 dirty 工作树的测试通过证据。main 与维护分支分别保存 SHA / 命令 / 工具版本 / 结果。
5. 方案批准只覆盖已列 CI 工作；类型检查或 smoke 暴露的新业务修复另列文件与影响供评审，不夹带修改 ACL、数据库配置、KTX 或产品版本。

探查结束时其他工作已新增业务提交 `b3fbc92c`；上述 dcb08cf0 是起始快照。T00 从届时最新状态重新建立基线，不覆盖或回退该并发提交。

## 2. 分阶段工作包

| 步骤 | 工作与候选变更 | 验证 / 退出条件 | 依赖与量级估计 |
|---|---|---|---|
| T00 基线 | 保存 workflow、main protection、tag rules、runs / jobs；分别建立干净 main / 维护分支基线；核对 Node 22 patch 与锁文件 | 记录 npm ci 与现有门禁。tsc 只记录诊断数量，不在本步修复；AC01、AC04 | 开工；0.5–1 人日 |
| T01 验证现有故障 | 在干净检出上运行 `dcb08cf0` 已包含的 bootstrap、会话、compose、runner 与命名空间修复。PostgreSQL 的已证实根因是 token 文件不存在。同一命令仍然失败时才继续查 | main 与维护分支上两类 demo 的业务断言成功；现有日常 jobs 成功；AC02、AC03 | T00；0.5–1.5 人日。不把根因重新打开，除非验证命令失败 |
| T02 补足静态合同 | 增 actionlint 及聚合负例；登记 root 测试；新增 `lucy-typecheck.yml`。类型诊断只记录基线，不修改产品类型 | actionlint 与契约测试通过。两份干净基线写明 tsc 诊断数量。类型 workflow 失败不阻塞日常 workflow；AC04–AC06 | T00；0.5–1 人日。不含类型债务修复 |
| T03 分层与优化 | 新 `lucy-ci.yml`；`lucy-release.yml` 只留发布 / 诊断；`ktx-diff-audit` 留在日常 workflow 并固定上游 SHA；临时增加 `lucy-v0.25` push；保持现有 job ID；cache、权限、timeout、取消、脱敏证据 | 同 SHA 对照；完整依赖闭包；旧发布反绕过测试继续有效；AC01、AC03、AC05–AC08 | T01、T02；1–2 人日 |
| T04 双分支接入 | main 与 `lucy-v0.25` 各有对应变更；避免整分支互并；修正 Release CI §4 的 compose 交付表述 | CI 改动在 PR、push main、push `lucy-v0.25` 上各成功一次；记录每次墙钟和 runner minutes，以及 push+PR 成对时的合计；AC09、AC11 | T03；0.5 人日 + CI 观察时间 |
| T05 必需检查迁移 | **本定稿不实施。** 步骤仍保留在 §5，供以后单独授权 | 未授权，不能作为 T04 的出口 | 需另一次明确批准 |
| T06 日常验收交付 | 汇总两分支 commit、PR、run、门禁与未完成项；更新治理事实源。类型检查和客户发布分开标明 | AC01–AC03、AC05–AC09、AC11–AC12 满足即可声明日常恢复。AC04 只要求基线已记录。AC10 未执行要写明 | T04；0.5 人日 |
| R01 发布设施（另行批准） | 受保护 amd64 runner、隔离 K8s / DB、测试模型、签名、registry environment、实例私有附件闭环 | 同 digest 原生实测 + real-e2e + readiness + G1–G4 / 其他适用门禁、C01/C05/C20；不能借日常成功跳过 | 外部设施和凭据所有者就绪；本版不估算 / 不承诺完成 |

T00–T04 与 T06 的规划估计约 3.5–6.5 人日，另加 CI 观察。这不是已发生的工时，也不是交付承诺。类型债务修复和 R01 不在合计内。T00 后若验证命令暴露新的产品缺陷，先提交增补范围，不夹进本里程碑。

## 3. 文件影响清单

| 文件 | 预期处理 |
|---|---|
| `.github/workflows/lucy-ci.yml` | 新建日常工作流，包含 `ci-required`。不包含 `webui-typecheck` |
| `.github/workflows/lucy-typecheck.yml` | 新建独立类型检查。失败不改变日常 workflow 的结论 |
| `.github/workflows/lucy-release.yml` | 只保留发布 / 诊断生命周期，保持原生 amd64 与证据依赖。日常触发在与 `lucy-ci.yml` 同一提交中移除 |
| `.github/actionlint.yaml` | 复用自托管标签登记；如新增可复用 workflow 输入则补规则 |
| `package.json`、`webui/package.json` | 可增加 `tsc --noEmit` 脚本入口。不修改版本，不因为诊断去改产品源码 |
| `scripts/gates/customer-release-workflow.test.mjs` | 适配双文件 DAG，反绕过断言继续有效 |
| `scripts/gates/`、`scripts/release/` 的 CI 辅助文件 | 按需新增聚合契约、测试登记及证据输出；保持小范围 |
| `scripts/gates/p0-smoke.mjs` | T03 按实测减少重复 lint / build；不能跳过未由上游确实执行的门禁 |
| demo smoke / compose / bootstrap helper | 优先复用 `dcb08cf0`。PostgreSQL 已证实为 token 文件缺失。进一步变更必须来自验证命令的新失败 |
| `docs/governance/release-ci.md` | 更新触发、job、Required checks 与不再适用的 compose 客户交付表述 |
| `docs/governance/project-overview.md` | 按治理补 Spec / Plan 索引；本轮不改现行索引 |
| 本 Spec / Plan | 定稿 v1.0 已写入。T06 只补执行证据和验收状态，不把定稿退回草案 |

两个 npm lock 只在依赖确实变化时更新；固定 Action SHA 不要求 npm 升级。T00 / T02 只记录干净检出的 tsc 诊断数量。探查时 dirty 工作树的 75 条诊断不能成为修复委托，本里程碑也不产出类型修复文件清单。

## 4. 验证顺序与审阅材料

1. **静态**：actionlint、workflow DAG 反例（失败 / skipped / cancelled / 缺 job）、权限与事件入口、root 测试登记、版本 / ledger / 术语 / IA / 交付隔离。
2. **干净 Node 22**：两份 npm ci、WebUI Vitest、build。tsc 只记录诊断数量和命令；诊断不为零不阻断日常门禁。确认没有访问开发机私有配置。
3. **原生 amd64 hosted integration**：Docker、两个 demo、K8s 静态、N-1 kind H3/H4；失败收集日志与脱敏报告；无浏览器 / 移动端 / 模型测试。
4. **同 SHA 对照**：拆分前后的每日覆盖表一致；发布 contract negative tests 覆盖跨 workflow 引用，未授权发布路径没有权限与凭据。
5. **远端观察**：CI 改动在 pull request、push `main`、push `lucy-v0.25` 上各成功一次，并写明 SHA。不切分支保护。T05 未授权。
6. **交付**：每个变更给出 branch、commit、PR 与 run 链接，列出全部 AC 结果、剩余风险、耗时和回滚指令。客户发布设施未完成须独立标记 BLOCKED。

禁止使用 tag push 来测试日常 CI，因为 tag 会进入发布路径。需要失败反例时先用本地契约测试；如需远端失败演练，使用无凭据的临时 PR，经授权且不合入产品分支。

## 5. Required checks 迁移与回滚

本节是以后的操作说明。定稿 v1.0 不授权执行。T00–T04 不得调用保护规则 API。

```text
read current protection and store exact JSON
verify new ci-required exists on current SHA and all AC09 evidence exists
add ci-required (GitHub Actions app), retain old four contexts
verify one real PR has all five required contexts successful
remove only old four contexts; keep strict/enforce_admins/other rules
read back; compare only intended diff
if new trigger/context/DAG faulty:
  restore original required contexts from snapshot
  revert CI change through normal PR; retain failed evidence
  never set checks=[] or disable protection
```

在旧 workflow 停止日常触发与新 workflow 接管之间须用同一原子提交，避免检查失踪或同名冲突。T05 前保留 4 个旧 job ID 的语义；其实现迁入 lucy-ci.yml，不临时留两个同名生产者。

回滚 workflow 不覆盖在途业务改动、不回退版本、不重签密钥、不删除 tag / registry digest。失败记录及原因保留，不靠 rerun 成功覆盖先前异常。

## 6. 所有者与待批准决策

| 项目 | 建议职责 / 当前状态 |
|---|---|
| CI 实现与文档 | 定稿已授权 T00–T04 与 T06。实施者不修改分支保护、ruleset、secret 或 environment |
| 分支保护及发布环境设置 | 仓库管理员，具体人员待用户指定；不是部署人员 |
| runner / K8s / 测试 DB | 供应方运维，具体负责人未确认 |
| 模型测试凭据 / 签名密钥 | 供应方指定保管人，禁止放入公共 artifact；本轮未读取内容 |
| 客户实例 bootstrap 与附件 | 供应方打包流程复用 / 签发，部署人员不补齐 |

2026-10-29 已裁定的执行边界：

| 决定 | 定稿 |
|---|---|
| 首轮保留 Docker、MySQL、PostgreSQL 和 kind | 批准 |
| `lucy-v0.25` push 触发 | 批准，且为临时入口 |
| 日常 / 发布拆分，类型检查用第三个 workflow | 批准 |
| `ktx-diff-audit` 留在日常 workflow，只固定上游 SHA | 批准 |
| 类型债务归零才算日常 CI 恢复 | 不批准 |
| 连续 5 次成功才允许后续迁移 | 不批准。证据改为三类事件各一次 |
| `ci-required` 解析测试总数 | 不批准。只读 `needs.*.result` |
| T05 分支保护迁移、R01 发布设施 | 不在本次授权内 |

T00–T04 与 T06 可以开工。T05 与 R01 保持未开工。

## Terminology Compliance

遵循 `webui/docs/00-product-terminology-standard.md`；无新增产品术语。区分 Spec 审阅、实施批准、CI 验证与客户发布批准。
