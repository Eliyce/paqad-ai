# Vue Foundation

- Use the project's existing libraries — Vue Router for routing, Pinia for shared state, and a data layer like TanStack Query (Vue) or `useFetch`/`useAsyncData` in Nuxt — instead of hand-rolling routing, global stores, or fetch caching.
- Use Pinia stores for cross-component shared state; keep purely local state in component `ref`/`reactive`. Do not use `provide`/`inject` as a substitute for a store for app-wide mutable state.
- Share stateful logic through composables that return refs/computed; do not reach into another component's internals.
- Use `<script setup>` macros (`defineProps`, `defineEmits`, `defineModel`, `defineExpose`) for the component contract rather than manual `setup()` return wiring.
- Clean up side effects (timers, listeners, subscriptions) in `onUnmounted` (or the watcher's cleanup callback) to avoid leaks.
