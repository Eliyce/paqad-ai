import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/base/skills/request-classifier';
const sh = (n: string) => join(SKILL, 'scripts', n);

function classify(text: string): Record<string, string> {
  const r = runScript(sh('extract-signals.sh'), [], { input: text });
  expect(r.status).toBe(0);
  const out: Record<string, string> = {};
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

describe('request-classifier', () => {
  describe('extract-signals.sh', () => {
    const path = sh('extract-signals.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 when file argument missing', () => {
      const r = runScript(path, ['/no/such/file.txt']);
      expect(r.status).toBe(2);
    });

    it('classifies bug language', () => {
      expect(classify('the login flow is broken, please fix the bug')).toMatchObject({
        workflow: 'bug-fix',
      });
    });

    it('classifies refactor language', () => {
      expect(classify('refactor the auth module')).toMatchObject({ workflow: 'refactor' });
    });

    it('classifies migration language', () => {
      expect(classify('we need a data migration to backfill emails')).toMatchObject({
        workflow: 'migration',
      });
    });

    it('classifies investigation language', () => {
      expect(classify('investigate why the cron stopped firing')).toMatchObject({
        workflow: 'investigation',
      });
    });

    it('classifies project-question language', () => {
      expect(classify('what is the role of the cache layer here')).toMatchObject({
        workflow: 'project-question',
      });
    });

    it('falls back to feature-development', () => {
      expect(classify('add a new feature to invite users by email')).toMatchObject({
        workflow: 'feature-development',
      });
    });

    it('detects ui_impact', () => {
      expect(classify('redesign the settings screen')).toMatchObject({ ui_impact: 'yes' });
      expect(classify('refactor the cron job')).toMatchObject({ ui_impact: 'no' });
    });

    it('detects api_impact', () => {
      expect(classify('add a webhook endpoint for billing')).toMatchObject({ api_impact: 'yes' });
      expect(classify('clean up the docs')).toMatchObject({ api_impact: 'no' });
    });

    it('detects db_impact', () => {
      expect(classify('add a column to users table')).toMatchObject({ db_impact: 'yes' });
      expect(classify('rename a function')).toMatchObject({ db_impact: 'no' });
    });

    it('classifies scope', () => {
      expect(classify('a cross-module change')).toMatchObject({ scope: 'multi-module' });
      expect(classify('a platform-wide change')).toMatchObject({ scope: 'system-wide' });
      expect(classify('localized to one feature')).toMatchObject({ scope: 'single-module' });
    });

    it('produces a risk_hint', () => {
      expect(classify('refactor auth tokens')).toMatchObject({ risk_hint: 'high' });
      expect(classify('process refund')).toMatchObject({ risk_hint: 'medium' });
      expect(classify('rename helper')).toMatchObject({ risk_hint: 'low' });
    });

    it('always emits all 6 dimensions', () => {
      const out = classify('any random thing');
      for (const k of ['workflow', 'ui_impact', 'api_impact', 'db_impact', 'scope', 'risk_hint']) {
        expect(out, `missing ${k}`).toHaveProperty(k);
      }
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid block', () => {
      const ok = [
        '## Classification',
        '',
        'workflow: bug-fix',
        'scope: single-module',
        'risk: low',
        'ui_impact: no',
        'api_impact: yes',
        'db_impact: yes',
        '',
        '## Evidence',
        '- workflow: "fix the broken login"',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when any required dimension missing', () => {
      const r = runScript(path, [], {
        input: '## Classification\nworkflow: bug-fix\n## Evidence\n- x\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/scope|risk|ui_impact|api_impact|db_impact/);
    });

    it('fails when "## Classification" missing', () => {
      const r = runScript(path, [], { input: 'workflow: bug-fix\n## Evidence\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Classification/);
    });

    it('fails when Evidence section missing', () => {
      const r = runScript(path, [], {
        input:
          '## Classification\nworkflow: bug-fix\nscope: single-module\nrisk: low\nui_impact: no\napi_impact: no\ndb_impact: no\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Evidence/);
    });
  });
});
