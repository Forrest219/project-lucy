#!/usr/bin/env bash
# V-01 (T0A-2): ensure the demo WebUI bootstrap secret file exists.
#
# Usage: ensure-bootstrap-token.sh <token-file>
#
# Creates <token-file> with 32 random bytes (hex, mode 0600) only when it is
# missing or empty. An existing secret is never rotated or overwritten. Prints
# the file path only — never the secret value.
set -Eeuo pipefail

target="${1:?usage: ensure-bootstrap-token.sh <token-file>}"

if [[ -s "${target}" ]]; then
  echo "[lucy-upgrade] bootstrap token present: ${target}"
  exit 0
fi

umask 077
mkdir -p "$(dirname "${target}")"
tmp="${target}.tmp.$$"
node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex") + "\n")' > "${tmp}"
chmod 600 "${tmp}"
mv -f "${tmp}" "${target}"
echo "[lucy-upgrade] generated bootstrap token: ${target}"
