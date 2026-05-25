# Decision Pause Contract: ship the full resolution flow to every provider via one managed external doc + per-adapter UI shim

## TL;DR

Today, `buildDecisionPauseContractSection()` emits a two-paragraph stub into every provider entry file. The **resolution flow** ("write packet → AskUserQuestion → move pending→resolved with `chosen`/`rationale`/`resolved_at`") and the **fallback** are _manually pasted_ into `CLAUDE.md` after onboarding — which means (a) it's redone on every onboarding, (b) it bloats entry files, and (c) only Claude Code is covered; the other nine adapters silently skip the contract.

Fix: extract the canonical contract into **one** managed file at `.paqad/decision-pause-contract.md`, written idempotently during onboarding alongside the existing `.paqad/*` artifacts. Each provider entry file gets a thin pointer + a short, adapter-specific UI note. Add a small **adapter-side UI shim** so Cursor/Windsurf/Gemini/Aider/Copilot/Continue/Junie/Antigravity/Codex each get phrased equivalents of "use your interactive UI; otherwise wait for `resolved/D-{N}.json` to appear." Extend `refresh` so the pointer + managed file re-converge on framework updates.

---

## Pre-flight (before any implementation starts)

This work touches the cross-adapter generator and 10 provider templates — anything on `main` related to adapters can collide with PR #58's recent sweep. Before branching off:

```bash
git fetch origin main
git checkout main
git pull --ff-only origin main
```

Then branch from fresh `main`. If `git pull --ff-only` refuses (diverged local main), resolve explicitly — do **not** force-reset. Re-run `pnpm install` if `pnpm-lock.yaml` changed. Run the cross-adapter determinism tests (`tests/unit/adapters/cross-adapter.test.ts`) before touching `provider-entry-contract.ts` — they're the canonical guard that all 10 adapters stay aligned.

This applies to every PR slice of this ticket, not just the first one.

---

## Current state — verified against `main` @ 8fbde52

### What already works (reuse, don't rebuild)

| Primitive                            | File / path                                                                                                                                                                        | Notes                                                                                                                                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generator function                   | `src/adapters/shared/provider-entry-contract.ts:1-7` (`buildDecisionPauseContractSection`)                                                                                         | Currently emits only the rule paragraph: "Before implementing any choice…write a Decision Packet to `.paqad/decisions/pending/D-{N}.json` and stop work…" — **no categories, no resolution flow, no UI guidance**. Takes zero parameters. |
| Section parser                       | `src/adapters/shared/provider-entry-contract.ts` — `extractDecisionPauseContractSection()`                                                                                         | Used by health/refresh to detect drift. Still tolerates legacy entries with the old `Categories:` block for back-compat (per #54).                                                                                                        |
| Template slot                        | `runtime/templates/agent-configs/*.md.hbs` — `{{{decisionPauseContract}}}` (triple-brace raw)                                                                                      | Identical slot across all 10 adapter templates: `claude.md.hbs`, `codex.md.hbs`, `antigravity.md.hbs`, `gemini.md.hbs`, `junie.md.hbs`, `cursor.md.hbs`, `copilot.md.hbs`, `windsurf.md.hbs`, `continue.md.hbs`, `aider.md.hbs`.          |
| Template engine                      | `src/templates/engine.ts`                                                                                                                                                          | Handlebars-based; pluggable slot fill from adapter context.                                                                                                                                                                               |
| Adapter rendering pipeline           | `src/adapters/shared/base-adapter.ts:53-61` (`generateConfig()` → `TemplateEngine.render()`) and `src/adapters/factory.ts:21-43` (10 hard-coded adapters)                          | Every adapter inherits the slot through `BaseAdapter`.                                                                                                                                                                                    |
| Decision categories canonical source | `src/planning/decision-packet.ts:3-10` — `DECISION_CATEGORIES` (`component-reuse`, `create-vs-reuse`, `shared-abstraction`, `ux-pattern`, `architecture-path`, `workflow-or-tool`) | Already the single source of truth; the generator no longer duplicates it (cleaned up in #54).                                                                                                                                            |
| Managed-`.paqad/` writer pattern     | `src/onboarding/manifest-writer.ts:54-70` — `writeJsonPreservingTimestamp()`                                                                                                       | Idempotent writes: re-runs produce byte-identical output when payload unchanged. Established convention for managed artifacts (`onboarding-manifest.json`, `project-profile.yaml`, `framework-version.txt`, `compiled-rules.json`, …).    |
| Cross-adapter determinism guard      | `tests/unit/adapters/cross-adapter.test.ts:55-82`                                                                                                                                  | Asserts all 10 adapters emit identical normalized contract output. Our changes must keep this test green (with the new pointer shape).                                                                                                    |
| Health drift check                   | `src/health/provider-entry-contract.ts:7,35`                                                                                                                                       | Already validates contract presence/consistency across entry files; will need to learn the new "pointer + managed file present" invariant.                                                                                                |
| Refresh scaffolding                  | `src/cli/commands/refresh.ts`                                                                                                                                                      | Sub-targets exist (`--stack`, `--design-system`, `--context`) but **no `--providers` / adapter-entry refresh**. Adding it is part of this ticket.                                                                                         |

### What does **not** exist (genuinely new work)

| Gap                                                          | Evidence                                                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Resolution flow + fallback in the generator**              | The current 7-line generator emits zero procedural detail. The full flow exists only in this repo's hand-edited `CLAUDE.md` (lines 16-26).                                                              |
| **`.paqad/decision-pause-contract.md` managed file**         | No `.md` managed artifact exists under `.paqad/` today. All current managed artifacts are JSON/YAML/TXT. We need a managed-markdown pattern with a `<!-- managed by paqad-ai — do not edit -->` header. |
| **Per-adapter interactive-UI primitive abstraction**         | Zero hits across `src/adapters/`. No interface, no factory, no map from adapter→UI primitive name. Cursor/Windsurf/etc. currently have **no** documented decision-pause UI behavior.                    |
| **`refresh --providers` (or equivalent re-render path)**     | `refresh.ts` has no entry-file re-render. If we ship the managed-doc pointer, framework updates that change the contract text need a way to converge user repos.                                        |
| **Snapshot/golden tests for full adapter entry-file output** | Only normalized-section asserts exist. Adding pointer shape + managed-file emission warrants a small set of golden files (per adapter) to lock the shape.                                               |

### Corrections / context the original ticket missed

- **#54 already removed the hardcoded `Categories:` block** from the generator. The ticket's framing — "the contract is technically present but not actionable" — is correct, but the categories duplication concern is moot. Re-state the problem as: "the resolution _flow_ + _fallback_ are never emitted, and there is no per-adapter UI primitive."
- The current generator emits only the rule paragraph (not the "rule + categories" the ticket implies).
- "agents.md" is **not** a standalone adapter in `src/adapters/factory.ts`; the 10 adapters are claude-code, codex-cli, antigravity, gemini-cli, junie, cursor, github-copilot, windsurf, continue, aider. The ticket's provider list should be aligned with that switch statement to avoid a phantom-provider TODO.
- Templates live at `runtime/templates/agent-configs/`, not `~/.paqad-ai/current/templates/` — that path is the _installed_ runtime symlink. The change lives in this repo.

---

## Why this matters — 2026 agent-instruction-file reality

External research consensus ([deployhq](https://www.deployhq.com/blog/ai-coding-config-files-guide), [buildbetter.ai's AGENTS.md guide](https://blog.buildbetter.ai/agents-md-complete-guide-for-engineering-teams-in-2026/), [HumanLayer on writing CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md), [Anthropic best practices](https://www.anthropic.com/engineering/claude-code-best-practices), [vibecoding's AGENTS.md guide](https://vibecoding.app/blog/agents-md-guide)):

1. **Entry files load into every session — keep them short.** Frontier models reliably follow ~150-200 instructions; Claude Code's system prompt uses ~50. Inlining a multi-paragraph resolution flow into CLAUDE.md / AGENTS.md / `.cursorrules` / `.windsurfrules` _every session_ is exactly the bloat 2026 best practices warn against.
2. **Pointer + managed doc is the established mitigation.** "Keep the entry file thin; link to deeper canonical docs" is the consensus pattern. Our `.paqad/` layout is already half-way there (everything else under `.paqad/` is canonical-once-written).
3. **AGENTS.md is becoming the cross-tool standard.** Codex CLI, Cursor, Copilot, Windsurf, Aider, Devin all read AGENTS.md; Claude Code falls back to AGENTS.md when no CLAUDE.md exists. Our 10-adapter matrix is right to write per-tool files, but the _contract text_ should converge on one source.
4. **Without the resolution flow, the contract is silently inert.** This is the most common 2026 failure mode of agent rules: the rule is read, but no procedural anchor tells the agent _how_ to pause. Models with strong tool-restraint training will still pause; weaker or older agents won't. The fix is procedural — name the exact UI call (or the exact wait-for-file fallback).

---

## Proposal

### 1. Managed canonical doc — `.paqad/decision-pause-contract.md`

Written during onboarding alongside the other `.paqad/*` artifacts. Contains:

1. The full **rule** (write to `pending/D-{N}.json`, stop, do not continue until `resolved/D-{N}.json` exists).
2. The **categories** list — _sourced from_ `DECISION_CATEGORIES` in `src/planning/decision-packet.ts` so the doc and the runtime can never drift.
3. The **resolution flow** with a small per-adapter table (see §3 below).
4. The **fallback** for non-interactive contexts (wait until the resolved file appears out-of-band).
5. A `<!-- managed by paqad-ai — do not edit; regenerated by paqad refresh --providers -->` header.

Idempotent write via the existing `writeJsonPreservingTimestamp`-style pattern, adapted for markdown: re-onboarding produces byte-identical output unless the canonical text actually changed.

### 2. Thin pointer in every provider entry file

`buildDecisionPauseContractSection()` is rewritten to return a short pointer:

```markdown
## Decision Pause Contract

See `.paqad/decision-pause-contract.md` for the full rule, resolution flow, and fallback. {{adapterUiNote}}
```

That's it. The full text lives in one place. Cross-adapter determinism test still passes — the pointer is identical across all 10 adapters except for the per-adapter UI note.

### 3. Per-adapter UI shim

New small module (e.g. `src/adapters/shared/decision-pause-ui-shim.ts`) that maps each adapter to its interactive-UI primitive. Initial mapping:

| Adapter        | UI primitive           | Note rendered into entry file                                             |
| -------------- | ---------------------- | ------------------------------------------------------------------------- |
| claude-code    | `AskUserQuestion` tool | "In Claude Code, surface options via `AskUserQuestion`."                  |
| codex-cli      | interactive prompt     | "In Codex CLI, prompt the user inline before continuing."                 |
| cursor         | composer chat          | "In Cursor, ask the user in chat and wait for a reply."                   |
| windsurf       | cascade chat           | "In Windsurf, ask the user in cascade and wait for a reply."              |
| gemini-cli     | interactive prompt     | "In Gemini CLI, prompt and wait for a reply."                             |
| github-copilot | chat                   | "In Copilot Chat, ask the user and wait for a reply."                     |
| continue       | chat                   | "In Continue, ask the user and wait for a reply."                         |
| aider          | `/ask` flow            | "In Aider, switch to `/ask` mode for the decision and wait for the user." |
| junie          | interactive prompt     | "In Junie, prompt and wait for a reply."                                  |
| antigravity    | interactive prompt     | "In Antigravity, prompt and wait for a reply."                            |

Adapters with no first-class interactive UI fall back to the file-wait fallback documented in the managed doc.

Phrasing is deliberately conservative — we don't need the shim to be cleverly auto-discovered; we need it to **exist** and to be wrong in only one place if we got an adapter wrong. The note is short (one sentence) so the entry-file budget stays small.

### 4. `paqad refresh --providers`

Extend `src/cli/commands/refresh.ts` with a `--providers` (and implicit-in `--all`) target that:

- Regenerates every adapter entry file from the current templates.
- Rewrites `.paqad/decision-pause-contract.md` from the current canonical source.
- Preserves user-added content **outside** managed sections (use the existing section-extract pattern in `provider-entry-contract.ts` as a precedent for "edit only the managed block").
- Reports drift before writing (dry-run friendly).

### 5. Health check update

`src/health/provider-entry-contract.ts` learns the new invariant: pointer present + `.paqad/decision-pause-contract.md` present + canonical text matches the framework version. Adds a remediation hint pointing at `paqad refresh --providers`.

---

## Architectural decisions worth flagging up front

Each is worth resolving via Decision Packet before implementation:

1. **Where the canonical doc lives.** Options: (A) `.paqad/decision-pause-contract.md` (ticket's choice, mirrors `.paqad/`-as-source-of-truth convention); (B) somewhere under `docs/modules/decision-pause-contract/` and pointed to from `.paqad/`. _Recommendation: A — projects own `.paqad/`; `docs/modules/` is for framework documentation about the contract, not the live runtime artifact._
2. **Pointer style.** Options: (A) one-line pointer; (B) pointer + a 1-sentence "what this is" preamble. _Recommendation: B — entry files are session preludes, and zero-context pointers are easy to ignore._
3. **Adapter UI shim source of truth.** Options: (A) hard-coded map in TS (fastest); (B) per-adapter overridable field in `factory.ts`. _Recommendation: A initially; B if we ever add a custom adapter._
4. **Refresh stomp policy.** Options: (A) stomp the managed file unconditionally (treat user edits as drift); (B) preserve user-added sections outside a managed block. _Recommendation: A for the managed contract file (it should be canonical-only); B for the entry files (which often have user content around our managed block)._
5. **What to do about `AGENTS.md` becoming the cross-tool standard.** Options: (A) leave as-is and write per-adapter files; (B) emit a thin `AGENTS.md` that _also_ points at the managed doc, so tools that pick AGENTS.md before their native file still get the contract. _Recommendation: A for this ticket; track B as a follow-up._

---

## Out of scope

- Implementing the **upstream** decision elicitation logic that _produces_ packets — that's #42 territory.
- Auto-detecting which UI primitive each adapter actually supports at runtime — the shim is a static mapping for now.
- An AGENTS.md cross-tool fallback file (separate follow-up).
- Versioning the contract doc (we re-render from the framework; no migrations needed yet).

---

## Acceptance criteria

### Managed file

- [ ] Onboarding writes `.paqad/decision-pause-contract.md` with rule, categories (sourced from `DECISION_CATEGORIES`), resolution flow, fallback, and a "managed — do not edit" header.
- [ ] Re-onboarding produces a byte-identical file when nothing changed (idempotency check in tests).
- [ ] The categories list in the doc is **imported** from `src/planning/decision-packet.ts` (not duplicated string-by-string).

### Entry-file pointers

- [ ] `buildDecisionPauseContractSection()` returns a short pointer + adapter-specific UI note.
- [ ] All 10 adapter entry files contain the pointer and **nothing else** under "## Decision Pause Contract".
- [ ] `extractDecisionPauseContractSection()` parses both the new pointer shape and the legacy block (for back-compat during the rollout).
- [ ] Cross-adapter determinism test (`tests/unit/adapters/cross-adapter.test.ts`) updated and green: pointers normalize to identical text **modulo** the per-adapter UI note.

### Per-adapter UI shim

- [ ] New shim module maps each of the 10 adapters in `src/adapters/factory.ts` to a one-sentence UI note.
- [ ] Unknown / future adapters fall back to a generic "ask the user and wait for `resolved/D-{N}.json` to appear" note (no crash).

### Refresh

- [ ] `paqad refresh --providers` (and `paqad refresh --all`) regenerates entry files and `.paqad/decision-pause-contract.md`.
- [ ] Dry-run mode reports drift without writing.
- [ ] User content outside the managed block in entry files is preserved.
- [ ] The managed file is stomped if its content drifts from canonical.

### Health

- [ ] `src/health/provider-entry-contract.ts` checks: pointer present + managed file present + managed file content matches canonical. Failure includes the `refresh --providers` remediation hint.

### CLAUDE.md (this repo)

- [ ] The hand-edited "Resolution flow" / "Fallback" sections in this repo's `CLAUDE.md` are removed and replaced with the new pointer. Onboarding regenerates the same shape into consumer repos.

### Tests

- [ ] Unit test: managed-file writer is idempotent.
- [ ] Snapshot test (one per adapter — 10 total) lock the entry-file Decision-Pause block shape.
- [ ] Test for the legacy-format back-compat parse path.
- [ ] `refresh --providers` test for stomp-vs-preserve semantics.

### Docs

- [ ] `docs/modules/decision-pause-contract/` updated: explain the new pointer architecture, the managed file, the per-adapter shim, and the refresh contract.
- [ ] `docs/modules/adapter-onboarding/` cross-refs the new shim.

---

## Risks & mitigations

| Risk                                                                                                                           | Mitigation                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing consumer repos have hand-edited Decision Pause sections (like this repo's `CLAUDE.md`). Migrating stomps their edits. | First `refresh --providers` is opt-in / dry-run by default; release notes call out the migration; legacy parser keeps back-compat for a release. |
| Cross-adapter determinism test breaks because the per-adapter UI note varies.                                                  | Test compares the **pointer body** only; adapter-specific notes are asserted per-adapter in their own snapshot.                                  |
| Refresh stomps user content in entry files.                                                                                    | Use the section-extract pattern already in `provider-entry-contract.ts` — edit only the managed block.                                           |
| One adapter UI shim is factually wrong (e.g. wrong UI primitive name).                                                         | One-sentence shims; easy to fix; bounded blast radius. Adapter owners review the table in the PR.                                                |
| `.paqad/decision-pause-contract.md` drifts from the runtime categories enum.                                                   | Categories sourced from `DECISION_CATEGORIES` at write time; unit test asserts the doc's list equals the enum.                                   |

---

## Where things live

- **`src/adapters/shared/provider-entry-contract.ts`** — pointer-emitting generator.
- **`src/adapters/shared/decision-pause-ui-shim.ts`** _(new)_ — per-adapter UI note map.
- **`src/onboarding/decision-pause-contract-writer.ts`** _(new)_ — idempotent managed-markdown writer.
- **`src/cli/commands/refresh.ts`** — extended with `--providers` target.
- **`src/health/provider-entry-contract.ts`** — new invariant + remediation.
- **`runtime/templates/agent-configs/*.md.hbs`** — `{{{decisionPauseContract}}}` slot unchanged (renders the new short pointer).
- **`docs/modules/decision-pause-contract/`** — explainer for the new architecture.

---

**Sources for the "entry files should be thin" framing:**

- [CLAUDE.md, AGENTS.md & Copilot Instructions: Configure Every AI Coding Assistant — deployhq](https://www.deployhq.com/blog/ai-coding-config-files-guide)
- [AGENTS.md Complete Guide for Engineering Teams (2026) — buildbetter.ai](https://blog.buildbetter.ai/agents-md-complete-guide-for-engineering-teams-in-2026/)
- [Writing a good CLAUDE.md — HumanLayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
- [Best practices for Claude Code — Anthropic](https://www.anthropic.com/engineering/claude-code-best-practices)
- [AGENTS.md Guide (2026): Copilot, Cursor & More — vibecoding](https://vibecoding.app/blog/agents-md-guide)
