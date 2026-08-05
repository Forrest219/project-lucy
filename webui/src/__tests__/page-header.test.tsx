// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";

function renderInRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("PageHeader", () => {
  it("renders the title with the page header hook", () => {
    renderInRouter(<PageHeader title="连接概览" />);
    expect(screen.getByRole("heading", { level: 1, name: "连接概览" })).toHaveClass(
      "pl-page-header-title"
    );
    expect(screen.getByTestId("page-header")).toHaveClass("pl-page-header");
    // 没有 backAction / breadcrumbs 时，不应渲染面包屑 nav
    expect(screen.queryByRole("navigation", { name: "面包屑" })).not.toBeInTheDocument();
  });

  it("renders breadcrumbs when given a non-matching list", () => {
    renderInRouter(<PageHeader title="连接概览" breadcrumbs={["数据接入"]} />);
    expect(screen.getByRole("navigation", { name: "面包屑" })).toBeInTheDocument();
    expect(screen.getByText("数据接入")).toBeInTheDocument();
  });

  it("suppresses breadcrumbs when last item equals the string title", () => {
    renderInRouter(<PageHeader title="访问日志" breadcrumbs={["访问治理", "访问日志"]} />);
    expect(screen.queryByRole("navigation", { name: "面包屑" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "访问日志" })).toBeInTheDocument();
  });

  it("does not suppress breadcrumbs when title is a ReactNode (string compare is unsafe)", () => {
    renderInRouter(
      <PageHeader
        title={<>维护关联关系：<span>orders</span></>}
        breadcrumbs={["语义建模", "关联关系", "orders"]}
      />
    );
    // ReactNode title 跳过同名抑制，面包屑照常渲染
    expect(screen.getByRole("navigation", { name: "面包屑" })).toBeInTheDocument();
  });

  it("renders backAction above title and suppresses breadcrumbs", () => {
    renderInRouter(
      <PageHeader
        backAction={<a href="/admin/agents">‹ 返回 Agent</a>}
        title="Agent 详情"
        breadcrumbs={["访问治理", "Agent", "agent-1"]}
      />
    );
    expect(screen.getByRole("link", { name: /返回 Agent/ })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "面包屑" })).not.toBeInTheDocument();
  });

  it("applies data-truncate only when title is a string", () => {
    const { rerender } = renderInRouter(<PageHeader title="短标题" />);
    expect(screen.getByRole("heading", { level: 1, name: "短标题" })).toHaveAttribute(
      "data-truncate",
      "true"
    );

    rerender(
      <MemoryRouter>
        <PageHeader title={<span>动态标题</span>} />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveAttribute("data-truncate");
  });

  it("renders description with the standard text size", () => {
    renderInRouter(<PageHeader title="X" description="说明文案" />);
    expect(document.querySelector(".pl-page-header-description")).toHaveTextContent("说明文案");
  });

  it("renders badges and actions inside the aside cell", () => {
    renderInRouter(
      <PageHeader
        title="X"
        badges={<span data-testid="b1">B1</span>}
        actions={<button type="button">A1</button>}
      />
    );
    expect(screen.getByTestId("page-header-badges")).toBeInTheDocument();
    expect(screen.getByTestId("page-header-actions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "A1" })).toBeInTheDocument();
  });
});