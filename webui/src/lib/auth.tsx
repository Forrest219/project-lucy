import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGet, apiPost, ApiError } from "./apiClient";

export type AuthMode = "open" | "bootstrap" | "required";

export type AuthMe = {
  id: string;
  displayName: string;
  role: "owner" | "admin";
  enabled: boolean;
  createdAt: string | null;
};

export type AuthStatus = {
  mode: AuthMode;
  me: AuthMe | null;
  authEnabled: boolean;
};

type AuthContextValue = {
  status: AuthStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (adminId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: (input: { adminId: string; displayName?: string; password: string }) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await apiGet<AuthStatus>("/api/auth/status");
    setStatus(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refresh();
      } catch {
        if (!cancelled) {
          setStatus({ mode: "open", me: null, authEnabled: false });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const login = useCallback(
    async (adminId: string, password: string) => {
      await apiPost<{ me: AuthMe }>("/api/auth/login", { adminId, password });
      await refresh();
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    try {
      await apiPost("/api/auth/logout", {});
    } finally {
      await refresh();
    }
  }, [refresh]);

  const bootstrap = useCallback(
    async (input: { adminId: string; displayName?: string; password: string }) => {
      await apiPost<{ me: AuthMe }>("/api/auth/bootstrap", input);
      await refresh();
    },
    [refresh]
  );

  const value = useMemo(
    () => ({ status, loading, refresh, login, logout, bootstrap }),
    [status, loading, refresh, login, logout, bootstrap]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Safe for shells that may render outside AuthProvider in unit tests. */
export function useAuthOptional(): AuthContextValue | null {
  return useContext(AuthContext);
}

export function isAuthError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    (error.code === "AUTH_REQUIRED" || error.code === "AUTH_BOOTSTRAP_REQUIRED")
  );
}
