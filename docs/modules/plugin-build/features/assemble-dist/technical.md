# Assemble the plugin output: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `build/build.py` | `_unquote`, `_parse_skills_list`, `parse_skills_yml`, `load_config`, `list_shared_files`, `undeclared_shared_imports`, `copy_tree`, `emit_host_branches`, `build`, `main`, `BuildError`, constants `HOSTS_DIR = "hosts"` and `HOST_BRANCHES` |
| `build/skills.yml` | Plugin scalars and the 13-entry `skills` list with `imports` |

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

Required non-empty scalars: `name`, `version`, `description`, `license`, `display_name`; at least one skill. Optional: `author` (used in manifests), `homepage` (present, not read by the build).

Output layout:

```
<dist>/plugins/<name>/skills/<skill>/...            skill folder copy
<dist>/plugins/<name>/skills/<skill>/<import path>  each declared shared file
<dist>/hosts/<host>/...                             per-host branch (PLG-12)
```

A shared file keeps its path under `shared/`, so `scripts/check_prose.py` lands at `skills/<skill>/scripts/check_prose.py`.

Per-host branches (PLG-12): after the combined `dist/` root is written, `emit_host_branches` emits one branch per host under `dist/hosts/<host>/` from the one source. Each branch carries the combined skills tree copied byte-identically (via `copy_tree`) plus only the marketplace and manifest files that host reads, generated from the same values by reusing `build_manifests` (see generate-manifests). `HOST_BRANCHES` names the layout per host: `claude` and `chatgpt` use `.claude-plugin/marketplace.json` plus `plugins/<name>/.claude-plugin/plugin.json` (chatgpt emits no `.agents` file); `codex` uses `.agents/plugins/marketplace.json` plus `plugins/<name>/plugin.json`. No branch emits `agents/`, `hooks/`, `commands/`, `bin/`, `.mcp.json`, `mcp.json` or `.app.json`. The combined `dist/` root is left untouched (CI-8).

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
| `skills.yml is missing a non-empty '<field>'` | A required scalar is missing |
| `skills.yml declares no skills` | Empty skills list |
| `skill folder not found: skills/<name>` | Declared skill has no folder |
| `skills/<name>/SKILL.md is missing` | Folder without instructions |
| `skills/<name>/SKILL.md references undeclared shared import(s): ...` | PLG-10 failure |
| `skills/<name> declares shared import '<p>' but shared/<p> does not exist` | Declared file missing |

## Dependencies

| Kind | Detail |
|---|---|
| Python | Standard library only: `argparse`, `json`, `os`, `shutil`, `sys` |
| Inputs | `skills/`, `shared/`, `build/skills.yml` |
| Consumers | `tests/scripts/test_build.py`; `tests/scripts/test_authoring.py` reuses `build.parse_skills_yml`; CI-8 in `.github/workflows/ci.yml` |

## Configuration

| Item | Detail |
|---|---|
| Undeclared-import check | A shared path counts as referenced when its full relative path (for example `references/consulting.md`) appears as a substring of `SKILL.md`. Only `SKILL.md` is scanned, not a skill's references or scripts |
| Copy exclusions | `__pycache__` folders and `*.pyc` files |
| Determinism | Sorted directory walks, `shutil.copyfile` (no metadata), no timestamps |
| `dist/` | Generated, gitignored |

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_build.py` | `BuildOutputTest.test_voice_copied_into_each_skill`, `test_no_forbidden_content`, `test_no_bytecode_in_dist`; `DeterminismTest.test_two_builds_byte_identical`; `UndeclaredImportTest.test_undeclared_shared_import_fails_build`; `HostBranchTest` (PLG-12): `test_all_three_branches_exist`, `test_each_branch_carries_only_its_host_manifest_files`, `test_chatgpt_branch_has_no_agents_file`, `test_codex_branch_is_openai_primary`, `test_each_branch_is_skills_only`, `test_branch_skills_tree_matches_combined`, `test_branch_manifests_match_the_single_source`, `test_combined_root_still_intact` |
| `.github/workflows/ci.yml` | Step "CI-8 build is deterministic": two builds into `/tmp/dist-a` and `/tmp/dist-b`, then `diff -r` |
