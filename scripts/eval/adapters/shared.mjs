import { accessSync } from 'node:fs';
import { spawn } from 'node:child_process';

export function runCliCapture(cmd, args, { timeoutMs = 360000, cwd, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ code: 124, out, err: `${err}\ntimeout after ${timeoutMs}ms`, timedOut: true });
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.stderr.on('data', (chunk) => { err += chunk.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

export function renderCommandParts(parts, replacements) {
  return parts.map((part) => part
    .replaceAll('{question}', replacements.question ?? '')
    .replaceAll('{prompt}', replacements.question ?? '')
    .replaceAll('{mcp_config}', replacements.mcpConfig ?? '')
    .replaceAll('{mcpConfig}', replacements.mcpConfig ?? '')
    .replaceAll('{profile}', replacements.profile ?? '')
    .replaceAll('{case_id}', replacements.caseId ?? '')
    .replaceAll('{caseId}', replacements.caseId ?? ''));
}

export function checkCommandExecutable(command) {
  const binary = command[0];
  if (!binary) return { ok: false, reason: 'empty_command' };
  if (binary.includes('/')) {
    try {
      accessSync(binary);
      return { ok: true, binary };
    } catch (error) {
      return { ok: false, reason: 'binary_not_accessible', binary, error: error.message };
    }
  }
  return { ok: true, binary, reason: 'path_lookup_deferred' };
}

export function parseArgsJsonEnv(value, label) {
  if (!value || !String(value).trim()) return null;
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed) || parsed.some((part) => typeof part !== 'string')) {
      throw new Error(`${label} must be a JSON string array`);
    }
    return parsed;
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error.message}`);
  }
}

export function authLooksReady(text) {
  return /loggedIn|apiProvider|authenticated|logged in|active/i.test(String(text ?? ''));
}
