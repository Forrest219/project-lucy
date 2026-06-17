import { readFile } from "node:fs/promises";
import path from "node:path";
import { Document, isMap, parseDocument } from "yaml";
import type { Measure, Segment } from "./model";
import { assertReadable } from "./fs-safe";

export type OverlayUpdate = {
  grain?: string[];
  measures?: Measure[];
  segments?: Segment[];
};

export type OverlayPreview = {
  relPath: string;
  oldText: string;
  proposedText: string;
};

function emptyMap(doc: Document): Document["contents"] {
  return doc.createNode({}) as unknown as Document["contents"];
}

function parseOverlay(text: string): Document {
  const doc = parseDocument(text || "") as Document;
  if (!isMap(doc.contents)) {
    doc.contents = emptyMap(doc);
  }
  return doc;
}

async function readOverlayText(projectRoot: string, relPath: string): Promise<string> {
  try {
    const absPath = await assertReadable(projectRoot, relPath);
    return await readFile(absPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export function serializeOverlay(doc: Document): string {
  return doc.toString({ lineWidth: 0 });
}

export function applyOverlayUpdate(doc: Document, table: string, update: OverlayUpdate): Document {
  if (!isMap(doc.contents)) {
    doc.contents = emptyMap(doc);
  }
  doc.set("name", table);
  if (update.grain) {
    doc.set("grain", update.grain);
  }
  if (update.measures) {
    doc.set("measures", update.measures);
  }
  if (update.segments) {
    doc.set("segments", update.segments);
  }
  return doc;
}

export async function previewOverlayUpdate(projectRoot: string, conn: string, table: string, update: OverlayUpdate): Promise<OverlayPreview | null> {
  if (!update.grain && !update.measures && !update.segments) {
    return null;
  }
  const relPath = path.posix.join("semantic-layer", conn, `${table}.yaml`);
  const oldText = await readOverlayText(projectRoot, relPath);
  const doc = parseOverlay(oldText);
  applyOverlayUpdate(doc, table, update);
  return {
    relPath,
    oldText,
    proposedText: serializeOverlay(doc)
  };
}
