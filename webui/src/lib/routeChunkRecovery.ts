import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * Spec 174 §6 — route chunk recovery. When a lazy route chunk fails to load
 * (typically an old tab after a deployment replaced hashed assets), reload
 * the page once per tab session; a second failure surfaces a local retry
 * instead of a reload loop. A successful chunk load re-arms the one-shot.
 */
export const CHUNK_RELOAD_SESSION_KEY = "lucy.route-chunk-reload.v1";

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
  /Loading chunk [\w-]+ failed/i
];

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export type ChunkRecoveryEnv = {
  reload: () => void;
  session: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
};

const defaultEnv = (): ChunkRecoveryEnv => ({
  reload: () => window.location.reload(),
  session: storage()
});

/** Load a module; on a chunk error reload once per session, otherwise rethrow. */
export async function loadWithChunkRecovery<T>(loader: () => Promise<T>, env: ChunkRecoveryEnv = defaultEnv()): Promise<T> {
  try {
    const module = await loader();
    env.session?.removeItem(CHUNK_RELOAD_SESSION_KEY);
    return module;
  } catch (error) {
    if (isChunkLoadError(error) && env.session && !env.session.getItem(CHUNK_RELOAD_SESSION_KEY)) {
      env.session.setItem(CHUNK_RELOAD_SESSION_KEY, String(Date.now()));
      env.reload();
      return new Promise<T>(() => undefined);
    }
    throw error;
  }
}

type AnyComponent = ComponentType<Record<string, unknown>>;

export type LazyRoute = {
  Component: LazyExoticComponent<AnyComponent>;
  preload: () => Promise<unknown>;
};

/** Lazy named export with hover/focus preloading and one-shot chunk recovery. */
export function lazyRoute<M extends Record<string, unknown>>(loader: () => Promise<M>, exportName: keyof M & string): LazyRoute {
  let pending: Promise<M> | null = null;
  const load = () => {
    pending ??= loader().catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  };
  const Component = lazy(() =>
    loadWithChunkRecovery(load).then((module) => ({ default: module[exportName] as AnyComponent }))
  );
  return { Component, preload: () => load().catch(() => undefined) };
}
