import type { ConceptDocument } from "./contracts.mjs";

export function defaultWhitelistPath(): string;
export function resolveFencedConceptsDir(contentRootOrDir: string, options?: { create?: boolean }): string;
export function ensureConceptsDir(contentRoot: string): string;
export function safeConceptPath(dir: string, id: string): string;
export function readConceptBytes(dir: string, id: string): Buffer | null;
export function readConcept(dir: string, id: string): ConceptDocument | null;
export function listConceptIds(dir: string): string[];
