---
'paqad-ai': patch
---

Onboarding (and `update`) now also write a single `.paqad/.config.example` catalog alongside the per-group `configs/.config.*` files.

`.config.example` lists every framework knob in one file, commented out at its default, with a one-line explanation and its `PAQAD_*` env equivalent — the same copy-paste reference Laravel's `.env.example` provides, so you never have to guess a variable name. It is tracked but never read at runtime; copy a line into a `configs/.config.*` (team) or `.config` (local) file, uncomment it, and set a value. The per-group files are unchanged.
