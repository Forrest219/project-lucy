# Lucy 2.0 客户升级交付 Checklist

适用于每次生成部署包，特别是“旧开放模式、无管理员 → 2.0 管理员登录”。本清单随包交付为 `UPGRADE-RELEASE-CHECKLIST.md`。每个最终包分别记录 PASS、FAIL、PENDING 和证据路径，不得沿用上一包结论。必验项 FAIL/PENDING 时不能标记为可生产升级。

## 出包时同步配齐引导密钥（强制交付原则）

自 2026-10-20 用户确认起，面向首次创建管理员的每次客户部署交付，供应方必须在出包时同步生成或复用 `webui-bootstrap-token`，连同实例签发状态、凭据元数据和使用说明成套提供。部署人员只补现场参数，不另行生成、补齐或手工改绑密钥。

“每次同步生成”指每次确保交付齐备：同一逻辑实例重出包、升级或重试复用原密钥；不同实例分别签发；已有管理员直接登录，不签发新密钥或重开认领。真实现场参数未齐备时可先预分配并保存稳定实例 ID，但不能为已有实例另建身份绕过原签发记录。

通用镜像和公共软件包不含密钥，客户私有凭据附件与其配套交付。软件包完整不代表客户部署交付完整；缺密钥附件、签发状态、部署取值一致性或复用证据时，不得发出声称可部署的客户包，也不能让部署人员临时补密钥。

标准出包入口已自动完成签发接入：客户交付在最终归档回归后自动生成或复用私有附件（密钥、签发状态、凭据元数据、准备入口）并执行 C20 成套门禁（`scripts/gates/verify-bootstrap-attachment.py`）；公共发布用 `--public-release` 显式跳过，已有管理员用 `--existing-admin` 记 N/A。实现与边界见[实施计划](../plans/2026-10-20-build-time-bootstrap-credential-plan.md)。自动化未覆盖的新场景，仍由供应方在同次出包完成签发、配套和验证。

## 两轮事故复盘

| 轮次 | 问题 | 遗漏原因 | 固定门禁 |
|---|---|---|---|
| 20261020-test | 通用包加单独密钥缺少实例目录；HTTP 被拒绝 | 把镜像可运行与客户入口可运行混为一谈，接入条件未匹配现场 | C01–C06、C11 |
| 20261020-test | dirty 源码、Chart 版本复用 | 缺少来源和版本一致性放行 | C07–C09 |
| 20261020-test | 管理员迁移与 PVC 恢复未完整验收 | 把启动成功作为升级成功 | C12–C16 |
| 20261020-r3 | 连续 JSON 输出被单次 json.loads 拒绝 | 测试固定包装为 items，最终归档仅跑 --help | C10–C11；真实 kubectl 渲染回归 |
| 20261020-r3 | DEPLOYMENT_FAILED 掩盖根因 | 预检错误无阶段、分类和独立诊断 | C17 |
| 20261020-r3 | 现场补丁被绑定校验拒绝；曾见未登记文件 | 身份绑定正确；缺少具体异常文件证据和重新出包流程 | C09、C18；禁止现场改摘要绕过 |

依据：部署人员的 `lucy-2.0.0-20261020-test-upgrade-review-and-provider-request.md` 与 `lucy-2.0.0-r3-upgrade-blocker-provider-fix.md`。原始现场报告受控保存，不向通用包复制实例信息。

## 每次出包必须执行

| ID | 检查及通过条件 | 执行位置 / 证据 |
|---|---|---|
| C01 | 公共通用包无密钥；客户交付同步配齐私有密钥附件及签发状态；实例目录具备 package、instance.json、customer-values.yaml、RECOVERY.md、credentials、scripts/deploy.sh | 最终归档回归 + C20 门禁（`verify-bootstrap-attachment.py`）+ 供应方附件/实例清点 |
| C02 | context、集群/Namespace/Deployment/PVC UID、Release、Service、旧镜像绑定原实例 | 真实 dry-run + 基线记录 |
| C03 | HTTP/HTTPS 明确选择；Cookie Secure、公开 MCP URL 与选择一致；HTTPS 私有 CA 随实例交付 | 自动双模式回归 + 现场适用模式验收 |
| C04 | 无管理员路径无历史消费或恢复冲突；已有管理员不重发密钥；schema 1/2 探测不改库 | auth probe 回归 + 现场脱敏状态 |
| C05 | 供应方出包时生成或复用密钥，部署人员不补；权限 0600、签发状态保留、同实例复用、不同实例独立、已有管理员不新发；密钥不进入镜像/公共包/日志 | issuer/preparer/attachment 回归（`customer-bootstrap-state`、`build-bootstrap-attachment`）+ 同次出包 C20 报告 |
| C06 | 原资源名、PVC 所有权、挂载路径、配置/语义层/Wiki/Skills/密码文件/MCP Token、8276/8277 保留；7878 不公开；单副本 Recreate | 渲染检查 + 真实前后对比 |
| C07 | 已提交且 dirty=false；镜像 tag 对应出包提交；Chart 内容变化升版本，工具修复不强行改 Chart | 构建入口拒绝 dirty/tag 不匹配；BUILD-INFO |
| C08 | G1–G4/G4b/G4c/G8；amd64 ELF、离线 Python/KTX 功能、UID 10001；导出重导入复验 | 镜像构建日志 + K6；参照 amd64 构建清单 |
| C09 | config/manifest/index 身份来自归档验证；内外 SHA、baseChecksumDigest 一致；改脚本、重算 sums、混用实例必须失败 | identity 回归 + 最终归档反向用例 |
| C10 | 单对象、连续对象、List、多文档六类资源可解析；空/HTML/损坏/尾部垃圾明确失败；不能仅模拟 items | Python 回归 + 真实 Helm/kubectl client 输出 |
| C11 | 最终归档校验、解压、重新准备实例；其他 cwd 通过绝对路径运行完整 deploy.sh --dry-run，不能只跑 --help | 自动隔离回归 + 另行真实集群 dry-run |
| C12 | 原生 linux/amd64 K3s：真实 0.17.0、原 RWO PVC，最终实例入口 dry-run 后实际升级至 2.0.0/KTX 0.16.0 | 原生升级记录，绑定包 SHA/提交/运行镜像 ID |
| C13 | 缺引导 Secret 安全失败；Owner 仅认领一次；登录/退出、未登录拒绝；重启及再次 Helm 升级保持账号和 consumed 状态 | 原生管理员旅程；ACCEPTANCE.md |
| C14 | 原 MCP Token 有效、无 Token 401；原连接/reindex/允许拒绝查询通过；非认证业务文件哈希保持 | 原生业务验收；不输出凭据或完整 values |
| C15 | 切换前停机备份完整 PVC、核对哈希；保存原 Helm revision/values/镜像；重试不覆盖初始备份 | 原生备份记录；备份受控保存 |
| C16 | 实际恢复旧镜像及原 PVC，再次升级成功；Helm rollback 不能代替安全状态恢复 | 原生恢复演练 |
| C17 | stage/code/type；预检失败也有 0700 目录/0600 脱敏诊断；不保存异常消息、源代码行、命令原文、values、Token 或密码 | 错误分支回归 + 现场诊断 |
| C18 | 最终包及运行后软件目录无 ._*/.DS_Store/__MACOSX/__pycache__/*.pyc、链接、未登记文件；诊断在软件目录外 | 精确文件集 + 运行前后哈希 |
| C19 | 新包名/提交/摘要唯一，旧包作废；交付说明列通过/待验；全部适用项通过后才生产放行 | 验证 JSON + 原生验收表 |
| C20 | 同次客户交付的软件身份、密钥附件、签发状态/元数据和说明齐备；最终附件可复用并生成密钥相同的实例目录；缺任一项或绑定不符即阻断客户交付 | 出包自动生成附件 + C20 门禁重解压附件与最终归档、其他 cwd 复用并核对密钥摘要（`--existing-admin` 记 N/A 并核实原状态） |

## 自动执行入口

从干净提交构建镜像，再执行标准出包命令：

```bash
bash scripts/gates/build-k8s-delivery-package.sh \
  --image-tag project-lucy:customer-amd64-2.0.0-YYYYMMDD-COMMIT \
  --version-suffix YYYYMMDD-rN --output /absolute/path/delivery.tar.gz \
  [--customer <slug>] [--existing-admin]   # 客户交付默认自动生成私有引导附件
```

入口自动运行部署/身份/密钥/探测/附件回归、K6 和最终归档入口回归，失败停止出包。客户交付还会自动生成或复用私有引导附件（默认 `~/.lucy/customer-deliveries/`，签发状态根默认 `~/.lucy/customer-credentials/`），打包为 `<附件>.tar.gz` 并执行 C20 成套门禁，产出 `.c20.json` 证据；软件包与附件必须成套交付。纯公共发布加 `--public-release`，不签发客户凭据。最终归档独立复验：

```bash
python3 scripts/gates/verify-customer-upgrade-package.py \
  --tar /absolute/path/delivery.tar.gz --report /absolute/path/verification.json
```

该回归以临时 localhost discovery API 和合成集群读响应运行完整入口，Helm lint/template 与 kubectl client 渲染使用真实 CLI；覆盖 HTTP 原外部 PVC 和 HTTPS Chart 管理 PVC 两种分支。它不证明原生 K3s、旧 Pod 或业务成功，JSON 固定记录 `productionReady=false` 和原生验收待执行。

已确认目标的真实实例可增加 `--instance-dir /private/customer-delivery` 执行真实 dry-run：读取集群并在 Pod 内做只读状态探测，不缩容、不创建 Secret、不升级。成功仍不代替 C12–C16。

## 现场执行与回传

1. 保持旧版运行；核对新包外层 SHA，解压到新目录，重新准备实例。保留旧实例签发状态，同实例复用密钥，不随意换新密钥。
2. 按 CUSTOMER-UPGRADE.md 核对 context、UID、访问模式、恢复文件，再执行 `bash scripts/deploy.sh --dry-run`。失败即停，提供错误码和脱敏诊断，不能改脚本/摘要绕过。
3. 在测试环境维护窗口执行 `bash scripts/deploy.sh`，按 ACCEPTANCE.md 完成 C12–C16。升级含停机备份和 Recreate 切换，需维护窗口。
4. 回传包 SHA、提交、平台/CLI 版本、前后资源名与 UID、运行镜像身份、升级/管理员/MCP/恢复/再次升级结论和脱敏证据路径。普通报告不含私有凭据、完整 values 或 PVC 备份。
5. HTTP、HTTPS 分别记录；不适用模式写 N/A 并说明实际访问方式，不用 HTTP 结果宣称 HTTPS 通过。

## 每包结果模板

```text
包名 / SHA256 / 提交：
镜像身份 / Chart / Lucy / KTX：
自动回归、K6、最终归档验证 JSON：
真实 dry-run / 原生平台与 K3s、kubectl、Helm 版本：
C01–C20：逐项 PASS / FAIL / PENDING / N/A（原因）及证据路径
同次出包密钥附件/签发状态/部署密钥一致性/复用结果（已有管理员记 N/A）：
管理员、MCP/业务、备份、恢复、再次升级证据：
适用访问模式 / 剩余问题：
生产放行结论 / 验收人 / 时间：
```

本清单遵循 Lucy 产品术语标准，未引入新的产品概念。
