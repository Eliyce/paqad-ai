# Conversation scenarios

`s1.yml` holds the S1 conversation eval scenarios. Each one maps one-to-one to a conversation-shape
acceptance scenario in the frozen S1 spec (AC-2, AC-3, AC-4, AC-5, AC-6, AC-9, AC-10, AC-15, AC-17,
AC-21 to AC-29 and AC-42 to AC-48). The script-proven acceptance criteria are covered by the unit
suite under `tests/scripts/` and carry no scenario here.

`s1b.yml` holds the S1b conversation eval scenarios for the three existing-work skills
(refine-ticket, size-work, plan-sprint). Each maps to a conversation-shape acceptance scenario in the
frozen S1b spec (AC-30, AC-33, AC-35, AC-38); the rest of AC-30 to AC-41 is script-proven by the unit
suite (`test_refine.py`, `test_sizing.py`, `test_sprint.py`, `test_record.py`) and carries no scenario
here. These scenarios read the invented fixture tracker under `tests/evals/fixture-repo/tracker/`.

`s2.yml` holds the S2 ChatGPT and Codex parity scenarios (AC-20): the same idea and the same
question, run under different capability sets and on different hosts, must deliver the same journey,
the same answer structure and the same ticket-set structure, with one capability-stripped variant
exercising U-1, U-3, U-14, U-16, GRD-3 and REC-2 as one journey. The structural half of AC-20 is
machine-checked offline by `tests/evals/run_parity.py` (run inside the unit suite by
`tests/scripts/test_parity.py`), which reads `s2.yml`, the built per-host branches under
`dist/hosts/<host>/`, the fixture repository and the fake tracker. The live conversational parity on
ChatGPT and Codex stays manual and recorded per CI-12 (`manual_hosts` in `s2.yml`); S2 claims no
automated live run.

The conversation scenarios are declarative. They are authored now but are NOT run in CI until S3,
when the host eval runner executes them against the built plugin, the fixture repository under
`tests/evals/fixture-repo/`, and a fake tracker (CI-12, CI-13). Each scenario checks properties, not
wording: answer-first, one Sources line, no narration, tables for lists, a source on every factual
sentence, approval before any write, one question at a time, and the rest of the conversation
contract. The property vocabulary and the per-scenario schema are documented in the header of
`s1.yml`.
