#!/usr/bin/env bash
set -Eeuo pipefail

WEBUI_HOST="${LUCY_HEALTHCHECK_HOST:-127.0.0.1}"
WEBUI_PORT="${LUCY_WEBUI_PORT:-5174}"
PROXY_HOST="${LUCY_HEALTHCHECK_PROXY_HOST:-127.0.0.1}"
PROXY_PORT="${LUCY_PROXY_PORT:-7879}"

ktx --version >/dev/null

node -e '
  const url = `http://${process.argv[1]}:${process.argv[2]}/api/health`;
  fetch(url)
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (!body.ok) throw new Error("health envelope not ok");
    })
    .then(() => process.exit(0), (err) => {
      console.error(err.message);
      process.exit(1);
    });
' "${WEBUI_HOST}" "${WEBUI_PORT}"

node -e '
  const net = require("net");
  const socket = net.createConnection({ host: process.argv[1], port: Number(process.argv[2]) });
  socket.on("connect", () => { socket.end(); process.exit(0); });
  socket.on("error", (err) => { console.error(err.message); process.exit(1); });
  setTimeout(() => { console.error("proxy connection timeout"); process.exit(1); }, 1000);
' "${PROXY_HOST}" "${PROXY_PORT}"
