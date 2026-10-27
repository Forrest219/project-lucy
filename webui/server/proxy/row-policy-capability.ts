/**
 * Lucy v0.25 (L25-14 §14.4.1) — server-side Schema Manifest catalog capability.
 *
 * Authority: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md
 *   §14.4.1 (R5 服务端能力事实源与可靠目录结构), §3.5 (R5 三分归因),
 *   §9 (V20), §14.6 (替代验收判据).
 *
 * Contract (spec §14.4.1):
 * - The capability is resolved BY THE SERVER from the actual adapter and
 *   deployment shape. A missing argument, an unresolved default or a client
 *   self-report MUST NOT be interpreted as `proven`.
 * - Only an adapter / deployment contract that explicitly supports building a
 *   catalog from the Schema Manifest may return `proven`.
 * - A missing file, a refused read or an invalid document is still
 *   「清单不可用」. Capability unknown must not be used to mask an I/O or
 *   structure fault.
 * - The SAME resolved result must be threaded through the standalone preview,
 *   the pre-save final preview and the runtime compile, and it must be part of
 *   the compile-inputs digest.
 *
 * Controlled acceptance may create an `unknown` deployment through the
 * server-side fixture (see {@link ROW_POLICY_CAPABILITY_FIXTURE_ENV}); the
 * evidence must still be taken through the Admin preview / save API, never by
 * injecting a function argument.
 */
import { readConnections } from "../project.js";

/** The deployment forms Lucy can run in. */
export const ROW_POLICY_DEPLOYMENT_LOCAL_CONTENT_ROOT = "lucy_local_content_root";

export type RowPolicyCatalogCapabilityStatus = "proven" | "unknown";

export interface RowPolicyCatalogCapability {
  status: RowPolicyCatalogCapabilityStatus;
  /** Why the capability resolved the way it did. Stable, machine-readable. */
  reason: string;
  connectionId: string;
  /** The adapter (driver / engine) the capability was resolved for. */
  driver?: string;
  engine?: string;
  /** The deployment form the capability was resolved under. */
  deploymentForm: string;
}

/**
 * The deployment shape, as resolved by the server.
 *
 * `schemaManifestCatalogSupported` is an EXPLICIT statement of the deployment
 * contract, never a default. A deployment that cannot state it resolves to
 * `unknown`.
 */
export interface RowPolicyDeployment {
  form: string;
  schemaManifestCatalogSupported: boolean;
  /** The semantic-layer root the deployment serves from. */
  semanticLayerRoot: string;
  /** Why the deployment resolved the way it did. */
  reason: string;
}

/**
 * Controlled fixture for the `unknown` capability.
 *
 * Format: `unknown` | `unknown:<connectionId>` | `proven:<connectionId>`.
 * It is a SERVER-side deployment fixture: it changes what the server resolves,
 * so the Admin preview / save API is the place where the evidence is taken.
 */
export const ROW_POLICY_CAPABILITY_FIXTURE_ENV = "LUCY_ROW_POLICY_CATALOG_CAPABILITY";

/** Drivers whose Schema Manifest contract Lucy implements. */
const CATALOG_CAPABLE_DRIVERS = new Set([
  "mysql",
  "postgres",
  "postgresql",
  "sqlserver",
  "mssql",
  "oracle",
  "sqlite",
  "athena",
  "doris",
  "apache-doris",
  "starrocks",
  "starrocks-mysql"
]);

function normalizeDriver(value: string | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function parseFixture(raw: string | undefined): { status: RowPolicyCatalogCapabilityStatus; scope: string } | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (value === "unknown") return { status: "unknown", scope: "*" };
  if (value === "proven") return { status: "proven", scope: "*" };
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const status = value.slice(0, separator);
  const scope = value.slice(separator + 1).trim();
  if (status !== "unknown" && status !== "proven") return null;
  if (!scope) return null;
  return { status, scope };
}

/**
 * Resolve the deployment shape.
 *
 * The local-content-root deployment explicitly supports Schema Manifest
 * catalogs: `acl.ts` builds the source map from
 * `<contentRoot>/semantic-layer/<connection>/_schema/*.yaml`, and the row-policy
 * catalog reads the same tree. Any other deployment form cannot state the
 * contract, so it resolves to `unknown`.
 */
export async function resolveRowPolicyDeployment(): Promise<RowPolicyDeployment> {
  const { loadContentPaths } = await import("../paths.js");
  const paths = await loadContentPaths();
  return {
    form: ROW_POLICY_DEPLOYMENT_LOCAL_CONTENT_ROOT,
    schemaManifestCatalogSupported: true,
    semanticLayerRoot: paths.semanticLayer,
    reason: "lucy_local_content_root_schema_manifest_contract"
  };
}

interface CatalogConnection {
  id: string;
  driver?: string;
  engine?: string;
}

/**
 * Resolve the catalog capability for one connection.
 *
 * The resolution order is deliberate:
 *   1. the controlled deployment fixture (server-side only),
 *   2. the deployment contract,
 *   3. the adapter (the connection must be a REGISTERED connection whose
 *      driver implements the Schema Manifest contract).
 *
 * Every unresolved case returns `unknown` with a stable reason. None of them
 * may be read as 「字段不存在」.
 */
export async function resolveSchemaManifestCatalogCapability(
  connection: CatalogConnection,
  deployment: RowPolicyDeployment
): Promise<RowPolicyCatalogCapability> {
  const connectionId = connection.id;
  const driver = normalizeDriver(connection.driver);
  const engine = connection.engine ? connection.engine.trim().toLowerCase() : undefined;

  const fixture = parseFixture(process.env[ROW_POLICY_CAPABILITY_FIXTURE_ENV]);
  if (fixture && (fixture.scope === "*" || fixture.scope === connectionId.trim().toLowerCase())) {
    return {
      status: fixture.status,
      reason: `deployment_fixture:${fixture.status}:${fixture.scope}`,
      connectionId,
      driver: driver || undefined,
      engine,
      deploymentForm: deployment.form
    };
  }

  if (deployment.schemaManifestCatalogSupported !== true) {
    return {
      status: "unknown",
      reason: `deployment_contract_not_proven:${deployment.form}`,
      connectionId,
      driver: driver || undefined,
      engine,
      deploymentForm: deployment.form
    };
  }

  if (!driver) {
    return {
      status: "unknown",
      reason: "adapter_unknown:connection_has_no_driver",
      connectionId,
      engine,
      deploymentForm: deployment.form
    };
  }

  if (!CATALOG_CAPABLE_DRIVERS.has(driver)) {
    return {
      status: "unknown",
      reason: `adapter_unknown:driver_not_supported:${driver}`,
      connectionId,
      driver,
      engine,
      deploymentForm: deployment.form
    };
  }

  return {
    status: "proven",
    reason: `schema_manifest_contract:${deployment.form}:${driver}`,
    connectionId,
    driver,
    engine,
    deploymentForm: deployment.form
  };
}

/**
 * Resolve the capability for a connection WITHOUT the caller naming it.
 *
 * The connection must be a REGISTERED connection in `ktx.yaml`: an unknown
 * connection id cannot be proven to have a Schema Manifest contract, so it
 * resolves to `unknown`.
 *
 * The result is cached per connection id: the capability is a property of the
 * deployment and the adapter registry, not of the request. The cache is what
 * lets the runtime hot path ask for the capability without re-reading
 * `ktx.yaml` on every request.
 */
const capabilityCache = new Map<string, RowPolicyCatalogCapability>();

export function resetRowPolicyCapabilityCacheForTests(): void {
  capabilityCache.clear();
}

export async function resolveCatalogCapabilityForConnection(
  connectionId: string
): Promise<RowPolicyCatalogCapability> {
  const key = connectionId.trim().toLowerCase();
  const cached = capabilityCache.get(key);
  if (cached) return cached;
  const resolved = await resolveCatalogCapabilityForConnectionUncached(connectionId);
  capabilityCache.set(key, resolved);
  return resolved;
}

async function resolveCatalogCapabilityForConnectionUncached(
  connectionId: string
): Promise<RowPolicyCatalogCapability> {
  const deployment = await resolveRowPolicyDeployment();
  let registered: CatalogConnection | undefined;
  try {
    const { resolveProjectRoot } = await import("../project.js");
    const projectRoot = await resolveProjectRoot();
    const connections = await readConnections(projectRoot);
    registered = connections.find((item) => item.id.trim().toLowerCase() === connectionId.trim().toLowerCase());
  } catch {
    registered = undefined;
  }
  if (!registered) {
    const fixture = parseFixture(process.env[ROW_POLICY_CAPABILITY_FIXTURE_ENV]);
    if (fixture && (fixture.scope === "*" || fixture.scope === connectionId.trim().toLowerCase())) {
      return {
        status: fixture.status,
        reason: `deployment_fixture:${fixture.status}:${fixture.scope}`,
        connectionId,
        deploymentForm: deployment.form
      };
    }
    // A connection that is not a REGISTERED connection of this project cannot be
    // proven to have a Schema Manifest contract.
    return {
      status: "unknown",
      reason: "connection_not_registered",
      connectionId,
      deploymentForm: deployment.form
    };
  }
  return resolveSchemaManifestCatalogCapability(
    { id: registered.id, driver: registered.driver, engine: registered.engine },
    deployment
  );
}

/**
 * The adapter-capability shape consumed by the catalog loader.
 *
 * `schemaManifestCatalogProven` is `true` ONLY when the server resolved the
 * capability to `proven`. It is never inferred from a client argument.
 */
export interface ResolvedCatalogAdapterCapabilities {
  schemaManifestCatalogProven: boolean;
  reason: string;
  status: RowPolicyCatalogCapabilityStatus;
  connectionId: string;
  deploymentForm: string;
  driver?: string;
}

export function toAdapterCapabilities(
  capability: RowPolicyCatalogCapability
): ResolvedCatalogAdapterCapabilities {
  return {
    schemaManifestCatalogProven: capability.status === "proven",
    reason: capability.reason,
    status: capability.status,
    connectionId: capability.connectionId,
    deploymentForm: capability.deploymentForm,
    driver: capability.driver
  };
}
