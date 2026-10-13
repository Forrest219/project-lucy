#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  PRESERVE_REL_PATHS,
  EmptyVolumeShadowError,
  assertTargetVolumeNotEmptyShadow,
  buildPreserveCheckScript,
  diffPreserveSnapshots,
  fullVolumeName,
  parsePreserveSnapshot,
  readLucyVolumeFromCompose,
  resolveComposeProjectName
} from "./upgrade-lucy-lib.mjs";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);

test("readLucyVolumeFromCompose resolves demo named volume", async () => {
  const info = await readLucyVolumeFromCompose("deploy/compose/docker-compose.demo.yml", repoRoot);
  assert.equal(info.kind, "named");
  assert.equal(info.logicalVolumeName, "lucy-demo-data");
  assert.equal(info.mountPath, "/data/lucy");
});

test("readLucyVolumeFromCompose resolves production named volume", async () => {
  const info = await readLucyVolumeFromCompose("docker-compose.yml", repoRoot);
  assert.equal(info.kind, "named");
  assert.equal(info.logicalVolumeName, "lucy-data");
});

test("readLucyVolumeFromCompose resolves customer bind mount", async () => {
  const info = await readLucyVolumeFromCompose("deploy/compose/docker-compose.customer-config.yml", repoRoot);
  assert.equal(info.kind, "bind");
  assert.equal(info.source, "./customer-config");
});

test("fullVolumeName prefixes compose project name", () => {
  assert.equal(fullVolumeName("project-lucy", "lucy-demo-data"), "project-lucy_lucy-demo-data");
});

function restoreComposeProjectName(prev) {
  if (prev === undefined) delete process.env.COMPOSE_PROJECT_NAME;
  else process.env.COMPOSE_PROJECT_NAME = prev;
}

test("resolveComposeProjectName falls back to cwd basename when compose config cannot be read", () => {
  const prev = process.env.COMPOSE_PROJECT_NAME;
  delete process.env.COMPOSE_PROJECT_NAME;
  try {
    assert.equal(resolveComposeProjectName(repoRoot), path.basename(repoRoot));
    assert.equal(
      resolveComposeProjectName(repoRoot, {
        composeFile: "deploy/compose/docker-compose.demo.yml",
        lookupComposeProjectName() {
          throw new Error("docker unavailable");
        }
      }),
      path.basename(repoRoot)
    );
  } finally {
    restoreComposeProjectName(prev);
  }
});

test("resolveComposeProjectName prefers COMPOSE_PROJECT_NAME over compose config", () => {
  const prev = process.env.COMPOSE_PROJECT_NAME;
  process.env.COMPOSE_PROJECT_NAME = "explicit-project";
  let lookupCalls = 0;
  try {
    const name = resolveComposeProjectName(repoRoot, {
      composeFile: "deploy/compose/docker-compose.demo.yml",
      lookupComposeProjectName() {
        lookupCalls += 1;
        return "compose";
      }
    });
    assert.equal(name, "explicit-project");
    assert.equal(lookupCalls, 0);
  } finally {
    restoreComposeProjectName(prev);
  }
});

test("resolveComposeProjectName uses an injected compose config name", () => {
  const prev = process.env.COMPOSE_PROJECT_NAME;
  delete process.env.COMPOSE_PROJECT_NAME;
  try {
    const name = resolveComposeProjectName(repoRoot, {
      composeFile: "deploy/compose/docker-compose.demo.yml",
      lookupComposeProjectName() {
        return "compose";
      }
    });
    assert.equal(name, "compose");
    assert.notEqual(name, path.basename(repoRoot));
    assert.equal(fullVolumeName(name, "lucy-demo-data"), "compose_lucy-demo-data");
  } finally {
    restoreComposeProjectName(prev);
  }
});

test("empty target volume with a live container on another same-logical volume fails", () => {
  assert.throws(
    () => assertTargetVolumeNotEmptyShadow({
      targetVolume: "project-lucy_lucy-demo-data",
      logicalVolumeName: "lucy-demo-data",
      inspect() {
        return {
          targetExists: true,
          targetFileCount: 0,
          otherMounts: [
            {
              volumeName: "compose_lucy-demo-data",
              logicalVolumeName: "lucy-demo-data",
              fileCount: 7,
              containerId: "abc123",
              containerName: "compose-lucy-1"
            }
          ]
        };
      }
    }),
    (err) => {
      assert.ok(err instanceof EmptyVolumeShadowError);
      assert.equal(err.shadow.shadowVolume, "compose_lucy-demo-data");
      assert.match(err.message, /preserve check failed/);
      assert.match(err.message, /project-lucy_lucy-demo-data/);
      assert.match(err.message, /0 files/);
      assert.match(err.message, /compose_lucy-demo-data/);
      assert.doesNotMatch(err.message, /preserve check ok/);
      assert.doesNotMatch(err.message, /preserved=true/);
      return true;
    }
  );

  const quiet = {
    targetVolume: "project-lucy_lucy-demo-data",
    logicalVolumeName: "lucy-demo-data"
  };
  assert.doesNotThrow(() => assertTargetVolumeNotEmptyShadow({
    ...quiet,
    inspect: () => ({
      targetExists: true,
      targetFileCount: 4,
      otherMounts: [{
        volumeName: "compose_lucy-demo-data",
        logicalVolumeName: "lucy-demo-data",
        fileCount: 9
      }]
    })
  }));
  assert.doesNotThrow(() => assertTargetVolumeNotEmptyShadow({
    ...quiet,
    inspect: () => ({
      targetExists: true,
      targetFileCount: 0,
      otherMounts: [{
        volumeName: "compose_lucy-demo-data",
        logicalVolumeName: "lucy-demo-data",
        fileCount: 0
      }]
    })
  }));
  assert.doesNotThrow(() => assertTargetVolumeNotEmptyShadow({
    ...quiet,
    inspect: () => ({
      targetExists: false,
      targetFileCount: 0,
      otherMounts: [{
        volumeName: "compose_lucy-demo-data",
        logicalVolumeName: "lucy-demo-data",
        fileCount: 9
      }]
    })
  }));
  assert.doesNotThrow(() => assertTargetVolumeNotEmptyShadow({
    ...quiet,
    inspect: () => ({
      targetExists: true,
      targetFileCount: 0,
      otherMounts: [{
        volumeName: "project-lucy_lucy-demo-data",
        logicalVolumeName: "lucy-demo-data",
        fileCount: 9
      }]
    })
  }));
});

test("parsePreserveSnapshot reads file and directory markers", () => {
  const snapshot = parsePreserveSnapshot([
    "webui/config/admins.yaml|file|128",
    "webui/config/access.yaml|file|512",
    ".ktx-ui/audit.sqlite|file|4096",
    ".ktx/secrets|dir|2"
  ].join("\n"));
  assert.equal(snapshot.get("webui/config/admins.yaml")?.size, 128);
  assert.equal(snapshot.get(".ktx/secrets")?.kind, "dir");
});

test("diffPreserveSnapshots flags missing and shrunk paths", () => {
  const before = parsePreserveSnapshot([
    "webui/config/admins.yaml|file|128",
    ".ktx-ui/audit.sqlite|file|4096"
  ].join("\n"));
  const after = parsePreserveSnapshot([
    ".ktx-ui/audit.sqlite|file|1024"
  ].join("\n"));
  const { missing, shrunk } = diffPreserveSnapshots(before, after);
  assert.deepEqual(missing, ["webui/config/admins.yaml"]);
  assert.deepEqual(shrunk, [{ rel: ".ktx-ui/audit.sqlite", before: 4096, after: 1024 }]);
});

test("buildPreserveCheckScript covers all preserve rel paths", () => {
  const script = buildPreserveCheckScript(PRESERVE_REL_PATHS);
  for (const rel of PRESERVE_REL_PATHS) {
    assert.match(script, new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("upgrade-lucy.sh avoids bash 4-only syntax (stock macOS bash 3.2 compatible)", () => {
  const src = readFileSync(path.join(repoRoot, "scripts/upgrade/upgrade-lucy.sh"), "utf8");
  assert.doesNotMatch(src, /^\s*readarray\b/m, "readarray requires bash 4; use a while-read loop");
  assert.doesNotMatch(src, /^\s*mapfile\b/m, "mapfile requires bash 4; use a while-read loop");
  assert.doesNotMatch(src, /\[\s*-\d+\s*\]/, "negative array subscripts require bash 4.3+");
});

test("upgrade-lucy.sh parses under stock macOS bash 3.2 when available", () => {
  let versionOut;
  try {
    versionOut = execFileSync("/bin/bash", ["-c", "echo $BASH_VERSION"], { encoding: "utf8" }).trim();
  } catch {
    return; // /bin/bash absent (non-macOS host): static assertions above still apply
  }
  const match = versionOut.match(/^(\d+)\.(\d+)/);
  if (!match || Number(match[1]) >= 4) return; // only gate when host ships bash 3.x
  execFileSync("/bin/bash", ["-n", path.join(repoRoot, "scripts/upgrade/upgrade-lucy.sh")]);
});
