import { authLooksReady, checkCommandExecutable, parseArgsJsonEnv, renderCommandParts, runCliCapture } from './shared.mjs';

function readGenericConfig(env = process.env, defaults = {}) {
  const cli = env.EVAL_AGENT_CLI?.trim() || defaults.cli;
  if (!cli) {
    throw new Error('generic-cli adapter requires EVAL_AGENT_CLI or a preset default CLI');
  }
  const args = parseArgsJsonEnv(env.EVAL_AGENT_ARGS, 'EVAL_AGENT_ARGS')
    ?? defaults.args
    ?? ['-p', '{question}'];
  const outputFormat = env.EVAL_AGENT_OUTPUT_FORMAT?.trim() || defaults.outputFormat || 'plain';
  const usesMcpConfig = args.some((part) => part.includes('{mcp_config}') || part.includes('{mcpConfig}'));
  const authMode = env.EVAL_AGENT_AUTH_MODE?.trim() || defaults.authMode || (usesMcpConfig ? 'claude-auth' : 'none');
  return { cli, args, outputFormat, authMode };
}

export function createGenericCliAdapter(defaults = {}) {
  const adapterId = defaults.id || 'generic-cli';
  return {
    id: adapterId,
    label: defaults.label || 'Generic CLI',
    outputFormat: defaults.outputFormat || 'plain',

    resolveConfig(env = process.env) {
      return readGenericConfig(env, defaults);
    },

    async preflight({ env = process.env, run = runCliCapture } = {}) {
      const config = readGenericConfig(env, defaults);
      const executable = checkCommandExecutable([config.cli]);
      if (!executable.ok) {
        throw new Error(`${config.cli} not executable: ${executable.reason}${executable.error ? ` (${executable.error})` : ''}`);
      }
      const verRes = await run(config.cli, ['--version'], { timeoutMs: 10000, env });
      if (verRes.code !== 0 && verRes.code !== 124) {
        // Some CLIs do not implement --version; continue to optional auth probe.
      }
      if (config.authMode === 'claude-auth') {
        const authRes = await run(config.cli, ['auth', 'status'], { timeoutMs: 15000, env });
        if (authRes.code !== 0 || !authLooksReady(`${authRes.out}\n${authRes.err}`)) {
          throw new Error(`${config.cli} auth status failed. Configure credentials or choose another adapter.`);
        }
      }
      return { cli: config.cli, outputFormat: config.outputFormat };
    },

    async invoke({ question, mcpConfigPath, timeoutMs = 360000, env = process.env, run = runCliCapture, caseId = '' }) {
      const config = readGenericConfig(env, defaults);
      const argv = renderCommandParts(config.args, {
        question,
        mcpConfig: mcpConfigPath,
        profile: adapterId,
        caseId,
      });
      const res = await run(config.cli, argv, { timeoutMs, env });
      return { ...res, args: [config.cli, ...argv], outputFormat: config.outputFormat };
    },
  };
}

export const genericCliAdapter = createGenericCliAdapter({
  id: 'generic-cli',
  label: 'Generic CLI',
});
