import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canAccessSkill } from "../proxy/skill-acl.js";
import { invalidateAccessConfigCache, type Identity } from "../proxy/identity.js";
import type { SkillAsset } from "../skills/types.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TOKEN = "skill-147-token";
function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

describe("Spec 147 static gates", () => {
  it("SC-147-01 sync-demo-skills-template copies answer-style and keeps dockerignore/Dockerfile", async () => {
    const result = spawnSync("bash", [path.join(REPO_ROOT, "scripts/demo/sync-demo-skills-template.sh")], {
      cwd: REPO_ROOT,
      encoding: "utf8"
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const text = await readFile(
      path.join(REPO_ROOT, "examples/docker-demo/project-template/skills/answer-style/SKILL.md"),
      "utf8"
    );
    expect(text).toContain("name: answer-style");
    const dockerignore = await readFile(path.join(REPO_ROOT, ".dockerignore"), "utf8");
    expect(dockerignore).toMatch(/^skills\/$/m);
    const dockerfile = await readFile(path.join(REPO_ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("touch /app/project-template/skills/.gitkeep");
  });

  describe("SC-147-05 status reasons", () => {
    let projectRoot: string;
    let previousRoot: string | undefined;
    const identity: Identity = {
      userId: "acl_147_user",
      tokenLabel: "t",
      tokenHashPrefix: tokenHash(TOKEN).slice(0, 16)
    };
    const base: SkillAsset = {
      name: "s",
      title: "S",
      version: "1.0.0",
      domain: "d",
      status: "published",
      roles_allowed: ["*"],
      prerequisites: {},
      triggers: [],
      eval_cases: [],
      description: "d",
      uri: "lucy-skill://d/s",
      relativePath: "skills/d/s.md",
      filePath: "/tmp/s.md",
      content: "",
      raw: ""
    };

    beforeEach(async () => {
      previousRoot = process.env.KTX_PROJECT_ROOT;
      projectRoot = await mkdtemp(path.join(os.tmpdir(), "skill-147-acl-"));
      process.env.KTX_PROJECT_ROOT = projectRoot;
      await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
      await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n");
      await writeFile(
        path.join(projectRoot, "webui", "config", "access.yaml"),
        `users:
  - id: acl_147_user
    name: U
    enabled: true
    roles: [analyst_role]
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: t
        created: 2026-09-24
roles:
  analyst_role:
    allow:
      tools: [lucy_skill_read]
`
      );
      invalidateAccessConfigCache();
    });

    afterEach(async () => {
      if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
      else process.env.KTX_PROJECT_ROOT = previousRoot;
      invalidateAccessConfigCache();
      await rm(projectRoot, { recursive: true, force: true });
    });

    it("maps draft/deprecated/published", async () => {
      expect((await canAccessSkill(identity, { ...base, status: "published" })).allowed).toBe(true);
      expect((await canAccessSkill(identity, { ...base, status: "draft" })).reason).toBe("skill_not_published");
      expect((await canAccessSkill(identity, { ...base, status: "deprecated" })).reason).toBe(
        "skill_deprecated"
      );
    });
  });

  it("SC-147-07 demo template lists skill tools once; patch is idempotent", async () => {
    const template = await readFile(
      path.join(REPO_ROOT, "examples/docker-demo/project-template/webui/config/access.yaml"),
      "utf8"
    );
    expect(template.match(/lucy_skill_read/g)?.length).toBe(1);
    expect(template.match(/lucy_skill_search/g)?.length).toBe(1);

    const tmp = await mkdtemp(path.join(os.tmpdir(), "skill-patch-"));
    const accessPath = path.join(tmp, "access.yaml");
    await writeFile(
      accessPath,
      `roles:
  demo_readonly:
    allow:
      tools:
        - lucy_catalog
        - connection_list
`
    );
    const patch = () =>
      spawnSync(
        "node",
        [
          "-e",
          `const fs=require("fs");const path=${JSON.stringify(accessPath)};let text=fs.readFileSync(path,"utf8");const tools=["lucy_skill_read","lucy_skill_search"];const roleMarker=/^(\\s*)demo_readonly:\\s*$/m;const match=roleMarker.exec(text);if(!match)process.exit(0);const roleIndent=match[1]??"";const roleStart=match.index;const afterRole=text.slice(roleStart+match[0].length);const nextRole=afterRole.search(new RegExp("^"+roleIndent+"\\\\S","m"));const roleBlockEnd=nextRole===-1?text.length:roleStart+match[0].length+nextRole;let roleBlock=text.slice(roleStart,roleBlockEnd);const toolsMatch=roleBlock.match(/^(\\s*)tools:\\s*$/m);if(!toolsMatch)process.exit(0);const listIndent=toolsMatch[1]+"  ";let inserted=0;for(const tool of tools){if(roleBlock.includes("- "+tool))continue;roleBlock=roleBlock.replace(/^(\\s*tools:\\s*\\n)/m,"$1"+listIndent+"- "+tool+"\\n");inserted++;}if(!inserted)process.exit(0);fs.writeFileSync(path,text.slice(0,roleStart)+roleBlock+text.slice(roleBlockEnd));`
        ],
        { encoding: "utf8" }
      );
    expect(patch().status).toBe(0);
    expect(patch().status).toBe(0);
    const patched = await readFile(accessPath, "utf8");
    expect(patched.match(/lucy_skill_read/g)?.length).toBe(1);
    expect(patched.match(/lucy_skill_search/g)?.length).toBe(1);
    await rm(tmp, { recursive: true, force: true });
  });
});
