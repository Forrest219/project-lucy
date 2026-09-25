#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";
import {
  PRESERVE_REL_PATHS,
  buildPreserveCheckScript,
  diffPreserveSnapshots,
  fullVolumeName,
  parsePreserveSnapshot,
  readLucyVolumeFromCompose,
  resolveComposeProjectName
} from "./upgrade-lucy-lib.mjs";

function usage() {
  console.error(`Usage:
  upgrade-lucy-cli.mjs volume-info --compose-file <file>
  upgrade-lucy-cli.mjs snapshot --volume <fullVolumeName> [--compose-file <file>]
  upgrade-lucy-cli.mjs verify-snapshot --before <text> --after <text>`);
  process.exit(2);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = "1";
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function runSnapshot(volumeName) {
  const script = buildPreserveCheckScript(PRESERVE_REL_PATHS);
  const result = spawnSync(
    "docker",
    ["run", "--rm", "-v", `${volumeName}:/data/lucy:ro`, "busybox", "sh", "-c", script],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }
  process.stdout.write(result.stdout ?? "");
}

async function runVolumeInfo(composeFile) {
  const info = await readLucyVolumeFromCompose(composeFile);
  if (info.kind === "bind") {
    console.log(["bind", "", "", info.source].join("\n"));
    return;
  }
  const project = resolveComposeProjectName();
  const full = fullVolumeName(project, info.logicalVolumeName);
  console.log(["named", info.logicalVolumeName, full, ""].join("\n"));
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  if (!command) usage();

  if (command === "volume-info") {
    if (!flags["compose-file"]) usage();
    await runVolumeInfo(flags["compose-file"]);
    return;
  }

  if (command === "snapshot") {
    if (!flags.volume) usage();
    runSnapshot(flags.volume);
    return;
  }

  if (command === "verify-snapshot") {
    const before = parsePreserveSnapshot(flags.before ?? "");
    const after = parsePreserveSnapshot(flags.after ?? "");
    const { missing, shrunk } = diffPreserveSnapshots(before, after);
    if (missing.length > 0 || shrunk.length > 0) {
      if (missing.length > 0) {
        console.error("[lucy-upgrade] preserve check failed; missing after upgrade:");
        for (const rel of missing) console.error(`  - ${rel}`);
      }
      if (shrunk.length > 0) {
        console.error("[lucy-upgrade] preserve check failed; shrunk after upgrade:");
        for (const item of shrunk) {
          console.error(`  - ${item.rel}: ${item.before} -> ${item.after}`);
        }
      }
      process.exit(1);
    }
    console.log("[lucy-upgrade] preserve check ok");
    return;
  }

  usage();
}

await main();
