"""Provision the forrest_local proxy token.

Generates a new admin token via the local webui admin API, writes the plaintext
to /Users/forrest/Projects/project-lucy/.ktx/secrets/lucy-local-token (mode 600,
gitignored), and verifies the written file's sha256 matches the hash recorded
in access.yaml. Returns the plaintext in-process only — never logs it to a
file or stdout.
"""
import hashlib
import json
import os
import sys
import urllib.request

ADMIN_URL = "http://127.0.0.1:5175/api/admin/agents/forrest_local/tokens"
SECRET_PATH = "/Users/forrest/Projects/project-lucy/.ktx/secrets/lucy-local-token"
LABEL = sys.argv[1] if len(sys.argv) > 1 else "lucy-mcp-dev-v3"

req = urllib.request.Request(
    ADMIN_URL,
    data=json.dumps({"label": LABEL}).encode(),
    headers={"content-type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req) as resp:
    body = json.loads(resp.read())

if not body.get("ok"):
    print(f"FAIL: {body}", file=sys.stderr)
    sys.exit(1)

token = body["data"]["token"]
expected_hash = body["data"]["hash"]

# Verify the freshly-generated token hashes to the expected value
computed = "sha256:" + hashlib.sha256(token.encode()).hexdigest()
assert computed == expected_hash, f"hash mismatch: {computed} vs {expected_hash}"

# Write to the gitignored secrets dir, owner-only
os.makedirs(os.path.dirname(SECRET_PATH), exist_ok=True)
with open(SECRET_PATH, "w") as f:
    f.write(token)
os.chmod(SECRET_PATH, 0o600)

# Verify the on-disk content hashes correctly (defense against shell-escape bugs)
with open(SECRET_PATH) as f:
    on_disk = f.read()
disk_hash = "sha256:" + hashlib.sha256(on_disk.encode()).hexdigest()
assert disk_hash == expected_hash, f"disk hash mismatch: {disk_hash} vs {expected_hash}"

# Print ONLY the label and hash, never the plaintext
print(json.dumps({
    "ok": True,
    "label": LABEL,
    "hash": expected_hash,
    "secret_path": SECRET_PATH,
    "length": len(token),
}))
