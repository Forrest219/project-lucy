#!/usr/bin/env bash
# Build a clean Lucy K8s integration delivery tarball (v2 layout).
#
# Prerequisites:
#   - Image already built and passed G0–G6 + G4b (see docs/customer-amd64-image-build-checklist.md)
#   - bash scripts/helm-lucy-gate.sh passes (H1)
#   - npm run gate:k8s-static passes
#
# Usage:
#   bash scripts/build-k8s-delivery-package.sh \
#     --image-tag project-lucy:customer-amd64-0.16.0-20260901-b893a0c \
#     --output inbox/customer-k8s-integration-build/lucy-k8s-integration-delivery-20260901-v2.tar.gz
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_TAG=""
OUTPUT=""
VERSION_SUFFIX="20260901-v2"

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

STAGING="$(mktemp -d)"
PKG="lucy-k8s-integration-delivery-${VERSION_SUFFIX}"
PKG_DIR="${STAGING}/${PKG}"
mkdir -p "${PKG_DIR}/image" "${PKG_DIR}/helm" "${PKG_DIR}/examples" "${PKG_DIR}/scripts"

echo "[build-k8s-delivery] H1 static gate"
bash "${ROOT}/scripts/helm-lucy-gate.sh"

echo "[build-k8s-delivery] export image tar"
docker save -o "${PKG_DIR}/image/$(echo "${IMAGE_TAG}" | tr '/:' '-').tar" "${IMAGE_TAG}"
docker image inspect "${IMAGE_TAG}" > "${PKG_DIR}/image/image-inspect.json"
docker image inspect "${IMAGE_TAG}" --format '{{.Id}}' > "${PKG_DIR}/image/image-digest.txt"

echo "[build-k8s-delivery] copy supported helm chart"
cp -a "${ROOT}/deploy/k8s/helm/lucy/." "${PKG_DIR}/helm/lucy/"
cp "${ROOT}/deploy/k8s/K8S_CONTRACT.md" "${PKG_DIR}/"
cp "${ROOT}/deploy/k8s/helm/lucy/examples/values.k3s-test.yaml" "${PKG_DIR}/examples/"
cp "${ROOT}/scripts/k8s-acceptance.sh" "${PKG_DIR}/scripts/acceptance.sh"
cp "${ROOT}/scripts/helm-lucy-gate.sh" "${PKG_DIR}/scripts/preflight-helm.sh"

cat > "${PKG_DIR}/README.md" <<EOF
# Lucy K8s Integration Delivery (${VERSION_SUFFIX})

Supported Helm chart is included under \`helm/lucy/\` (not a reference snapshot).

Read order:
1. README.md (this file)
2. K8S_CONTRACT.md
3. helm/lucy/UPGRADE.md
4. helm/lucy/ROLLBACK.md
5. examples/values.k3s-test.yaml
6. scripts/acceptance.sh
EOF

(
  cd "${PKG_DIR}"
  find . -type f ! -name 'SHA256SUMS' -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)

mkdir -p "$(dirname "${OUTPUT}")"
tar -C "${STAGING}" -czf "${OUTPUT}" "${PKG}"
sha256sum "${OUTPUT}" > "${OUTPUT}.sha256"

echo "[build-k8s-delivery] wrote ${OUTPUT}"
echo "[build-k8s-delivery] wrote ${OUTPUT}.sha256"
rm -rf "${STAGING}"
