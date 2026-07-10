/**
 * Always-resident rule manifest (RAG buildout F4).
 *
 * Generates a compact, skimmable index of EVERY rule that governs the repo — id,
 * title, severity, trigger patterns, a one-line summary, and whether the rule is
 * script-enforced — and writes it to the session-time injection seam's context
 * artifact ({@link PATHS.CONTEXT_SESSION_ARTIFACT}). The seam
 * (`runtime/scripts/context-seam.mjs`) injects it on the next prompt when the
 * injection accelerator is on.
 *
 * Why a manifest: it is omission insurance plus the bulk of the rule-token cut.
 * Today every rule's full text loads wholesale; the manifest lets the model
 * always know that every rule exists and when it applies (its triggers) while the
 * full text is deferred to a deterministic trigger-load (F5). Script-enforced
 * rules (F6) are marked so the deferral is safe — they are enforced regardless of
 * whether their text is in context.
 *
 * This producer does NO heavy work and does not depend on the background harness:
 * it is regenerated synchronously wherever the rules recompile (onboarding /
 * refresh), so it tracks `compiled-rules.json`. The artifact is machine-local
 * (`.paqad/context/` is gitignored).
 */
import type { CompiledRule, CompiledRulesStore } from '@/core/types/planning.js';
import type { RuleScriptMap } from '@/rule-scripts/types.js';

/** Glyph marking a script-enforced rule in the manifest. */
const SCRIPT_GLYPH = '⚙';

/** Default cap on each rule's inline summary so the manifest stays a few K tokens. */
const DEFAULT_SUMMARY_CHARS = 140;

export interface RuleManifestOptions {
  /** Source paths (project-relative) whose rules are script-enforced (F6). */
  scriptedSourcePaths?: ReadonlySet<string>;
  /** Max characters of each rule summary kept inline. */
  maxSummaryChars?: number;
}

/**
 * The set of rule source files that have at least one verification script, read
 * from the rule-script map. A compiled rule is "script-enforced" when its
 * `source_path` is in this set. An absent map degrades to an empty set (every
 * rule shows as un-scripted), never an error.
 */
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

/**
 * Collapse a multi-line rule summary into one compact, capped, plain-text line. Backticks
 * are stripped: the manifest summary is a skimmable teaser (the full, code-formatted rule
 * text loads on demand), and dropping the backticks guarantees the manifest can never emit
 * the corrupted `` `, ` `` sequence from a summary that comma-separates inline code.
 */
function oneLineSummary(summary: string, maxChars: number): string {
  const flattened = summary
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[-*]\s*/, '')
    .trim();
  if (flattened.length <= maxChars) return flattened;
  return `${flattened.slice(0, maxChars - 1).trimEnd()}…`;
}

/** Render one trigger pattern as a single, backtick-free code span (space is the separator). */
function renderTrigger(pattern: string): string {
  return `\`${pattern.replace(/`/g, '').replace(/\s+/g, '')}\``;
}

function manifestLine(rule: CompiledRule, scripted: ReadonlySet<string>, maxChars: number): string {
  // Space-join the trigger spans (never `, `) so the manifest cannot carry the corrupted
  // `` `, ` `` token sequence; each pattern is a single backtick-free span.
  const triggers = rule.trigger_patterns.length
    ? rule.trigger_patterns.map(renderTrigger).join(' ')
    : '`**`';
  const script = scripted.has(rule.source_path) ? ` ${SCRIPT_GLYPH}` : '';
  const summary = oneLineSummary(rule.summary, maxChars);
  return `- **${rule.rule_id}** ${rule.title} · ${rule.severity} · triggers: ${triggers}${script}${summary ? ` — ${summary}` : ''}`;
}

/**
 * Render the compact manifest markdown for a compiled-rules store. Lists every
 * rule; the body is intentionally lean so the whole manifest costs a few K tokens
 * even for a large rule set.
 */
export function generateRuleManifest(
  store: CompiledRulesStore,
  options: RuleManifestOptions = {},
): string {
  const scripted = options.scriptedSourcePaths ?? new Set<string>();
  const maxChars = options.maxSummaryChars ?? DEFAULT_SUMMARY_CHARS;
  const rules = store.rules ?? [];

  const header = `## paqad rule manifest — ${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}`;
  const intro =
    `> Every rule that governs this repo. Full text loads on demand when a rule's triggers match what you touch. ` +
    `${SCRIPT_GLYPH} marks a script-enforced rule: paqad enforces it whether or not its text is loaded.`;

  if (rules.length === 0) {
    return `${header}\n${intro}\n\n_No rules compiled yet._\n`;
  }

  const lines = rules.map((rule) => manifestLine(rule, scripted, maxChars));
  return `${header}\n${intro}\n\n${lines.join('\n')}\n`;
}
