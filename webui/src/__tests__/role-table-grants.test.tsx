// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoleTableGrants } from "../components/RoleTableGrants";
import type { RolePermissionDraft } from "../lib/rolePermissionDraft";

const CONNECTIONS = [
  { id: "rds-test", schemas: ["rds_schema"] },
  { id: "demo-mysql", schemas: ["dataforai"] },
];
const TABLES = {
  "rds-test\0rds_schema": ["table_a", "table_b"],
  "demo-mysql\0dataforai": ["superstore_orders"],
};

function Controlled({
  initial = { mode: "names", tables: [] } as RolePermissionDraft["scope"],
  grantAllConnections = false,
}) {
  const [value, setValue] = useState<RolePermissionDraft["scope"]>(initial);
  return (
    <>
      <output data-testid="scope-value">{JSON.stringify(value)}</output>
      <RoleTableGrants
        value={value}
        connections={CONNECTIONS}
        candidateTablesByKey={TABLES}
        candidatesLoaded
        onChange={setValue}
        grantAllConnections={grantAllConnections}
      />
    </>
  );
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("RoleTableGrants", () => {
  it("renders connection cards with follow toggles and no advanced catalog-bound checkbox", () => {
    render(<Controlled />);
    expect(screen.getByTestId("table-grants-connection-card-rds-test")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "跟随此连接的启用表 rds-test" })).toBeInTheDocument();
    expect(screen.queryByText("高级设置")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "启用目录绑定" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("table-grants-advanced")).not.toBeInTheDocument();
  });

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
    fireEvent.click(screen.getAllByRole("button", { name: "全选" })[0]!);
    expect(screen.getByText("已选 2 张表")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "清除" })[0]!);
    expect(screen.getByText("已选 0 张表")).toBeInTheDocument();
  });

  it("does not render a prefix option", () => {
    render(<Controlled />);
    expect(screen.queryByRole("checkbox", { name: "按前缀匹配" })).not.toBeInTheDocument();
  });

  it("requires confirmation, seeds the connection, and clears exact tables when enabling follow", () => {
    render(<Controlled initial={{ mode: "names", tables: [{ connection: "rds-test", schema: "rds_schema", name: "table_a", predicates: [{ field: "region", op: "eq", value: "East" }] }] }} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "跟随此连接的启用表 rds-test" }));
    expect(screen.getByRole("alertdialog", { name: "确认切换表范围模式" })).toBeInTheDocument();
    expect(screen.getByText("确认切换为跟随启用表？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByTestId("scope-value")).toHaveTextContent('"mode":"names"');
    expect(screen.getByTestId("scope-value")).toHaveTextContent('"name":"table_a"');

    fireEvent.click(screen.getByRole("checkbox", { name: "跟随此连接的启用表 rds-test" }));
    fireEvent.click(screen.getByRole("button", { name: "确认切换" }));
    expect(screen.getByTestId("scope-value")).toHaveTextContent('{"mode":"catalog_bound","connections":["rds-test"]}');
    expect(screen.getByTestId("table-grants-manual-connections")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "table_a" })).not.toBeInTheDocument();
    expect(screen.getByTestId("catalog-bound-scope-note")).toHaveTextContent("已声明连接上，后续新启用的表自动进入");
    expect(screen.getByTestId("catalog-bound-scope-note")).not.toHaveTextContent("必须显式选择至少一个连接");
    expect(screen.queryByText("已选 0 张表")).not.toBeInTheDocument();
  });

  it("adds a second connection without another mode confirmation", () => {
    render(<Controlled initial={{ mode: "catalog_bound", connections: ["rds-test"] }} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "跟随此连接的启用表 demo-mysql" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("scope-value")).toHaveTextContent('"connections":["rds-test","demo-mysql"]');
  });

  it("marks grants outside current candidates as stale and can clear them without touching live grants", () => {
    render(
      <Controlled
        initial={{
          mode: "names",
          tables: [
            { connection: "rds-test", schema: "rds_schema", name: "table_a", predicates: [{ field: "region", op: "eq", value: "East" }] },
            { connection: "openclaw_db", schema: "public", name: "old_orders" }
          ]
        }}
      />
    );
    const stale = screen.getByTestId("stale-table-grants");
    expect(stale).toHaveTextContent("失效授权 1 条");
    expect(stale).toHaveTextContent("openclaw_db/public/old_orders");
    expect(screen.getByText("已选 2 张表")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("stale-table-grants-clear"));
    expect(screen.queryByTestId("stale-table-grants")).not.toBeInTheDocument();
    expect(screen.getByText("已选 1 张表")).toBeInTheDocument();
    expect(screen.getByTestId("scope-value")).toHaveTextContent('"name":"table_a"');
    expect(screen.getByTestId("scope-value")).toHaveTextContent('"field":"region"');
    expect(screen.getByTestId("scope-value")).not.toHaveTextContent("openclaw_db");
  });

  it("removes a selected table from the selected list, including names missing from candidates", () => {
    render(
      <Controlled
        initial={{
          mode: "names",
          tables: [
            { connection: "rds-test", schema: "rds_schema", name: "table_a" },
            { connection: "rds-test", schema: "rds_schema", name: "ghost_table" }
          ]
        }}
      />
    );
    fireEvent.click(screen.getByText("查看已选表"));
    fireEvent.click(screen.getByRole("button", { name: "移除 rds-test/rds_schema/ghost_table" }));
    expect(screen.getByTestId("scope-value")).not.toHaveTextContent("ghost_table");
    expect(screen.getByTestId("scope-value")).toHaveTextContent('"name":"table_a"');
    fireEvent.click(screen.getAllByRole("button", { name: "清除" })[0]!);
    expect(screen.getByText("已选 0 张表")).toBeInTheDocument();
  });

  it("returns to an empty names scope after turning off the last followed connection", () => {
    render(<Controlled initial={{ mode: "catalog_bound", connections: ["rds-test"] }} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "跟随此连接的启用表 rds-test" }));
    expect(screen.getByText("确认改回指定表？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认切换" }));
    expect(screen.getByTestId("scope-value")).toHaveTextContent('{"mode":"names","tables":[]}');
  });

  it("disables per-connection follow toggles when grantAllConnections is set", () => {
    render(
      <Controlled
        initial={{ mode: "catalog_bound", connections: ["*"] }}
        grantAllConnections
      />
    );
    expect(screen.getByTestId("catalog-bound-scope-note")).toHaveTextContent("跟随全部已配置连接（含日后新增）");
    const toggle = screen.getByRole("checkbox", { name: "跟随此连接的启用表 rds-test" });
    expect(toggle).toBeDisabled();
    expect(toggle).toBeChecked();
  });
});
