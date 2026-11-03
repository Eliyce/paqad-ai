import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const REPO = join(__dirname, '..', '..', '..');

const SECTIONS = [
  '## What It Does',
  '## Use This When',
  '## Inputs',
  '## Procedure',
  '## Output Contract',
  '## Escalate / Stop Conditions',
  '## Resources',
];

function body(folder: string): string {
  return readFileSync(join(REPO, folder, 'SKILL.md'), 'utf8');
}

function workflowTriggers(folder: string): string[] {
  const meta = parse(readFileSync(join(REPO, folder, 'skill.meta.yaml'), 'utf8')) as {
    triggers?: Array<{ workflow?: string[] }>;
  };
  return (meta.triggers ?? []).flatMap((trigger) => trigger.workflow ?? []);
}

function expectInOrder(text: string, anchors: readonly string[]): void {
  let from = -1;
  for (const anchor of anchors) {
    const at = text.indexOf(anchor, from + 1);
    expect(at, `${anchor} after position ${from}`).toBeGreaterThan(from);
    from = at;
  }
}

function expectSkillShape(folder: string): void {
  const text = body(folder);
  expectInOrder(text, SECTIONS);
  expect(text).toContain('### Retest mode');
  expect(text.indexOf('### Retest mode')).toBeGreaterThan(text.indexOf('## Procedure'));
  expect(text.indexOf('### Retest mode')).toBeLessThan(text.indexOf('## Output Contract'));
}

describe('pentest skill', () => {
  const folder = 'runtime/capabilities/security/skills/pentest';

  it('has the seven sections in order and a Retest mode under Procedure', () => {
    expectSkillShape(folder);
  });

  it('keeps the pentest steps in order', () => {
    expectInOrder(body(folder), [
      'collect-context',
      'run-project-scripts',
      'generate-local-attack-playbook',
      'synthesize-findings',
      'write-report',
    ]);
  });

  it('runs the security skills with STRIDE first', () => {
    const text = body(folder);
    for (const skill of [
      'stride-threat-model',
      'input-validation-review',
      'auth-mechanism-review',
      'cryptographic-review',
      'logging-monitoring-review',
      'rate-limiting-review',
    ]) {
      expect(text).toContain(skill);
    }
    expect(text.indexOf('stride-threat-model')).toBeLessThan(
      text.indexOf('input-validation-review'),
    );
  });

  it('writes the local attack playbook and hands the retest to retest-verification', () => {
    const text = body(folder);
    expect(text).toContain('local-playbook.md');
    expect(text.slice(text.indexOf('### Retest mode'))).toContain('retest-verification');
  });

  it('triggers on pentest and pentest-retest', () => {
    expect(workflowTriggers(folder)).toEqual(['pentest', 'pentest-retest']);
  });
});

describe('site-map skill', () => {
  const folder = 'runtime/capabilities/coding/skills/site-map';

  it('has the seven sections in order and a Retest mode under Procedure', () => {
    expectSkillShape(folder);
  });

  it('walks the sitemap verbs in order', () => {
    expectInOrder(body(folder), [
      'sitemap status',
      'preflight site-map',
      'sitemap inventory',
      'sitemap draft',
      'sitemap run',
    ]);
  });

  it('triggers on site-map and site-map-retest', () => {
    expect(workflowTriggers(folder)).toEqual(['site-map', 'site-map-retest']);
  });
});
