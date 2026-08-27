#!/usr/bin/env bash
# Assert that a local Docker image's key ELF binaries match the expected CPU
# architecture. Metadata-only checks (docker image inspect Architecture) are
# not enough — BUILDPLATFORM-bound Dockerfiles previously produced
# amd64-labeled images with aarch64 binaries.
#
# Checks (in order; first failure exits):
#   1. /usr/bin/tini          — ENTRYPOINT; "exec format error" hits here first
#   2. /usr/local/bin/node    — Node base image payload
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

if ! command -v docker >/dev/null 2>&1; then
  echo "error: 'docker' command not found; needed to extract binaries from the image" >&2
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

# ENTRYPOINT binary first — runtime fails here before node is ever invoked.
BINARIES=(
  "/usr/bin/tini"
  "/usr/local/bin/node"
)

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/lucy-elf-arch.XXXXXX")"
cleanup() {
  rm -rf "$tmpdir"
  if [[ -n "${CID:-}" ]]; then
    docker rm -f "$CID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Override ENTRYPOINT so create never executes the (possibly wrong-arch) tini.
CID="$(docker create --entrypoint /bin/true "$IMAGE")"

echo "[assert-image-elf-arch] image=${IMAGE} expected=${EXPECTED}"

for remote_path in "${BINARIES[@]}"; do
  local_name="$(basename "$remote_path")"
  local_path="${tmpdir}/${local_name}"
  docker cp "${CID}:${remote_path}" "${local_path}"
  file_out="$(file "${local_path}")"
  echo "[assert-image-elf-arch] ${remote_path}: ${file_out}"

  if echo "$file_out" | grep -Eiq "$FORBIDDEN_REGEX"; then
    echo "error: ${remote_path} ELF architecture conflicts with expected ${EXPECTED}" >&2
    exit 1
  fi

  if ! echo "$file_out" | grep -Eiq "$MATCH_REGEX"; then
    echo "error: ${remote_path} ELF did not match expected ${EXPECTED} pattern (${MATCH_REGEX})" >&2
    exit 1
  fi
done

echo "[assert-image-elf-arch] ok"
