"""Run `claude -p --mcp-config ... --strict-mcp-config ...` with
LUCY_LOCAL_TOKEN set to the value read from the .ktx/secrets file.

This script:
  1. Reads the token from the secrets file (no plaintext in argv)
  2. Sets LUCY_LOCAL_TOKEN in the child process env
  3. Execs claude -p with the requested args
  4. The child's stdout/stderr flows unchanged

Args after this script are passed to `claude` verbatim.
"""
import os
import shutil
import sys

SECRET_PATH = "/Users/forrest/Projects/project-lucy/.ktx/secrets/lucy-local-token"
MCP_CONFIG = "/Users/forrest/Projects/project-lucy/.mcp.json"

with open(SECRET_PATH) as f:
    token = f.read().strip()
assert len(token) == 64, f"unexpected token length: {len(token)}"

claude_path = shutil.which("claude")
if not claude_path:
    print("claude not found in PATH", file=sys.stderr)
    sys.exit(1)

env = os.environ.copy()
env["LUCY_LOCAL_TOKEN"] = token

cmd = [claude_path, "-p", "--mcp-config", MCP_CONFIG, "--strict-mcp-config", *sys.argv[1:]]
os.execvpe(claude_path, cmd, env)
