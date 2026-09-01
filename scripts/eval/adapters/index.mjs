import { claudeCodeAdapter } from './claude-code.mjs';
import { createGenericCliAdapter } from './generic-cli.mjs';
import { hermesAdapter } from './hermes.mjs';
import { noopAdapter } from './noop.mjs';

const PRESET_DEFAULTS = {
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    cli: 'cursor-agent',
    args: ['-p', '{question}'],
    outputFormat: 'plain',
    authMode: 'none',
  },
  openclaw: {
    id: 'openclaw',
    label: 'OpenClaw',
    cli: 'openclaw',
    args: ['agent', '-m', '{question}'],
    outputFormat: 'plain',
    authMode: 'none',
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    cli: 'codex',
    args: ['exec', '{question}'],
    outputFormat: 'plain',
    authMode: 'none',
  },
};

const CORE_ADAPTERS = [
  claudeCodeAdapter,
  hermesAdapter,
  noopAdapter,
  createGenericCliAdapter({ id: 'generic-cli', label: 'Generic CLI' }),
  createGenericCliAdapter(PRESET_DEFAULTS.cursor),
  createGenericCliAdapter(PRESET_DEFAULTS.openclaw),
  createGenericCliAdapter(PRESET_DEFAULTS.codex),
];

function aliasEntries(adapter) {
  const entries = [[adapter.id, adapter]];
  for (const alias of adapter.aliases ?? []) entries.push([alias, adapter]);
  return entries;
}

const REGISTRY = new Map(CORE_ADAPTERS.flatMap((adapter) => aliasEntries(adapter)));

export const SUPPORTED_EVAL_ADAPTERS = [...new Set(CORE_ADAPTERS.map((adapter) => adapter.id))];

export function normalizeAdapterName(name) {
  const value = String(name ?? '').trim();
  if (!value) return process.env.EVAL_AGENT_ADAPTER?.trim()
    || process.env.LUCY_EVAL_AGENT_ADAPTER?.trim()
    || 'claude-code';
  return value;
}

export function resolveAdapter(name, env = process.env) {
  const key = normalizeAdapterName(name);
  const adapter = REGISTRY.get(key);
  if (!adapter) {
    throw new Error(
      `Unknown eval agent adapter "${key}". Supported: ${SUPPORTED_EVAL_ADAPTERS.join(', ')}`
    );
  }
  if (typeof adapter.resolveConfig === 'function') {
    const config = adapter.resolveConfig(env);
    return { ...adapter, outputFormat: config.outputFormat || adapter.outputFormat };
  }
  return adapter;
}

export function listAdapters() {
  return SUPPORTED_EVAL_ADAPTERS.map((id) => {
    const adapter = REGISTRY.get(id);
    return { id, label: adapter?.label || id, outputFormat: adapter?.outputFormat || 'plain' };
  });
}

export async function preflightAdapter(name, options = {}) {
  const adapter = resolveAdapter(name, options.env);
  if (adapter.id === 'noop') return { adapter: adapter.id, skipped: true };
  const details = await adapter.preflight(options);
  return { adapter: adapter.id, ...details };
}
