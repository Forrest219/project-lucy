/** Helpers for docs/qa/real-e2e-clients.yaml (Spec R4/R7). */

export function isAutomatedRequired(client) {
  return client?.required === true && (client.execution ?? "automated") === "automated";
}

export function isManualRequired(client) {
  return client?.required === true && client.execution === "manual";
}

export function automatedRequiredClients(clients = []) {
  return clients.filter(isAutomatedRequired);
}

export function manualRequiredClients(clients = []) {
  return clients.filter(isManualRequired);
}

/** Distinct product families among automated required clients (Hermes-a / Hermes-b count once). */
export function countDistinctAutomatedProducts(clients = []) {
  return new Set(
    automatedRequiredClients(clients).map((c) => String(c.product).split(/[-_:]/)[0].toLowerCase())
  ).size;
}
