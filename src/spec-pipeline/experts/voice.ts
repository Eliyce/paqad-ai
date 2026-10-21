import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { getRuntimeRoot } from '@/core/runtime-paths.js';
import type { DetectedStackProfile } from '@/core/types/introspection.js';
import type { PackRegistry } from '@/core/types/pack.js';
import { StackPackLoader } from '@/packs/loader.js';

import { readGrounding } from '../run-store.js';
import type { VocabularyEntry } from '../types.js';

export const MAX_VOICE_TERMS = 40;

export const PACK_GUIDE_FILES = [
  'rules/foundation/guide.md',
  'rules/modules.md',
  'rules/conventions/guide.md',
  'rules/api.md',
] as const;

export interface ProjectVoiceInput {
  stackLine: string;
  guidePointers: string[];
  noGuidesShipped: boolean;
  architecturePage?: string;
  stackPage?: string;
  technicalPages: string[];
  vocabulary: VocabularyEntry[];
}

const KIND_ORDER: Record<VocabularyEntry['kind'], number> = {
  glossary: 0,
  role: 1,
  flow: 2,
  rule: 3,
  technical: 4,
};

export function orderVoiceTerms(vocabulary: VocabularyEntry[]): VocabularyEntry[] {
  return [...vocabulary]
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind] || a.index - b.index)
    .map((wrapped) => wrapped.entry)
    .slice(0, MAX_VOICE_TERMS);
}

export function renderProjectVoice(input: ProjectVoiceInput): string {
  const lines: string[] = ['## Project voice', '', input.stackLine];

  if (input.guidePointers.length > 0) {
    lines.push(
      `Read the stack guides before you write: ${input.guidePointers.map((p) => `\`${p}\``).join(', ')}`,
    );
  } else if (input.noGuidesShipped) {
    lines.push('No stack guides shipped for this pack; use the architecture and stack pages.');
  }
  if (input.architecturePage) lines.push(`Architecture page: \`${input.architecturePage}\``);
  if (input.stackPage) lines.push(`Stack page: \`${input.stackPage}\``);
  if (input.technicalPages.length > 0) {
    lines.push(
      `Technical pages for the touched modules: ${input.technicalPages.map((p) => `\`${p}\``).join(', ')}`,
    );
  }

  lines.push('', 'Business words this project uses (say these, not a synonym):');
  const ordered = orderVoiceTerms(input.vocabulary);
  if (ordered.length === 0) {
    lines.push(
      '- (none documented yet; use the request\'s own words and flag new terms with "new")',
    );
  } else {
    for (const entry of ordered) {
      const gloss = entry.definition ? `: ${entry.definition}` : '';
      lines.push(`- ${entry.term}${gloss} (${entry.kind}, ${entry.source})`);
    }
  }

  lines.push(
    '',
    'Rule: name what people see in the business words above, and where it lives by its real name in this codebase (a table, a route, a class, a config key). A word from neither is flagged for the chief.',
  );
  return lines.join('\n');
}

export function buildStackLine(
  profile: DetectedStackProfile | null,
  packs: PackRegistry | null,
): string {
  const frameworks = profile?.frameworks ?? [];
  if (frameworks.length === 0) {
    return 'Stack: unknown (no framework detected); node / pnpm.';
  }
  const displayFor = (framework: string): string => {
    const pack = packs
      ? [...packs.packs.values()].find((p) => p.manifest.name === framework)
      : undefined;
    const name = pack?.manifest.display_name ?? framework;
    const band = (profile?.version_bands ?? []).find(
      (b) => b.name === framework || b.package_name === framework,
    );
    return band ? `${name} (${band.range})` : name;
  };
  const names = frameworks.map(displayFor);
  const head = names[0]!;
  const rest = names.slice(1);
  const frameworkPart = rest.length > 0 ? `${head} with ${rest.join(', ')}` : head;
  const toolchain = profile?.toolchains?.[0];
  const toolPart = toolchain
    ? `${toolchain.ecosystem} / ${toolchain.package_manager}`
    : 'node / pnpm';
  return `Stack: ${frameworkPart}; ${toolPart}.`;
}

export function resolveGuidePointers(
  runtimeRoot: string,
  profile: DetectedStackProfile | null,
  packs: PackRegistry | null,
): { guidePointers: string[]; noGuidesShipped: boolean } {
  const frameworks = profile?.frameworks ?? [];
  if (!packs || frameworks.length === 0) return { guidePointers: [], noGuidesShipped: false };
  const activePacks = [...packs.packs.values()].filter((p) => frameworks.includes(p.manifest.name));
  if (activePacks.length === 0) return { guidePointers: [], noGuidesShipped: false };
  const guidePointers: string[] = [];
  for (const pack of activePacks) {
    for (const guide of PACK_GUIDE_FILES) {
      if (existsSync(join(pack.root, guide))) {
        guidePointers.push(runtimeRelative(runtimeRoot, join(pack.root, guide)));
      }
    }
  }
  return { guidePointers, noGuidesShipped: guidePointers.length === 0 };
}

function runtimeRelative(runtimeRoot: string, abs: string): string {
  const posixAbs = abs.replace(/\\/g, '/');
  const posixRoot = runtimeRoot.replace(/\\/g, '/').replace(/\/$/, '');
  if (posixAbs.startsWith(`${posixRoot}/`)) {
    return `runtime/${posixAbs.slice(posixRoot.length + 1)}`;
  }
  return posixAbs;
}

export function resolveDocPages(projectRoot: string): {
  architecturePage?: string;
  stackPage?: string;
} {
  const arch = 'docs/instructions/architecture/overview.md';
  const stack = 'docs/instructions/stack/overview.md';
  return {
    ...(existsSync(join(projectRoot, arch)) ? { architecturePage: arch } : {}),
    ...(existsSync(join(projectRoot, stack)) ? { stackPage: stack } : {}),
  };
}

export function resolveTechnicalPages(projectRoot: string, modules: readonly string[]): string[] {
  const pages: string[] = [];
  for (const slug of modules) {
    const rel = `docs/modules/${slug}/technical.md`;
    if (existsSync(join(projectRoot, rel))) pages.push(rel);
  }
  return pages;
}

export function glossaryPresent(projectRoot: string): boolean {
  return existsSync(join(projectRoot, PATHS.GLOSSARY));
}

export function resolveProjectVoiceForRun(projectRoot: string, dirName: string): string {
  const grounding = readGrounding(projectRoot, dirName);
  const profile = readProjectProfile(projectRoot)?.stack_profile ?? null;
  let packs: PackRegistry | null = null;
  try {
    packs = new StackPackLoader().load({ runtimeRoot: getRuntimeRoot(), projectRoot });
    /* v8 ignore start -- pack loading never throws today; belt-and-braces so a fault never fails record. */
  } catch {}
  const { guidePointers, noGuidesShipped } = resolveGuidePointers(getRuntimeRoot(), profile, packs);
  const pages = resolveDocPages(projectRoot);
  /* v8 ignore stop */
  const technicalPages = (grounding?.references ?? [])
    .map((ref) => ref.ref)
    .filter((ref) => ref.replace(/\\/g, '/').endsWith('technical.md'));
  return renderProjectVoice({
    stackLine: buildStackLine(profile, packs),
    guidePointers,
    noGuidesShipped,
    ...pages,
    technicalPages,
    vocabulary: grounding?.vocabulary ?? [],
  });
}
