"""Start the Lucy webui + proxy on ports 5175/7890 with a known
KTX_INTERNAL_TOKEN read from a file. Reads the token from stdin so the value
never has to be embedded in this script.

Usage:
  echo "$KTX_INTERNAL_TOKEN" | python3 start-webui-with-internal-token.py [extra args...]

The script then exec()s the webui process. Stdout/stderr from webui flow
through unchanged.
"""
import os
import subprocess
import sys

token = sys.stdin.read().strip()
if not token:
    print("ERROR: empty KTX_INTERNAL_TOKEN on stdin", file=sys.stderr)
    sys.exit(1)

env = os.environ.copy()
env["KTX_INTERNAL_TOKEN"] = token
env["LUCY_WEBUI_PORT"] = "5175"
env["LUCY_PROXY_PORT"] = "7890"
env["KTX_PROJECT_ROOT"] = "/Users/forrest/Projects/project-lucy"
env["LUCY_AUDIT_DB"] = "/tmp/lucy-taskb-webui.sqlite"
# Add v24 node to PATH so the tsx shim picks the right ABI for better-sqlite3
env["PATH"] = "/Users/forrest/.local/node-v24.14.1-darwin-arm64/bin:" + env.get("PATH", "")

cmd = [
    "/Users/forrest/Projects/project-lucy/webui/node_modules/.bin/tsx",
    "/Users/forrest/Projects/project-lucy/webui/server/index.ts",
]

# Never echo the token. Just exec.
os.execvpe(cmd[0], cmd, env)
