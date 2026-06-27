# Codebase Memory — Business View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `codebase-memory`

## Overview

A durable, cross-session memory of facts about the repository. When a session learns
something worth keeping (where a subsystem lives, a decision that was taken, a mistake
that keeps recurring, a house-style rule), it can record it. The next session gets those
facts injected at the top of its context, so the codebase carries its own memory instead
of relearning the same things every time.

It is deliberately deterministic and embedding-free: recall is exact, not a similarity
guess, so a remembered fact is never silently dropped. It works even when retrieval is
turned off.

This page describes **Codebase Memory** from a business perspective. The technical
contract lives at [`technical.md`](./technical.md).

## User Roles

- **Developer** — benefits from a project that remembers its own conventions, decisions,
  and pitfalls across sessions, without re-explaining them each time.
- **paqad-ai contributor** — a durable complement to the ephemeral retrieval slices and
  the always-resident rules.

## User Flows

- **Learn:** a workflow records a fact under a kind (repo fact, decision, recurring
  failure, house style) and a key.
- **Evolve:** recording the same kind+key again replaces the old fact in place — the
  memory is corrected, never duplicated into two contradictory copies.
- **Recall:** at the start of the next session the freshest facts are injected as a short
  `## Codebase memory` section, grouped by kind.

## Business Rules

- Deterministic, embedding-free recall — every stored fact is surfaced (within budget),
  never a confident-but-wrong similarity hit.
- Token-budgeted — only the freshest facts are injected, capped by count and characters.
- Supersede, never duplicate — a fact evolves in place when re-recorded.
- Advisory, not ground truth — the model is told to re-verify against the live code.
- Per-machine and regenerable for now; team-shared cross-provider memory is a separate
  effort and out of scope here.

## Triggers & Side Effects

- Recording a fact writes the single JSON store atomically.
- The background context refresh reads the store and injects the section via the same
  session-context seam the rules and retrieval slices ride.

## Error States

- Missing or corrupt store → an empty section; the session proceeds exactly as today.
  Never an error.

## Glossary

- *kind* — the category of a fact: repo fact, decision, recurring failure, or house style.
- *key* — a fact's identity within its kind; the supersede axis.
- *supersede* — replacing a fact in place when it is re-recorded under the same kind+key.
