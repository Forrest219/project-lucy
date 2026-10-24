#!/usr/bin/env bash
# Fill a release ledger entry's commit from the actual release tag.
#
# The ledger entry is written before the tag exists (commit: "PENDING"), then
# backfilled once the tag is cut. Doing it by hand invites typos; this script
# reads the tag and writes what git says.
#
# Usage: bash scripts/release/fill-ledger-commit.sh <version> [tag]
#   version  product version, e.g. 0.20.0  (entry file docs/releases/v<version>.json)
#   tag      release tag, defaults to v<version>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

VERSION="${1:-}"
if [[ -z "${VERSION}" ]]; then
  echo "usage: bash scripts/release/fill-ledger-commit.sh <version> [tag]" >&2
  exit 1
fi

TAG="${2:-v${VERSION}}"
ENTRY="docs/releases/v${VERSION}.json"

if [[ ! -f "${ENTRY}" ]]; then
  echo "FAIL: ledger entry not found: ${ENTRY}" >&2
  exit 1
fi

if ! git rev-parse --verify --quiet "refs/tags/${TAG}" >/dev/null; then
  echo "FAIL: release tag ${TAG} does not exist in this checkout" >&2
  exit 1
fi

# Peel annotated tags down to the commit they point at.
COMMIT="$(git rev-list -n 1 "refs/tags/${TAG}")"
if [[ -z "${COMMIT}" ]]; then
  echo "FAIL: could not resolve ${TAG} to a commit" >&2
  exit 1
fi

node -e '
const fs = require("fs");
const file = process.argv[1];
const commit = process.argv[2];
const tag = process.argv[3];
const entry = JSON.parse(fs.readFileSync(file, "utf8"));
const before = entry.commit;
entry.commit = commit;
if (typeof entry.releaseTag === "string" && entry.releaseTag !== tag) {
  entry.releaseTag = tag;
}
fs.writeFileSync(file, JSON.stringify(entry, null, 2) + "\n");
console.log(`${file}: commit ${before} -> ${commit}`);
' "${ENTRY}" "${COMMIT}" "${TAG}"

echo "--- verifying ---"
npm run --silent lint:release-ledger
