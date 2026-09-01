#!/usr/bin/env node
/** P2-2: verify ktx mysql connector includes StarRocks max_execution_time compat patch. */
const fs = require("fs");
const path = require("path");

const MARKER = "lucy-starrocks-max-execution-compat";

function resolveConnectorPath() {
  const envPath = process.env.KTX_MYSQL_CONNECTOR_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  try {
    const pkgJson = require.resolve("@kaelio/ktx/package.json");
    return path.join(path.dirname(pkgJson), "dist/connectors/mysql/connector.js");
  } catch {
    return "/usr/local/lib/node_modules/@kaelio/ktx/dist/connectors/mysql/connector.js";
  }
}

const connectorPath = resolveConnectorPath();
if (!fs.existsSync(connectorPath)) {
  console.error(`verify-ktx-starrocks-patch: missing ${connectorPath}`);
  process.exit(1);
}

const text = fs.readFileSync(connectorPath, "utf8");
if (!text.includes(MARKER)) {
  console.error("verify-ktx-starrocks-patch: patch marker not found — run patch-ktx-mysql-starrocks-compat.js");
  process.exit(1);
}

console.log(`verify-ktx-starrocks-patch: ok (${connectorPath})`);
