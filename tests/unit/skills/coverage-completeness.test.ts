/**
 * Meta-test: every skill's runtime artifacts have a corresponding spec file.
 *
 * Rules enforced:
 *  1. Every skill that has a `scripts/` dir must have `tests/unit/skills/<name>.test.ts`.
 *  2. Every script in that dir must be referenced by name from the spec source
 *     (so adding a script without a test is impossible without failing CI).
 *  3. Every script passes `bash -n`.
 *  4. Every resource referenced from SKILL.md (in backticks) actually exists on disk.
 *
 * If you add a new skill or new script, add tests in its spec file and this test
 * confirms you didn't forget one.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

import { syntaxOk } from './_helpers/run-script.js';
import { listSkillDirs, listSkillScripts } from './_helpers/skill-paths.js';

describe('skill test coverage completeness', () => {
  it('every skill with scripts/ has a spec file under tests/unit/skills/', async () => {
    const skills = await listSkillDirs();
    const missing: string[] = [];
    for (const skill of skills) {
      const scripts = await listSkillScripts(skill.scriptsDir);
      if (scripts.length === 0) continue;
      const specPath = `tests/unit/skills/${skill.name}.test.ts`;
      if (!existsSync(specPath)) missing.push(specPath);
    }
    expect(missing, `missing spec files:\n  - ${missing.join('\n  - ')}`).toEqual([]);
  });

  it('every script under a skill is referenced by name from its spec file', async () => {
    const skills = await listSkillDirs();
    const orphans: string[] = [];
    for (const skill of skills) {
      const scripts = await listSkillScripts(skill.scriptsDir);
      if (scripts.length === 0) continue;
      const specPath = `tests/unit/skills/${skill.name}.test.ts`;
      if (!existsSync(specPath)) continue; // covered by the previous test
      const specSource = readFileSync(specPath, 'utf8');
      for (const scriptAbs of scripts) {
        const scriptName = basename(scriptAbs);
        if (!specSource.includes(scriptName)) {
          orphans.push(`${skill.name}: ${scriptName} not referenced in ${specPath}`);
        }
      }
    }
    expect(orphans, `scripts without test coverage:\n  - ${orphans.join('\n  - ')}`).toEqual([]);
  });

  it('every shipped script passes bash -n syntax check', async () => {
    const all = await fg(
      [
        'runtime/base/skills/*/scripts/*.sh',
        'runtime/capabilities/coding/skills/*/scripts/*.sh',
        'runtime/capabilities/security/skills/*/scripts/*.sh',
        'runtime/capabilities/content/skills/*/scripts/*.sh',
      ],
      { cwd: process.cwd(), absolute: true },
    );
    const broken = all.filter((s) => !syntaxOk(s)).map((s) => relative(process.cwd(), s));
    expect(broken, `scripts failing bash -n:\n  - ${broken.join('\n  - ')}`).toEqual([]);
  });

  it('every backticked path in SKILL.md Resources actually exists', async () => {
    const skills = await listSkillDirs();
    const dangling: string[] = [];
    for (const skill of skills) {
      const skillMd = readFileSync(join(skill.root, 'SKILL.md'), 'utf8');
      const resourcesIdx = skillMd.indexOf('## Resources');
      if (resourcesIdx === -1) continue;
      const resourcesBlock = skillMd.slice(resourcesIdx);
      const re = /`([^`]+)`/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(resourcesBlock)) !== null) {
        const ref = m[1];
        // Only check references that look like in-skill paths (relative).
        if (
          !ref.startsWith('scripts/') &&
          !ref.startsWith('assets/') &&
          !ref.startsWith('references/') &&
          !ref.startsWith('agents/')
        )
          continue;
        const abs = join(skill.root, ref);
        if (!existsSync(abs)) dangling.push(`${skill.name}: ${ref}`);
      }
    }
    expect(
      dangling,
      `SKILL.md Resources reference missing files:\n  - ${dangling.join('\n  - ')}`,
    ).toEqual([]);
  });
});
