# Design System

Where UI design decisions come from, before you write UI code. These always load. The stack's own UI rules (for example `coding/stacks/react/ui-safety.md`) sharpen this; they do not repeat it.

<!-- trigger: ** -->

- Before you add or change any UI (component, screen, style, layout), check whether `docs/instructions/design-system/` exists in the project. <!-- @rule RL-390e -->
- When it exists, read `tokens.md`, `components.md`, and `patterns.md` first, and make every colour, spacing, type, motion, and component-behaviour value resolve to a token or a documented pattern. <!-- @rule RL-c4b9 -->
- MUST NOT introduce a token, component variant, or style value that contradicts the design system. Extend it by adding to the token files first, then write the code. <!-- @rule RL-e522 -->
- `docs/instructions/design-system/` outranks any inline style or undocumented convention. When it is absent, keep values consistent and named so they can be tokenized later. <!-- @rule RL-7335 -->
