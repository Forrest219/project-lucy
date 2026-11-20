#!/usr/bin/env python3
"""Freeze task UAT source and build a separate local image; never retag demo."""
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import io
import tarfile

root = pathlib.Path(__file__).resolve().parents[2]
out = root / "inbox/p1-58-59-finalization-20261120"
baseline = len(sys.argv) > 2
revision = subprocess.check_output(["git", "rev-parse", sys.argv[2] if baseline else "HEAD"], cwd=root, text=True).strip()
name = sys.argv[1] if len(sys.argv) > 1 else "dev1"
if not name.isalnum():
    raise SystemExit("alphanumeric candidate name required")
context = out / ("candidate-" + name)
context.mkdir(parents=True, exist_ok=False)
manifest = {}
if baseline:
    raw = subprocess.check_output(["git", "archive", revision, "webui", "VERSION", "scripts/release/lucy-build-revision.mjs"], cwd=root)
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue
            target = context / member.name
            if not target.resolve().is_relative_to(context.resolve()):
                raise SystemExit("invalid archive path")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.extractfile(member).read())
            manifest[member.name] = hashlib.sha256(target.read_bytes()).hexdigest()
else:
    paths = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "webui", "VERSION", "scripts/release/lucy-build-revision.mjs"], cwd=root, text=True).splitlines()
    for rel in sorted(set(paths)):
        source = root / rel
        if not source.is_file():
            continue
        target = context / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        manifest[rel] = hashlib.sha256(target.read_bytes()).hexdigest()
if name == "taskbaseline":
    patch = (out / "initial-worktree.patch").read_text()
    chunks = patch.split("diff --git ")
    selected = []
    for chunk in chunks[1:]:
        rel = chunk.split(" b/", 1)[1].split("\n", 1)[0]
        if rel.startswith("webui/") or rel in ["VERSION", "scripts/release/lucy-build-revision.mjs"]:
            selected.append("diff --git " + chunk)
    selected_path = out / "taskbaseline-runtime.patch"
    selected_path.write_text("".join(selected))
    subprocess.run(["git", "apply", "--no-index", "--unsafe-paths", "--directory", str(context), str(selected_path)], check=True, cwd=root)
    for rel in manifest:
        manifest[rel] = hashlib.sha256((context / rel).read_bytes()).hexdigest()
    expected = json.loads((out / "initial-hashes.json").read_text())
    for rel, expected_digest in expected.items():
        if manifest.get(rel) != expected_digest:
            raise SystemExit("initial-source hash mismatch: " + rel)
digest = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
base = subprocess.check_output(["docker", "image", "inspect", "project-lucy:demo", "--format", "{{.Id}}"], text=True).strip()
base_tag = "lucy-racs-base:" + base.split(":")[1][:12]
subprocess.run(["docker", "tag", base, base_tag], check=True)
image = "lucy-racs-uat:" + name
metadata = {"revision": revision, "dirty": True, "sourceDigest": digest, "reconstructedBaseline": baseline, "baseImage": base, "files": manifest}
(context / "RACS_SOURCE_MANIFEST.json").write_text(json.dumps(metadata, indent=2))
(context / "Dockerfile").write_text(f"""FROM {base_tag}
USER 0
COPY --chown=10001:10001 . /app/
ENV LUCY_GIT_SHA={revision} LUCY_GIT_DIRTY=1
RUN node /app/scripts/release/lucy-build-revision.mjs && cd /app/webui && npm run build
LABEL lucy.racs.source-digest={digest}
USER 10001:10001
""")
with (out / ("build-" + name + ".log")).open("w") as log:
    subprocess.run(["docker", "build", "-t", image, str(context)], stdout=log, stderr=subprocess.STDOUT, check=True)
metadata["image"] = image
metadata["imageId"] = subprocess.check_output(["docker", "image", "inspect", image, "--format", "{{.Id}}"], text=True).strip()
(out / ("candidate-" + name + ".json")).write_text(json.dumps(metadata, indent=2))
print(json.dumps({key: metadata[key] for key in ["revision", "sourceDigest", "image", "imageId"]}))
