import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost } from "./apiClient";
import { queryKeys } from "./queryKeys";
import type { CatalogReloadRun } from "./types";

export type UseCatalogReloadOptions = {
  connectionId?: string;
  schema?: string;
};

export type UseCatalogReloadResult = {
  // The most recent run reported by the backend. Persisted across resets so
  // callers can show a non-blocking result panel after the mutation settles.
  lastRun: CatalogReloadRun | null;
  error: Error | null;
  isPending: boolean;
  clearLastRun: () => void;
  reload: () => Promise<CatalogReloadRun | undefined>;
};

/**
 * M14 catalog reload hook. POSTs to `/api/catalog/reload` (static local YAML
 * only — no CLI subprocess, no LLM dependency) and invalidates the catalog
 * caches the page surfaces read from.
 */
export function useCatalogReload(
  options: UseCatalogReloadOptions = {}
): UseCatalogReloadResult {
  const queryClient = useQueryClient();
  const [lastRun, setLastRun] = useState<CatalogReloadRun | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const { connectionId, schema } = options;

  const body: Record<string, string> = {};
  if (connectionId && connectionId.trim()) {
    body.connectionId = connectionId.trim();
  }
  if (schema && schema.trim()) {
    body.schema = schema.trim();
  }

  const mutation = useMutation({
    mutationFn: () => apiPost<CatalogReloadRun>("/api/catalog/reload", body),
    onMutate: () => {
      setError(null);
    },
    onSuccess: (data) => {
      setLastRun(data);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.project });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
      if (connectionId && connectionId.trim()) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.connectionTables(connectionId.trim())
        });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalogReloads });
    },
    onError: (err) => {
      setLastRun(null);
      setError(err instanceof Error ? err : new Error("Catalog reload failed"));
    }
  });

  return {
    lastRun,
    error,
    isPending: mutation.isPending,
    clearLastRun: () => {
      setLastRun(null);
      setError(null);
    },
    reload: () => mutation.mutateAsync()
  };
}
