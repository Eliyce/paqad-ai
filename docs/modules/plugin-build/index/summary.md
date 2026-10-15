# Plugin Build

Turns the repository's skills and shared material into the installable, skills-only plugin, and writes every host manifest from one set of values so they can never disagree.

| | |
|---|---|
| Layer | build-and-delivery |
| Confidence | high |
| Entry skill | none (build and delivery) |
| Depends on | none |
| Used by | [quality-and-release](../../quality-and-release/index/summary.md) |

## Features

| Feature | What it does | Docs |
|---|---|---|
| Assemble the plugin output | Reads `build/skills.yml`, refuses undeclared shared imports, wipes and rebuilds `dist/`, copies each skill plus its declared shared files, and emits the per-host branches under `dist/hosts/{claude,chatgpt,codex}/`; the Claude branch also gets the publish files `README.md`, `LICENSE` and `PRIVACY.md` |  [business](../features/assemble-dist/business.md), [technical](../features/assemble-dist/technical.md) |
| Generate host manifests | Writes the two marketplace files and the two plugin manifests from the same values, deterministically, plus the Claude-only directory listing manifests | [business](../features/generate-manifests/business.md), [technical](../features/generate-manifests/technical.md) |

## Sources

| Path | Role |
|---|---|
| `build/build.py` | The build: config reader, import check, copy, manifests, CLI |
| `build/skills.yml` | Single source of truth: plugin identity, directory listing scalars and each skill's shared imports |
| `publish/claude/` | README and LICENSE copied into the Claude branch (with `docs/privacy-policy.md` as `PRIVACY.md`) |
| `tests/scripts/test_build.py` | Unit tests for the build (owned by quality-and-release) |

## Requirements

- PLG-1, PLG-2: skills only; no `agents/`, `hooks/`, `commands/`, `bin/`, `.mcp.json`, `mcp.json` or `.app.json`.
- PLG-5: Python 3.9+, standard library only, no network.
- PLG-9: shared material held once and copied into each declaring skill.
- PLG-10: each skill declares its shared imports; the build fails on an undeclared one.
- PLG-11: every manifest generated from one source of truth, including the directory listing scalars.
- PLG-12: per-host distribution branches under `dist/hosts/{claude,chatgpt,codex}/`, emitted from the one source alongside the unchanged combined `dist/` root (claude and chatgpt use the `.claude-plugin` layout, chatgpt without an `.agents` file; codex uses `.agents/plugins/marketplace.json` plus `plugins/<name>/plugin.json`). The Claude branch alone carries the directory listing fields, `README.md`, `LICENSE` and `PRIVACY.md`.
- CI-8: build succeeds, rejects undeclared imports, two builds are identical.
