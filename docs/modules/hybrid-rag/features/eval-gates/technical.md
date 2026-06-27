# Eval Gates (hit@5, success, correction turns) — Technical View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `eval-gates`

## Module Boundaries

Source directories owned by this feature:

- `src/rag`
- `src/project-knowledge`



## Entry Points

- Imported by other paqad-ai modules — see the source list above for the public surface.
- On/off A/B merge gate (RAG buildout F15): `runFeatureOffVsOnGate(dataset, onTraces,
  gates?)` builds the feature-OFF snapshot (`buildFeatureOffTraces` — no retrieval,
  zero injected tokens) and the feature-ON snapshot (`snapshotFromTraces` over real
  traces), then evaluates the benchmark gates. `rag eval --mode feature-off-vs-on`
  self-generates both arms (no `--baseline` needed) and exits non-zero when the gate
  fails — quality must not drop, and injected tokens are justified only by a
  task-success improvement (the prompt-token success-override). The golden dataset
  (`EVAL_DATASET`) spans all `EvalQueryClass` categories incl. negative/should-skip.
  From F15 on, every later retrieval/precision change (F17-F27) must clear this gate.

## Data Model / Schema

- Tables, JSON schemas, or YAML schemas owned by this feature.
- For `framework-internals` modules, this usually means the file shape under `.paqad/` or
  the validated input/output contract.

## API / Interface Contract

- Public functions exported from the source files above.
- CLI flags / arguments (if applicable).
- Agent-callable skill names or workflow trigger phrases (if applicable).

## State Management

- What state this feature reads.
- What state this feature writes.
- Where that state is persisted (`.paqad/**`, project files, in-memory only).

## Error Codes

- Structured error IDs emitted by this feature.
- Mapping from error ID → user-facing message → recovery action.

## Dependencies

- **Internal:** other paqad-ai modules this feature imports or calls.
- **External:** npm packages, system binaries (`node`, `git`, etc.).
- **Runtime data:** files that must already exist before this feature runs.

## Configuration

- Environment variables read.
- Config keys in `.paqad/project-profile.yaml` or `.paqad/onboarding-manifest.json`.
- Default values and override precedence.

## Testing Entry Points

- Unit test files that cover `eval-gates` directly.
- Integration tests that exercise this feature end-to-end.
- Manual verification commands (CLI invocations, agent prompts).

## Observability

- Console output / log lines emitted.
- Tracker writes (`.paqad/doc-progress.json`, `.paqad/stack-drift.json`, etc.).
- Exit codes (for CLI features).
