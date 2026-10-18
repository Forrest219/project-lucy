// Glue used by archive-evidence: assemble the evidence of a run directory and verify it with the one verifier.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expectedExecutions } from "./catalog.mjs";
import { automatedRequiredClients } from "./clients.mjs";
import { assembleEvidence, loadResults } from "./assemble.mjs";
import { loadRun } from "./common.mjs";
import { fileReaderFor, loadVerifyInputs, verifyRelease } from "../verify-evidence.mjs";

// `archiveDir` is the archived copy (the contents of <runDir>/results plus run.json) and the verdict is
// computed on the ARCHIVED bytes, not the source dir. The archive must be self-describing.
export function verifyEvidenceDir({ archiveDir, candidatePath }) {
  const auditFile = path.join(archiveDir, "npm-audit.json");
  const audit = existsSync(auditFile) ? JSON.parse(readFileSync(auditFile, "utf8")) : null;
  // archiveDir contains results/<file> and run.json. Treat it as the runDir.
  const run = loadRun(path.join(archiveDir, "run.json"));
  // loadResults expects run.paths.runDir to point at the directory containing results/. Rebase it to archiveDir
  // so the archive (not the source) is what gets assembled.
  run.paths = { ...(run.paths ?? {}), runDir: archiveDir, resultsDir: path.join(archiveDir, "results") };
  const inputs = loadVerifyInputs();
  const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
  const { evidence } = assembleEvidence({
    run,
    results: loadResults(run),
    candidate,
    profileDigest: inputs.profileDigest,
    cases: inputs.cases,
    expectedCount: expectedExecutions(inputs.cases, automatedRequiredClients(inputs.clientsDoc.clients).map((c) => c.product)).length,
    clientsDoc: inputs.clientsDoc
  });
  return verifyRelease({ evidence, candidate, ...inputs, audit, readFile: fileReaderFor(archiveDir), runId: run.runId, instanceId: run.instanceId });
}
