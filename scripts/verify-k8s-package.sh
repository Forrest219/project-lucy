#!/usr/bin/env bash
# K6 — verify K8s integration delivery package integrity after build or before upload.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR=""
PKG_TAR=""
OUTER_SHA256=""
SKIP_DOCKER_LOAD=0
RUN_IMAGE_GATES=1

usage() {
  cat <<'EOF'
Usage:
  bash scripts/verify-k8s-package.sh --dir <extracted-package-dir> [--skip-docker-load]
  bash scripts/verify-k8s-package.sh --tar <package.tar.gz> [--outer-sha256 <file>]

Checks (K6):
  - Rejects deprecated delivery suffixes (e.g. 20260902-v1/v2)
  - Outer/inner SHA256 when provided
  - Single top-level dir + single image tar
  - Offline vs registry identity semantics
  - Optional docker load + G1/G2/G3/G4/G4b/G8 against loaded image
  - Helm static gate against package chart + examples
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) PKG_DIR="$2"; shift 2 ;;
    --tar) PKG_TAR="$2"; shift 2 ;;
    --outer-sha256) OUTER_SHA256="$2"; shift 2 ;;
    --skip-docker-load) SKIP_DOCKER_LOAD=1; shift ;;
    --skip-image-gates) RUN_IMAGE_GATES=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

[[ -n "${PKG_DIR}" || -n "${PKG_TAR}" ]] || { usage >&2; exit 2; }

CLEANUP=""
LOADED_IMAGE=""
cleanup() {
  if [[ -n "${LOADED_IMAGE}" ]]; then
    docker rmi "${LOADED_IMAGE}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${CLEANUP}" ]]; then
    rm -rf "${CLEANUP}"
  fi
}
trap cleanup EXIT

if [[ -n "${PKG_TAR}" ]]; then
  [[ -f "${PKG_TAR}" ]] || { echo "FAIL: tar not found: ${PKG_TAR}" >&2; exit 1; }
  if [[ -n "${OUTER_SHA256}" ]]; then
    echo "[verify-k8s-package] K6-0 outer checksum"
    (cd "$(dirname "${PKG_TAR}")" && sha256sum -c "$(basename "${OUTER_SHA256}")")
  elif [[ -f "${PKG_TAR}.sha256" ]]; then
    echo "[verify-k8s-package] K6-0 outer checksum (${PKG_TAR}.sha256)"
    (cd "$(dirname "${PKG_TAR}")" && sha256sum -c "$(basename "${PKG_TAR}.sha256")")
  fi
  EXTRACT="$(mktemp -d)"
  CLEANUP="${EXTRACT}"
  tar -xzf "${PKG_TAR}" -C "${EXTRACT}"
  TOP_COUNT="$(find "${EXTRACT}" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
  [[ "${TOP_COUNT}" == "1" ]] || { echo "FAIL: expected exactly one top-level directory, got ${TOP_COUNT}" >&2; exit 1; }
  PKG_DIR="$(find "${EXTRACT}" -mindepth 1 -maxdepth 1 -type d | head -1)"
fi

PKG_NAME="$(basename "${PKG_DIR}")"

echo "[verify-k8s-package] K6-1 reject deprecated package names"
if [[ "${PKG_NAME}" =~ -v1$ ]] || [[ "${PKG_NAME}" =~ -v2$ ]]; then
  echo "FAIL K6-1: deprecated package ${PKG_NAME} (use v3+ with complete upgrade contract)" >&2
  exit 1
fi
echo "  ok package name ${PKG_NAME}"

echo "[verify-k8s-package] K6-1b inner SHA256SUMS"
[[ -f "${PKG_DIR}/SHA256SUMS" ]] || { echo "FAIL: missing SHA256SUMS" >&2; exit 1; }
(
  cd "${PKG_DIR}"
  sha256sum -c SHA256SUMS
)

CONFIG_ID_FILE="${PKG_DIR}/image/image-config-id.txt"
if [[ ! -f "${CONFIG_ID_FILE}" && -f "${PKG_DIR}/image/image-digest.txt" ]]; then
  CONFIG_ID_FILE="${PKG_DIR}/image/image-digest.txt"
fi
VALUES_FILE="${PKG_DIR}/examples/values.k3s-test.yaml"
MODE_FILE="${PKG_DIR}/image/delivery-mode.txt"
REPO_FILE="${PKG_DIR}/image/image-repository.txt"
TAG_FILE="${PKG_DIR}/image/image-tag.txt"
TAR_SHA_FILE="${PKG_DIR}/image/image-tar.sha256"

[[ -f "${CONFIG_ID_FILE}" ]] || { echo "FAIL: missing image config id file" >&2; exit 1; }
[[ -f "${VALUES_FILE}" ]] || { echo "FAIL: missing ${VALUES_FILE}" >&2; exit 1; }

PACK_CONFIG_ID="$(tr -d '[:space:]' < "${CONFIG_ID_FILE}")"
DELIVERY_MODE="offline"
if [[ -f "${MODE_FILE}" ]]; then
  DELIVERY_MODE="$(tr -d '[:space:]' < "${MODE_FILE}")"
fi

VALUES_META="$(python3 - "${VALUES_FILE}" <<'PY'
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text(encoding="utf-8")
def grab(key):
    m = re.search(rf'^  {key}:\s*"?(.*?)"?\s*$', text, re.M)
    return m.group(1) if m else ""
print(grab("repository"))
print(grab("tag").strip('"'))
print(grab("digest").strip('"'))
print(grab("pullPolicy"))
PY
)"
VALUES_REPO="$(printf '%s\n' "${VALUES_META}" | sed -n '1p')"
VALUES_TAG="$(printf '%s\n' "${VALUES_META}" | sed -n '2p')"
VALUES_DIGEST="$(printf '%s\n' "${VALUES_META}" | sed -n '3p')"
VALUES_PULL="$(printf '%s\n' "${VALUES_META}" | sed -n '4p')"

echo "[verify-k8s-package] K6-2 placeholders + identity semantics (${DELIVERY_MODE})"
[[ "${VALUES_TAG}" != *REPLACE-ME* ]] || { echo "FAIL K6-2: values tag still REPLACE-ME" >&2; exit 1; }
[[ "${VALUES_DIGEST}" != *REPLACE-ME* ]] || { echo "FAIL K6-2: values digest still REPLACE-ME" >&2; exit 1; }
[[ -n "${VALUES_REPO}" ]] || { echo "FAIL K6-2: missing repository" >&2; exit 1; }

if [[ -f "${REPO_FILE}" ]]; then
  PACK_REPO="$(tr -d '[:space:]' < "${REPO_FILE}")"
  [[ "${PACK_REPO}" == "${VALUES_REPO}" ]] || {
    echo "FAIL K6-2: repository drift pack=${PACK_REPO} values=${VALUES_REPO}" >&2
    exit 1
  }
fi
if [[ -f "${TAG_FILE}" ]]; then
  PACK_TAG="$(tr -d '[:space:]' < "${TAG_FILE}")"
  [[ "${PACK_TAG}" == "${VALUES_TAG}" ]] || {
    echo "FAIL K6-2: tag drift pack=${PACK_TAG} values=${VALUES_TAG}" >&2
    exit 1
  }
fi

if [[ "${DELIVERY_MODE}" == "offline" ]]; then
  [[ "${VALUES_PULL}" == "Never" ]] || {
    echo "FAIL K6-2: offline package must use pullPolicy Never (got ${VALUES_PULL})" >&2
    exit 1
  }
  [[ -z "${VALUES_DIGEST}" ]] || {
    echo "FAIL K6-2: offline package must leave image.digest empty (got ${VALUES_DIGEST})" >&2
    exit 1
  }
  [[ -f "${TAR_SHA_FILE}" ]] || { echo "FAIL K6-2: missing image-tar.sha256" >&2; exit 1; }
else
  [[ -n "${VALUES_DIGEST}" ]] || { echo "FAIL K6-2: registry mode requires digest" >&2; exit 1; }
  [[ "${VALUES_DIGEST}" == sha256:* ]] || { echo "FAIL K6-2: digest must be sha256:..." >&2; exit 1; }
  [[ "${VALUES_DIGEST}" != "${PACK_CONFIG_ID}" ]] || {
    echo "FAIL K6-2: values digest equals config ID — use registry manifest digest" >&2
    exit 1
  }
  MANIFEST_FILE="${PKG_DIR}/image/image-manifest-digest.txt"
  [[ -f "${MANIFEST_FILE}" ]] || { echo "FAIL K6-2: missing image-manifest-digest.txt" >&2; exit 1; }
  PACK_MANIFEST="$(tr -d '[:space:]' < "${MANIFEST_FILE}")"
  [[ "${PACK_MANIFEST}" == "${VALUES_DIGEST}" ]] || {
    echo "FAIL K6-2: manifest digest drift" >&2
    exit 1
  }
fi
echo "  ok repo=${VALUES_REPO} tag=${VALUES_TAG} pull=${VALUES_PULL}"

IMAGE_TAR_COUNT="$(find "${PKG_DIR}/image" -maxdepth 1 -type f -name '*.tar' | wc -l | tr -d ' ')"
[[ "${IMAGE_TAR_COUNT}" == "1" ]] || {
  echo "FAIL K6-3: expected exactly one image tar, got ${IMAGE_TAR_COUNT}" >&2
  exit 1
}
IMAGE_TAR="$(find "${PKG_DIR}/image" -maxdepth 1 -type f -name '*.tar' | head -1)"

if [[ -f "${TAR_SHA_FILE}" ]]; then
  echo "[verify-k8s-package] K6-3b image tar sha256"
  expected="$(tr -d '[:space:]' < "${TAR_SHA_FILE}")"
  actual="$(sha256sum "${IMAGE_TAR}" | awk '{print $1}')"
  [[ "${expected}" == "${actual}" ]] || {
    echo "FAIL K6-3b: image tar hash mismatch" >&2
    exit 1
  }
fi

if [[ "${SKIP_DOCKER_LOAD}" -eq 0 ]]; then
  command -v docker >/dev/null 2>&1 || { echo "FAIL: docker required for load verify" >&2; exit 1; }
  echo "[verify-k8s-package] K6-4 docker load image tar"
  LOAD_OUT="$(docker load -i "${IMAGE_TAR}")"
  echo "  ${LOAD_OUT}"
  LOADED_IMAGE="$(printf '%s\n' "${LOAD_OUT}" | awk -F': ' '/Loaded image:/{print $2; exit}')"
  if [[ -z "${LOADED_IMAGE}" ]]; then
    # docker load may print "Loaded image ID: sha256:..."
    LOADED_ID="$(printf '%s\n' "${LOAD_OUT}" | awk '/Loaded image ID:/{print $4; exit}')"
    [[ -n "${LOADED_ID}" ]] || { echo "FAIL K6-4: could not parse docker load output" >&2; exit 1; }
    LOADED_IMAGE="${LOADED_ID}"
  fi
  LOADED_CONFIG="$(docker image inspect "${LOADED_IMAGE}" --format '{{.Id}}')"
  [[ "${LOADED_CONFIG}" == "${PACK_CONFIG_ID}" ]] || {
    echo "FAIL K6-4: loaded config ID ${LOADED_CONFIG} != pack ${PACK_CONFIG_ID}" >&2
    exit 1
  }
  # Prefer tagged name matching package metadata when available.
  if docker image inspect "${VALUES_REPO}:${VALUES_TAG}" >/dev/null 2>&1; then
    LOADED_IMAGE="${VALUES_REPO}:${VALUES_TAG}"
  fi

  if [[ "${RUN_IMAGE_GATES}" -eq 1 ]]; then
    echo "[verify-k8s-package] K6-5 re-run G1/G2/G4b/G8 on loaded image"
    meta="$(docker image inspect "${LOADED_IMAGE}" --format '{{.Os}}/{{.Architecture}}')"
    [[ "${meta}" == "linux/amd64" ]] || { echo "FAIL G1: ${meta}" >&2; exit 1; }
    bash "${ROOT}/scripts/assert-image-elf-arch.sh" "${LOADED_IMAGE}" amd64
    docker run --rm --platform linux/amd64 --entrypoint /bin/sh "${LOADED_IMAGE}" -c 'echo ok' >/dev/null
    KTX_VERSION="${KTX_VERSION:-0.16.0}"
    ver="$(docker run --rm --platform linux/amd64 --entrypoint ktx "${LOADED_IMAGE}" --version)"
    echo "  ${ver}"
    echo "${ver}" | grep -q "${KTX_VERSION}"
    docker run --rm --network=none --platform linux/amd64 --entrypoint /bin/sh "${LOADED_IMAGE}" -c \
      "test -x /home/lucy/.ktx/runtime/${KTX_VERSION}/.venv/bin/python"
    docker run --rm --network=none --platform linux/amd64 --entrypoint ktx "${LOADED_IMAGE}" --version >/dev/null
    bash "${ROOT}/scripts/g8-image-k8s-contract-gate.sh" "${LOADED_IMAGE}"
  fi
else
  echo "[verify-k8s-package] K6-4 skipped docker load (--skip-docker-load)"
fi

echo "[verify-k8s-package] K6-6 helm static on package chart"
CHART="${PKG_DIR}/helm/lucy"
[[ -d "${CHART}" ]] || { echo "FAIL: missing package chart" >&2; exit 1; }
bash "${ROOT}/scripts/helm-lucy-gate.sh" --chart "${CHART}" --k3s-values "${VALUES_FILE}" --k3s-only

echo "[verify-k8s-package] OK"
