# Claude Plugin

> **Layer:** `agent-workflows` &nbsp;·&nbsp; **Confidence:** `medium` &nbsp;·&nbsp; **Slug:** `claude-plugin`

## Purpose

There is one `paqad` Claude plugin. It works in Claude Code, Cowork and claude.ai chat. It
carries the hooks, stage agents, HUD mod and launcher that make paqad work in Claude Code, and
it carries the skills a team uses: the developer skills and the product-owner discovery skills.
Release pushes the assembled plugin tree to `Eliyce/paqad-claude-plugin`.

## What the plugin ships

17 skills, all under `runtime/claude-plugin/skills/`, each invoked as `/paqad:<name>`.

- Developer skills, written by hand: `onboard`, `join`, `dashboard`.
- Product-owner discovery skills, generated from `plugins/discovery`: `start`, `discover`,
  `ask`, `refine-ticket`, `size-work`, `plan-sprint`, `get-connected`, `understand-idea`,
  `ground-in-project`, `shape-idea`, `decide-together`, `write-tickets`, `check-tickets`,
  `post-tickets`.

Inside this plugin the discovery skills use short names (`ask`, not `paqad-ask`), because the
plugin already puts them under `paqad:`. The source folders in `plugins/discovery/skills/` keep
their own names (for example `front-door` builds to `start`, `product-discovery` to `discover`,
`ask-project` to `ask`).

The discovery skills ship only in the plugin. The npm package leaves them out (the `files`
list in `package.json` excludes each generated skill folder), so npm users get the three
developer skills only. There is no root `bin/`: the launcher lives in `dist/` and
`runtime/claude-plugin/bin/`.

## How the discovery skills are built

The source is `plugins/discovery`. Its builder is `plugins/discovery/build/build.py`
(Python 3.9 or newer, standard library only). Two flags matter here:

- `--host-labels keep` leaves the host label at the start of each description and the
  `compatibility` line in place. The paqad plugin uses this. The default, `strip`, removes them
  for the other hosts.
- `--version` sets the version. Without it the build reads the version from the repository
  `package.json`.

Run `pnpm build:discovery` (which runs `scripts/build-discovery.mjs`). It builds the skills,
then replaces the generated skill folders in `runtime/claude-plugin/skills/` and leaves
`onboard`, `join` and `dashboard` alone. The generated skills are committed.

Run it whenever you change anything under `plugins/discovery` that a skill uses. CI rebuilds
the skills in the `discovery-plugin` job and fails if `runtime/claude-plugin/skills` differs
from the fresh build. The fix is the same command: run `pnpm build:discovery` and commit
`runtime/claude-plugin/skills`. A version bump in `package.json` alone causes no drift.

## Skill frontmatter rules

Every skill in the plugin uses only these six frontmatter keys: `name`, `description`,
`license`, `compatibility`, `metadata`, `allowed-tools`.

Each description starts with one of two prefixes, and the prefix fixes the `compatibility`
value:

| Description starts with | `compatibility` must be |
| --- | --- |
| `Chat and Claude Code: ` | `claude.ai chat, Cowork or Claude Code; reads project docs and code through a connector, uploaded files or the open folder` |
| `Claude Code: ` | `Claude Code with a project folder open (needs a shell)` |

The discovery skills use the first. `onboard`, `join` and `dashboard` need a shell, so they use
the second.

`scripts/check-plugin-skills.mjs` checks these rules over `runtime/claude-plugin/skills` and
`plugins/discovery/skills`, and checks that nothing points at a root `bin/`. It runs as part of
`scripts/validate-plugin.mjs` (`pnpm plugin:validate`), which runs in the static CI checks.

## Publishing

Release assembles the plugin and pushes it to `Eliyce/paqad-claude-plugin` with the
`PAQAD_PLUGIN_PUSH_TOKEN` secret. See [RELEASE-WORKFLOW.md](../../../RELEASE-WORKFLOW.md).

## Sources

- `src/plugin`, `runtime/claude-plugin`, `plugins/discovery`
- `scripts/assemble-plugin.mjs`, `scripts/build-plugin-manifest.mjs`,
  `scripts/validate-plugin.mjs`, `scripts/test-plugin.mjs`
- `scripts/build-discovery.mjs`, `scripts/check-plugin-skills.mjs`
