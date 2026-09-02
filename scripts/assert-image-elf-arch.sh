#!/usr/bin/env bash
# Assert that a local Docker image's critical ELF binaries match the expected
# CPU architecture. Checks:
#   - /usr/local/bin/node
#   - /usr/bin/tini   (ENTRYPOINT; customer "exec format error" usually hits here first)
#   - KTX runtime Python (resolved through venv/uv symlinks)
#
# Metadata-only checks (docker image inspect Architecture) are NOT enough —
# BUILDPLATFORM-bound Dockerfiles previously produced amd64-labeled images with
# aarch64 binaries (see docs/customer-amd64-image-build-checklist.md).
set -Eeuo pipefail

usage() {
  echo "usage: $0 <image> <expected-arch>" >&2
  echo "  expected-arch: amd64 | arm64" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
IMAGE="$1"
EXPECTED="$2"

if ! command -v file >/dev/null 2>&1; then
  echo "error: 'file' command not found; install file(1) to run ELF arch assertions" >&2
  exit 2
fi

case "$EXPECTED" in
  amd64)
    PLATFORM="linux/amd64"
    MATCH_REGEX='x86-64|x86_64'
    FORBIDDEN_REGEX='ARM|aarch64'
    ;;
  arm64)
    PLATFORM="linux/arm64"
    MATCH_REGEX='ARM aarch64|aarch64|ARM64'
    FORBIDDEN_REGEX='x86-64|x86_64'
    ;;
  *)
    echo "error: unsupported expected-arch: $EXPECTED (use amd64 or arm64)" >&2
    exit 2
    ;;
esac

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/lucy-elf-arch.XXXXXX")"
cleanup() {
  rm -rf "$tmpdir"
  if [[ -n "${CID:-}" ]]; then
    docker rm -f "$CID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

assert_elf() {
  local label="$1"
  local path="$2"
  local local_name="${label//\//_}"
  docker cp "${CID}:${path}" "${tmpdir}/${local_name}" 2>/dev/null || {
    echo "error: missing ${path} in image ${IMAGE}" >&2
    return 1
  }
  # venv python is often a symlink into ~/.local/share/uv/python/... — follow it.
  if [[ -L "${tmpdir}/${local_name}" ]]; then
    local target
    target="$(docker run --rm --platform "${PLATFORM}" --entrypoint /bin/sh "${IMAGE}" -c "readlink -f \"$path\" || realpath \"$path\"")"
    [[ -n "${target}" ]] || {
      echo "error: ${label} is a symlink but could not resolve real path" >&2
      return 1
    }
    docker cp "${CID}:${target}" "${tmpdir}/${local_name}.real" 2>/dev/null || {
      echo "error: missing resolved ${label} path ${target} in image ${IMAGE}" >&2
      return 1
    }
    mv "${tmpdir}/${local_name}.real" "${tmpdir}/${local_name}"
    path="${target}"
  fi
  file_out="$(file "${tmpdir}/${local_name}")"
  echo "[assert-image-elf-arch] ${label}: ${file_out} (path=${path})"
  if echo "$file_out" | grep -Eiq "$FORBIDDEN_REGEX"; then
    echo "error: ${label} ELF conflicts with expected ${EXPECTED}" >&2
    return 1
  fi
  if ! echo "$file_out" | grep -Eiq "$MATCH_REGEX"; then
    echo "error: ${label} ELF did not match expected ${EXPECTED}" >&2
    return 1
  fi
}

CID="$(docker create --platform "${PLATFORM}" --entrypoint /bin/true "$IMAGE")"
echo "[assert-image-elf-arch] image=${IMAGE} expected=${EXPECTED} platform=${PLATFORM}"
assert_elf node /usr/local/bin/node
assert_elf tini /usr/bin/tini

KTX_VERSION="${KTX_VERSION:-${LUCY_EXPECTED_KTX_VERSION:-0.16.0}}"
PYTHON_PATH="/home/lucy/.ktx/runtime/${KTX_VERSION}/.venv/bin/python"
ROOT_PYTHON="/root/.ktx/runtime/${KTX_VERSION}/.venv/bin/python"
if docker cp "${CID}:${PYTHON_PATH}" "${tmpdir}/python-probe" 2>/dev/null; then
  rm -f "${tmpdir}/python-probe"
  assert_elf "runtime-python" "${PYTHON_PATH}"
elif docker cp "${CID}:${ROOT_PYTHON}" "${tmpdir}/python-probe" 2>/dev/null; then
  rm -f "${tmpdir}/python-probe"
  assert_elf "runtime-python" "${ROOT_PYTHON}"
else
  echo "error: missing runtime python at ${PYTHON_PATH} (set KTX_VERSION if non-default)" >&2
  exit 1
fi

echo "[assert-image-elf-arch] ok"
