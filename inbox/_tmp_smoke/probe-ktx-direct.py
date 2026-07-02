"""Direct-probe KTX upstream :7878 with the KTX_INTERNAL_TOKEN read from
the workhorse process's env. Token arrives on stdin from /tmp/workhorse-internal.txt.
"""
import json
import sys
import urllib.request

KTX_URL = "http://127.0.0.1:7878/mcp"

token = sys.stdin.read().strip()
if not token:
    print("empty token on stdin", file=sys.stderr)
    sys.exit(1)

req = urllib.request.Request(
    KTX_URL,
    data=json.dumps({
        "jsonrpc": "2.0",
        "id": "ktx-direct-probe",
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "clientInfo": {"name": "taskb-direct-ktx-probe"},
            "capabilities": {}
        }
    }).encode(),
    headers={
        "content-type": "application/json",
        "accept": "application/json, text/event-stream",
        "Authorization": "Bearer " + token,
    },
    method="POST",
)
try:
    r = urllib.request.urlopen(req)
    print(f"status: {r.status}")
    print(f"content-type: {r.headers.get('content-type')}")
    body = r.read().decode("utf-8", errors="replace")
    print(f"body length: {len(body)}")
    print(f"body[:300]: {body[:300]}")
except urllib.error.HTTPError as e:
    print(f"HTTPError: {e.code} {e.headers.get('content-type')}")
    print(f"body: {e.read().decode()[:200]}")
