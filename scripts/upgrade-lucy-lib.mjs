#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

/** Paths under /data/lucy that must survive a smooth upgrade. */
export const PRESERVE_REL_PATHS = [
  "ktx.yaml",
  "webui/config/access.yaml",
  "webui/config/admins.yaml",
  ".ktx-ui/audit.sqlite",
  ".ktx-ui/webui-session-secret",
  ".ktx/secrets"
];

export function resolveComposeProjectName(cwd = process.cwd()) {
  return process.env.COMPOSE_PROJECT_NAME?.trim() || path.basename(cwd);
}

export function fullVolumeName(projectName, logicalVolumeName) {
  return `${projectName}_${logicalVolumeName}`;
}

export async function readLucyVolumeFromCompose(composeFile, cwd = process.cwd()) {
  const abs = path.resolve(cwd, composeFile);
  const raw = await readFile(abs, "utf8");
  const doc = YAML.parse(raw);
  const lucy = doc?.services?.lucy;
  if (!lucy?.volumes) {
    throw new Error(`compose file ${composeFile} has no lucy service volumes`);
  }

  for (const entry of lucy.volumes) {
    if (typeof entry === "string" && entry.includes(":/data/lucy")) {
      const [source] = entry.split(":");
      if (source.startsWith("./") || source.startsWith("/")) {
        return { kind: "bind", source, mountPath: "/data/lucy" };
      }
      return { kind: "named", logicalVolumeName: source, mountPath: "/data/lucy" };
    }
  }

  throw new Error(`compose file ${composeFile} has no /data/lucy volume mount on lucy`);
}

export function buildPreserveCheckScript(relPaths = PRESERVE_REL_PATHS) {
  const lines = [
    "set -eu",
    "ROOT=/data/lucy",
    ...relPaths.map((rel) => {
      const full = `"${rel.replace(/"/g, '\\"')}"`;
      return [
        `if [ -e "$ROOT/${rel}" ]; then`,
        `  if [ -d "$ROOT/${rel}" ]; then`,
        `    echo "${rel}|dir|$(find "$ROOT/${rel}" -type f | wc -l | tr -d ' ')"`,
        `  else`,
        `    echo "${rel}|file|$(wc -c < "$ROOT/${rel}" | tr -d ' ')"`,
        `  fi`,
        `fi`
      ].join("\n");
    })
  ];
  return lines.join("\n");
}

export function parsePreserveSnapshot(text) {
  const snapshot = new Map();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [rel, kind, size] = trimmed.split("|");
    if (!rel || !kind || size === undefined) continue;
    snapshot.set(rel, { kind, size: Number(size) });
  }
  return snapshot;
}

export function diffPreserveSnapshots(before, after) {
  const missing = [];
  const shrunk = [];
  for (const [rel, prev] of before.entries()) {
    const next = after.get(rel);
    if (!next) {
      missing.push(rel);
      continue;
    }
    if (prev.kind === "file" && next.kind === "file" && next.size < prev.size) {
      shrunk.push({ rel, before: prev.size, after: next.size });
    }
    if (prev.kind === "dir" && next.kind === "dir" && next.size < prev.size) {
      shrunk.push({ rel, before: prev.size, after: next.size });
    }
  }
  return { missing, shrunk };
}
