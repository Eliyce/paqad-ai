# Config Visibility and Preservation

paqad separates two kinds of settings, and each lives where it belongs. Project facts (what this repo _is_) live in
`.paqad/project-profile.yaml`. Framework knobs (how paqad _behaves_) live in code defaults, overridden through a
four-surface config layer and made discoverable through tracked YAML team files, their schemas and a generated README. The dividing
line is project-fact vs framework-knob, not whether a value has a default. Specific to this repo (paqad-ai).

## The two kinds of settings

- Keep only project facts in `project-profile.yaml`: name, id, description, the project's own `commands`, `mcp.servers`, <!-- @rule RL-93ac -->
  the detection-derived `active_capabilities` and `stack_profile`, and the project-owned `custom` arrays. These describe
  the repository, not framework behavior.
- Keep every framework knob in `src/core/framework-config.ts` (the `FRAMEWORK_CONFIG_SPECS` registry) at its code <!-- @rule RL-7483 -->
  default, and override it through the config layer below. Knobs include `paqad_enable`, the whole `enterprise` block,
  the RAG/intelligence knobs, strictness, feature flags, model routing, the decision knobs, and the
  version/update knobs.

## The four surfaces

Keys are bare and readable (`enterprise=true`), and each has a `PAQAD_*` env equivalent for a per-run override.
Resolution precedence, lowest to highest, local wins over team:

| Surface                    | Git     | Owner     | Role                         |
|----------------------------|---------|-----------|------------------------------|
| framework code defaults    | —       | framework | the source of truth          |
| `.paqad/configs/**/*.yaml` | tracked | team      | readable YAML team files     |
| `.paqad/.config`           | ignored | developer | local override (LOCAL WINS)  |
| `PAQAD_*` env var          | —       | the run   | per-run escape hatch         |

`.paqad/configs/` holds readable YAML team files: `paqad.yaml`, `models.yaml`, `retrieval.yaml`, `decisions.yaml`,
`authoring.yaml`, `git-workflow/commits.yaml` and one file per concern under `feature-development/`. Each registry setting
has exactly one home (a file and a nested path), so two files never set the same key. A new team file lists every
setting it can hold at that point, commented out with its default and a one-line note. A setting added later doesn't
appear in an existing file: people find it in `.paqad/.config.example` and `paqad-ai config show`. A team removes the `#`
to change a setting, and a setting left commented out uses paqad's default. `paqad-ai update` regenerates `.paqad/configs/README.md`, which lists every setting with
its default, allowed values, flat name and env var. `paqad-ai config show` prints the live value and source of every
setting. `.paqad/.config` and `PAQAD_*` keep the flat names (`hud_view=false`); `.paqad/.config.example` lists them,
with a comment naming each one's YAML home. The old `.paqad/configs/.config.*` files are migrated by `update`,
`onboard` and `paqad-ai config migrate`, and are read only until `LEGACY_TEAM_CONFIG_READ_UNTIL`.

## Rules

- Keep every knob discoverable: give it a registry row with a YAML home, so it shows in its file's schema, the generated <!-- @rule RL-0a01 -->
  README and `paqad-ai config show` with its default and `PAQAD_*` equivalent, and a plain one-line `comment`, because
  that comment is the note people read above the setting in its team file. MUST NOT add a knob that is invisible and
  undiscoverable.
- Resolve in the fixed precedence: defaults, then the YAML team files in `configs/`, then `.config` (local), then <!-- @rule RL-5163 -->
  `PAQAD_*` env, then programmatic overrides. A local file beats a team file; an env var beats both files.
- Resolve any knob no surface sets to its documented code default, so a commented, missing, or hand-trimmed config never <!-- @rule RL-e1f9 -->
  breaks and a fresh install runs entirely on defaults.
- Source framework knobs only from the four surfaces. MUST NOT read a framework knob from `project-profile.yaml` or <!-- @rule RL-23fb -->
  re-introduce one into the profile schema. A leftover knob there is ignored on read and stripped on write.
- Refresh the detection-derived fields (`active_capabilities`, `stack_profile`) from repository reality on every run; <!-- @rule RL-0203 -->
  they are framework-owned outputs, not team config.
- Reconcile on re-onboard and update, never reset: update rewrites a team file only for a migration, a retired value, <!-- @rule RL-6a6f -->
  a removed setting or a stale workflow entry, and print a line for each. The entries paqad once shipped are listed in
  `src/core/shipped-workflow-entries.ts`. Keep the team's values and comments, regenerate the README, and never write a
  default as a live value. A new setting does not appear in an existing team file. Explicit writes, such as
  `paqad-ai config set`, still re-render the file they touch. `doctor` reports a setting this version doesn't know
  instead of deleting it. MUST NOT rewrite a team's value or reset a file to defaults, apart from these named cases.

## Evolving the config surface is a decision pause

Adding or removing a knob changes the contract every onboarded team consumes, so it is a decision pause, not a silent
edit. Before you change the registry:

```
1. Pause and confirm with the user (in Claude Code, via AskUserQuestion). This is a repo rule,
   intentionally NOT a distributed DECISION_CATEGORY, so the pause never ships into onboarded projects.
2. Edit the one FRAMEWORK_CONFIG_SPECS entry (key, PAQAD_* env, type, default, group, comment).
   The comment is one plain sentence: it is the note people read in the team file.
   Give it a YAML home in TEAM_CONFIG_HOMES (file, path, value translation) and set `since`.
   The resolver, parser, schemas, README, `config show`, validation, and dashboard fields all derive from it.
3. A test asserts every flat value round-trips through its YAML value.
4. The new key shows up in new team files, the README, .paqad/.config.example and config show. Existing team files stay as they are.
```

## How this is enforced

`src/core/framework-config.ts` is the single source of truth: one `FRAMEWORK_CONFIG_SPECS` registry drives the defaults,
the parser, the layered resolver, the env mapping, the YAML homes, the schemas and the generated README, so they
cannot drift. Three independent parsers resolve the disabled signal, the TS predicate (`framework-enabled.ts`), the
`.mjs` hook, and the `.sh` kill switch, pinned to one precedence and coercion by
`tests/unit/core/config-parser-parity.test.ts`. `paqad-ai enable`/`disable` and the dashboard config surface read and
write the config layer (`.paqad/.config` and the team YAML files), not the profile. `doctor` runs a `team-config` check
for missing files, invalid values, unknown settings and old `.config.*` files.
