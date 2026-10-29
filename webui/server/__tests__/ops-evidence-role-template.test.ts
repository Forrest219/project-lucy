/**
 * Spec 149 §6 / WO T4 — 运维问数角色的参考模板。
 *
 * 覆盖：模板形状、模板目录可见性、模板无 source_scope、表能力只有两个 source。
 */

import { describe, expect, it } from "vitest";
import {
  expandTemplate,
  ROLE_TEMPLATES
} from "../admin/role-templates";
import {
  OPS_EVIDENCE_CONNECTION_ID,
  OPS_EVIDENCE_FROZEN,
  OPS_EVIDENCE_ROLE_ID
} from "../ops-evidence/contract";

describe("Spec 149 §6 — 运维问数角色模板", () => {
  it("模板已注册，允许集只用运维问数连接与两个 source", () => {
    const template = ROLE_TEMPLATES[OPS_EVIDENCE_ROLE_ID];
    expect(template).toBeDefined();
    expect(template.id).toBe(OPS_EVIDENCE_ROLE_ID);

    expect(template.allow?.connections).toEqual([OPS_EVIDENCE_CONNECTION_ID]);
    // 禁止 source_scope: catalog_bound。
    expect(template.allow?.source_scope).toBeUndefined();

    const selectors = template.allow?.tableSelectors ?? [];
    expect(selectors).toHaveLength(1);
    const selector = selectors[0];
    expect(selector.connection).toBe(OPS_EVIDENCE_CONNECTION_ID);
    // schema 用冻结值，不是 physicalTable。
    expect(selector.schema).toBe(OPS_EVIDENCE_FROZEN.schema);
    // names 用 sourceName。
    expect("names" in selector ? selector.names : undefined).toEqual([
      OPS_EVIDENCE_FROZEN.sourceName.ops_calls,
      OPS_EVIDENCE_FROZEN.sourceName.ops_call_tables
    ]);
    expect(selector.row_access).toBe("all");
  });

  it("模板含 Wiki 与 Skill 的四个只读通道工具", () => {
    const tools = ROLE_TEMPLATES[OPS_EVIDENCE_ROLE_ID].allow?.tools ?? [];
    for (const tool of ["wiki_search", "wiki_read", "lucy_skill_search", "lucy_skill_read"]) {
      expect(tools, tool).toContain(tool);
    }
    // 目录、查询、解释。
    for (const tool of ["lucy_catalog", "lucy_query", "lucy_explain_query"]) {
      expect(tools, tool).toContain(tool);
    }
    // 不并入 lucy_admin 的通配面。
    expect(tools).not.toContain("*");
    expect(tools).not.toContain("sql_execution");
  });

  it("expandTemplate 产出与模板一致的可写 Role", () => {
    const expanded = expandTemplate(OPS_EVIDENCE_ROLE_ID);
    expect(expanded).toBeDefined();
    expect(expanded?.allow?.connections).toEqual([OPS_EVIDENCE_CONNECTION_ID]);
    expect(expanded?.allow?.source_scope).toBeUndefined();
    const expandedSelector = expanded?.allow?.tableSelectors?.[0] as { names?: string[] } | undefined;
    expect(expandedSelector?.names).toEqual(["ops_calls", "ops_call_tables"]);
    // 模板本身不写 id。
    expect((expanded as { id?: string } | undefined)?.id).toBeUndefined();
  });

  it("lucy_admin 与运维问数角色互不并入", () => {
    const admin = ROLE_TEMPLATES.lucy_admin;
    expect(admin.allow?.connections).toEqual(["*"]);
    // 运维问数角色不在 lucy_admin 的工具/连接里，也不被 lucy_admin 覆盖。
    expect(ROLE_TEMPLATES[OPS_EVIDENCE_ROLE_ID].id).not.toBe("lucy_admin");
  });
});
