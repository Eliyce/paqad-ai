# Context Pack — Technical View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `context-pack`

## Module Boundaries

- `src/context/context-pack.ts` — `locateLineRange`, `distillSlices`, `composeContextPack`.
- `src/cli/commands/rag.ts` — `rag refresh-context` chooses the pack for broad working sets.

## Entry Points

- `locateLineRange(fileContent, chunkContent)` → `{ start, end } | undefined` (1-based
  inclusive; pure; anchors on the chunk's first meaningful line, extends while lines match).
- `distillSlices(slices, { readFile?, maxEntries? })` → `ContextPackEntry[]` (dedupe by
  file+range, capped at `MAX_CONTEXT_PACK_ENTRIES` = 12, best-effort reader, never throws).
- `composeContextPack(entries)` → the pointer-list markdown, `''` when empty.

## Data Model / Schema

- `ContextPackEntry { source_file, start_line?, end_line?, score?, hint }`. No persisted
  shape; the pack is part of the session-context artifact's retrieval section.

## API / Interface Contract

- **Pointers, not dumps.** The section lists `` `path:Lstart-Lend` · match NN% — hint``
  lines and contains no fenced code body, so the context stays lean (the SWE-grep pattern).
- **Reuses the retrieval pipeline.** Operates on the already retrieved, scoped, and
  floored {@link RetrievalSlice}s (F11/F12/F13/F14); F26 only changes the FORMAT for broad
  stages.
- **Stage-routed.** `rag refresh-context` uses the pack when `slices.length >
  MAX_RETRIEVAL_SLICES` (a broad/long workflow) and keeps full slices for narrow sets.
- **Best-effort line location.** Line ranges are located against the live files via an
  injected reader; a miss (file changed / unreadable) degrades to a path+hint pointer.
  Never throws.

## State Management

- Stateless. Reads the live files (in the background worker) to locate line ranges; writes
  nothing of its own.

## Failure Modes

- Unreadable file or moved code → pointer with no line range. Empty pack → no section.

## Tests

- `tests/unit/context/context-pack.test.ts` — `locateLineRange` (hit / anchor-miss /
  blank), `distillSlices` (no-reader hints, reader line ranges, dedupe, cap, reader-throws),
  `composeContextPack` (pointer formatting, match %, no code fences, range omission).
