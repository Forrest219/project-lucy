import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { collectLedgerErrors, verifyLedgerEntryAgainstRepo } from "./release-ledger.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

async function makeRepo({ version = "0.2.0", entries = {} } = {}) {
  const tmp = await mkdtemp(path.join(tmpdir(), "release-ledger-test-"));
  await mkdir(path.join(tmp, "docs/releases"), { recursive: true });
  await writeFile(path.join(tmp, "VERSION"), `${version}\n`, "utf8");
  for (const [name, body] of Object.entries(entries)) {
    await writeFile(path.join(tmp, "docs/releases", name), JSON.stringify(body, null, 2), "utf8");
  }
  return tmp;
}

function validEntry(overrides = {}) {
  return {
    productVersion: "0.2.0",
    releaseTag: "v0.2.0",
    commit: SHA_A,
    releasedAt: "2026-10-24",
    deliveryPackage: null,
    noDeliveryReason: "no customer package for this version",
    gates: [{ name: "spec-and-webui", status: "passed", run: "1" }],
    notes: [],
    ...overrides
  };
}

async function withRepo(options, fn) {
  const tmp = await makeRepo(options);
  try {
    return fn(tmp);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

describe("release-ledger gate", () => {
  it("accepts a ledger whose current VERSION has an entry", async () => {
    await withRepo({ entries: { "v0.2.0.json": validEntry() } }, (tmp) => {
      assert.deepEqual(collectLedgerErrors(tmp, { verifyRepo: false }), []);
    });
  });

  it("rejects a VERSION with no ledger entry", async () => {
    await withRepo({ version: "9.9.9", entries: { "v0.2.0.json": validEntry() } }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.some((error) => error.includes("VERSION=9.9.9 has no ledger entry")));
    });
  });

  it("rejects an entry whose releaseTag does not match its productVersion", async () => {
    await withRepo(
      { entries: { "v0.2.0.json": validEntry({ releaseTag: "v0.3.0" }) } },
      (tmp) => {
        const errors = collectLedgerErrors(tmp, { verifyRepo: false });
        assert.ok(errors.some((error) => error.includes("does not match productVersion")));
      }
    );
  });

  it("rejects an entry with a malformed commit", async () => {
    await withRepo({ entries: { "v0.2.0.json": validEntry({ commit: "not-a-sha" }) } }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.some((error) => error.includes("must be a full 40-hex sha")));
    });
  });

  it("accepts PENDING as the commit before the release commit exists", async () => {
    await withRepo({ entries: { "v0.2.0.json": validEntry({ commit: "PENDING" }) } }, (tmp) => {
      assert.deepEqual(collectLedgerErrors(tmp, { verifyRepo: false }), []);
    });
  });

  it("requires a reason when a version has no delivery package", async () => {
    const entry = validEntry();
    delete entry.noDeliveryReason;
    await withRepo({ entries: { "v0.2.0.json": entry } }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.some((error) => error.includes("noDeliveryReason is missing")));
    });
  });

  it("rejects a gate that was not executed without a reason", async () => {
    await withRepo(
      { entries: { "v0.2.0.json": validEntry({ gates: [{ name: "real-e2e", status: "notExecuted" }] }) } },
      (tmp) => {
        const errors = collectLedgerErrors(tmp, { verifyRepo: false });
        assert.ok(errors.some((error) => error.includes("must state a reason")));
      }
    );
  });

  it("rejects a delivery package built from a different commit unless that is declared", async () => {
    const entry = validEntry({
      deliveryPackage: {
        name: "pkg.tar.gz",
        sha256: "0".repeat(64),
        builtFromCommit: SHA_B
      }
    });
    await withRepo({ entries: { "v0.2.0.json": entry } }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.some((error) => error.includes("builtFromDiffersFromReleaseCommit")));
    });
  });

  it("accepts a declared package-commit mismatch", async () => {
    const entry = validEntry({
      deliveryPackage: {
        name: "pkg.tar.gz",
        sha256: "0".repeat(64),
        builtFromCommit: SHA_B,
        builtFromDiffersFromReleaseCommit: true,
        builtFromDiffNote: "known historical divergence"
      }
    });
    await withRepo({ entries: { "v0.2.0.json": entry } }, (tmp) => {
      assert.deepEqual(collectLedgerErrors(tmp, { verifyRepo: false }), []);
    });
  });

  it("rejects two entries claiming the same product version", async () => {
    await withRepo(
      {
        entries: {
          "v0.2.0.json": validEntry(),
          "copy.json": validEntry()
        }
      },
      (tmp) => {
        const errors = collectLedgerErrors(tmp, { verifyRepo: false });
        assert.ok(errors.some((error) => error.includes("is already recorded by")));
      }
    );
  });

  it("rejects a missing required field", async () => {
    const entry = validEntry();
    delete entry.releasedAt;
    await withRepo({ entries: { "v0.2.0.json": entry } }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.some((error) => error.includes('missing required field "releasedAt"')));
    });
  });
});

describe("release-ledger repository cross-check", () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

  it("accepts a ledger entry whose tag points at the recorded commit", () => {
    const problems = verifyLedgerEntryAgainstRepo({
      __file: "v0.2.0.json",
      productVersion: "0.2.0",
      releaseTag: "v2.0.0",
      commit: "14a8bee16c55b5d9885c8ab4c3464614503735dc"
    }, ROOT);
    assert.deepEqual(problems, []);
  });

  it("rejects a ledger entry whose tag points at a different commit", () => {
    const problems = verifyLedgerEntryAgainstRepo({
      __file: "v0.2.0.json",
      productVersion: "0.2.0",
      releaseTag: "v2.0.0",
      commit: "da5da05d382edb7ec5129c2043c6f53ac360eefd"
    }, ROOT);
    assert.ok(problems.some((problem) => problem.includes("points at 14a8bee")));
  });

  it("rejects a commit that does not exist in the repository", () => {
    const problems = verifyLedgerEntryAgainstRepo({
      __file: "v0.2.0.json",
      productVersion: "0.2.0",
      releaseTag: "v0.2.0",
      commit: "f".repeat(40)
    }, ROOT);
    assert.ok(problems.some((problem) => problem.includes("does not exist in this repository")));
  });

  it("skips the commit check while the commit is still PENDING", () => {
    const problems = verifyLedgerEntryAgainstRepo({
      __file: "v0.2.0.json",
      productVersion: "0.2.0",
      releaseTag: "v0.2.0",
      commit: "PENDING"
    }, ROOT);
    assert.deepEqual(problems, []);
  });
});
