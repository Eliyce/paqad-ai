import { buildDecisionPauseContractBody } from './decision-pause-contract-writer.js';
import { buildNarrationContractBody } from './narration-contract-writer.js';

/**
 * Issue #229 — the single core-owned framework bootstrap.
 *
 * Every provider's entry file (CLAUDE.md, AGENTS.md, GEMINI.md, …) is now a lean
 * stub that does one thing: resolve `.paqad/framework-path.txt` to the framework
 * install directory (`~/.paqad-ai/current`, a symlink to this package's
 * `runtime/`) and load+follow the bootstrap doc that lives there
 * (`AGENT-BOOTSTRAP.md`, the rendered output of this builder).
 *
 * The bootstrap is the ONLY place the load order and the contracts live now:
 *
 *  1. **Enablement check FIRST.** It reads `paqad_enable` straight off the
 *     existing config surfaces (no new artifact) with the exact precedence the
 *     shell/TS/.mjs primitives use, and halts before loading anything when paqad
 *     is off — so a disabled project loads zero `docs/instructions` and zero
 *     `docs/modules` on every provider.
 *  2. The framework load order (rules / stack / design-system) and the
 *     workflow-handling note — formerly inlined into every entry file.
 *  3. The sentinel write.
 *  4. The FULL narration contract and the FULL decision-pause contract inline
 *     (including the per-adapter UI table — its `claude-code` row is what keeps
 *     the Claude Code decision "tray" / `AskUserQuestion` firing). Both are
 *     sourced from the canonical body builders so the bootstrap cannot drift.
 *
 * The rendered doc is committed at `runtime/AGENT-BOOTSTRAP.md` (it ships in the
 * install and is reached via the symlink — never written into a project). A
 * golden test (`tests/unit/onboarding/agent-bootstrap-writer.test.ts`) asserts
 * the committed file is byte-identical to this builder; regenerate it with
 * `pnpm vitest run agent-bootstrap-writer -u`.
 */

const BOOTSTRAP_HEADER =
  '<!-- managed by paqad-ai — generated from src/onboarding/agent-bootstrap-writer.ts; regenerate with `pnpm vitest run agent-bootstrap-writer -u`. Do not edit by hand. -->';

export function buildAgentBootstrapDocument(): string {
  return `${BOOTSTRAP_HEADER}

# Paqad Framework Bootstrap

This is the framework entry that every provider's lean entry file points to (it is reached by resolving \`.paqad/framework-path.txt\` to the paqad install directory and loading this file from there). Work through it top to bottom before doing any repository work.

## 1. Enablement check — do this first

Decide whether paqad is enabled for this project BEFORE loading anything else. Resolve \`paqad_enable\` across these surfaces, highest precedence first (first match wins):

1. **\`PAQAD_DISABLED\` environment variable** — if set to \`1\`, \`true\`, \`yes\`, or \`on\` (case-insensitive), paqad is **OFF**, full stop. (Most hosts do not expose environment variables to you. If you cannot read it, move to the next surface.)
2. **\`PAQAD_ENABLE\` environment variable** — if set, it wins over the files below.
3. **\`.paqad/.config\`** (your git-ignored, dev-local file) — a \`paqad_enable=<value>\` line.
4. **\`.paqad/configs/.config.app\`** (the tracked, team-shared file; if your team split knobs across several \`.config.*\` files, the one whose filename sorts last wins) — a \`paqad_enable=<value>\` line.
5. **Nothing set anywhere ⇒ ON** (the default).

A value of \`false\`, \`0\`, \`no\`, or \`off\` (case-insensitive) means **OFF**. \`true\`/\`1\`/\`yes\`/\`on\`, or any unrecognized value, means **ON**.

**If paqad resolves to OFF:** stop here. Load no \`docs/instructions\`, no \`docs/modules\`, no rules, and no contracts; write no sentinel; add no paqad behavior. Just act as a normal assistant. Do not block, warn, or mention paqad.

**If paqad resolves to ON:** continue.

## 2. Load the project contract

Load these and treat them as the canonical contract for workflow routing, documentation, and implementation behavior:

- \`docs/instructions/rules\`
- \`docs/instructions/stack\`
- \`docs/instructions/design-system\`

When you work inside a specific module, also load that module's documentation under \`docs/modules/\` as those rules direct.

### Workflow handling

- Interpret short Paqad workflow prompts such as \`create documentation\` as workflow invocations.
- Do not ask the user to choose a document type when a Paqad workflow already matches the request.
- Generate or update the canonical project documentation and registries defined by Paqad instead of defaulting to generic templates.

## 3. Confirm the load (sentinel)

Once steps 1–2 are complete, write \`.paqad/.agent-entry-loaded\` with a JSON payload of \`{ "loaded_at": "<ISO timestamp>", "entry_file": "<the entry file you were given, e.g. CLAUDE.md>", "framework_version": "<resolved version>" }\`. On Claude Code the PreToolUse gate blocks Edit/Write/NotebookEdit until this sentinel exists; read-only tools stay available so you can finish steps 1–2 first.

The sentinel is invalidated automatically if the entry file, \`.paqad/framework-path.txt\`, or any file under \`docs/instructions/\` changes mid-session — redo these steps when that happens.

---

${buildNarrationContractBody()}

---

${buildDecisionPauseContractBody()}
`;
}
