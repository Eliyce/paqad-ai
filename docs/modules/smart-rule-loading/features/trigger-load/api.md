# Trigger-Load: API View

> Module: **Smart Rule Loading** (`smart-rule-loading`) · Layer: `framework-internals` · Feature slug: `trigger-load`

## Entry points

- `runtime/hooks/context-refresh-trigger.mjs`, the prompt hook. It debounces on a marker under `.paqad/locks/` (20 seconds) and starts `paqad-ai rag refresh-context --quiet` in the background. Nothing starts while paqad is disabled, or while both `rag_enabled` and `lean_rules` are off.
- `paqad-ai rag refresh-context`, the background worker. It recomposes `.paqad/context/session-context.md` through `refreshRuleContext`.
- Onboarding calls `writeRuleContext` directly.

## `src/context/rule-context.ts`

```ts
export function selectTriggeredRules(
  rules: readonly CompiledRule[],
  changedPaths: readonly string[],
): { alwaysLoad: CompiledRule[]; triggered: CompiledRule[] };

export function composeRuleContext(
  store: CompiledRulesStore,
  options?: { changedPaths?: readonly string[]; scriptedPaths?: ReadonlySet<string> },
): string;

export function composeLoadedRuleText(rules: readonly CompiledRule[]): string;

export interface WriteRuleContextOptions {
  existingSurfaceSection?: string;
  memorySection?: string;
  retrievalSection?: string;
  driftSection?: string;
  loadRules?: boolean;
}

export function writeRuleContext(
  projectRoot: string,
  options?: WriteRuleContextOptions,
): Promise<string | null>;

export function refreshRuleContext(
  projectRoot: string,
  options?: WriteRuleContextOptions,
): Promise<string | null>;
```

`selectTriggeredRules` is pure. A rule with no trigger patterns, or with `**`, is always loaded; any other rule is loaded when a changed path matches one of its patterns.

`composeRuleContext` returns the rule manifest followed by a `## Loaded rule text` section with each loaded rule's text (its `raw_text`, else its summary). With no loaded rule it returns the manifest alone.

`writeRuleContext` writes `.paqad/context/session-context.md` atomically and returns its path, or `null` when there is nothing to write. The changed paths come from the change evidence. When rules are present it adds the decision pause reminder. When rules should load but none are compiled, the file starts with a "No compiled rules in this artifact" warning line, telling the agent to load `docs/instructions/rules/` in full. `loadRules: false` leaves the rule sections and the existing surface out.

`refreshRuleContext` does the same under the `.paqad/locks/rule-context.lock` single-flight lock, and recompiles stale rules first when rules load. It returns `null` without writing when another refresh holds the lock.

## `src/pipeline/rule-trigger-matcher.ts`

```ts
export function isAlwaysLoadRule(rule: Pick<CompiledRule, 'trigger_patterns'>): boolean;
export function ruleTriggersMatch(
  rule: Pick<CompiledRule, 'trigger_patterns'>,
  paths: readonly string[],
): boolean;
export function matchesGlobish(value: string, pattern: string): boolean;
export function matchRuleTriggers(root: string, modulePaths: string[]): Promise<string[]>;
```

`matchesGlobish` treats backslashes as forward slashes, so the same patterns match on Windows.
