#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";

const ROOT = path.resolve(import.meta.dirname, "..");
const QUESTION_TOOL = "lucy_begin_question";
const LUCY_DATA_TOOLS = new Set([
  "lucy_query",
  "lucy_read_source",
  "lucy_explain_query",
  "lucy_freshness"
]);
const PUBLISHED_ACCESS_TEMPLATES = [
  "webui/config/access.yaml.example",
  "examples/docker-demo/project-template/webui/config/access.yaml",
  "examples/postgres-demo/project-template/webui/config/access.yaml",
  "examples/executive-poc/project-template/webui/config/access.yaml"
];

for (const relativePath of PUBLISHED_ACCESS_TEMPLATES) {
  test(`${relativePath} exposes question reporting for every Lucy data role`, async () => {
    const config = parseYaml(await readFile(path.join(ROOT, relativePath), "utf8")) ?? {};
    const roles = config.roles ?? {};
    const knownTools = config.defaults?.known_tools ?? [];
    const tableTouchingTools = config.defaults?.table_touching_tools ?? [];

    assert.ok(knownTools.includes(QUESTION_TOOL), `${relativePath}: defaults.known_tools is missing ${QUESTION_TOOL}`);
    assert.ok(
      !tableTouchingTools.includes(QUESTION_TOOL),
      `${relativePath}: ${QUESTION_TOOL} is Meta and must not be table-touching`
    );

    for (const [roleId, role] of Object.entries(roles)) {
      const tools = Array.isArray(role?.allow?.tools) ? role.allow.tools : [];
      if (!tools.some((tool) => LUCY_DATA_TOOLS.has(tool))) continue;
      assert.ok(
        tools.includes(QUESTION_TOOL),
        `${relativePath}: data role ${roleId} is missing ${QUESTION_TOOL}`
      );
    }
  });
}
