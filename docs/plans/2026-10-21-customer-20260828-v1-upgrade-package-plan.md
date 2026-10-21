# 20260828-v1 客户升级包生成计划

| 元数据 | 内容 |
|---|---|
| 文档名称 | 20260828-v1 客户升级包生成计划 |
| 文档类型 | Implementation Plan |
| 版本 | v0.1 |
| 撰写日期 | 2026-10-21 |
| 状态 | 执行中：第 3 节已纳入本次提交。候选包在原生 amd64 的 G4/G4b 与 v0.3 P0-3 至 P0-6 完成前不交给客户 |
| 适用范围 | 为现役 `lucy-k8s-integration-20260828-v1`（无登录、无管理员、已有 https 域名）生成一次 Lucy 2.0 候选交付：linux/amd64 镜像、私有引导密钥附件、随包文档 |
| 关联 | [升级计划 v0.3](2026-10-21-customer-20260828-v1-to-lucy-2.0-upgrade-plan.md) 仍是升级验收合同。本计划只实现供方出包。现场维护窗口、恢复演练和 `productionReady` 仍按 v0.3 的 P0-3 至 P0-6。引导密钥规则见 [出包时配套生成引导密钥](2026-10-20-build-time-bootstrap-credential-plan.md) |

用户所说的「附属登录密钥」在本仓库的产品名是**引导密钥**（`webui-bootstrap-token`）。它只用于该实例首次创建所有者，不进入镜像，不进入通用软件包。

## 1. 结论

1. **现在不能出包。** 当前 `.dockerignore` 盖不住 `webui/:memory:/.ktx-ui/`，本机 `security.sqlite` 会随 `Dockerfile` 的 `COPY . .` 留在镜像里。Chart 不渲染 `LUCY_TRUST_PROXY` / `LUCY_TRUSTED_PROXY_CIDRS`。升级白名单不写入内容根和这两个变量。
2. **r6 不是这次的输入，也不能复用。** `build-k8s-delivery-package.sh` 要求工作区干净，且镜像 `/app/BUILD_REVISION` 等于出包时的完整 HEAD。修复提交之后必须重新打镜像。
3. **本计划的完成物是候选包，不是已经交给客户的放行包。** Mac 上可以打 linux/amd64 镜像并组装 tar 与引导密钥附件。交给客户之前，仍要在原生 amd64 上做 G4/G4b 和 v0.3 的升级、恢复验收。
4. **应用认证、启用表、绝对拒绝工具名、CSRF 和限速逻辑不在本计划的修改范围内。** 它们留在 v0.3 的现场与原生验收。

## 2. 交付物

| 交付物 | 落点 | 完成标准 |
|---|---|---|
| linux/amd64 镜像 | 本地 tag `project-lucy:customer-amd64-<VERSION>-<日期>-<短提交>` | 构建脚本 G1、G2 通过；`/app/BUILD_REVISION` 等于该次干净提交，不带 `-dirty` |
| 候选软件包 | `inbox/lucy-k8s-integration-delivery-<后缀>.tar.gz` 及其 `.sha256`、`.verification.json` | 新后缀，不覆盖 r6。含 Chart、部署与验收脚本、`CUSTOMER-UPGRADE.md`、`ACCEPTANCE.md`、`examples/RECOVERY.open-mode.md`、HTTPS 实例样例 |
| 私有引导密钥附件 | `~/.lucy/customer-deliveries/` 下与该包绑定的目录和 `.tar.gz`，外加 C20 证据 | 目录 0700、文件 0600。含密钥、签发状态、凭据元数据、`scripts/prepare.sh` 和说明。日志与通用包都不含密钥正文 |
| 随包文档 | 打进软件包的 `CUSTOMER-UPGRADE.md`、`ACCEPTANCE.md`、`RELEASE_NOTES.md`、HTTPS 样例 | 写明内容根、信任代理、保留现场 Service，以及用附件准备实例。不再把实验室端口 8276/8277 写成这个客户的必改项 |

候选后缀使用 `--version-suffix`，不要用默认的 `20260902-v3`，也不要使用 `-v1` / `-v2`。建议 `20261021-r7`。验收失败后换新后缀，从出包整段重跑，不覆盖已有 tar。

## 3. 必须先改的代码和文档

只改下列文件。当前工作区里与本计划无关的改动不进入这次提交。

### 3.1 构建上下文

恢复 r6 提交 `7de67e7` 里有、当前 HEAD 没有的递归排除，加回 `.dockerignore`：

```text
**/.ktx
**/.ktx-ui
**/:memory:
**/.mcp.json
**/.env
**/.env.local
**/.env.*.local
webui/config/access.yaml
webui/config/admins.yaml
```

根上的 `.ktx`、`.ktx-ui` 保留。`Dockerfile` 在 `COPY . .` 之后不删除这些路径，所以排除必须发生在构建上下文。

`scripts/smoke/lucy-delivery-isolation-smoke.mjs` 现有的匹配器只认完整路径前缀，不认 `**/`。扩展匹配器，并增加断言：`webui/:memory:/.ktx-ui/security.sqlite` 被忽略。同步更新 `lucy-delivery-isolation-smoke.test.mjs`。镜像建成后的 denylist 增加 `/app/webui/:memory:`。

### 3.2 Chart 渲染信任代理

在 `deploy/k8s/helm/lucy/templates/_helpers.tpl` 的 `lucy.composeEnv` 中，按 `LUCY_CONTENT_ROOT` 的同一方式渲染：

- `env.LUCY_TRUST_PROXY`
- `env.LUCY_TRUSTED_PROXY_CIDRS`

未设置时不输出空变量。`extraEnvFrom` 继续只表示 ConfigMap 或 Secret 引用，不拿它传递这两个标量。

### 3.3 升级白名单

`scripts/deploy/customer-deployment-helper.py` 的 `deployment_values()` 在升级时，除现有镜像、产品版本、`LUCY_PUBLIC_MCP_URL`、`security.access` 之外，只允许从新实例配置写入这三个环境变量：

- `LUCY_CONTENT_ROOT`
- `LUCY_TRUST_PROXY`
- `LUCY_TRUSTED_PROXY_CIDRS`

新配置里的其他 `env` 键、Service 类型和 Service 端口仍以现场旧值为准。旧值里已有的内容根，在新配置提供同名键时被新值替换。

约束：

- `access` 为 `https` 且 `intent` 为 `upgrade` 时，`LUCY_TRUST_PROXY` 必须是 `1`、`true` 或 `yes`，`LUCY_TRUSTED_PROXY_CIDRS` 必须非空，否则 `TRUST_PROXY_REQUIRED`。
- `LUCY_CONTENT_ROOT` 只允许省略或 `"."`，其他值 `CONTENT_ROOT_INVALID`。省略表示使用镜像默认的 `config/` 布局。
- 实验室端口 8276/8277 不写入这个客户的升级结果。

`scripts/deploy/test_customer_deployment.py` 补上：白名单写入这三项、忽略新配置里的其他 env 和 Service 改动、https 升级缺少信任代理时失败、Helm 渲染结果含这两个变量名。现有 https 升级夹具要带上合法的信任代理值。

### 3.4 随包文档

- `deploy/k8s/CUSTOMER-UPGRADE.md`：先 `ls /data/lucy` 再填内容根；信任代理来自已核对的网关出口网段；Service 类型和端口保持现场值，容器端口仍是 5174/7879；HTTPS 样例、`externalTlsReviewed`、私有 CA 分支保持 v0.3；准备实例使用附件里的 `scripts/prepare.sh`，不要自行生成引导密钥；恢复文件从 `examples/RECOVERY.open-mode.md` 复制为实例目录中的 `RECOVERY.md`。
- `deploy/k8s/examples/instance.upgrade.https.example.json` 的 `values.env` 增加占位：`LUCY_TRUST_PROXY` 为 `"1"`，`LUCY_TRUSTED_PROXY_CIDRS` 和内容根使用 `MUST-REPLACE` 占位。不写真实域名、网段或密钥。
- `scripts/gates/verify-customer-upgrade-package.py` 在合成归档回归里把这两个占位换成 `"."` 和文档网段 `192.0.2.0/24`，再跑 dry-run。样例文件本身仍保持占位。
- `deploy/k8s/ACCEPTANCE.md` 增加两条：Pod 环境里有内容根决定和信任代理变量；Service 类型与端口相对基线未变。
- `scripts/gates/build-k8s-delivery-package.sh` 写入的 `RELEASE_NOTES.md` 去掉「端口保持 8276/8277」这一句。改为：容器端口 5174/7879，Service 类型和 Service 端口保持现场值。

## 4. 核心流程（伪代码）

```text
确认本计划已批准，且工作区里将要提交的差异只含第 3 节文件：
  跑隔离冒烟、helper 单测、Helm 渲染断言
  失败则停止，不打镜像

干净提交 S：
  git status 无输出
  镜像入口使用 S 的完整 SHA

在 Apple Silicon 上构建镜像：
  bash scripts/release/build-customer-amd64-image.sh
  平台参数由该脚本固定为 linux/amd64
  禁止 --no-cache，禁止 docker buildx create --use，禁止 FROM --platform=$BUILDPLATFORM
  G1、G2 必须通过
  QEMU signal 11 不作废已构建镜像，也不改去复用 r6 或历史 tar
  BUILD_REVISION 必须等于 S，不能是 S-dirty

组装候选包（仍在 Mac）：
  选择这个客户已登记的稳定 slug
  若 ~/.lucy/customer-credentials/customers/<slug>.json 已有 instanceId，必须复用
  首次才由附件入口登记，重试不得换 slug
  bash scripts/gates/build-k8s-delivery-package.sh
    --image-tag <上一步镜像>
    --version-suffix <新后缀>
    --output inbox/lucy-k8s-integration-delivery-<新后缀>.tar.gz
    --delivery-mode offline
    --customer <slug>
    --skip-ktx-exec
  不传 --public-release
  不传 --existing-admin
  脚本在归档回归后生成或复用私有附件并跑 C20
  失败则删除本次未完成 tar，不回退到 r6

核对三件套，不打印密钥：
  软件包 SHA、BUILD-INFO 的 commit 等于 S
  附件 .c20.json 为通过，附件绑定的包 SHA 等于软件包
  解包后文档含内容根、信任代理、现场 Service 和附件准备入口
  镜像层路径不含 /app/webui/:memory:

原生 amd64（本计划不在 Mac 上宣称完成）：
  G4、G4b
  按 v0.3 P0-3 至 P0-6 用这一套包做升级和恢复
  productionReady 仍为 false 时，不把候选包称为客户放行包
```

## 5. 明确不做

- 不修改 KTX 源码。
- 不把引导密钥写入镜像、Git、inbox、构建上下文或公共上传目录。
- 不读取或打印 `security.sqlite` 和引导密钥的内容。
- 不使用 r6 镜像配这次提交出包。
- 不在客户现场成功之后做恢复演练。恢复演练只发生在原生 amd64 的候选包验收里。
- 不把客户 Service 改成 LoadBalancer，也不改成 8276/8277。
- 不在内容根和网关出口网段尚未在现场或原生环境填入之前，把某个猜测值写进放行 values。样例只保留占位符。

## 6. 验收

- 隔离冒烟拒绝 `webui/:memory:/.ktx-ui/security.sqlite` 进入构建上下文。
- `deployment_values()` 的 https 升级结果含三项环境变量，且 Service 与旧值一致。
- `helm template` 输出含 `LUCY_TRUST_PROXY` 和 `LUCY_TRUSTED_PROXY_CIDRS`。
- 干净提交上的镜像 G1、G2 通过，`BUILD_REVISION` 等于该提交。
- 候选包与私有附件成套，C20 通过，软件包内没有密钥正文。
- 随包文档能让部署人员完成：复制 `RECOVERY.md`、用附件 `prepare.sh` 准备实例、填写内容根和信任代理、保持现场 Service。

## Terminology Compliance

This plan follows `webui/docs/00-product-terminology-standard.md`.

New terms: None. 「附属登录密钥」即既有「引导密钥」。沿用「私有交付附件」「首次创建所有者」「实例」。
