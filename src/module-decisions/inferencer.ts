import type { ModuleMap, ModuleMapEntry } from '@/onboarding/registry-generator.js';

export type InferenceChoiceKind = 'extend-existing' | 'new-module-fallback' | 'no-attribution';

export interface InferenceChoice {
  slug: string | null;
  name: string | null;
  kind: InferenceChoiceKind;
  score: number;
  reasoning: string;
  matched_tokens: string[];
}

export interface InferenceResult {
  choices: InferenceChoice[];
  prompt_tokens: string[];
  confident: boolean;
}

export interface InferencerOptions {
  prompt: string;
  moduleMap: ModuleMap | null;
  maxChoices?: number;
  scoreFloor?: number;
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'have',
  'i',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'so',
  'than',
  'that',
  'the',
  'this',
  'to',
  'we',
  'with',
  'will',
  'should',
  'add',
  'fix',
  'update',
  'change',
  'make',
  'new',
  'use',
  'using',
  'need',
  'needs',
  'want',
  'when',
  'if',
  'but',
  'not',
  'no',
  'do',
  'does',
  'can',
  'must',
  'may',
  'just',
  'into',
  'onto',
  'over',
  'under',
  'about',
  'please',
  'feature',
  'module',
  'modules',
  'support',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s/_-]+/g, ' ')
    .split(/[\s/_-]+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function moduleSignalTokens(mod: ModuleMapEntry): string[] {
  const tokens: string[] = [];
  tokens.push(...tokenize(mod.name));
  tokens.push(...tokenize(mod.slug));
  for (const feat of mod.features) {
    tokens.push(...tokenize(feat.name));
    tokens.push(...tokenize(feat.slug));
  }
  for (const path of mod.source_paths) {
    const cleaned = path.replace(/\*+/g, ' ').replace(/\.[a-z0-9]+$/i, ' ');
    tokens.push(...tokenize(cleaned));
  }
  for (const sym of mod.evidence?.symbols ?? []) {
    tokens.push(...tokenize(sym));
  }
  for (const route of mod.evidence?.routes ?? []) {
    tokens.push(...tokenize(route));
  }
  for (const tbl of mod.evidence?.tables ?? []) {
    tokens.push(...tokenize(tbl));
  }
  return uniq(tokens);
}

function scoreModule(
  promptTokens: Set<string>,
  mod: ModuleMapEntry,
): { score: number; matched: string[] } {
  const sigTokens = moduleSignalTokens(mod);
  if (sigTokens.length === 0) return { score: 0, matched: [] };
  const matched: string[] = [];
  const nameTokens = new Set([...tokenize(mod.name), ...tokenize(mod.slug)]);
  let weighted = 0;
  for (const t of sigTokens) {
    if (!promptTokens.has(t)) continue;
    matched.push(t);
    weighted += nameTokens.has(t) ? 2 : 1;
  }
  const denom = Math.max(1, promptTokens.size);
  const score = Math.min(1, weighted / denom);
  return { score, matched: uniq(matched) };
}

export function inferAttribution(opts: InferencerOptions): InferenceResult {
  const maxChoices = opts.maxChoices ?? 3;
  const scoreFloor = opts.scoreFloor ?? 0.5;
  const promptTokens = uniq(tokenize(opts.prompt));
  const promptSet = new Set(promptTokens);

  const ranked: InferenceChoice[] = [];

  if (opts.moduleMap !== null) {
    for (const mod of opts.moduleMap.modules) {
      const { score, matched } = scoreModule(promptSet, mod);
      if (score <= 0) continue;
      ranked.push({
        slug: mod.slug,
        name: mod.name,
        kind: 'extend-existing',
        score,
        matched_tokens: matched,
        reasoning:
          matched.length === 0
            ? `Weak signal from existing module "${mod.name}".`
            : `Prompt shares ${matched.length} token(s) with "${mod.name}": ${matched.slice(0, 6).join(', ')}.`,
      });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, maxChoices);
  const confident = top.some((c) => c.score >= scoreFloor);

  top.push({
    slug: null,
    name: null,
    kind: 'new-module-fallback',
    score: 0,
    matched_tokens: [],
    reasoning:
      'None of the above — introduce a new module (the agent will collect a name from the user).',
  });
  top.push({
    slug: null,
    name: null,
    kind: 'no-attribution',
    score: 0,
    matched_tokens: [],
    reasoning: 'Skip attribution for this prompt (no module mutation).',
  });

  return { choices: top, prompt_tokens: promptTokens, confident };
}
