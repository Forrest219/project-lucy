#!/usr/bin/env bash
# G8 — image-only K8s upgrade contract gates (no Helm dependency).
# See docs/customer-amd64-image-build-checklist.md
set -Eeuo pipefail

IMAGE="${1:-}"
KTX_VERSION="${KTX_VERSION:-0.16.0}"

usage() {
  cat <<'EOF'
Usage: bash scripts/g8-image-k8s-contract-gate.sh <image-tag>

Verifies customer image K8s contract:
  G8-1  empty volume seed creates /data/lucy/.git (entrypoint authority)
  G8-2  process runs as UID/GID 10001
  G8-3  runtime path under /home/lucy/.ktx (not /root)
EOF
}

[[ -n "${IMAGE}" ]] || { usage >&2; exit 2; }
command -v docker >/dev/null 2>&1 || { echo "FAIL: docker required" >&2; exit 1; }

KTX_RUNTIME_PYTHON="/home/lucy/.ktx/runtime/${KTX_VERSION}/.venv/bin/python"

echo "[g8-image-gate] G8-1 empty volume git init (entrypoint)"
G8_VOL="$(mktemp -d)"
chmod 1777 "${G8_VOL}"
docker run --rm --platform linux/amd64 \
  -e LUCY_ENTRYPOINT_SEED_ONLY=1 \
  -e LUCY_ALLOW_PLACEHOLDER_KTX=1 \
  -v "${G8_VOL}:/data/lucy" \
  "${IMAGE}" >/dev/null
[[ -d "${G8_VOL}/.git" ]] || {
  echo "FAIL G8-1: /data/lucy/.git was not created on empty volume" >&2
  rm -rf "${G8_VOL}"
  exit 1
}
rm -rf "${G8_VOL}"
echo "  ok entrypoint created .git"

echo "[g8-image-gate] G8-2 non-root UID 10001"
docker run --rm --platform linux/amd64 --entrypoint /bin/sh "${IMAGE}" -c \
  'test "$(id -u)" -eq 10001 && test "$(id -g)" -eq 10001' || {
  echo "FAIL G8-2: container must run as UID/GID 10001" >&2
  exit 1
}
echo "  ok uid/gid 10001"

echo "[g8-image-gate] G8-3 runtime path under /home/lucy (not /root)"
docker run --rm --platform linux/amd64 --entrypoint /bin/sh "${IMAGE}" -c "
  test -x ${KTX_RUNTIME_PYTHON}
  ! test -e /root/.ktx/runtime/${KTX_VERSION}/.venv/bin/python
" || {
  echo "FAIL G8-3: expected runtime at ${KTX_RUNTIME_PYTHON}, not /root/.ktx" >&2
  exit 1
}
echo "  ok runtime under /home/lucy"

echo "[g8-image-gate] OK"
