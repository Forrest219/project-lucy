import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronUp, CircleHelp, LogOut, UserRound } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { toast } from "sonner";
import type { AuthMe } from "../lib/auth";

/** Global account utilities; the portal avoids the sidebar's overflow clipping. */
export function SidebarAccountMenu({ me, onLogout }: { me: AuthMe; onLogout: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<"first" | "last">("first");
  const initialFocusDone = useRef(false);
  const mountedRef = useRef(true);
  const focusAfterLogout = useRef(false);
  const menuId = useId();
  const location = useLocation();

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => { close(); }, [location.key, close]);

  useLayoutEffect(() => {
    if (!pending && focusAfterLogout.current) {
      focusAfterLogout.current = false;
      triggerRef.current?.focus();
    }
  }, [pending]);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(288, window.innerWidth - 16);
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      bottom: Math.max(8, window.innerHeight - rect.top + 8),
      width,
      maxHeight: Math.max(0, rect.top - 16)
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      initialFocusDone.current = false;
      return;
    }
    updatePosition();
  }, [open, updatePosition]);

  useLayoutEffect(() => {
    // First opening starts hidden until geometry is committed. Hidden menu
    // items cannot receive browser focus; resizing must not reset selection.
    if (!open || position.visibility === "hidden" || initialFocusDone.current) return;
    initialFocusDone.current = true;
    const items = popoverRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (items?.length) items[initialFocus.current === "last" ? items.length - 1 : 0].focus();
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) close();
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", onEscape);
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, close, updatePosition]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(popoverRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    switch (event.key) {
      case "ArrowDown": next = (index + 1) % items.length; break;
      case "ArrowUp": next = (index - 1 + items.length) % items.length; break;
      case "Home": next = 0; break;
      case "End": next = items.length - 1; break;
      case "Tab": close(true); return; // Native traversal continues from the trigger.
      case " ":
        if (document.activeElement instanceof HTMLAnchorElement) {
          event.preventDefault();
          document.activeElement.click();
        }
        return;
      default: return;
    }
    event.preventDefault();
    items[next]?.focus();
  }

  async function logout() {
    if (pending) return;
    close();
    setPending(true);
    try {
      await onLogout();
    } catch {
      toast.error("退出登录失败，请重试");
    } finally {
      if (mountedRef.current) {
        focusAfterLogout.current = true;
        setPending(false);
      }
    }
  }

  return (
    <div className="pl-account">
      <button
        ref={triggerRef}
        type="button"
        className="pl-account-trigger"
        aria-label={`账户菜单：${me.id}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={pending}
        disabled={pending}
        title={me.id}
        onClick={() => { initialFocus.current = "first"; setOpen((value) => !value); }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          initialFocus.current = event.key === "ArrowUp" ? "last" : "first";
          setOpen(true);
        }}
      >
        <UserRound aria-hidden="true" className="size-4 shrink-0" />
        <span className="pl-account-name notranslate" translate="no">{me.id}</span>
        <ChevronUp aria-hidden="true" className={`pl-account-chevron size-4 shrink-0${open ? " pl-account-chevron--open" : ""}`} />
      </button>
      {open ? createPortal(
        <div ref={popoverRef} className="pl-account-popover" style={position}>
          <div className="pl-account-summary">
            <strong className="notranslate" translate="no">{me.id}</strong>
            {me.displayName && me.displayName !== me.id ? <span className="notranslate" translate="no">{me.displayName}</span> : null}
            <span>{me.role === "owner" ? "所有者" : "运维"}</span>
          </div>
          <div id={menuId} role="menu" aria-label="账户菜单" onKeyDown={onMenuKeyDown}>
            <Link
              role="menuitem"
              tabIndex={-1}
              to="/help"
              className="pl-account-item"
              aria-label="打开系统手册"
              aria-current={location.pathname === "/help" ? "page" : undefined}
              onClick={() => close(true)}
            >
              <CircleHelp aria-hidden="true" className="size-4 shrink-0" />
              <span>系统手册</span>
            </Link>
            <div className="pl-account-separator" role="separator" />
            <button type="button" role="menuitem" tabIndex={-1} className="pl-account-item" onClick={() => void logout()}>
              <LogOut aria-hidden="true" className="size-4 shrink-0" />
              <span>退出登录</span>
            </button>
          </div>
        </div>, document.body
      ) : null}
    </div>
  );
}
