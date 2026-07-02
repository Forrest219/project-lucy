"""Probe the local Lucy MCP proxy at :7890 with the forrest_local token.

The token is read from stdin (a single line) so the value never appears in
this script's source. Expects:
  echo "$TOKEN" | python3 probe-proxy.py

Confirms:
  1) Bearer auth succeeds (200, not 401)
  2) initialize response includes injected `result.instructions`
  3) The injected content matches the on-disk data-qa-instructions.md
"""
import hashlib
import json
import sys
import urllib.request

PROXY_URL = "http://127.0.0.1:7890/mcp"
INSTRUCTIONS_PATH = "/Users/forrest/Projects/project-lucy/webui/config/data-qa-instructions.md"

token = sys.stdin.read().strip()
if not token:
    print("empty token on stdin", file=sys.stderr)
    sys.exit(1)
if len(token) != 64:
    print(f"unexpected token length: {len(token)}", file=sys.stderr)
    sys.exit(1)

with open(INSTRUCTIONS_PATH) as f:
    expected_instructions = f.read().strip()

req = urllib.request.Request(
    PROXY_URL,
    data=json.dumps({
        "jsonrpc": "2.0",
        "id": "taskb-probe",
        "method": "initialize",
        "params": {"clientInfo": {"name": "taskb-curl-probe"}}
    }).encode(),
    headers={
        "content-type": "application/json",
        "Authorization": "Bearer " + token,
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req) as resp:
        status = resp.status
        body = json.loads(resp.read())
except urllib.error.HTTPError as e:
    print(f"HTTP {e.code}: {e.read().decode()}")
    sys.exit(1)

result = body.get("result", {})
instructions = result.get("instructions", "")
print(f"status: {status}")
print(f"serverInfo: {result.get('serverInfo')}")
print(f"result.instructions length: {len(instructions)}")
print(f"instructions matches data-qa-instructions.md: {instructions.strip() == expected_instructions}")
print(f"instructions starts with: {instructions[:80]!r}")
print(f"on-disk token sha256: sha256:{hashlib.sha256(token.encode()).hexdigest()}")
