#!/usr/bin/env python3
"""Start a named, resource-capped local RACS fixture; no shared demo mutation."""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
import urllib.request

root = pathlib.Path(__file__).resolve().parents[2]
out = root / "inbox/p1-58-59-finalization-20261120"
name, fixture, image, port = sys.argv[1:5]
if not name.startswith("lucy-racs-") or not port.isdigit():
    raise SystemExit("task-owned container name required")
source = out / fixture / "project"
volume = os.environ.get("RACS_EXISTING_VOLUME") or name + "-data"
if os.environ.get("RACS_EXISTING_VOLUME"):
    if not volume.startswith("lucy-racs-"):
        raise SystemExit("task volume required")
    label = subprocess.check_output(["docker", "volume", "inspect", volume, "--format", '{{index .Labels "lucy.uat"}}'], text=True).strip()
    if label != "racs-20261120":
        raise SystemExit("unowned volume")
    active = subprocess.check_output(["docker", "ps", "--filter", "volume=" + volume, "--format", "{{.Names}}"], text=True).strip()
    if active:
        raise SystemExit("stop old task instance before reusing its verified read-only fixture")
else:
    if subprocess.run(["docker", "volume", "inspect", volume], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
        raise SystemExit("refuse to reuse a pre-existing fixture volume")
    subprocess.run(["docker", "volume", "create", "--label", "lucy.uat=racs-20261120", volume], check=True, stdout=subprocess.DEVNULL)
    init = name + "-init"
    subprocess.check_output(["docker", "create", "--name", init, "--user", "0", "--mount", f"type=volume,source={volume},target=/data/lucy",
        "--entrypoint", "/bin/sh", image, "-ec", "chown -R 10001:10001 /data/lucy"], text=True)
    subprocess.run(["docker", "cp", str(source) + "/.", init + ":/data/lucy/"], check=True)
    subprocess.run(["docker", "start", "-a", init], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["docker", "rm", init], check=True, stdout=subprocess.DEVNULL)
command = ["docker", "run", "-d", "--name", name, "--cpus", "2", "--memory", "4g",
    "--label", "lucy.uat=racs-20261120", "-p", f"127.0.0.1:{port}:5174",
    "--mount", f"type=volume,source={volume},target=/data/lucy",
    "-e", "KTX_PROJECT_ROOT=/data/lucy", "-e", "LUCY_CONTENT_ROOT=/data/lucy/config",
    "-e", "LUCY_ADMINS_CONFIG_PATH=/data/lucy/webui/config/admins.yaml",
    "-e", "LUCY_WEBUI_AUTH=on", "-e", "LUCY_TEMPLATE_ROOT=/nonexistent",
    image]
container_id = subprocess.check_output(command, text=True).strip()
health = None
for _ in range(180):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=5) as response:
            health = json.load(response)
        break
    except Exception:
        time.sleep(1)
if health is None:
    raise SystemExit("fixture startup not healthy; inspect task container logs")
metadata = {"name": name, "containerId": container_id, "image": image, "port": int(port),
    "fixture": fixture, "volume": volume, "health": health}
(out / (name + "-instance.json")).write_text(json.dumps(metadata, indent=2))
print(json.dumps({"name":name, "port":int(port), "health":health.get("data",{}).get("status"), "candidate":health.get("data",{}).get("gitSha")}))
