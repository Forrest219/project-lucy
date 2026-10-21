# Lucy 2.0 全新部署包生成计划

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 2.0 全新部署包生成计划 |
| 文档类型 | Implementation Plan |
| 版本 | v0.2 |
| 撰写日期 | 2026-10-21 |
| 状态 | 执行中：第 3 节纳入本次提交。候选包在原生 amd64 的 G3/G4/G4b/G8 与 F4 完成前不交给客户 |
| 适用范围 | 为一条空集群全新安装路径生成 Lucy 2.0.0 / Chart 0.2.6 / KTX 0.16.0 的 linux/amd64 镜像、私有引导密钥附件和随包文档 |
| 关联 | 现役环境的平滑升级仍走 [升级包生成计划](2026-10-21-customer-20260828-v1-upgrade-package-plan.md) 的 `20261021-r7` 与 [升级计划 v0.3](2026-10-21-customer-20260828-v1-to-lucy-2.0-upgrade-plan.md) 的 P0-3 至 P0-6。引导密钥规则见 [出包时配套生成引导密钥](2026-10-20-build-time-bootstrap-credential-plan.md) |

两条路径同时保留，产物互不覆盖。

| 路径 | 已有或计划中的包 | 逻辑实例 | 交给客户前的验收 |
|---|---|---|---|
| 平滑升级 | `20261021-r7`，镜像 `a93880e`，实例 `lucy-customer-20261020-4986aeea` | 现役 `20260828-v1` | v0.3 P0-3 至 P0-6 |
| 全新部署 | 本计划的新后缀、新镜像、新附件 | 新 slug `customer-fresh` 签发的新实例 | 原生 amd64 补跑 G3/G4/G4b/G8，再完成本计划 F4 |

## 1. 结论

1. **`20261009-v1` 不作为这次的全新部署包。** 它是 Lucy 0.17.0 / Chart 0.2.4，空环境无管理员时是开放模式，没有引导密钥。
2. **r7 按交付规则不得转作新实例安装包。** 准备入口绑定实例和软件包身份，不绑定安装或升级意图。不得借修改 `intent` 复用现役实例身份与密钥。slug `customer` 会复用 `lucy-customer-20261020-4986aeea`。
3. **安装入口已经存在，缺的是全新部署合同。** `intent=install` 会整份采用新 values。首次安装要求目标里还没有同名 Deployment、PVC 和 Helm release；同名 Service 的安装前拒绝是本次新增检查。PVC 名必须是 `<deployment>-data`，并且不能填写 `existingClaim`。同一私有目录已有绑定文件时，可以恢复已绑定的安装。HTTPS 且 Chart Ingress 关闭时，已有检查会要求 `externalTlsReviewed=true`。信任代理的失败关闭目前只做在升级意图上。
4. **本计划的完成物在 F4 之前仍是候选包。** Mac 可以打 linux/amd64 镜像并组装 tar 与附件。本地归档回归固定写出 `productionReady=false` 和 `nativeAmd64UpgradeAndRecovery=PENDING_DEPLOYER_ACCEPTANCE`。全新安装放行由独立记录表达，升级恢复字段保持待验。

## 2. 交付物

| 交付物 | 落点 | 完成标准 |
|---|---|---|
| linux/amd64 镜像 | `project-lucy:customer-amd64-2.0.0-<日期>-<短提交>` | 构建脚本退出 0 时，其自身的 G1–G4b 与 G8 已在该机构建中执行。`/app/BUILD_REVISION` 等于这次干净提交，不带 `-dirty`。构建脚本因 QEMU 失败退出时，只保留候选镜像，不把该退出当成全门禁通过，也不出包 |
| 候选软件包 | `inbox/lucy-k8s-integration-delivery-20261022-fresh.tar.gz` 及 `.sha256`、`.verification.json` | 新后缀。不覆盖 r6、r7。含 Chart、`CUSTOMER-INSTALL.md`、HTTP/HTTPS 安装样例 |
| 私有引导密钥附件 | `~/.lucy/customer-deliveries/` 下绑定该包和 slug `customer-fresh` 的目录与 tar | 目录 0700、文件 0600。C20 通过。附件含安装说明和安装样例。日志和通用包都不含密钥正文 |
| 随包说明 | 安装样例、`CUSTOMER-INSTALL.md`、`RELEASE_NOTES.md` | 写明空 PVC、内容根留空、Service 由新环境选择、HTTPS 信任代理、首个所有者认领 |

后缀使用 `--version-suffix 20261022-fresh`。脚本拒绝 `-v1` / `-v2`。验收失败后换新后缀，从第 4 节的镜像构建重新执行，不覆盖已有 tar。

出包命令在工作区干净、镜像身份与 HEAD 一致之后执行：

```bash
bash scripts/gates/build-k8s-delivery-package.sh \
  --delivery-mode offline \
  --customer customer-fresh \
  --version-suffix 20261022-fresh \
  --image-tag project-lucy:customer-amd64-2.0.0-<日期>-<短提交> \
  --output inbox/lucy-k8s-integration-delivery-20261022-fresh.tar.gz \
  --skip-ktx-exec
```

不传 `--public-release`，不传 `--existing-admin`。slug 使用 `customer-fresh`。`--skip-ktx-exec` 只跳过封包后 K6 的后续执行块（shell、G4、G4b、G8）；导入后的 G1 和 G2 仍执行。镜像构建脚本自己的门禁不因该参数跳过。

## 3. 必须先改的代码和文档

只改下列文件。当前工作区里与本计划无关的改动不进入这次提交。r7 的 tar、校验 JSON 和私有附件保持原样。

- `scripts/deploy/customer-deployment-helper.py`
- `scripts/deploy/test_customer_deployment.py`
- `scripts/deploy/test_final_upgrade_package.py`
- `deploy/k8s/examples/instance.install.https.example.json`
- `deploy/k8s/examples/instance.install.http.example.json`
- `deploy/k8s/CUSTOMER-INSTALL.md`
- `scripts/gates/build-k8s-delivery-package.sh`
- `scripts/gates/verify-customer-upgrade-package.py`
- `scripts/gates/verify-k8s-package.sh`
- `scripts/gates/customer_deployment_fixture.py`
- `scripts/gates/build-k8s-delivery-package.test.mjs`
- `scripts/release/build-bootstrap-attachment.mjs`
- `scripts/gates/verify-bootstrap-attachment.py`
- 本计划与 `docs/plans/README.md` 中本计划的索引行

### 3.1 安装意图的失败关闭

在 `scripts/deploy/customer-deployment-helper.py` 的安装分支：

- `intent=install` 且 `access=https` 时，`LUCY_TRUST_PROXY` 必须是 `1`、`true` 或 `yes`，`LUCY_TRUSTED_PROXY_CIDRS` 必须非空，否则 `TRUST_PROXY_REQUIRED`。
- `intent=install` 时，`LUCY_CONTENT_ROOT` 只能省略或空字符串。出现 `"."` 或其他值时返回 `CONTENT_ROOT_INVALID`。空值使用 Chart 默认的 `config/` 布局。
- HTTP install 从生成的 `values.env` 显式删除 `LUCY_TRUST_PROXY` 和 `LUCY_TRUSTED_PROXY_CIDRS`。测试输入预先包含这两键，断言生成结果和 Pod 渲染都不含这两键。
- 首次 install 查询同名 Service。Deployment、PVC、Helm release 或 Service 任一已存在，则在部署写操作前返回 `INSTALL_RESOURCE_COLLISION`，并增加冲突回归。同一私有目录已有绑定文件时的恢复安装保持原行为。
- 安装继续整份采用实例 values。Service 类型和 Service 端口来自新环境填写的值，不从任何旧现场复制。

### 3.2 安装样例与回归

新增：

- `deploy/k8s/examples/instance.install.https.example.json`
- `deploy/k8s/examples/instance.install.http.example.json`

两份都是 `intent=install`、`authState=uninitialized`、`credentialState=new`。资源名使用可替换占位，且 `pvcName` 等于 `<deployment>-data`。不写 `namespaceUid`、`deploymentUid`、`pvcUid`、`baselineImage`、`backup`、`recovery`、`existingClaim`。内容根键省略。

HTTPS 样例：

- `access`、`webuiUrl`、`publicMcpUrl` 都是 `https`
- `externalTlsReviewed` 保持待填写的 false，由部署人员在核对外部网关后改为 true
- `values.env` 含 `LUCY_TRUST_PROXY` 为 `"1"`，`LUCY_TRUSTED_PROXY_CIDRS` 为网关出口 CIDR 占位
- 不写真实域名、真实 CIDR、密钥

HTTP 样例不写信任代理变量。`security.access` 与 `access` 一致。`insecureHttpTestProfile` 不出现。

`scripts/gates/build-k8s-delivery-package.sh` 把这两份样例和 `CUSTOMER-INSTALL.md` 打进软件包。`scripts/gates/verify-k8s-package.sh` 把它们列为包内必有文件。

`scripts/gates/verify-customer-upgrade-package.py` 保留现有升级回归，并新增 HTTP/HTTPS install 回归：读取安装样例；合成演练只在临时副本里把 HTTPS 占位换成 `LUCY_TRUST_PROXY=1`、`LUCY_TRUSTED_PROXY_CIDRS=192.0.2.0/24`、`externalTlsReviewed=true` 和合法 URL；夹具返回目标 Deployment、PVC、Service 和 Helm release 不存在；验证新 values、PVC 创建、代理门禁，以及完整 `deploy.sh --dry-run`。另有一条同名 Service 已存在的回归，必须在写操作前失败。样例文件本身保持占位。

`scripts/release/build-bootstrap-attachment.mjs` 把安装说明和两份安装样例放进私有附件，README 写明空环境使用安装样例。`scripts/gates/verify-bootstrap-attachment.py` 在保留升级演练之外，验证安装样例能够完成准备，并在空资源夹具上通过 `deploy.sh --dry-run`。

### 3.3 安装说明

新增 `deploy/k8s/CUSTOMER-INSTALL.md`，只描述空环境：

- 目标 namespace 中还没有同名 Deployment、PVC、Service 和 Helm release。同名 Service 的拒绝是本次新增的安装前检查。
- 使用私有附件的 `scripts/prepare.sh`。部署人员填写 context、访问地址和节点映射，不填写 `instanceId`，不自行生成密钥。
- 内容根留空。`semantic-layer/`、`wiki/`、`skills/` 落在 `/data/lucy/config/`。
- 容器端口保持 WebUI 5174、MCP 7879。Service 类型和 Service 端口由新环境选择。Chart 默认是 ClusterIP，Service 端口与容器端口相同。KTX 7878 不进入 Service。
- Chart Ingress 关闭时，HTTPS 必须先核对外部网关：`/` 到达 WebUI，`/mcp` 到达 7879，然后把 `externalTlsReviewed` 设为 true。私有 CA 填写 `tlsCaFile`，公有 CA 省略。
- HTTPS 设置 `LUCY_TRUST_PROXY=1` 和已核对的网关出口 CIDR。HTTP 安装会从生成结果中删除这两个变量。
- `LUCY_PUBLIC_MCP_URL` 写成这套新环境里 Agent 实际访问的地址。
- 空 PVC 首次启动会种入镜像里的 `customer-config.example`：示例连接 `customer-db`、口令文件 `/data/lucy/.ktx/secrets/customer-db-password`、示例语义层。预期在无数据库口令文件时完成启动与认领，须由 F4 实测确认；失败则阻断交付并修订方案。示例连接不是客户业务数据。正式取数前由所有者替换连接、写入数据库口令 Secret，并重建索引。`LUCY_ALLOW_PLACEHOLDER_KTX` 保持关闭。
- 认领前 `/api/auth/status` 为 bootstrap。首个登录账户是所有者。重复认领被拒绝。其余管理面账户由所有者建成运维人员。未配置数据库 Secret 时，Chart 不渲染 `secrets-sync`。

`RELEASE_NOTES.md` 的生成段落增加一条：全新安装读 `CUSTOMER-INSTALL.md`；`20260828-v1` 的现场升级继续使用已经发出的 r7 候选身份，不改用本包。

## 4. 构建与出包

1. 按行或编辑补丁暂存本计划索引及本次范围内文件，核对 cached diff。将剩余无关差异及无关未跟踪文件 stash，保留已暂存内容。提交后确认工作区干净，再构建。出包后按记录的 stash 身份恢复并核对。
2. 用缓存构建 linux/amd64 镜像。构建参数沿用 r7 已验证的国内源：

```bash
APT_MIRROR=mirrors.tuna.tsinghua.edu.cn \
NPM_REGISTRY=registry.npmmirror.com \
UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple/ \
bash scripts/release/build-customer-amd64-image.sh
```

镜像内的默认回退仍是官方源短超时后依次尝试清华、阿里云、腾讯。显式传入上述三个参数时，这次构建只使用这些源。

3. 构建机禁止 `--no-cache`、`docker buildx create --use`、`FROM --platform=$BUILDPLATFORM`。QEMU `signal 11` 不把已建成的镜像作废，也不回退到 r6 或 r7 的 tar。构建脚本因此非零退出时，不出包。
4. 按第 2 节出包。C20 必须通过，并且附件绑定的包 SHA256 等于新 tar。密钥正文不打印、不进入 Git、不进入 `inbox/`。
5. 出包后恢复第 1 步记录的 stash。那些文件不提交。

这次提交会改变 HEAD，因此不能把 r7 镜像 `a93880e` 塞进新包。r7 保持它自己的镜像和包 SHA256。

## 5. 交给客户前的空集群验收（F4）

在原生 amd64 上，先从最终 tar 导入同一镜像，补齐封包时跳过的 G3、G4、G4b 和 G8，并记录离线 Python/KTX 功能结果。然后在新 namespace 上，用本计划这一个包和它的私有附件执行下面的安装验收。合成集群渲染和 Mac 上的 QEMU 门禁不能代替这一节。

| # | 动作 | 判定 |
|---|---|---|
| F4-1 | `scripts/deploy.sh --dry-run`，再 `scripts/deploy.sh` | 两步退出 0。dry-run 不创建 Secret、不安装 |
| F4-2 | 新 PVC 由 Chart 创建，名为 `<deployment>-data` | 没有旧卷，没有第二套 Deployment 或 Service |
| F4-3 | Pod `1/1 Ready`；`/api/health` 200 且 `bundledKtxVersion=0.16.0` | 实际渲染出的 init 全部退出 0。未配置数据库 Secret 时，`secrets-sync` 不存在 |
| F4-4 | 容器端口 5174 / 7879；7878 不在 Service | `LUCY_PUBLIC_MCP_URL` 与实例配置一致，状态不是 fallback |
| F4-5 | 内容根未设置；HTTPS 时 Pod 含信任代理和所填 CIDR | HTTP 安装不含这两个变量 |
| F4-6 | 认领前状态为 bootstrap；正确密钥创建首个所有者；重复认领返回 409 | 错误密钥不能创建所有者 |
| F4-7 | 退出后可重新登录；Pod 重启后仍能登录且不重新认领、不轮换密钥 | 未认证的管理 API 被拒绝 |
| F4-8 | HTTPS 请求带 `Origin: https://<新域名>` 调用登录或引导接口 | 状态不是 403，错误码不是 `CSRF_ORIGIN_DENIED`。不用 `curl -k` |
| F4-9 | 无 Token 调用 MCP | 返回 401。此项是安装放行的必验项 |
| F4-10 | 所有者替换示例连接并写入口令后，一条允许的查询返回 | 交付后的业务验收。安装放行不宣称取数已通过。未做时记录为未验收 |

F4-1 至 F4-9 通过后，另写一份全新安装验收记录，记入该包的包名、提交、包 SHA256 和镜像 digest，并写明 F4-10 未完成或已通过。这时才可以把该 tar 与对应私有附件交给新环境的部署人员。记录不把 `nativeAmd64UpgradeAndRecovery` 改成通过，也不把 r7 标成可发放。无数据库口令时若 Pod 不能就绪，F4-3 失败，阻断交付并修订方案。

## 6. 不做的事

- 不修改 KTX 源码。
- 不把 r7 或 `20261009-v1` 重新打包成全新部署包。
- 不复用、不打印、不轮换升级实例的引导密钥。
- 不把实验室端口 8276/8277 写成新环境的必改项。
- 不在客户现场用这份包做 `20260828-v1` 的原地升级。那条路径继续等 r7 的 P0-3 至 P0-6。
- 不在 Mac 上把 `productionReady` 改成 true。
