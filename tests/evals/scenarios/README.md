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

`repo-selection.yml` holds the scenarios for choosing the repository, the three-state onboarded
check and the wider ask-project trigger. Each maps to a conversation-shape acceptance scenario in
REQUIREMENTS.md section 13 (AC-49 to AC-55), with ac-53 and ac-53b flipped for generic mode so a
repository with no paqad docs but reachable code is answered from code only with its source line, not
stopped. Its extra `repositories` field lists what the user can reach as plain
`<name>, <state>, <activity>` scalars, or `no listing tool`.

`generic-mode.yml` holds the generic-mode scenarios: the plugin answers on any repository at the best
evidence level it can reach (from project docs, from docs and code, or from code only), with one
source line per answer and an informational upgrade nudge at most once (GM-1 to GM-9, GRD-12 to
GRD-16). Each maps to a conversation-shape acceptance scenario in REQUIREMENTS.md section 13 (AC-1,
AC-56 and AC-62 to AC-67), with AC-53 covered by repo-selection.yml. They read the code-only fixture
under `tests/evals/fixture-repo-code-only/` (real code, no paqad docs) and the ready fixture. The
file-level rules are checked by `test_generic_mode.py`.

`evidence-rules.yml` holds the scenarios for the evidence rules on undocumented areas and the
automatic code check (GRD-8 to GRD-11, ASK-8). Each maps to a conversation-shape acceptance scenario
in REQUIREMENTS.md section 13 (AC-57 to AC-61), with extra variants for an overview question, the
idea journey's today entry, a second undocumented area, a capability found only in the requirements
document, a business note that states a rule that must hold, and refining as well as sizing a
ticket. They read the invented loyalty code with no loyalty notes, the stale "soon" tag on the
account page's loyalty points entry in the members summary, the invented `Requirements.md` at the
fixture root (neutral, its only hint "Status: baseline for technical design."), the vendored
`vendor/points-kit` stub the code check must never read, and ticket `LOY-12`. Referrals is the
second undocumented area, with code and no status in any document, so a reply that carries
loyalty's tag over or reasons from what the account page lists fails docs-status-not-generalised
(ac-59b). Its fixture values tell the code reachable (`fixture-repo`) from the code not reachable
(`fixture-repo docs folder only`). Properties are judged on meaning, never as a string list. The
file-level rules are checked by `test_evidence_rules.py`.

`business-feedback.yml` holds the scenarios from the v3.2 business-user test (V-29): every choice
through the host's choice prompt, a short list in the reply only when the host has none, the
question last after the sources, no pause to ask whether to carry on, the record kept silently with
a resume file only when the user asks to stop and come back later, and tickets as user stories with
Given/When/Then acceptance criteria, an API story then a UI story, a confirmed permission key and
the refusal of a piece with no user value. Each maps to a conversation-shape acceptance scenario in
REQUIREMENTS.md section 13 (AC-68 to AC-74). AC-75 is script-proven by `test_user_stories.py` and
carries no scenario. Its extra `host` field names whether the host has a choice prompt.

The conversation scenarios are declarative. They are authored now but are NOT run in CI until S3,
when the host eval runner executes them against the built plugin, the fixture repository under
`tests/evals/fixture-repo/`, and a fake tracker (CI-12, CI-13). Each scenario checks properties, not
wording: answer-first, one Sources line, no narration, tables for lists, a source on every factual
sentence, approval before any write, one question at a time, and the rest of the conversation
contract. The property vocabulary and the per-scenario schema are documented in the header of
`s1.yml`.
