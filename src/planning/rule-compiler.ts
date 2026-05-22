import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

import fg from 'fast-glob';

import { PATHS } from '@/core/constants/paths.js';
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

  const rules = await Promise.all(
    files.map(async (file, index) => compileRuleFile(root, file, index + 1)),
  );

  return {
    schema_version: RULE_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    source_hash: await computeSourceHash(root),
    rules,
  };
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

async function compileRuleFile(root: string, file: string, ordinal: number): Promise<CompiledRule> {
  const absolutePath = join(root, PATHS.RULES_DIR, file);
  const raw = await readFile(absolutePath, 'utf8');
  const headingMatch = raw.match(/^#\s+(.+)$/m);
  const title = headingMatch?.[1]?.trim() || relative(root, absolutePath);
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

function extractTriggerPatterns(raw: string): string[] {
  const explicitDirective = raw.match(/<!--\s*trigger:\s*([^>]+)\s*-->/i)?.[1];
  const candidates = explicitDirective
    ? explicitDirective.split(',').map((value) => value.trim())
    : Array.from(raw.matchAll(/`([^`]+)`/g), (match) => match[1].trim());
  return [...new Set(candidates.filter(Boolean))];
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
