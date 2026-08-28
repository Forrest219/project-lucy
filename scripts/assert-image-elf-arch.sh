#!/usr/bin/env bash
# Assert that a local Docker image's critical ELF binaries match the expected
# CPU architecture. Checks BOTH:
#   - /usr/local/bin/node
#   - /usr/bin/tini   (ENTRYPOINT; customer "exec format error" usually hits here first)
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
    # file(1) on Linux/macOS typically prints "x86-64" for amd64 ELFs.
    MATCH_REGEX='x86-64|x86_64'
    FORBIDDEN_REGEX='ARM|aarch64'
    ;;
  arm64)
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
  docker cp "${CID}:${path}" "${tmpdir}/$(basename "$path")" 2>/dev/null || {
    echo "error: missing ${path} in image ${IMAGE}" >&2
    return 1
  }
  file_out="$(file "${tmpdir}/$(basename "$path")")"
  echo "[assert-image-elf-arch] ${label}: ${file_out}"
  if echo "$file_out" | grep -Eiq "$FORBIDDEN_REGEX"; then
    echo "error: ${label} ELF conflicts with expected ${EXPECTED}" >&2
    return 1
  fi
  if ! echo "$file_out" | grep -Eiq "$MATCH_REGEX"; then
    echo "error: ${label} ELF did not match expected ${EXPECTED}" >&2
    return 1
  fi
}

CID="$(docker create --entrypoint /bin/true "$IMAGE")"
echo "[assert-image-elf-arch] image=${IMAGE} expected=${EXPECTED}"
assert_elf node /usr/local/bin/node
assert_elf tini /usr/bin/tini

echo "[assert-image-elf-arch] ok"
