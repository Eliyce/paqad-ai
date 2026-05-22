import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import fg from 'fast-glob';

import { PATHS } from '@/core/constants/paths.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import type { ResolvedArtifact } from '@/core/types/resolution.js';
import type { SkillDefinition } from '@/core/types/skill.js';

import { SkillFrontmatterParser } from './frontmatter-parser.js';
import { selectModelForTier } from './model-selector.js';

export interface GeneratedSkillIndexEntry {
  name: string;
  description: string;
  triggers: SkillDefinition['triggers'];
  request_routing?: SkillDefinition['request_routing'];
  model_tier: SkillDefinition['model_tier'];
  resolved_model: string;
  output_format: SkillDefinition['output_format'];
  cacheable: boolean;
  on_complete?: SkillDefinition['on_complete'];
  file: string;
}

export async function buildSkillIndex(
  profile: Pick<ProjectProfile, 'model_routing'>,
  files: string[],
  relativeTo = process.cwd(),
): Promise<GeneratedSkillIndexEntry[]> {
  const parser = new SkillFrontmatterParser();

  const entries = await Promise.all(
    files.map(async (file) => {
      const parsed = parser.parse(await readFile(file, 'utf8'));

      return {
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description,
        triggers: parsed.frontmatter.triggers,
        request_routing: parsed.frontmatter.request_routing,
        model_tier: parsed.frontmatter.model_tier,
        resolved_model: selectModelForTier(profile, parsed.frontmatter.model_tier),
        output_format: parsed.frontmatter.output_format,
        cacheable: parsed.frontmatter.cacheable,
        on_complete: parsed.frontmatter.on_complete,
        file: relative(relativeTo, file),
      } satisfies GeneratedSkillIndexEntry;
    }),
  );

  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

export async function generateSkillIndex(
  profile: Pick<ProjectProfile, 'model_routing'>,
  skillRoots: string[],
  relativeTo = process.cwd(),
): Promise<GeneratedSkillIndexEntry[]> {
  const files = (
    await Promise.all(
      skillRoots.map((root) =>
        fg('**/SKILL.md', {
          cwd: root,
          absolute: true,
        }),
      ),
    )
  )
    .flat()
    .sort();

  return buildSkillIndex(profile, files, relativeTo);
}

export async function writeSkillIndexFromArtifacts(
  projectRoot: string,
  profile: Pick<ProjectProfile, 'model_routing'>,
  artifacts: ResolvedArtifact[],
): Promise<string> {
  const skillFiles = artifacts
    .map((artifact) => artifact.path)
    .filter((path) => path.endsWith('SKILL.md'))
    .sort();

  return writeSkillIndex(projectRoot, await buildSkillIndex(profile, skillFiles, projectRoot));
}

export async function writeSkillIndex(
  projectRoot: string,
  index: GeneratedSkillIndexEntry[],
): Promise<string> {
  const target = join(projectRoot, PATHS.SKILL_INDEX);

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(index, null, 2)}\n`);

  return PATHS.SKILL_INDEX;
}
