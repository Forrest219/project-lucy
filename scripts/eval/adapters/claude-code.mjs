import { authLooksReady, runCliCapture } from './shared.mjs';

export const claudeCodeAdapter = {
  id: 'claude-code',
  label: 'Claude Code',
  outputFormat: 'stream-json',
  aliases: ['claude_code'],

  async preflight({ env = process.env, run = runCliCapture } = {}) {
    const cli = env.EVAL_AGENT_CLI?.trim() || 'claude';
    const verRes = await run(cli, ['--version'], { timeoutMs: 10000, env });
    if (verRes.code !== 0) {
      throw new Error(`${cli} --version failed (code=${verRes.code}): ${verRes.err.trim()}`);
    }
    const authRes = await run(cli, ['auth', 'status'], { timeoutMs: 15000, env });
    if (authRes.code !== 0) {
      throw new Error(
        `${cli} auth status failed (code=${authRes.code}). Please run \`${cli} login\` first. stderr: ${authRes.err.trim()}`
      );
    }
    if (!authLooksReady(`${authRes.out}\n${authRes.err}`) && !/loggedIn|apiProvider/.test(authRes.out)) {
      throw new Error(`${cli} auth status returned unexpected output: ${authRes.out.slice(0, 200)}`);
    }
    return { version: verRes.out.trim(), auth: authRes.out.trim(), cli };
  },

  async invoke({ question, mcpConfigPath, timeoutMs = 360000, env = process.env, run = runCliCapture }) {
    const cli = env.EVAL_AGENT_CLI?.trim() || 'claude';
    const args = [
      '-p',
      question,
      '--output-format',
      'stream-json',
      '--verbose',
      '--mcp-config',
      mcpConfigPath,
      '--strict-mcp-config',
      '--permission-mode',
      'bypassPermissions',
    ];
    const res = await run(cli, args, { timeoutMs, env });
    return { ...res, args: [cli, ...args] };
  },
};
