# Rule Authoring Guide (maintainer-facing)

This file documents the contract for every rule pack under `runtime/**/rules/**`.
It is **not** a rule and is never resolved into a project — it lives at the
runtime root, outside any `rules/` directory. Read it before adding or editing a
rule pack. The guard test `tests/unit/content/rule-quality.test.ts` enforces the
machine-checkable parts.

## What a rule is

A rule is a **constraint on the code or artifact**, phrased as a how-to, that:

- **Is actionable** — tells the agent what to do or not do, concretely. "Use
  Form Requests for write validation" — not "validate input appropriately."
- **Is checkable** — a reviewer can confirm or refute it against a diff.
- **Is true** — only state facts that hold for the named framework/tool. Never
  invent APIs, commands, config keys, or concepts. When unsure, verify against
  the framework's own documentation before writing it.
- **Is framework- or project-specific** — if the line is true of every codebase
  ("match conventions", "keep things aligned", "document when it changes"), it
  says nothing. Delete it.

## What a rule is NOT

- **Not a workflow.** No `## Trigger`, no `### Step N`, no `run_id`, no skill
  ordering, no coverage matrices. Those are framework workflows; they live in
  the runtime and are loaded at agent-entry, not copied into the project.
  (Legacy exceptions — `coding/rules/design-test.md`, `design-retest.md`,
  `security/rules/pentest.md` — predate this rule and are allowlisted in the
  guard pending relocation.)
- **Not framework plumbing.** No references to `.paqad/`, phases, lanes, handoff
  artifacts, cache/context-hit metrics, or skill caching. A project must be able
  to delete `.paqad/` with no dangling rule references.
- **Not a restatement of `module-map.yml`.** Module ownership and boundaries are
  defined per-project in `docs/instructions/rules/module-map.yml`. Stack rules
  must point to it, not re-describe generic "keep modules cohesive" advice.
- **Not a restatement of an always-on rule.** The base, capability-level, and
  `_shared` rules ship to every project alongside the stack rules. A stack rule
  may _sharpen_ one with stack-specific detail (name the library, the file, the
  API), but must not near-verbatim repeat it — the consumer would read the same
  guidance twice. The guard flags a stack bullet that overlaps an always-on
  bullet too closely.

## Format

- Start with a single H1 naming the rule pack (`# Laravel API`).
- Prefer a flat bullet list of imperative rules. Group with H2s only when the
  pack is large (see `node-cli`).
- Keep each rule one idea. Name the real API/file/command it concerns.
- Aim for the quality bar set by `stacks/node-cli`, `node-library`,
  `node-service`, and the `nextjs`/`nestjs` conventions.
