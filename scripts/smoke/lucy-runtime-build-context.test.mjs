import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('Docker excludes ignored runtime state at every depth while keeping customer templates', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'lucy-runtime-context-'));
  const context = path.join(temp, 'context');
  const output = path.join(temp, 'output');
  const denied = [
    '.ktx/secrets/password',
    '.ktx-ui/security.sqlite-wal',
    'examples/docker-demo/project-template/.ktx-ui/audit.sqlite',
    'examples/docker-demo/project-template/.ktx-ui/audit.sqlite-wal',
    'webui/:memory:/.ktx-ui/security.sqlite',
    '.mcp.json',
    'nested/.env.local',
    'nested/.env.production.local',
    'webui/config/access.yaml',
    'webui/config/admins.yaml'
  ];
  const kept = ['customer-config.example/ktx.yaml', 'webui/config/access.yaml.example', 'scripts/runtime/docker-entrypoint.sh'];
  try {
    await mkdir(context);
    await writeFile(path.join(context, '.dockerignore'), await readFile(path.join(root, '.dockerignore')));
    await writeFile(path.join(context, 'Dockerfile'), 'FROM scratch\nCOPY . /context/\n');
    for (const name of [...denied, ...kept]) {
      await mkdir(path.dirname(path.join(context, name)), { recursive: true });
      await writeFile(path.join(context, name), 'synthetic-fixture-only\n');
    }
    const result = spawnSync('docker', ['build', '--quiet', '--output', `type=local,dest=${output}`, context], {
      encoding: 'utf8', timeout: 120000
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const name of denied) await assert.rejects(access(path.join(output, 'context', name)), { code: 'ENOENT' }, name);
    for (const name of kept) assert.equal(await readFile(path.join(output, 'context', name), 'utf8'), 'synthetic-fixture-only\n');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
