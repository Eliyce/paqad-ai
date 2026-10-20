import type { CompiledRule, CompiledRulesStore } from '@/core/types/planning.js';
import type { RuleScriptMap } from '@/rule-scripts/types.js';

const SCRIPT_GLYPH = '⚙';

const DEFAULT_SUMMARY_CHARS = 140;

export interface RuleManifestOptions {
  scriptedSourcePaths?: ReadonlySet<string>;
  maxSummaryChars?: number;
}

export function scriptedSourcePaths(map: RuleScriptMap | null): Set<string> {
  const paths = new Set<string>();
  if (!map) return paths;
  for (const rule of map.rules ?? []) {
    if ((rule.scripts?.length ?? 0) > 0) {
      paths.add(rule.source);
    }
  }
  return paths;
}

function oneLineSummary(summary: string, maxChars: number): string {
  const flattened = summary
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[-*]\s*/, '')
    .trim();
  if (flattened.length <= maxChars) return flattened;
  return `${flattened.slice(0, maxChars - 1).trimEnd()}…`;
}

function renderTrigger(pattern: string): string {
  return `\`${pattern.replace(/`/g, '').replace(/\s+/g, '')}\``;
}

function manifestLine(rule: CompiledRule, scripted: ReadonlySet<string>, maxChars: number): string {
  const triggers = rule.trigger_patterns.length
    ? rule.trigger_patterns.map(renderTrigger).join(' ')
    : '`**`';
  const script = scripted.has(rule.source_path) ? ` ${SCRIPT_GLYPH}` : '';
  const summary = oneLineSummary(rule.summary, maxChars);
  return `- **${rule.rule_id}** ${rule.title} · ${rule.severity} · triggers: ${triggers}${script}${summary ? ` — ${summary}` : ''}`;
}

export function generateRuleManifest(
  store: CompiledRulesStore,
  options: RuleManifestOptions = {},
): string {
  const scripted = options.scriptedSourcePaths ?? new Set<string>();
  const maxChars = options.maxSummaryChars ?? DEFAULT_SUMMARY_CHARS;
  const rules = store.rules ?? [];

  const header = `## paqad rule manifest — ${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}`;
  const intro =
    `> Every rule that governs this repo. This is the index; the full text of the rules that ` +
    `apply to your changed files is below under "Loaded rule text" — read it, then run ` +
    `\`paqad-ai rules load\` to record that you did (required for a code change). ` +
    `${SCRIPT_GLYPH} marks a script-enforced rule: paqad enforces it whether or not its text is loaded.`;

  if (rules.length === 0) {
    return `${header}\n${intro}\n\n_No rules compiled yet._\n`;
  }

  const lines = rules.map((rule) => manifestLine(rule, scripted, maxChars));
  return `${header}\n${intro}\n\n${lines.join('\n')}\n`;
}
