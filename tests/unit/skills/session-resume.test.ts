import { resolve, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/session-resume';
const sh = (n: string) => resolve(join(SKILL, 'scripts', n));

describe('session-resume', () => {
  describe('load-resume-bundle.sh', () => {
    const path = sh('load-resume-bundle.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 1 listing every missing input file', () => {
      withTempDir((dir) => {
        const r = runScript(path, [], { cwd: dir });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/handoff\.md/);
        expect(r.stderr).toMatch(/onboarding-manifest\.json/);
        expect(r.stderr).toMatch(/project-profile\.yaml/);
      });
    });

    it('exits 1 when only one input missing', () => {
      withTempDir((dir) => {
        writeFile(dir, '.paqad/session/handoff.md', '# handoff');
        writeFile(dir, '.paqad/project-profile.yaml', 'slug: x\n');
        // manifest missing
        const r = runScript(path, [], { cwd: dir });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/onboarding-manifest\.json/);
      });
    });

    it('emits the 3-section bundle when all inputs present', () => {
      withTempDir((dir) => {
        writeFile(dir, '.paqad/session/handoff.md', '# handoff body\nphase: implementation');
        writeFile(
          dir,
          '.paqad/onboarding-manifest.json',
          JSON.stringify({
            projectSlug: 'demo',
            projectName: 'Demo',
            domain: 'coding',
            detectedStack: 'node',
            extraField: 'ignored',
          }),
        );
        writeFile(
          dir,
          '.paqad/project-profile.yaml',
          [
            'slug: demo',
            'domain: coding',
            'primary_stack: node',
            'lane: graduated',
            'strictness: standard',
          ].join('\n') + '\n',
        );

        const r = runScript(path, [], { cwd: dir });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('=== handoff ===');
        expect(r.stdout).toContain('# handoff body');
        expect(r.stdout).toContain('=== project ===');
        expect(r.stdout).toContain('slug: demo');
        expect(r.stdout).toContain('lane: graduated');
        expect(r.stdout).toContain('=== manifest ===');
        // Manifest is whitelisted to specific keys.
        expect(r.stdout).toContain('"projectSlug": "demo"');
        expect(r.stdout).toContain('"detectedStack": "node"');
        expect(r.stdout).not.toContain('extraField');
      });
    });

    it('survives a profile with no matching scalar lines (grep no-match handled)', () => {
      withTempDir((dir) => {
        writeFile(dir, '.paqad/session/handoff.md', '# h');
        writeFile(dir, '.paqad/onboarding-manifest.json', '{}');
        writeFile(dir, '.paqad/project-profile.yaml', '# only comments here\n');
        const r = runScript(path, [], { cwd: dir });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('=== project ===');
        // No scalar lines printed but section header still emitted.
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a 3-section block', () => {
      const ok = '## Session State\n- x\n## Project Context\n- y\n## Resume Targets\n- z\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when any section missing', () => {
      const r = runScript(path, [], { input: '## Project Context\n## Resume Targets\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Session State/);
    });
  });
});
