#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import {
  MARKER_PATH,
  SCALE_SEED,
  formatMarker,
  parseMarker,
  shouldReseed,
} from "./ensure-scale-baseline-lib.mjs";

test("parseMarker reads key=value lines and ignores comments", () => {
  const parsed = parseMarker(
    `# comment\nprofile=global\nseed=${SCALE_SEED}\nseeded_at=2026-11-24T00:00:00.000Z\n`,
  );
  assert.equal(parsed.profile, "global");
  assert.equal(parsed.seed, String(SCALE_SEED));
  assert.equal(parsed.seeded_at, "2026-11-24T00:00:00.000Z");
});

test("formatMarker round-trips through parseMarker", () => {
  const body = formatMarker({
    profile: "global",
    sot: "docs/qa/uat/scale-baseline.md",
    seed: String(SCALE_SEED),
    seeded_at: "2026-11-24T12:00:00.000Z",
    include_mysql: "1",
    include_hive: "0",
    container: "compose-lucy-1",
  });
  const parsed = parseMarker(body);
  assert.equal(parsed.profile, "global");
  assert.equal(parsed.include_hive, "0");
  assert.equal(parsed.container, "compose-lucy-1");
  assert.match(body, /^profile=global\n/);
});

test("shouldReseed skips when baseline already ok", () => {
  assert.deepEqual(
    shouldReseed({ force: false, checkOk: true, hasMarker: true }),
    { action: "skip", reason: "baseline_ok_with_marker" },
  );
  assert.deepEqual(
    shouldReseed({ force: false, checkOk: true, hasMarker: false }),
    { action: "skip", reason: "baseline_ok_write_marker" },
  );
});

test("shouldReseed reseeds on force or baseline gap", () => {
  assert.deepEqual(
    shouldReseed({ force: true, checkOk: true, hasMarker: true }),
    { action: "reseed", reason: "force" },
  );
  assert.deepEqual(
    shouldReseed({ force: false, checkOk: false, hasMarker: false }),
    { action: "reseed", reason: "baseline_gap_no_marker" },
  );
  assert.deepEqual(
    shouldReseed({ force: false, checkOk: false, hasMarker: true }),
    { action: "reseed", reason: "baseline_gap_despite_marker" },
  );
});

test("marker path stays on the Lucy data volume", () => {
  assert.equal(MARKER_PATH, "/data/lucy/.lucy-scale-seed");
});
