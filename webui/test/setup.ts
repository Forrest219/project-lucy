// Global polyfills for jsdom environment used by Vitest.
// Radix UI primitives (Tooltip / Select / etc.) call ResizeObserver
// during mount via @radix-ui/react-use-size; jsdom doesn't ship one.

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class IntersectionObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  root = null;
  rootMargin = "";
  thresholds: ReadonlyArray<number> = [];
}

if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (globalThis as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver =
    ResizeObserverMock;
}

if (typeof (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver === "undefined") {
  (globalThis as { IntersectionObserver: typeof IntersectionObserverMock }).IntersectionObserver =
    IntersectionObserverMock;
}

// React Testing Library's automatic cleanup is not reliable across all our
// test files (some have no `afterEach`, some run in vitest workers where the
// default registration is missed). Run it globally so every jsdom test
// starts with an empty document body and no leftover portals from previous
// renders (e.g. sonner <Toaster />).
afterEach(() => {
  cleanup();
});
