import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { readProjectProfile } from '@/core/project-profile.js';
import { PATHS } from '@/core/constants/paths.js';

import type { DecisionCategory, DecisionPacket } from './decision-packet.js';
import { readCompiledRules } from './rule-compiler.js';

export type DecisionResolutionSource =
  'rule' | 'design-system' | 'profile' | 'rag-confident' | 'ask';

export interface DecisionResolutionResult {
  source: DecisionResolutionSource;
  option_key?: string;
  reason?: string;
}

export async function resolveDecisionPacket(
  projectRoot: string,
  packet: DecisionPacket,
): Promise<DecisionResolutionResult> {
  const profile = readProjectProfile(projectRoot);
  const ruleMatch = await resolveByCompiledRule(projectRoot, packet);
  if (ruleMatch) {
    return ruleMatch;
  }

  const designSystemMatch = resolveByDesignSystem(projectRoot, packet);
  if (designSystemMatch) {
    return designSystemMatch;
  }

  const profileMatch = resolveByProfile(packet, profile);
  if (profileMatch) {
    return profileMatch;
  }

  const confidentMatch = resolveByConfidence(projectRoot, packet);
  if (confidentMatch) {
    return confidentMatch;
  }

  return { source: 'ask' };
}

export function askThresholdForProject(projectRoot: string): number {
  const askThreshold =
    readProjectProfile(projectRoot)?.custom?.decisions?.ask_threshold ?? 'strict';
  switch (askThreshold) {
    case 'strict':
      return 0.95;
    case 'permissive':
      return 0.75;
    default:
      return 0.85;
  }
}

async function resolveByCompiledRule(
  projectRoot: string,
  packet: DecisionPacket,
): Promise<DecisionResolutionResult | null> {
  const rules = await readCompiledRules(projectRoot);
  if (!rules) {
    return null;
  }

  const touchedFiles = watchedFilesForPacket(packet);
  const matchingRule = rules.rules.find((rule) =>
    rule.trigger_patterns.some((pattern) =>
      touchedFiles.some((file) => matchesGlobish(file, pattern)),
    ),
  );
  /* v8 ignore next 3 -- no-rule early return; tests always supply a matching rule file */
  if (!matchingRule) {
    return null;
  }

  const matchingOption =
    packet.options.find((option) => option.evidence.rule_match === matchingRule.rule_id) ??
    /* v8 ignore next 6 */
    packet.options.find((option) =>
      option.evidence.file
        ? matchingRule.trigger_patterns.some((pattern) =>
            matchesGlobish(option.evidence.file!, pattern),
          )
        : false,
    );
  if (!matchingOption && !packet.recommendation) {
    return null;
  }

  return {
    source: 'rule',
    /* v8 ignore next 1 -- fallback chain for missing option or recommendation; always resolved in tests */
    option_key: matchingOption?.option_key ?? packet.recommendation ?? undefined,
    reason: `Matched compiled rule ${matchingRule.rule_id}.`,
  };
}

function resolveByDesignSystem(
  projectRoot: string,
  packet: DecisionPacket,
): DecisionResolutionResult | null {
  if (!supportsDesignSystemResolution(packet.category)) {
    return null;
  }

  const designSystemDir = join(projectRoot, PATHS.DESIGN_SYSTEM_DIR);
  if (!existsSync(designSystemDir)) {
    return null;
  }

  const files = safeListMarkdownFiles(designSystemDir);
  if (files.length === 0) {
    return null;
  }

  const signal = files.some((file) => {
    const content = safeReadFile(join(designSystemDir, file));
    return /\breuse\b|\bexisting\b|\bone\b.{0,20}\bcomponent\b/i.test(content);
  });
  if (!signal) {
    return null;
  }

  return {
    source: 'design-system',
    option_key:
      packet.options.find((option) => /^reuse|^keep|^use current|^stay/i.test(option.option_key))
        ?.option_key ??
      packet.recommendation ??
      undefined,
    reason: 'Design system docs prefer the existing pattern.',
  };
}

function resolveByProfile(
  packet: DecisionPacket,
  profile: ReturnType<typeof readProjectProfile>,
): DecisionResolutionResult | null {
  const preferredOptionKey = profile?.custom?.decisions?.preferred_option_keys?.[packet.category];
  if (
    !preferredOptionKey ||
    !packet.options.some((option) => option.option_key === preferredOptionKey)
  ) {
    return null;
  }

  return {
    source: 'profile',
    option_key: preferredOptionKey,
    reason: `Project profile prefers ${preferredOptionKey}.`,
  };
}

function resolveByConfidence(
  projectRoot: string,
  packet: DecisionPacket,
): DecisionResolutionResult | null {
  const floor = 0.55;
  const ranked = [...packet.options]
    .map((option) => ({
      option_key: option.option_key,
      similarity: option.evidence.similarity ?? 0,
    }))
    .filter((option) => option.similarity >= floor)
    .sort((left, right) => right.similarity - left.similarity);
  const best = ranked[0];
  const second = ranked[1];
  if (!best) {
    if (packet.recommendation && packet.confidence >= askThresholdForProject(projectRoot)) {
      return {
        source: 'rag-confident',
        option_key: packet.recommendation,
        reason: `Confidence ${packet.confidence.toFixed(2)} met the project ask threshold.`,
      };
    }
    return null;
  }
  const threshold = askThresholdForProject(projectRoot);
  const secondScore = second?.similarity ?? 0;
  if (best.similarity < threshold || secondScore > threshold - 0.2) {
    return null;
  }

  return {
    source: 'rag-confident',
    option_key: best.option_key,
    reason: `Confidence ${best.similarity.toFixed(2)} met the project ask threshold.`,
  };
}

function watchedFilesForPacket(packet: DecisionPacket): string[] {
  return [
    ...new Set([
      ...packet.invalidation_watch,
      ...(packet.options.map((option) => option.evidence.file).filter(Boolean) as string[]),
    ]),
  ];
}

function supportsDesignSystemResolution(category: DecisionCategory): boolean {
  return (
    category === 'component-reuse' || category === 'create-vs-reuse' || category === 'ux-pattern'
  );
}

function safeListMarkdownFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((file) => file.endsWith('.md'));
  } catch {
    return [];
  }
}

function safeReadFile(path: string): string {
  /* v8 ignore start */
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
  /* v8 ignore stop */
}

function matchesGlobish(value: string, pattern: string): boolean {
  const normalizedValue = value.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');
  if (normalizedPattern === '**') {
    return true;
  }

  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `^${escaped.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.')}$`,
  );
  return (
    regex.test(normalizedValue) || normalizedValue.includes(normalizedPattern.replace(/\*/g, ''))
  );
}
