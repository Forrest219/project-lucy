import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { apiGet, apiPost, ApiError, bumpAuthEpoch, setAuthLostHandler } from "./apiClient";
import { isPublicQueryKey } from "./displayQueryOptions";

export type AuthMode = "open" | "bootstrap" | "required" | "unavailable";

export type AuthMe = {
  id: string;
  displayName: string;
  role: "owner" | "operator";
  enabled: boolean;
  createdAt: string | null;
};

export type AuthStatus = {
  mode: AuthMode;
  me: AuthMe | null;
  authEnabled: boolean;
  /** v2.0 only offers local passwords. A later release may add `oidc`. */
  methods?: Array<"local" | "oidc">;
};

type AuthContextValue = {
  status: AuthStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (adminId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: (input: BootstrapInput) => Promise<void>;
};

export type BootstrapInput = {
  adminId: string;
  displayName?: string;
  password: string;
  /** One-time deployment secret; held in memory only and sent as X-Lucy-Bootstrap-Token. */
  bootstrapToken?: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function identityOf(status: AuthStatus | null): string {
  return status ? `${status.mode}:${status.me?.id ?? ""}` : "";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useContext(QueryClientContext);
  const identityRef = useRef<string>("");

  // Spec 174 §4.2 — account boundary: a new authEpoch rejects late responses from
  // the previous identity, and protected caches are dropped (public Help / branding kept).
  const resetProtectedQueries = useCallback(() => {
    bumpAuthEpoch();
    if (!queryClient) return;
    void queryClient.cancelQueries({ predicate: (query) => !isPublicQueryKey(query.queryKey) });
    queryClient.removeQueries({ predicate: (query) => !isPublicQueryKey(query.queryKey) });
  }, [queryClient]);

  const refresh = useCallback(async () => {
    const data = await apiGet<AuthStatus>("/api/auth/status");
    const nextIdentity = identityOf(data);
    if (identityRef.current && identityRef.current !== nextIdentity) resetProtectedQueries();
    identityRef.current = nextIdentity;
    setStatus(data);
  }, [resetProtectedQueries]);

  useEffect(() => {
    setAuthLostHandler(() => {
      resetProtectedQueries();
      void refresh().catch(() => undefined);
    });
    return () => setAuthLostHandler(null);
  }, [refresh, resetProtectedQueries]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refresh();
      } catch {
        if (!cancelled) {
          setStatus({ mode: "open", me: null, authEnabled: false, methods: ["local"] });
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
      // Even a same-account re-login starts a new auth epoch.
      resetProtectedQueries();
      await apiPost<{ me: AuthMe }>("/api/auth/login", { adminId, password });
      await refresh();
    },
    [refresh, resetProtectedQueries]
  );

  const logout = useCallback(async () => {
    resetProtectedQueries();
    try {
      await apiPost("/api/auth/logout", {});
    } finally {
      await refresh();
    }
  }, [refresh, resetProtectedQueries]);

  const bootstrap = useCallback(
    async ({ bootstrapToken, ...input }: BootstrapInput) => {
      await apiPost<{ me: AuthMe }>("/api/auth/bootstrap", input, {
        headers: bootstrapToken ? { "X-Lucy-Bootstrap-Token": bootstrapToken } : undefined
      });
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
