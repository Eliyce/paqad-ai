import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import fg from 'fast-glob';

import { PATHS } from '@/core/constants/paths.js';
import { resolveFrameworkConfig } from '@/core/framework-config.js';
import type {
  CompiledRule,
  CompiledRulesStore,
  RequirementPriority,
} from '@/core/types/planning.js';

const RULE_SCHEMA_VERSION = 1;

export async function compileRules(root: string): Promise<CompiledRulesStore> {
  const files = await fg('**/*.md', {
    cwd: join(root, PATHS.RULES_DIR),
    onlyFiles: true,
  });

  // Compile-time flag gate (issue #279): a rule may declare `<!--gate: <flag>-->`. When that
  // flag is off it is excluded ENTIRELY — read, filtered, and never assigned a rule_id — so
  // zero of its bytes reach the compiled store the LLM sees. Filtering before ordinal
  // assignment keeps RULE-N contiguous.
  const gateFlags = resolveGateFlags(root);
  const kept: { file: string; raw: string }[] = [];
  for (const file of files.sort()) {
    const raw = await readFile(join(root, PATHS.RULES_DIR, file), 'utf8');
    const gate = extractGate(raw);
    if (gate !== undefined && gateFlags[gate] !== true) {
      continue;
    }
    kept.push({ file, raw });
  }

  const rules = kept.map(({ file, raw }, index) => compileRuleContent(file, raw, index + 1));

  return {
    schema_version: RULE_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    source_hash: await computeSourceHash(root),
    rules,
  };
}

/**
 * Resolve the feature-flag map used to decide whether a `gate:`-tagged rule compiles. A
 * malformed config yields an empty map, so every gated rule stays excluded (OFF-is-silent
 * default) — never throwing out of compilation.
 */
function resolveGateFlags(root: string): Record<string, boolean> {
  try {
    return resolveFrameworkConfig(root).features as unknown as Record<string, boolean>;
    /* v8 ignore next 3 -- defensive: a malformed config never breaks rule compilation */
  } catch {
    return {};
  }
}

/** Read a rule's `<!--gate: <flag>-->` directive, or undefined when the rule is ungated. */
function extractGate(raw: string): string | undefined {
  return raw.match(/<!--\s*gate:\s*([a-z0-9_]+)\s*-->/i)?.[1];
}

export async function writeCompiledRules(root: string, store: CompiledRulesStore): Promise<string> {
  const outputPath = join(root, PATHS.COMPILED_RULES);
  await mkdir(join(root, '.paqad'), { recursive: true });
  await writeFile(outputPath, JSON.stringify(store, null, 2) + '\n', 'utf8');
  return outputPath;
}

export async function readCompiledRules(root: string): Promise<CompiledRulesStore | null> {
  try {
    const raw = await readFile(join(root, PATHS.COMPILED_RULES), 'utf8');
    return JSON.parse(raw) as CompiledRulesStore;
  } catch {
    return null;
  }
}

export async function isCompiledRulesStale(root: string): Promise<boolean> {
  const store = await readCompiledRules(root);
  if (!store) {
    return true;
  }

  return store.source_hash !== (await computeSourceHash(root));
}

export async function computeSourceHash(root: string): Promise<string> {
  const files = await fg('**/*.md', {
    cwd: join(root, PATHS.RULES_DIR),
    onlyFiles: true,
  });
  const hash = createHash('sha256');

  for (const file of files.sort()) {
    const content = await readFile(join(root, PATHS.RULES_DIR, file), 'utf8');
    hash.update(file);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }

  return `sha256:${hash.digest('hex')}`;
}

function compileRuleContent(file: string, raw: string, ordinal: number): CompiledRule {
  const headingMatch = raw.match(/^#\s+(.+)$/m);
  const title = headingMatch?.[1]?.trim() || join(PATHS.RULES_DIR, file);
  const summary = raw
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#') && !line.startsWith('```'));
  const triggerPatterns = extractTriggerPatterns(raw);

  if (summary === undefined) {
    return {
      rule_id: `RULE-${ordinal}`,
      title,
      source_path: join(PATHS.RULES_DIR, file),
      trigger_patterns: ['**'],
      severity: 'must',
      summary: 'Unparseable rule content; preserve raw text for planning context.',
      raw_text: raw,
    };
  }

  return {
    rule_id: `RULE-${ordinal}`,
    title,
    source_path: join(PATHS.RULES_DIR, file),
    trigger_patterns: triggerPatterns.length > 0 ? triggerPatterns : ['**'],
    severity: inferSeverity(raw),
    summary,
    raw_text: raw,
  };
}

/**
 * Whether a candidate string looks like a file path / glob trigger, as opposed to prose
 * or a code fragment. A trigger is a single path-shaped token: no whitespace, drawn from
 * the path/glob charset, length-bounded, and carrying a path signal — a separator (`/`),
 * a glob wildcard (`*` / `?`), or a file-extension dot. This is the gate that keeps the
 * inline-code fallback from scooping up arbitrary backtick spans (identifiers, prose, and
 * multi-line code-fence contents) as "triggers", which previously exploded the manifest
 * and produced the `` `, ` `` corruption when those junk patterns were comma-joined.
 */
export function looksLikeTriggerPattern(candidate: string): boolean {
  if (!candidate || candidate.length > 120) return false;
  if (/\s/.test(candidate)) return false;
  if (!/^[A-Za-z0-9_./*?@{}[\]-]+$/.test(candidate)) return false;
  return candidate.includes('/') || /[*?]/.test(candidate) || /\.[A-Za-z0-9]+$/.test(candidate);
}

/**
 * Derive a rule's trigger patterns. An explicit `<!-- trigger: a, b -->` directive is
 * authoritative and taken verbatim. Otherwise triggers are inferred from inline-code spans,
 * but ONLY the ones that look like a path/glob ({@link looksLikeTriggerPattern}) — after
 * stripping fenced code blocks so a ``` block's contents never leak in. A doc with no
 * path-shaped inline code yields `[]` (the caller falls back to `**`, the safe over-include),
 * never a dropped or corrupted trigger.
 */
function extractTriggerPatterns(raw: string): string[] {
  const explicitDirective = raw.match(/<!--\s*trigger:\s*([^>]+)\s*-->/i)?.[1];
  if (explicitDirective) {
    return [
      ...new Set(
        explicitDirective
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
  }
  const withoutFences = raw.replace(/```[\s\S]*?```/g, '');
  const candidates = Array.from(withoutFences.matchAll(/`([^`]+)`/g), (match) => match[1].trim());
  return [...new Set(candidates.filter(looksLikeTriggerPattern))];
}

function inferSeverity(raw: string): RequirementPriority {
  const normalized = raw.toLowerCase();
  if (/\bmust\b|\brequired\b|\bnever\b/.test(normalized)) {
    return 'must';
  }
  if (/\bshould\b|\brecommended\b/.test(normalized)) {
    return 'should';
  }
  return 'could';
}
