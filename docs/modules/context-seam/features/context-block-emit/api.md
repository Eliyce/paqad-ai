# Context block emit: API View

> Module: **Context Injection Seam** (`context-seam`) · Layer: `framework-internals` · Feature slug: `context-block-emit`

## Hook entry

`runtime/hooks/context-seam-inject.mjs` is a `UserPromptSubmit` hook. It reads the prompt payload from stdin, writes the context block to stdout and always exits 0. The prompt gate (`runtime/hooks/agent-entry-prompt-gate.mjs`) calls the same `emitContext` in-process, and only once the framework is loaded for the session.

The block is written only when paqad is enabled and either `rag_enabled` (env `PAQAD_RAG_ENABLED`, default off) or `lean_rules` (env `PAQAD_LEAN_RULES`, default on) is on. With both off, or nothing to inject, the hook writes nothing.

## Output

```
[paqad-context]
<contents of .paqad/context/session-context.md>
[/paqad-context]
```

`PAQAD_CONTEXT_ARTIFACT` replaces the artifact path; a relative value is read from the project root. A file over 128 KiB is cut with a `…[paqad-context truncated at <n> bytes]` line, and a read that runs past 50 ms gives no block at all. A hook output over 9000 characters keeps the block markers and ends the body with `> Context trimmed to stay under the host limit. Read .paqad/context/session-context.md for the rest.`

## `runtime/hooks/lib/context-seam-emit.mjs`

```js
export function emitContext(stdin, projectRoot?, write?, options?: { stripRules?: boolean }): void;
export function sessionIdFromStdin(stdin): string | undefined;
export function agentIdFromStdin(stdin): string | undefined;
```

`emitContext` never throws. It also records one row in the RAG evidence ledger: `used` with the injected sections and byte count, or `fallback` when nothing was injected. `stripRules: true` drops the rule manifest, the loaded rule text and the existing surface sections, for a prompt routed to anything but feature-development.

## `runtime/scripts/context-seam.mjs`

```js
export const CONTEXT_ARTIFACT_RELPATH = '.paqad/context/session-context.md';
export const BLOCK_OPEN = '[paqad-context]';
export const BLOCK_CLOSE = '[/paqad-context]';
export const DEFAULT_BUDGET_MS = 50;
export const DEFAULT_MAX_BYTES = 131072;
export const HOOK_OUTPUT_BUDGET_CHARS = 9000;

export function buildInjection(projectRoot, options?): string;
export function formatContextBlock(content): string;
export function readContextUnderBudget(path, options?): string | null;
export function resolveContextArtifactPath(projectRoot, env?): string;
export function stripRuleSections(content): string;
export function fitHookOutput(before, contextBlock, after, budget?): string;
export function isRagEnabledValue(raw): boolean;
export function isLeanRulesEnabledValue(raw): boolean;
```

`buildInjection` returns `''` when there is nothing to inject. `isRagEnabledValue` is true only for `true`, `1`, `yes` or `on`; `isLeanRulesEnabledValue` is false only for `false`, `0`, `no` or `off`, and true when unset.
