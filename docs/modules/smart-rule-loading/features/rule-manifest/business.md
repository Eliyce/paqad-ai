# Rule Manifest — Business View

> Module: **Smart Rule Loading** (`smart-rule-loading`) · Layer: `framework-internals` · Feature slug: `rule-manifest`

## Overview

The rule manifest is a compact, always-resident index of every rule that governs
the repo. Each line names the rule (id, title), its severity, the file/workflow
triggers that make it apply, a one-line summary, and whether the rule is
script-enforced. It is the omission insurance and the bulk of the rule-token cut:
the model always knows a rule exists and when it applies, even before its full
text is loaded.

The technical contract lives at [`technical.md`](./technical.md).

## User Roles

- **Developer** — gets the full rule landscape in a few thousand tokens instead of
  ~50K of raw rule text.
- **paqad-ai contributor** — relies on the manifest listing every compiled rule so
  deferring full text (F5) can never silently drop a rule.

## User Flows

- **Regenerate on compile:** whenever rules recompile (onboarding / refresh), the
  manifest is rewritten from `compiled-rules.json` into the seam artifact.
- **Inject on prompt:** when the injection accelerator is on (`rag_enabled`), the
  seam emits the manifest in the session context.

## Business Rules

- Lists EVERY compiled rule — completeness is the whole point (omission insurance).
- Stays lean: summaries are collapsed to one capped line so the manifest costs a
  few thousand tokens even for a large rule set.
- A `⚙` glyph marks a script-enforced rule (its enforcement does not depend on its
  text being loaded).
- Generation is unconditional and machine-local; whether the manifest is injected
  is the seam's `rag_enabled` decision.
- A failure to generate is non-fatal — it only means the manifest is not refreshed
  this run.

## Triggers & Side Effects

- Writes the seam artifact `.paqad/context/session-context.md` (gitignored).

## Error States

- No compiled rules → nothing written (the seam injects nothing for rules: today's
  full-load behavior remains the fallback).

## Glossary

- *manifest* — the compact one-line-per-rule index injected into context.
- *trigger* — a declared file/workflow glob that makes a rule apply (drives F5).
- *script-enforced* — a rule backed by a verification script (F6), marked `⚙`.
