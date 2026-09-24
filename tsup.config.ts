import { readFileSync } from 'node:fs';

import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/index': 'src/cli/index.ts',
    // Subpath export consumed by the rules-as-scripts skill .mjs wrappers
    // (issue #89) via `import 'paqad-ai/rule-scripts'` self-reference.
    'rule-scripts/index': 'src/rule-scripts/index.ts',
    // Capability Kernel executor (buildout F3) — imported by the
    // runtime/hooks/capability-gate.mjs host hook as a dist-built bundle, the
    // same dedicated-entry pattern the rule-scripts hook wrapper uses.
    'kernel/gate': 'src/kernel/gate.ts',
    // Stage-evidence live writer (RCA fix A) — lazy-imported by the
    // runtime/hooks/stage-writer.mjs PreToolUse hook as a dedicated dist bundle,
    // the same pattern as kernel/gate, so the writer path stays light.
    'stage-evidence/live-writer': 'src/stage-evidence/live-writer.ts',
    // Stage-entry narration (RCA Step 5a) — lazy-imported by the
    // runtime/hooks/stage-writer.mjs PreToolUse hook to print the "▸ paqad · <stage>"
    // line the first time a change enters a stage (Claude systemMessage channel).
    'stage-evidence/narration': 'src/stage-evidence/narration.ts',
    // Stage-marker parser (RCA fix, Step 3) — lazy-imported by the
    // runtime/hooks/stage-marker-parse.mjs Stop hook to record the non-mutation
    // stage markers from the transcript.
    'stage-evidence/marker-parse': 'src/stage-evidence/marker-parse.ts',
    // Ledger session-id resolver (issue #380, Issue 1) — lazy-imported by the
    // runtime/hooks/agent-entry-session-start.mjs SessionStart hook to align the
    // single-slot session cache to the live host session id (extends "bug #5"
    // from finalization to bundle minting), same dedicated-entry pattern as above.
    'rag-ledger/session': 'src/rag-ledger/session.ts',
    // In-flight bundle adoption (issue #404) — lazy-imported by the same SessionStart
    // hook, right after the cache alignment above, so a rotated session id is repointed
    // at the in-flight bundle before the agent records anything and the change cannot
    // fork into a second bundle. Dedicated entry, same pattern as the resolver.
    'feature-evidence/adoption': 'src/feature-evidence/adoption.ts',
    // Disabled-session audit recorder (buildout F2b) — lazy-imported by
    // verify-backstop.mjs's disabled branch as a small dist bundle, so the
    // disabled path stays light (no full dist/index.js load).
    'session-ledger/disabled-audit': 'src/session-ledger/disabled-audit.ts',
    // Repo-internal benchmark tooling (issue #285) — the scripts/*.mjs footprint and
    // findings-stats CLIs import these two primitives from dist, the same dedicated-entry
    // pattern the runtime hooks use, so no tokenizer/ledger logic is re-implemented.
    'context/tokenizer-cache': 'src/context/tokenizer-cache.ts',
    'session-ledger/project-ledger': 'src/session-ledger/project-ledger.ts',
    // Prompt-route seam (issue #573) — lazy-imported by the
    // runtime/hooks/agent-entry-prompt-gate.mjs UserPromptSubmit hook to classify the
    // prompt, pick the lane and stash it for the next change-open. It was imported with no
    // entry here from #324 until #573, so the import threw ERR_MODULE_NOT_FOUND on every
    // prompt of every installed copy and the recorded lane was always null.
    'pipeline/prompt-lane': 'src/pipeline/prompt-lane.ts',
    // Session-start dirty-file baseline (issue #576, Finding 1b) — lazy-imported by the
    // runtime/hooks/agent-entry-session-start.mjs SessionStart hook to snapshot the already-dirty
    // tracked files so the completion backstop can subtract inherited dirt. Dedicated entry, same
    // pattern as the prompt-lane seam above (a missing entry would throw ERR_MODULE_NOT_FOUND).
    'pipeline/dirty-baseline': 'src/pipeline/dirty-baseline.ts',
    // Ticket-reference detector (issue #573) — lazy-imported by the
    // runtime/hooks/ticket-intake-prompt.mjs UserPromptSubmit hook. Same missing-entry bug
    // as the seam above, from #330.
    'planning/ticket-ref-detect': 'src/planning/ticket-ref-detect.ts',
    // Stage-agent completion recorder (issue #567) — lazy-imported by the
    // runtime/hooks/stage-agent-completion.mjs SubagentStop hook to append one
    // context-efficiency row when a paqad stage agent finishes, the same dedicated-entry
    // pattern as the other runtime hooks.
    'stage-isolation/subagent-completion': 'src/stage-isolation/subagent-completion.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node22',
  splitting: false,
  shims: true,
  external: ['@huggingface/transformers', 'openai', 'voyageai'],
  outDir: 'dist',
  // Inject package version at build time so VERSION never drifts from
  // package.json. Vitest has its own define block in vitest.config.ts.
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
});
