#!/usr/bin/env node
import { preflightAdapter, resolveAdapter, listAdapters } from './adapters/index.mjs';

const USAGE = `Usage: node scripts/eval/preflight-agent.mjs [--adapter <name>]

Checks whether the configured eval agent adapter is ready.
`;

function parseArgs(argv) {
  let adapter = process.env.EVAL_AGENT_ADAPTER || process.env.LUCY_EVAL_AGENT_ADAPTER || 'claude-code';
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true, adapter };
    if (arg === '--adapter') adapter = argv[++i];
    else throw new Error(`unknown arg: ${arg}`);
  }
  return { adapter };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(USAGE);
    process.stdout.write(`Supported adapters: ${listAdapters().map((item) => item.id).join(', ')}\n`);
    return;
  }
  const adapter = resolveAdapter(args.adapter);
  if (adapter.id === 'noop') {
    process.stdout.write('noop adapter: preflight skipped\n');
    return;
  }
  const result = await preflightAdapter(args.adapter);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exit(1);
});
