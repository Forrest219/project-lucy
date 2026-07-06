#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const root = process.cwd();
const args = process.argv.slice(2);
const configRootArg = valueFor("--root") ?? "customer-config.example";
const configRoot = path.resolve(root, configRootArg);
const requireSecretFiles = args.includes("--require-secret-files");
const results = [];

function valueFor(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function rel(absPath) {
  return path.relative(root, absPath).replaceAll(path.sep, "/");
}

function add(status, check, message) {
  results.push({ status, check, message });
}

function fail(check, message) {
  add("fail", check, message);
}

function pass(check, message) {
  add("pass", check, message);
}

function exists(...parts) {
  return existsSync(path.join(configRoot, ...parts));
}

function read(...parts) {
  return readFileSync(path.join(configRoot, ...parts), "utf8");
}

function readYaml(check, ...parts) {
  const file = path.join(configRoot, ...parts);
  try {
    return parse(readFileSync(file, "utf8")) ?? {};
  } catch (error) {
    fail(check, `${rel(file)} is not valid YAML: ${error.message}`);
    return undefined;
  }
}

function walk(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, predicate, out);
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

function textFilesOutsideSecrets() {
  return walk(configRoot, (file) => {
    const relPath = rel(file);
    if (relPath.includes("/.ktx/secrets/")) return false;
    return /\.(ya?ml|md|txt|json|gitignore)$/i.test(file) || path.basename(file) === "README.md";
  });
}

function hasChangeMe() {
  const offenders = [];
  for (const file of textFilesOutsideSecrets()) {
    const text = readFileSync(file, "utf8");
    if (/CHANGE-ME|<CHANGE-ME/i.test(text)) offenders.push(rel(file));
  }
  if (offenders.length) {
    fail("no-change-me", `headless config contains CHANGE-ME placeholders: ${offenders.join(", ")}`);
  } else {
    pass("no-change-me", "headless config contains no CHANGE-ME placeholders outside secret files");
  }
}

function requiredLayout() {
  const required = [
    "ktx.yaml",
    "semantic-layer",
    "wiki",
    "evals",
    "skills",
    "webui/config/access.yaml",
    ".ktx/secrets",
    ".ktx-ui"
  ];
  const missing = required.filter((item) => !exists(...item.split("/")));
  if (missing.length) {
    fail("layout", `${rel(configRoot)} is missing: ${missing.join(", ")}`);
  } else {
    pass("layout", `${rel(configRoot)} has the required /data/lucy headless layout`);
  }
}

function checkKtxYaml() {
  const check = "ktx-yaml";
  if (!exists("ktx.yaml")) {
    fail(check, `${rel(path.join(configRoot, "ktx.yaml"))} is missing`);
    return;
  }
  const doc = readYaml(check, "ktx.yaml");
  if (!doc) return;
  const connections = doc.connections && typeof doc.connections === "object" ? doc.connections : {};
  const entries = Object.entries(connections);
  if (entries.length === 0) {
    fail(check, "ktx.yaml must define at least one connection");
    return;
  }
  let failed = false;
  for (const [id, connection] of entries) {
    const password = connection?.password;
    if (typeof password !== "string") {
      fail(check, `connection ${id} must use password: file:/... instead of an inline or missing password`);
      failed = true;
      continue;
    }
    if (!password.startsWith("file:")) {
      fail(check, `connection ${id} password must use file: secret reference`);
      failed = true;
    }
    if (/CHANGE-ME/i.test(password)) {
      fail(check, `connection ${id} password contains CHANGE-ME placeholder`);
      failed = true;
    }
    if (requireSecretFiles) {
      const secretPath = password.slice("file:".length);
      const hostPath = secretPath.startsWith("/data/lucy/")
        ? path.join(configRoot, secretPath.slice("/data/lucy/".length))
        : path.resolve(configRoot, secretPath);
      if (!existsSync(hostPath)) {
        fail(check, `connection ${id} references missing secret file ${secretPath}`);
        failed = true;
      }
    }
  }
  if (!failed) {
    pass(check, `${entries.length} connection(s) use file: secret references`);
  }
}

function checkSemanticLayer() {
  const check = "semantic-layer";
  const dir = path.join(configRoot, "semantic-layer");
  const yamlFiles = walk(dir, (file) => /\.ya?ml$/i.test(file));
  const overlayFiles = yamlFiles.filter((file) => !rel(file).includes("/_schema/"));
  const schemaFiles = yamlFiles.filter((file) => rel(file).includes("/_schema/"));
  if (yamlFiles.length === 0 || overlayFiles.length === 0 || schemaFiles.length === 0) {
    fail(check, "semantic-layer must include at least one _schema YAML and one overlay YAML");
    return;
  }
  for (const file of yamlFiles) {
    try {
      parse(readFileSync(file, "utf8"));
    } catch (error) {
      fail(check, `${rel(file)} is not valid YAML: ${error.message}`);
      return;
    }
  }
  pass(check, `${schemaFiles.length} schema YAML and ${overlayFiles.length} overlay YAML file(s) are parseable`);
}

function checkWikiAndEvals() {
  const wikiFiles = walk(path.join(configRoot, "wiki"), (file) => file.endsWith(".md"));
  if (wikiFiles.length === 0) {
    fail("wiki", "wiki must include at least one Markdown context document");
  } else {
    for (const file of wikiFiles) {
      const text = readFileSync(file, "utf8");
      const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatter) {
        fail("wiki", `${rel(file)} must include YAML frontmatter with title and summary`);
        return;
      }
      let metadata;
      try {
        metadata = parse(frontmatter[1]) ?? {};
      } catch (error) {
        fail("wiki", `${rel(file)} has invalid YAML frontmatter: ${error.message}`);
        return;
      }
      if (!metadata.title || !metadata.summary) {
        fail("wiki", `${rel(file)} must include frontmatter title and summary for KTX reindex`);
        return;
      }
    }
    pass("wiki", `${wikiFiles.length} wiki Markdown file(s) are present`);
  }

  const evalFiles = walk(path.join(configRoot, "evals"), (file) => file.endsWith("-eval-cases.yaml"));
  if (evalFiles.length === 0) {
    fail("evals", "evals must include at least one *-eval-cases.yaml file");
    return;
  }
  for (const file of evalFiles) {
    try {
      const doc = parse(readFileSync(file, "utf8")) ?? {};
      if (!Array.isArray(doc.cases) || doc.cases.length === 0) {
        fail("evals", `${rel(file)} has no cases`);
        return;
      }
    } catch (error) {
      fail("evals", `${rel(file)} is not valid YAML: ${error.message}`);
      return;
    }
  }
  pass("evals", `${evalFiles.length} eval case file(s) are parseable`);
}

function checkAccessYaml() {
  const check = "access-yaml";
  if (!exists("webui", "config", "access.yaml")) {
    fail(check, "webui/config/access.yaml is missing");
    return;
  }
  const doc = readYaml(check, "webui", "config", "access.yaml");
  if (!doc) return;
  const roles = doc.roles && typeof doc.roles === "object" ? doc.roles : {};
  const users = Array.isArray(doc.users) ? doc.users : [];
  if (Object.keys(roles).length === 0 || users.length === 0) {
    fail(check, "access.yaml must define at least one role and one user");
    return;
  }
  let failed = false;
  for (const user of users) {
    for (const token of Array.isArray(user?.tokens) ? user.tokens : []) {
      if (token.value || token.token || token.plaintext) {
        fail(check, `user ${user.id ?? "<missing>"} contains plaintext token material`);
        failed = true;
      }
      if (typeof token.hash !== "string" || !token.hash.startsWith("sha256:")) {
        fail(check, `user ${user.id ?? "<missing>"} token must contain only sha256: hash`);
        failed = true;
      }
    }
    if (user.role && !roles[user.role]) {
      fail(check, `user ${user.id ?? "<missing>"} references missing role ${user.role}`);
      failed = true;
    }
  }
  if (!failed) {
    pass(check, `${users.length} user(s) reference roles and token hashes only`);
  }
}

function checkComposeOverride() {
  const check = "compose-override";
  const file = path.join(root, "docker-compose.customer-config.yml");
  if (!existsSync(file)) {
    fail(check, "docker-compose.customer-config.yml is missing");
    return;
  }
  const text = readFileSync(file, "utf8");
  if (!text.includes("./customer-config:/data/lucy")) {
    fail(check, "docker-compose.customer-config.yml must bind ./customer-config to /data/lucy");
    return;
  }
  pass(check, "docker-compose.customer-config.yml binds ./customer-config to /data/lucy");
}

if (!existsSync(configRoot)) {
  fail("root", `${configRootArg} does not exist`);
} else {
  pass("root", `checking ${rel(configRoot)}`);
  requiredLayout();
  hasChangeMe();
  checkKtxYaml();
  checkSemanticLayer();
  checkWikiAndEvals();
  checkAccessYaml();
  checkComposeOverride();
}

let failed = false;
for (const result of results) {
  if (result.status === "fail") failed = true;
  console.log(`[headless-config] ${result.status.toUpperCase()} ${result.check}`);
  console.log(`  ${result.message}`);
}

process.exit(failed ? 1 : 0);
