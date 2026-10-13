#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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
  ".ktx-ui/ktx-internal-token",
  ".ktx/secrets"
];

/**
 * Named-volume prefix. An explicit COMPOSE_PROJECT_NAME wins. Otherwise the
 * name is `docker compose -f <composeFile> config --format json` → `name`
 * (the directory that contains the compose file, not the repo root). If that
 * config cannot be read, fall back to the cwd basename.
 *
 * @param {string} [cwd]
 * @param {{ composeFile?: string, lookupComposeProjectName?: (composeFile: string, cwd: string) => string }} [options]
 */
export function resolveComposeProjectName(cwd = process.cwd(), options = {}) {
  const fromEnv = process.env.COMPOSE_PROJECT_NAME?.trim();
  if (fromEnv) return fromEnv;

  const composeFile = options.composeFile;
  if (typeof composeFile === "string" && composeFile.trim()) {
    const lookup = options.lookupComposeProjectName ?? readComposeProjectNameFromConfig;
    try {
      const name = lookup(composeFile, cwd);
      if (typeof name === "string" && name.trim()) return name.trim();
    } catch {
      // Unreadable compose config falls back to the directory basename.
    }
  }
  return path.basename(cwd);
}

function readComposeProjectNameFromConfig(composeFile, cwd) {
  const result = spawnSync(
    "docker",
    ["compose", "-f", composeFile, "config", "--format", "json"],
    { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "docker compose config failed").trim());
  }
  let doc;
  try {
    doc = JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`docker compose config returned invalid json: ${err instanceof Error ? err.message : String(err)}`);
  }
  const name = doc?.name;
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("docker compose config json has no name");
  }
  return name.trim();
}

export class EmptyVolumeShadowError extends Error {
  /**
   * @param {{
   *   targetVolume: string,
   *   logicalVolumeName: string,
   *   shadowVolume: string,
   *   shadowFileCount: number,
   *   containerId?: string,
   *   containerName?: string
   * }} shadow
   */
  constructor(shadow) {
    super(formatEmptyVolumeShadowError(shadow));
    this.name = "EmptyVolumeShadowError";
    this.shadow = shadow;
  }
}

function formatEmptyVolumeShadowError(shadow) {
  const count = Number(shadow.shadowFileCount);
  const fileLabel = `${count} ${count === 1 ? "file" : "files"}`;
  let mountedBy = "a running container mounts";
  if (shadow.containerName && shadow.containerId) {
    mountedBy = `running container ${shadow.containerName} (${shadow.containerId}) mounts`;
  } else if (shadow.containerId) {
    mountedBy = `running container ${shadow.containerId} mounts`;
  } else if (shadow.containerName) {
    mountedBy = `running container ${shadow.containerName} mounts`;
  }
  return (
    `[lucy-upgrade] preserve check failed: volume ${shadow.targetVolume} exists but has 0 files, ` +
    `while ${mountedBy} ${shadow.shadowVolume} (logical name ${shadow.logicalVolumeName}) which has ${fileLabel}`
  );
}

/**
 * Fail when the resolved named volume exists, has no files, and a running
 * container mounts a different volume with the same logical name that does
 * have files. That empty volume must not be reported as preserved.
 *
 * @param {{
 *   targetVolume: string,
 *   logicalVolumeName: string,
 *   inspect?: (input: { targetVolume: string, logicalVolumeName: string }) => {
 *     targetExists: boolean,
 *     targetFileCount: number,
 *     otherMounts?: Array<{ volumeName: string, logicalVolumeName: string, fileCount: number, containerId?: string, containerName?: string }>
 *   }
 * }} input
 */
export function assertTargetVolumeNotEmptyShadow({
  targetVolume,
  logicalVolumeName,
  inspect = inspectEmptyVolumeShadow
}) {
  const evidence = inspect({ targetVolume, logicalVolumeName });
  const mount = selectEmptyVolumeShadow({
    targetVolume,
    logicalVolumeName,
    targetExists: evidence?.targetExists,
    targetFileCount: evidence?.targetFileCount,
    otherMounts: evidence?.otherMounts
  });
  if (!mount) return;
  throw new EmptyVolumeShadowError({
    targetVolume,
    logicalVolumeName,
    shadowVolume: mount.volumeName,
    shadowFileCount: Number(mount.fileCount),
    containerId: mount.containerId ?? "",
    containerName: mount.containerName ?? ""
  });
}

function selectEmptyVolumeShadow({
  targetVolume,
  logicalVolumeName,
  targetExists,
  targetFileCount,
  otherMounts
}) {
  if (targetExists !== true || targetFileCount !== 0) return null;
  const mounts = Array.isArray(otherMounts) ? otherMounts : [];
  for (const mount of mounts) {
    if (!mount || mount.volumeName === targetVolume) continue;
    if (mount.logicalVolumeName !== logicalVolumeName) continue;
    if (Number(mount.fileCount) > 0) return mount;
  }
  return null;
}

function runDocker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}

function inspectVolume(volumeName) {
  const result = runDocker(["volume", "inspect", volumeName]);
  if (result.status === 0) {
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (err) {
      throw new Error(`docker volume inspect ${volumeName} returned invalid json: ${err instanceof Error ? err.message : String(err)}`);
    }
    const info = Array.isArray(parsed) ? parsed[0] : parsed;
    return { exists: true, info: info ?? {} };
  }
  const errText = `${result.stderr || ""}\n${result.stdout || ""}`;
  if (/no such volume/i.test(errText)) return { exists: false, info: null };
  throw new Error(errText.trim() || `docker volume inspect ${volumeName} failed`);
}

function countFilesInVolume(volumeName) {
  const result = runDocker([
    "run",
    "--rm",
    "-v",
    `${volumeName}:/data/lucy:ro`,
    "busybox",
    "sh",
    "-c",
    "find /data/lucy -type f | wc -l"
  ]);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `failed to count files in ${volumeName}`).trim());
  }
  const n = Number.parseInt(String(result.stdout).trim(), 10);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`unexpected file count for ${volumeName}: ${JSON.stringify(result.stdout)}`);
  }
  return n;
}

function listRunningContainers() {
  const result = runDocker(["ps", "--format", "{{.ID}}\t{{.Names}}"]);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "docker ps failed").trim());
  }
  const containers = [];
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tab = trimmed.indexOf("\t");
    if (tab === -1) {
      containers.push({ id: trimmed, name: "" });
      continue;
    }
    containers.push({ id: trimmed.slice(0, tab), name: trimmed.slice(tab + 1) });
  }
  return containers;
}

function listContainerVolumeMounts(containerId) {
  const result = runDocker(["inspect", "--format", "{{json .Mounts}}", containerId]);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `docker inspect ${containerId} failed`).trim());
  }
  let mounts;
  try {
    mounts = JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`docker inspect mounts for ${containerId} returned invalid json: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(mounts)) return [];
  const volumes = [];
  for (const mount of mounts) {
    if (mount?.Type !== "volume" || typeof mount.Name !== "string" || !mount.Name) continue;
    volumes.push({ volumeName: mount.Name });
  }
  return volumes;
}

function logicalNameForVolume(volumeName, expectedLogical) {
  const inspected = inspectVolume(volumeName);
  if (!inspected.exists) return null;
  const label = inspected.info?.Labels?.["com.docker.compose.volume"];
  if (typeof label === "string" && label.trim()) return label.trim();
  if (volumeName === expectedLogical || volumeName.endsWith(`_${expectedLogical}`)) {
    return expectedLogical;
  }
  return null;
}

function inspectEmptyVolumeShadow({ targetVolume, logicalVolumeName }) {
  const target = inspectVolume(targetVolume);
  if (!target.exists) {
    return { targetExists: false, targetFileCount: 0, otherMounts: [] };
  }
  const targetFileCount = countFilesInVolume(targetVolume);
  if (targetFileCount !== 0) {
    return { targetExists: true, targetFileCount, otherMounts: [] };
  }
  const otherMounts = [];
  const seen = new Set();
  for (const container of listRunningContainers()) {
    for (const mount of listContainerVolumeMounts(container.id)) {
      if (mount.volumeName === targetVolume || seen.has(mount.volumeName)) continue;
      seen.add(mount.volumeName);
      const logical = logicalNameForVolume(mount.volumeName, logicalVolumeName);
      if (logical !== logicalVolumeName) continue;
      const fileCount = countFilesInVolume(mount.volumeName);
      otherMounts.push({
        volumeName: mount.volumeName,
        logicalVolumeName: logical,
        fileCount,
        containerId: container.id,
        containerName: container.name
      });
      if (fileCount > 0) {
        return { targetExists: true, targetFileCount, otherMounts };
      }
    }
  }
  return { targetExists: true, targetFileCount, otherMounts };
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
