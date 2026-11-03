import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectUnresolvedAgentRoles } from "../access-role-precheck";

describe("access role precheck", () => {
  let projectRoot = "";
  const previousOverride = process.env.LUCY_ACCESS_CONFIG_PATH;

  afterEach(async () => {
    if (previousOverride === undefined) delete process.env.LUCY_ACCESS_CONFIG_PATH;
    else process.env.LUCY_ACCESS_CONFIG_PATH = previousOverride;
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
  });

  it("reports a missing role id and does not treat role: admin as lucy_admin", async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-role-precheck-"));
    delete process.env.LUCY_ACCESS_CONFIG_PATH;
    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      `roles:
  lucy_admin:
    allow: {}
users:
  - id: old_admin
    role: admin
  - id: current
    roles:
      - lucy_admin
`,
      "utf8"
    );

    const report = await inspectUnresolvedAgentRoles(projectRoot);
    expect(report.skipped).toBe(false);
    if (report.skipped) return;
    expect(report.findings).toEqual([
      { userId: "old_admin", declared: ["admin"], missing: ["admin"] }
    ]);
  });

  it("skips when access.yaml is absent", async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-role-precheck-"));
    delete process.env.LUCY_ACCESS_CONFIG_PATH;
    const report = await inspectUnresolvedAgentRoles(projectRoot);
    expect(report.skipped).toBe(true);
  });
});