# Performance

## Purpose

Bias the framework toward efficient, deterministic execution.

## Rules

- Load only the context required for the current phase.
- Prefer differential refresh over full rebuilds.
- Reuse cacheable skill results when inputs are unchanged.
