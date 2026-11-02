import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertProductVersion,
  collectVersionGovernanceErrors,
  isCustomerImageRefForVersion,
  isReleaseTagForVersion
} from "./lucy-version-governance.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// The product version is read from the repo-root VERSION file instead of being hardcoded here.
// A release bump (VERSION 0.20.0 -> 0.25.0) used to leave these two contracts asserting a stale
// literal, which turned a version check into a version-drift failure. Reading VERSION keeps the
// assertion exactly as strong — the build script must still name the CURRENT repo version — and
// stops the next bump from breaking it.
const REPO_VERSION = collectVersionGovernanceErrors().version;
const REPO_VERSION_IN_REGEX = REPO_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A version that is guaranteed to disagree with the repo version, whatever the repo version is.
const WRONG_VERSION = (() => {
  const [major, minor, patch] = REPO_VERSION.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
})();

test("product version accepts only numeric X.Y.Z", () => {
  assert.equal(assertProductVersion("0.17.0"), "0.17.0");
  for (const invalid of ["v0.17.0", "0.17", "0.17.0-beta", "garbage", ""]) {
    assert.throws(() => assertProductVersion(invalid), /numeric X\.Y\.Z/);
  }
});

test("customer image tag must carry the exact Lucy product version", () => {
  assert.equal(
    isCustomerImageRefForVersion("registry.example.com:5000/lucy:customer-amd64-0.17.0-20260902-b262798", "0.17.0"),
    true
  );
  assert.equal(isCustomerImageRefForVersion("project-lucy:customer-amd64-0.16.0-20260902-b262798", "0.17.0"), false);
  assert.equal(isCustomerImageRefForVersion("project-lucy:0.17.0", "0.17.0"), false);
});

test("release tag accepts exact product releases and immutable customer tags", () => {
  for (const tag of ["0.17.0", "v0.17.0", "customer-amd64-0.17.0-20260902-b262798", "customer-multiarch-0.17.0-20260902-b262798"]) {
    assert.equal(isReleaseTagForVersion(tag, "0.17.0"), true, tag);
  }
  for (const tag of ["v0.16.0", "manual-deadbee", "customer-amd64-0.16.0-20260902-b262798"]) {
    assert.equal(isReleaseTagForVersion(tag, "0.17.0"), false, tag);
  }
});

test("all committed Lucy version projections match VERSION", () => {
  const result = collectVersionGovernanceErrors();
  assert.deepEqual(result.errors, []);
});

test("customer build fails before Docker when IMAGE tag disagrees with VERSION", () => {
  const result = spawnSync("bash", ["scripts/release/build-customer-amd64-image.sh"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      IMAGE: `project-lucy:customer-amd64-${WRONG_VERSION}-20260902-b262798`
    }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`customer image tag must be customer-amd64-${REPO_VERSION_IN_REGEX}`));
  assert.doesNotMatch(result.stdout + result.stderr, /building \(see/);
});

test("customer build rejects a LUCY_VERSION override that disagrees with VERSION", () => {
  const result = spawnSync("bash", ["scripts/release/build-customer-amd64-image.sh"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      LUCY_VERSION: WRONG_VERSION
    }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`does not match repo VERSION=${REPO_VERSION_IN_REGEX}`));
  assert.doesNotMatch(result.stdout + result.stderr, /building \(see/);
});
