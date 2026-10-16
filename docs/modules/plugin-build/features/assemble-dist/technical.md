# Assemble the plugin output: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `build/build.py` | `_unquote`, `_parse_skills_list`, `parse_skills_yml`, `load_config`, `list_shared_files`, `undeclared_shared_imports`, `copy_tree`, `copy_publish_files`, `emit_host_branches`, `build`, `main`, `BuildError`, constants `HOSTS_DIR = "hosts"`, `CHATGPT_DIRECTORY_HOST = "chatgpt-directory"`, `HOST_BRANCHES`, `HOST_PUBLISH_FILES` and `SKIPPED_FILE_NAMES` |
| `build/skills.yml` | Plugin scalars, the directory listing scalars, the ChatGPT directory scalars and the `skills` list with `imports` |
| `build/package_chatgpt.py` | `make_zip`, `default_package_dir`, `main`: packs the ChatGPT directory package into the submission zip (CI-16) |
| `build/check_chatgpt_submission.py` | The pre-submission check of that zip or folder (CI-16); see Script Interfaces |
| `publish/chatgpt/README.md` | End-user README of the ChatGPT directory package. Outside `skills/` and `shared/`, so host and vendor names are allowed |
| `publish/claude/README.md`, `publish/claude/LICENSE`, `publish/claude/icon.png` | End-user README, full MIT licence (`Copyright (c) 2026 Eliyce`) and the square paqad mark (1024 px PNG) used as the directory listing icon, for the Claude branch, the root of the public directory repo. Outside `skills/` and `shared/`, so host and vendor names are allowed |

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

Required non-empty scalars: `name`, `version`, `description`, `license`, `display_name`; the listing scalars `author`, `author_email`, `repository`, `homepage`, `documentation_url`, `support_url`, `privacy_policy_url`, `keywords` (no default for any of them; the five links must start with `https://`; `keywords` is one comma-separated scalar that `parse_keywords` splits into a non-empty list); the ChatGPT directory scalars `short_description`, `long_description`, `category`, `default_prompts` and `capabilities` (checked by `check_chatgpt_directory_scalars`; `default_prompts` and `capabilities` are each one `|`-separated scalar that `parse_pipe_list` splits and trims, see generate-manifests for the limits); at least one skill. Quote every URL.

Output layout:

```
<dist>/plugins/<name>/skills/<skill>/...            skill folder copy
<dist>/plugins/<name>/skills/<skill>/<import path>  each declared shared file
<dist>/hosts/<host>/...                             per-host branch (PLG-12)
<dist>/hosts/claude/README.md, LICENSE, PRIVACY.md  Claude branch publish files (repo root)
<dist>/hosts/claude/plugins/<name>/README.md, LICENSE  same README and LICENSE in the plugin folder
<dist>/hosts/claude/plugins/<name>/.claude-plugin/icon.png  directory listing icon (no manifest key)
<dist>/hosts/chatgpt-directory/plugins/<name>/plugin.json, README.md, LICENSE, PRIVACY.md, assets/logo.png, skills/...
                                                    ChatGPT directory package (the zip packs this folder)
```

A shared file keeps its path under `shared/`, so `scripts/check_prose.py` lands at `skills/<skill>/scripts/check_prose.py`.

Per-host branches (PLG-12): after the combined `dist/` root is written, `emit_host_branches` emits one branch per host under `dist/hosts/<host>/` from the one source. Each branch carries the combined skills tree copied byte-identically (via `copy_tree`) plus only the marketplace and manifest files that host reads, generated from the same values by reusing `build_manifests` (see generate-manifests). `HOST_BRANCHES` names the layout per host: `claude` and `chatgpt` use `.claude-plugin/marketplace.json` plus `plugins/<name>/.claude-plugin/plugin.json` (chatgpt emits no `.agents` file; claude writes the listing variants `claude_marketplace` and `claude_plugin` from `build_claude_listing_manifests`); `codex` uses `.agents/plugins/marketplace.json` plus `plugins/<name>/plugin.json`; `chatgpt-directory` writes only `plugins/<name>/plugin.json` of kind `chatgpt_directory` (no marketplace file, no `.claude-plugin/`, no `.agents/`), in its documented key order rather than sorted (`ORDERED_MANIFEST_KINDS`). No branch emits `agents/`, `hooks/`, `commands/`, `bin/`, `.mcp.json`, `mcp.json` or `.app.json`. The combined `dist/` root is left untouched (CI-8).

Publish files (PLG-12): `emit_host_branches(source_root, dist_root, config, combined_plugin_dir)` then calls `copy_publish_files`, which copies each `HOST_PUBLISH_FILES` source with `shutil.copyfile` to every listed target in that host's branch. `claude` has: `publish/claude/README.md` to `README.md` and `plugins/<name>/README.md`, `publish/claude/LICENSE` to `LICENSE` and `plugins/<name>/LICENSE`, `docs/privacy-policy.md` to `PRIVACY.md` (one source for the policy, never a second authored copy), and `publish/claude/icon.png` to `plugins/<name>/.claude-plugin/icon.png`, the path the directory reads for the listing icon, so no manifest gains an `icon` key. The directory takes the icon only on the first save or submit of the listing. A missing source is a `BuildError`, never a silent skip. The Claude branch is the root of the public directory repo `Eliyce/paqad-product-discovery-plugin` (pushed by CI-16), with plugin path `plugins/paqad-product-discovery`. `chatgpt-directory` has: `publish/chatgpt/README.md`, `publish/claude/LICENSE` and `docs/privacy-policy.md` to `README.md`, `LICENSE` and `PRIVACY.md` in `plugins/<name>/`, and `publish/claude/icon.png` to `plugins/<name>/assets/logo.png` (the `logo` path in its manifest). Everything sits inside the plugin root, because that root is what the zip packs.

Submission zip (CI-16): packing and checking live outside `build()`, so `dist/` never holds a zip. `make_zip(package_dir, zip_path)` writes one top-level folder `<name>/` holding every file and folder of the package dir and nothing else. The encoding is fixed: entries sorted by archive path, an explicit `/`-ended entry for every folder, `date_time` (1980, 1, 1, 0, 0, 0), `create_system` 3, file mode `0o100644`, folder mode `0o040755`, files deflated at level 9, folders stored, no comment. Two runs in one interpreter and zlib build give the same bytes; the Python 3.9 and 3.12 zips are not promised to match. `.DS_Store`, `__pycache__/` and `*.pyc` are skipped; a symlink or any entry that is not a regular file or folder stops the run.

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

`python3 build/package_chatgpt.py [--dist DIR] [--out FILE]`

| Arg | Default |
|---|---|
| `--dist` | `<repo>/dist`; the package dir is `<dist>/hosts/chatgpt-directory/plugins/<name>` |
| `--out` | `<repo>/paqad-product-discovery-chatgpt-v<version>.zip` (name and version from `load_config`; gitignored) |

| Exit | Output |
|---|---|
| 0 | The zip path on stdout |
| 1 | One line on stderr: `ChatGPT directory package not found at <path>; run python3 build/build.py first`, `<path> is a symlink; the directory zip allows regular files and folders only`, a non-regular entry, or a `skills.yml` error |

`python3 build/check_chatgpt_submission.py [--zip FILE | --package DIR]` checks a zip, a folder, or by default the built package dir. Both modes load the entries into one neutral list (archive path, bytes, kind, mode), so every rule runs the same way. A zip is read in memory and never extracted, written or run; in folder mode a symlink is reported, never followed. Stdout is one JSON object `{"ok", "source", "errors", "warnings"}`, each item `{"rule", "path", "message"}` sorted by path then rule; the message names the limit, the actual value and the fix (the `skills.yml` scalar when that is the fix).

| Exit | Meaning |
|---|---|
| 0 | No error (warnings allowed, for example `skill.metadata`) |
| 1 | At least one error |
| 2 | Input error (zip missing, not a zip, folder missing, or both `--zip` and `--package`); `{"ok": false, "error"}` on stderr |

Rule codes: `archive.*` (compressed and uncompressed size, entry count, entry type, unsafe path including a `..` or `.` segment, a duplicate entry), `plugin_root_ambiguous`, `excluded.*` (app, mcp, hooks, commands, agents, bin, claude_files, reviewer_files, secret; a per-skill `skills/<s>/agents/openai.yaml` and skill helper scripts stay allowed), `manifest.*`, `interface.*`, `screenshot_configuration_excluded`, `asset.*` (path, format, dimensions, size of `logo` and any `composerIcon`) and `skills.*` / `skill.*`. The frontmatter reader is a minimal stdlib mapping reader that fails loudly on any form it does not support, and it rejects an unquoted value that contains `: ` or ` #` or ends with `:`, since strict YAML readers refuse those (source skill descriptions are double-quoted for this reason). The check covers only OpenAI's documented rules (fetched 2026-10-16), so it is necessary, not sufficient; its docstring and `--help` say so, and each new portal error becomes a new rule plus a failing-fixture test.

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
| Python | Standard library only: `argparse`, `json`, `os`, `shutil`, `sys`; the zip scripts also use `zipfile`, `stat`, `struct`, `zlib`, `re`, `posixpath` and `urllib.parse` |
| Inputs | `skills/`, `shared/`, `build/skills.yml`, `publish/claude/`, `publish/chatgpt/`, `docs/privacy-policy.md` |
| Consumers | `tests/scripts/test_build.py`; `tests/scripts/test_authoring.py` reuses `build.parse_skills_yml`; `build/package_chatgpt.py` and `build/check_chatgpt_submission.py` import `build`; CI-8 and CI-16 in `.github/workflows/ci.yml`; CI-16 in `release.yml` |

## Configuration

| Item | Detail |
|---|---|
| Undeclared-import check | A shared path counts as referenced when its full relative path (for example `references/consulting.md`) appears as a substring of `SKILL.md`. Only `SKILL.md` is scanned, not a skill's references or scripts |
| Copy exclusions | `__pycache__` folders, `*.pyc` files and `.DS_Store` files (`SKIPPED_FILE_NAMES`) |
| Determinism | Sorted directory walks, `shutil.copyfile` (no metadata), no timestamps; the submission zip uses the fixed encoding above |
| `dist/` | Generated, gitignored; never holds a zip. The submission zip `/paqad-product-discovery-*.zip` is gitignored too |

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_build.py` | `BuildOutputTest.test_voice_copied_into_each_skill`, `test_no_forbidden_content`, `test_no_bytecode_in_dist`; `DeterminismTest.test_two_builds_byte_identical`; `UndeclaredImportTest.test_undeclared_shared_import_fails_build`; `HostBranchTest` (PLG-12, with `chatgpt-directory` in the branch list): `test_all_three_branches_exist`, `test_each_branch_carries_only_its_host_manifest_files`, `test_chatgpt_branch_has_no_agents_file`, `test_codex_branch_is_openai_primary`, `test_each_branch_is_skills_only`, `test_branch_skills_tree_matches_combined`, `test_branch_manifests_match_the_single_source`, `test_combined_root_still_intact`; `PublishFilesTest` (targets byte-identical to sources, only the Claude branch carries them, README is an end-user guide with no version number, full MIT LICENSE, privacy policy disclosure and contact, no em or en dash, the one exact nudge link); `BranchHygieneTest.test_claude_branch_is_clean_and_within_limits` (no `.DS_Store`, `__pycache__` or `*.pyc`, every file under 256 KiB, fewer than 512 files); `ListingFailureTest.test_a_missing_publish_file_fails`, `test_a_missing_chatgpt_readme_fails` |
| `tests/scripts/test_chatgpt_submission.py` | `PackageLayoutTest` (branch holds only the plugin root, files byte-identical to their sources, manifest from the single source, README rules, building creates no zip); `ZipTest` (the real zip passes with no error or warning, two runs byte-identical with the fixed encoding, CLI and default name); `PackageErrorTest` (missing package, symlinks, a FIFO, cruft skipped, bad `skills.yml`); one failing fixture per rule in `ArchiveRuleTest`, `ExcludedContentTest`, `ManifestRuleTest`, `InterfaceRuleTest`, `AssetRuleTest`, `SkillRuleTest` (plus the `skill.metadata` warning); `ModeTest` (folder, zip and default modes agree, input errors exit 2, sorted output, `--help` says necessary, not sufficient). Fixtures mutate a copy of the real package, never hand-copied values |
| `tests/scripts/test_listing_icon.py` | `ListingIconTest`: the source icon is a square PNG 512 to 2048 px under 2 MB, the Claude plugin folder carries it byte-identical, no other branch or the combined root carries `icon.png`, `assets/logo.png` exists only in the ChatGPT directory branch, and no manifest gains an `icon` key (the ChatGPT package names its logo under `interface.logo`) |
| `.github/workflows/ci.yml` | Step "CI-8 build is deterministic": two builds into `/tmp/dist-a` and `/tmp/dist-b`, then `diff -r`; step "CI-16 ChatGPT submission zip is deterministic and passes the pre-submission check" |
