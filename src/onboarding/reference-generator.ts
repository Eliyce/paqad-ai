import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import fg from 'fast-glob';

import type { GeneratedFile } from '@/adapters/adapter.interface.js';
import { PATHS } from '@/core/constants/paths.js';
import { getPrimaryStack } from '@/core/stack-profile.js';
import type { Domain, Stack } from '@/core/types/domain.js';
import type { DetectedStackProfile } from '@/core/types/introspection.js';

type ReferenceGuideContext = {
  domain: Domain;
  stack_profile: DetectedStackProfile;
};

export async function generateReferenceGuides(
  runtimeRoot: string,
  context: ReferenceGuideContext,
): Promise<GeneratedFile[]> {
  if (context.domain !== 'coding') {
    return [];
  }

  const stack = getPrimaryStack({
    active_capabilities: ['content', 'coding', 'security'],
    routing: { domain: context.domain },
    stack_profile: context.stack_profile,
  });

  const referencesRoot = join(runtimeRoot, 'capabilities', 'coding', 'stacks', stack, 'references');

  if (!existsSync(referencesRoot)) {
    return [buildFallbackReferenceGuide(stack)];
  }

  const entries = await fg(['tools/*.md', 'tools-catalog.md'], {
    cwd: referencesRoot,
    onlyFiles: true,
    absolute: true,
  });

  if (entries.length === 0) {
    return [buildFallbackReferenceGuide(stack)];
  }

  return Promise.all(
    entries.sort().map(async (entry) => ({
      path: toProjectReferencePath(stack, relative(referencesRoot, entry)),
      content: await readFile(entry, 'utf8'),
      autoUpdate: false,
    })),
  );
}

function toProjectReferencePath(stack: string, relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/');

  if (normalized === 'tools-catalog.md') {
    return join(PATHS.TOOLS_DIR, stack, 'README.md');
  }

  return join(PATHS.TOOLS_DIR, stack, normalized.replace(/^tools\//, ''));
}

function buildFallbackReferenceGuide(stack: Stack): GeneratedFile {
  const title = stack
    .split('-')
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(' ');

  return {
    path: join(PATHS.TOOLS_DIR, stack, 'README.md'),
    autoUpdate: false,
    content: [
      `# ${title} Tool References`,
      '',
      'This stack ships the minimum viable runtime tool contract.',
      '',
      '- Use `.paqad/project-profile.yaml` as the source of truth for project-specific commands.',
      '- Use `docs/instructions/stack/*.md` for detected frameworks, traits, toolchains, and drift.',
      '- Use `docs/instructions/rules/**` plus the stack pack rules for implementation conventions.',
      '',
      'Add stack-specific tool guides here when the runtime grows beyond the baseline contract.',
    ].join('\n'),
  };
}
