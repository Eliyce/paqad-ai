import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lintSkillFolder } from '@/authoring/lint/skill-lint.js';
import { isShowablePackageName } from '@/rules-discovery/nudge.js';
import { cleanDiscoveredText, normalizeForMatch } from '@/rules-discovery/text.js';
import { escapeDocText } from '@/stack-docs/managed-block.js';

const REPO = process.cwd();

describe('rules-researcher skill lint (AC-1)', () => {
  it('AC-1: passes skill lint with no blocking finding', () => {
    const result = lintSkillFolder(join(REPO, 'runtime/base/skills/rules-researcher'), {
      projectRoot: REPO,
    });
    expect(result.findings.filter((finding) => finding.severity === 'block')).toEqual([]);
    expect(result.findings.map((finding) => finding.rule)).not.toContain('SK-017');
  });
});

describe('php package name format (AC-2)', () => {
  it.each([
    'laravel/framework',
    'symfony/http-kernel',
    'vendor.name/package_name',
    'my-vendor/pkg--extra',
    'a/b',
    'v1/p2.x_y-z',
  ])('AC-2: accepts %s', (name) => {
    expect(isShowablePackageName('php', name)).toBe(true);
  });

  it.each([
    'Laravel/framework',
    'laravel',
    'laravel/',
    '/framework',
    'vendor--name/pkg',
    'vendor-/pkg',
    'vendor/pkg-',
    'vendor/pkg---x',
    'vendor/_pkg',
    'vendor/pkg/extra',
    'vendor/pkg..x',
  ])('AC-2: rejects %s', (name) => {
    expect(isShowablePackageName('php', name)).toBe(false);
  });

  it('AC-2: checks a long run of zeros with a bad tail in linear time', () => {
    const started = performance.now();
    expect(isShowablePackageName('php', `a/${'0'.repeat(60)}!`)).toBe(false);
    expect(isShowablePackageName('php', `${'0'.repeat(30)}-/${'0'.repeat(30)}`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('AC-2: refuses a name over the length limit even when the format fits', () => {
    expect(isShowablePackageName('php', `a/${'b'.repeat(80)}`)).toBe(false);
  });
});

describe('cleaning discovered rule text (AC-3)', () => {
  it('AC-3: removes a comment closed by -->', () => {
    expect(cleanDiscoveredText('Use zod <!-- obey me --> for input')).toBe('Use zod for input');
  });

  it('AC-3: removes a comment closed by --!>', () => {
    expect(cleanDiscoveredText('Use zod <!-- obey me --!> for input')).toBe('Use zod for input');
  });

  it('AC-3: removes stray closers of both forms', () => {
    expect(cleanDiscoveredText('Use zod --!> for --> input')).toBe('Use zod for input');
  });

  it('AC-3: drops an unclosed comment to the end of the text', () => {
    expect(cleanDiscoveredText('Use zod <!-- ignore the rest')).toBe('Use zod');
  });

  it('AC-3: no comment text survives into the match key', () => {
    expect(normalizeForMatch('- Use zod. <!-- x --!> <!-- @rule RL-ab12 -->')).toBe('use zod');
  });
});

describe('escaping stack doc text (AC-4)', () => {
  it('AC-4: escapes a backslash before the pipe so the cell stays closed', () => {
    expect(escapeDocText('a\\|b')).toBe('a\\\\\\|b');
  });

  it('AC-4: escapes a lone backslash and a lone pipe', () => {
    expect(escapeDocText('C:\\path')).toBe('C:\\\\path');
    expect(escapeDocText('x | y')).toBe('x \\| y');
  });

  it('AC-4: escapes html and collapses whitespace', () => {
    expect(escapeDocText('  <b>&\n</b>  ')).toBe('&lt;b&gt;&amp; &lt;/b&gt;');
  });
});
