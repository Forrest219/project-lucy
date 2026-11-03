/**
 * Hive table partition profile (execution-wave M1).
 *
 * Authority: docs/specs/lucy-20261030-hive-query-execution-spec.md HQ-D1/HQ-D2
 *
 * Three states only: partitioned | unpartitioned | unknown.
 * `unknown` must never be treated as unpartitioned for query admission.
 */

export type HivePartitionStatus = "partitioned" | "unpartitioned" | "unknown";

export type HivePartitionKey = {
  /** Partition column name as registered from metadata. */
  name: string;
  /** 0-based position in the partition hierarchy (leftmost = 0). */
  position: number;
  /** Declared type string from metadata (e.g. string, date, int). */
  type: string;
};

export type HivePartitionProfile = {
  status: HivePartitionStatus;
  keys: HivePartitionKey[];
};

export type HivePartitionProfileFailureReason =
  | "hive_partition_keys_invalid"
  | "hive_partition_status_contradiction";

export type HivePartitionProfileResult =
  | { ok: true; profile: HivePartitionProfile }
  | { ok: false; reason: HivePartitionProfileFailureReason; detail: string };

/**
 * Build a partition profile from an optional Manifest field.
 *
 * - missing / null field → `unknown` (cannot claim unpartitioned)
 * - empty array → `unpartitioned`
 * - non-empty ordered keys → `partitioned`
 */
export function buildHivePartitionProfile(raw: unknown): HivePartitionProfileResult {
  if (raw === undefined || raw === null) {
    return { ok: true, profile: { status: "unknown", keys: [] } };
  }
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      reason: "hive_partition_keys_invalid",
      detail: "partition_keys must be an array when present"
    };
  }
  if (raw.length === 0) {
    return { ok: true, profile: { status: "unpartitioned", keys: [] } };
  }

  const keys: HivePartitionKey[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return {
        ok: false,
        reason: "hive_partition_keys_invalid",
        detail: `partition_keys[${index}] must be an object`
      };
    }
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) {
      return {
        ok: false,
        reason: "hive_partition_keys_invalid",
        detail: `partition_keys[${index}].name is required`
      };
    }
    const lower = name.toLowerCase();
    if (seen.has(lower)) {
      return {
        ok: false,
        reason: "hive_partition_keys_invalid",
        detail: `duplicate partition key '${name}'`
      };
    }
    seen.add(lower);
    const position =
      typeof record.position === "number" && Number.isInteger(record.position)
        ? record.position
        : index;
    if (position !== index) {
      return {
        ok: false,
        reason: "hive_partition_keys_invalid",
        detail: `partition_keys must be contiguous from position 0; expected ${index}, got ${position}`
      };
    }
    const type = typeof record.type === "string" && record.type.trim() ? record.type.trim() : "string";
    keys.push({ name, position, type });
  }

  return { ok: true, profile: { status: "partitioned", keys } };
}

/** Explicit constructors for tests and metadata collectors. */
export function partitionedProfile(keys: Array<{ name: string; type?: string }>): HivePartitionProfile {
  return {
    status: "partitioned",
    keys: keys.map((key, position) => ({
      name: key.name,
      position,
      type: key.type ?? "string"
    }))
  };
}

export function unpartitionedProfile(): HivePartitionProfile {
  return { status: "unpartitioned", keys: [] };
}

export function unknownPartitionProfile(): HivePartitionProfile {
  return { status: "unknown", keys: [] };
}
