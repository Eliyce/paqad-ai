import fg from 'fast-glob';
import { basename, dirname, join } from 'node:path';

export interface SkillDirs {
  name: string;
  root: string;
  scriptsDir: string;
  assetsDir: string;
  referencesDir: string;
}

/**
 * Enumerate all 55 runtime skill directories.
 */
export async function listSkillDirs(): Promise<SkillDirs[]> {
  const skillFiles = (
    await fg(
      [
        'runtime/base/skills/*/SKILL.md',
        'runtime/capabilities/coding/skills/*/SKILL.md',
        'runtime/capabilities/security/skills/*/SKILL.md',
        'runtime/capabilities/content/skills/*/SKILL.md',
      ],
      { cwd: process.cwd(), absolute: true },
    )
  ).sort();

  return skillFiles.map((file) => {
    const root = dirname(file);
    return {
      name: basename(root),
      root,
      scriptsDir: join(root, 'scripts'),
      assetsDir: join(root, 'assets'),
      referencesDir: join(root, 'references'),
    };
  });
}

/**
 * List every .sh script under a skill's scripts/ directory.
 */
export async function listSkillScripts(scriptsDir: string): Promise<string[]> {
  return (await fg('*.sh', { cwd: scriptsDir, absolute: true })).sort();
}
