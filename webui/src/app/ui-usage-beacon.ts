import { useEffect } from "react";
import { apiPost } from "../lib/apiClient";
import type { AuthStatus } from "../lib/auth";

export const UI_PAGE_VIEW_DEBOUNCE_MS = 300;

export function shouldRecordPageView(status: AuthStatus | null, pathname: string): boolean {
  if (pathname === "/login") return false;
  if (!status) return false;
  if (status.mode === "open") return true;
  return status.me != null;
}

export function useUiPageViewBeacon(pathname: string, status: AuthStatus | null): void {
  const record = shouldRecordPageView(status, pathname);
  useEffect(() => {
    if (!record) return;
    const handle = window.setTimeout(() => {
      void apiPost("/api/admin/ui-usage/page-view", { pathname }).catch(() => {
        // Observation must not interrupt navigation.
      });
    }, UI_PAGE_VIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [pathname, record]);
}
