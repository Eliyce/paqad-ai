# Incremental Sync: API View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `incremental-sync`

## CLI

The sync runs inside `paqad-ai rag refresh-context` (see the background harness `trigger-refresh`
feature). It has no verb or flag of its own.

## Config

`.paqad/rag.ignore.yaml` decides which files are synced. Its `exclude` and `include` lists are
globs relative to the project root; a pattern ending in `/` matches a folder. Each glob is turned
into a matcher once when the file filter is built, not once per file. The other keys are
`additional_extensions`, `additional_basename_includes`, `additional_named_file_exclusions`,
`use_project_ignore_files` and `use_global_gitignore`.

## Library surface

- `backgroundIndexSync(projectRoot, providerFactory?)` in `src/rag/background-sync.ts`: returns
  `{ synced: true }` or `{ synced: false, reason: 'in-flight' | 'disabled' | 'no-index' | 'error' }`
  and never throws.
- `RagFileFilter` (`discoverFiles`, `probeFile`, `previewIndex`, `filterDiagnostics`) and
  `compileProjectGlob(pattern)` in `src/rag/file-filter.ts`.

No hook writes a hooks.log line for the sync itself.
