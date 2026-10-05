# paqad-product-discovery

Source for the paqad-product-discovery plugin: a set of skills that help shape product
ideas into well-formed tickets, grounded in the target project's own documentation. This
repository is the plugin source and build; it is not a paqad-onboarded product repo.

## Status

S0 is a spike. It ships a two-skill test plugin (`discover-probe`, `discover-read`) on top
of a durable repository skeleton (single-source-of-truth build, manifests, tests, CI). It is
a starting point, not a finished product, and the skill behaviour is deliberately minimal.

The product spec is `REQUIREMENTS.md`. The frozen S0 feature spec is `S0-spec.md`.

## Layout at a glance

- `shared/references/` - shared text imported into skills at build time.
- `skills/discover-probe/`, `skills/discover-read/` - the two skill sources (`SKILL.md`
  plus any `scripts/`).
- `build/skills.yml` - the single source of truth for name, version, description, license,
  display text, and each skill's declared shared imports.
- `build/build.py` - assembles `dist/` from that single source and generates every manifest.
- `hosts/{claude,chatgpt,codex}.md` - per-host manual install steps and the recording harness
  for the S0 unknowns (U-1..U-17).
- `tests/scripts/` - standard-library unit tests.
- `tests/evals/fixture-repo/`, `tests/evals/scenarios/` - evaluation fixtures and scenarios.
- `dist/` - generated plugin output (produced by the build; do not hand-edit).
- `.changeset/`, `.github/workflows/{ci,release,verify}.yml` - release tracking and CI.

## Requirements

A working Python 3.9 or newer. The committed code is standard-library only, so no third-party
packages or network access are needed to build or test. Below, `python3` means such an
interpreter.

## Build

```
python3 build/build.py
```

This reads `build/skills.yml`, copies each skill plus its declared shared imports, and writes
the generated plugin into `dist/`. Runs are deterministic: two consecutive runs on a clean
tree produce byte-identical `dist/` output.

## Test

```
python3 -m unittest discover -s tests/scripts
```

## Host verification

The plugin is packaged for claude.ai, ChatGPT, and Codex, but S0 claims no automated host
verdict. The cross-host unknowns (U-1..U-17) are recorded MANUALLY in
`hosts/{claude,chatgpt,codex}.md`: install the plugin on each host, run the listed checks, and
fill in each verdict (every verdict starts as `pending`). "Packaged" is not "verified"; host
verification is complete only once those harnesses are filled in.
