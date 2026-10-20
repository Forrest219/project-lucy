#!/usr/bin/env node
// Paint the E2E evidence board and the Business Eval capability board from one run.
//
//   node scripts/e2e/project-checklists.mjs --run inbox/e2e/<runId>/run.json [--eval <evidence.json>]
//
// Writes <runDir>/checklist-projection.json. Does not edit the checklist YAML and does not
// change gate:customer-release. Exit 0 means the projection was written; row colors are inside the file.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { readJson, fail, loadRun, parseArgv } from "./lib/common.mjs";
import { loadCatalog, REPO_ROOT } from "./lib/catalog.mjs";
import { evidenceFromRun, loadChecklistDocs, projectChecklists } from "./lib/project-checklists.mjs";

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = parseArgv(process.argv.slice(2), { run: "value", eval: "value" });
    if (!args.run) fail("project-checklists: --run <run.json> is required", 2);
    const run = loadRun(args.run);
    const { cases } = loadCatalog();
    const clientsDoc = parse(readFileSync(path.join(REPO_ROOT, "docs/qa/real-e2e-clients.yaml"), "utf8"));
    const { e2e, business } = loadChecklistDocs();
    const evalDoc = args.eval ? readJson(path.resolve(args.eval)) : null;
    const loaded = evidenceFromRun(run, { evalDoc, clientsDoc });
    const projection = projectChecklists({
      e2eDoc: e2e,
      businessDoc: business,
      cases,
      ...loaded
    });
    projection.runId = run.runId;
    const out = path.join(run.paths.runDir, "checklist-projection.json");
    writeFileSync(out, `${JSON.stringify(projection, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ out, summary: projection.summary })}\n`);
  } catch (error) {
    fail(`project-checklists: ${error instanceof Error ? error.message : String(error)}`, 2);
  }
}
