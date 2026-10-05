# Design System

- Before proposing any UI change (component, screen, style, layout), check whether `docs/instructions/design-system/` exists in the project. <!-- @rule RL-513a -->
- If it exists, read `tokens.md`, `components.md`, and `patterns.md` before writing code. All colours, spacing, typography, motion, and component behaviour must align with those specifications. <!-- @rule RL-e370 -->
- Do not introduce design tokens, component variants, or style values that contradict the documented design system. Extend it by adding to the token files first, then implement. <!-- @rule RL-e36e -->
- If `docs/instructions/design-system/` does not exist, follow general good-practice UI conventions and keep values consistent so they can be tokenized later. <!-- @rule RL-e0f2 -->
- `docs/instructions/design-system/` is the single source of truth for UI design decisions; it takes precedence over ad-hoc inline styles or undocumented conventions. <!-- @rule RL-47b1 -->
