#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parse } from "yaml";

const VERSION_RE = /^v\d+\.\d+(?:\.\d+)?$/;

function optionValue(name, fallback) {
  const argv = process.argv.slice(2);
  const flag = `--${name}`;
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? fallback : fallback;
}

const root = path.resolve(optionValue("root", process.cwd()));
const out = optionValue("out", "inbox/p1-skills-evidence.json");

function rel(file) {
  return path.join(root, file);
}

function walk(dir, predicate, outFiles = []) {
  const abs = rel(dir);
  if (!existsSync(abs)) return outFiles;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(child, predicate, outFiles);
    else if (predicate(child)) outFiles.push(child.replaceAll(path.sep, "/"));
  }
  return outFiles;
}

function read(file) {
  return readFileSync(rel(file), "utf8");
}

function parseFrontmatter(text, file, blockers, check) {
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 4);
  if (end < 0) {
    blockers.push({ check, file, reason: "reference frontmatter YAML is not parseable" });
    return {};
  }
  try {
    return parse(text.slice(4, end)) ?? {};
  } catch (error) {
    blockers.push({
      check,
      file,
      reason: "reference frontmatter YAML is not parseable",
      detail: error instanceof Error ? error.message : String(error)
    });
    return {};
  }
}

function collectEvalCases(file) {
  const doc = parse(read(file)) ?? {};
  return Array.isArray(doc.cases) ? doc.cases : [];
}

async function main() {
  const blockers = [];
  const warnings = [];
  const details = { skillFiles: [], referenceFiles: [], evalFiles: [], runtimeInstructions: {} };

  const skillFiles = walk("skills", (file) => file.endsWith("/SKILL.md"));
  if (skillFiles.length === 0) blockers.push({ check: "skill-files", reason: "no SKILL.md files found" });

  for (const file of skillFiles) {
    const meta = parseFrontmatter(read(file), file, blockers, "skill-files");
    details.skillFiles.push({ file, name: meta.name, version: meta.version });
    if (typeof meta.name !== "string" || !meta.name.trim()) blockers.push({ check: "skill-files", file, reason: "missing name" });
    if (typeof meta.version !== "string" || !VERSION_RE.test(meta.version)) blockers.push({ check: "skill-files", file, reason: "missing or invalid version" });
    if (!Array.isArray(meta.publish_targets) || meta.publish_targets.length === 0) blockers.push({ check: "skill-files", file, reason: "missing publish_targets" });
    if (!Array.isArray(meta.eval_coverage) || meta.eval_coverage.length === 0) warnings.push({ check: "skill-files", file, reason: "eval_coverage is empty" });
    const deps = Array.isArray(meta.dependencies) ? meta.dependencies : [];
    if (deps.length === 0) blockers.push({ check: "skill-files", file, reason: "dependencies is empty" });
    for (const dep of deps) {
      const depPath = path.resolve(path.dirname(rel(file)), dep);
      if (!depPath.startsWith(path.join(root, "skills") + path.sep)) {
        blockers.push({ check: "skill-files", file, dependency: dep, reason: "dependency escapes skills directory" });
      } else if (!existsSync(depPath)) {
        blockers.push({ check: "skill-files", file, dependency: dep, reason: "dependency file not found" });
      }
    }
  }

  const referenceFiles = walk("skills", (file) => file.endsWith(".md") && !file.endsWith("/SKILL.md"));
  for (const file of referenceFiles) {
    details.referenceFiles.push(file);
    parseFrontmatter(read(file), file, blockers, "skill-references");
  }

  const runtimePath = "webui/config/data-qa-instructions.md";
  const runtime = existsSync(rel(runtimePath)) ? read(runtimePath) : "";
  const mentionsSkillBoundary = /Skill|skills\/\*\*\/SKILL\.md|不自动加载/.test(runtime);
  details.runtimeInstructions = { file: runtimePath, mentionsSkillBoundary };
  if (!mentionsSkillBoundary) {
    blockers.push({ check: "runtime-instructions", file: runtimePath, reason: "fallback instructions do not document the Skill runtime boundary" });
  }

  const evalFiles = walk("evals", (file) => file.endsWith("-eval-cases.yaml"));
  for (const file of evalFiles) {
    const cases = collectEvalCases(file);
    const missing = cases
      .filter((item) => typeof item?.skill_version !== "string" || !VERSION_RE.test(item.skill_version))
      .map((item) => item?.id ?? "<missing-id>");
    details.evalFiles.push({ file, cases: cases.length, missingSkillVersion: missing });
    if (missing.length > 0) blockers.push({ check: "eval-skill-version", file, reason: "one or more eval cases are missing skill_version", caseIds: missing });
  }

  const evidence = {
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/p1-skills-smoke.mjs",
    status: blockers.length === 0 ? "pass" : "fail",
    ok: blockers.length === 0,
    summary: {
      skillFiles: skillFiles.length,
      referenceFiles: referenceFiles.length,
      evalFiles: evalFiles.length,
      blockers: blockers.length,
      warnings: warnings.length
    },
    blockers,
    warnings,
    details
  };
  const outPath = path.isAbsolute(out) ? out : rel(out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`[p1-skills-smoke] wrote ${path.relative(root, outPath)}`);
  console.log(`[p1-skills-smoke] ${evidence.status.toUpperCase()} ${JSON.stringify(evidence.summary)}`);
  process.exit(evidence.ok ? 0 : 1);
}

await main();
