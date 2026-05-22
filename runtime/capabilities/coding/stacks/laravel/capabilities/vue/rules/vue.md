# Vue.js with Laravel

- Use the Composition API (`<script setup>`) exclusively; avoid the Options API for new components.
- Define props with `defineProps<T>()` using TypeScript generics; never use untyped props.
- Define emits with `defineEmits<T>()` so event contracts are explicit and checkable.
- Co-locate component logic, template, and styles within the same `.vue` file for small components; extract composables to `resources/js/composables/` when logic is reused across two or more components.
- Use `computed` for derived state and `watch` only when a side effect must respond to reactive changes; prefer `watchEffect` for effects that depend on multiple reactive sources.
- Keep components small and focused; a component that exceeds roughly 200 lines is a signal to extract child components or composables.
- Prefer server-side data passing via Inertia props or API resources over client-side fetching for initial page loads.
- Validate and sanitize all user inputs before submission; do not trust frontend-only validation.
- Write unit tests for components with significant logic using Vitest and Vue Test Utils.
- Keep `resources/js/` module boundaries aligned with Laravel module directories in `app/`.
- Document non-obvious component behaviour and prop/emit contracts in the corresponding module UI doc.
- Use `<Transition>` and `<TransitionGroup>` for UI state changes rather than manual CSS class toggling.
- Avoid direct DOM manipulation; always work through Vue's reactivity system.
