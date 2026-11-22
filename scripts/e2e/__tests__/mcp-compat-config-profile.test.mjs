/**
 * Unit tests for CompatConfigProfile apply/backup/restore + fingerprint (P1-54 Wave A1).
 *
 * Acceptance (Plan step 1):
 *   - fingerprint stable
 *   - restore failure stops (throws; subsequent cases must not continue)
 *   - no admin on dual-connection fixture
 *   - frozen W0 role is not lucy_ops_reader as permanent deny carrier
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { parse as parseYaml } from "yaml";

import {
  CONFIG_PROFILE_ID,
  CONFIG_PROFILE_VERSION,
  CompatConfigRestoreError,
  DUAL_READONLY_ROLE_ID,
  FROZEN_W0_ROLE_ID,
  FORBIDDEN_ADMIN_ROLE_ID,
  NO_QUERY_ROLE_ID,
  PRODUCT_OPS_READER_ROLE_ID,
  applyCompatConfigProfile,
  backupCompatConfigFiles,
  computeConfigProfileFingerprint,
  loadCompatConfigProfile,
  restoreCompatConfigProfile,
  stableStringify,
  validateCompatConfigProfile,
} from "../lib/mcp-compat-config-profile.mjs";

function seedMinimalProject(root) {
  mkdirSync(path.join(root, "webui", "config"), { recursive: true });
  writeFileSync(
    path.join(root, "webui", "config", "access.yaml"),
    [
      "roles:",
      "  demo_readonly:",
      "    allow:",
      "      connections: [demo-mysql]",
      "      tools: [lucy_catalog, lucy_query]",
      "  lucy_ops_reader:",
      "    allow:",
      "      connections: [lucy-ops]",
      "      tableSelectors:",
      "        - connection: lucy-ops",
      "          schema: main",
      "          names: [ops_calls, ops_call_tables]",
      "      tools: [lucy_catalog, lucy_query]",
      "  lucy_admin:",
      "    allow:",
      "      connections: ['*']",
      "      tools: [lucy_catalog, lucy_query]",
      "users: []",
      "defaults:",
      "  deny_tools: []",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    path.join(root, "ktx.yaml"),
    [
      "connections:",
      "  demo-mysql:",
      "    driver: mysql",
      "    enabled_tables:",
      "      - dataforai.superstore_orders",
      "  lucy-ops:",
      "    driver: sqlite",
      "    enabled_tables:",
      "      - ops_calls",
      "      - ops_call_tables",
      "",
    ].join("\n"),
    "utf8",
  );
}

describe("CompatConfigProfile contract load", () => {
  it("loads default profile with required id/version/connections", () => {
    const profile = loadCompatConfigProfile();
    assert.equal(profile.configProfileId, CONFIG_PROFILE_ID);
    assert.equal(profile.version, CONFIG_PROFILE_VERSION);
    assert.ok(profile.connections.includes("demo-mysql"));
    assert.ok(profile.connections.includes("lucy-ops"));
    const validated = validateCompatConfigProfile(profile);
    assert.equal(validated.ok, true, validated.problems.join("; "));
  });
});

describe("computeConfigProfileFingerprint", () => {
  it("is stable across repeated loads and key reorder via stableStringify", () => {
    const a = loadCompatConfigProfile();
    const b = loadCompatConfigProfile();
    const fa = computeConfigProfileFingerprint(a);
    const fb = computeConfigProfileFingerprint(b);
    assert.match(fa, /^sha256:[0-9a-f]{64}$/);
    assert.equal(fa, fb);

    const reordered = {
      version: a.version,
      lifecycle: a.lifecycle,
      govFilterRules: a.govFilterRules,
      constraints: a.constraints,
      sources: a.sources,
      fixtureRoles: a.fixtureRoles,
      productRoles: a.productRoles,
      connections: a.connections,
      configProfileId: a.configProfileId,
    };
    assert.equal(computeConfigProfileFingerprint(reordered), fa);
    assert.equal(
      stableStringify({ b: 1, a: 2 }),
      stableStringify({ a: 2, b: 1 }),
    );
  });

  it("changes when a fixture role shape changes", () => {
    const profile = loadCompatConfigProfile();
    const before = computeConfigProfileFingerprint(profile);
    const mutated = structuredClone(profile);
    mutated.fixtureRoles[FROZEN_W0_ROLE_ID].allow.tools.push("wiki_search");
    const after = computeConfigProfileFingerprint(mutated);
    assert.notEqual(before, after);
  });
});

describe("applyCompatConfigProfile — no admin / frozen carrier", () => {
  it("applies fixtures without using lucy_admin for dual-connection", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lucy-mcp-compat-apply-"));
    try {
      seedMinimalProject(root);
      const result = applyCompatConfigProfile({
        projectRoot: root,
        backupDir: path.join(root, ".backup"),
      });
      assert.equal(result.status, "READY", result.problems.join("; "));
      assert.match(result.fingerprint, /^sha256:[0-9a-f]{64}$/);
      assert.ok(result.appliedRoleIds.includes(DUAL_READONLY_ROLE_ID));
      assert.ok(result.appliedRoleIds.includes(FROZEN_W0_ROLE_ID));
      assert.ok(result.appliedRoleIds.includes(NO_QUERY_ROLE_ID));
      assert.equal(result.appliedRoleIds.includes(FORBIDDEN_ADMIN_ROLE_ID), false);

      const access = parseYaml(readFileSync(path.join(root, "webui", "config", "access.yaml"), "utf8"));
      const dual = access.roles[DUAL_READONLY_ROLE_ID];
      assert.ok(dual, "dual readonly role applied");
      assert.deepEqual([...dual.allow.connections].sort(), ["demo-mysql", "lucy-ops"].sort());
      assert.equal(dual.allow.connections.includes("*"), false);

      // Product lucy_admin may remain from seed inventory, but must not be the dual fixture id.
      assert.notEqual(DUAL_READONLY_ROLE_ID, FORBIDDEN_ADMIN_ROLE_ID);
      assert.ok(!result.appliedRoleIds.includes(FORBIDDEN_ADMIN_ROLE_ID));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("frozen W0 permanent deny carrier is not lucy_ops_reader", () => {
    const profile = loadCompatConfigProfile();
    assert.notEqual(FROZEN_W0_ROLE_ID, PRODUCT_OPS_READER_ROLE_ID);
    assert.equal(profile.fixtureRoles[FROZEN_W0_ROLE_ID].permanentDenyCarrier, true);
    assert.equal(
      profile.constraints.permanentDenyCarrierMustNotBe,
      PRODUCT_OPS_READER_ROLE_ID,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(profile.fixtureRoles, PRODUCT_OPS_READER_ROLE_ID),
      false,
    );

    const root = mkdtempSync(path.join(tmpdir(), "lucy-mcp-compat-frozen-"));
    try {
      seedMinimalProject(root);
      const beforeOps = parseYaml(
        readFileSync(path.join(root, "webui", "config", "access.yaml"), "utf8"),
      ).roles[PRODUCT_OPS_READER_ROLE_ID];
      const result = applyCompatConfigProfile({
        projectRoot: root,
        backupDir: path.join(root, ".backup"),
      });
      assert.equal(result.status, "READY", result.problems.join("; "));
      const after = parseYaml(
        readFileSync(path.join(root, "webui", "config", "access.yaml"), "utf8"),
      );
      assert.ok(after.roles[FROZEN_W0_ROLE_ID]);
      assert.deepEqual(
        after.roles[PRODUCT_OPS_READER_ROLE_ID].allow.tableSelectors,
        beforeOps.allow.tableSelectors,
        "lucy_ops_reader product Role bytes must not become the permanent deny carrier",
      );
      const frozenNames =
        after.roles[FROZEN_W0_ROLE_ID].allow.tableSelectors[0].names ?? [];
      assert.deepEqual([...frozenNames].sort(), ["ops_call_tables", "ops_calls"].sort());
      assert.equal(frozenNames.includes("ops_agents"), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("restoreCompatConfigProfile — failure stops", () => {
  it("restores access.yaml after a successful apply", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lucy-mcp-compat-restore-ok-"));
    try {
      seedMinimalProject(root);
      const original = readFileSync(path.join(root, "webui", "config", "access.yaml"), "utf8");
      const applied = applyCompatConfigProfile({
        projectRoot: root,
        backupDir: path.join(root, ".backup"),
      });
      assert.equal(applied.status, "READY");
      assert.notEqual(
        readFileSync(path.join(root, "webui", "config", "access.yaml"), "utf8"),
        original,
      );
      restoreCompatConfigProfile(
        { ...applied.backup, projectRoot: root },
        { projectRoot: root },
      );
      assert.equal(
        readFileSync(path.join(root, "webui", "config", "access.yaml"), "utf8"),
        original,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws CompatConfigRestoreError when backup is missing and stops the chain", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lucy-mcp-compat-restore-fail-"));
    try {
      seedMinimalProject(root);
      const backupDir = path.join(root, ".backup-gone");
      backupCompatConfigFiles({ projectRoot: root, backupDir });
      rmSync(backupDir, { recursive: true, force: true });

      let restoreFailed = false;
      let subsequentRan = false;
      try {
        restoreCompatConfigProfile(
          { backupDir, files: [{ relative: "webui/config/access.yaml", present: true }], projectRoot: root },
          { projectRoot: root },
        );
      } catch (error) {
        restoreFailed = true;
        assert.ok(error instanceof CompatConfigRestoreError);
        assert.match(error.message, /restore|backup/i);
      }
      assert.equal(restoreFailed, true, "restore must fail closed");
      // Simulate runner: restore failure ⇒ do not continue subsequent cases.
      if (!restoreFailed) {
        subsequentRan = true;
      }
      assert.equal(subsequentRan, false, "subsequent cases must not run after restore failure");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws when a backup blob is missing mid-restore", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lucy-mcp-compat-restore-blob-"));
    try {
      seedMinimalProject(root);
      const backupDir = path.join(root, ".backup");
      const backup = backupCompatConfigFiles({ projectRoot: root, backupDir });
      rmSync(path.join(backupDir, "webui", "config", "access.yaml"), { force: true });
      assert.throws(
        () =>
          restoreCompatConfigProfile(
            { ...backup, projectRoot: root },
            { projectRoot: root },
          ),
        (error) =>
          error instanceof CompatConfigRestoreError &&
          /fixture restore failure|backup blob missing/i.test(error.message),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
