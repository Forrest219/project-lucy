// Demo seed sometimes uses file:…/demo-password. Endpoint password replace only
// allows the canonical `.ktx/secrets/<connId>-password` ref. Normalize in-container
// without printing secret bytes.

import { spawnSync } from "node:child_process";

const CONTAINER = process.env.LUCY_E2E_DOCKER_LUCY_CONTAINER ?? "compose-lucy-1";
const PROJECT_ROOT = process.env.LUCY_E2E_DOCKER_PROJECT_ROOT ?? "/data/lucy";

export function ensureCanonicalFilePassword(connId: string): { ok: boolean; detail: string } {
  const script = `
set -e
ROOT="${PROJECT_ROOT}"
CONN="${connId}"
SRC="$ROOT/.ktx/secrets/demo-password"
DST="$ROOT/.ktx/secrets/\${CONN}-password"
KTX="$ROOT/ktx.yaml"
if [ ! -f "$KTX" ]; then echo "missing_ktx"; exit 2; fi
mkdir -p "$ROOT/.ktx/secrets"
if [ ! -f "$DST" ] && [ -f "$SRC" ]; then
  cp -p "$SRC" "$DST"
  chmod 600 "$DST"
  chown lucy:lucy "$DST" 2>/dev/null || true
fi
python3 - <<'PY'
from pathlib import Path
root = Path("${PROJECT_ROOT}")
conn = "${connId}"
ktx = root / "ktx.yaml"
text = ktx.read_text()
canonical = f"password: file:{root}/.ktx/secrets/{conn}-password"
legacy_abs = f"password: file:{root}/.ktx/secrets/demo-password"
legacy_rel = "password: file:.ktx/secrets/demo-password"
if f"{conn}:" not in text:
    raise SystemExit("missing_conn")
if canonical in text:
    print("already_canonical")
    raise SystemExit(0)
idx = text.index(f"  {conn}:") if f"  {conn}:" in text else text.index(f"{conn}:")
head, tail = text[:idx], text[idx:]
for old in (legacy_abs, legacy_rel):
    if old in tail:
        ktx.write_text(head + tail.replace(old, canonical, 1))
        print("normalized")
        raise SystemExit(0)
print("unexpected_password_ref")
raise SystemExit(3)
PY
`;
  const res = spawnSync("docker", ["exec", CONTAINER, "sh", "-c", script], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  if (res.status !== 0) {
    return {
      ok: false,
      detail: `docker exec failed status=${res.status} stderr=${(res.stderr || "").slice(0, 200)}`
    };
  }
  const out = (res.stdout || "").trim();
  return { ok: out === "already_canonical" || out === "normalized", detail: out || "empty" };
}
