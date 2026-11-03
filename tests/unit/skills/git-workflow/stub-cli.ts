import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runScript, type RunResult } from '../_helpers/run-script.js';

export const SKILL = process.env.PAQAD_SKILL_UNDER_TEST ?? 'runtime/base/skills/git-workflow';
export const OUTPUT_LIMIT_BYTES = 40_000;
export const CANARY = 'ghp_canaryTokenFromTheEnvironment7f3a';

export interface Sandbox {
  root: string;
  bin: string;
  project: string;
  cleanup(): void;
}

const STUB = `#!${process.execPath}
const exit = Number(process.env.STUB_EXIT ?? '0');
process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), exit }) + '\\n');
process.exit(exit);
`;

export function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'git-workflow-skill-'));
  const bin = join(root, 'bin');
  const project = join(root, 'project');
  mkdirSync(bin, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(bin, 'paqad-ai'), STUB);
  chmodSync(join(bin, 'paqad-ai'), 0o755);
  writeFileSync(join(project, 'answers.json'), '{"choices":{}}\n');
  writeFileSync(join(project, 'change.json'), '{"edits":[]}\n');
  return { root, bin, project, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function run(
  box: Sandbox,
  script: string,
  args: string[],
  env: Record<string, string> = {},
): RunResult {
  return runScript(join(SKILL, 'scripts', script), args, {
    cwd: box.project,
    env: { PATH: `${box.bin}:${dirname(process.execPath)}`, ...env },
  });
}

export function snapshot(folder: string): string {
  return readdirSync(folder)
    .sort()
    .map((name) => {
      const path = join(folder, name);
      return `${name}:${statSync(path).mtimeMs}:${readFileSync(path, 'utf8')}`;
    })
    .join('\n');
}

export function forwarded(result: RunResult): string[] {
  return (JSON.parse(result.stdout) as { argv: string[] }).argv;
}
