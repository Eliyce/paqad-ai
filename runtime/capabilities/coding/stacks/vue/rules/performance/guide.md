# Vue Performance

- Vue tracks reactive dependencies automatically; do not add manual memoization speculatively. Optimize only re-renders confirmed expensive in the Vue DevTools performance/profiler view.
- Use `computed()` for expensive derivations so results cache until dependencies change, instead of recomputing in the template or a method on every render.
- Mark large, deeply-nested data that does not need deep reactivity with `shallowRef`/`shallowReactive` (or `markRaw` for non-reactive objects) to avoid the cost of deep proxying.
- Code-split routes and heavy components with dynamic `import()` (async route components / `defineAsyncComponent`) so they are not in the initial bundle.
- Virtualize long lists (`vue-virtual-scroller` or similar) instead of rendering thousands of `v-for` nodes; always provide a stable `:key`.
- Use `v-show` for elements toggled frequently and `v-if` for those rarely rendered; do not pair `v-if` with `v-for` on the same element.
- Apply `v-once`/`v-memo` only to confirmed-static or expensive list rows, not as a blanket optimization.
