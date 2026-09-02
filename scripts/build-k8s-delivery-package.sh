#!/usr/bin/env bash
# Build a clean Lucy K8s integration delivery tarball (v3 layout).
#
# Prerequisites:
#   - Image already built and passed G0–G8 (see docs/customer-amd64-image-build-checklist.md)
#   - bash scripts/helm-lucy-gate.sh passes (H1)
#
# Usage:
#   bash scripts/build-k8s-delivery-package.sh \
#     --image-tag project-lucy:customer-amd64-0.16.0-20260902-b262798 \
#     --output inbox/lucy-k8s-integration-delivery-20260902-v3.tar.gz
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_TAG=""
OUTPUT=""
VERSION_SUFFIX="20260902-v3"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-tag) IMAGE_TAG="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    --version-suffix) VERSION_SUFFIX="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ -n "${IMAGE_TAG}" ]] || { echo "FAIL: --image-tag required" >&2; exit 1; }
[[ -n "${OUTPUT}" ]] || { echo "FAIL: --output required" >&2; exit 1; }

if [[ "${VERSION_SUFFIX}" =~ -v1$ ]] || [[ "${VERSION_SUFFIX}" =~ -v2$ ]]; then
  echo "FAIL: refusing to build deprecated package suffix ${VERSION_SUFFIX} (use v3+)" >&2
  exit 1
fi

command -v docker >/dev/null 2>&1 || { echo "FAIL: docker required" >&2; exit 1; }
docker image inspect "${IMAGE_TAG}" >/dev/null 2>&1 || { echo "FAIL: image not found: ${IMAGE_TAG}" >&2; exit 1; }

IMAGE_DIGEST="$(docker image inspect "${IMAGE_TAG}" --format '{{.Id}}')"
IMAGE_REF_TAG="${IMAGE_TAG#*:}"
if [[ "${IMAGE_REF_TAG}" == "${IMAGE_TAG}" ]]; then
  IMAGE_REF_TAG="latest"
fi

STAGING="$(mktemp -d)"
PKG="lucy-k8s-integration-delivery-${VERSION_SUFFIX}"
PKG_DIR="${STAGING}/${PKG}"
mkdir -p "${PKG_DIR}/image" "${PKG_DIR}/helm" "${PKG_DIR}/examples" "${PKG_DIR}/scripts"

echo "[build-k8s-delivery] H1 static gate"
bash "${ROOT}/scripts/helm-lucy-gate.sh"

echo "[build-k8s-delivery] export image tar"
docker save -o "${PKG_DIR}/image/$(echo "${IMAGE_TAG}" | tr '/:' '-').tar" "${IMAGE_TAG}"
docker image inspect "${IMAGE_TAG}" > "${PKG_DIR}/image/image-inspect.json"
echo "${IMAGE_DIGEST}" > "${PKG_DIR}/image/image-digest.txt"

echo "[build-k8s-delivery] copy supported helm chart"
cp -a "${ROOT}/deploy/k8s/helm/lucy/." "${PKG_DIR}/helm/lucy/"
cp "${ROOT}/deploy/k8s/K8S_CONTRACT.md" "${PKG_DIR}/"
cp "${ROOT}/deploy/k8s/helm/lucy/examples/values.k3s-test.yaml" "${PKG_DIR}/examples/values.k3s-test.yaml"

echo "[build-k8s-delivery] sync image tag/digest into examples/values.k3s-test.yaml"
VALUES_FILE="${PKG_DIR}/examples/values.k3s-test.yaml"
python3 - "${VALUES_FILE}" "${IMAGE_REF_TAG}" "${IMAGE_DIGEST}" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
tag = sys.argv[2]
digest = sys.argv[3]
text = path.read_text(encoding="utf-8")
text = re.sub(r'(?m)^  tag: .*$', f'  tag: "{tag}"', text, count=1)
text = re.sub(r'(?m)^  digest: .*$', f'  digest: "{digest}"', text, count=1)
path.write_text(text, encoding="utf-8")
PY

cp "${ROOT}/scripts/k8s-acceptance.sh" "${PKG_DIR}/scripts/acceptance.sh"
cp "${ROOT}/scripts/helm-lucy-gate.sh" "${PKG_DIR}/scripts/preflight-helm.sh"

GIT_SHA="$(git -C "${ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"

cat > "${PKG_DIR}/README.md" <<EOF
# Lucy K8s Integration Delivery (${VERSION_SUFFIX})

Supported Helm chart is included under \`helm/lucy/\` (not a reference snapshot).

**Supersedes:** \`lucy-k8s-integration-delivery-20260902-v1\` and \`v2\` (incomplete upgrade contract — do not use).

Read order:
1. README.md (this file)
2. RELEASE_NOTES.md
3. K8S_CONTRACT.md
4. helm/lucy/UPGRADE.md
5. helm/lucy/ROLLBACK.md
6. examples/values.k3s-test.yaml
7. scripts/acceptance.sh

Image: \`${IMAGE_TAG}\`
Digest: \`${IMAGE_DIGEST}\`
Chart: \`0.2.1\`
Git: \`${GIT_SHA}\`
EOF

cat > "${PKG_DIR}/RELEASE_NOTES.md" <<EOF
# Release Notes — ${VERSION_SUFFIX}

## Summary

Fixes K8s in-place upgrade contract failures observed in v1/v2 deliveries (20260902).

## Changes

- Image runs as UID/GID **10001** (matches legacy PVC \`.git\` ownership)
- Entrypoint idempotently runs \`git init\` on \`/data/lucy\`
- Helm Chart **0.2.1**: \`workingDir: /data/lucy\`, \`project-migrate\` init, LoadBalancer k3s example
- Package \`examples/values.k3s-test.yaml\` tag/digest synced to bundled image

## Deprecated

- \`lucy-k8s-integration-delivery-20260902-v1\`
- \`lucy-k8s-integration-delivery-20260902-v2\`

Do **not** use v1/v2 for customer in-place upgrades.

## Upgrade

See \`helm/lucy/UPGRADE.md\`. Use \`helm upgrade --atomic --wait\` with package \`examples/values.k3s-test.yaml\`.
EOF

(
  cd "${PKG_DIR}"
  find . -type f ! -name 'SHA256SUMS' -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)

mkdir -p "$(dirname "${OUTPUT}")"
tar -C "${STAGING}" -czf "${OUTPUT}" "${PKG}"
sha256sum "${OUTPUT}" > "${OUTPUT}.sha256"

echo "[build-k8s-delivery] K6 package verify"
bash "${ROOT}/scripts/verify-k8s-package.sh" --dir "${PKG_DIR}"

echo "[build-k8s-delivery] wrote ${OUTPUT}"
echo "[build-k8s-delivery] wrote ${OUTPUT}.sha256"
rm -rf "${STAGING}"
