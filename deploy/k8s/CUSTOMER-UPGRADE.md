# Lucy 2.0 客户原地升级

适用：linux/amd64 Kubernetes/K3s、单副本、原 PVC 保留、旧开放模式且从未创建管理员。当前产品 2.0.0、Chart 0.2.6、KTX 0.16.0。升级包含停机备份和 Recreate 切换，请安排维护窗口。

本包提供正式环境使用的部署文件。最终镜像在同类原生 amd64 测试环境完成 `ACCEPTANCE.md` 的升级与恢复记录后，才进入正式维护窗口。构建通过不代表客户升级已验收。通用包没有引导密钥；密钥在实例准备时按实例签发或复用。

每包执行 `UPGRADE-RELEASE-CHECKLIST.md`。失败会输出阶段、错误码和异常类型，并在实例目录 `.diagnostics/` 保存 0600 的脱敏诊断（目录 0700，位于校验的软件目录之外）。诊断只保留调用位置，不保存异常消息、命令输出或凭据。不要现场修改脚本和摘要绕过绑定，应从供应方修正版重新准备实例并复用原签发状态。

## 1 准备目录与现场信息

部署机需要 Bash、Python 3.8+、kubectl、Helm。节点需要 K3s/containerd；自动导入要求本机或映射的 SSH 主机可免交互执行 `sudo -n k3s ctr images import -`。手动导入过镜像也不能省略该权限。多节点映射必须覆盖所有可调度节点。

将包解压到 Git 仓库、`inbox`、缓存之外的目录，使用真实路径。以下路径为示例，请替换：

```bash
PACKAGE=/opt/lucy/lucy-k8s-integration-delivery-20261020-r3
PRIVATE=/opt/lucy-private
umask 077
mkdir -p "$PRIVATE/config" "$PRIVATE/state"
chmod 700 "$PRIVATE" "$PRIVATE/config" "$PRIVATE/state"
cd "$PACKAGE"
sha256sum -c SHA256SUMS
cp examples/instance.upgrade.https.example.json "$PRIVATE/config/instance.json"
cp examples/RECOVERY.open-mode.md "$PRIVATE/config/RECOVERY.md"
```

内网 HTTP 使用 HTTP 样例；HTTPS 使用 HTTPS 样例。顶层 `access` 是访问方式事实源，两个 URL 的协议必须一致。HTTPS 的证书/网关由现场已有设施提供，包不自动搭建 TLS。外部 TLS 网关已验证时设置 `externalTlsReviewed: true`；已有 Ingress TLS 保留原 values。私有 CA 在实例 JSON 配置 `tlsCaFile`，路径相对该 JSON；工具校验证书并复制为客户目录内的 `tls-ca.pem`。没有私有 CA 时删除该字段，使用系统信任库。不要填写证书私钥。

填写稳定且唯一的 `instanceId`、context、namespace、release、Deployment、Service、PVC、Bootstrap Secret 名称、实际访问地址和 `offlineNodes`。不要沿用另一实例的状态目录。旧 values 从现场 Helm 读取，原端口、Secret、内容根和 PVC 管理方式保留；升级样例不覆盖这些值。

以下查询只读，使用实际 context 和名称：

```bash
CTX=actual-context
NS=actual-namespace
DEPLOY=actual-deployment
PVC=actual-pvc
RELEASE=actual-release
kubectl --context "$CTX" -n "$NS" get namespace "$NS" -o jsonpath='{.metadata.uid}{"\n"}'
kubectl --context "$CTX" -n "$NS" get deployment "$DEPLOY" -o jsonpath='{.metadata.uid}{"\n"}{.spec.template.spec.containers[0].image}{"\n"}'
kubectl --context "$CTX" -n "$NS" get pvc "$PVC" -o jsonpath='{.metadata.uid}{"\n"}'
helm --kube-context "$CTX" -n "$NS" history "$RELEASE"
```

将三个 UID 和旧镜像填入 JSON，`recovery.baselineImage` 与 `baselineImage` 一致。确认旧 PVC 没有管理员、没有安全库且属于真实历史基线后才设置 `legacyBaselineReviewed: true`。损坏、停用、引导已消费等状态进入维护恢复，不能删除文件强制认领。填好恢复说明中的现场字段、备份空间及旧镜像来源，不写连接密码或 Token。

## 2 准备实例并预检

```bash
python3 "$PACKAGE/scripts/prepare-customer-instance.py" \
  --base-package "$PACKAGE" --instance-config "$PRIVATE/config/instance.json" \
  --state-dir "$PRIVATE/state" --output "$PRIVATE/delivery-r3"
cd "$PRIVATE/delivery-r3"
bash scripts/deploy.sh --dry-run
```

准备命令不修改集群。输出目录必须不存在；同实例重打包换新输出路径，保留 `instanceId`、状态目录及签发记录。已签发配置可使用 `credentialState: issued`。部署重试则直接在原客户目录重跑，保留 `.deployment-binding.json` 和 `.deployment/`。不要删除状态目录或换实例名解决失败。

dry-run 检查绑定、旧状态、Secret 引用、节点及 Chart 渲染，不创建 Secret、不缩容、不升级。它不代替备份、导入权限和业务验收。当前 kubectl context 必须与实例配置一致；脚本不会切换全局 context。

## 3 升级与创建管理员

```bash
cd "$PRIVATE/delivery-r3"
bash scripts/deploy.sh
```

脚本先导入镜像，再停止旧 Pod、只读挂载备份整个 PVC，然后配置引导 Secret 并运行 Helm。K3s 使用 containerd，不使用节点上的 `docker load`。如需提前导入，在所有目标节点运行 `sudo k3s ctr images import <image.tar>`；自动入口仍会核对并导入。

`.deployment/` 保存敏感的原版本记录 `baseline.json`、原 Helm values `baseline-values.json`、首份备份记录 `initial-backup.json`、`backup-*.tgz` 及 `result-*.json`。备份含密码和客户数据，限制访问并另存到可靠位置，不上传普通报告。重试不会把候选版本记成原基线或覆盖初始恢复点。

成功后打开实际 WebUI `/login`。指定所有者从受限文件 `credentials/webui-bootstrap-token` 领取密钥并自行设置账号密码。密钥不粘贴进命令、values、工单、日志或公共聊天。已有管理员直接登录。

## 4 验收与恢复

按 `ACCEPTANCE.md` 完成认领、登录持久性、原 Token/权限和业务验证后才开放正常访问。

预检或备份失败且未开始 Helm 时，脚本尝试恢复旧副本。Helm 开始后失败或后置检查失败，先核对当前镜像和阶段结果，不能认定 Helm 已回滚。`--atomic` 不恢复 PVC。恢复使用客户目录 `RECOVERY.md`，先隔离访问、保存失败现场，再还原初始备份。

认领后或有业务/权限变更时，恢复旧快照会撤回这些变化，可能使 Token 撤销状态回退。先记录并处理这些变化；旧开放模式不得在未经确认的访问边界下重新开放。

## 镜像身份

`image/image-identity.json` 记录 tar 内验证得到的 config digest、amd64 manifest digest 及可选 index digest。它们代表不同对象；不能把 Docker `.Id` 一律视为 config digest。部署只接受该候选镜像的已验证身份。离线 Helm `image.digest` 为空，Registry 模式才使用已发布 registry digest。
