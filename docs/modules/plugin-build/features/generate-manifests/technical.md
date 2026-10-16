# Generate host manifests: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `build/build.py` | `build_manifests`, `build_claude_listing_manifests`, `build_chatgpt_directory_manifest`, `parse_keywords`, `parse_pipe_list`, `check_listing_scalars`, `check_chatgpt_directory_scalars`, `write_json`, `plugin_rel_path`, `plugin_dir_path`, constants `OPENAI_EXTENSION_KEY = "com.openai"`, `PLUGINS_DIR = "plugins"`, `REQUIRED_SCALARS`, `LISTING_SCALARS`, `LISTING_URL_SCALARS`, `CHATGPT_DIRECTORY_SCALARS`, `AGENT_PLUGINS_SCHEMA_URL`, `AGENT_PLUGINS_MANIFEST_KEYS`, `CHATGPT_INTERFACE_KEYS`, `CHATGPT_LOGO_PATH`, `CHATGPT_CATEGORIES`, `CHATGPT_LIMITS`, `ORDERED_MANIFEST_KINDS` |

Values come from `build/skills.yml` (owned by assemble-dist).

## Data Contracts

| File | Content |
|---|---|
| `<dist>/.claude-plugin/marketplace.json` | `marketplace` object |
| `<dist>/.agents/plugins/marketplace.json` | The same `marketplace` object |
| `<dist>/plugins/<name>/.claude-plugin/plugin.json` | `plugin_manifest` |
| `<dist>/plugins/<name>/plugin.json` | `openai_manifest` |
| `<dist>/hosts/claude/.claude-plugin/marketplace.json` | Claude listing `marketplace` (per-host branch, PLG-12) |
| `<dist>/hosts/claude/plugins/<name>/.claude-plugin/plugin.json` | Claude listing `plugin_manifest` (per-host branch) |
| `<dist>/hosts/chatgpt/.claude-plugin/marketplace.json` | `marketplace` object (per-host branch) |
| `<dist>/hosts/chatgpt/plugins/<name>/.claude-plugin/plugin.json` | `plugin_manifest` (per-host branch) |
| `<dist>/hosts/codex/.agents/plugins/marketplace.json` | `marketplace` object (per-host branch) |
| `<dist>/hosts/codex/plugins/<name>/plugin.json` | `openai_manifest` (per-host branch) |
| `<dist>/hosts/chatgpt-directory/plugins/<name>/plugin.json` | ChatGPT directory manifest (native Agent Plugins package, per-host branch) |

The per-host branches reuse `build_manifests`, so every branch's manifests carry the same name, version and description as the combined `dist/` (PLG-11). `emit_host_branches` (assemble-dist) selects which manifests each branch writes through `HOST_BRANCHES`: the claude entries use the manifest kinds `claude_marketplace` and `claude_plugin`, chatgpt uses `marketplace` and `plugin`, codex uses `marketplace` and `openai`, chatgpt-directory uses `chatgpt_directory` only.

`build_claude_listing_manifests(config)` starts from copies of the base marketplace and plugin manifest and adds only the documented directory listing keys, so the combined root, ChatGPT and Codex keep their shape:

```json
{"name": "<name>", "version": "<version>", "description": "<description>", "license": "<license>",
 "author": {"name": "<author>", "email": "<author_email>"}, "homepage": "<homepage>",
 "repository": "<repository>", "keywords": ["<keyword>", "..."], "displayName": "<display_name>",
 "documentationUrl": "<documentation_url>", "supportUrl": "<support_url>",
 "privacyPolicyUrl": "<privacy_policy_url>"}
```

The Claude marketplace is the base marketplace with `owner` set to `{"name": "<author>", "email": "<author_email>"}` and `metadata` set to `{"description": "<description>"}`.

`build_chatgpt_directory_manifest(config)` returns the native Agent Plugins `plugin.json`. It carries exactly `AGENT_PLUGINS_MANIFEST_KEYS` at the top level and `CHATGPT_INTERFACE_KEYS` in the interface, in this order, and `write_json` keeps that order (`ORDERED_MANIFEST_KINDS`) instead of sorting:

```json
{"$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
 "name": "<name>", "version": "<version>", "description": "<description>",
 "author": {"name": "<author>", "email": "<author_email>"}, "homepage": "<homepage>",
 "repository": "<repository>", "license": "<license>", "keywords": ["<keyword>", "..."],
 "extensions": {"com.openai": {"interface": {
   "displayName": "<display_name>", "shortDescription": "<short_description>",
   "longDescription": "<long_description>", "developerName": "<author>", "category": "<category>",
   "capabilities": ["<capability>", "..."], "defaultPrompt": ["<prompt>", "..."],
   "websiteURL": "<homepage>", "supportURL": "<support_url>",
   "privacyPolicyURL": "<privacy_policy_url>", "logo": "./assets/logo.png"}}}}
```

`author` has no `url` (there is no source for it). The interface has no `screenshots` (rejected for a skills-only package), `brandColor`, `brandColorDark`, `composerIcon` or `termsOfServiceURL` (no owner value). The schema URL, the 13 categories, the logo path and every length and count limit live once in `build.py`; `build/check_chatgpt_submission.py` imports them (PLG-11).

Base manifests:

```json
{"name": "<name>", "owner": {"name": "<author>"},
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

Current values (`build/skills.yml`): name `paqad-product-discovery`, version `3.2.0`, licence `MIT`, display name `Paqad Product Discovery`, description "Ask what a product does, shape ideas into user-story tickets, refine tickets, size work and plan sprints, grounded in the repository's docs and code.", author `Eliyce`, author email `haider@eliyce.com`, repository `https://github.com/Eliyce/paqad-product-discovery-plugin`, homepage and documentation URL `https://github.com/Eliyce/paqad-product-discovery-plugin#readme`, support URL `.../issues`, privacy policy URL `.../blob/main/PRIVACY.md`, keywords `product-discovery, product-management, user-stories, tickets, jira, backlog, sprint-planning`, short description "Ideas to ready tickets", category `Productivity`, three default prompts and six capabilities.

## Script Interfaces

Part of `build/build.py`; see assemble-dist for the CLI and exit codes. `build_manifests(config)` returns `(marketplace, plugin_manifest, openai_manifest)`. `build_claude_listing_manifests(config)` returns `(marketplace, plugin_manifest)` for the Claude branch. `parse_keywords(text)` splits the comma-separated `keywords` scalar, strips each entry and drops empties. `build_chatgpt_directory_manifest(config)` returns the ChatGPT directory manifest. `parse_pipe_list(text, field)` splits a `|`-separated scalar and trims each entry; an empty entry is a `BuildError`.

## State Management

None: stateless.

## Error Codes

Raised in `load_config` before any manifest is written:

| Message (pattern) | Meaning |
|---|---|
| `skills.yml is missing a non-empty '<field>'` | A required scalar or listing scalar is missing (no default; the old `Paqad` author fallback is gone) |
| `skills.yml '<field>' must start with https://, got '<value>'` | A listing link (`repository`, `homepage`, `documentation_url`, `support_url`, `privacy_policy_url`) is not https |
| `skills.yml 'keywords' has no keyword after splitting on commas` | `keywords` is only commas or spaces |
| `skills.yml is missing a non-empty '<field>'` | One of `short_description`, `long_description`, `category`, `default_prompts`, `capabilities` is missing |
| `skills.yml 'category' must be one of ...` | `category` is not one of the 13 directory categories (exact case) |
| `skills.yml '<field>' is N characters; the limit is L` | `display_name` over 30, `author` over 80, `short_description` over 30, `long_description` over 4000, a prompt over 128 or a capability over 120 |
| `skills.yml '<field>' has an empty entry after splitting on '\|'` | An extra `\|` in `default_prompts` or `capabilities` |
| `skills.yml '<field>' has N entries; the limit is L` | More than 3 prompts or 20 capabilities |
| `skills.yml 'default_prompts' has a duplicate entry` / `... contains '@'` | A repeated prompt, or a prompt with `@` |

## Dependencies

| Kind | Detail |
|---|---|
| Python | Standard library `json`, `os` |
| Host readers | Claude org sync and ChatGPT workspace import (`.claude-plugin/marketplace.json`); Codex local marketplaces and ChatGPT import (`.agents/plugins/marketplace.json`); Claude plugin manifest; OpenAI primary manifest (section 11) |
| Host readers (directory) | The ChatGPT plugin directory reads the native `plugin.json` from the uploaded zip (O12, O26) |
| Release | CI-14 bumps `version` in `build/skills.yml`; CI-16 in `release.yml` pushes the Claude branch to the public repo the listing links point at, and packs and checks the ChatGPT directory zip |

## Configuration

`build/skills.yml` scalars: the five required ones plus the listing scalars `author`, `author_email`, `repository`, `homepage`, `documentation_url`, `support_url`, `privacy_policy_url`, `keywords` (one comma-separated scalar, since the restricted reader has no top-level lists), and the ChatGPT directory scalars `short_description`, `long_description`, `category`, `default_prompts` and `capabilities` (the last two separated by `|`, because prompts contain commas). The `com.openai` literal lives only in `build.py` so shipped text stays vendor-neutral.

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_build.py` | `BuildOutputTest.test_all_four_manifests_exist`, `test_manifests_agree_on_identity`, `test_openai_keys_under_extension`; `DeterminismTest.test_two_builds_byte_identical`; `HostBranchTest.test_branch_manifests_match_the_single_source`, `test_codex_branch_is_openai_primary`, `test_chatgpt_branch_has_no_agents_file` (PLG-12); `ListingManifestTest` (`test_claude_plugin_carries_the_listing_fields`, `test_claude_marketplace_has_owner_email_and_description`, `test_other_manifests_keep_the_base_shape`, `test_every_manifest_reads_the_version_and_owner`, `test_the_old_domain_is_gone_from_source_and_dist`); `ListingFailureTest` (`test_each_missing_listing_scalar_fails`, `test_a_non_https_listing_url_fails`, `test_empty_keywords_fail`, `test_keywords_are_stripped_and_empties_dropped`, `test_each_bad_chatgpt_directory_scalar_fails_before_any_dist_file`, `test_pipe_lists_are_trimmed`) |
| `tests/scripts/test_chatgpt_submission.py` | `PackageLayoutTest.test_manifest_keys_and_values_come_from_the_single_source`; `ManifestRuleTest` and `InterfaceRuleTest` (one failing fixture per manifest and interface rule) |
| `.github/workflows/ci.yml` | "CI-8 build is deterministic"; "CI-16 ChatGPT submission zip is deterministic and passes the pre-submission check"; "CI-9 claude plugin validate --strict on dist/hosts/claude" (only when `ENABLE_PLUGIN_VALIDATORS` is `true`) |

Not yet automated by default: CI-9 validators stay off until `ENABLE_PLUGIN_VALIDATORS` is set. Manual: U-2 in `hosts/chatgpt.md`, U-12 in `hosts/codex.md` (both `pending`).
