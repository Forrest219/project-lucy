#!/usr/bin/env node
/**
 * Release ledger gate.
 *
 * The ledger is the durable, machine-readable answer to "which commit is this
 * release, and what was actually verified for it?". It exists because a
 * release tag alone is not a record: a tag says intent, while the ledger says
 * what was built, from which commit, with which digests, under which gates.
 *
 * This gate keeps the ledger honest:
 *   - every released product version must have exactly one ledger entry
 *   - the current VERSION must have an entry
 *   - the ledger entry for the current VERSION must agree with VERSION
 *   - every entry must carry the fields that make it traceable
 *
 * A ledger entry may legitimately have no customer delivery package (a
 * version-number correction, for example). That is recorded as an explicit
 * `deliveryPackage: null` plus a reason — never as a missing field.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LEDGER_DIR = path.join(ROOT, "docs/releases");
const VERSION_PATH = path.join(ROOT, "VERSION");

const REQUIRED_FIELDS = [
  "productVersion",
  "releaseTag",
  "commit",
  "releasedAt",
  "deliveryPackage",
  "gates",
  "notes"
];

const PRODUCT_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const TAG_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${path.relative(ROOT, file)} is not valid JSON: ${error.message}`);
  }
}

export function collectLedgerErrors(root = ROOT) {
  const errors = [];
  const ledgerDir = path.join(root, "docs/releases");
  const versionFile = path.join(root, "VERSION");

  if (!existsSync(ledgerDir)) {
    return [`docs/releases/ ledger directory is missing`];
  }
  if (!existsSync(versionFile)) {
    return ["VERSION file is missing"];
  }

  const currentVersion = readFileSync(versionFile, "utf8").trim();
  if (!PRODUCT_VERSION_RE.test(currentVersion)) {
    errors.push(`VERSION=${JSON.stringify(currentVersion)} is not a numeric X.Y.Z value`);
  }

  const entryFiles = readdirSync(ledgerDir).filter((name) => name.endsWith(".json")).sort();
  if (entryFiles.length === 0) {
    errors.push("docs/releases/ contains no ledger entries");
    return errors;
  }

  const seenVersions = new Map();

  for (const name of entryFiles) {
    const file = path.join(ledgerDir, name);
    let entry;
    try {
      entry = readJson(file);
    } catch (error) {
      errors.push(error.message);
      continue;
    }

    const where = `docs/releases/${name}`;

    for (const field of REQUIRED_FIELDS) {
      if (!(field in entry)) {
        errors.push(`${where}: missing required field ${JSON.stringify(field)}`);
      }
    }

    const productVersion = entry.productVersion;
    if (typeof productVersion !== "string" || !PRODUCT_VERSION_RE.test(productVersion)) {
      errors.push(`${where}: productVersion ${JSON.stringify(productVersion)} is not a numeric X.Y.Z value`);
    }

    if (typeof entry.releaseTag === "string") {
      if (!TAG_RE.test(entry.releaseTag)) {
        errors.push(`${where}: releaseTag ${JSON.stringify(entry.releaseTag)} must look like vX.Y.Z`);
      } else if (productVersion && entry.releaseTag !== `v${productVersion}`) {
        errors.push(`${where}: releaseTag ${JSON.stringify(entry.releaseTag)} does not match productVersion ${JSON.stringify(productVersion)}`);
      }
    }

    if (typeof entry.commit === "string" && entry.commit !== "PENDING") {
      if (!SHA_RE.test(entry.commit)) {
        errors.push(`${where}: commit ${JSON.stringify(entry.commit)} must be a full 40-hex sha (or the literal "PENDING" before the release commit exists)`);
      }
    } else if (entry.commit !== "PENDING") {
      errors.push(`${where}: commit must be a full 40-hex sha or the literal "PENDING"`);
    }

    if (typeof entry.releasedAt === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(entry.releasedAt)) {
      errors.push(`${where}: releasedAt ${JSON.stringify(entry.releasedAt)} must be YYYY-MM-DD`);
    }

    // A release with no customer package must say so explicitly, with a reason.
    if (entry.deliveryPackage === null) {
      if (typeof entry.noDeliveryReason !== "string" || entry.noDeliveryReason.trim() === "") {
        errors.push(`${where}: deliveryPackage is null but noDeliveryReason is missing`);
      }
    } else if (typeof entry.deliveryPackage === "object") {
      for (const field of ["name", "sha256", "builtFromCommit"]) {
        if (!entry.deliveryPackage[field]) {
          errors.push(`${where}: deliveryPackage.${field} is missing`);
        }
      }
      if (
        typeof entry.deliveryPackage.builtFromCommit === "string"
        && typeof entry.commit === "string"
        && entry.commit !== "PENDING"
        && entry.deliveryPackage.builtFromCommit !== entry.commit
        && entry.deliveryPackage.builtFromDiffersFromReleaseCommit !== true
      ) {
        errors.push(
          `${where}: deliveryPackage.builtFromCommit ${entry.deliveryPackage.builtFromCommit} `
            + `differs from the release commit ${entry.commit}. Either the package really does not match `
            + `the release, or this is a recorded historical fact — in which case set `
            + `deliveryPackage.builtFromDiffersFromReleaseCommit to true and explain it in builtFromDiffNote.`
        );
      }
    }

    if (!Array.isArray(entry.gates)) {
      errors.push(`${where}: gates must be an array`);
    } else {
      for (const [index, gate] of entry.gates.entries()) {
        if (!gate || typeof gate !== "object") {
          errors.push(`${where}: gates[${index}] must be an object`);
          continue;
        }
        if (!gate.name) {
          errors.push(`${where}: gates[${index}] is missing name`);
        }
        if (gate.status !== "passed" && gate.status !== "notExecuted") {
          errors.push(`${where}: gates[${index}] (${gate.name ?? index}) status must be "passed" or "notExecuted"`);
        }
        if (gate.status === "notExecuted" && !(gate.reason && String(gate.reason).trim())) {
          errors.push(`${where}: gates[${index}] (${gate.name ?? index}) is notExecuted and must state a reason`);
        }
      }
    }
    if (typeof productVersion === "string") {
      if (seenVersions.has(productVersion)) {
        errors.push(`${where}: productVersion ${productVersion} is already recorded by docs/releases/${seenVersions.get(productVersion)}`);
      } else {
        seenVersions.set(productVersion, name);
      }
    }
  }

  if (!seenVersions.has(currentVersion)) {
    errors.push(
      `VERSION=${currentVersion} has no ledger entry under docs/releases/. `
        + `Every released product version must have one, or the release cannot be traced back to its commit.`
    );
  }

  return errors;
}

export function assertReleaseLedger(root = ROOT) {
  const errors = collectLedgerErrors(root);
  if (errors.length > 0) {
    throw new Error(errors.map((error) => `- ${error}`).join("\n"));
  }
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertReleaseLedger();
    console.log("[release-ledger] OK every released product version has a traceable entry");
  } catch (error) {
    console.error("[release-ledger] FAIL");
    console.error(error.message);
    process.exitCode = 1;
  }
}
