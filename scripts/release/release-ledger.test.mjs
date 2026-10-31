import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    runs: [{ id: "1", trigger: "push to main" }],
    gates: [{ name: "spec-and-webui", status: "passed", run: "1" }],
    notes: [],
    ...overrides
  };
}

async function withRepo(options, fn) {
  const tmp = await makeRepo(options);
  try {
    return await fn(tmp);
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

  it("accepts a non-required gate recorded as failed", async () => {
    const entry = validEntry({
      gates: [
        { name: "spec-and-webui", status: "passed", run: "1" },
        { name: "demo-db-smoke", status: "failed", required: false, run: "1", reason: "known deployment-layer gap" }
      ]
    });
    await withRepo({ entries: { "v0.2.0.json": entry } }, (tmp) => {
      assert.deepEqual(collectLedgerErrors(tmp, { verifyRepo: false }), []);
    });
  });

  it("rejects a failed Required check", async () => {
    const entry = validEntry({
      gates: [{ name: "spec-and-webui", status: "failed", required: true, run: "1", reason: "red" }]
    });
    await withRepo({ entries: { "v0.2.0.json": entry } }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.some((error) => error.includes("must not carry a red Required check")));
    });
  });

  it("rejects a failed gate that states no reason", async () => {
    const entry = validEntry({
      gates: [{ name: "demo-db-smoke", status: "failed", required: false, run: "1" }]
    });
    await withRepo({ entries: { "v0.2.0.json": entry } }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.some((error) => error.includes("failed and must state a reason")));
    });
  });

  it("rejects a passed or failed gate that cites no run", async () => {
    const entry = validEntry({ gates: [{ name: "spec-and-webui", status: "passed" }] });
    await withRepo({ entries: { "v0.2.0.json": entry } }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.some((error) => error.includes("must cite the CI run id")));
    });
  });

  it("rejects an unknown gate status", async () => {
    const entry = validEntry({ gates: [{ name: "spec-and-webui", status: "skipped", run: "1" }] });
    await withRepo({ entries: { "v0.2.0.json": entry } }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.some((error) => error.includes('status must be "passed", "failed" or "notExecuted"')));
    });
  });

  it("rejects an entry that lists no runs", async () => {
    const entry = validEntry({ runs: [] });
    await withRepo({ entries: { "v0.2.0.json": entry } }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.some((error) => error.includes("runs must be a non-empty array")));
    });
  });

  it("rejects a run entry that does not say what triggered it", async () => {
    const entry = validEntry({ runs: [{ id: "1" }] });
    await withRepo({ entries: { "v0.2.0.json": entry } }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.some((error) => error.includes("is missing trigger")));
    });
  });

  it("rejects a gate that cites a run outside the release", async () => {
    const entry = validEntry({
      runs: [{ id: "1", trigger: "push to main" }],
      gates: [{ name: "spec-and-webui", status: "passed", run: "999" }]
    });
    await withRepo({ entries: { "v0.2.0.json": entry } }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.some((error) => error.includes("is not one of this release's runs")));
    });
  });

  it("accepts gates spread across the push run and the tag run", async () => {
    const entry = validEntry({
      runs: [
        { id: "1", trigger: "push to main" },
        { id: "2", trigger: "push of the release tag" }
      ],
      gates: [
        { name: "spec-and-webui", status: "passed", run: "1" },
        { name: "customer-amd64-native", status: "failed", required: false, run: "2", reason: "push denied" }
      ]
    });
    await withRepo({ entries: { "v0.2.0.json": entry } }, (tmp) => {
      assert.deepEqual(collectLedgerErrors(tmp, { verifyRepo: false }), []);
    });
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

describe("release-ledger shallow checkout", () => {
  it("reports an unverifiable commit instead of claiming it does not exist", async () => {
    // A shallow checkout cannot answer whether an older release commit is in
    // the object database. The gate must say so rather than assert either way.
    const shallow = await mkdtemp(path.join(tmpdir(), "ledger-shallow-"));
    const source = await mkdtemp(path.join(tmpdir(), "ledger-source-"));
    try {
      const { execFileSync } = await import("node:child_process");
      const git = (cwd, args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

      git(source, ["init", "--quiet"]);
      git(source, ["config", "user.email", "t@example.com"]);
      git(source, ["config", "user.name", "t"]);
      await writeFile(path.join(source, "a.txt"), "a", "utf8");
      git(source, ["add", "a.txt"]);
      git(source, ["commit", "--quiet", "-m", "first"]);
      const first = git(source, ["rev-parse", "HEAD"]).trim();
      git(source, ["tag", "v1.0.0"]);
      await writeFile(path.join(source, "a.txt"), "b", "utf8");
      git(source, ["add", "a.txt"]);
      git(source, ["commit", "--quiet", "-m", "second"]);

      execFileSync("git", ["clone", "--quiet", "--depth", "1", "--no-tags", `file://${source}`, shallow]);
      const isShallow = git(shallow, ["rev-parse", "--is-shallow-repository"]).trim();
      assert.equal(isShallow, "true", "test setup must produce a shallow checkout");

      const problems = verifyLedgerEntryAgainstRepo({
        __file: "v0.2.0.json",
        productVersion: "0.2.0",
        releaseTag: "v1.0.0",
        commit: first
      }, shallow);
      assert.ok(problems.length > 0, "a commit outside a shallow window must not pass silently");
      assert.ok(
        problems.every((problem) => !problem.includes("does not exist")),
        `must not claim the commit is absent: ${problems.join(" | ")}`
      );
      assert.ok(problems.some((problem) => problem.includes("shallow")));
    } finally {
      await rm(shallow, { recursive: true, force: true });
      await rm(source, { recursive: true, force: true });
    }
  });

  it("does not add webui-ux-review to the checked-in v0.20.0 ledger", () => {
    const ledger = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../docs/releases/v0.20.0.json"), "utf8");
    assert.equal(ledger.includes("webui-ux-review"), false);
  });

  it("accepts a manual webui-ux-review pass without a CI run", async () => {
    await withUxRepo({
      version: "0.21.0",
      productionReady: true,
      gate: { name: "webui-ux-review", status: "passed", required: true, manual: true, evidence: "docs/releases/ux/0.21.0.md" },
      ux: passedUx
    }, (tmp) => {
      assert.deepEqual(collectLedgerErrors(tmp, { verifyRepo: false }), []);
    });
  });

  it("rejects a manual pass whose evidence file is missing", async () => {
    await withUxRepo({
      version: "0.21.0",
      productionReady: true,
      gate: { name: "webui-ux-review", status: "passed", required: true, manual: true, evidence: "docs/releases/ux/0.21.0.md" },
      ux: null
    }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.some((error) => error.includes("does not exist")));
    });
  });

  it("rejects a production-ready release that omits webui-ux-review", async () => {
    await withUxRepo({ version: "0.21.0", productionReady: true, gate: null, ux: null }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.some((error) => error.includes("webui-ux-review")));
    });
  });

  it("does not require webui-ux-review on v0.20.0", async () => {
    await withUxRepo({ version: "0.20.0", productionReady: true, gate: null, ux: null }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.every((error) => !error.includes("webui-ux-review")));
    });
  });

  it("rejects passed evidence that is dirty or not structurally green", async () => {
    await withUxRepo({
      version: "0.21.0",
      productionReady: true,
      gate: { name: "webui-ux-review", status: "passed", required: true, manual: true, evidence: "docs/releases/ux/0.21.0.md" },
      ux: "result: passed\nreasonClass: none\nworkspaceDirty: true\nstructure: green\n"
    }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.some((error) => error.includes("workspaceDirty=false")));
    });
  });

  it("rejects notExecuted on a production-ready release", async () => {
    await withUxRepo({
      version: "0.21.0",
      productionReady: true,
      gate: {
        name: "webui-ux-review",
        status: "notExecuted",
        required: true,
        manual: true,
        evidence: "docs/releases/ux/0.21.0.md",
        reason: "structure-blocked"
      },
      ux: blockedUx("structure-blocked")
    }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.some((error) => error.includes("cannot be notExecuted")));
    });
  });

  it("accepts notExecuted when the walk never started and the release is not production-ready", async () => {
    await withUxRepo({
      version: "0.21.0",
      productionReady: false,
      gate: {
        name: "webui-ux-review",
        status: "notExecuted",
        manual: true,
        evidence: "docs/releases/ux/0.21.0.md",
        reason: "structure-blocked: h1 mismatch"
      },
      ux: blockedUx("structure-blocked")
    }, (tmp) => {
      assert.deepEqual(collectLedgerErrors(tmp, { verifyRepo: false }), []);
    });
  });

  it("rejects notExecuted whose reason class does not match the evidence", async () => {
    await withUxRepo({
      version: "0.21.0",
      productionReady: false,
      gate: {
        name: "webui-ux-review",
        status: "notExecuted",
        manual: true,
        evidence: "docs/releases/ux/0.21.0.md",
        reason: "walk finished"
      },
      ux: blockedUx("walk-blocked")
    }, (tmp) => {
      const errors = collectLedgerErrors(tmp, { verifyRepo: false });
      assert.ok(errors.some((error) => error.includes("must include walk-blocked")));
    });
  });
});

const passedUx = "result: passed\nreasonClass: none\nworkspaceDirty: false\nstructure: green\n";

function blockedUx(reasonClass) {
  const structure = reasonClass === "structure-blocked" ? "red" : "green";
  const dirty = reasonClass === "instance-not-ready" ? "true" : "false";
  return `result: blocked\nreasonClass: ${reasonClass}\nworkspaceDirty: ${dirty}\nstructure: ${structure}\n`;
}

async function withUxRepo({ version, productionReady, gate, ux }, fn) {
  const deliveryPackage = {
    name: "pkg",
    sha256: "c".repeat(64),
    builtFromCommit: SHA_A,
    productionReady
  };
  const gates = [{ name: "spec-and-webui", status: "passed", run: "1" }];
  if (gate) gates.push(gate);
  await withRepo({
    version,
    entries: {
      [`v${version}.json`]: validEntry({
        productVersion: version,
        releaseTag: `v${version}`,
        deliveryPackage,
        noDeliveryReason: undefined,
        gates
      })
    }
  }, async (tmp) => {
    if (ux) {
      await mkdir(path.join(tmp, "docs/releases/ux"), { recursive: true });
      await writeFile(path.join(tmp, "docs/releases/ux", `${version}.md`), ux, "utf8");
    }
    return fn(tmp);
  });
}
