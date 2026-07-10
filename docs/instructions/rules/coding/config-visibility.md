# Config Visibility and Preservation

paqad separates two kinds of settings, and each lives where it belongs. Project facts (what this repo _is_) live in
`.paqad/project-profile.yaml`. Framework knobs (how paqad _behaves_) live in code defaults, overridden through a
four-surface config layer and made discoverable through tracked, self-documenting per-group config files. The dividing
line is project-fact vs framework-knob, not whether a value has a default. Specific to this repo (paqad-ai).

## The two kinds of settings

- Keep only project facts in `project-profile.yaml`: name, id, description, the project's own `commands`, `mcp.servers`,
  the detection-derived `active_capabilities` and `stack_profile`, and the project-owned `custom` arrays. These describe
  the repository, not framework behavior.
- Keep every framework knob in `src/core/framework-config.ts` (the `FRAMEWORK_CONFIG_SPECS` registry) at its code
  default, and override it through the config layer below. Knobs include `paqad_enable`, the whole `enterprise` block,
  the RAG/intelligence knobs, strictness, escalation, feature flags, model routing, the decision knobs, and the
  version/update knobs.

## The four surfaces

Keys are bare and readable (`enterprise=true`), and each has a `PAQAD_*` env equivalent for a per-run override.
Resolution precedence, lowest to highest, local wins over team:

| Surface                    | Git     | Owner     | Role                         |
|----------------------------|---------|-----------|------------------------------|
| framework code defaults    | —       | framework | the source of truth          |
| `.paqad/configs/.config.*` | tracked | team      | shared, merged grouped files |
| `.paqad/.config`           | ignored | developer | local override (LOCAL WINS)  |
| `PAQAD_*` env var          | —       | the run   | per-run escape hatch         |

`.paqad/configs/` holds one file per group (`.config.app`, `.config.rag`, `.config.models`, `.config.policy`).
Onboarding writes each pre-filled with every knob in that group, commented out at its default, documented with a
one-line explanation and its `PAQAD_*` equivalent. All are globbed and merged, so a key works in any file and must be
globally unique (a collision warns, last filename wins). Onboarding also writes one tracked `.paqad/.config.example`
cataloguing every knob; it is never read at runtime.

## Rules

- Keep every knob discoverable: onboarding writes it into its group file, commented out, with its default and `PAQAD_*`
  equivalent, so a team finds a knob by reading the file it would change. MUST NOT add a knob that is invisible and
  undiscoverable.
- Resolve in the fixed precedence: defaults, then `configs/.config.*` (team, merged), then `.config` (local), then
  `PAQAD_*` env, then programmatic overrides. A local file beats a team file; an env var beats both files.
- Resolve any knob no surface sets to its documented code default, so a commented, missing, or hand-trimmed config never
  breaks and a fresh install runs entirely on defaults.
- Source framework knobs only from the four surfaces. MUST NOT read a framework knob from `project-profile.yaml` or
  re-introduce one into the profile schema. A leftover knob there is ignored on read and stripped on write.
- Refresh the detection-derived fields (`active_capabilities`, `stack_profile`) from repository reality on every run;
  they are framework-owned outputs, not team config.
- Reconcile on re-onboard and update, never reset: sync the group files (creating a missing file, appending a new
  version's knobs commented), prune only keys this version no longer knows, and preserve every value the team
  uncommented. MUST NOT rewrite a team's value or reset a file to defaults.

## Evolving the config surface is a decision pause

Adding or removing a knob changes the contract every onboarded team consumes, so it is a decision pause, not a silent
edit. Before you change the registry:

```
1. Pause and confirm with the user (in Claude Code, via AskUserQuestion). This is a repo rule,
   intentionally NOT a distributed DECISION_CATEGORY, so the pause never ships into onboarded projects.
2. Edit the one FRAMEWORK_CONFIG_SPECS entry (key, PAQAD_* env, type, default, group, comment).
   The resolver, parser, generated group files, validation, and dashboard fields all derive from it.
3. A test asserts the generated group files round-trip to the defaults.
4. On the next onboard/update, a new key is appended (commented) and a removed key is pruned from
   every team/local file while all still-valid uncommented values are preserved.
```

## How this is enforced

`src/core/framework-config.ts` is the single source of truth: one `FRAMEWORK_CONFIG_SPECS` registry drives the defaults,
the parser, the layered resolver, the env mapping, the generated group files, and the reconcile/prune pass, so they
cannot drift. Three independent parsers resolve the disabled signal, the TS predicate (`framework-enabled.ts`), the
`.mjs` hook, and the `.sh` kill switch, pinned to one precedence and coercion by
`tests/unit/core/config-parser-parity.test.ts`. `paqad-ai enable`/`disable` and the dashboard config surface read and
write the config layer (`.paqad/.config`), not the profile.
