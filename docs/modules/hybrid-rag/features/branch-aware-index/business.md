# Branch-Aware Index — Business View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `branch-aware-index`

## Overview

The RAG index records which branch and commit it reflects, and the base branch it
diverged from. This is the substrate for a branch-aware index (RAG buildout Phase
3): a branch switch can self-heal to the new branch's content, re-embedding only
what changed, and base-drift ("main moved ahead of you") can be surfaced without
the index silently serving stale or wrong-branch results.

This page describes **Branch-Aware Index** from a business perspective. The
technical contract lives at [`technical.md`](./technical.md).

## User Roles

- **Developer** — trusts that retrieval reflects the branch they are actually on,
  not whatever was indexed last.
- **paqad-ai contributor** — builds branch self-heal (F9) and base-drift awareness
  (F27) on top of this recorded state.

## User Flows

- **Build the index:** every index build stamps the current branch, HEAD commit,
  base branch, and merge-base into the index metadata.
- **Non-git project:** the build still succeeds; the branch fields are simply
  absent.

## Business Rules

- The base branch is auto-detected (`main`, then `master`) unless configured via
  `rag_base_branch` (team/local/env config layers; release branches honoured).
- Every git field is best-effort: a non-git directory, a detached HEAD, or a
  missing base leaves that field unset rather than failing the build.
- The git state is read-only — building the index never mutates the repo.

## Triggers & Side Effects

- Reads git state on index build; writes the four fields into the index metadata.

## Error States

- git absent or any query failing → the affected field is left undefined; the
  index build is never blocked.

## Glossary

- *base branch* — the branch this one is compared against (main/master/release).
- *merge-base* — the commit where the current branch diverged from its base.
