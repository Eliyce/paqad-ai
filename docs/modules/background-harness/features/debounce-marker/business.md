# Debounce Marker — Business View

> Module: **Background-Worker Harness** (`background-harness`) · Layer: `framework-internals` · Feature slug: `debounce-marker`

## Overview

A tiny marker file whose mtime records when a job last spawned a worker. It is
the cheap, leading-edge guard that runs before the single-flight lock is even
consulted, so a burst of prompts (every keystroke-driven hook firing) produces
at most one background refresh per window — including in the quiet moment just
after a worker finished, which the lock alone cannot cover.

The technical contract lives at [`technical.md`](./technical.md).

## User Roles

- **paqad-ai contributor** — tunes `debounceMs` per artifact to balance freshness against churn.

## User Flows

- **Check:** `shouldDebounce(markerPath, debounceMs, now)` returns true while the
  last spawn is newer than `debounceMs` ago.
- **Stamp:** `touchMarker(markerPath, now)` opens a fresh window after a spawn.

## Business Rules

- First run (no marker) is never debounced.
- `debounceMs <= 0` disables debouncing entirely.
- Stamping updates the timestamp in place; it never churns the marker's contents.

## Triggers & Side Effects

- Creates the marker file (and parents) and updates its mtime.

## Error States

- A filesystem that rejects `utimes` still leaves a fresh mtime from the write,
  which is sufficient for debounce — failures degrade quietly, not loudly, here
  because a missed debounce only costs one extra (still non-blocking) spawn.

## Glossary

- *leading-edge guard* — suppression decided up front, before any lock work.
