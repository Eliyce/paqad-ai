import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { hashFolder } from '@/authoring/hash.js';
import { lintSkillFolder } from '@/authoring/lint/skill-lint.js';
import type { ClassificationResult } from '@/core/types/classification.js';
import { SkillFrontmatterParser } from '@/skills/frontmatter-parser.js';
import { SkillTriggerEvaluator } from '@/skills/trigger-evaluator.js';

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

  it('AC-2: keeps the pentest steps in order', () => {
    expectInOrder(body(folder), [
      'collect-context',
      'run-project-scripts',
      'generate-local-attack-playbook',
      'synthesize-findings',
      'write-report',
    ]);
  });

  it('AC-2: runs the security skills with STRIDE first', () => {
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

  it('AC-2: writes the local attack playbook and hands the retest to retest-verification', () => {
    const text = body(folder);
    expect(text).toContain('local-playbook.md');
    expect(text.slice(text.indexOf('### Retest mode'))).toContain('retest-verification');
  });

  it('AC-3: is the one entry point for pentest-retest; retest-verification is a called helper', () => {
    expect(workflowTriggers(folder)).toEqual(['pentest', 'pentest-retest']);
    expect(workflowTriggers('runtime/capabilities/security/skills/retest-verification')).toEqual(
      [],
    );
  });
});

describe('site-map skill', () => {
  const folder = 'runtime/capabilities/coding/skills/site-map';

  it('has the seven sections in order and a Retest mode under Procedure', () => {
    expectSkillShape(folder);
  });

  it('AC-2: walks the sitemap verbs in order', () => {
    expectInOrder(body(folder), [
      'sitemap status',
      'preflight site-map',
      'sitemap inventory',
      'sitemap draft',
      'sitemap run',
    ]);
  });

  it('AC-3: is the one entry point for site-map-retest; the helper of that name is called', () => {
    expect(workflowTriggers(folder)).toEqual(['site-map', 'site-map-retest']);
    expect(workflowTriggers('runtime/capabilities/coding/skills/site-map-retest')).toEqual([]);
  });
});

describe('design-test skill', () => {
  const folder = 'runtime/capabilities/coding/skills/design-test';

  it('has the seven sections in order and a Retest mode under Procedure', () => {
    expectSkillShape(folder);
  });

  it('keeps the design-test steps in order', () => {
    expectInOrder(body(folder), [
      'readiness-gate',
      'collect-context',
      'run-project-scripts',
      'generate-local-design-playbook',
      'live-validation',
      'synthesize-findings',
      'write-report',
    ]);
  });

  it('runs design-system-coverage first, then the review helpers in the source order', () => {
    expectInOrder(body(folder), [
      'design-system-coverage',
      'token-conformance-review',
      'component-conformance-review',
      'state-coverage-review',
      'accessibility-review',
      'responsive-review',
      'motion-review',
      'copy-and-ia-review',
    ]);
  });

  it('AC-2: retests the earlier sidecar and keeps its finding IDs', () => {
    const text = body(folder);
    const retest = text.slice(text.indexOf('### Retest mode'), text.indexOf('## Output Contract'));
    expect(retest).toContain('load-source-findings');
    expect(retest).toContain('write-retest-report');
    expect(retest).toContain('docs/design-test/');
  });

  it('AC-3: triggers on design-test and design-retest', () => {
    expect(workflowTriggers(folder)).toEqual(['design-test', 'design-retest']);
  });
});

describe('codebase-health skill', () => {
  const folder = 'runtime/capabilities/coding/skills/codebase-health';

  it('has the seven sections in order and a Retest mode under Procedure', () => {
    expectSkillShape(folder);
  });

  it('runs the health verb, reads the findings, triages and narrates in order', () => {
    expectInOrder(body(folder), [
      'paqad-ai health run',
      'read the findings JSON',
      'triage',
      'narrate the report',
    ]);
  });

  it('AC-2: retests through the health retest verb by stable HL- id', () => {
    const text = body(folder);
    const retest = text.slice(text.indexOf('### Retest mode'), text.indexOf('## Output Contract'));
    expect(retest).toContain('paqad-ai health retest');
    expect(retest).toContain('HL-');
  });

  it('AC-3: triggers on codebase-health and health-retest', () => {
    expect(workflowTriggers(folder)).toEqual(['codebase-health', 'health-retest']);
  });
});

const PENTEST = 'runtime/capabilities/security/skills/pentest';
const SITE_MAP = 'runtime/capabilities/coding/skills/site-map';
const DESIGN_TEST = 'runtime/capabilities/coding/skills/design-test';
const CODEBASE_HEALTH = 'runtime/capabilities/coding/skills/codebase-health';
const RETEST_VERIFICATION = 'runtime/capabilities/security/skills/retest-verification';
const SITE_MAP_RETEST = 'runtime/capabilities/coding/skills/site-map-retest';
const FINDING_NORMALIZER = 'runtime/base/skills/finding-normalizer';

describe('the four workflow skills as a set', () => {
  it.each([PENTEST, SITE_MAP, DESIGN_TEST, CODEBASE_HEALTH])(
    'AC-1: %s has no blocking skill lint finding and the seven sections in order',
    (folder) => {
      const result = lintSkillFolder(join(REPO, folder), { projectRoot: REPO });
      expect(result.findings.filter((finding) => finding.severity === 'block')).toEqual([]);
      expectInOrder(body(folder), SECTIONS);
    },
  );

  const parser = new SkillFrontmatterParser();
  const evaluator = new SkillTriggerEvaluator();
  const loads = (folder: string, workflow: string): boolean =>
    evaluator.shouldLoad(parser.parse(body(folder), join(REPO, folder)).frontmatter, {
      workflow,
    } as unknown as ClassificationResult);

  it.each([
    ['pentest', PENTEST],
    ['pentest-retest', PENTEST],
    ['site-map', SITE_MAP],
    ['site-map-retest', SITE_MAP],
    ['design-test', DESIGN_TEST],
    ['design-retest', DESIGN_TEST],
    ['codebase-health', CODEBASE_HEALTH],
    ['health-retest', CODEBASE_HEALTH],
  ])(
    'AC-11: the %s workflow loads its parent skill and neither called helper',
    (workflow, parent) => {
      expect(loads(parent, workflow)).toBe(true);
      expect(loads(RETEST_VERIFICATION, workflow)).toBe(false);
      expect(loads(SITE_MAP_RETEST, workflow)).toBe(false);
    },
  );

  it.each([
    PENTEST,
    SITE_MAP,
    DESIGN_TEST,
    CODEBASE_HEALTH,
    RETEST_VERIFICATION,
    SITE_MAP_RETEST,
    FINDING_NORMALIZER,
  ])('AC-12: the committed evidence for %s matches the folder', (folder) => {
    const name = folder.split('/').at(-1)!;
    const evidence = JSON.parse(
      readFileSync(join(REPO, '.paqad/authoring/skills', name, 'evidence.json'), 'utf8'),
    ) as { folder_hash: string };
    expect(evidence.folder_hash).toBe(hashFolder(join(REPO, folder)));
  });
});

describe('the rule-script map after the seven files left', () => {
  const SOURCES = [
    'security/pentest.md',
    'coding/site-map.md',
    'coding/site-map-retest.md',
    'coding/design-test.md',
    'coding/design-retest.md',
    'coding/codebase-health.md',
    'coding/health-retest.md',
  ].map((path) => `docs/instructions/rules/${path}`);

  it('AC-10: no entry names one of the seven sources', () => {
    const map = parse(
      readFileSync(join(REPO, 'docs/instructions/rules/rule-script-map.yml'), 'utf8'),
    ) as { rules: Array<{ source: string }> };
    expect(map.rules.length).toBeGreaterThan(0);
    expect(map.rules.filter((rule) => SOURCES.includes(rule.source))).toEqual([]);
  });

  it('AC-10: the reconciler reports no drift', () => {
    const report = JSON.parse(
      execFileSync(
        'node',
        [join(REPO, 'runtime/base/skills/rule-script-reconciler/scripts/reconcile.mjs'), REPO],
        { encoding: 'utf8' },
      ),
    ) as { counts: Record<string, number>; blocked: boolean };
    expect(report.blocked).toBe(false);
    expect(report.counts).toMatchObject({
      'RS-RULE-ADDED': 0,
      'RS-RULE-EDITED': 0,
      'RS-RULE-REMOVED': 0,
      'RS-SCRIPT-STALE': 0,
      'RS-FIXTURE-FAIL': 0,
      'RS-CONFLICT': 0,
    });
  }, 60_000);
});
