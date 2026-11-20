import { useEffect } from "react";

/** Keep leaving an unsaved/uncertain access edit an explicit user decision. */
export function useRolesAgentDraftGuard(active: boolean, uncertain: boolean) {
  useEffect(() => {
    if (!active) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (event.button !== 0 || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank") return;
      const target = new URL(anchor.href, window.location.href);
      if (target.pathname === window.location.pathname) return;
      if (!window.confirm(uncertain
        ? "保存结果仍待确认，离开后请使用请求编号继续核对。确认离开？"
        : "您有未保存的修改，离开后将丢失。确认离开？")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [active, uncertain]);
}
