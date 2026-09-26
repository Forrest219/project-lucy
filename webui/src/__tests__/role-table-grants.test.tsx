// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoleTableGrants } from "../components/RoleTableGrants";
import type { RolePermissionDraft } from "../lib/rolePermissionDraft";

const CONNECTIONS = [{ id: "rds-test", schemas: ["rds_schema"] }];
const TABLES = { "rds-test\0rds_schema": ["table_a", "table_b"] };

function Controlled({ initial = { mode: "names", tables: [] } as RolePermissionDraft["scope"] }) {
  const [value, setValue] = useState<RolePermissionDraft["scope"]>(initial);
  return (
    <>
      <output data-testid="scope-value">{JSON.stringify(value)}</output>
      <RoleTableGrants value={value} connections={CONNECTIONS} candidateTablesByKey={TABLES} candidatesLoaded onChange={setValue} />
    </>
  );
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("RoleTableGrants", () => {
  it("renders connection/schema/table tree and derives a selected summary", () => {
    render(<Controlled />);
    expect(screen.getByText("rds-test")).toBeInTheDocument();
    expect(screen.getByText("rds_schema")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "table_a" }));
    expect(screen.getByText("已选 1 张表")).toBeInTheDocument();
    expect(screen.getByTestId("scope-value")).toHaveTextContent('"name":"table_a"');
  });

  it("supports search and schema select/clear", () => {
    render(<Controlled />);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索可访问的表" }), { target: { value: "table_b" } });
    expect(screen.queryByRole("checkbox", { name: "table_a" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "table_b" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索可访问的表" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    expect(screen.getByText("已选 2 张表")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(screen.getByText("已选 0 张表")).toBeInTheDocument();
  });

  it("does not render a prefix option", () => {
    render(<Controlled />);
    fireEvent.click(screen.getByText("高级设置"));
    expect(screen.queryByRole("checkbox", { name: "按前缀匹配" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "启用目录绑定" })).toBeInTheDocument();
  });

  it("requires an explicit confirmation and clears exact tables when enabling catalog_bound", () => {
    render(<Controlled initial={{ mode: "names", tables: [{ connection: "rds-test", schema: "rds_schema", name: "table_a", predicates: [{ field: "region", op: "eq", value: "East" }] }] }} />);
    fireEvent.click(screen.getByText("高级设置"));
    fireEvent.click(screen.getByRole("checkbox", { name: "启用目录绑定" }));
    expect(screen.getByRole("alertdialog", { name: "确认切换表范围模式" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认切换" }));
    expect(screen.getByTestId("scope-value")).toHaveTextContent('{"mode":"catalog_bound","connections":[]}');
    expect(screen.getByTestId("table-grants-manual-connections")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "允许的连接 rds-test" }));
    expect(screen.getByTestId("scope-value")).toHaveTextContent('"connections":["rds-test"]');
  });

  it("returns to an empty names scope after disabling catalog_bound", () => {
    render(<Controlled initial={{ mode: "catalog_bound", connections: ["rds-test"] }} />);
    fireEvent.click(screen.getByText("高级设置"));
    fireEvent.click(screen.getByRole("checkbox", { name: "启用目录绑定" }));
    fireEvent.click(screen.getByRole("button", { name: "确认切换" }));
    expect(screen.getByTestId("scope-value")).toHaveTextContent('{"mode":"names","tables":[]}');
  });
});
