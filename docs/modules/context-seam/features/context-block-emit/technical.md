# Context Block Emit — Technical View

> Module: **Context Injection Seam** (`context-seam`) · Layer: `framework-internals` · Feature slug: `context-block-emit`

## Module Boundaries

- `runtime/scripts/context-seam.mjs` — `formatContextBlock`, `buildInjection`,
  and the `BLOCK_OPEN` / `BLOCK_CLOSE` markers.
- `runtime/hooks/lib/context-seam-emit.mjs` — `emitContext`, the side-effect-free
  emit logic (extracted so the prompt gate can reuse it in-process).
- `runtime/hooks/context-seam-inject.mjs` — a thin `UserPromptSubmit` hook entry
  that reads stdin then calls `emitContext`.
- `runtime/hooks/agent-entry-prompt-gate.mjs` — the cross-platform (`.mjs`) gate
  that imports `emitContext` and calls it in-process. It emits the block ONLY when
  the framework is loaded (sentinel fresh); until then it emits only the load
  directive, so the directive can never be buried under the context block (#240 /
  the always-load fix).

## Entry Points

- `formatContextBlock(content)` → `\`${BLOCK_OPEN}\n${content}\n${BLOCK_CLOSE}\``.
- `buildInjection(projectRoot, options?)` → the block string, or `''` when there
  is nothing to inject.
- `context-seam-inject.mjs` (executable) — resolves project root, short-circuits
  when paqad is disabled, writes the block to stdout, always exits 0.

## Data Model / Schema

- `BLOCK_OPEN = '[paqad-context]'`, `BLOCK_CLOSE = '[/paqad-context]'`.
- `buildInjection` forwards `options` to `readContextUnderBudget` and accepts an
  optional `path` override and `env` for path resolution.

## API / Interface Contract

- Project root: `resolveProjectRoot()` from `lib/paqad-disabled.mjs`
  (CLAUDE_PROJECT_DIR / PAQAD_PROJECT_ROOT / cwd).
- Disabled check: `isPaqadDisabled(projectRoot)` → emit nothing.
- F3 master switch: `isRagEnabledValue(readLayeredKey(projectRoot, 'rag_enabled',
  'PAQAD_RAG_ENABLED'))` → emit nothing when off. Default off mirrors the
  `FRAMEWORK_CONFIG_SPECS` `rag_enabled` default (`false`); only an explicit
  truthy token (`true`/`1`/`yes`/`on`) enables injection.
- The prompt gate (`agent-entry-prompt-gate.mjs`) imports `emitContext` and calls
  it in-process, but ONLY when the sentinel is fresh (framework loaded). When the
  framework is not loaded it emits the load directive alone and suppresses the
  context block, so the directive owns the top of context (#240). The standalone
  `context-seam-inject.mjs` entry stays available and behaves identically when run
  directly.

## State Management

- Stateless. The hook drains stdin (a no-op) only to avoid hanging on the host's
  prompt-payload pipe, then emits and exits.

## Failure Modes

- Missing helper / runtime fault → the bash `|| true` and the hook's own
  try/catch both ensure exit 0 with no emission.
- Host that does not close stdin → `</dev/null` from the gate guarantees EOF.

## Tests

- `tests/unit/runtime/context-seam.test.ts` — `formatContextBlock` fence;
  `buildInjection` emits a block when present and `''` when absent.
- `tests/unit/runtime/context-seam-inject.test.ts` — the hook emits the block on
  an existing artifact, nothing when absent, a pure no-op when disabled, and
  honours `PAQAD_CONTEXT_ARTIFACT`; the `.mjs` gate suppresses the block and emits
  only the load directive when the framework is not loaded, injects the block once
  the sentinel is fresh, and stays a no-op when disabled.
