# Lucy 2.0 升级恢复操作

部署人员填写本文件并保存为实例配置同目录的 `RECOVERY.md`，先在同类测试环境演练。适用旧开放模式、从未创建管理员的原 PVC 恢复。

## 升级前填写

- 实例/context/namespace/release/Deployment/PVC：填写真实资源名。
- 原镜像、原 Helm revision、原镜像离线包存放位置：填写并确认可导入。
- 客户目录、备份另存位置及空间：填写。部署入口停机备份保存在 `.deployment/`。
- 数据库/拉取/TLS/Bootstrap Secret 的保管位置与负责人：填写，不写凭据。
- 维护窗口、入口隔离/开放负责人、升级后变更及撤销状态核对负责人：填写。

## 1 隔离访问并验证恢复点

隔离 WebUI/MCP 入口并停止所有写入。保留失败部署目录和 Secret。恢复旧快照会撤回新增账号、业务修改和 Token 撤销，先记录并处理这些变化；未核对安全状态前不重新开放旧开放模式。

在原客户目录执行以下命令，从保存的实例和原始恢复点读取变量。不要在通用包目录执行，也不要用当前失败 Pod 猜测旧版本：

```bash
set -Eeuo pipefail
field() {
  python3 - "$1" "$2" <<'PY'
import json, sys
with open(sys.argv[1]) as f: print(json.load(f)[sys.argv[2]])
PY
}
CTX="$(field instance.json context)"
NS="$(field instance.json namespace)"
RELEASE="$(field instance.json release)"
DEPLOY="$(field instance.json deployment)"
PVC="$(field instance.json pvcName)"
NODE="$(field .deployment/baseline.json node)"
BASELINE_IMAGE="$(field .deployment/baseline.json image)"
BASELINE_REVISION="$(field .deployment/baseline.json revision)"
BACKUP=".deployment/$(field .deployment/initial-backup.json file)"
EXPECTED_SHA256="$(field .deployment/initial-backup.json sha256)"
RESTORE_POD=lucy-recovery
```

备份校验失败立即停止：

```bash
python3 - "$BACKUP" "$EXPECTED_SHA256" <<'PY'
import hashlib, sys, tarfile
from pathlib import PurePosixPath
h = hashlib.sha256()
with open(sys.argv[1], 'rb') as f:
    for b in iter(lambda: f.read(1024 * 1024), b''): h.update(b)
assert h.hexdigest() == sys.argv[2], 'BACKUP_CHECKSUM_MISMATCH'
with tarfile.open(sys.argv[1], 'r:gz') as t:
    names = [m.name for m in t.getmembers()]
    assert any(n in ('./ktx.yaml', 'ktx.yaml') for n in names)
    assert all(not PurePosixPath(n).is_absolute() and '..' not in PurePosixPath(n).parts for n in names)
print('backup verified')
PY
helm --kube-context "$CTX" -n "$NS" history "$RELEASE"
```

确认原 revision 仍在 history，旧镜像在原节点 containerd 中，必要时从原离线包导入。原 revision 已被清理时不执行下面 rollback，交由恢复负责人使用原 Chart/Helm release 资料及受限 `baseline-values.json` 还原，不能使用新 Chart 假冒旧版本。

## 2 停机并挂载原卷

```bash
kubectl --context "$CTX" -n "$NS" scale deployment "$DEPLOY" --replicas=0
kubectl --context "$CTX" -n "$NS" wait --for=delete pod \
  -l "app.kubernetes.io/instance=$RELEASE" --timeout=180s
python3 - "$NS" "$RESTORE_POD" "$PVC" "$NODE" "$BASELINE_IMAGE" <<'PY' | kubectl --context "$CTX" -n "$NS" create -f -
import json, sys
ns, name, pvc, node, image = sys.argv[1:]
print(json.dumps({'apiVersion':'v1','kind':'Pod','metadata':{'namespace':ns,'name':name},'spec':{
  'nodeName':node,'restartPolicy':'Never','containers':[{'name':'restore','image':image,'imagePullPolicy':'Never',
  'command':['/bin/sh','-c','sleep 3600'],
  'securityContext':{'runAsUser':0,'runAsNonRoot':False,'allowPrivilegeEscalation':False,
    'capabilities':{'drop':['ALL'],'add':['CHOWN','DAC_OVERRIDE','FOWNER']}},
  'volumeMounts':[{'name':'data','mountPath':'/data/lucy'}]}],
  'volumes':[{'name':'data','persistentVolumeClaim':{'claimName':pvc}}]}}))
PY
kubectl --context "$CTX" -n "$NS" wait --for=condition=Ready "pod/$RESTORE_POD" --timeout=120s
umask 077
kubectl --context "$CTX" -n "$NS" exec "$RESTORE_POD" -c restore -- \
  tar -C /data/lucy -czf - . > failure-state-before-restore.tgz
```

上一步先保存失败现场，保护升级后的账号、审计和修改。该文件也是敏感备份。确认命令成功和归档可读取后再继续。

## 3 替换卷内容并恢复旧版本

以下命令替换原 PVC 内容。仅在初始备份已校验、失败现场已保存且恢复负责人确认后执行。先清理新增文件再还原；覆盖解压会留下新管理员和安全库。

```bash
kubectl --context "$CTX" -n "$NS" exec "$RESTORE_POD" -c restore -- \
  sh -ec 'find /data/lucy -mindepth 1 -maxdepth 1 ! -name lost+found -exec rm -rf -- {} +'
kubectl --context "$CTX" -n "$NS" exec -i "$RESTORE_POD" -c restore -- \
  tar -C /data/lucy -xzpf - < "$BACKUP"
kubectl --context "$CTX" -n "$NS" exec "$RESTORE_POD" -c restore -- \
  sh -ec 'test -f /data/lucy/ktx.yaml; test ! -e /data/lucy/.ktx-ui/security.sqlite'
kubectl --context "$CTX" -n "$NS" delete pod "$RESTORE_POD" --wait=true
helm --kube-context "$CTX" -n "$NS" rollback "$RELEASE" "$BASELINE_REVISION" --wait --timeout 15m
kubectl --context "$CTX" -n "$NS" rollout status "deployment/$DEPLOY" --timeout=600s
```

任一步骤失败立即停止，不继续启动旧服务。tar 以受限 root 还原归档属主/权限，不执行任意整卷 chown。原管理员文件应恢复为原来的缺失或空状态；不单删管理员文件代替完整恢复。

## 4 验证并重新开放

核对原镜像、PVC UID、端口、连接、内容、MCP Token、允许与拒绝查询及旧开放状态，确认新安全库没有残留。保持入口隔离，核对升级后安全变更的处置结果，访问边界由负责人确认后才开放。

Bootstrap Secret、原状态目录和密钥默认保留；不要因回退删除或重新签发。再次升级使用原实例记录，绑定或状态异常先由部署人员核对。

记录旧/新/恢复后镜像身份、revision、备份哈希、时间、执行人和验收结果，不上传备份、values 或凭据到普通报告。
