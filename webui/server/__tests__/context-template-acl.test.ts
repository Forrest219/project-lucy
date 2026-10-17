import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseMarkdownFrontmatter } from "../markdown-frontmatter";
import { authorizeContext, parseObjectAcl, type ContextSnapshot } from "../proxy/context-acl";

/**
 * Spec §4.3 (v0.2 template ACL) — default deny must ship together with explicit ACLs on every
 * repository template Wiki / Skill, using roles that the SAME template's access.yaml defines.
 */

const repoRoot = path.resolve(__dirname, "../../..");

const TEMPLATES = [
  { name: "docker-demo", dir: "examples/docker-demo/project-template", wiki: "wiki" },
  { name: "postgres-demo", dir: "examples/postgres-demo/project-template", wiki: "wiki" },
  { name: "executive-poc", dir: "examples/executive-poc/project-template", wiki: "wiki" },
  { name: "customer-config.example", dir: "customer-config.example", wiki: "config/wiki", access: "webui/config/access.yaml" }
] as const;

/** `['*']` grants must be listed here with a reason (also in the change description). */
const WILDCARD_ALLOWLIST: Record<string, string> = {
  "skills/answer-style/SKILL.md": "answer formatting guidance only; carries no data, valid for every role"
};

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return markdownFiles(full);
    return name.endsWith(".md") ? [full] : [];
  });
}

function templateRoles(template: (typeof TEMPLATES)[number]): Record<string, { allow?: { tools?: string[] } }> {
  const access = "access" in template ? template.access : "webui/config/access.yaml";
  const config = parse(readFileSync(path.join(repoRoot, template.dir, access), "utf8")) as {
    roles?: Record<string, { allow?: { tools?: string[] } }>;
  };
  return config.roles ?? {};
}

const snapshotFor = (roleId: string, tools: string[]): ContextSnapshot => ({
  ok: true,
  roleIds: [roleId],
  roleChannels: { [roleId]: tools },
  policyVersion: "t",
  roleChannelVersion: "t"
});

describe("template Wiki ACLs ship with default deny", () => {
  const wikiFiles = TEMPLATES.flatMap((template) =>
    markdownFiles(path.join(repoRoot, template.dir, template.wiki)).map((file) => ({ template, file }))
  );

  it("covers exactly the 14 template Wiki pages", () => {
    expect(wikiFiles).toHaveLength(14);
  });

  it.each(wikiFiles.map(({ template, file }) => [`${template.name}:${path.relative(path.join(repoRoot, template.dir), file)}`, template, file] as const))(
    "%s has an explicit ACL naming only roles of its own access.yaml",
    (_label, template, file) => {
      const { data } = parseMarkdownFrontmatter(readFileSync(file, "utf8"));
      const acl = parseObjectAcl(data.allowed_roles, Object.prototype.hasOwnProperty.call(data, "allowed_roles"));
      expect(["roles", "all"]).toContain(acl.state);
      if (acl.state === "all") throw new Error(`${file}: Wiki '*' grants are not used by templates`);
      if (acl.state !== "roles") return;

      const roles = templateRoles(template);
      for (const roleId of acl.roles) {
        expect(Object.keys(roles), `${file}: unknown role ${roleId}`).toContain(roleId);
        const tools = roles[roleId]?.allow?.tools ?? [];
        // Granted roles must hold both Wiki channels, otherwise the grant is unusable.
        expect(tools).toEqual(expect.arrayContaining(["wiki_search", "wiki_read"]));
        const asset = { kind: "wiki", id: file, acl } as const;
        expect(authorizeContext({ userId: "t" }, asset, "read", snapshotFor(roleId, tools)).allowed).toBe(true);
      }
      // A role of the same template that is not listed is denied.
      const unlisted = Object.keys(roles).find((roleId) => !acl.roles.includes(roleId));
      if (unlisted) {
        const asset = { kind: "wiki", id: file, acl } as const;
        const tools = roles[unlisted]?.allow?.tools ?? [];
        expect(authorizeContext({ userId: "t" }, asset, "read", snapshotFor(unlisted, tools)).allowed).toBe(false);
      }
    }
  );
});

describe("template Skill ACLs", () => {
  const skillRoot = path.join(repoRoot, "skills");
  const skills = markdownFiles(skillRoot)
    .map((file) => ({ rel: path.join("skills", path.relative(skillRoot, file)), parsed: parseMarkdownFrontmatter(readFileSync(file, "utf8")) }))
    .filter(({ parsed }) => typeof parsed.data.name === "string");

  it("finds the governed template Skills", () => {
    const named = skills.filter(({ parsed }) => parsed.data.status === "published");
    expect(named.map(({ rel }) => rel).sort()).toEqual([
      path.join("skills", "answer-style", "SKILL.md"),
      path.join("skills", "domains", "superstore", "profit-breakdown.skill.md")
    ]);
  });

  it("every published template Skill has an explicit ACL; `*` only where listed with a reason", () => {
    const demo = TEMPLATES[0];
    const roles = templateRoles(demo);
    for (const { rel, parsed } of skills.filter(({ parsed: p }) => p.data.status === "published")) {
      const acl = parseObjectAcl(parsed.data.roles_allowed, Object.prototype.hasOwnProperty.call(parsed.data, "roles_allowed"));
      expect(["roles", "all"], rel).toContain(acl.state);
      if (acl.state === "all") {
        expect(Object.keys(WILDCARD_ALLOWLIST), `${rel}: undocumented '*'`).toContain(rel.split(path.sep).join("/"));
      }
      if (acl.state === "roles") {
        for (const roleId of acl.roles) {
          expect(Object.keys(roles), `${rel}: unknown role ${roleId}`).toContain(roleId);
          expect(roles[roleId]?.allow?.tools ?? []).toEqual(expect.arrayContaining(["lucy_skill_search", "lucy_skill_read"]));
        }
      }
    }
  });
});
