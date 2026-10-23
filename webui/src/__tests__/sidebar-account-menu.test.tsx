// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { SidebarAccountMenu } from "../components/SidebarAccountMenu";
import type { AuthMe } from "../lib/auth";

const me: AuthMe = { id: "xingchen", displayName: "张星辰", role: "owner", enabled: true, createdAt: null };

function RouteChangeButton() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/overview")}>其他页面</button>;
}

function renderMenu(user = me, onLogout: () => Promise<void> = vi.fn().mockResolvedValue(undefined)) {
  return render(
    <MemoryRouter>
      <SidebarAccountMenu key={user.id} me={user} onLogout={onLogout} />
      <RouteChangeButton />
    </MemoryRouter>
  );
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("sidebar account menu", () => {
  it.each([["owner", "所有者"], ["operator", "运维"]] as const)("shows real identity for %s only after opening", (role, label) => {
    const { container } = renderMenu({ ...me, role });
    const trigger = screen.getByRole("button", { name: "账户菜单：xingchen" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("系统手册")).not.toBeInTheDocument();
    expect(screen.queryByText("退出登录")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "账户菜单" });
    expect(container).not.toContainElement(menu); // Escapes the sidebar via a portal.
    expect(trigger).toHaveAttribute("aria-controls", menu.id);
    expect(screen.getByText(me.displayName)).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getAllByText(me.id)).toHaveLength(2);
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);
    expect(within(menu).getByRole("separator")).toBeInTheDocument();
  });

  it("keeps long IDs intact and protected from translation", () => {
    const id = "long-account-".repeat(15);
    renderMenu({ ...me, id });
    const trigger = screen.getByRole("button", { name: `账户菜单：${id}` });
    expect(trigger).toHaveAttribute("title", id);
    expect(within(trigger).getByText(id)).toHaveClass("pl-account-name", "notranslate");
    fireEvent.click(trigger);
    for (const text of screen.getAllByText(id)) expect(text).toHaveAttribute("translate", "no");
  });

  it("supports arrow navigation, Home/End, and Escape focus restoration", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "账户菜单：xingchen" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    const help = screen.getByRole("menuitem", { name: "打开系统手册" });
    const logout = screen.getByRole("menuitem", { name: "退出登录" });
    expect(logout).toHaveFocus();
    fireEvent.keyDown(logout, { key: "ArrowDown" });
    expect(help).toHaveFocus();
    fireEvent.keyDown(help, { key: "End" });
    expect(logout).toHaveFocus();
    fireEvent.keyDown(logout, { key: "Home" });
    expect(help).toHaveFocus();
    fireEvent.keyDown(help, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on repeated trigger, outside pointer, focus departure, and Tab", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "账户菜单：xingchen" });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    act(() => screen.getByRole("button", { name: "其他页面" }).focus());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "打开系统手册" }), { key: "Tab" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus(); // Native Tab movement itself is a browser behavior.
  });

  it("keeps /help as the handbook destination and closes after activation", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "账户菜单：xingchen" }));
    const help = screen.getByRole("menuitem", { name: "打开系统手册" });
    expect(help).toHaveAttribute("href", "/help");
    fireEvent.click(help);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes an open menu after programmatic navigation", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "账户菜单：xingchen" }));
    fireEvent.click(screen.getByRole("button", { name: "其他页面" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("removes the previous identity and its portal when the account changes", () => {
    const { rerender } = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "账户菜单：xingchen" }));
    rerender(
      <MemoryRouter>
        <SidebarAccountMenu key="other" me={{ ...me, id: "other", displayName: "另一个账户" }} onLogout={vi.fn()} />
        <RouteChangeButton />
      </MemoryRouter>
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByText("xingchen")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "账户菜单：other" })).toHaveAttribute("aria-expanded", "false");
  });

  it("repositions within the viewport and limits height when the window changes", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "账户菜单：xingchen" });
    let top = 600;
    vi.spyOn(trigger, "getBoundingClientRect").mockImplementation(() => ({
      x: 900, y: top, left: 900, top, right: 1100, bottom: top + 40, width: 200, height: 40,
      toJSON: () => ({})
    }));
    fireEvent.click(trigger);
    const popover = screen.getByRole("menu").parentElement!;
    expect(popover).toHaveStyle({
      left: `${Math.max(8, Math.min(900, window.innerWidth - 288 - 8))}px`,
      bottom: `${window.innerHeight - 600 + 8}px`, maxHeight: "584px"
    });
    top = 400;
    fireEvent.resize(window);
    expect(popover).toHaveStyle({ bottom: `${window.innerHeight - 400 + 8}px`, maxHeight: "384px" });
  });

  it("prevents repeated logout and restores the enabled trigger after a failure", async () => {
    let rejectLogout!: (reason: Error) => void;
    const onLogout = vi.fn(() => new Promise<void>((_, reject) => { rejectLogout = reject; }));
    const errorToast = vi.spyOn(toast, "error").mockImplementation(() => "toast");
    renderMenu(me, onLogout);
    const trigger = screen.getByRole("button", { name: "账户菜单：xingchen" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }));
    expect(trigger).toBeDisabled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(onLogout).toHaveBeenCalledTimes(1);
    rejectLogout(new Error("network failure"));
    await waitFor(() => expect(trigger).toBeEnabled());
    expect(trigger).toHaveFocus();
    expect(errorToast).toHaveBeenCalledWith("退出登录失败，请重试");
  });
});
