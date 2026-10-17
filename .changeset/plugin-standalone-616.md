---
'paqad-ai': minor
---

Ship paqad as a Claude Code plugin that works on its own, without the npm package (#616).

Inside Claude Code, install with `/plugin marketplace add Eliyce/paqad-ai` then `/plugin install paqad@eliyce`, and drive it with the `/paqad:onboard`, `/paqad:join`, and `/paqad:dashboard` skills. The plugin ships a self-contained `dist/` (no `node_modules`), resolves the optional RAG engine on demand and installs it in the background, keeps a single copy active per session alongside an npm install, puts `paqad-ai` on the session PATH, and keeps itself current. Every other host keeps using the npm package exactly as before; nothing changes for existing npm-only users until they install the plugin. Automatic migration and fail-closed plugin gates are out of scope here.
