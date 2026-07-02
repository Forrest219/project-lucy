"""Diagnostic: explicitly hit 7890 with verbose error reporting."""
import http.client
import json
import sys

conn = http.client.HTTPConnection("127.0.0.1", 7890, timeout=5)
conn.set_debuglevel(2)

token = sys.stdin.read().strip()
print(f"DEBUG: token length on stdin: {len(token)}", file=sys.stderr)

headers = {
    "content-type": "application/json",
    "Authorization": "Bearer " + token,
}
body = json.dumps({
    "jsonrpc": "2.0",
    "id": "diag-1",
    "method": "initialize",
    "params": {"clientInfo": {"name": "taskb-diag"}}
})
print(f"DEBUG: POST /mcp, body length {len(body)}", file=sys.stderr)

try:
    conn.request("POST", "/mcp", body=body, headers=headers)
    resp = conn.getresponse()
    print(f"DEBUG: status={resp.status}, reason={resp.reason}", file=sys.stderr)
    print(f"DEBUG: headers: {dict(resp.getheaders())}", file=sys.stderr)
    raw = resp.read()
    print(f"DEBUG: body: {raw!r}", file=sys.stderr)
    print("BODY:", raw.decode("utf-8", errors="replace"))
except Exception as e:
    print(f"DEBUG: exception: {type(e).__name__}: {e}", file=sys.stderr)
    raise
finally:
    conn.close()
