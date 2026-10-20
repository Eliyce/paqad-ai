import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { LEGACY_MCP_OUTPUT_PATHS } from './config-manager.js';

export interface LegacyMcpCleanupOptions {
  canDelete?: (path: string) => boolean;
}

export interface LegacyMcpCleanupResult {
  deleted: string[];
  kept: string[];
}

const PAQAD_TOP_LEVEL_KEYS = new Set(['mcpServers', 'resolved_artifacts']);

const REAL_SERVER_KEYS = new Set([
  'command',
  'url',
  'type',
  'serverUrl',
  'args',
  'env',
  'headers',
  'transport',
]);

export function cleanupLegacyMcpFiles(
  projectRoot: string,
  options: LegacyMcpCleanupOptions = {},
): LegacyMcpCleanupResult {
  const result: LegacyMcpCleanupResult = { deleted: [], kept: [] };

  for (const path of new Set(Object.values(LEGACY_MCP_OUTPUT_PATHS))) {
    const absolute = join(projectRoot, path);
    if (!existsSync(absolute)) {
      continue;
    }

    const verdict = inspect(absolute);
    if (verdict === UNMARKED) {
      result.kept.push(path);
      continue;
    }

    const reason = verdict ?? deleteRefusal(path, options);
    if (reason) {
      result.kept.push(path);
      logKept(projectRoot, path, reason);
      continue;
    }

    try {
      rmSync(absolute);
      result.deleted.push(path);
    } catch (error) {
      result.kept.push(path);
      logKept(projectRoot, path, `delete failed: ${errorMessage(error)}`);
    }
  }

  return result;
}

const UNMARKED = Symbol('unmarked');

function inspect(absolute: string): string | typeof UNMARKED | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch {
    return UNMARKED;
  }

  if (!isRecord(parsed) || !('resolved_artifacts' in parsed)) {
    return UNMARKED;
  }

  if (!Array.isArray(parsed.resolved_artifacts)) {
    return 'resolved_artifacts is not a list';
  }

  const foreignTopLevel = Object.keys(parsed).filter((key) => !PAQAD_TOP_LEVEL_KEYS.has(key));
  if (foreignTopLevel.length > 0) {
    return `holds keys paqad never wrote: ${foreignTopLevel.join(', ')}`;
  }

  const servers = parsed.mcpServers ?? {};
  if (!isRecord(servers)) {
    return 'mcpServers is not an object';
  }

  const configured = Object.entries(servers)
    .filter(
      ([, server]) =>
        !isRecord(server) || Object.keys(server).some((key) => REAL_SERVER_KEYS.has(key)),
    )
    .map(([name]) => name);
  if (configured.length > 0) {
    return `holds configured server(s): ${configured.join(', ')}`;
  }

  return null;
}

function deleteRefusal(path: string, options: LegacyMcpCleanupOptions): string | null {
  if (!options.canDelete) {
    return null;
  }
  try {
    return options.canDelete(path)
      ? null
      : 'this command may not delete it (a tracked file); left for onboard or update';
  } catch (error) {
    return `delete check failed: ${errorMessage(error)}`;
  }
}

function logKept(projectRoot: string, path: string, reason: string): void {
  const logPath = join(projectRoot, PATHS.MCP_CLEANUP_LOG);
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${new Date().toISOString()} kept ${path}: ${reason}\n`);
  } catch (error) {
    process.stderr.write(
      `paqad: could not record MCP cleanup for ${path}: ${errorMessage(error)}\n`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
