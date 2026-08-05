#!/usr/bin/env bash
# Rebuild the local demo Lucy image/container on the host-native architecture.
# Always pins Buildx to the Engine-bundled `default` builder so a leftover
# `lucy-amd64` / `lucy-builder` selection from customer packaging cannot hijack
# the demo path into QEMU (often looks "stuck" for 10+ minutes on Apple Silicon).
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

case "${BUILDX_BUILDER:-}" in
  lucy-amd64|lucy-builder)
    echo "error: BUILDX_BUILDER=${BUILDX_BUILDER} is reserved for customer amd64 packaging" >&2
    echo "hint: unset BUILDX_BUILDER, then re-run $0" >&2
    exit 1
    ;;
esac

# Pin this invocation only; does not permanently change `docker buildx use`.
export BUILDX_BUILDER=default

case "$(uname -m)" in
  arm64|aarch64)
    export TARGETPLATFORM="${TARGETPLATFORM:-linux/arm64}"
    export TARGETARCH="${TARGETARCH:-arm64}"
    ;;
  x86_64|amd64)
    export TARGETPLATFORM="${TARGETPLATFORM:-linux/amd64}"
    export TARGETARCH="${TARGETARCH:-amd64}"
    ;;
  *)
    echo "error: unsupported host architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

echo "[lucy-demo] BUILDX_BUILDER=${BUILDX_BUILDER} TARGETPLATFORM=${TARGETPLATFORM} TARGETARCH=${TARGETARCH}"

COMPOSE=(docker compose -f docker-compose.demo.yml)

if [[ "${1:-}" == "--no-cache" ]]; then
  shift
  "${COMPOSE[@]}" build --no-cache lucy
  "${COMPOSE[@]}" up -d --force-recreate --no-deps lucy
else
  "${COMPOSE[@]}" up -d --build "$@" lucy
fi

image_platform="$(docker image inspect project-lucy:demo --format '{{.Os}}/{{.Architecture}}')"
if [[ "${image_platform}" != "${TARGETPLATFORM}" ]]; then
  echo "error: expected project-lucy:demo platform ${TARGETPLATFORM}, got ${image_platform}" >&2
  exit 1
fi

bash "${ROOT}/scripts/assert-image-elf-arch.sh" project-lucy:demo "${TARGETARCH}"

echo "[lucy-demo] ok image=${image_platform} container=project-lucy-lucy-1"
