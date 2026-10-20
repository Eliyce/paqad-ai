# Discovery Workflow: why the code works the way it does

The standalone Discovery workflow (`src/discovery/`) helps a person move from an uncertain idea or
an improvement brief to a practical next step, through six stages: understand, investigate,
refine, decide, check readiness and hand off. Its runs live under `.paqad/ledger/delivery/`, one
directory per run. The reasons below are not obvious from the code.

## Separate from feature development

- **Stages (`stages.ts`, `recorder.ts`).** The six stages are a separate registry, not part of the
  feature-development `STAGE_ORDER`: the stage-evidence recorder throws on a foreign stage, and
  adding them there would pollute the feature-development completion gate. Discovery rows ride the
  same session-ledger substrate under their own doc type, so recording one workflow never touches
  the other.
- **Thinking stages only.** No stage edits source, so every stage must end against its own
  canonical artifact. The recorder hashes the artifact's real bytes (read once, with the length
  checked on the buffer, so there is no check-then-read window); a missing or empty file hashes to
  null, and a bare start and end pair folds inconclusive. The CLI resolves the artifact from the
  stage, so a stage cannot be ended against another stage's file.
- **Ordering (`fold.ts`).** The recorder is permissive so a stage can always be marked; the fold is
  the one place that flags a later stage started before an earlier one ended.

## Identity and storage

- **Run names (`mint.ts`, `paths.ts`).** The run directory name `[<issue>-]<slug>-<ULID>` is the
  immutable change key, minted once with the same slug, ticket-detect and ULID helpers as feature
  evidence, so it is colon-free and identical on every platform. A GitHub ref is stored as its bare
  number so the name stays parseable. Paths use `pathe` so they are posix everywhere, because the
  name is compared and persisted. The change key is the trailing ULID, which never changes on a
  rename. `report.html` is a derived view, not one of the run's rigid files.
- **Records (`run-store.ts`, `writers.ts`, `records.ts`).** Every artifact is stamped through the
  shared feature-evidence envelope with a content hash, so a hand edit is detectable. JSON files
  are written with a temp file and rename; JSONL rows are appended. Body content comes from the
  model through the CLI; the writer owns every mechanical field. Execution status is kept apart
  from the outcome chosen at hand-off, and a crash before persistence is never `completed`.
- **Resolving a run.** A ref can be a directory name, a bare ULID or a slug; an ambiguous slug
  takes the most recent run, and an empty ref returns nothing rather than guessing the latest run.
  The slug is also matched against the stored `run.json`, because a title starting with a number
  ("12 fix") parses its first segment as an issue prefix.

## Ownership and isolation

- **Boundary (`boundary.ts`).** The boundary is the decision function a Discovery hook will call. It
  is not yet wired into the shared host-hook chain, so it is tested decision logic rather than an
  enforced gate; isolation holds today because there is no active gate to leak. A non-Discovery
  session is always not-applicable, so a Discovery gate can never block a feature-development or
  question session. A Discovery session's source edit is blocked for that session only, an action
  on a run it does not own is blocked as `foreign-run`, and reads are always allowed.
- **Ownership.** A session owns a run only when its own workflow-state anchor points at that run
  and the run's own `run.json` names it as owner. A repo-level pointer, the latest directory or a
  cached id never proves ownership, so no session borrows another's run.
- **Validation (`validate.ts`).** An artifact is rejected when it is on the wrong path, malformed,
  from another run, owned by another session, stale (its hash no longer matches) or the wrong kind
  for the stage. A JSONL artifact is checked per row. When `run.json` is missing the owner cannot
  be established, so validation fails closed.

## Context and the report

- **Context contract (`context-contract.ts`, `context-receipts.ts`).** Each stage declares the
  context keys it normally needs, so a stage does not load the whole rule library and every
  module doc. The table bounds the default load but never forbids more: extra context needs a
  recorded reason. A receipt says what was available, read or acknowledged, never that it was
  understood.
- **Report (`report.ts`).** `report.html` lets someone new see the value, decisions, evidence,
  blockers and next step without the original chat. It is a projection: it names the source
  revision and can never set completion state. Missing records render as empty sections.
