import fg from 'fast-glob';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { toPosixPath } from '@/core/path-utils.js';
import { SkillFrontmatterParser } from '@/skills/frontmatter-parser.js';

describe('runtime skills', () => {
  it('all shipped runtime skills have valid frontmatter, bundled metadata, and required sections', async () => {
    const files = (
      await fg(
        [
          'runtime/base/skills/**/SKILL.md',
          'runtime/capabilities/coding/skills/**/SKILL.md',
          'runtime/capabilities/security/skills/**/SKILL.md',
        ],
        { cwd: process.cwd(), absolute: true },
      )
    ).sort();
    expect(files.length).toBeGreaterThanOrEqual(42);

    const parser = new SkillFrontmatterParser();
    const requiredSections = [
      '## What It Does',
      '## Use This When',
      '## Inputs',
      '## Procedure',
      '## Output Contract',
      '## Escalate / Stop Conditions',
      '## Resources',
    ];

    for (const file of files) {
      const content = await readFile(file, 'utf8');
      const parsed = parser.parse(content);
      const skillDir = dirname(file);
      const agentConfigPath = join(skillDir, 'agents', 'openai.yaml');
      const bundledReferences = await fg('references/**/*', {
        cwd: skillDir,
        onlyFiles: true,
      });

      expect(parsed.frontmatter.model_tier).toBeTruthy();
      expect(parsed.line_count).toBeLessThanOrEqual(300);
      expect(
        parsed.frontmatter.triggers.length > 0 ||
          (parsed.frontmatter.request_routing?.length ?? 0) > 0,
      ).toBe(true);
      expect(parsed.frontmatter.output_format).toBeTruthy();
      expect(Object.keys(parsed.frontmatter.input_schema)).not.toHaveLength(0);
      expect(await readFile(agentConfigPath, 'utf8')).toContain('interface:');
      expect(bundledReferences.length).toBeGreaterThan(0);

      for (const section of requiredSections) {
        expect(parsed.body).toContain(section);
      }

      // Skill bodies reference resources with forward slashes; relative()
      // emits backslashes on Windows.
      const resourceReferences = [
        ...bundledReferences,
        toPosixPath(relative(process.cwd(), agentConfigPath)),
      ];
      expect(resourceReferences.some((resource) => parsed.body.includes(`\`${resource}\``))).toBe(
        true,
      );
    }
  });

  it('api-doc-maintainer has valid frontmatter', async () => {
    const parser = new SkillFrontmatterParser();
    const parsed = parser.parse(
      await readFile('runtime/base/skills/api-doc-maintainer/SKILL.md', 'utf8'),
    );

    expect(parsed.frontmatter.name).toBe('api-doc-maintainer');
    expect(parsed.frontmatter.model_tier).toBe('medium');
    expect(parsed.frontmatter.cacheable).toBe(false);
    expect(parsed.frontmatter.output_format).toBe('markdown');
    expect(parsed.line_count).toBeLessThanOrEqual(300);
  });

  it('integration-doc-maintainer has valid frontmatter', async () => {
    const parser = new SkillFrontmatterParser();
    const parsed = parser.parse(
      await readFile('runtime/base/skills/integration-doc-maintainer/SKILL.md', 'utf8'),
    );

    expect(parsed.frontmatter.name).toBe('integration-doc-maintainer');
    expect(parsed.frontmatter.model_tier).toBe('medium');
    expect(parsed.line_count).toBeLessThanOrEqual(300);
  });

  it('error-catalog-maintainer has valid frontmatter', async () => {
    const parser = new SkillFrontmatterParser();
    const parsed = parser.parse(
      await readFile('runtime/base/skills/error-catalog-maintainer/SKILL.md', 'utf8'),
    );

    expect(parsed.frontmatter.name).toBe('error-catalog-maintainer');
    expect(parsed.frontmatter.model_tier).toBe('medium');
    expect(parsed.line_count).toBeLessThanOrEqual(300);
  });

  it('documentation-workflow has valid frontmatter', async () => {
    const parser = new SkillFrontmatterParser();
    const parsed = parser.parse(
      await readFile('runtime/base/skills/documentation-workflow/SKILL.md', 'utf8'),
    );

    expect(parsed.frontmatter.name).toBe('documentation-workflow');
    expect(parsed.frontmatter.model_tier).toBe('medium');
    expect(parsed.frontmatter.cacheable).toBe(false);
    expect(parsed.line_count).toBeLessThanOrEqual(300);
  });

  it('spec-quality-review has reasoning-tier frontmatter', async () => {
    const parser = new SkillFrontmatterParser();
    const parsed = parser.parse(
      await readFile('runtime/base/skills/spec-quality-review/SKILL.md', 'utf8'),
    );

    expect(parsed.frontmatter.name).toBe('spec-quality-review');
    expect(parsed.frontmatter.model_tier).toBe('reasoning');
    expect(parsed.frontmatter.cacheable).toBe(false);
    expect(parsed.line_count).toBeLessThanOrEqual(300);
  });
});
