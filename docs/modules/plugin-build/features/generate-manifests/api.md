# Generate host manifests: API

This feature has no network or HTTP API. It is part of the build command (see the assemble-dist
feature) and has no separate entry point. Its contract is the set of manifest files it writes,
all generated from the single source of truth in `build/skills.yml` so no two can disagree
(PLG-11).

## Manifests written

| Path in `dist/` | Read by | Shape |
|---|---|---|
| `.claude-plugin/marketplace.json` | Claude org sync, ChatGPT workspace import | `{ name, owner, plugins: [{name, source, description, version}] }` |
| `.agents/plugins/marketplace.json` | Codex local marketplaces, ChatGPT import | Same marketplace shape |
| `plugins/<name>/.claude-plugin/plugin.json` | Claude plugin manifest | `{ name, version, description, license }` |
| `plugins/<name>/plugin.json` | OpenAI primary manifest | `{ name, version, description, license, extensions: { "com.openai": { display_name, skills } } }` |

All JSON is written with sorted keys and fixed separators so repeat builds are byte-identical. No
`.mcp.json`, `mcp.json` or `.app.json` is ever emitted (PLG-2).
