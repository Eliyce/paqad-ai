---
'paqad-ai': minor
---

Spec pipeline (#517): wire the deferred S2 ledger auto-answer step (FR-4.5). Before any
clarification question reaches the user, the pipeline now checks it against the decisions
ledger; a match injects the recorded answer with its source and the question never appears.
It is a pure, zero-token lookup — paqad calls no LLM from Node.

- New `src/spec-pipeline/auto-answer.ts` exports `autoAnswerQuestions(projectRoot, questions)`,
  returning `{ answered, remaining }`. Per question it consults two ledger seams in order:
  exact/fingerprint reuse (`findIntakePriorMatch` → `DecisionStore.findReusableDecision`) then
  advisory textual precedent (`findDecisionPrecedents`), accepted only above a high score floor.
  The rule seam (`resolveByCompiledRule`) is intentionally not wired — it is file-glob-triggered
  and cannot choose among plain-language outcome options.
- `spec pipeline record questions` runs the batch through auto-answer and persists only the
  surviving questions plus the auto-answered list, so a ledger-answerable question never reaches
  the user.
- The `questions.json` artifact widens to `{ questions[], auto_answered[], asked, answered,
deferred }` (the FR-7.6 counts); `validateStepArtifact('questions', …)` enforces it while
  keeping `questions[]` the only hard-required field, so a raw agent batch still validates.
- `spec pipeline finish` feeds the auto-answered source ids and counts into `buildProvenance`,
  so the finish provenance lists the answer references — human input by reference, never a
  fabricated sign-off.
