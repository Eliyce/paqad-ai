# Conversation scenarios

`s1.yml` holds the S1 conversation eval scenarios. Each one maps one-to-one to a conversation-shape
acceptance scenario in the frozen S1 spec (AC-2, AC-3, AC-4, AC-5, AC-6, AC-9, AC-10, AC-15, AC-17,
AC-21 to AC-29 and AC-42 to AC-48). The script-proven acceptance criteria are covered by the unit
suite under `tests/scripts/` and carry no scenario here.

The scenarios are declarative in S1. They are authored now but are NOT run in CI until S3, when the
host eval runner executes them against the built plugin, the fixture repository under
`tests/evals/fixture-repo/`, and a fake tracker (CI-12, CI-13). Each scenario checks properties, not
wording: answer-first, one Sources line, no narration, tables for lists, a source on every factual
sentence, approval before any write, one question at a time, and the rest of the conversation
contract. The property vocabulary and the per-scenario schema are documented in the header of
`s1.yml`.
