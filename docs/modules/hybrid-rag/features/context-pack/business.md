# Context Pack — Business View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `context-pack`

## Overview

When a task is broad and retrieval surfaces many slices, injecting all of those code
bodies bloats the context. Instead, this feature distils them into a compact pack of
POINTERS — `file:line-line` locations each with a one-line hint — so the model sees where
to look and opens the live file only when it needs the actual code. Long workflows stay
lean and the context carries directions, not dumps.

This page describes **Context Pack** from a business perspective. The technical contract
lives at [`technical.md`](./technical.md).

## User Roles

- **Developer** — long, multi-step tasks stay within budget; the model is pointed at the
  right places rather than flooded with code.
- **paqad-ai contributor** — a lean alternative to full-slice injection for broad stages.

## User Flows

- **Broad stage:** retrieval pulls more than a handful of slices, so the session context
  gets a pack of pointers (path + line range + hint) instead of slice bodies.
- **Narrow stage:** a small set keeps the full slices (no change).

## Business Rules

- Pointers, not bodies — the model reads the live file at the pointer when it needs the code.
- Bounded — the pack is capped and deduped so it never grows large.
- Advisory — the match % is the index's confidence, not correctness; the live file wins.

## Triggers & Side Effects

- Runs in the background context refresh; chooses pack vs full slices by how broad the
  working set is. No separate artifact.

## Error States

- A file that can't be read simply yields a path+hint pointer with no line range. Never an
  error.

## Glossary

- *context pack* — the compact list of pointers.
- *pointer* — a `file:Lstart-Lend` location with a one-line hint.
