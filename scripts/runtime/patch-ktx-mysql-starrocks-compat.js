#!/usr/bin/env node
/**
 * Patch @kaelio/ktx mysql connector: StarRocks / older MySQL-protocol engines
 * may reject SET SESSION max_execution_time (errno 1193). Skip when unsupported.
 *
 * Idempotent — safe to run on every image build.
 */
const fs = require("fs");
const path = require("path");

const MARKER = "lucy-starrocks-max-execution-compat";
const TARGET_LINE =
  "            await connection.query('SET SESSION max_execution_time = ?', [this.deadlineMs]);";
const REPLACEMENT = `            try {
                await connection.query('SET SESSION max_execution_time = ?', [this.deadlineMs]);
            }
            catch (setDeadlineError) {
                const msg = setDeadlineError && typeof setDeadlineError === 'object'
                    ? String(setDeadlineError.message ?? setDeadlineError)
                    : String(setDeadlineError);
                const errno = setDeadlineError && typeof setDeadlineError === 'object'
                    ? setDeadlineError.errno
                    : undefined;
                if (errno !== 1193 && !msg.includes('max_execution_time')) {
                    throw setDeadlineError;
                }
            } /* ${MARKER} */`;

function resolveConnectorPath() {
  const envPath = process.env.KTX_MYSQL_CONNECTOR_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = [
    "/usr/local/lib/node_modules/@kaelio/ktx/dist/connectors/mysql/connector.js",
    path.join(
      process.env.HOME || "",
      ".npm-global/lib/node_modules/@kaelio/ktx/dist/connectors/mysql/connector.js"
    )
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  try {
    const pkgJson = require.resolve("@kaelio/ktx/package.json");
    return path.join(path.dirname(pkgJson), "dist/connectors/mysql/connector.js");
  } catch {
    return null;
  }
}

function main() {
  const connectorPath = resolveConnectorPath();
  if (!connectorPath) {
    console.error("patch-ktx-mysql-starrocks-compat: connector.js not found");
    process.exit(1);
  }

  const text = fs.readFileSync(connectorPath, "utf8");
  if (text.includes(MARKER)) {
    console.log(`patch-ktx-mysql-starrocks-compat: already patched (${connectorPath})`);
    return;
  }
  if (!text.includes(TARGET_LINE)) {
    console.error(
      `patch-ktx-mysql-starrocks-compat: target line not found in ${connectorPath}`
    );
    process.exit(1);
  }

  fs.writeFileSync(connectorPath, text.replace(TARGET_LINE, REPLACEMENT, 1), "utf8");
  console.log(`patch-ktx-mysql-starrocks-compat: patched ${connectorPath}`);
}

main();
