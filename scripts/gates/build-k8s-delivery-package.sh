#!/usr/bin/env bash
# Build a clean Lucy K8s integration delivery tarball (v3+ layout).
#
# Prerequisites:
#   - Image already built and passed G0–G8 (see docs/runbooks/customer-amd64-image-build-checklist.md)
#   - bash scripts/gates/helm-lucy-gate.sh passes (H1)
#
# Usage:
#   bash scripts/gates/build-k8s-delivery-package.sh \
#     --image-tag project-lucy:customer-amd64-0.17.0-20260902-b262798 \
#     --output inbox/lucy-k8s-integration-delivery-20260902-v3.tar.gz \
#     [--delivery-mode offline|registry] \
#     [--image-repository project-lucy] \
#     [--manifest-digest sha256:...] \
#     [--skip-ktx-exec]      # Apple Silicon: skip only the K6 steps that EXECUTE ktx under QEMU.
#                            # G1 (metadata) and G2 (ELF headers) still run; run G4/G4b on amd64.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART_YAML="${ROOT}/deploy/k8s/helm/lucy/Chart.yaml"
CHART_VERSION="$(awk '/^version:/{gsub(/"/, "", $2); print $2; exit}' "${CHART_YAML}")"
CHART_APP_VERSION="$(awk '/^appVersion:/{gsub(/"/, "", $2); print $2; exit}' "${CHART_YAML}")"
LUCY_VERSION="$(tr -d '[:space:]' < "${ROOT}/VERSION")"
[[ "${CHART_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "FAIL: invalid Chart.version: ${CHART_VERSION}" >&2; exit 1; }
[[ "${LUCY_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "FAIL: invalid VERSION: ${LUCY_VERSION}" >&2; exit 1; }
[[ "${CHART_APP_VERSION}" == "${LUCY_VERSION}" ]] || {
  echo "FAIL: Chart.appVersion=${CHART_APP_VERSION} does not match VERSION=${LUCY_VERSION}" >&2
  exit 1
}
IMAGE_TAG=""
OUTPUT=""
VERSION_SUFFIX="20260902-v3"
DELIVERY_MODE="offline"
IMAGE_REPOSITORY=""
MANIFEST_DIGEST=""
SKIP_KTX_EXEC=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-tag) IMAGE_TAG="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    --version-suffix) VERSION_SUFFIX="$2"; shift 2 ;;
    --delivery-mode) DELIVERY_MODE="$2"; shift 2 ;;
    --image-repository) IMAGE_REPOSITORY="$2"; shift 2 ;;
    --manifest-digest) MANIFEST_DIGEST="$2"; shift 2 ;;
    --skip-ktx-exec) SKIP_KTX_EXEC=1; shift ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ -n "${IMAGE_TAG}" ]] || { echo "FAIL: --image-tag required" >&2; exit 1; }
[[ -n "${OUTPUT}" ]] || { echo "FAIL: --output required" >&2; exit 1; }
[[ ! -e "${OUTPUT}" && ! -e "${OUTPUT}.sha256" && ! -e "${OUTPUT}.verification.json" ]] || { echo 'FAIL: use a new delivery name; existing artifacts must not be overwritten' >&2; exit 1; }

case "${DELIVERY_MODE}" in
  offline|registry) ;;
  *) echo "FAIL: --delivery-mode must be offline or registry" >&2; exit 1 ;;
esac

if [[ "${VERSION_SUFFIX}" =~ -v1$ ]] || [[ "${VERSION_SUFFIX}" =~ -v2$ ]]; then
  echo "FAIL: refusing to build deprecated package suffix ${VERSION_SUFFIX} (use v3+)" >&2
  exit 1
fi

command -v docker >/dev/null 2>&1 || { echo "FAIL: docker required" >&2; exit 1; }
[[ -z "$(git -C "${ROOT}" status --porcelain)" ]] || { echo 'FAIL: clean committed source required for delivery' >&2; exit 1; }
echo '[build-k8s-delivery] customer upgrade regression checklist'
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s "${ROOT}/scripts/deploy" -p 'test_*.py' -q
node --test "${ROOT}/scripts/deploy/probe-customer-auth-state.test.mjs" \
  "${ROOT}/scripts/release/customer-bootstrap-state.test.mjs" \
  "${ROOT}/scripts/gates/build-k8s-delivery-package.test.mjs"
docker image inspect "${IMAGE_TAG}" >/dev/null 2>&1 || { echo "FAIL: image not found: ${IMAGE_TAG}" >&2; exit 1; }

IMAGE_REF_TAG="${IMAGE_TAG##*:}"
[[ "${IMAGE_REF_TAG}" == *-"$(git -C "${ROOT}" rev-parse --short HEAD)" ]] || { echo 'FAIL: image tag must match the committed package source' >&2; exit 1; }
if [[ "${IMAGE_REF_TAG}" == "${IMAGE_TAG}" ]]; then
  IMAGE_REF_TAG="latest"
fi
LUCY_VERSION_PATTERN="${LUCY_VERSION//./\\.}"
[[ "${IMAGE_REF_TAG}" =~ ^customer-amd64-${LUCY_VERSION_PATTERN}-[0-9]{8}-[0-9a-f]{7,}$ ]] || {
  echo "FAIL: image tag must carry Lucy ${LUCY_VERSION}; got: ${IMAGE_REF_TAG}" >&2
  exit 1
}
IMAGE_LUCY_VERSION="$(docker run --rm --platform linux/amd64 --entrypoint printenv "${IMAGE_TAG}" LUCY_VERSION || true)"
[[ "${IMAGE_LUCY_VERSION}" == "${LUCY_VERSION}" ]] || {
  echo "FAIL: image LUCY_VERSION=${IMAGE_LUCY_VERSION:-<empty>} does not match VERSION=${LUCY_VERSION}" >&2
  exit 1
}
if [[ -z "${IMAGE_REPOSITORY}" ]]; then
  if [[ "${IMAGE_TAG}" == *:* ]]; then
    IMAGE_REPOSITORY="${IMAGE_TAG%:*}"
  else
    IMAGE_REPOSITORY="${IMAGE_TAG}"
  fi
fi

STAGING="$(mktemp -d)"
PKG="lucy-k8s-integration-delivery-${VERSION_SUFFIX}"
PKG_DIR="${STAGING}/${PKG}"
mkdir -p "${PKG_DIR}/image" "${PKG_DIR}/helm" "${PKG_DIR}/examples" "${PKG_DIR}/scripts"

cleanup_fail() {
  local rc=$?
  if [[ "${rc}" -ne 0 ]]; then
    rm -f "${OUTPUT}" "${OUTPUT}.sha256" "${OUTPUT}.verification.json" 2>/dev/null || true
    echo "[build-k8s-delivery] FAIL — removed incomplete ${OUTPUT}" >&2
  fi
  rm -rf "${STAGING}"
}
trap cleanup_fail EXIT

echo "[build-k8s-delivery] H1 static gate"
bash "${ROOT}/scripts/gates/helm-lucy-gate.sh"

echo "[build-k8s-delivery] export image tar"
TAR_NAME="$(echo "${IMAGE_TAG}" | tr '/:' '-').tar"
docker save -o "${PKG_DIR}/image/${TAR_NAME}" "${IMAGE_TAG}"
docker image inspect "${IMAGE_TAG}" > "${PKG_DIR}/image/image-inspect.json"
python3 "${ROOT}/scripts/deploy/image_identity.py" --archive "${PKG_DIR}/image/${TAR_NAME}" > "${PKG_DIR}/image/image-identity.json"
IMAGE_CONFIG_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["configId"])' "${PKG_DIR}/image/image-identity.json")"
echo "${IMAGE_CONFIG_ID}" > "${PKG_DIR}/image/image-config-id.txt"
# Backward-compatible alias: NEVER treat as registry manifest digest.
cp "${PKG_DIR}/image/image-config-id.txt" "${PKG_DIR}/image/image-digest.txt"
sha256sum "${PKG_DIR}/image/${TAR_NAME}" | awk '{print $1}' > "${PKG_DIR}/image/image-tar.sha256"
printf '%s\n' "${IMAGE_REPOSITORY}" > "${PKG_DIR}/image/image-repository.txt"
printf '%s\n' "${IMAGE_REF_TAG}" > "${PKG_DIR}/image/image-tag.txt"
printf '%s\n' "${DELIVERY_MODE}" > "${PKG_DIR}/image/delivery-mode.txt"
printf '%s\n' "${LUCY_VERSION}" > "${PKG_DIR}/image/lucy-version.txt"

HELM_DIGEST=""
HELM_PULL_POLICY="IfNotPresent"
if [[ "${DELIVERY_MODE}" == "offline" ]]; then
  HELM_DIGEST=""
  HELM_PULL_POLICY="Never"
  echo "[build-k8s-delivery] offline mode: pullPolicy=Never, digest cleared (config ID is not a manifest digest)"
else
  [[ -n "${MANIFEST_DIGEST}" ]] || {
    echo "FAIL: registry mode requires --manifest-digest sha256:..." >&2
    exit 1
  }
  [[ "${MANIFEST_DIGEST}" == sha256:* ]] || {
    echo "FAIL: --manifest-digest must start with sha256:" >&2
    exit 1
  }
  [[ "${MANIFEST_DIGEST}" != "${IMAGE_CONFIG_ID}" ]] || {
    echo "FAIL: manifest digest must not equal image config ID" >&2
    exit 1
  }
  HELM_DIGEST="${MANIFEST_DIGEST}"
  HELM_PULL_POLICY="IfNotPresent"
  echo "${MANIFEST_DIGEST}" > "${PKG_DIR}/image/image-manifest-digest.txt"
fi

echo "[build-k8s-delivery] copy supported helm chart"
cp -a "${ROOT}/deploy/k8s/helm/lucy/." "${PKG_DIR}/helm/lucy/"
cp "${ROOT}/deploy/k8s/K8S_CONTRACT.md" "${PKG_DIR}/"
cp "${ROOT}/deploy/k8s/helm/lucy/examples/values.k3s-test.yaml" "${PKG_DIR}/examples/values.k3s-test.yaml"

echo "[build-k8s-delivery] sync image identity into examples/values.k3s-test.yaml"
VALUES_FILE="${PKG_DIR}/examples/values.k3s-test.yaml"
python3 - "${VALUES_FILE}" "${IMAGE_REPOSITORY}" "${IMAGE_REF_TAG}" "${HELM_DIGEST}" "${HELM_PULL_POLICY}" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
repo, tag, digest, pull = sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
text = path.read_text(encoding="utf-8")
text = re.sub(r'(?m)^  repository: .*$', f'  repository: {repo}', text, count=1)
text = re.sub(r'(?m)^  tag: .*$', f'  tag: "{tag}"', text, count=1)
if digest:
    text = re.sub(r'(?m)^  digest: .*$', f'  digest: "{digest}"', text, count=1)
else:
    text = re.sub(r'(?m)^  digest: .*$', '  digest: ""', text, count=1)
text = re.sub(r'(?m)^  pullPolicy: .*$', f'  pullPolicy: {pull}', text, count=1)
path.write_text(text, encoding="utf-8")
PY

cp "${ROOT}/deploy/k8s/helm/lucy/examples/values.customer.example.yaml" "${PKG_DIR}/examples/values.customer.example.yaml"
# One identity everywhere: the chart-internal copy must not keep pack-time placeholders.
cp "${VALUES_FILE}" "${PKG_DIR}/helm/lucy/examples/values.k3s-test.yaml"

# Scripts: every dependency ships in the package and is resolved relative to the
# script itself (k8s-gate-lib.sh sits next to acceptance.sh).
cp "${ROOT}/scripts/gates/k8s-acceptance.sh" "${PKG_DIR}/scripts/acceptance.sh"
cp "${ROOT}/scripts/gates/k8s-gate-lib.sh" "${PKG_DIR}/scripts/k8s-gate-lib.sh"
cp "${ROOT}/scripts/gates/helm-lucy-gate.sh" "${PKG_DIR}/scripts/preflight-helm.sh"
cp "${ROOT}/scripts/gates/preflight-upgrade.sh" "${PKG_DIR}/scripts/preflight-upgrade.sh"
cp "${ROOT}/scripts/gates/preflight-upgrade-lib.mjs" "${PKG_DIR}/scripts/preflight-upgrade-lib.mjs"
cp "${ROOT}/scripts/gates/preflight_upgrade_drift.py" "${PKG_DIR}/scripts/preflight_upgrade_drift.py"
cp "${ROOT}/scripts/deploy/deploy-customer-k8s.sh" "${PKG_DIR}/scripts/deploy.sh"
cp "${ROOT}/scripts/deploy/customer-deployment-helper.py" "${PKG_DIR}/scripts/customer-deployment-helper.py"
cp "${ROOT}/scripts/deploy/probe-customer-auth-state.mjs" "${PKG_DIR}/scripts/probe-customer-auth-state.mjs"
cp "${ROOT}/scripts/deploy/prepare-customer-instance.py" "${PKG_DIR}/scripts/prepare-customer-instance.py"
cp "${ROOT}/scripts/deploy/image_identity.py" "${PKG_DIR}/scripts/image_identity.py"
cp "${ROOT}/deploy/k8s/examples/instance.upgrade.http.example.json" "${PKG_DIR}/examples/instance.upgrade.http.example.json"
cp "${ROOT}/deploy/k8s/examples/instance.upgrade.https.example.json" "${PKG_DIR}/examples/instance.upgrade.https.example.json"
cp "${ROOT}/deploy/k8s/examples/RECOVERY.open-mode.md" "${PKG_DIR}/examples/RECOVERY.open-mode.md"
cp "${ROOT}/deploy/k8s/CUSTOMER-UPGRADE.md" "${PKG_DIR}/CUSTOMER-UPGRADE.md"
cp "${ROOT}/deploy/k8s/ACCEPTANCE.md" "${PKG_DIR}/ACCEPTANCE.md"
cp "${ROOT}/docs/runbooks/customer-v2-upgrade-release-checklist.md" "${PKG_DIR}/UPGRADE-RELEASE-CHECKLIST.md"
cat > "${PKG_DIR}/CUSTOMER-FIRST-ADMIN.md" <<'EOF'
# 首次创建管理员

本通用软件包不含引导密钥。旧开放模式升级到 2.0 管理员登录时，保留原 PVC。

1. 把安装包解压到仓库和 `inbox` 之外的目录。
2. 按 `CUSTOMER-UPGRADE.md` 选择 HTTP 或 HTTPS 实例样例，填写真实 context、UID、旧镜像、节点映射和访问地址。HTTPS 的 TLS 网关和私有 CA 配置见该说明。
3. 确认旧数据卷没有管理员、也没有 `.ktx-ui/security.sqlite` 之后，才把 `legacyBaselineReviewed` 改为 `true`。填写恢复说明；部署入口在切换前自动停机备份整个 PVC，并保存原 Helm revision。
4. 从任意目录使用脚本的绝对路径执行 `python3 <解压目录>/scripts/prepare-customer-instance.py --base-package <解压目录> --instance-config <实例.json> --state-dir <私有状态目录> --output <新的客户目录>`。同一实例更换输出目录重打包会复用已签发的引导密钥。
5. 在客户目录先执行 `bash scripts/deploy.sh --dry-run`，通过后执行 `bash scripts/deploy.sh`。脚本配置该实例的引导 Secret 并部署。
6. 打开实例配置中的 WebUI 地址，输入引导密钥、账户名和新密码，创建首个所有者。

创建成功后使用账户和密码登录。重启或后续升级不需要重新认领。已有管理员直接登录。
Helm 回滚不会恢复 `admins.yaml` 或 `.ktx-ui/security.sqlite`。要回到旧开放模式，恢复升级前的 PVC 备份。
EOF
chmod 0755 "${PKG_DIR}/scripts/deploy.sh" "${PKG_DIR}/scripts/prepare-customer-instance.py"
chmod 0644 "${PKG_DIR}/scripts/customer-deployment-helper.py" "${PKG_DIR}/scripts/probe-customer-auth-state.mjs"
chmod 0755 "${PKG_DIR}/scripts/acceptance.sh" "${PKG_DIR}/scripts/preflight-helm.sh" "${PKG_DIR}/scripts/preflight-upgrade.sh"
chmod 0644 "${PKG_DIR}/scripts/k8s-gate-lib.sh" "${PKG_DIR}/scripts/preflight-upgrade-lib.mjs" "${PKG_DIR}/scripts/preflight_upgrade_drift.py"

# macOS / VCS leftovers must never reach the deliverable.
find "${PKG_DIR}" \( -name '._*' -o -name '.DS_Store' -o -name '__MACOSX' -o -name '.git' -o -name '.gitignore' -o -name '__pycache__' -o -name '*.pyc' -o -name '*.pyo' \) \
  -prune -exec rm -rf {} + 2>/dev/null || true

GIT_SHA="$(git -C "${ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
GIT_SHA_FULL="$(git -C "${ROOT}" rev-parse HEAD 2>/dev/null || echo unknown)"
GIT_DIRTY="false"
if [[ -n "$(git -C "${ROOT}" status --porcelain 2>/dev/null || true)" ]]; then
  GIT_DIRTY="true"
  echo "[build-k8s-delivery] WARN: working tree is dirty; BUILD-INFO.json records dirty=true" >&2
fi

echo "[build-k8s-delivery] write BUILD-INFO.json"
IMAGE_OS_ARCH="$(docker image inspect "${IMAGE_TAG}" --format '{{.Os}}/{{.Architecture}}')"
IMAGE_ENV_FILE="${STAGING}/image-env.txt"
docker image inspect "${IMAGE_TAG}" --format '{{range .Config.Env}}{{println .}}{{end}}' > "${IMAGE_ENV_FILE}"
IMAGE_TAR_SHA="$(tr -d '[:space:]' < "${PKG_DIR}/image/image-tar.sha256")"
HELM_VERSION="$(helm version --short 2>/dev/null || echo unknown)"
BUILD_INFO_PKG="${PKG}" BUILD_INFO_GIT_FULL="${GIT_SHA_FULL}" BUILD_INFO_GIT_SHORT="${GIT_SHA}" \
BUILD_INFO_GIT_DIRTY="${GIT_DIRTY}" BUILD_INFO_CHART_VERSION="${CHART_VERSION}" \
BUILD_INFO_CHART_APP="${CHART_APP_VERSION}" BUILD_INFO_REPO="${IMAGE_REPOSITORY}" \
BUILD_INFO_TAG="${IMAGE_REF_TAG}" BUILD_INFO_PLATFORM="${IMAGE_OS_ARCH}" \
BUILD_INFO_CONFIG_ID="${IMAGE_CONFIG_ID}" BUILD_INFO_MANIFEST_DIGEST="${HELM_DIGEST}" \
BUILD_INFO_TAR_SHA="${IMAGE_TAR_SHA}" BUILD_INFO_MODE="${DELIVERY_MODE}" \
BUILD_INFO_LUCY="${LUCY_VERSION}" BUILD_INFO_HELM="${HELM_VERSION}" \
BUILD_INFO_KTX_FALLBACK="$(awk -F'"' '/bundledKtxVersion:/{print $2; exit}' "${ROOT}/deploy/k8s/helm/lucy/values.yaml")" \
python3 - "${PKG_DIR}/BUILD-INFO.json" "${IMAGE_ENV_FILE}" "${PKG_DIR}/image/image-identity.json" <<'PY'
import datetime
import json
import os
import platform
import sys

out_path, env_path, identity_path = sys.argv[1:]
env = {}
with open(env_path, encoding="utf-8") as fh:
    for line in fh:
        if "=" in line:
            key, value = line.rstrip("\n").split("=", 1)
            env[key] = value
g = os.environ.get
info = {
    "package": g("BUILD_INFO_PKG"),
    "builtAtUtc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "buildHostArch": platform.machine(),
    "git": {
        "commit": g("BUILD_INFO_GIT_FULL"),
        "short": g("BUILD_INFO_GIT_SHORT"),
        "dirty": g("BUILD_INFO_GIT_DIRTY") == "true",
    },
    "chart": {"version": g("BUILD_INFO_CHART_VERSION"), "appVersion": g("BUILD_INFO_CHART_APP")},
    "image": {
        "repository": g("BUILD_INFO_REPO"),
        "tag": g("BUILD_INFO_TAG"),
        "platform": g("BUILD_INFO_PLATFORM"),
        "configId": g("BUILD_INFO_CONFIG_ID"),
        "registryManifestDigest": g("BUILD_INFO_MANIFEST_DIGEST") or None,
        "tarSha256": g("BUILD_INFO_TAR_SHA"),
        "deliveryMode": g("BUILD_INFO_MODE"),
    },
    "dependencies": {
        "lucy": g("BUILD_INFO_LUCY"),
        "ktx": env.get("LUCY_BUNDLED_KTX_VERSION") or g("BUILD_INFO_KTX_FALLBACK") or "unknown",
        "node": env.get("NODE_VERSION", "unknown"),
        "helmOnBuildHost": g("BUILD_INFO_HELM"),
    },
}
info['image'].update(json.load(open(identity_path)))
with open(out_path, "w", encoding="utf-8") as fh:
    json.dump(info, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PY

{
  printf '%s\n' "# Lucy K8s Integration Delivery (${VERSION_SUFFIX})"
  cat <<'EOF'

Supported Helm chart is included under `helm/lucy/` (not a reference snapshot).
Package layout: `helm/lucy/` chart · `examples/` values · `image/` offline image tar and identity files ·
`scripts/` preflight + acceptance (self-contained) · `BUILD-INFO.json` · `SHA256SUMS`.

This public package contains no bootstrap key. Follow `CUSTOMER-UPGRADE.md` to prepare a private instance
directory, run its deployment entry, and create the first owner. Each instance gets its own key.
The test, r2 and r3 packages are superseded. Follow UPGRADE-RELEASE-CHECKLIST.md for every delivery.
Local package checks do not authorize production use; native amd64 upgrade and recovery remain mandatory.

Read order:
1. README.md (this file)
2. RELEASE_NOTES.md
3. CUSTOMER-UPGRADE.md
4. CUSTOMER-FIRST-ADMIN.md
5. examples/RECOVERY.open-mode.md
6. ACCEPTANCE.md
7. K8S_CONTRACT.md

## Offline image import (K3s / containerd)

K3s runs containerd, not Docker. Do **not** use `docker load` on the node:

```bash
sudo k3s ctr images import image/project-lucy-*.tar
sudo k3s ctr images list | grep project-lucy
```

The listed `repository:tag` must equal `image.repository` / `image.tag` in the values file exactly
(`image/image-repository.txt`, `image/image-tag.txt`). Offline values use `image.pullPolicy: Never`
and an empty `image.digest`.

## Upgrade an existing open-mode instance

```bash
sha256sum -c SHA256SUMS
# Fill the selected instance example and recovery file as described in CUSTOMER-UPGRADE.md.
python3 /absolute/path/to/package/scripts/prepare-customer-instance.py \
  --base-package /absolute/path/to/package --instance-config /private/path/instance.json \
  --state-dir /private/path/state --output /private/path/customer-delivery
cd /private/path/customer-delivery
bash scripts/deploy.sh --dry-run
bash scripts/deploy.sh
```

Use the instance deployment entry for administrator migration. The lab Helm values do not provision an
instance bootstrap key and are not the customer upgrade entry. Complete ACCEPTANCE.md before reopening
production access. Native amd64 upgrade and recovery results must be recorded for this exact package.

EOF
  printf 'Delivery mode: `%s`\n' "${DELIVERY_MODE}"
  printf 'Image: `%s`\n' "${IMAGE_TAG}"
  printf 'Repository: `%s`\n' "${IMAGE_REPOSITORY}"
  printf 'Tag: `%s`\n' "${IMAGE_REF_TAG}"
  printf 'Image config ID: `%s`\n' "${IMAGE_CONFIG_ID}"
  if [[ -n "${HELM_DIGEST}" ]]; then
    printf 'Registry manifest digest: `%s`\n' "${HELM_DIGEST}"
  else
    printf 'Registry manifest digest: _(none — offline tar; do not put config ID in image.digest)_\n'
  fi
  printf 'Lucy product version: `%s`\n' "${LUCY_VERSION}"
  printf 'Chart: `%s` (appVersion `%s`)\n' "${CHART_VERSION}" "${CHART_APP_VERSION}"
  printf 'Git: `%s`\n' "${GIT_SHA}"
} > "${PKG_DIR}/README.md"

{
  printf '%s\n' "# Release Notes — ${VERSION_SUFFIX}"
  cat <<'EOF'

## Summary

Fixes the r3 customer deployment entry's multi-resource JSON parsing failure and missing preflight diagnostics.
Every build now runs deployment regressions and the final archive's instance dry-run regression with real
Helm and kubectl client rendering against synthetic cluster reads. This is not native K3s upgrade evidence.
Diagnostics contain stage, error type and stack locations without exception text or tool/credential output.

Lucy product version and bundled KTX version are independent release identities
(see `BUILD-INFO.json` for the exact commit, image, platform and dependency versions).

## Changes (Chart 0.2.6)

- Image config, platform manifest and index identities are derived from and verified against the saved image archive.
- CRI identity checks accept only the verified identities for the candidate image.
- HTTPS instance preparation includes private CA delivery and a separate HTTPS example.
- The customer entry prepares the bootstrap Secret, saves the original revision and PVC backup, and links explicit recovery and acceptance steps.

## Changes (Chart 0.2.5)

- `security.access` selects HTTPS or intranet HTTP. The lab switch `insecureHttpTestProfile` is not a customer access mode.
- Open-mode upgrades keep the PVC and mount a per-instance bootstrap Secret. `scripts/prepare-customer-instance.py` writes that private directory. This generic package still has no bootstrap key.
- The auth probe accepts security schema 1 and 2 without migrating the database.

## Changes (Chart 0.2.4)

- **Upgrade preflight.** `scripts/preflight-upgrade.sh` compares the live Deployment with the rendered chart
  (extra `command`/`args`, hotfix volumes, extra init containers) and prints a JSON Patch it does not apply.
  It also lists semantic column types outside `string`/`number`/`time`/`boolean`, and AbsoluteDeny tools on
  `roles.*.allow.tools`. `--apply-types` and `--apply-access` are opt-in and write a sibling backup first.
  `defaults.known_tools` is not modified. `project-migrate` still only `chown`s.

## Changes (Chart 0.2.3)

- **Secret is writable-compatible.** The DB password Secret is mounted read-only at `/mnt/lucy-secrets` in the
  `secrets-sync` init container, which copies the keys into the PVC at `/data/lucy/.ktx/secrets`
  (dir `0700`, files `0600`, owner `10001:10001`). The Lucy container mounts only the `/data/lucy` PVC, so
  WebUI-created connections can write password files (no more `EROFS`).
  Sync policy: Secret keys are added or overwritten on every pod start; files that exist only on the PVC
  (created via the WebUI) are **kept, never pruned**.
- **Legacy PVC ownership.** `project-migrate` hands any entry not owned by `10001:10001` to the runtime user
  (`/data/lucy`, `.ktx`, `.ktx/secrets`, `.ktx-ui`, ...). No manual `chown`, `kubectl patch` or start-command change.
- **Legacy content layout.** `env.LUCY_CONTENT_ROOT` is now injected into the pod. The lucy-test profile sets
  `"."` so `semantic-layer/`, `wiki/`, `skills/` and `webui/config/` next to `ktx.yaml` stay visible.
- **Resource names.** `fullnameOverride: lucy` keeps `deployment/lucy`, `service/lucy`, `pvc/lucy` under release
  `lucy-starrocks` (no second stack).
- **Ports.** Unchanged: WebUI `8276 -> 5174`, MCP `8277 -> 7879`; KTX upstream `7878` is never in the Service.
- **Scripts.** `scripts/preflight-helm.sh` runs from the package root (`helm/lucy`) and checks names, ports,
  Secret sync, content root and image identity. `scripts/acceptance.sh` ships with `k8s-gate-lib.sh`,
  separates Helm release / Deployment / Service names, and never prints tokens or Secret contents.
- **Offline import on K3s** uses `k3s ctr images import` (README), with `pullPolicy: Never`.
- Package hygiene: no `._*`, `__MACOSX`, `.DS_Store` or `.git`; inner `SHA256SUMS`, outer `.sha256`, and
  `BUILD-INFO.json` (commit, image config ID/digest, `linux/amd64`, dependency versions).

## Unchanged contract

- Image runs as UID/GID **10001** (matches legacy PVC `.git` ownership)
- Entrypoint idempotently runs `git init` on `/data/lucy` (**sole authority**)
- `project-migrate` init: **chown only** (no git init)
- Offline packages use `pullPolicy: Never` and leave `image.digest` empty

## Upgrade

See `helm/lucy/UPGRADE.md` (pre-upgrade checks, upgrade, acceptance, restart and rollback).
Use `CUSTOMER-UPGRADE.md` and the private instance directory's `scripts/deploy.sh`.
EOF
} > "${PKG_DIR}/RELEASE_NOTES.md"

(
  cd "${PKG_DIR}"
  find . -type f ! -name 'SHA256SUMS' -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)

VERIFY_EXTRA=()
if [[ "${SKIP_KTX_EXEC}" -eq 1 ]]; then
  VERIFY_EXTRA+=(--skip-ktx-exec)
  echo "[build-k8s-delivery] --skip-ktx-exec: G4/G4b/G8 ktx execution is left to a native amd64 host"
fi

echo "[build-k8s-delivery] K6 package verify (before writing deliverable tar)"
bash "${ROOT}/scripts/gates/verify-k8s-package.sh" --dir "${PKG_DIR}" --skip-docker-load

mkdir -p "$(dirname "${OUTPUT}")"
# COPYFILE_DISABLE stops bsdtar on macOS from adding AppleDouble `._*` entries.
COPYFILE_DISABLE=1 tar -C "${STAGING}" -czf "${OUTPUT}" "${PKG}"
(
  cd "$(dirname "${OUTPUT}")"
  sha256sum "$(basename "${OUTPUT}")" > "$(basename "${OUTPUT}").sha256"
)

echo "[build-k8s-delivery] K6 outer tar verify (load + G gates)"
bash "${ROOT}/scripts/gates/verify-k8s-package.sh" --tar "${OUTPUT}" --outer-sha256 "${OUTPUT}.sha256" \
  ${VERIFY_EXTRA[@]+"${VERIFY_EXTRA[@]}"}

echo '[build-k8s-delivery] final archive customer entry regression (synthetic reads; real CLIs)'
python3 "${ROOT}/scripts/gates/verify-customer-upgrade-package.py" --tar "${OUTPUT}" --report "${OUTPUT}.verification.json"

# Success: disarm fail cleanup of OUTPUT; still remove staging.
trap 'rm -rf "${STAGING}"' EXIT

echo "[build-k8s-delivery] wrote ${OUTPUT}"
echo "[build-k8s-delivery] wrote ${OUTPUT}.sha256"
