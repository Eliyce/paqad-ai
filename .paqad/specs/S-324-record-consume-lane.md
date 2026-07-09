# Spec — S-324 Record and consume the lane

## Behavior
paqad's deterministic classify→lane engine is wired into the live session: the prompt seam decides a lane from the prompt text, the lane is recorded on the change-open ledger row, and two consumers read it — the pre-code gate scales the spec requirement to the lane, and the completion backstop uses the recorded lane instead of a hardcoded `'full'`. A per-module `sensitivity: high` floor in `module-map.yml` forces the full lane for changes touching sensitive paths (a no-LLM, path-based signal).

## Acceptance criteria
- **AC-1** (lane recorded): given a prompt, when the prompt seam runs, then a deterministic lane (`fast|graduated|full`) is computed and stashed, and the next change opened this session carries that lane on its open ledger row (no longer `null`). A non-code prompt (router lane `null`) records nothing.
- **AC-2** (fast relaxes spec): given a change whose recorded lane is `fast`, when the pre-code gate evaluates a feature edit, then only `planning` is required — the `specification` artifact requirement is relaxed (a spec marker-only, or none, does not block). Given `graduated`/`full`, the frozen-spec requirement holds unchanged.
- **AC-3** (sensitivity floor): given an edit whose target path maps to a `sensitivity: high` module, when the pre-code gate evaluates it, then the lane is floored to `full` and the specification requirement holds regardless of the recorded lane.
- **AC-4** (backstop consumes lane): given a recorded lane on the ledger, when the completion backstop builds its verification context, then it uses the recorded lane (fallback `full` when null) — `grep -n "'full'" src/verification/repository/repository-context.ts` no longer shows a hardcoded lane literal for the ratchet call/context.
- **AC-5** (signal→lane mapping): given prompt text, when `resolvePromptLane` runs, then complexity/risk signals map to a lane deterministically (trivial→fast; sensitive/breaking→full), with no network call.

## Invariants
- **INV-1**: lane heuristics are deterministic (prompt text + path + diff-stat only); no LLM call is added on this path.
- **INV-2**: the change is opened only for real code changes; a Q&A prompt never opens a spurious change record.
- **INV-3**: cross-provider — Claude Code hard-enforces; Codex/Gemini record-only; advisory hosts prompt-followed. No entry-file/prompt-text parity hacks.
- **INV-4**: a null/unreadable recorded lane fails safe to `full` (never silently relaxes).

## Out of scope
- The rich end-of-change verdict receipt/systemMessage (issue #325). #324 keeps narration to one lean `[paqad]` lane line.
