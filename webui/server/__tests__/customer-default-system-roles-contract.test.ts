/**
 * Spec lucy-20261105-customer-default-system-roles §6.
 *
 * SC-07 文档契约、SC-08 客户示例种子、SC-10 种子与 role-templates 不得漂移。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { expandTemplate } from "../admin/role-templates";
import { OPS_EVIDENCE_ROLE_ID } from "../ops-evidence/contract";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const DOC_FILES = [
  "webui/docs/131-lucy-admin-catalog-bound-role-spec.md",
  "webui/docs/149-ops-evidence-connection-spec.md",
  "docs/specs/lucy-20261101-ops-evidence-askable-governance-spec.md",
  "docs/specs/lucy-20261104-lucy-ops-manifest-upgrade-heal-spec.md",
  "webui/docs/00-product-terminology-standard.md"
];

const ABSOLUTE_PHRASE = /永不写[^。\n]{0,80}access\.yaml|do not write access\.yaml/gi;

function readRepo(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

describe("SC-07 — 文档不再把「永不写 access.yaml」当作未作废绝对值", () => {
  it("131／149／D22／术语／自愈里的该句都带已作废", () => {
    for (const rel of DOC_FILES) {
      const text = readRepo(rel);
      for (const match of text.matchAll(ABSOLUTE_PHRASE)) {
        const at = match.index ?? 0;
        const window = text.slice(Math.max(0, at - 180), at + match[0].length + 180);
        expect(window, `${rel} @ ${at}`).toMatch(/已作废/);
      }
    }
  });

  it("149 旧 SC-11「整文件字节不变」已作废，连接测试改记缺则创建例外", () => {
    const spec = readRepo("webui/docs/149-ops-evidence-connection-spec.md");
    const sc11 = spec.slice(spec.indexOf("| SC-11 |"));
    expect(sc11).toMatch(/整文件字节不变/);
    expect(sc11.slice(0, 500)).toMatch(/已作废/);

    const testSrc = readRepo("webui/server/__tests__/ops-evidence-connection.test.ts");
    expect(testSrc).not.toContain("确保前后 access.yaml 整文件字节不变");
    expect(testSrc).toContain("缺 lucy_ops_reader");
  });

  it("术语备注指向客户种子与缺则创建例外", () => {
    const terminology = readRepo("webui/docs/00-product-terminology-standard.md");
    expect(terminology).toMatch(/客户种子／ensure 可落盘正式 Role/);
    expect(terminology).toMatch(/缺失时缺则创建见/);
  });
});

describe("SC-08 / SC-10 — 客户示例种子", () => {
  it("正式 lucy_admin 全字段等于模板，不含 lucy_ops_reader，示例 agent 不绑系统 Role", () => {
    const raw = readRepo("customer-config.example/webui/config/access.yaml");
    const doc = parse(raw) as {
      roles?: Record<string, unknown>;
      users?: Array<{ id?: string; role?: string; roles?: string[] }>;
    };
    expect(doc.roles?.lucy_admin).toEqual(expandTemplate("lucy_admin"));
    expect(doc.roles?.[OPS_EVIDENCE_ROLE_ID]).toBeUndefined();
    expect(doc.roles?.customer_readonly).toBeTruthy();

    const agent = doc.users?.find((user) => user.id === "customer_agent");
    expect(agent?.role).toBe("customer_readonly");
    expect(agent?.role).not.toBe("lucy_admin");
    expect(agent?.role).not.toBe(OPS_EVIDENCE_ROLE_ID);
    expect(agent?.roles ?? []).not.toEqual(expect.arrayContaining(["lucy_admin", OPS_EVIDENCE_ROLE_ID]));
  });
});
