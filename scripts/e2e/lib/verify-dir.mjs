// Glue used by archive-evidence: assemble the evidence of a run directory and verify it with the one verifier.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expectedExecutions } from "./catalog.mjs";
import { assembleEvidence, loadResults } from "./assemble.mjs";
import { loadRun } from "./common.mjs";
import { fileReaderFor, loadVerifyInputs, verifyRelease } from "../verify-evidence.mjs";

// `dir` is the archived copy of <runDir>/results; the verdict is computed on the run it was copied from.
export function verifyEvidenceDir({ runDir, candidatePath }) {
  const auditFile = path.join(runDir, "results", "npm-audit.json");
  const audit = existsSync(auditFile) ? JSON.parse(readFileSync(auditFile, "utf8")) : null;
  const run = loadRun(path.join(runDir, "run.json"));
  const inputs = loadVerifyInputs();
  const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
  const { evidence } = assembleEvidence({
    run,
    results: loadResults(run),
    candidate,
    profileDigest: inputs.profileDigest,
    cases: inputs.cases,
    expectedCount: expectedExecutions(inputs.cases, inputs.clientsDoc.clients.filter((c) => c.required).map((c) => c.product)).length
  });
  return verifyRelease({ evidence, candidate, ...inputs, audit, readFile: fileReaderFor(runDir) });
}
