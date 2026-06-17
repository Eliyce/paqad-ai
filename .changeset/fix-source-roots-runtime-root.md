---
"paqad-ai": patch
---

Fix `module-health rollup` resolving zero stack packs. `source-roots.ts` shipped a local `resolveRuntimeRoot()` that returned the *parent* of `runtime/` instead of `runtime/` itself, so `StackPackLoader` looked under `<packageRoot>/capabilities` (which does not exist), loaded no packs, and every `discoverModuleHealth`/`discoverSourceRoots` call returned `null` — hard-blocking the rollup with `module_health_unknown`. It now uses the canonical `getRuntimeRoot()`, matching every other framework caller, so module-health refresh resolves the active pack's `module_health` block correctly.
