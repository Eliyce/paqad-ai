# Extractor Pattern Set

The deterministic pattern set lives in `src/module-decisions/extractor.ts`.
Patterns are applied in order; the first hit per slug wins. The set is
intentionally small and framework-owned — extending it is a framework PR.

| Label | Pattern shape | Notes |
| --- | --- | --- |
| `ticket-header-module` | `Module: <name>` | Multi-line ticket headers; case-insensitive. |
| `ticket-header-component` | `Component: <name>` | Same shape as `Module:`. |
| `ticket-header-area` | `Area: <name>` | Same shape. |
| `ticket-header-subsystem` | `Subsystem: <name>` | Same shape. |
| `inline-module-slug` | `module: <slug>` | Inline slug marker. |
| `new-module-name` | `new module <Title Case>` | Stops at first lowercase word. |
| `in-the-module` | `in the <name> module` | Free-form trailing reference. |

## Classification

Each emitted candidate is one of:

- `exact-match` — slug already exists in `module-map.yml`. No decision required.
- `near-collision` — Levenshtein distance ≤ 2 from an existing slug. Always
  surfaced for explicit user disambiguation.
- `unknown` — neither match nor near-match. Becomes an `MD-XXXX` draft.

## Why no LLM

The Attribution Gate runs on every feature-development prompt. A finite
pattern set is auditable, deterministic, and free; an LLM call here would be
the opposite on all three counts.
