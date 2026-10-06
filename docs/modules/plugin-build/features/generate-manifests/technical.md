# Generate host manifests: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `build/build.py` | `build_manifests`, `write_json`, `plugin_rel_path`, `plugin_dir_path`, constants `OPENAI_EXTENSION_KEY = "com.openai"`, `PLUGINS_DIR = "plugins"`, `REQUIRED_SCALARS` |

Values come from `build/skills.yml` (owned by assemble-dist).

## Data Contracts

| File | Content |
|---|---|
| `<dist>/.claude-plugin/marketplace.json` | `marketplace` object |
| `<dist>/.agents/plugins/marketplace.json` | The same `marketplace` object |
| `<dist>/plugins/<name>/.claude-plugin/plugin.json` | `plugin_manifest` |
| `<dist>/plugins/<name>/plugin.json` | `openai_manifest` |
| `<dist>/hosts/{claude,chatgpt}/.claude-plugin/marketplace.json` | `marketplace` object (per-host branch, PLG-12) |
| `<dist>/hosts/{claude,chatgpt}/plugins/<name>/.claude-plugin/plugin.json` | `plugin_manifest` (per-host branch) |
| `<dist>/hosts/codex/.agents/plugins/marketplace.json` | `marketplace` object (per-host branch) |
| `<dist>/hosts/codex/plugins/<name>/plugin.json` | `openai_manifest` (per-host branch) |

The per-host branches reuse `build_manifests`, so every branch's manifests carry the same name, version and description as the combined `dist/` (PLG-11). `emit_host_branches` (assemble-dist) selects which manifests each branch writes.

```json
{"name": "<name>", "owner": {"name": "<author or Paqad>"},
 "plugins": [{"name": "<name>", "source": "./plugins/<name>", "description": "<description>", "version": "<version>"}]}
```

```json
{"name": "<name>", "version": "<version>", "description": "<description>", "license": "<license>"}
```

```json
{"name": "<name>", "version": "<version>", "description": "<description>", "license": "<license>",
 "extensions": {"com.openai": {"display_name": "<display_name>", "skills": ["product-discovery", "ask-project", "..."]}}}
```

`skills` lists skill names in `skills.yml` order. Serialisation: `json.dumps(sort_keys=True, indent=2, separators=(",", ": "))` plus a trailing newline, UTF-8.

Current values (`build/skills.yml`): name `paqad-product-discovery`, version `0.0.0`, licence `MIT`, display name `Paqad Product Discovery`, author `Paqad`. `homepage` is set to a placeholder but is not written into any manifest.

## Script Interfaces

Part of `build/build.py`; see assemble-dist for the CLI and exit codes. `build_manifests(config)` returns `(marketplace, plugin_manifest, openai_manifest)`.

## State Management

None: stateless.

## Error Codes

None of its own. A missing required scalar raises `BuildError("skills.yml is missing a non-empty '<field>'")` in `load_config` before any manifest is written.

## Dependencies

| Kind | Detail |
|---|---|
| Python | Standard library `json`, `os` |
| Host readers | Claude org sync and ChatGPT workspace import (`.claude-plugin/marketplace.json`); Codex local marketplaces and ChatGPT import (`.agents/plugins/marketplace.json`); Claude plugin manifest; OpenAI primary manifest (section 11) |
| Release | CI-14 is meant to bump `version` in `plugin.json` and `marketplace.json`; `release.yml` is a placeholder |

## Configuration

`build/skills.yml` scalars. The `com.openai` literal lives only in `build.py` so shipped text stays vendor-neutral.

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_build.py` | `BuildOutputTest.test_all_four_manifests_exist`, `test_manifests_agree_on_identity`, `test_openai_keys_under_extension`; `DeterminismTest.test_two_builds_byte_identical`; `HostBranchTest.test_branch_manifests_match_the_single_source`, `test_codex_branch_is_openai_primary`, `test_chatgpt_branch_has_no_agents_file` (PLG-12) |
| `.github/workflows/ci.yml` | "CI-8 build is deterministic" |

Not yet automated: CI-9 official validators on `dist/` (placeholder step). Manual: U-2 in `hosts/chatgpt.md`, U-12 in `hosts/codex.md` (both `pending`).
