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
 *  2. The framework load order (rules / stack / design-system / workflows) and
 *     the workflow-handling note — formerly inlined into every entry file.
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

## 2. Route first — pick one workflow, then load only what it needs

Before loading the project contract, decide what this message is. As your FIRST action, pick **exactly one** of these 10 workflows by intent, and narrate the pick in one \`▸ paqad\` line (see the narration contract):

1. **feature-development** — any change to code. This includes bug fixes, refactors, cleanups, and migrations; the name is just "development". Scope is every code change **except** a change confined to the \`docs/\` and \`.paqad/\` directories: a change that touches any other directory is feature-development even when it also edits files under \`docs/\` or \`.paqad/\`, and only a change made entirely within \`docs/\` and/or \`.paqad/\` is out of scope.
2. **project-question** — answer a question about the project. Check \`docs/\` first, then the code. No code change.
3. **documentation-update** — the "create documentation" foundation stage.
4. **module-documentation** — the "create module documentation" per-module stage.
5. **pentest** — a full security test (backed by **pentest-retest** for re-runs).
6. **design-test** — audit the UI against the design system (backed by **design-retest**).
7. **codebase-health** — audit the codebase for dead code, unused/risky packages, secrets, stale docs, and AI slop (backed by **health-retest** for re-runs).
8. **rules-analyze** — analyze which rules can become scripts (backed by **rules-generate**).
9. **root-cause-analysis** — post-incident analysis.
10. **no workflow** — small talk or anything that is not one of the above. Load nothing, no RAG; just reply.

How to decide:

- **Read first, then decide.** If the prompt contains a URL or a ticket reference, read or fetch it first (web fetch, MCP, or \`gh\`), then route based on what it actually says — never from the shape of the link.
- **Any code change is feature-development**, however it is phrased.
- **Understand intent, not keywords.** "run a security review", "let's do a pentest", and "check the app for vulnerabilities" all mean pentest. Typos do not matter.
- **Ask only when genuinely torn.** If two real workflows are equally likely, ask the user (via \`AskUserQuestion\` on Claude Code, inline on other hosts) and offer "no workflow".

Routing runs on **every** message, and it is stateful — it does not reset:

- **Switching pauses, it does not reset.** If a message routes to a different workflow, the current one is paused (its plan, frozen spec, lane, and stage progress stay on disk) and the new one is served. Say you are switching.
- **Resuming continues.** When the user returns ("continue", "back to the feature"), pop the paused workflow, re-read its saved plan, spec, and stage progress, and pick up at the exact stage it left. Do not re-plan or re-write the spec. For feature-development, reload the rules at this point.
- **New work is not a resume.** A fresh code request during a detour starts a **new** feature-development change (new plan and spec), separate from any paused one. If "continue" is ambiguous about which change it means, ask.

## 3. Load only what the routed workflow needs

Always load these and treat them as the canonical contract for documentation and implementation behavior:

- \`docs/instructions/stack\`
- \`docs/instructions/design-system\`
- \`docs/instructions/workflows\` (the feature-development and delivery-policy workflows that govern how a change is built and shipped)

**Rules load only for \`feature-development\` (issue #336).** When (and only when) you routed to feature-development, load the rules — artifact-first (issue #284): when \`.paqad/context/session-context.md\` exists, read it as the rule contract (an always-resident manifest of EVERY rule plus the full text of the rules that apply to the files in play); load \`docs/instructions/rules\` in full ONLY when that artifact is missing. The other 9 outcomes load **no** rules and run **no** rule-scripts. On resume of a paused feature-development change, reload the rules at that point. Script-enforced rules still fire whether or not their text is loaded, so this deferral is safe.

**RAG** (when \`rag_enabled\`): all 9 real workflows use retrieved context, scoped to the workflow; **no workflow** retrieves nothing.

When you work inside a specific module, also load that module's documentation under \`docs/modules/\` as those rules direct.

### Workflow handling

- Interpret short Paqad workflow prompts such as \`create documentation\` as workflow invocations.
- Do not ask the user to choose a document type when a Paqad workflow already matches the request.
- Generate or update the canonical project documentation and registries defined by Paqad instead of defaulting to generic templates.

## 4. Confirm the load (sentinel)

Once steps 1–3 are complete, write \`.paqad/.agent-entry-loaded\` with a JSON payload of \`{ "loaded_at": "<ISO timestamp>", "entry_file": "<the entry file you were given, e.g. CLAUDE.md>", "framework_version": "<resolved version>" }\`. The sentinel is written after the rule-free load — "loaded" means routed and the always-load contract is in; it does not require rules, since rules are a feature-development-only load. On Claude Code the PreToolUse gate blocks Edit/Write/NotebookEdit until this sentinel exists; read-only tools stay available so you can finish steps 1–3 first. Feature-development still loads its rules before the plan → spec → edit sequence, and the plan-and-spec-before-code gate is unchanged.

The sentinel is invalidated automatically if the entry file, \`.paqad/framework-path.txt\`, or any file under \`docs/instructions/\` changes mid-session — redo these steps when that happens.

---

${buildNarrationContractBody()}

---

${buildDecisionPauseContractBody()}
`;
}
