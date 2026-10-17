// Minimal JSON-Schema (draft-07 subset) validator for the evidence contract. No dependencies: the E2E
// scripts run from the repository root where only `yaml` is installed. Supported keywords are exactly the ones
// release-evidence.schema.json uses: type, const, enum, pattern, minLength, required, properties, items.
// Unknown keywords are ignored by design except that unknown *properties* are allowed (the contract may grow).

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function typeMatches(expected, value) {
  const actual = typeOf(value);
  if (expected === "number") return actual === "integer" || actual === "number";
  return expected === actual;
}

/** Returns a list of `path: problem` strings; empty means valid. */
export function validateAgainstSchema(schema, value, at = "$") {
  const problems = [];
  if ("const" in schema && value !== schema.const) problems.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${at}: must be one of ${schema.enum.join("|")}`);
  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.some((t) => typeMatches(t, value))) {
      problems.push(`${at}: expected ${expected.join("|")}, got ${typeOf(value)}`);
      return problems;
    }
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) problems.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) problems.push(`${at}: does not match ${schema.pattern}`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => problems.push(...validateAgainstSchema(schema.items, item, `${at}[${index}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) problems.push(`${at}.${key}: required`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) problems.push(...validateAgainstSchema(sub, value[key], `${at}.${key}`));
    }
  }
  return problems;
}
