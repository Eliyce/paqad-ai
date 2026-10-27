# Script Enforcement — Business View

> Module: **Smart Rule Loading** (`smart-rule-loading`) · Layer: `framework-internals` · Feature slug: `script-enforcement`

## Overview

Script enforcement is what makes lazy rule-text loading safe. A rule that has a
verification script is enforced against the working tree on every edit and at
turn end — whether or not its text was loaded into context. So even when the
manifest defers a rule's full text, a violation of that rule is still caught.

The technical contract lives at [`technical.md`](./technical.md).

## User Roles

- **Developer** — protected from shipping a scripted-rule violation, with no need
  to keep every rule's text in their head or in context.
- **paqad-ai contributor** — relies on enforcement being independent of what is in
  context, so trigger-loading can defer text without weakening safety.

## User Flows

- **At edit (PreToolUse):** before an Edit/Write, the rules that can block (deterministic,
  checking the changed files) are checked against the change so far, several scripts at a time;
  a violation already on disk fails loud before more is piled on. A script marked per-file
  re-checks only the files that changed since its last run.
- **When the edit check runs long:** the check has a time budget (`rule_gate_budget_ms`, 6 s by
  default). When it runs out, the edit goes ahead, the model is told the checks did not finish,
  and the same checks run at the end of the turn and block there if anything fails. A timeout
  never refuses an edit.
- **At turn end (Stop):** the full change is checked against every rule script, including the
  hints and the rules that look at the whole tree; a blocking violation is surfaced to the
  model.

## Business Rules

- Enforcement is INDEPENDENT of the injection accelerator (`rag_enabled`) — it is
  safety, not context.
- Gated only by: paqad enabled, `rule_compliance` mode (off | warn | strict;
  default warn), and a rule-script map existing.
- Strict mode blocks on a deterministic violation; warn mode surfaces it without
  blocking; off does nothing.
- The common case — no rule-script map — is a fast no-op (no cost on normal edits).
- Moving a check from the edit to the turn end never loosens it: every rule that blocks still
  blocks on the same change. `rule_gate_pre_edit=all` with `rule_gate_concurrency=1` brings back
  the old edit check (every script, one after another).
- An infra error never wedges the agent; the git/CI backstop remains the
  non-bypassable layer.

## Triggers & Side Effects

- Reads the working tree and runs the registered rule scripts (hash-cached).

## Error States

- Infra failure (missing build, script error) → soft-fail, the change proceeds;
  enforcement still happens at the git/CI backstop.

## Glossary

- *scripted rule* — a rule backed by a verification script (`⚙` on the manifest).
- *deterministic finding* — a hard violation; the basis for strict-mode blocking.
- *rule_compliance* — the mode knob: off | warn | strict (default warn).
