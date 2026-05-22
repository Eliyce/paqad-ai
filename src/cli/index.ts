#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { createProgram, normalizeCliArgv } from './program.js';

export function getCliBanner(): string {
  return 'paqad-ai';
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  const normalized = normalizeCliArgv(program, argv);

  for (const notice of normalized.notices) {
    process.stderr.write(`${notice}\n`);
  }

  await program.parseAsync(normalized.argv);
}

export function shouldRunFromCommandLine(
  importMetaUrl: string,
  argvEntry: string | undefined,
): boolean {
  const entrypoint = argvToEntrypoint(argvEntry);

  return entrypoint !== undefined && importMetaUrl === entrypoint;
}

/* v8 ignore next 3 - covered via packaged CLI/e2e entrypoint tests rather than module import */
if (shouldRunFromCommandLine(import.meta.url, process.argv[1])) {
  await runCli();
}

export function argvToEntrypoint(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    return pathToFileURL(realpathSync(value)).href;
  } catch {
    return pathToFileURL(value).href;
  }
}
