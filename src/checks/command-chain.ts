// Correct execution of a mapped command (issue #554, Part A). The old runner split a command
// on whitespace and spawned the first token, so a profile command of the form
// `mkdir -p .paqad/test-results && ./vendor/bin/pest --log-junit …` spawned `mkdir` with `&&`,
// `./vendor/bin/pest` and `--log-junit` as directory names and reported green without running a
// test. This module runs the command as an ordered chain of argv steps split on the standalone
// `&&` token, with a quote-aware tokenizer and NO shell interpretation: `&&` is the only operator
// and every other shell metacharacter is rejected before anything is spawned (INV-7).

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { DeliveryShell } from '@/delivery/runner.js';

/** One argv step of a command chain: a bin and its already-split arguments. */
export interface CommandStep {
  bin: string;
  args: string[];
}

/** The result of parsing a mapped command string into argv steps. */
export type CommandChainParse =
  | { ok: true; steps: CommandStep[] }
  | { ok: false; invalidToken: string };

/** The combined outcome of running a chain: concatenated output and the deciding exit code. */
export interface CommandChainResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Shell metacharacters we refuse to interpret. `&` is deliberately absent — `&&` is the operator. */
const SHELL_METACHARACTERS = /[;|`$()<>]/;

/**
 * Tokenize a command string into argv tokens, quote-aware and nothing more. Whitespace outside
 * quotes separates tokens; a `"…"` or `'…'` run keeps its inner whitespace and the quote marks
 * are dropped, so `--filter="Foo Bar"` becomes the single argv `--filter=Foo Bar`. There is no
 * escaping, variable expansion, or globbing — this is not a shell.
 */
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

/**
 * Parse a mapped command into ordered argv steps. Splits on the standalone `&&` token; rejects
 * any token carrying a shell metacharacter (naming the offender so the caller can report it red).
 * A blank command yields `{ ok: true, steps: [] }` — the caller skips it rather than spawn nothing.
 */
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

/** True when a step is exactly `mkdir -p <dir>` — run in-process so it is portable (Windows too). */
function isMkdirP(step: CommandStep): boolean {
  return step.bin === 'mkdir' && step.args.length === 2 && step.args[0] === '-p';
}

/**
 * Run parsed argv steps in order through the injected shell. `mkdir -p <dir>` runs in-process via
 * `mkdirSync(dir, { recursive: true })` (resolved against `cwd`) rather than spawning, so the
 * onboarding-generated prefix works on every platform. Each step's stdout and stderr are
 * concatenated in order; the first non-zero exit stops the chain and is the chain's exit code.
 */
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
