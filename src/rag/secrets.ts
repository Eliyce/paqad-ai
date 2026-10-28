import {
  chmodSync,
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { isMissingFileError } from '@/core/fs/read-if-exists.js';

function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key) {
      result[key] = value;
    }
  }
  return result;
}

function serializeEnv(values: Record<string, string>): string {
  const lines = ['# Local project secrets for paqad-ai RAG'];
  for (const key of Object.keys(values).sort()) {
    lines.push(`${key}=${values[key]}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function readProjectSecrets(projectRoot: string): Record<string, string> {
  const path = join(projectRoot, PATHS.SECRETS_ENV);
  if (!existsSync(path)) {
    return {};
  }

  try {
    return parseEnv(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

export function pluginOptionOrEnv(key: string): string | undefined {
  return process.env[`CLAUDE_PLUGIN_OPTION_${key}`] || process.env[key] || undefined;
}

export function getProjectSecret(projectRoot: string, key: string): string | undefined {
  return pluginOptionOrEnv(key) || readProjectSecrets(projectRoot)[key];
}

export function writeProjectSecret(projectRoot: string, key: string, value: string): string {
  const path = join(projectRoot, PATHS.SECRETS_ENV);
  const current = readProjectSecrets(projectRoot);
  current[key] = value;

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeEnv(current), 'utf8');

  try {
    chmodSync(path, 0o600);
  } catch {}

  return path;
}

export function removeProjectSecrets(projectRoot: string): void {
  const path = join(projectRoot, PATHS.SECRETS_ENV);
  let fd: number;
  try {
    fd = openSync(path, 'r+');
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }
  try {
    ftruncateSync(fd, 0);
    writeSync(fd, '# Local project secrets for paqad-ai RAG\n', 0, 'utf8');
  } finally {
    closeSync(fd);
  }
}

export function getSecretPermissionWarning(projectRoot: string): string | null {
  const path = join(projectRoot, PATHS.SECRETS_ENV);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const mode = statSync(path).mode & 0o777;
    return mode & 0o077 ? `Secrets file is too permissive (${mode.toString(8)})` : null;
  } catch {
    return null;
  }
}

export function redactSecrets(input: string, projectRoot: string): string {
  const secrets = [
    process.env.OPENAI_API_KEY,
    ...Object.values(readProjectSecrets(projectRoot)),
  ].filter((value): value is string => Boolean(value));
  let result = input;
  for (const secret of secrets) {
    result = result.split(secret).join('[REDACTED]');
  }
  return result;
}
