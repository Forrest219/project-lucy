# Agent Chat (A3) — optional sidecar for Lucy

Lucy remains independently deliverable. This directory only supports the optional
**Agent Chat** validation stack (Open WebUI + Hermes → Lucy MCP).

## Quick start

1. Ensure Lucy MCP Proxy is already running (default compose or your deploy).
2. Create a Lucy Agent token (Admin → Agents) with a read-only role; copy Hermes MCP snippet fields.
3. Follow **`docs/runbook-lucy-agent-chat-a3.md`**.

```bash
cp agent-chat/.env.example agent-chat/.env
cp -R agent-chat/hermes-home.example agent-chat/hermes-home
# edit agent-chat/.env — set API_SERVER_KEY, LUCY_PUBLIC_MCP_URL, LUCY_AGENT_TOKEN, LLM key

docker compose -f docker-compose.agent-chat.yml --profile agent-chat --env-file agent-chat/.env up -d
```

Open http://localhost:3000 (or `AGENT_CHAT_WEBUI_HOST_PORT`).

## Design

See `docs/design-lucy-agent-chat-a3.md`.
