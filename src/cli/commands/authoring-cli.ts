import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Command } from 'commander';

import { stageExitCode, type StageResult } from '@/authoring/stages/result.js';
import { AuthoringRefusal, type AuthoringWorkspace } from '@/authoring/workspace.js';
import { parseFeatureDirName } from '@/feature-evidence/paths.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

export const USAGE_EXIT = 2;

export interface VerbOptions {
  projectRoot: string;
  session?: string;
  json?: boolean;
}

export function sessionFor(projectRoot: string, session?: string): string {
  return resolveSessionId(
    projectRoot,
    session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
  );
}

export function changeKey(projectRoot: string, session?: string): string | null {
  const dir = currentFeature(projectRoot, sessionFor(projectRoot, session));
  return dir === null ? null : (parseFeatureDirName(dir)?.ulid ?? null);
}

export function readInput(path: string, what: string): string {
  try {
    return readFileSync(resolve(path), 'utf8');
  } catch {
    throw new AuthoringRefusal(`could not read ${what} at ${path}`, 2);
  }
}

export async function runAuthoringVerb<W extends AuthoringWorkspace>(
  options: VerbOptions,
  makeWorkspace: (projectRoot: string) => W,
  enabled: (projectRoot: string) => boolean,
  offLine: string,
  action: (workspace: W, projectRoot: string) => StageResult | Promise<StageResult>,
): Promise<void> {
  const projectRoot = resolve(options.projectRoot);
  try {
    const workspace = makeWorkspace(projectRoot);
    if (!enabled(projectRoot)) {
      console.log(offLine);
      return;
    }
    const result = await action(workspace, projectRoot);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const line of result.lines) console.log(line);
    }
    process.exitCode = stageExitCode(result);
  } catch (error) {
    if (error instanceof AuthoringRefusal) {
      console.error(error.message);
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }
}

export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function withCommon(command: Command): Command {
  return command
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--session <id>', 'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID)')
    .option('--json', 'Print the result as JSON');
}

export function printResult(result: StageResult, json?: boolean): void {
  if (json) console.log(JSON.stringify(result, null, 2));
  else for (const line of result.lines) console.log(line);
  process.exitCode = stageExitCode(result);
}
