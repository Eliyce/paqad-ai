---
'paqad-ai': minor
---

fix(#573): build the prompt-route seam so a change gets a real lane, and enforce stage isolation instead of trusting it

Stage isolation (#567) never ran on Claude Code, and nothing detected that. The cause was
a build defect, not model behaviour: `tsup.config.ts` never emitted
`dist/pipeline/prompt-lane.js`, which the `UserPromptSubmit` hook imports inside a
soft-fail. The import threw `ERR_MODULE_NOT_FOUND` on every prompt of every installed
copy and exited 0, so the prompt router never ran, the recorded lane was always null, and
the router's "graduated or full lane" precondition for isolation was never satisfied.
`dist/planning/ticket-ref-detect.js` was missing the same way, so the ticket-intake hook
was dead too. Unit tests import these modules through the source alias, so CI stayed
green the whole time.

Both entries are now built, and a parity test derives the expectation from the hook
sources: every `../../dist/<path>.js` a runtime hook imports must be a declared tsup
entry, so a newly added hook cannot ship a dangling import. Hooks no longer swallow a
failed compiled-half load either; they append one line to `.paqad/logs/hook-failures.log`
through a shared helper that never throws.

`writeStageAgents()` now runs from the update path, not only from onboarding. An
already-onboarded project upgrades through `paqad-ai update`, which previously rendered
the new `SubagentStop` hook and none of the six agents it points at.

With a real lane available, a skipped isolation is detectable and enforced. Every
stage-evidence row records the `agent` that wrote it (`orchestrator`, or the dispatched
`paqad-<stage>`), and on a graduated or full lane on a subagent-capable host a bundle
with no `context-efficiency.jsonl` fails the completeness gate by name instead of
reading "Safe to merge". This stays silent on the fast lane, on hosts without subagent
dispatch, and whenever the lane is unresolved, so it cannot false-fail legitimate work.

Two honesty fixes in the same gate, both found during the RCA: a stage whose recorded end
precedes its own start is now an ordering violation rather than folding to `complete`,
and a gate blocked by an ordering violation names the violated pair instead of printing
the literal, unactionable `missing stage(s): []`.
