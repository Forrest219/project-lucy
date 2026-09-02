#!/usr/bin/env bash
# K6 — verify K8s integration delivery package integrity after build or before upload.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR=""
PKG_TAR=""

usage() {
  cat <<'EOF'
Usage:
  bash scripts/verify-k8s-package.sh --dir <extracted-package-dir>
  bash scripts/verify-k8s-package.sh --tar <package.tar.gz>

Checks (K6):
  - Rejects deprecated delivery suffixes (e.g. 20260902-v1/v2)
  - image/image-digest.txt matches examples/values.k3s-test.yaml digest
  - values tag/digest are not REPLACE-ME placeholders
  - Runs helm static gate against package chart + examples
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) PKG_DIR="$2"; shift 2 ;;
    --tar) PKG_TAR="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

[[ -n "${PKG_DIR}" || -n "${PKG_TAR}" ]] || { usage >&2; exit 2; }

CLEANUP=""
if [[ -n "${PKG_TAR}" ]]; then
  [[ -f "${PKG_TAR}" ]] || { echo "FAIL: tar not found: ${PKG_TAR}" >&2; exit 1; }
  EXTRACT="$(mktemp -d)"
  CLEANUP="${EXTRACT}"
  tar -xzf "${PKG_TAR}" -C "${EXTRACT}"
  PKG_DIR="$(find "${EXTRACT}" -mindepth 1 -maxdepth 1 -type d | head -1)"
  [[ -n "${PKG_DIR}" ]] || { echo "FAIL: empty tar" >&2; exit 1; }
fi

PKG_NAME="$(basename "${PKG_DIR}")"

echo "[verify-k8s-package] K6-1 reject deprecated package names"
if [[ "${PKG_NAME}" =~ -v1$ ]] || [[ "${PKG_NAME}" =~ -v2$ ]]; then
  echo "FAIL K6-1: deprecated package ${PKG_NAME} (use v3+ with complete upgrade contract)" >&2
  exit 1
fi
if [[ "${PKG_NAME}" =~ lucy-k8s-integration-delivery-20260902-v[12]$ ]]; then
  echo "FAIL K6-1: explicitly deprecated 20260902 v1/v2 package" >&2
  exit 1
fi
echo "  ok package name ${PKG_NAME}"

DIGEST_FILE="${PKG_DIR}/image/image-digest.txt"
VALUES_FILE="${PKG_DIR}/examples/values.k3s-test.yaml"
[[ -f "${DIGEST_FILE}" ]] || { echo "FAIL: missing ${DIGEST_FILE}" >&2; exit 1; }
[[ -f "${VALUES_FILE}" ]] || { echo "FAIL: missing ${VALUES_FILE}" >&2; exit 1; }

PACK_DIGEST="$(tr -d '[:space:]' < "${DIGEST_FILE}")"
VALUES_DIGEST="$(python3 - "${VALUES_FILE}" <<'PY'
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text(encoding="utf-8")
m = re.search(r'^  digest: "(.*)"', text, re.M)
print(m.group(1) if m else "")
PY
)"
VALUES_TAG="$(python3 - "${VALUES_FILE}" <<'PY'
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text(encoding="utf-8")
m = re.search(r'^  tag: "(.*)"', text, re.M)
print(m.group(1) if m else "")
PY
)"

echo "[verify-k8s-package] K6-2 tag/digest placeholders"
[[ "${VALUES_TAG}" != *REPLACE-ME* ]] || { echo "FAIL K6-2: values tag still REPLACE-ME" >&2; exit 1; }
[[ "${VALUES_DIGEST}" != *REPLACE-ME* ]] || { echo "FAIL K6-2: values digest still REPLACE-ME" >&2; exit 1; }
echo "  ok tag=${VALUES_TAG}"

echo "[verify-k8s-package] K6-3 digest consistency"
[[ -n "${VALUES_DIGEST}" ]] || { echo "FAIL K6-3: missing digest in values" >&2; exit 1; }
[[ "${PACK_DIGEST}" == "${VALUES_DIGEST}" ]] || {
  echo "FAIL K6-3: image-digest.txt (${PACK_DIGEST}) != values digest (${VALUES_DIGEST})" >&2
  exit 1
}
echo "  ok digest ${PACK_DIGEST}"

echo "[verify-k8s-package] K6-4 helm static on package chart"
CHART="${PKG_DIR}/helm/lucy"
[[ -d "${CHART}" ]] || { echo "FAIL: missing package chart" >&2; exit 1; }
bash "${ROOT}/scripts/helm-lucy-gate.sh" --chart "${CHART}" --k3s-values "${VALUES_FILE}" --k3s-only

[[ -z "${CLEANUP}" ]] || rm -rf "${CLEANUP}"
echo "[verify-k8s-package] OK"
