#!/usr/bin/env python3
"""Compare a rendered Lucy Deployment with the live one.

Flags only the fields a hand-patched Deployment keeps across Helm upgrade:
container command/args, volumes, volumeMounts, and init containers that the
chart does not declare. Prints a JSON Patch for review. Does not apply it.
"""
import json
import sys


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def spec_of(doc):
    return doc["spec"]["template"]["spec"]


def lucy_container(doc):
    containers = spec_of(doc).get("containers") or []
    for index, container in enumerate(containers):
        if container.get("name") == "lucy":
            return index, container
    raise SystemExit("rendered or live Deployment has no container named lucy")


def present(value):
    return bool(value)


def extra_indexes(live_items, desired_items):
    desired_names = {item.get("name") for item in (desired_items or []) if item.get("name")}
    extras = []
    for index, item in enumerate(live_items or []):
        name = item.get("name")
        if name and name not in desired_names:
            extras.append((index, name))
    return extras


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: preflight_upgrade_drift.py <desired.json> <live.json>")
    desired = load(sys.argv[1])
    live = load(sys.argv[2])
    desired_spec = spec_of(desired)
    live_spec = spec_of(live)
    desired_index, desired_container = lucy_container(desired)
    live_index, live_container = lucy_container(live)
    if desired_index != live_index:
        # Patch paths follow the live object. A different index is itself drift
        # only when we would edit that container; record it so the patch is not
        # applied to the wrong container.
        print(f"DRIFT containerIndex live={live_index} desired={desired_index}")

    notes = []
    patch = []
    container_base = f"/spec/template/spec/containers/{live_index}"

    for field in ("command", "args"):
        live_value = live_container.get(field)
        desired_value = desired_container.get(field)
        if present(live_value) and not present(desired_value):
            notes.append(f"DRIFT {field} {container_base}/{field}")
            patch.append({"op": "remove", "path": f"{container_base}/{field}"})
        elif present(live_value) and present(desired_value) and list(live_value) != list(desired_value):
            notes.append(f"DRIFT {field} {container_base}/{field}")
            patch.append({"op": "replace", "path": f"{container_base}/{field}", "value": desired_value})

    for kind, live_items, desired_items, base in (
        (
            "volumeMount",
            live_container.get("volumeMounts"),
            desired_container.get("volumeMounts"),
            f"{container_base}/volumeMounts",
        ),
        (
            "volume",
            live_spec.get("volumes"),
            desired_spec.get("volumes"),
            "/spec/template/spec/volumes",
        ),
        (
            "initContainer",
            live_spec.get("initContainers"),
            desired_spec.get("initContainers"),
            "/spec/template/spec/initContainers",
        ),
    ):
        extras = extra_indexes(live_items, desired_items)
        for index, name in sorted(extras, reverse=True):
            notes.append(f"DRIFT {kind} {name} {base}/{index}")
            patch.append({"op": "remove", "path": f"{base}/{index}"})

    for line in notes:
        print(line)
    if patch:
        print("PATCH")
        print(json.dumps(patch, indent=2))
        return 1
    print("OK drift")
    return 0


if __name__ == "__main__":
    sys.exit(main())
