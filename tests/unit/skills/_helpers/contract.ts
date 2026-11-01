import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { CONTRACT_CHECKS, contractTestName } from '@/authoring/tests/script-contract.js';

import { runScript, type RunResult } from './run-script.js';
import { writeFile } from './temp-fs.js';

export interface ContractRun {
  args?: readonly string[];
  stdin?: string;
  files?: Readonly<Record<string, string>>;
  env?: Readonly<Record<string, string>>;
}

export interface ContractFixture extends ContractRun {
  exit?: number;
  stdout?: string | RegExp;
  stderr?: RegExp;
}

export interface ContractInvalid extends ContractRun {
  exit?: number;
}

export interface ScriptContract {
  script: string;
  names: readonly string[];
  fixture: ContractFixture;
  invalid: ContractInvalid;
  writes?: readonly string[];
  rerun?: 'same-dir' | 'fresh-dir';
  maxBytes?: number;
}

export const CONTRACT_MAX_BYTES = 64 * 1024;
export const CONTRACT_SECRET = `ghp_${'Zq7'.repeat(12)}`;

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bghp_[A-Za-z0-9]{36}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bsk-(?:live|proj)-[A-Za-z0-9]{20,}\b/u,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/u,
];

export function expectedContractNames(script: string): string[] {
  return CONTRACT_CHECKS.map((check) => contractTestName(script, check));
}

function fill(value: string, dir: string): string {
  return value.split('{dir}').join(dir);
}

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) {
        out.set(relative(dir, abs), createHash('sha256').update(readFileSync(abs)).digest('hex'));
      }
    }
  };
  walk(dir);
  return out;
}

function changedPaths(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed = new Set<string>();
  for (const [path, hash] of after) if (before.get(path) !== hash) changed.add(path);
  for (const path of before.keys()) if (!after.has(path)) changed.add(path);
  return [...changed].sort();
}

function normalise(text: string, dir: string): string {
  return text.split(dir).join('<dir>');
}

export function describeContract(spec: ScriptContract): void {
  const expected = expectedContractNames(spec.script);
  if (JSON.stringify([...spec.names]) !== JSON.stringify(expected)) {
    throw new Error(`contract names for ${spec.script} must be ${JSON.stringify(expected)}`);
  }
  const [helpName, invalidName, fixtureName, idempotencyName, dryRunName, sizeName, secretsName] =
    expected as [string, string, string, string, string, string, string];
  const dirs: string[] = [];
  const script = isAbsolute(spec.script) ? spec.script : join(process.cwd(), spec.script);
  const maxBytes = spec.maxBytes ?? CONTRACT_MAX_BYTES;

  const workspace = (run: ContractRun): string => {
    const dir = mkdtempSync(join(tmpdir(), 'paqad-contract-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.home'), { recursive: true });
    for (const [rel, content] of Object.entries(run.files ?? {})) {
      writeFile(dir, rel, fill(content, dir));
    }
    return dir;
  };
  const exec = (run: ContractRun, dir: string, env: Record<string, string> = {}): RunResult =>
    runScript(
      script,
      (run.args ?? []).map((arg) => fill(arg, dir)),
      {
        cwd: dir,
        input: run.stdin === undefined ? '' : fill(run.stdin, dir),
        env: { HOME: join(dir, '.home'), ...(run.env ?? {}), ...env },
        timeoutMs: 20_000,
      },
    );
  const allowed = (path: string): boolean =>
    path.startsWith('.home/') ||
    (spec.writes ?? []).some((write) => path === write || path.startsWith(`${write}/`));

  describe(`${spec.script} contract`, () => {
    afterAll(() => {
      for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    it(helpName, () => {
      const dir = workspace({});
      const result = exec({ args: ['--help'] }, dir);
      expect(result.status).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/usage/iu);
    });

    it(invalidName, () => {
      const dir = workspace(spec.invalid);
      const result = exec(spec.invalid, dir);
      if (spec.invalid.exit === undefined) expect(result.status).not.toBe(0);
      else expect(result.status).toBe(spec.invalid.exit);
      expect(result.status).not.toBe(-1);
      expect(`${result.stdout}${result.stderr}`.trim().length).toBeGreaterThan(0);
    });

    it(fixtureName, () => {
      const dir = workspace(spec.fixture);
      const result = exec(spec.fixture, dir);
      expect(result.status, result.stderr).toBe(spec.fixture.exit ?? 0);
      const { stdout, stderr } = spec.fixture;
      if (typeof stdout === 'string') expect(normalise(result.stdout, dir)).toBe(stdout);
      else if (stdout !== undefined) expect(normalise(result.stdout, dir)).toMatch(stdout);
      if (stderr !== undefined) expect(normalise(result.stderr, dir)).toMatch(stderr);
    });

    it(idempotencyName, () => {
      const first = workspace(spec.fixture);
      const second = spec.rerun === 'fresh-dir' ? workspace(spec.fixture) : first;
      const a = exec(spec.fixture, first);
      const afterFirst = snapshot(first);
      const b = exec(spec.fixture, second);
      expect(b.status).toBe(a.status);
      expect(normalise(b.stdout, second)).toBe(normalise(a.stdout, first));
      if (second === first) expect(snapshot(first)).toEqual(afterFirst);
    });

    it(dryRunName, () => {
      const dir = workspace(spec.fixture);
      const before = snapshot(dir);
      exec(spec.fixture, dir);
      expect(changedPaths(before, snapshot(dir)).filter((path) => !allowed(path))).toEqual([]);
      for (const write of spec.writes ?? []) expect(existsSync(join(dir, write))).toBe(true);
    });

    it(sizeName, () => {
      const dir = workspace(spec.fixture);
      for (const result of [exec(spec.fixture, dir), exec({ args: ['--help'] }, dir)]) {
        expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThan(
          maxBytes,
        );
      }
    });

    it(secretsName, () => {
      const dir = workspace(spec.fixture);
      const result = exec(spec.fixture, dir, {
        GITHUB_TOKEN: CONTRACT_SECRET,
        PAQAD_CONTRACT_TOKEN: CONTRACT_SECRET,
      });
      const output = `${result.stdout}\n${result.stderr}`;
      expect(output).not.toContain(CONTRACT_SECRET);
      for (const pattern of SECRET_PATTERNS) expect(output).not.toMatch(pattern);
    });
  });
}
