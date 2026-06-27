# Structural Repo-Map — Business View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `repo-map`

## Overview

A cheap, whole-repo orientation layer. It ranks the project's files by how central they
are in the import graph and writes a short, budgeted skeleton that tells the model
where the important code lives and where to grep. It costs no embeddings and works even
when retrieval is turned off, so every session can get its bearings for a few hundred
tokens.

This page describes **Structural Repo-Map** from a business perspective. The technical
contract lives at [`technical.md`](./technical.md).

## User Roles

- **Developer** — gets a one-glance map of the codebase's load-bearing files without
  paying for embeddings or reading whole directories.
- **paqad-ai contributor** — a structural complement to the module map and to semantic
  retrieval.

## User Flows

- **Orientation:** the model receives a ranked skeleton of the most-imported files,
  each with its module role and a few key symbols, and uses it to decide where to look.

## Business Rules

- It never uses embeddings, so it works with RAG disabled.
- It is token-budgeted: only the most central files are listed, and the list is cut to
  fit a small budget.
- It is advisory orientation, not ground truth — the model still reads the live files.

## Triggers & Side Effects

- Pure computation over import edges; no writes of its own yet (the skeleton is meant
  to ride the session-context seam alongside rules and retrieval).

## Error States

- No files, or a project with no resolvable imports → an empty or flat map; never an
  error.

## Glossary

- *PageRank* — a ranking that rewards files many other files import (and that important
  files import).
- *skeleton* — the short, ranked list of files, not their full contents.
