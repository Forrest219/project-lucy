// Spec 151 — 业务 Skill 授权与文件安全加固
// 准入层级：L2 PR Impacted
// 标签：@pr-impacted

import { expect, test, type Page } from "@playwright/test";

type SkillRecord = {
  name: string;
  domain: string;
  title: string;
  version: string;
  status: "draft" | "published" | "deprecated";
  roles_allowed: string[];
  triggers: string[];
  description: string;
  content: string;
  uri: string;
  relativePath: string;
  filePath: string;
  raw: string;
  file_version: string;
  prerequisites: { sources: string[]; measures: string[]; wiki_docs: string[] };
  eval_cases: string[];
  validation: { valid: boolean; issues: unknown[] };
};

function skillFrom(body: Record<string, unknown>, fileVersion: string): SkillRecord {
  const name = String(body.name);
  const domain = String(body.domain);
  return {
    name,
    domain,
    title: String(body.title || name),
    version: String(body.version || "1.0.0"),
    status: (body.status as SkillRecord["status"]) || "draft",
    roles_allowed: (body.roles_allowed as string[]) || [],
    triggers: (body.triggers as string[]) || [],
    description: String(body.description || ""),
    content: String(body.content || ""),
    uri: `lucy-skill://${domain}/${name}`,
    relativePath: `skills/${domain}/${name}.md`,
    filePath: `/tmp/lucy-e2e-fixture/skills/${domain}/${name}.md`,
    raw: "---\n---\n",
    file_version: fileVersion,
    prerequisites: { sources: [], measures: [], wiki_docs: [] },
    eval_cases: [],
    validation: { valid: true, issues: [] },
  };
}

async function installSkillApi(page: Page, options: { conflictOnUpdate?: boolean } = {}) {
  let current: SkillRecord | null = null;
  const writes: Array<{ method: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;

    if (url.pathname === "/api/admin/roles" && method === "GET") {
      await route.fulfill({ json: { ok: true, data: { roles: [
        { id: "analyst", source: "yaml", usageCount: 1, tools: [] },
        { id: "finance", source: "yaml", usageCount: 0, tools: [] },
      ] } } });
      return;
    }
    if (url.pathname === "/api/skills" && method === "GET") {
      const skills = current ? [current] : [];
      await route.fulfill({ json: { ok: true, count: skills.length, skills } });
      return;
    }
    if (url.pathname === "/api/skills" && method === "POST") {
      writes.push({ method, body });
      current = skillFrom(body, "file-v1");
      await route.fulfill({ json: { ok: true, skill: current } });
      return;
    }
    if (url.pathname === "/api/skills/finance_ops/quarter-close" && method === "PUT") {
      writes.push({ method, body });
      if (options.conflictOnUpdate) {
        await route.fulfill({ status: 409, json: { ok: false, error: "skill_write_conflict" } });
        return;
      }
      current = {
        ...skillFrom(body, "file-v2"),
        name: "quarter-close",
        domain: "finance_ops",
        uri: "lucy-skill://finance_ops/quarter-close",
        relativePath: "skills/finance_ops/quarter-close.md",
      };
      await route.fulfill({ json: { ok: true, skill: current } });
      return;
    }
    await route.fulfill({ status: 404, json: { ok: false, error: { code: "NOT_FOUND", message: url.pathname } } });
  });
  return { writes, get current() { return current; }, set current(value: SkillRecord | null) { current = value; } };
}

test.describe("Spec 151 business Skill WebUI", () => {
  test("@pr-impacted creates deny-by-default, confirms wildcard, and edits without moving identity", async ({ page }) => {
    const api = await installSkillApi(page);
    await page.goto("/skills");
    await page.getByTestId("skills-create").click();

    await expect(page.getByTestId("skill-role-none")).toHaveText("无人可见");
    await page.getByTestId("skill-field-name").fill("quarter-close");
    await page.getByTestId("skill-field-domain").fill("finance_ops");
    await page.getByTestId("skill-field-title").fill("季度关账");
    await page.getByTestId("skill-field-content").fill("# 季度关账\n按顺序核对。\n");

    const analyst = page.getByLabel("analyst");
    await analyst.check();
    await expect(analyst).toBeChecked();
    await analyst.uncheck();
    await expect(page.getByTestId("skill-role-none")).toBeVisible();

    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("所有角色可见");
      await dialog.accept();
    });
    await page.getByTestId("skill-role-all").check();
    await expect(page.getByTestId("skill-role-option").first()).toBeDisabled();
    await page.getByTestId("skill-save").click();

    await expect.poll(() => api.writes.length).toBe(1);
    expect(api.writes[0]?.body.roles_allowed).toEqual(["*"]);
    await expect(page.getByTestId("skill-detail-path")).toContainText("skills/finance_ops/quarter-close.md");

    await page.getByTestId("skill-edit").click();
    await expect(page.getByTestId("skill-field-name")).toBeDisabled();
    await expect(page.getByTestId("skill-field-domain")).toBeDisabled();
    await page.getByTestId("skill-role-all").uncheck();
    await page.getByLabel("analyst").check();
    await page.getByTestId("skill-save").click();

    await expect.poll(() => api.writes.length).toBe(2);
    expect(api.writes[1]?.body.expected_version).toBe("file-v1");
    expect(api.writes[1]?.body.roles_allowed).toEqual(["analyst"]);
    expect(api.current?.relativePath).toBe("skills/finance_ops/quarter-close.md");
  });

  test("@pr-impacted surfaces stale file_version as a write conflict", async ({ page }) => {
    const api = await installSkillApi(page, { conflictOnUpdate: true });
    api.current = skillFrom({
      name: "quarter-close",
      domain: "finance_ops",
      title: "季度关账",
      version: "1.0.0",
      status: "draft",
      roles_allowed: [],
      triggers: [],
      description: "",
      content: "old",
    }, "stale-file-version");

    await page.goto("/skills?skill=finance_ops%2Fquarter-close");
    await page.getByTestId("skill-edit").click();
    await page.getByTestId("skill-field-content").fill("new content");
    await page.getByTestId("skill-save").click();

    await expect(page.getByTestId("skill-form-error")).toContainText("skill_write_conflict");
    expect(api.writes[0]?.body.expected_version).toBe("stale-file-version");
  });
});
