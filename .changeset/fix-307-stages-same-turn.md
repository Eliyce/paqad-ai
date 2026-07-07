---
'paqad-ai': minor
---

Stages gate: same-turn unblock that actually works, sentinel bootstrap un-deadlocked, and stage narration everywhere (#307).

- `paqad:stage` markers are now parsed at the pre-mutation seam too, so markers emitted earlier in the same turn clear the block-forward gate immediately — not only after Stop.
- New `paqad-ai stage <start|end> <stage>` CLI verb replaces the never-shipped `scripts/se-mark.ts` as the shell escape hatch; the block message, framework bootstrap, and decision-skill docs now name only remediations that exist on an onboarded project.
- The write of `.paqad/.agent-entry-loaded` is exempt from both the agent-entry gate and the stages gate: turn one can complete the bootstrap it is being asked to perform.
- Narration and ledger are both non-negotiable: every stage-evidence row minted from markers (pre-mutation sweep, Stop parse, CLI) is narrated back to the developer as a `▸ paqad` line via the host's user-message channel; allow-path advisories use `systemMessage` instead of invisible stdout.
- Guardrails: a packaging-truth test suite pins that every runnable path/verb named in user-facing remediation surfaces resolves in the published package, and `src/stage-evidence/**` now holds a 100% coverage floor (statements, branches, functions, lines).
- Completion-backstop over-block fixed (decision `D-01KWYDTDZ24CV802R2HGDS4RH4`), removing two false blocks that hit every onboarded repo's first code change: (1) an implementation-drift canonical doc that does not exist on disk is no longer treated as an unresolved obligation — a code change cannot stale a framework-assumed doc (`docs/maintainers/architecture-map.md`, `docs/modules/README.md`) the project never created; existing drift docs are still flagged and required per-module docs stay enforced; (2) test-evidence strength is a provider-workflow concern the agent-independent backstop cannot collect, so at backstop origins it now escalates (visibly) instead of hard-blocking — in-session and CI still enforce it.
