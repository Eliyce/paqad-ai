# Rule Manifest — Technical View

> Module: **Smart Rule Loading** (`smart-rule-loading`) · Layer: `framework-internals` · Feature slug: `rule-manifest`

## Module Boundaries

- `src/context/rule-manifest.ts` — `generateRuleManifest`, `scriptedSourcePaths`,
  `writeRuleManifest`.

## Entry Points

- `generateRuleManifest(store, options?)` → compact manifest markdown for a
  `CompiledRulesStore` (pure).
- `scriptedSourcePaths(map)` → set of rule source files with ≥1 script, from a
  `RuleScriptMap` (null → empty set).
- `writeRuleManifest(projectRoot)` → reads `compiled-rules.json` + the rule-script
  map, generates, atomic-writes the seam artifact; returns the path or `null`.

## Data Model / Schema

- Input: `CompiledRule { rule_id, title, source_path, trigger_patterns, severity,
  summary }`.
- `RuleManifestOptions { scriptedSourcePaths?: ReadonlySet<string>,
  maxSummaryChars?: number }` (default cap 140 chars).
- Output line: `- **<id>** <title> · <severity> · triggers: <globs|`**`>[ ⚙] — <summary>`.
- Artifact path: `PATHS.CONTEXT_SESSION_ARTIFACT` (`.paqad/context/session-context.md`),
  the same relative path the runtime seam hardcodes.

## API / Interface Contract

- `has-script` is derived from the rule-script map by `source_path` membership;
  an absent map degrades to "no rule scripted," never an error.
- Summaries are flattened (`\s+`→space, leading bullet stripped) and truncated
  with an ellipsis when over the cap.
- Writes go through `atomicWriteFile` (background harness) so a reader never sees
  a half-written manifest.

## State Management

- Stateless generator. The writer is invoked by the onboarding orchestrator right
  after the rules (re)compile, so the manifest tracks `compiled-rules.json`.

## Failure Modes

- No compiled rules → `writeRuleManifest` returns `null`, writes nothing.
- Generation throws during onboarding → caught, recorded as a non-fatal warning.

## Tests

- `tests/unit/context/rule-manifest.test.ts` — every rule listed; id/title/
  severity/triggers/summary rendering; `⚙` only for scripted sources; `**`
  fallback; summary flatten+truncate; empty set; `scriptedSourcePaths` from a map
  and from null; writer round-trip to the artifact; returns null with no rules;
  end-to-end appearance via the seam hook with rag on.
