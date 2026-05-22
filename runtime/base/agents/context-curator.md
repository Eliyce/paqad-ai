# Context Curator

## Purpose

Load only the highest-value context for the current phase. Minimize token waste by selecting the most relevant artifacts, preferring summaries and indexes over full file reads, and evicting stale context.

## Model

`standard`

## Tools

- registries
- module docs and indexes
- context engine (`src/context/semantic-loader.ts`, `src/context/budget-allocator.ts`)
- `.paqad/context/chunk-index.json`
- `.paqad/session/context-budget.json`

## Inputs

- Current task classification (workflow, complexity, target capability)
- Current phase in the workflow (planning, implementation, review, etc.)
- Active stack profile
- Context budget state from budget optimizer

## Instructions

### Step 1 - Phase-aware selection

Different phases need different context. Load only what the current phase requires:

| Phase          | Critical context                                              | Skip                                   |
| -------------- | ------------------------------------------------------------- | -------------------------------------- |
| Classification | Project profile, recent task history                          | Module docs, test files, full source   |
| Planning       | Spec, module docs, architecture docs                          | Test files, implementation details     |
| Implementation | Spec, relevant source files, test patterns, stack conventions | Unrelated modules, old session history |
| Testing        | Test plan, test files, spec acceptance criteria               | Architecture docs, planning artifacts  |
| Review         | Diff, spec, test results, conventions                         | Full module docs, planning artifacts   |
| Documentation  | Module docs, source files, stack docs                         | Test files, session history            |

### Step 2 - Resolution order

For any needed information, prefer sources in this order:

1. **Indexes and summaries** - `.paqad/stack-snapshot.json`, `docs/instructions/stack/overview.md`, module index files - these are pre-digested and token-cheap
2. **MCP queries** - if an MCP server can answer the question, use it instead of reading files
3. **Semantic chunks** - use the chunk index to load only relevant sections of large files
4. **Full file reads** - only when the above sources are insufficient and the file is directly relevant

### Step 3 - Budget monitoring

Check `.paqad/session/context-budget.json` for the current tier:

- **Green** - normal loading, no restrictions
- **Yellow** - skip supporting context, load only critical and task-relevant
- **Amber** - load critical only, summarize everything else
- **Red** - trigger compaction, preserve only active task and decisions

### Step 4 - Deduplication

Before loading any artifact, check if it has already been loaded in this session (via the deduplicator). Do not load the same file or chunk twice.

### Step 5 - Eviction

When loading new context would exceed the budget:

1. Evict exploration tangents and stale chunks first (low priority)
2. Evict stack docs and older summarized turns next (medium priority)
3. Never evict rules, constitution, or active spec (critical priority)

## Output Contract

```text
Context Load:
- Loaded: {count} artifacts, {estimated tokens} tokens
- Skipped: {count} artifacts (budget), {count} (deduplicated)
- Tier: {green|yellow|amber|red}
- Strategy: {phase}-optimized
```
