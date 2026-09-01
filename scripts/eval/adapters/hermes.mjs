import { checkCommandExecutable, runCliCapture } from './shared.mjs';

export const hermesAdapter = {
  id: 'hermes',
  label: 'Hermes',
  outputFormat: 'plain',

  async preflight({ env = process.env, run = runCliCapture } = {}) {
    const cli = env.EVAL_AGENT_CLI?.trim() || env.HERMES_BIN?.trim() || 'hermes';
    const executable = checkCommandExecutable([cli]);
    if (!executable.ok) {
      throw new Error(`Hermes CLI not executable: ${executable.reason}${executable.error ? ` (${executable.error})` : ''}`);
    }
    const verRes = await run(cli, ['--version'], { timeoutMs: 10000, env });
    if (verRes.code !== 0) {
      throw new Error(`${cli} --version failed (code=${verRes.code}): ${(verRes.err || verRes.out).trim()}`);
    }
    return { version: (verRes.out || verRes.err).trim(), cli };
  },

  async invoke({ question, timeoutMs = 360000, env = process.env, run = runCliCapture }) {
    const cli = env.EVAL_AGENT_CLI?.trim() || env.HERMES_BIN?.trim() || 'hermes';
    const source = env.EVAL_HERMES_SOURCE?.trim() || 'lucy-eval';
    const maxTurns = env.EVAL_HERMES_MAX_TURNS?.trim() || '30';
    const args = ['chat', '-q', question, '--quiet', '--source', source, '--max-turns', maxTurns];
    const res = await run(cli, args, { timeoutMs, env });
    return { ...res, args: [cli, ...args] };
  },
};
