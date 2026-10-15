# Assemble the plugin output: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `build/build.py` | `_unquote`, `_parse_skills_list`, `parse_skills_yml`, `load_config`, `list_shared_files`, `undeclared_shared_imports`, `copy_tree`, `copy_publish_files`, `emit_host_branches`, `build`, `main`, `BuildError`, constants `HOSTS_DIR = "hosts"`, `HOST_BRANCHES`, `HOST_PUBLISH_FILES` and `SKIPPED_FILE_NAMES` |
| `build/skills.yml` | Plugin scalars, the directory listing scalars and the 13-entry `skills` list with `imports` |
| `publish/claude/README.md`, `publish/claude/LICENSE` | End-user README and full MIT licence (`Copyright (c) 2026 Eliyce`) for the Claude branch, the root of the public directory repo. Outside `skills/` and `shared/`, so host and vendor names are allowed |

## Data Contracts

`build/skills.yml` (restricted flat YAML, parsed without a YAML library):

| Line shape | Indent | Meaning |
|---|---|---|
| `key: value` | 0 | Scalar; surrounding single or double quotes removed |
| `skills:` | 0 | Starts the list |
| `- name: <skill>` | 2 | One skill |
| `imports:` | 4 | Starts that skill's imports |
| `- <path>` | 6 | One import, relative to `shared/` (for example `references/voice.md`, `scripts/canonical.py`) |
| `#` comments, blank lines | any | Ignored |

Required non-empty scalars: `name`, `version`, `description`, `license`, `display_name`; the listing scalars `author`, `author_email`, `repository`, `homepage`, `documentation_url`, `support_url`, `privacy_policy_url`, `keywords` (no default for any of them; the five links must start with `https://`; `keywords` is one comma-separated scalar that `parse_keywords` splits into a non-empty list); at least one skill. Quote every URL.

Output layout:

```
<dist>/plugins/<name>/skills/<skill>/...            skill folder copy
<dist>/plugins/<name>/skills/<skill>/<import path>  each declared shared file
<dist>/hosts/<host>/...                             per-host branch (PLG-12)
<dist>/hosts/claude/README.md, LICENSE, PRIVACY.md  Claude branch publish files (repo root)
<dist>/hosts/claude/plugins/<name>/README.md, LICENSE  same README and LICENSE in the plugin folder
```

A shared file keeps its path under `shared/`, so `scripts/check_prose.py` lands at `skills/<skill>/scripts/check_prose.py`.

Per-host branches (PLG-12): after the combined `dist/` root is written, `emit_host_branches` emits one branch per host under `dist/hosts/<host>/` from the one source. Each branch carries the combined skills tree copied byte-identically (via `copy_tree`) plus only the marketplace and manifest files that host reads, generated from the same values by reusing `build_manifests` (see generate-manifests). `HOST_BRANCHES` names the layout per host: `claude` and `chatgpt` use `.claude-plugin/marketplace.json` plus `plugins/<name>/.claude-plugin/plugin.json` (chatgpt emits no `.agents` file; claude writes the listing variants `claude_marketplace` and `claude_plugin` from `build_claude_listing_manifests`); `codex` uses `.agents/plugins/marketplace.json` plus `plugins/<name>/plugin.json`. No branch emits `agents/`, `hooks/`, `commands/`, `bin/`, `.mcp.json`, `mcp.json` or `.app.json`. The combined `dist/` root is left untouched (CI-8).

Publish files (PLG-12): `emit_host_branches(source_root, dist_root, config, combined_plugin_dir)` then calls `copy_publish_files`, which copies each `HOST_PUBLISH_FILES` source with `shutil.copyfile` to every listed target in that host's branch. Only `claude` has entries: `publish/claude/README.md` to `README.md` and `plugins/<name>/README.md`, `publish/claude/LICENSE` to `LICENSE` and `plugins/<name>/LICENSE`, and `docs/privacy-policy.md` to `PRIVACY.md` (one source for the policy, never a second authored copy). A missing source is a `BuildError`, never a silent skip. The Claude branch is the root of the public directory repo `Eliyce/paqad-product-discovery-plugin` (pushed by CI-16), with plugin path `plugins/paqad-product-discovery`.

## Script Interfaces

`python3 build/build.py [--source <repo root>] [--dist <output dir>]`

| Arg | Default |
|---|---|
| `--source` | Parent of the `build/` folder |
| `--dist` | `<source>/dist` |

| Exit | Output |
|---|---|
| 0 | `build ok: <dist>` on stdout |
| 1 | `build failed: <message>` on stderr (any `BuildError`) |

Other exceptions (for example a missing `skills.yml`) are not caught and exit with a traceback.

## State Management

None: stateless. Each run deletes `<dist>` entirely (`shutil.rmtree`) before writing.

## Error Codes

`BuildError` messages:

| Message (pattern) | Meaning |
|---|---|
| `skills.yml line N: expected '- name: <skill>'` | A list item that is not a skill name |
| `skills.yml line N: import before any skill` | Import with no current skill |
| `skills.yml line N: unexpected content ...` / `unexpected indentation` / `expected 'key: value'` | Shape outside the restricted format |
| `skills.yml is missing a non-empty '<field>'` | A required or listing scalar is missing |
| `skills.yml '<field>' must start with https://, got '<value>'` | A listing link is not https |
| `skills.yml 'keywords' has no keyword after splitting on commas` | Empty keywords |
| `publish file not found: <path>` | A `HOST_PUBLISH_FILES` source is missing |
| `skills.yml declares no skills` | Empty skills list |
| `skill folder not found: skills/<name>` | Declared skill has no folder |
| `skills/<name>/SKILL.md is missing` | Folder without instructions |
| `skills/<name>/SKILL.md references undeclared shared import(s): ...` | PLG-10 failure |
| `skills/<name> declares shared import '<p>' but shared/<p> does not exist` | Declared file missing |

## Dependencies

| Kind | Detail |
|---|---|
| Python | Standard library only: `argparse`, `json`, `os`, `shutil`, `sys` |
| Inputs | `skills/`, `shared/`, `build/skills.yml`, `publish/claude/`, `docs/privacy-policy.md` |
| Consumers | `tests/scripts/test_build.py`; `tests/scripts/test_authoring.py` reuses `build.parse_skills_yml`; CI-8 in `.github/workflows/ci.yml` |

## Configuration

| Item | Detail |
|---|---|
| Undeclared-import check | A shared path counts as referenced when its full relative path (for example `references/consulting.md`) appears as a substring of `SKILL.md`. Only `SKILL.md` is scanned, not a skill's references or scripts |
| Copy exclusions | `__pycache__` folders, `*.pyc` files and `.DS_Store` files (`SKIPPED_FILE_NAMES`) |
| Determinism | Sorted directory walks, `shutil.copyfile` (no metadata), no timestamps |
| `dist/` | Generated, gitignored |

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_build.py` | `BuildOutputTest.test_voice_copied_into_each_skill`, `test_no_forbidden_content`, `test_no_bytecode_in_dist`; `DeterminismTest.test_two_builds_byte_identical`; `UndeclaredImportTest.test_undeclared_shared_import_fails_build`; `HostBranchTest` (PLG-12): `test_all_three_branches_exist`, `test_each_branch_carries_only_its_host_manifest_files`, `test_chatgpt_branch_has_no_agents_file`, `test_codex_branch_is_openai_primary`, `test_each_branch_is_skills_only`, `test_branch_skills_tree_matches_combined`, `test_branch_manifests_match_the_single_source`, `test_combined_root_still_intact`; `PublishFilesTest` (targets byte-identical to sources, only the Claude branch carries them, README is an end-user guide with no version number, full MIT LICENSE, privacy policy disclosure and contact, no em or en dash, the one exact nudge link); `BranchHygieneTest.test_claude_branch_is_clean_and_within_limits` (no `.DS_Store`, `__pycache__` or `*.pyc`, every file under 256 KiB, fewer than 512 files); `ListingFailureTest.test_a_missing_publish_file_fails` |
| `.github/workflows/ci.yml` | Step "CI-8 build is deterministic": two builds into `/tmp/dist-a` and `/tmp/dist-b`, then `diff -r` |
