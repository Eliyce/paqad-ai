# Vue Conventions

- Use `<script setup lang="ts">` SFCs; declare props with type-based `defineProps<...>()` and emits with `defineEmits<...>()`, and implement `v-model` props with the `defineModel()` macro rather than manual prop + `update:` event wiring.
- Keep reactive primitives in `ref()` and access/mutate them via `.value` in script; reach for `reactive()` only for objects, and never replace a `reactive` object wholesale (it breaks reactivity) — mutate its fields.
- Derive values with `computed()` (read-only by default); do not duplicate derivable state into a separate `ref` kept in sync by a watcher.
- Use `watch`/`watchEffect` for side effects only; prefer `computed` for derived data. Specify explicit sources in `watch` rather than over-broad deep watching.
- Provide a stable, domain-derived `:key` on `v-for` (an entity id), never the index for lists that reorder/insert/delete; never put `v-if` and `v-for` on the same element.
- Name components multi-word in `PascalCase` and reference them in templates in `PascalCase`; name composables `useX`.
- Use `useTemplateRef()` (Vue 3.5) for template refs and `useId()` for generated accessibility/form ids instead of ad hoc counters.
