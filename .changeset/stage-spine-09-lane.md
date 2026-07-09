---
'paqad-ai': minor
---

Stage-Spine 09 (#324): record and consume the lane — scale process depth to risk.

paqad's deterministic classify→route→lane engine was fully built but never invoked
in a live session, so every change (a one-line typo or an auth migration) paid the
same full ceremony and the ledger's `lane` was always null. This wires the existing
engine into the prompt seam and makes the lane real:

- The prompt seam runs the deterministic classifier + router on the prompt text,
  stashes the chosen lane, and records it on the change's open ledger row (no LLM
  call added — path/prompt signals only).
- The pre-code gate scales the specification requirement to the lane: the **fast**
  lane relaxes it (planning-only) while **graduated/full** keep the frozen-spec
  requirement. A null lane fails safe to full.
- A new optional `sensitivity: high` per module in `module-map.yml` floors any change
  touching a sensitive path back to the full lane — a cheap, deterministic risk floor.
- The completion backstop consumes the recorded lane instead of a hardcoded `'full'`,
  so a small change is no longer forced through the heaviest quality measurement set.

Enforcement is tiered by host (hard-block on Claude Code; record-only on Codex/Gemini;
prompt-followed on advisory hosts).
