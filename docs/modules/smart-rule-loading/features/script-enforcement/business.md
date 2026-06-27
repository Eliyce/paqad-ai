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

- **At edit (PreToolUse):** before an Edit/Write, the working-tree state from prior
  in-turn edits is checked; a violation already on disk fails loud before more is
  piled on.
- **At turn end (Stop):** the full change is checked; a blocking violation is
  surfaced to the model.

## Business Rules

- Enforcement is INDEPENDENT of the injection accelerator (`rag_enabled`) — it is
  safety, not context.
- Gated only by: paqad enabled, `rule_compliance` mode (off | warn | strict;
  default warn), and a rule-script map existing.
- Strict mode blocks on a deterministic violation; warn mode surfaces it without
  blocking; off does nothing.
- The common case — no rule-script map — is a fast no-op (no cost on normal edits).
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
