import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';

export interface ScriptOutput {
  exitCode: number | undefined;
  json: { ok: boolean; errors: string[]; hash: string; stale?: string[] };
}

const made: string[] = [];

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'paqad-recipe-'));
  made.push(dir);
  return dir;
}

export function cleanTempDirs(): void {
  while (made.length > 0) rmSync(made.pop()!, { recursive: true, force: true });
}

export function scriptPath(recipe: string, script: string): string {
  return join(process.cwd(), 'runtime/base/skills', recipe, 'scripts', script);
}

export async function runScript(
  recipe: string,
  script: string,
  args: string[],
  input?: string,
): Promise<ScriptOutput> {
  const run = await execa('node', [scriptPath(recipe, script), ...args], {
    reject: false,
    ...(input === undefined ? {} : { input }),
  });
  return { exitCode: run.exitCode, json: JSON.parse(run.stdout) as ScriptOutput['json'] };
}

export function writeTemp(name: string, text: string): string {
  const path = join(tempDir(), name);
  writeFileSync(path, text);
  return path;
}
