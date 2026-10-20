import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { DeliveryShell } from '@/delivery/runner.js';

export interface CommandStep {
  bin: string;
  args: string[];
}

export type CommandChainParse =
  { ok: true; steps: CommandStep[] } | { ok: false; invalidToken: string };

export interface CommandChainResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const SHELL_METACHARACTERS = /[;|`$()<>]/;

export function tokenizeCommand(input: string): string[] {
  return tokenize(input);
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let quote: '"' | "'" | null = null;

  for (const char of input) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      started = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      if (started) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

export function parseCommandChain(command: string): CommandChainParse {
  const tokens = tokenize(command);

  for (const token of tokens) {
    if (token !== '&&' && SHELL_METACHARACTERS.test(token)) {
      return { ok: false, invalidToken: token };
    }
  }

  const steps: CommandStep[] = [];
  let argv: string[] = [];
  const flush = (): void => {
    if (argv.length > 0) {
      steps.push({ bin: argv[0]!, args: argv.slice(1) });
      argv = [];
    }
  };
  for (const token of tokens) {
    if (token === '&&') flush();
    else argv.push(token);
  }
  flush();

  return { ok: true, steps };
}

function isMkdirP(step: CommandStep): boolean {
  return step.bin === 'mkdir' && step.args.length === 2 && step.args[0] === '-p';
}

export async function runCommandChain(
  shell: DeliveryShell,
  steps: readonly CommandStep[],
  cwd: string,
): Promise<CommandChainResult> {
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];
  let exitCode = 0;

  for (const step of steps) {
    if (isMkdirP(step)) {
      try {
        mkdirSync(resolve(cwd, step.args[1]!), { recursive: true });
      } catch (error) {
        stderrParts.push(error instanceof Error ? error.message : String(error));
        exitCode = 1;
        break;
      }
      continue;
    }

    const result = await shell.run(step.bin, step.args);
    if (result.stdout) stdoutParts.push(result.stdout);
    if (result.stderr) stderrParts.push(result.stderr);
    exitCode = result.exitCode;
    if (result.exitCode !== 0) break;
  }

  return {
    stdout: stdoutParts.join('\n'),
    stderr: stderrParts.join('\n'),
    exitCode,
  };
}
