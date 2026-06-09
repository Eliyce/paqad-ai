# Engine Extension Surface Contract

Canonical enumeration of every engine API that a downstream consumer depends on,
with the stability guarantee that lets a breaking change be caught at design time
rather than at integration (PQD-92).

## How to read this document

- **Consumer** — who depends on the API (`cli`, a coding-agent adapter id, the
  `rule-scripts` subpath, `desktop`, the `api` layer, the `marketplace`). Entries
  for consumers that do not yet import the package are marked `(planned)`.
- **Engine module** — the source module that owns the symbol.
- **Symbol / Signature** — the exported name and its TypeScript shape. Type-only
  entries (`interface …`, `type …`) are erased at runtime; value entries
  (functions, consts) are reachable from a public entry point.
- **Stability** — one of `stable`, `beta`, `alpha`, `internal` (see
  `src/core/types/stability.ts`). `internal` symbols are **not** part of the
  surface and consumers must not depend on them.
- **Since** — the semver in which the entry was introduced.
- **Exempt** — a recorded reason that excludes the entry from the static
  orphan/drift checks (for call sites the static analysis cannot reach).

## Maintenance contract

- **Public entry points:** `src/index.ts`, `src/cli/index.ts`,
  `src/rule-scripts/index.ts`. A change to any of these without amending this
  document in the same change set is blocked by the `extension-surface`
  verification gate and by `pnpm run check:surface-drift` (AC2/AC3).
- **Orphans:** `pnpm run check:surface-orphans` reports every entry whose symbol
  no consumer references, with a recommendation to remove it or downgrade it to
  `internal` (AC4). Add an **Exempt** reason to silence a known false positive.
- The exhaustive per-symbol inventory of the `export *` barrels is enforced
  programmatically by those checks; this document records the depended-upon
  contract surface and the stability promise attached to each entry.

## Package identity (all consumers)

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| all | src/core/constants/index.ts | `VERSION` | `const VERSION: string` | stable | 1.0.0 | |
| all | src/core/constants/index.ts | `getFrameworkName` | `getFrameworkName(): string` | stable | 1.0.0 | |
| all | src/core/types/domain.ts | `SUPPORTED_DOMAINS` | `const SUPPORTED_DOMAINS: readonly string[]` | stable | 1.0.0 | |
| all | src/core/types/domain.ts | `SUPPORTED_STACKS` | `const SUPPORTED_STACKS: readonly string[]` | stable | 1.0.0 | |
| all | src/capabilities.ts | `SUPPORTED_CAPABILITIES` | `const SUPPORTED_CAPABILITIES: readonly string[]` | stable | 1.0.0 | |
| all | src/core/types/stability.ts | `STABILITY_LEVELS` | `const STABILITY_LEVELS: readonly string[]` | stable | 1.10.0 | |
| all | src/core/types/stability.ts | `StabilityLevel` | `type StabilityLevel (stable, beta, alpha, internal)` | stable | 1.10.0 | |
| all | src/core/types/stability.ts | `SurfaceEntry` | `interface SurfaceEntry { consumer; engineModule; functionSignature; stabilityLevel; since; exempt? }` | beta | 1.10.0 | |

## CLI consumer

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| cli | src/cli/index.ts | `runCli` | `runCli(argv?: string[]): Promise<void>` | stable | 1.0.0 | |
| cli | src/cli/index.ts | `getCliBanner` | `getCliBanner(): string` | stable | 1.0.0 | |
| cli | src/cli/index.ts | `shouldRunFromCommandLine` | `shouldRunFromCommandLine(importMetaUrl: string, argvEntry?: string): boolean` | stable | 1.0.0 | |
| cli | src/cli/index.ts | `argvToEntrypoint` | `argvToEntrypoint(value?: string): string` | beta | 1.0.0 | resolved from process.argv at runtime; not statically reachable |

## Coding-agent adapter consumers

The coding-agent adapters (`claude-code`, `codex-cli`, `cursor`, `gemini-cli`,
`junie`, `github-copilot`, `windsurf`, `continue`, `aider`, `antigravity`) are
selected dynamically by adapter type and implement a shared contract.

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| adapters | src/core/types/adapter.ts | `ADAPTER_TYPES` | `const ADAPTER_TYPES: readonly string[]` | stable | 1.0.0 | |
| adapters | src/adapters/adapter.interface.ts | `AdapterInterface` | `interface AdapterInterface` | stable | 1.0.0 | implemented per-adapter; selected dynamically by adapter type |
| adapters | src/adapters/adapter.interface.ts | `AdapterCapabilities` | `interface AdapterCapabilities` | stable | 1.0.0 | |
| adapters | src/adapters/adapter.interface.ts | `GeneratedFile` | `interface GeneratedFile` | stable | 1.0.0 | |
| adapters | src/adapters/adapter.interface.ts | `AdapterContext` | `interface AdapterContext` | beta | 1.0.0 | |

## Rules-as-scripts subpath consumer

Consumed via `import 'paqad-ai/rule-scripts'` by the rules-as-scripts skill
wrappers (issue #89).

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| rule-scripts | src/rule-scripts/runner.ts | `runRuleScripts` | `runRuleScripts(opts: RunOptions): RunReport` | beta | 1.0.0 | |

## Verification consumers

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| api | src/core/types/verification.ts | `VERIFICATION_GATES` | `const VERIFICATION_GATES: readonly string[]` | stable | 1.0.0 | |
| api | src/core/types/verification.ts | `GateResult` | `interface GateResult { gate; passed; inconclusive?; detail; remediation? }` | stable | 1.0.0 | |
| api | src/core/types/verification.ts | `VerificationContext` | `interface VerificationContext` | beta | 1.0.0 | |

## Desktop consumers (planned)

The Electron desktop (`paqad-ai ui`) does not yet import this package. These are
the type surfaces it is expected to depend on once the engine bridge is wired;
they are listed so the UI team can commit to their stability grade.

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned) | src/adapters/adapter.interface.ts | `AdapterCapabilities` | `interface AdapterCapabilities` | stable | 1.0.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/verification.ts | `VerificationContext` | `interface VerificationContext` | beta | 1.0.0 | planned consumer; no in-tree call site yet |

### Vision-text retrieval ingest (PQD-102)

The desktop runs vision calls (OCR/captioning) and hands the engine the extracted
text via `RagService.ingestExtractedText`. The text is embedded and stored in a
separate vision vector index keyed to the image path; subsequent `retrieve` calls
surface those chunks alongside file-derived ones. Re-ingesting a path replaces its
prior chunks. Rejections carry a stable `RagIngestError.code`.

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned) | src/rag/service.ts | `RagService` | `RagService.ingestExtractedText(input: VisionIngestInput): Promise<VisionIngestResult>` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/types.ts | `ExtractionKind` | `type ExtractionKind ('ocr' or 'caption')` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/types.ts | `SUPPORTED_EXTRACTION_KINDS` | `const SUPPORTED_EXTRACTION_KINDS: readonly ExtractionKind[]` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/types.ts | `SUPPORTED_VISION_EXTENSIONS` | `const SUPPORTED_VISION_EXTENSIONS: readonly string[]` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/types.ts | `VisionIngestInput` | `interface VisionIngestInput { sourcePath; text; extractionKind }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/types.ts | `VisionIngestResult` | `interface VisionIngestResult { chunkCount; sourcePath; extractionKind }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/types.ts | `RagIngestError` | `class RagIngestError extends FrameworkError { code: RagIngestErrorCode }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/types.ts | `RagIngestErrorCode` | `type RagIngestErrorCode (unsupported_file_type, unknown_extraction_kind, empty_extracted_text, path_outside_project, text_not_utf8)` | beta | 1.10.0 | planned consumer; no in-tree call site yet |

### Onboarding dry-run preview (PQD-103)

Before committing onboarding, the desktop asks the engine what it *would* write.
`OnboardingOrchestrator.preview` runs the same deterministic file-planning pipeline
as Phase 1 of `run` but classifies each target (`create` / `overwrite` / `skip`)
without touching disk, returning each existing file's `mtimeMs` so the consumer can
render a confirmation panel without re-scanning. An invalid or unreadable path is
refused with a `ValidationError` and no partial tree. The standalone
`planGeneratedFiles` helper is the pure read-only counterpart to `writeGeneratedFiles`.

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned) | src/onboarding/orchestrator.ts | `OnboardingOrchestrator` | `OnboardingOrchestrator.preview(options: OnboardingOptions): Promise<OnboardingPreviewResult>` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/onboarding/file-writer.ts | `planGeneratedFiles` | `planGeneratedFiles(projectRoot: string, files: GeneratedFile[]): OnboardingFileTreeEntry[]` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/onboarding.ts | `OnboardingFileTreeEntry` | `interface OnboardingFileTreeEntry { path; action ('create'/'overwrite'/'skip'); mtimeMs?; templateError? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/onboarding.ts | `OnboardingPreviewResult` | `interface OnboardingPreviewResult { entries: OnboardingFileTreeEntry[]; warnings: string[] }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |

### Per-turn context budget breakdown (PQD-167)

The desktop renders a faithful budget indicator and the optimizer decides whether
to compress, both from `ContextBudgetEnforcer.computeBudget`. Given the seven
per-turn slices and the active `ModelCatalogEntry`, it returns each line item's
token cost, the total, the percentage of the window in use, and a `BudgetBand`
derived from the workspace's `WorkspaceCompressionPolicy` thresholds. A single
retrieved chunk larger than the remaining budget is dropped and recorded in
`dropped_chunk_count` plus a `CompressionAuditRecord`. A missing
`context_window_tokens` yields an explicit error union — never a default window.
The tokenizer is loaded once per `tokenizer_version` and reused for the process
lifetime via `getOrLoad`, degrading to a character/4 heuristic when
`@xenova/transformers` is unavailable.

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned) | src/context/budget-enforcer.ts | `ContextBudgetEnforcer` | `ContextBudgetEnforcer.computeBudget(input: ComputeBudgetInput): Promise<BudgetBreakdown>` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/context/tokenizer-cache.ts | `getOrLoad` | `getOrLoad(version: string): Promise<LoadedTokenizer>` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/context/tokenizer-cache.ts | `clearTokenizerCache` | `clearTokenizerCache(): void` | internal | 1.10.0 | test-isolation helper; no consumer call site |
| desktop (planned) | src/context/tokenizer-cache.ts | `HEURISTIC_TOKENIZER_VERSION` | `const HEURISTIC_TOKENIZER_VERSION: string` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/context/tokenizer-cache.ts | `LoadedTokenizer` | `interface LoadedTokenizer { tokenizer_version; countTokens(text): number }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `ModelCatalogEntry` | `interface ModelCatalogEntry { context_window_tokens; max_output_tokens?; tokenizer_version }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `WorkspaceCompressionPolicy` | `type WorkspaceCompressionPolicy ('standard'/'aggressive'/'conservative')` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `BudgetBand` | `type BudgetBand ('comfortable'/'tightening'/'compressed'/'force-summary')` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `ComputeBudgetInput` | `interface ComputeBudgetInput { seven slices; model; compression_policy }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `BudgetBreakdown` | `type BudgetBreakdown (BudgetBreakdownSuccess discriminated on ok)` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `BudgetBreakdownSuccess` | `interface BudgetBreakdownSuccess { ok: true; per-slice tokens; total_used; usage_pct; band; tokenizer_version; dropped_chunk_count; compression_audit? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `BudgetBreakdownError` | `interface BudgetBreakdownError { ok: false; error; missing_field }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `CompressionAuditRecord` | `interface CompressionAuditRecord { event; reason; dropped_chunk_count }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |

### Rolling conversation summary (PQD-169)

For long conversations the desktop trims history before calling the local-model
runtime. `TurnSummarizer.summarise` is that primitive: it collapses older
user+assistant turns into a single attributed summary (`user said` /
`assistant replied`), folds in a prior summary (summarise-the-summary), excludes
`decision_packet`/`approval_turn` turns (reported in `preserved_turn_ids` for the
caller to re-insert verbatim), enforces a 2,000-token cap (stricter-prompt retry
then truncation), and returns a typed `SummariseResult` — success with metadata
or an explicit `inference-failed`/`timeout`/`cancelled` failure so the caller can
fall back to drop-oldest without overwriting the last-known-good summary. The LLM
call goes through an injected `InferenceProvider`; the engine ships only the
interface (a concrete provider is a follow-up). Token counts are best-effort
(character/4). The legacy `summarize(text, index, timestamp)` method is unchanged.

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned) | src/context/turn-summarizer.ts | `TurnSummarizer` | `TurnSummarizer.summarise(messages: SummarisationMessage[], targetTokenCount: number, opts?: SummariseOptions): Promise<SummariseResult>` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/context/turn-summarizer.ts | `SummariseOptions` | `interface SummariseOptions { priorSummary?; summaryModelPreference?; signal?; inferenceProvider?; timeoutMs? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/context/inference-provider.ts | `InferenceProvider` | `interface InferenceProvider { complete(messages, opts?): Promise<string> }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/context/inference-provider.ts | `InferenceMessage` | `interface InferenceMessage { role ('system'/'user'/'assistant'); content }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/context/inference-provider.ts | `InferenceCompleteOptions` | `interface InferenceCompleteOptions { timeoutMs?; signal? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `SummarisationMessage` | `interface SummarisationMessage { role; content; turn_id; decision_packet?; approval_turn? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `SummariseResult` | `type SummariseResult (SummariseSuccess discriminated on ok)` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `SummariseSuccess` | `interface SummariseSuccess { ok: true; summary_text; valid_through_turn_id; input_token_count; summary_token_count; truncated; preserved_turn_ids }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `SummariseFailure` | `interface SummariseFailure { ok: false; error ('inference-failed'/'timeout'/'cancelled') }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |

### Deterministic per-turn conversation rebuild (PQD-171)

Before each turn the desktop's local-model runtime reshapes its persisted
*display* conversation into the clean *API* conversation. `rebuildApiConversation`
is that primitive: it follows only the active branch (excluding stopped and
discarded turns via `resolveActiveLineage`), fits history into the model window by
first compressing older turns through the `ContextBudgetOptimizer` and then
dropping the oldest (reporting `truncated`/`truncatedTurnCount` and writing a
`context.truncated` audit event), inserts retrieved chunks after any leading
system context, and is deterministic — identical inputs yield byte-equal output.
A content-hashed `RebuildCache` serves an unchanged turn without re-running the
budget pass. A malformed budget or an optimizer failure surfaces as a
`RebuildFailedError` (kind `rebuild_failed`, no retry). `ClassificationResult`
gains an additive optional `retrieval_needed?: boolean`.

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned) | src/context/conversation-rebuild.ts | `rebuildApiConversation` | `rebuildApiConversation(input: RebuildInput): Promise<ConversationRebuildResult>` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/context/conversation-rebuild.ts | `RebuildInput` | `interface RebuildInput { displayMessages; classifierOutput; retrievedChunks?; budgetTokens; summarizer?; optimizer?; cache?; audit? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/context/conversation-lineage.ts | `resolveActiveLineage` | `resolveActiveLineage(messages: DisplayMessage[]): DisplayMessage[]` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/context/rebuild-cache.ts | `RebuildCache` | `class RebuildCache { computeKey(messages, classifierOutput): string; get(key); set(key, result); size }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/context/rebuild-cache.ts | `DEFAULT_REBUILD_CACHE_MAX_SIZE` | `const DEFAULT_REBUILD_CACHE_MAX_SIZE: number` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/conversation.ts | `DisplayMessage` | `interface DisplayMessage { id; role; content; createdAt; stopped?; discardedAt?; branchId?; parentMessageId? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/conversation.ts | `ApiMessage` | `interface ApiMessage { role; content; name? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/conversation.ts | `RetrievedChunkRef` | `interface RetrievedChunkRef { chunkId; position }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/conversation.ts | `ConversationRebuildResult` | `interface ConversationRebuildResult { messages; retrievedChunkIds; truncated; truncatedTurnCount }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/conversation.ts | `RebuildCacheKey` | `type RebuildCacheKey = string` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/conversation.ts | `RebuildFailedError` | `class RebuildFailedError extends Error { kind: 'rebuild_failed'; reason: string }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |

### Per-turn priority tagging (PQD-172)

`PriorityClassifier.tag` labels each conversation turn `high`, `normal`, or `low`
so the desktop's context-window loop knows which turns it may collapse during
compaction and which it must keep verbatim. Turns flagged `decision_packet` or
`approval_turn` carry a hard invariant: they always resolve to `high`, whatever
the injected `TurnClassifierModel` scores and whatever the workspace policy is.
When the model scores a protected turn below `high` the engine silently corrects
it and emits a `ContextHealthWarning` (`reason: priority_invariant_breach`) the
desktop can surface. An `all_normal` policy snapshot flattens ordinary turns to
`normal` while protected turns stay `high`. The call is synchronous,
side-effect-free, and batched per summarisation trigger (one `tag` call for the
whole turn list, not one per message).

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned) | src/context/priority-classifier.ts | `PriorityClassifier` | `PriorityClassifier.tag(turns: TurnInput[], policy?: TurnTagPolicy): TurnTagResult` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/context/priority-classifier.ts | `TurnClassifierModel` | `interface TurnClassifierModel { score(turn: TurnInput): TurnPriority }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/context/priority-classifier.ts | `InferredTurnClassifierModel` | `class InferredTurnClassifierModel implements TurnClassifierModel` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `TurnPriority` | `type TurnPriority (high, normal, low)` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `TurnInput` | `interface TurnInput { turn_id; text; decision_packet?; approval_turn?; priority? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `TaggedTurn` | `interface TaggedTurn extends TurnInput { priority: TurnPriority }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `ContextHealthWarning` | `interface ContextHealthWarning { type; reason; turn_id; classifier_returned; corrected_to }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `TurnTagResult` | `interface TurnTagResult { tagged: TaggedTurn[]; warnings: ContextHealthWarning[] }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/context.ts | `TurnTagPolicy` | `interface TurnTagPolicy { all_normal? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |

### Consumer-side cancellation (PQD-104)

Every long-running engine call accepts an optional `AbortSignal`. When the
consumer aborts, the call settles at the next boundary: `LaneRunner.run*`
resolves with `PipelineResult.cancelled === true` (and `blocked_at` set to the
interrupted phase), `WorkflowEngine.run/resume` returns
`WorkflowRunProgress.status === 'cancelled'`, and `RagService.rebuild` /
`checkSpecCompliance` throw `CancelledError`. A single `run.cancelled` event is
appended to the module-map event log for the run, and no further events follow.
Already-aborted signals return immediately without starting work.

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned), api (planned) | src/core/errors/cancelled-error.ts | `CancelledError` | `class CancelledError extends FrameworkError { code: 'CANCELLED_BY_CONSUMER'; details?: { checkpoint_path? } }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/core/errors/cancelled-error.ts | `isCancelledError` | `isCancelledError(error: unknown): error is CancelledError` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/pipeline/lane-runner.ts | `LaneRunOptions` | `interface LaneRunOptions { signal?: AbortSignal }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/workflows/engine.ts | `WorkflowRunOptions` | `interface WorkflowRunOptions { signal?: AbortSignal }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |

## Engine event-stream consumers (planned)

The unified in-process event bus (PQD-99). The desktop forwards `EngineEvent`
payloads over its Electron IPC bridge; the API layer subscribes directly. The
bus class is reachable from the package root; the event/subscription types are
forwarded to the renderer untransformed (plain data, no class instances).

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned), api (planned) | src/event-bus/engine-event-bus.ts | `EngineEventBus` | `class EngineEventBus { subscribe(cb, filter?): Subscription; emit(event): void; unsubscribe(id): void }` | beta | 1.10.0 | |
| desktop (planned), api (planned) | src/event-bus/engine-event-bus.ts | `EngineEventBusOptions` | `interface EngineEventBusOptions { bufferSize?; neverDrop?; maxPayloadBytes? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `EngineEvent` | `type EngineEvent (discriminated union, kind + at)` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `EngineEventKind` | `type EngineEventKind = EngineEvent['kind']` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `EngineEventFilter` | `interface EngineEventFilter { kinds: readonly EngineEventKind[] }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `Subscription` | `interface Subscription { id; state; unsubscribe(): void }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `EngineEventCallback` | `type EngineEventCallback = (event: EngineEvent) => void` | beta | 1.10.0 | planned consumer; no in-tree call site yet |

### Decision-pause events (PQD-101)

Decision events are multiplexed into the same `EngineEvent` stream so the
desktop's Decision Pause panel can react live without polling
`.paqad/decisions/pending/`. The `decision-paused`/`decision-resolved` variants
are enriched (additively); `decision-packet-corrupt`, `decision-cap-exceeded`,
and `decision-discarded` are new. `SliceExecutor` wires the emit calls; a
consumer drops a packet via `SliceExecutor.discardDecision(...)`.

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned), api (planned) | src/event-bus/types.ts | `DecisionEventOption` | `interface DecisionEventOption { option_key; label; one_line_preview; trade_off; technical_detail? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `DecisionPausedEvent` | `interface DecisionPausedEvent (kind: 'decision-paused'; decisionId; question?; options?; recommendation?; packetPath?; …)` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `DecisionResolvedEvent` | `interface DecisionResolvedEvent (kind: 'decision-resolved'; decisionId; chosenOptionKey?; resolver?; intent?)` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `DecisionPacketCorruptEvent` | `interface DecisionPacketCorruptEvent (kind: 'decision-packet-corrupt'; decisionId; reason)` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `DecisionCapExceededEvent` | `interface DecisionCapExceededEvent (kind: 'decision-cap-exceeded'; pendingCount; cap)` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `DecisionDiscardedEvent` | `interface DecisionDiscardedEvent (kind: 'decision-discarded'; decisionId; reason)` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/planning/decision-events.ts | `DecisionPauseEvent` | `type DecisionPauseEvent = Extract<EngineEvent, { kind: DecisionPauseEventType }>` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/planning/decision-events.ts | `DecisionPauseEventType` | `type DecisionPauseEventType` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/planning/decision-events.ts | `DECISION_PAUSE_EVENT_TYPES` | `const DECISION_PAUSE_EVENT_TYPES: readonly DecisionPauseEventType[]` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/planning/decision-store.ts | `DecisionCapExceededError` | `class DecisionCapExceededError extends Error { pendingCount; cap }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/planning/decision-store.ts | `MAX_PENDING_DECISIONS` | `const MAX_PENDING_DECISIONS: number` | beta | 1.10.0 | planned consumer; no in-tree call site yet |

## Consumer logger consumers (planned)

The consumer (e.g. the desktop app) installs its own logger at init via
`setEngineLogger`, and every structured log the engine would otherwise drop into
an internal `console.*` call is delivered to it (PQD-105). The logger is a plain
callback — no event-bus or IPC plumbing on the engine side. Installing a logger
replaces the previous one; with none installed the engine falls back to a safe
stderr default (warn/error only). A faulting logger is caught and the engine
reverts to the default after one notice.

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned), api (planned) | src/core/logger-registry.ts | `setEngineLogger` | `setEngineLogger(logger: EngineLogger): void` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/core/logger-registry.ts | `clearEngineLogger` | `clearEngineLogger(): void` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/core/logger-registry.ts | `getConsumerLogger` | `getConsumerLogger(): EngineLogger or null` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| internal | src/core/logger-registry.ts | `engineLog` | `engineLog(level: LogLevel, message: string, payload?: Record<string, unknown>): void` | internal | 1.10.0 | internal library dispatch; not a consumer API |
| desktop (planned), api (planned) | src/core/types/logger.ts | `EngineLogger` | `interface EngineLogger { log(entry: EngineLogEntry): void or Promise<void> }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/core/types/logger.ts | `EngineLogEntry` | `interface EngineLogEntry { level: LogLevel; message: string; payload? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/install/bootstrap.ts | `BootstrapOptions` | `interface BootstrapOptions { logger?: EngineLogger }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |

## Engine version report consumers (planned)

A consumer (a coding-agent adapter, the desktop app, or the api layer) calls
`getEngineVersionReport()` at startup — before any pipeline, gate, or file I/O —
to learn the engine version, the oldest consumer it supports, and whether it is
deprecated, then uses `compareConsumerCompatibility()` to decide whether to start
(PQD-106). The report is frozen and memoised for the process lifetime, so
repeated calls return the identical object with no I/O. Comparison is semver
major-only: minor, patch, and same-major pre-release differences never block.
`VERSION_UNKNOWN` flags a build with no usable version string.

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned), api (planned) | src/install/version-report.ts | `getEngineVersionReport` | `getEngineVersionReport(): EngineVersionReport` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/install/version-report.ts | `EngineVersionReport` | `interface EngineVersionReport { engineVersion; minConsumerVersion; deprecatedAsOf }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/install/version-report.ts | `normalizeEngineVersion` | `normalizeEngineVersion(raw: unknown): string` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/install/version-report.ts | `VERSION_UNKNOWN` | `const VERSION_UNKNOWN: string` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/install/version-report.ts | `MIN_CONSUMER_VERSION` | `const MIN_CONSUMER_VERSION: string` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/install/consumer-compatibility.ts | `compareConsumerCompatibility` | `compareConsumerCompatibility(consumerVersion: string, report: EngineVersionReport): ConsumerCompatibility` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/install/consumer-compatibility.ts | `ConsumerCompatibility` | `type ConsumerCompatibility = 'ok' or 'engine-too-new' or 'engine-too-old' or 'engine-version-unknown'` | beta | 1.10.0 | planned consumer; no in-tree call site yet |

## Error taxonomy consumers (planned)

A consumer routes engine failures to UI behaviours by switching on a stable
`code` rather than parsing message strings (PQD-107). `listErrorTaxonomy()`
returns one entry per `EngineErrorCode` — code, human-readable description, the
canonical `retryable` default, and a runtime-inspectable `payload_shape` — and is
callable before any operation has run, stable across patch and minor versions.
Every typed error extends `FrameworkError` (so `instanceof` works and `retryable`
is always readable) and carries a typed `details` payload. Credential material in
`details` is stripped before the error is surfaced (a `redacted_fields` marker
lists the stripped fields). `toEngineError()` normalises any thrown value to a
taxonomy-coded error, wrapping undocumented failures as `UNKNOWN_ENGINE_ERROR`
and logging the missing entry. Terminal events (`ModuleMapEvent.error_code`)
carry the same code as the returned/thrown error, so the consumer reconciles one
shape. The PQD-104 `CancelledError` is the canonical class for
`CANCELLED_BY_CONSUMER`.

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned), api (planned) | src/core/errors/taxonomy.ts | `EngineErrorCode` | `type EngineErrorCode` (union of the 11 taxonomy codes) | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/core/errors/taxonomy.ts | `ENGINE_ERROR_CODES` | `const ENGINE_ERROR_CODES: Record<EngineErrorCode, EngineErrorCode>` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/core/errors/taxonomy.ts | `listErrorTaxonomy` | `listErrorTaxonomy(): TaxonomyEntry[]` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/core/errors/taxonomy.ts | `TaxonomyEntry` | `interface TaxonomyEntry { code; description; retryable; payload_shape }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/core/errors/framework-error.ts | `FrameworkError` | `class FrameworkError extends Error { code; details?; retryable }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/core/errors/engine-errors.ts | `DecisionPacketCorruptError` | `class DecisionPacketCorruptError extends FrameworkError` (and the other typed subclasses) | beta | 1.10.0 | planned consumer; in-tree at decision-store readPacket |
| desktop (planned), api (planned) | src/core/errors/engine-errors.ts | `toEngineError` | `toEngineError(error: unknown): FrameworkError` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/core/errors/engine-errors.ts | `isEngineErrorCode` | `isEngineErrorCode(code: string): code is EngineErrorCode` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/core/errors/redact.ts | `redactPayload` | `redactPayload(payload, projectRoot?): { redacted; redacted_fields }` | beta | 1.10.0 | planned consumer; in-tree at FrameworkError constructor |

## Skill & pack load-failure audit consumers (planned)

When the skill loader or pack loader hits a file it cannot register — malformed
SKILL.md frontmatter, or a missing/invalid `pack.yaml` — it emits a
machine-readable audit event rather than silently dropping the failure (PQD-194).
The desktop tails `.paqad/skills/events.jsonl` (or reads it via
`readSkillAuditEvents`) to badge a skill/pack that failed to load, and clears the
badge once the file reloads cleanly (a successful reload simply emits no new
failure event). Each event carries a SHA-256 `content_hash` of the offending
bytes so the consumer can de-duplicate repeated emissions of the same unchanged
failure. When no `projectRoot` is available (or a disk write fails) events are
held in a bounded in-process buffer (`DEFAULT_SKILL_AUDIT_BUFFER_CAPACITY` = 50,
oldest dropped) and delivered, in order, on the next flush. `ValidationError`
now carries an optional `subCode` that surfaces *which* frontmatter rule fired as
the event's `validation_error_code`.

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned) | src/skills/audit-events.ts | `SkillLoadFailedEvent` | `interface SkillLoadFailedEvent { ts; type: 'skill.load_failed'; path; validation_error_code; message; skill_id: null; content_hash }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/skills/audit-events.ts | `SkillPackLoadFailedEvent` | `interface SkillPackLoadFailedEvent { ts; type: 'skill.pack_load_failed'; pack_id; pack_path; validation_error_code; issue_count; content_hash }` | beta | 1.10.0 | planned consumer; in-tree at pack loader |
| desktop (planned) | src/skills/audit-events.ts | `SkillAuditEvent` | `type SkillAuditEvent = SkillLoadFailedEvent or SkillPackLoadFailedEvent` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/skills/audit-events.ts | `SkillAuditEventType` | `type SkillAuditEventType = 'skill.load_failed' or 'skill.pack_load_failed'` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/skills/audit-events.ts | `readSkillAuditEvents` | `readSkillAuditEvents(projectRoot: string): SkillAuditEvent[]` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/skills/audit-events.ts | `appendSkillAuditEvent` | `appendSkillAuditEvent(projectRoot: string, event: SkillAuditEvent): void` | beta | 1.10.0 | planned consumer; in-tree at loaders |
| desktop (planned) | src/skills/audit-events.ts | `emitSkillAuditEvent` | `emitSkillAuditEvent(event, projectRoot?, buffer?): void` | beta | 1.10.0 | planned consumer; in-tree at loaders |
| desktop (planned) | src/skills/audit-events.ts | `SkillAuditBuffer` | `class SkillAuditBuffer { add; snapshot; flush; size }` | beta | 1.10.0 | planned consumer; in-tree at loaders |
| desktop (planned) | src/skills/audit-events.ts | `getSharedSkillAuditBuffer` | `getSharedSkillAuditBuffer(): SkillAuditBuffer` | beta | 1.10.0 | planned consumer; in-tree at loaders |
| desktop (planned) | src/skills/audit-events.ts | `DEFAULT_SKILL_AUDIT_BUFFER_CAPACITY` | `const DEFAULT_SKILL_AUDIT_BUFFER_CAPACITY: number` | beta | 1.10.0 | planned consumer; no in-tree call site yet |

### Attachment indexing into a project or session collection (PQD-331)

When a workspace member attaches a file to a conversation, the desktop calls
`indexAttachment` to chunk, embed, and store that file's content into either the
persistent project collection (`sessionKind: 'project'` → `.paqad/vectors/`) or a
session-scoped ephemeral collection (`sessionKind: 'ephemeral'` →
`.paqad/attachments/<sessionId>/`, reusing the PQD-174 layout). Every call emits
exactly one structured event to `.paqad/attachment-events.jsonl` (and to an
optional `onEvent` sink): `attachment.indexed` on success, `attachment.index_failed`
for an unreadable/corrupt/encrypted file, or `attachment.format_rejected` for a
disallowed shape (page cap, zip-bomb, unsupported format). Re-indexing identical
content for the same path is a no-op (SHA-256 content dedupe). A rate-limited
remote provider is retried within a wall-clock budget (`ATTACHMENT_RETRY_BUDGET_MS`,
30 s) before failing. PDF text extraction and archive inspection are *injectable*
(`ParseAttachmentOptions.pdfExtractor` / `archiveInspector`) so the published engine
takes no PDF/ZIP dependency; the engine owns the page-cap (`PDF_PAGE_CAP`) and
zip-bomb (`ZIP_DECOMPRESSED_LIMIT_BYTES`) guards regardless of the plugged-in
library. `clearEphemeralCollection` purges a session's collection on session end.

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned) | src/rag/attachment-indexer.ts | `indexAttachment` | `indexAttachment(projectRoot: string, params: IndexAttachmentParams): Promise<IndexAttachmentOutcome>` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/attachment-indexer.ts | `clearEphemeralCollection` | `clearEphemeralCollection(projectRoot: string, sessionId: string): Promise<void>` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/attachment-indexer.ts | `isIndexAttachmentFailure` | `isIndexAttachmentFailure(outcome: IndexAttachmentOutcome): boolean` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/attachment-indexer.ts | `ATTACHMENT_RETRY_BUDGET_MS` | `const ATTACHMENT_RETRY_BUDGET_MS: number` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/attachment-indexer.ts | `IndexAttachmentParams` | `interface IndexAttachmentParams { filePath; sessionId; sessionKind; intelligence; onProgress?; onEvent?; signal?; parse?; providerFactory?; retryBudgetMs?; retryDelayMs? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/attachment-indexer.ts | `IndexAttachmentResult` | `interface IndexAttachmentResult { ok: true; chunkCount; provider; collectionScope; deduped }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/attachment-indexer.ts | `IndexAttachmentFailure` | `interface IndexAttachmentFailure { ok: false; outcome; reason }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/attachment-indexer.ts | `IndexAttachmentOutcome` | `type IndexAttachmentOutcome = IndexAttachmentResult or IndexAttachmentFailure` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/attachment-indexer.ts | `AttachmentSessionKind` | `type AttachmentSessionKind ('project' or 'ephemeral')` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/attachment-indexer.ts | `AttachmentStoredChunk` | `interface AttachmentStoredChunk extends StoredVectorChunk { file_content_hash }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/attachment-parser.ts | `parseAttachment` | `parseAttachment(filePath: string, options?: ParseAttachmentOptions): Promise<ParseAttachmentResult>` | beta | 1.10.0 | planned consumer; in-tree at indexAttachment |
| desktop (planned) | src/rag/attachment-parser.ts | `PDF_PAGE_CAP` | `const PDF_PAGE_CAP: number` | beta | 1.10.0 | planned consumer; in-tree at parseAttachment |
| desktop (planned) | src/rag/attachment-parser.ts | `ZIP_DECOMPRESSED_LIMIT_BYTES` | `const ZIP_DECOMPRESSED_LIMIT_BYTES: number` | beta | 1.10.0 | planned consumer; in-tree at parseAttachment |
| desktop (planned) | src/rag/attachment-parser.ts | `ParseAttachmentOptions` | `interface ParseAttachmentOptions { pdfExtractor?; archiveInspector?; bytes?; pageCap?; zipDecompressedLimitBytes? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/attachment-parser.ts | `ParseAttachmentResult` | `type ParseAttachmentResult = ParsedAttachment or AttachmentRejection` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/attachment-parser.ts | `PdfTextExtractor` | `type PdfTextExtractor = (bytes: Buffer) => Promise<PdfExtraction>` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/attachment-parser.ts | `ArchiveInspector` | `type ArchiveInspector = (bytes: Buffer) => Promise<ArchiveInspection>` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/attachment-events.ts | `appendAttachmentEvent` | `appendAttachmentEvent(projectRoot: string, event: AttachmentEventInput): AttachmentEvent` | beta | 1.10.0 | planned consumer; in-tree at indexAttachment |
| desktop (planned) | src/rag/attachment-events.ts | `readAttachmentEvents` | `readAttachmentEvents(projectRoot: string): AttachmentEvent[]` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/attachment-events.ts | `AttachmentEvent` | `interface AttachmentEvent { kind; file_name; at; collection_scope?; session_id?; chunk_count?; provider?; reason? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/rag/attachment-events.ts | `AttachmentEventKind` | `type AttachmentEventKind ('attachment.indexed', 'attachment.index_failed', 'attachment.format_rejected')` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
