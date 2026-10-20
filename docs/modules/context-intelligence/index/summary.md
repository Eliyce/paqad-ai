# Context Intelligence

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `context-intelligence`

## Purpose

AST-aware semantic loader, 4-tier budget optimizer, deduplication,
pure-regex turn summarizer, and per-tier stream truncator. Makes
every token count regardless of whether RAG is on.

## Source Footprint

- `src/context`
- `src/token-efficiency`

## Features

- [Semantic Loader](../features/semantic-loader/business.md)
- [Budget Optimizer (green→yellow→amber→red)](../features/budget-optimizer/business.md)
- [Artifact Deduplication](../features/deduplication/business.md)
- [Turn Summarizer](../features/turn-summarizer/business.md)
- [Stream Truncator](../features/stream-truncator/business.md)

## Why the code works the way it does

The reasons below are not obvious from the code in `src/context/`. The rule slice
(`rule-context.ts`, `rule-manifest.ts`) is explained in the
[smart rule loading summary](../../smart-rule-loading/index/summary.md), and the retrieval
slice (`retrieval-context.ts`) in the [hybrid RAG summary](../../hybrid-rag/index/summary.md).

- **`action-router.ts`.** Workflow suggestions are always `requires_user_approval: true`, carry
  chunk ids instead of chunk text, and build their keywords and explanation from workflow names
  only, so retrieved text never controls a schema field. An id not in the registry is dropped.
- **`ast-chunker.ts`.** `CHUNKER_VERSION` names the whole index-build strategy (boundary
  detection, the merge pass and the contextual blurbs). An index built by another version is
  rebuilt in full, never synced, because mixing chunk boundaries corrupts it. The merge pass only
  joins chunks that were adjacent in one file, never reorders or drops content, and passes an
  oversize chunk through. A merged chunk keeps its first node's kind rather than widening the
  chunk type for an advisory field. The boundary regexes never put two `\s*` next to each other,
  which avoids catastrophic backtracking on long runs of spaces.
- **`budget-enforcer.ts`.** The band thresholds per compression policy are fixed values. With no
  `context_window_tokens` in the model catalog an error is returned instead of a default window.
  Chunks are included greedily against what remains, so the total never exceeds the window; a
  chunk that does not fit is counted in `dropped_chunk_count` and audited.
- **`budget-optimizer.ts`.** Turns are not yet skipped by priority during summarising; once turns
  carry a priority, high-priority turns (decision packets, approvals) should survive verbatim.
- **`codebase-memory.ts`.** The memory is a plain keyed store, not an embedding guess, and
  re-recording the same `(kind, key)` updates the entry in place, so the store never holds two
  contradictory copies. The freshest entries are injected first, capped by count and by a hard
  character budget. Reads never throw: a missing or malformed file is an empty store. It lives in
  the git-ignored `.paqad/crs/` root, per machine; team-shared memory is a separate effort.
- **`context-hash.ts` and `rebuild-cache.ts`.** The durable reproducibility hash uses a canonical
  JSON with keys sorted and an explicit algorithm version, because a plain `JSON.stringify` leaks
  key order and an added input must be a deliberate version bump. Chunks are hashed by id and
  content digest. The stamp proves the inputs can be replayed, not that a hosted model will
  regenerate the same output, so it records `determinism: 'input-replay'`. The summariser mode is
  part of the hash because the model-backed summariser is not deterministic. The rebuild cache
  key is only an in-process key, so a raw `JSON.stringify` is fine there; the cache is LRU bounded
  and never persisted.
- **`context-pack.ts`.** A long workflow gets pointers (`path:Lstart-Lend` plus a one-line hint)
  instead of chunk bodies, and opens the live file when it needs the body. The range is found by
  anchoring on the chunk's first meaningful line; when the file changed, the pointer falls back to
  the path and hint.
- **`conversation-lineage.ts` and `conversation-rebuild.ts`.** The API conversation follows only
  the active branch: from the newest live message back to its root, without stopped or discarded
  turns, always in chronological order (ties broken by id). A flat history with no parent
  pointers is one linear branch. Under pressure older turns are compressed first and then the
  oldest dropped, keeping at least the newest. Retrieval counts toward the window and is
  inserted after the leading system context. A malformed budget fails without a retry.
- **`existing-surface.ts`.** The section reserves room for its framing line and a header sized
  for all cards before adding cards, so it never exceeds the budget once the final count is
  known, and it always shows at least one card. With no code-knowledge index it falls back to
  name-only cards. Any failure gives an empty section, so the background worker is never wedged.
- **`metadata-filter.ts`.** Filters are conservative: when filtering would leave fewer than the
  minimum, the full set is used and the fallback is flagged. A framework also matches by file
  extension, because names like `react` or `laravel` rarely appear in paths. A chunk with no
  recency information is kept.
- **`priority-classifier.ts`.** A protected turn (decision packet or approval) is always tagged
  `high` whatever the model says, and a protected turn already tagged `high` is left alone without
  a warning. The default model scores every other turn `normal`. Tagging is batched once per
  summarisation trigger.
- **`reranker.ts`.** The local cross-encoder is pinned to `q8`, because newer transformers
  versions default to fp32.
- **`tokenizer-cache.ts`.** One tokenizer is kept per version for the process. The transformers
  package is an optional peer, so without it the count falls back to characters divided by four
  and reports the version `heuristic`.
- **`turn-summarizer.ts`.** Protected turns are never collapsed. An empty body is retried once
  with another template, an over-long one is re-asked with a stricter prompt and then truncated.
  Timeouts, cancellation and a missing provider return an explicit failure so the caller keeps
  the prior summary. The abort race rejects even when a provider ignores the signal.

## Authority

The single source of truth for this module's identity, slug, feature names, and source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml). If anything
in this page disagrees with the map, the **map wins** — update the map first, then regenerate this
page via `create module documentation`.

## How to Update These Docs

1. Edit `docs/instructions/rules/module-map.yml` if the module or feature names changed.
2. Run `create module documentation` in your AI agent (Claude Code, Codex, Cursor, …).
3. Review the regenerated business + technical pages per feature.

## Related

- Module registry: [`docs/instructions/registries/modules.md`](../../../instructions/registries/modules.md)
- Stack overview: [`docs/instructions/stack/overview.md`](../../../instructions/stack/overview.md)
- Architecture overview: [`docs/instructions/architecture/overview.md`](../../../instructions/architecture/overview.md)
