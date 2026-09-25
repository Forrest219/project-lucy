#!/usr/bin/env bash
# Copy repo-root skills/ into the demo project-template before image build.
# Customer images never get this tree: .dockerignore excludes skills/, and the
# default Dockerfile template only touches skills/.gitkeep.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="${ROOT}/skills"
DEST="${ROOT}/examples/docker-demo/project-template/skills"

if [[ ! -d "${SRC}" ]]; then
  echo "error: missing ${SRC}" >&2
  exit 1
fi

rm -rf "${DEST}"
mkdir -p "${DEST}"
# Copy tree; exclude macOS junk. Do not copy .cursor/skills (outside SRC).
if command -v rsync >/dev/null 2>&1; then
  rsync -a --exclude ".DS_Store" "${SRC}/" "${DEST}/"
else
  cp -R "${SRC}/." "${DEST}/"
  find "${DEST}" -name ".DS_Store" -delete 2>/dev/null || true
fi

if [[ ! -f "${DEST}/answer-style/SKILL.md" ]]; then
  echo "error: expected ${DEST}/answer-style/SKILL.md after sync" >&2
  exit 1
fi

echo "[lucy-demo] synced skills into ${DEST}"
