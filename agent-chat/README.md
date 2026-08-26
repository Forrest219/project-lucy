# Agent Chat (A3) — optional sidecar for Lucy

Lucy remains independently deliverable. This directory only supports the optional
**Agent Chat** validation stack (Open WebUI + Hermes → Lucy MCP).

M0: one Open WebUI account, one Hermes home, one Lucy Agent token, serial questions.
Lucy Admin credentials for audit evidence are separate from Open WebUI admin.

## Quick start

1. Ensure Lucy MCP Proxy is already running.
2. Create a read-only Lucy Agent token; prepare Lucy Admin credentials for evidence checks.
3. Follow **`docs/runbook-lucy-agent-chat-a3.md`**.

```bash
cp agent-chat/.env.example agent-chat/.env
cp -R agent-chat/hermes-home.example agent-chat/hermes-home
# edit agent-chat/.env — pin images as repository:tag@sha256:<64 hex>, keys, admins

docker compose -f docker-compose.agent-chat.yml --profile agent-chat --env-file agent-chat/.env up -d
```

Open `http://127.0.0.1:3000` (loopback by default).

### Pause vs Destroy

- **Pause:** `docker compose ... down` (keeps volume + hermes-home).
- **Destroy:** see Runbook (manual `down -v` + delete hermes-home + rotate secrets). Never automated by smoke.

## Design

See `docs/design-lucy-agent-chat-a3.md`.
