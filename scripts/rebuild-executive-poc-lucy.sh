#!/usr/bin/env bash
# Rebuild executive POC Lucy on host-native architecture.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export BUILDX_BUILDER="${BUILDX_BUILDER:-default}"
case "$(uname -m)" in
  arm64|aarch64) export TARGETPLATFORM="${TARGETPLATFORM:-linux/arm64}"; export TARGETARCH="${TARGETARCH:-arm64}" ;;
  x86_64|amd64) export TARGETPLATFORM="${TARGETPLATFORM:-linux/amd64}"; export TARGETARCH="${TARGETARCH:-amd64}" ;;
  *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac
COMPOSE=(docker compose -f docker-compose.executive-poc.yml)
VOLUME="${COMPOSE_PROJECT_NAME:-project-lucy}_lucy-exec-poc-data"
echo "[executive-poc] stopping lucy and clearing volume ${VOLUME}"
"${COMPOSE[@]}" stop lucy 2>/dev/null || true
"${COMPOSE[@]}" rm -f lucy 2>/dev/null || true
docker volume rm -f "${VOLUME}" 2>/dev/null || true
"${COMPOSE[@]}" build lucy
"${COMPOSE[@]}" up -d lucy
echo "[executive-poc] rebuild complete"
