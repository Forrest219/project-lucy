#!/usr/bin/env bash
# Build customer-facing linux/amd64 Lucy image with mandatory architecture gates.
# See docs/customer-amd64-image-build-checklist.md
#
# Hard rules:
#   - Always pass TARGETPLATFORM=linux/amd64 and TARGETARCH=amd64.
#   - Never treat docker image inspect Architecture alone as proof.
#   - G2 (ELF node+tini) + G3 (docker run) + G4 (ktx) + G4b (baked runtime / offline) must pass.
#   - Do NOT fall back to inbox/customer-amd64-offline-package historical tars on failure.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

KTX_VERSION="${KTX_VERSION:-${LUCY_EXPECTED_KTX_VERSION:-0.16.0}}"
# Product version is independent of KTX and is always sourced from repo-root VERSION.
REPO_LUCY_VERSION="$(tr -d '[:space:]' < "${ROOT}/VERSION" 2>/dev/null || true)"
[[ "${REPO_LUCY_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "FAIL: VERSION must use numeric X.Y.Z form; got: ${REPO_LUCY_VERSION:-<empty>}" >&2
  exit 1
}
if [[ -n "${LUCY_VERSION:-}" && "${LUCY_VERSION}" != "${REPO_LUCY_VERSION}" ]]; then
  echo "FAIL: LUCY_VERSION=${LUCY_VERSION} does not match repo VERSION=${REPO_LUCY_VERSION}" >&2
  exit 1
fi
LUCY_VERSION="${REPO_LUCY_VERSION}"
BUILD_DATE="${BUILD_DATE:-$(date +%Y%m%d)}"
GIT_SHORT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
# Immutable customer tag: lucy product version + date + sha (KTX no longer owns the tag).
IMAGE="${IMAGE:-project-lucy:customer-amd64-${LUCY_VERSION}-${BUILD_DATE}-${GIT_SHORT}}"
IMAGE_REF_TAG="${IMAGE##*:}"
LUCY_VERSION_PATTERN="${LUCY_VERSION//./\\.}"
[[ "${IMAGE_REF_TAG}" =~ ^customer-amd64-${LUCY_VERSION_PATTERN}-[0-9]{8}-[0-9a-f]{7,}$ ]] || {
  echo "FAIL: customer image tag must be customer-amd64-${LUCY_VERSION}-YYYYMMDD-<gitSha>; got: ${IMAGE_REF_TAG}" >&2
  exit 1
}
# Prefer docker-driver builders (desktop-linux/default) so local Hub cache is used.
# docker-container builders (lucy-amd64) often re-fetch # syntax=docker/dockerfile:1.7
# and fail on Hub/IPv6 flakes — then wrongly tempt people to reuse bad tars.
BUILDER="${BUILDER:-desktop-linux}"
BUILD_DIR="${BUILD_DIR:-inbox/customer-amd64-build}"
LOG="${BUILD_DIR}/build.log"
METADATA="${BUILD_DIR}/buildx-metadata.json"
# Strip the # syntax= line so BuildKit uses the builtin frontend and does not
# need a live pull of docker/dockerfile:1.7 during customer builds.
DOCKERFILE_GEN="${BUILD_DIR}/Dockerfile.customer-amd64"

mkdir -p "$BUILD_DIR"
git rev-parse HEAD > "${BUILD_DIR}/git-head.txt"
git rev-parse --short HEAD > "${BUILD_DIR}/git-short.txt"
tail -n +2 Dockerfile > "$DOCKERFILE_GEN"

echo "[build-customer-amd64] image=${IMAGE} builder=${BUILDER}"
echo "[build-customer-amd64] lucy=${LUCY_VERSION} ktx=${KTX_VERSION}"
echo "[build-customer-amd64] host=$(uname -m) — customer image MUST pass G2 ELF as amd64"

if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  echo "[build-customer-amd64] builder ${BUILDER} missing; falling back to default" >&2
  BUILDER=default
fi

echo "[build-customer-amd64] building (see ${LOG})..."
set +e
docker buildx build \
  --builder "$BUILDER" \
  --platform linux/amd64 \
  --build-arg "KTX_VERSION=${KTX_VERSION}" \
  --build-arg "LUCY_VERSION=${LUCY_VERSION}" \
  --build-arg "TARGETPLATFORM=linux/amd64" \
  --build-arg "TARGETARCH=amd64" \
  -f "$DOCKERFILE_GEN" \
  --tag "$IMAGE" \
  --load \
  --metadata-file "$METADATA" \
  . >"$LOG" 2>&1
build_rc=$?
set -e

# Never leave demo stack on a customer amd64 builder
docker buildx use default >/dev/null 2>&1 || true

if [[ "$build_rc" -ne 0 ]]; then
  echo "[build-customer-amd64] FAIL build exit=${build_rc}; last 40 log lines:" >&2
  tail -40 "$LOG" >&2 || true
  echo "[build-customer-amd64] DO NOT reuse historical bad tars from inbox/customer-amd64-offline-package/" >&2
  exit "$build_rc"
fi

echo "[build-customer-amd64] gate G1 metadata"
meta="$(docker image inspect "$IMAGE" --format '{{.Os}}/{{.Architecture}}')"
[[ "$meta" == "linux/amd64" ]] || { echo "FAIL G1: metadata=${meta}"; exit 1; }
echo "  ok ${meta}"

echo "[build-customer-amd64] gate G2 ELF (node + tini)"
bash scripts/assert-image-elf-arch.sh "$IMAGE" amd64

echo "[build-customer-amd64] gate G3 runtime smoke (entrypoint path)"
docker run --rm --platform linux/amd64 --entrypoint /bin/sh "$IMAGE" -c 'echo ok' >/dev/null
echo "  ok docker run sh"

echo "[build-customer-amd64] gate G4 ktx --version"
ver="$(docker run --rm --platform linux/amd64 --entrypoint ktx "$IMAGE" --version)"
echo "  ${ver}"
echo "$ver" | grep -q "${KTX_VERSION}" || {
  echo "FAIL G4: expected ktx version ${KTX_VERSION}, got: ${ver}" >&2
  exit 1
}

KTX_RUNTIME_PYTHON="/home/lucy/.ktx/runtime/${KTX_VERSION}/.venv/bin/python"

# G4b: KTX Python runtime must be baked in. Customer intranet cannot download uv.
echo "[build-customer-amd64] gate G4b-1 baked Python runtime"
docker run --rm --platform linux/amd64 --entrypoint /bin/sh "$IMAGE" -c "
  test -x ${KTX_RUNTIME_PYTHON}
" || {
  echo "FAIL G4b-1: missing ${KTX_RUNTIME_PYTHON}" >&2
  echo "  Image is unsafe for offline/intranet: queries will try to download uv." >&2
  exit 1
}
echo "  ok runtime python present"

echo "[build-customer-amd64] gate G4b-2 ktx --version with --network=none"
offline_ver="$(docker run --rm --network=none --platform linux/amd64 --entrypoint ktx "$IMAGE" --version)"
echo "  ${offline_ver}"
echo "$offline_ver" | grep -q "${KTX_VERSION}" || {
  echo "FAIL G4b-2: ktx --version failed without network (runtime not fully baked)" >&2
  exit 1
}
echo "  ok offline ktx"

echo "[build-customer-amd64] gate G4b-3 offline python + sl validate"
docker run --rm --network=none --platform linux/amd64 --entrypoint /bin/sh "$IMAGE" -ec "
  PY=${KTX_RUNTIME_PYTHON}
  test -x \"\$PY\"
  \"\$PY\" -c 'import platform; assert platform.machine() in (\"x86_64\", \"AMD64\")'
  ktx --project-dir /app/project-template sl --connection-id customer-db validate ceo_metric_snapshot
" || {
  echo "FAIL G4b-3: offline Python/runtime functional check failed" >&2
  exit 1
}
echo "  ok offline python + sl validate"

echo "[build-customer-amd64] gate G4c Lucy product version env"
img_lucy="$(docker run --rm --platform linux/amd64 --entrypoint printenv "$IMAGE" LUCY_VERSION || true)"
echo "  LUCY_VERSION=${img_lucy}"
[[ "${img_lucy}" == "${LUCY_VERSION}" ]] || {
  echo "FAIL G4c: expected LUCY_VERSION=${LUCY_VERSION}, got: ${img_lucy}" >&2
  exit 1
}
echo "  ok product version"

echo "[build-customer-amd64] gate G8 image K8s contract (image-only, no Helm)"
bash scripts/g8-image-k8s-contract-gate.sh "${IMAGE}"

docker image inspect "$IMAGE" --format '{{.Id}}' > "${BUILD_DIR}/image-id.txt"
echo "[build-customer-amd64] done image=${IMAGE} image-id=$(cat "${BUILD_DIR}/image-id.txt")"
echo "[build-customer-amd64] next: npm run gate:k8s-static + docker save + G7; see docs/customer-amd64-image-build-checklist.md"
