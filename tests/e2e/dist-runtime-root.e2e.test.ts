import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { writeProjectProfile } from '@/core/project-profile.js';
import { openStageEvidence } from '@/stage-evidence/index.js';
import { VERIFICATION_EVIDENCE_RELATIVE_PATH } from '@/verification/evidence.js';

import { fixtureProfile } from '../unit/adapters/shared.fixture.js';

import { DIST_BUNDLES, ensureBuiltDist } from './helpers/ensure-built.js';

// Issue #579 — the regression the unit suite could not see. The Stop hook imports the
// depth-one dist/index.js, the CLI runs the depth-two dist/cli/index.js, and a fixed `../..`
// resolved one folder too high from the first, so the pack registry came back empty and the
// visual-evidence gate read every change as not-frontend. These assertions run against the
// BUILT bundles and the real verify-backstop.mjs, never src and never a mocked dist.

const [DIST_INDEX, DIST_CLI] = DIST_BUNDLES as [string, string];
const BACKSTOP = join(process.cwd(), 'runtime', 'scripts', 'verify-backstop.mjs');
const SESSION = 'e2e-579-session';

type DistApi = {
  getRuntimeRoot: () => string;
  getPacksForFrameworks: (frameworks: string[], projectRoot: string) => unknown[];
};

function capture() {
  let text = '';
  return { stream: { write: (s: string) => ((text += s), true) }, read: () => text };
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execa('git', args, { cwd });
}

describe('dist runtime root (issue #579)', () => {
  let root: string;
  let api: DistApi;

  beforeAll(async () => {
    await ensureBuiltDist();
    api = (await import(pathToFileURL(DIST_INDEX).href)) as DistApi;

    root = mkdtempSync(join(tmpdir(), 'paqad-579-e2e-'));
    await git(root, 'init', '-q', '-b', 'main');
    await git(root, 'config', 'user.email', 'e2e@example.com');
    await git(root, 'config', 'user.name', 'e2e');
    writeFileSync(join(root, 'README.md'), '# fixture\n');
    await git(root, 'add', '.');
    await git(root, 'commit', '-q', '-m', 'init');

    writeProjectProfile(root, {
      ...fixtureProfile('laravel'),
      active_capabilities: ['coding'],
      stack_profile: {
        frameworks: ['laravel', 'react'],
        traits: [],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
    } as never);
    writeFileSync(
      join(root, '.paqad', '.config'),
      'visual_evidence=true\nvisual_evidence_mode=strict\n',
    );
    openStageEvidence(root, { sessionId: SESSION, adapter: 'claude-code' });

    mkdirSync(join(root, 'resources', 'js', 'Pages'), { recursive: true });
    writeFileSync(
      join(root, 'resources', 'js', 'Pages', 'Example.tsx'),
      'export default function Example() {\n  return null;\n}\n',
    );
  }, 600_000);

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC-1: the depth-one and depth-two bundles resolve the same on-disk runtime root', async () => {
    const cli = (await import(pathToFileURL(DIST_CLI).href)) as { getRuntimeRoot: () => string };

    const fromIndex = api.getRuntimeRoot();
    expect(existsSync(fromIndex)).toBe(true);
    expect(cli.getRuntimeRoot()).toBe(fromIndex);
  });

  it('loads the real built-in packs from dist/index.js', () => {
    expect(api.getPacksForFrameworks(['laravel', 'react'], root).length).toBeGreaterThan(0);
  });

  it('AC-3: the real Stop-hook backstop fails the visual-evidence gate and emits a block', async () => {
    const { runVerificationBackstop } = (await import(pathToFileURL(BACKSTOP).href)) as {
      runVerificationBackstop: (input: Record<string, unknown>) => Promise<number>;
    };
    const out = capture();
    const err = capture();

    const code = await runVerificationBackstop({
      origin: 'hook-completion',
      softFail: false,
      projectRoot: root,
      hostSessionId: SESSION,
      loopActive: false,
      stdout: out.stream,
      stderr: err.stream,
    });

    expect(err.read()).toBe('');
    expect(code).toBe(0);
    const payload = JSON.parse(out.read()) as { decision?: string; reason?: string };
    expect(payload.decision).toBe('block');

    const written = JSON.parse(
      readFileSync(join(root, VERIFICATION_EVIDENCE_RELATIVE_PATH), 'utf8'),
    ) as { gates: Array<{ name: string; status: string; detail: string }> };
    const visual = written.gates.find((gate) => gate.name === 'visual-evidence');
    expect(visual?.status).toBe('fail');
    expect(visual?.detail).toContain('no visual-evidence.json was captured');
  }, 120_000);
});
