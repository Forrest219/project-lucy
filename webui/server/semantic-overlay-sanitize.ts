import { parseDocument } from "yaml";

/** Manifest-only column keys rejected by KTX resolved SourceColumn (extra=forbid). */
const MANIFEST_ONLY_COLUMN_KEYS = ["pk", "nullable"] as const;

export type SanitizeSemanticSourceResult = {
  text: string;
  stripped: boolean;
  strippedKeys: string[];
};

function valueAsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Strip Manifest-only keys from a columns array so standalone / overlay YAML
 * satisfies the KTX TS/Python SourceColumn contract.
 */
export function stripManifestOnlyColumnKeys(columns: unknown): {
  columns: unknown;
  strippedKeys: string[];
} {
  if (!Array.isArray(columns)) {
    return { columns, strippedKeys: [] };
  }
  const strippedKeys = new Set<string>();
  const next = columns.map((item) => {
    const record = valueAsRecord(item);
    if (Object.keys(record).length === 0) {
      return item;
    }
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if ((MANIFEST_ONLY_COLUMN_KEYS as readonly string[]).includes(key)) {
        strippedKeys.add(key);
        continue;
      }
      cleaned[key] = value;
    }
    return cleaned;
  });
  return { columns: next, strippedKeys: [...strippedKeys] };
}

/**
 * Sanitize semantic-source (overlay) YAML for publish/query.
 * Schema manifests (`tables:`) are left unchanged — ManifestColumn allows pk/nullable.
 */
export function sanitizeSemanticSourceYaml(text: string): SanitizeSemanticSourceResult {
  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length > 0) {
    return { text, stripped: false, strippedKeys: [] };
  }
  const root = doc.toJSON();
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return { text, stripped: false, strippedKeys: [] };
  }
  const record = root as Record<string, unknown>;
  if (record.tables && typeof record.tables === "object" && !Array.isArray(record.tables)) {
    return { text, stripped: false, strippedKeys: [] };
  }
  if (!Array.isArray(record.columns)) {
    return { text, stripped: false, strippedKeys: [] };
  }

  const { columns, strippedKeys } = stripManifestOnlyColumnKeys(record.columns);
  if (strippedKeys.length === 0) {
    return { text, stripped: false, strippedKeys: [] };
  }

  record.columns = columns;
  const next = parseDocument("");
  next.contents = next.createNode(record);
  return {
    text: next.toString({ lineWidth: 0 }),
    stripped: true,
    strippedKeys
  };
}
