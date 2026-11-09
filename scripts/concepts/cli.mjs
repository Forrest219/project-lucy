#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { resolveContentRoot, conceptsDir } from "./content-root.mjs";
import {
  listConceptIds,
  readConcept,
  setCanonical,
  rejectBinding,
  ensureConceptsDir,
  defaultWhitelistPath,
} from "./store.mjs";
import { runScan, summarizeConcept, assetExists, readAssetFields } from "./scan.mjs";
import { currentlyMatches, deriveConflicts, assertAuthorityInvariant } from "./model.mjs";

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args.flags[key] = next;
        i += 1;
      } else {
        args.flags[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function printYaml(obj) {
  process.stdout.write(stringifyYaml(obj));
}

function usage() {
  return `Usage: concepts <command> [options]

NOTE: 客户／运维主交付面是 Lucy Ops MCP（lucy_ops_concept_*）。
本 CLI 仅为共享库调试与急救通道（P1-11 D1／SC-14），不作为长期交付入口。

Commands:
  scan [--project DIR] [--content-root DIR] [--whitelist FILE]
  list [--project DIR] [--content-root DIR] [--json]
  show <conceptId> [--project DIR] [--content-root DIR] [--json]
  set-canonical <conceptId> <bindingId> [--project DIR] [--content-root DIR]
  reject <conceptId> <bindingId> [--project DIR] [--content-root DIR]
  summary [--project DIR] [--content-root DIR] [--json]

Root resolution: --project > KTX_PROJECT_ROOT|LUCY_PROJECT_ROOT > walk-up ktx.yaml
Content root: --content-root > LUCY_CONTENT_ROOT > ktx paths.content_root > <project>/config
`;
}

function resolveRoots(flags) {
  return resolveContentRoot({
    contentRootFlag: flags["content-root"],
    projectFlag: flags.project,
  });
}

function enrichConcept(concept, contentRoot) {
  const aliases = concept.aliases || [];
  const bindings = (concept.bindings || []).map((b) => {
    const status = assetExists(contentRoot, b);
    const match = currentlyMatches(b, aliases, (binding) => readAssetFields(contentRoot, binding));
    return { ...b, asset_status: status, currently_matches: match };
  });
  const { conflicts, conflicts_status } = deriveConflicts(
    { ...concept, bindings },
    {
      assetStatus: (b) => assetExists(contentRoot, b),
      rematch: (b, als) => currentlyMatches(b, als, (binding) => readAssetFields(contentRoot, binding)),
    },
  );
  return { ...concept, bindings, conflicts, conflicts_status };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(usage());
    process.exit(0);
  }
  const args = parseArgs(argv);
  const [cmd, ...rest] = args._;

  try {
    if (cmd === "scan") {
      const { contentRoot } = resolveRoots(args.flags);
      const whitelist = args.flags.whitelist || defaultWhitelistPath();
      const result = runScan({ contentRoot, whitelistPath: whitelist });
      printJson({ ok: true, contentRoot, ...result.stats });
      return;
    }

    if (cmd === "list") {
      const { contentRoot } = resolveRoots(args.flags);
      const dir = ensureConceptsDir(contentRoot);
      let rows = [];
      for (const id of listConceptIds(dir)) {
        const concept = readConcept(dir, id);
        if (!concept) continue;
        rows.push(summarizeConcept(concept, contentRoot));
      }
      if (args.flags["conflicts-only"]) {
        rows = rows.filter((r) => (r.conflicts || []).length > 0 || r.conflicts_status === "degraded");
      }
      if (args.flags.json) printJson(rows);
      else {
        for (const r of rows) {
          const cflag = r.conflicts?.length ? ` conflicts=${r.conflicts.length}` : "";
          const deg = r.conflicts_status === "degraded" ? " [degraded]" : "";
          process.stdout.write(
            `${r.id}\tcanonical=${r.canonical || "-"}\tcandidates=${r.candidates}\trejected=${r.rejected}${cflag}${deg}\n`,
          );
        }
      }
      return;
    }

    if (cmd === "show") {
      const conceptId = rest[0];
      if (!conceptId) throw new Error("show requires <conceptId>");
      const { contentRoot } = resolveRoots(args.flags);
      const dir = conceptsDir(contentRoot);
      const concept = readConcept(dir, conceptId);
      if (!concept) throw new Error(`concept not found: ${conceptId}`);
      const enriched = enrichConcept(concept, contentRoot);
      if (args.flags.json) printJson(enriched);
      else printYaml(enriched);
      return;
    }

    if (cmd === "set-canonical") {
      const [conceptId, bindingId] = rest;
      if (!conceptId || !bindingId) throw new Error("set-canonical requires <conceptId> <bindingId>");
      const summary = args.flags.summary;
      if (!summary || summary === true) throw new Error("set-canonical requires --summary <text>");
      const { contentRoot } = resolveRoots(args.flags);
      const dir = conceptsDir(contentRoot);
      const next = setCanonical(dir, conceptId, bindingId, summary);
      assertAuthorityInvariant(next);
      printJson({ ok: true, id: next.id, canonical: next.canonical, summary: next.summary });
      return;
    }

    if (cmd === "reject") {
      const [conceptId, bindingId] = rest;
      if (!conceptId || !bindingId) throw new Error("reject requires <conceptId> <bindingId>");
      const { contentRoot } = resolveRoots(args.flags);
      const dir = conceptsDir(contentRoot);
      const next = rejectBinding(dir, conceptId, bindingId);
      printJson({ ok: true, id: next.id, rejected: bindingId, canonical: next.canonical });
      return;
    }

    if (cmd === "summary") {
      const { contentRoot } = resolveRoots(args.flags);
      const dir = ensureConceptsDir(contentRoot);
      const rows = listConceptIds(dir).map((id) => summarizeConcept(readConcept(dir, id), contentRoot));
      const totals = {
        concepts: rows.length,
        with_canonical: rows.filter((r) => r.canonical).length,
        with_conflicts: rows.filter((r) => r.conflicts?.length).length,
        degraded: rows.filter((r) => r.conflicts_status === "degraded").length,
        stale_bindings: rows.reduce((n, r) => n + (r.stale || 0), 0),
      };
      if (args.flags.json) printJson({ totals, concepts: rows });
      else printJson(totals);
      return;
    }

    throw new Error(`unknown command: ${cmd}\n${usage()}`);
  } catch (err) {
    process.stderr.write(`error: ${err.message || err}\n`);
    process.exit(1);
  }
}

main();
