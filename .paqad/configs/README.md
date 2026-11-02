# paqad team configuration (`.paqad/configs/`)

Tracked, team-shared framework overrides. Onboarding writes one file per group,
each pre-filled with every knob in that group, commented out and documented:

- `.config.app` — Application, version, enterprise, and feature flags
- `.config.rag` — Intelligence / RAG
- `.config.models` — Research depth, model routing, and stage helper effort and model
- `.config.policy` — Quality, escalation, and decision policy

Every file in this directory is merged into one map and read at runtime, so the
split is purely organizational — a key works in any file.

For a single copy-paste reference listing every knob in one place, see
`../.config.example` (tracked, never read at runtime).

## How to use

- Uncomment a line to override that knob. While a key stays commented (or absent),
  paqad uses its built-in code default, so an untouched project runs entirely on
  defaults.
- Keys must be globally unique across these files. The same key uncommented in two
  files is a collision: the alphabetically-last filename wins, and `paqad-ai
  onboard`/`update` reports it.
- A teammate’s local `../.config` (git-ignored) overrides anything here, and a
  `PAQAD_*` env var overrides everything.
- `paqad-ai update` refreshes these files: it appends knobs added in a new version
  (commented) and prunes knobs a new version removed, but never changes a value you
  uncommented. It never resets your settings to defaults.
- `../.config.example` names the paqad version that generated it. A paqad older than
  that version leaves the example, these files and this README exactly as they are,
  so a teammate on an older install never rewrites a newer checkout.

## git-workflow/

`git-workflow/` holds this team's rules for tickets, branches, commits, pull requests
and how strictly they're checked, in five YAML files: `tickets.yaml`, `branches.yaml`,
`commits.yaml`, `pull-requests.yaml` and `enforcement.yaml`.

- These files are YAML, not the `key=value` files above.
- No personal override applies: `../.config` and `PAQAD_*` env vars don't change them.
- `paqad-ai update` adds new settings with a `# Added in paqad-ai <version>` line and
  never changes a value you set.
- The commit-msg and pre-push hooks check people's commits and pushes;
  `git commit --no-verify` skips them.
- Changes go through the `git-workflow` skill. Ask your agent, for example "make hotfix
  branches start from main".
