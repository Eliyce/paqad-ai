import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HOOK_COVERAGE_MATRIX } from '@/adapters/shared/paqad-hooks.js';

const REPO = resolve(__dirname, '../../..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

interface Packet {
  category: string;
  status: string;
  chosen: string;
}

describe('mutation wiring decisions', () => {
  it.each([
    ['D-01M5AKZP6RVHCMBJ6T1QR1M0H2', 'wire'],
    ['D-01M5AM6S3Z36HR2NRKN2XYNZWW', 'both-run-suite'],
  ])('AC-16: %s is resolved in workflow-or-tool with %s chosen', (id, chosen) => {
    const packet = JSON.parse(read(`.paqad/decisions/resolved/${id}.json`)) as Packet;
    expect(packet.category).toBe('workflow-or-tool');
    expect(packet.status).toBe('resolved');
    expect(packet.chosen).toBe(chosen);
  });
});

describe('mutation wiring host tiers', () => {
  it('AC-24: both completion hooks run the backstop on hook-completion only', () => {
    for (const hook of ['verification-record.mjs', 'verification-completion.mjs']) {
      const source = read(`runtime/hooks/${hook}`);
      expect(source).toMatch(/runVerificationBackstop\(\{\s*origin: 'hook-completion'/);
      expect(source).not.toContain("'ci-backstop'");
      expect(source).not.toContain("'git-backstop'");
    }
  });

  it('AC-24: Codex binds the completion chain and Gemini the record hook, as the matrix says', () => {
    expect(HOOK_COVERAGE_MATRIX['codex-cli']).toBe('live-pre-and-completion');
    expect(HOOK_COVERAGE_MATRIX['gemini-cli']).toBe('live-completion-only');
  });

  describe('AC-24: the Codex and Gemini completion paths under mutation_mode=strict', () => {
    let project: string;
    beforeEach(() => {
      project = mkdtempSync(join(tmpdir(), 'paqad-293-hooks-'));
      mkdirSync(join(project, '.paqad'), { recursive: true });
    });
    afterEach(() => rmSync(project, { recursive: true, force: true }));

    const runHook = (hook: string, args: string[], payload: unknown) =>
      execa('node', [join(REPO, 'runtime/hooks', hook), ...args], {
        cwd: project,
        reject: false,
        input: JSON.stringify(payload),
        env: {
          ...process.env,
          PAQAD_PROJECT_ROOT: project,
          CLAUDE_PROJECT_DIR: project,
          PAQAD_MUTATION_MODE: 'strict',
        },
      });

    it('Gemini record hook exits 0, silent, with no mutation verdict', async () => {
      const result = await runHook('verification-record.mjs', ['gemini-cli'], {
        session_id: 'g-293',
        prompt_response: 'done',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    }, 60_000);

    it('Codex completion hook exits 0 with no mutation verdict', async () => {
      const result = await runHook('verification-completion.mjs', ['codex-cli'], {
        session_id: 'c-293',
        hook_event_name: 'Stop',
      });
      expect(result.exitCode).toBe(0);
      expect(`${result.stdout}${result.stderr}`).not.toMatch(/mutation testing/i);
    }, 60_000);
  });

  it('AC-24: no advisory-host template claims mutation enforcement', () => {
    const advisory = Object.entries(HOOK_COVERAGE_MATRIX)
      .filter(([, tier]) => tier === 'advisory')
      .map(([host]) => host);
    expect(advisory).toHaveLength(8);
    const templates = readdirSync(join(REPO, 'runtime/templates/agent-configs'));
    expect(templates.length).toBeGreaterThanOrEqual(advisory.length);
    for (const template of templates) {
      const text = read(`runtime/templates/agent-configs/${template}`).replace(
        /pre-mutation/gi,
        '',
      );
      expect(text, template).not.toMatch(/mutation/i);
    }
  });
});

describe('mutation wiring docs say what ships', () => {
  it('AC-26: the mutation doc names the real wiring, not a pipeline phase file', () => {
    const doc = read('docs/modules/verification/mutation-testing.md');
    expect(doc).not.toContain('phases/verification.ts');
    expect(doc).toContain('src/mutation/backstop.ts');
    expect(doc).toContain('off by default');
    expect(doc).toContain('runtime/scripts/verify-backstop.mjs');
    expect(doc).toContain('Never on `hook-completion`');
  });

  it('AC-26: verification-enforcement does not list mutation as computing genuine results unconditionally', () => {
    const doc = read('docs/verification-enforcement.md');
    const computed = doc.slice(doc.indexOf('- **Computed (C-2):**'), doc.indexOf('- **Skipped'));
    const genuine = computed.slice(0, computed.indexOf('compute genuine results'));
    expect(genuine).not.toContain('mutation-testing');
    expect(computed).toContain('Mutation testing is opt-in');
    expect(computed).toContain('mutation_mode');
  });

  it('AC-26: the README states mutation testing per host tier, opt-in, with a project-supplied tool', () => {
    const line = read('README.md')
      .split('\n')
      .find((entry) => entry.includes('Mutation testing on changed code'));
    expect(line).toBeDefined();
    expect(line).toContain('off by default');
    expect(line).toContain('mutation_mode');
    expect(line).toContain('the mutation tool you install for your stack');
    for (const tier of ['Claude Code', 'Codex', 'Gemini', 'advisory hosts']) {
      expect(line).toContain(tier);
    }
    expect(line).not.toContain('—');
  });
});
