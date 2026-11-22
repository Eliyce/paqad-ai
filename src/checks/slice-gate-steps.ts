import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { execa } from 'execa';

import { tokenizeCommand } from '@/checks/command-chain.js';
import { FILES_TOKEN } from '@/checks/constants.js';
import { filterFormattableFiles, resolveFormatCommand } from '@/checks/format-changed.js';
import { SLICE_GATE_TEST_WORKERS, type SliceGateStep } from '@/checks/slice-gate.js';
import { readProjectProfile } from '@/core/project-profile.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';

export type SliceGateStepName = 'format' | 'lint' | 'typecheck' | 'rules' | 'tests';

export interface SliceCommandOutcome {
  exitCode: number;
  output: string;
  timedOut: boolean;
}

export type SliceCommandRunner = (
  bin: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<SliceCommandOutcome>;

export interface DefaultSliceGateStepsOptions {
  projectRoot: string;
  deadlineMs: number;
  nowMs?: () => number;
  run?: SliceCommandRunner;
  profile?: ProjectProfile | null;
}

const PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn']);
const PM_BUILTINS = new Set(['exec', 'dlx', 'install', 'add', 'x']);
const CHAIN_TOKEN = /^(?:&&|\|\||\||;)$/;
const TEST_PATTERN_TOKENS = ['<pattern>', '<path_or_file>'];
const WORKER_CAPPED_RUNNERS = /\b(?:vitest|jest)\b/;
const FILE_LOCATION = /([^\s:()'"]+\.[A-Za-z0-9]+)(?:\(\d+,\d+\)|:\d+)/g;

const STRIPPED_ENV = ['SE_AGENT_ID', 'SE_SESSION', 'SE_WORKSTREAM'];

function defaultRunner(projectRoot: string): SliceCommandRunner {
  return async (bin, args, timeoutMs) => {
    const env = { ...process.env };
    for (const name of STRIPPED_ENV) delete env[name];
    try {
      const result = await execa(bin, [...args], {
        cwd: projectRoot,
        env,
        extendEnv: false,
        reject: false,
        all: true,
        timeout: Math.max(1, timeoutMs),
        forceKillAfterDelay: 2_000,
      });
      return {
        exitCode: typeof result.exitCode === 'number' ? result.exitCode : 1,
        output: result.all,
        timedOut: result.timedOut === true,
      };
    } catch (error) {
      return { exitCode: 1, output: (error as Error).message, timedOut: false };
    }
  };
}

function packageScripts(projectRoot: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, unknown>;
    };
    return Object.fromEntries(
      Object.entries(pkg.scripts ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

interface ScriptCall {
  pm: string;
  name: string;
  text: string;
  extra: string[];
}

function scriptCall(projectRoot: string, tokens: readonly string[]): ScriptCall | null {
  const pm = tokens[0];
  if (!pm || !PACKAGE_MANAGERS.has(pm)) return null;
  const runIndex = tokens[1] === 'run' || tokens[1] === 'run-script' ? 2 : 1;
  const name = tokens[runIndex];
  if (!name || PM_BUILTINS.has(name)) return null;
  const text = packageScripts(projectRoot)[name];
  if (text === undefined) return null;
  const rest = tokens.slice(runIndex + 1);
  return { pm, name, text, extra: rest[0] === '--' ? rest.slice(1) : rest };
}

function execArgv(pm: string, tokens: readonly string[]): string[] {
  if (pm === 'npm') return ['npm', 'exec', '--', ...tokens];
  if (pm === 'yarn') return ['yarn', ...tokens];
  return [pm, 'exec', ...tokens];
}

function singleCommand(tokens: readonly string[]): boolean {
  return tokens.length > 0 && !tokens.some((token) => CHAIN_TOKEN.test(token));
}

export function scopeCommandToFiles(
  projectRoot: string,
  command: string,
  files: readonly string[],
): string[] | null {
  const tokens = tokenizeCommand(command);
  if (!singleCommand(tokens) || files.length === 0) return null;
  if (tokens.includes(FILES_TOKEN)) {
    return tokens.flatMap((token) => (token === FILES_TOKEN ? [...files] : [token]));
  }
  if (tokens[tokens.length - 1] === '.') return [...tokens.slice(0, -1), ...files];
  const call = scriptCall(projectRoot, tokens);
  if (call === null) return null;
  const script = tokenizeCommand(call.text);
  if (!singleCommand(script) || script[script.length - 1] !== '.') return null;
  return execArgv(call.pm, [...script.slice(0, -1), ...call.extra, ...files]);
}

export function sliceTestArgv(
  projectRoot: string,
  profile: Pick<ProjectProfile, 'commands'>,
  testFiles: readonly string[],
): string[] | null {
  if (testFiles.length === 0) return null;
  const single = profile.commands.test_single?.trim() ?? '';
  const template = TEST_PATTERN_TOKENS.some((token) => single.includes(token))
    ? single
    : (profile.commands.test?.trim() ?? '');
  const tokens = tokenizeCommand(template);
  if (!singleCommand(tokens)) return null;
  const withFiles = TEST_PATTERN_TOKENS.some((token) => tokens.includes(token))
    ? tokens.flatMap((token) => (TEST_PATTERN_TOKENS.includes(token) ? [...testFiles] : [token]))
    : [...tokens, ...testFiles];
  const runnerText = `${template} ${scriptCall(projectRoot, tokens)?.text ?? ''}`;
  return WORKER_CAPPED_RUNNERS.test(runnerText)
    ? [...withFiles, `--maxWorkers=${SLICE_GATE_TEST_WORKERS}`]
    : withFiles;
}

function typecheckCommand(projectRoot: string, profile: ProjectProfile): string | null {
  const commands = profile.commands as unknown as Record<string, unknown>;
  const mapped = commands.typecheck;
  if (typeof mapped === 'string' && mapped.trim().length > 0) return mapped.trim();
  if (packageScripts(projectRoot).typecheck === undefined) return null;
  const pm = tokenizeCommand(profile.commands.test ?? '')[0];
  return `${pm && PACKAGE_MANAGERS.has(pm) ? pm : 'npm'} run typecheck`;
}

function tail(output: string, lines = 5): string {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-lines)
    .join(' | ');
}

export function ownedTypeErrors(output: string, files: readonly string[]): string[] | null {
  const owned = new Set(files);
  const lines = output.split('\n');
  let located = false;
  const errors: string[] = [];
  for (const line of lines) {
    FILE_LOCATION.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FILE_LOCATION.exec(line)) !== null) {
      located = true;
      const file = match[1]!.replace(/^\.\//, '');
      if (owned.has(file)) {
        errors.push(line.trim());
        break;
      }
    }
  }
  return located ? errors : null;
}

export function defaultSliceGateSteps(
  options: DefaultSliceGateStepsOptions,
): Record<SliceGateStepName, SliceGateStep> {
  const { projectRoot } = options;
  const nowMs = options.nowMs ?? Date.now;
  const run = options.run ?? defaultRunner(projectRoot);
  const profile =
    options.profile === undefined
      ? readProjectProfile(projectRoot, { persistMigration: false })
      : options.profile;
  const remaining = () => options.deadlineMs - nowMs();
  const present = (files: readonly string[]) =>
    files.filter((file) => existsSync(join(projectRoot, file)));

  const runArgv = async (argv: readonly string[]): Promise<SliceCommandOutcome> => {
    const outcome = await run(argv[0]!, argv.slice(1), remaining());
    return outcome.timedOut
      ? { ...outcome, exitCode: outcome.exitCode === 0 ? 1 : outcome.exitCode }
      : outcome;
  };
  const failureOf = (step: string, argv: readonly string[], outcome: SliceCommandOutcome) =>
    outcome.timedOut
      ? `${step}: \`${argv.join(' ')}\` was stopped at the slice gate time limit`
      : `${step}: \`${argv.join(' ')}\` exited ${outcome.exitCode}: ${tail(outcome.output)}`;

  const format: SliceGateStep = async (files) => {
    const command = profile?.commands.format?.trim();
    if (!command) return [];
    const formattable = filterFormattableFiles(projectRoot, present(files));
    if (formattable.length === 0) return [];
    let argv: string[] | null = null;
    if (profile?.stack_profile) {
      const resolved = await resolveFormatCommand({
        projectRoot,
        frameworks: profile.stack_profile.frameworks,
        formatCommand: command,
        changedFiles: formattable,
      });
      if (resolved.scope === 'changed') {
        argv = scopeCommandToFiles(
          projectRoot,
          resolved.command,
          formattable.map((file) => `./${file}`),
        );
      }
    }
    argv ??= scopeCommandToFiles(projectRoot, command, formattable);
    if (argv === null) return [];
    const outcome = await runArgv(argv);
    return outcome.exitCode === 0 ? [] : [failureOf('format', argv, outcome)];
  };

  const lint: SliceGateStep = async (files) => {
    const command = profile?.commands.lint?.trim();
    const owned = present(files);
    if (!command || owned.length === 0) return [];
    const argv = scopeCommandToFiles(projectRoot, command, owned);
    if (argv === null) return [];
    const outcome = await runArgv(argv);
    return outcome.exitCode === 0 ? [] : [failureOf('lint', argv, outcome)];
  };

  const typecheck: SliceGateStep = async (files) => {
    if (profile === null || present(files).length === 0) return [];
    const command = typecheckCommand(projectRoot, profile);
    if (command === null) return [];
    const argv = tokenizeCommand(command);
    if (!singleCommand(argv)) return [];
    const outcome = await runArgv(argv);
    if (outcome.exitCode === 0) return [];
    if (outcome.timedOut) return [failureOf('typecheck', argv, outcome)];
    const owned = ownedTypeErrors(outcome.output, files);
    if (owned === null) return [failureOf('typecheck', argv, outcome)];
    return owned.slice(0, 20).map((line) => `typecheck: ${line}`);
  };

  const rules: SliceGateStep = async (files) => {
    if (files.length === 0) return [];
    const [{ enforceRuleScripts }, { resolveRuleComplianceMode }] = await Promise.all([
      import('@/rule-scripts/enforce.js'),
      import('@/kernel/capability.js'),
    ]);
    const result = await enforceRuleScripts({
      projectRoot,
      mode: resolveRuleComplianceMode(projectRoot),
      scope: 'changed-files',
      changedFiles: [...files],
    });
    if (!result.blocking) return [];
    return result.violations.map(
      (v) => `rules: ${v.rule_id} ${v.file}${v.line ? `:${v.line}` : ''} ${v.message}`,
    );
  };

  const tests: SliceGateStep = async (_files, testFiles) => {
    if (profile === null) return [];
    const argv = sliceTestArgv(projectRoot, profile, present(testFiles));
    if (argv === null) return [];
    const outcome = await runArgv(argv);
    return outcome.exitCode === 0 ? [] : [failureOf('tests', argv, outcome)];
  };

  return { format, rules, typecheck, lint, tests };
}
