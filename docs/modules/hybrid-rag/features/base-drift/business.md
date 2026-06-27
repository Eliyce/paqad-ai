# Base-Drift Awareness — Business View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `base-drift`

## Overview

Tells the developer when the branch they started from has moved on — "origin/main is N
commits ahead of where you branched" — so they can pull or rebase before relying on stale
assumptions. It does this without slowing anything down: the network check runs in the
background at most once every several minutes, and the prompt only ever reads the last
result.

This page describes **Base-Drift Awareness** from a business perspective. The technical
contract lives at [`technical.md`](./technical.md).

## User Roles

- **Developer** — gets an early heads-up that the base branch advanced, before a surprise
  merge conflict or a stale-assumption bug.
- **paqad-ai contributor** — a secondary, advisory context layer alongside rules and
  retrieval.

## User Flows

- **Background:** a debounced check fetches the remote base only when its tip actually
  moved, then records how far ahead it is.
- **Prompt:** the recorded drift, if any, is surfaced as a one-line heads-up.

## Business Rules

- No per-prompt network — the fetch is debounced (every several minutes) and runs off the
  critical path.
- Never blocks, and is silent on network/auth failure (you simply get no heads-up).
- Advisory only — it suggests pulling/rebasing; it never acts on the repo.

## Triggers & Side Effects

- The background context refresh runs the debounced fetch; the drift snapshot is written
  to `.paqad/session/base-drift.json`.

## Error States

- Offline, no remote, or an auth failure → no heads-up, no error.

## Glossary

- *base drift* — how far the remote base branch has advanced since you branched.
- *tip-check* — a cheap `ls-remote` that avoids fetching when nothing changed.
