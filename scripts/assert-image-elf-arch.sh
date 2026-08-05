#!/usr/bin/env bash
# Assert that a local Docker image's /usr/local/bin/node ELF matches the
# expected CPU architecture. Metadata-only checks (docker image inspect
# Architecture) are not enough — BUILDPLATFORM-bound Dockerfiles previously
# produced amd64-labeled images with aarch64 binaries.
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

CID="$(docker create --entrypoint /bin/true "$IMAGE")"
docker cp "${CID}:/usr/local/bin/node" "${tmpdir}/node"

file_out="$(file "${tmpdir}/node")"
echo "[assert-image-elf-arch] image=${IMAGE} expected=${EXPECTED}"
echo "[assert-image-elf-arch] file: ${file_out}"

if echo "$file_out" | grep -Eiq "$FORBIDDEN_REGEX"; then
  echo "error: node ELF architecture conflicts with expected ${EXPECTED}" >&2
  exit 1
fi

if ! echo "$file_out" | grep -Eiq "$MATCH_REGEX"; then
  echo "error: node ELF did not match expected ${EXPECTED} pattern (${MATCH_REGEX})" >&2
  exit 1
fi

echo "[assert-image-elf-arch] ok"
