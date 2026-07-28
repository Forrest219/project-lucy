import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost } from "./apiClient";
import { queryKeys } from "./queryKeys";
import type { IngestRun } from "./types";

export type IngestRunOptions = {
  connectionId: string;
  schema?: string;
};

export type UseIngestRunResult = {
  // Most recent server-reported IngestRun. Persists across resets so the
  // diagnostics drawer can show it after the mutation settles.
  lastRun: IngestRun | null;
  // True while the mutation is in flight.
  isPending: boolean;
  // Reset the last run (useful when closing the diagnostics drawer).
  clearLastRun: () => void;
  // Trigger a new ingest run.
  run: () => Promise<IngestRun | undefined>;
};

/**
 * Shared mutation hook for triggering KTX ingest from any UI surface.
 *
 * - POSTs to `/api/connections/:connId/ingest` with the optional `schema`.
 * - Stores the last run so callers can surface diagnostics without re-fetching.
 * - Invalidates the catalog caches the spec asks us to refresh.
 */
export function useIngestRun(options: IngestRunOptions): UseIngestRunResult {
  const queryClient = useQueryClient();
  const [lastRun, setLastRun] = useState<IngestRun | null>(null);
  const { connectionId, schema } = options;

  const mutation = useMutation({
    mutationFn: () =>
      apiPost<IngestRun>(
        `/api/connections/${encodeURIComponent(connectionId)}/ingest`,
        schema ? { schema } : {}
      ),
    onSuccess: (data) => {
      setLastRun(data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.project });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectionTables(connectionId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ingestRuns });
    },
    onError: () => {
      setLastRun(null);
    }
  });

  return {
    lastRun,
    isPending: mutation.isPending,
    clearLastRun: () => setLastRun(null),
    run: () => mutation.mutateAsync()
  };
}
