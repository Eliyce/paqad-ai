# Assemble the plugin output: business

## Overview

The plugin is written as 13 skills plus a small set of shared texts and scripts that many skills need. Users cannot install that source tree directly. This feature assembles it into one installable package, copying each shared file into every skill that asks for it, so the same package can be published to every host. From that one source it also emits a ready-to-install branch per host, so a host that cannot read the combined package can still install its own. It is the single step that decides what ships.

## User Roles

| Role | Interest |
|---|---|
| Delivery lead or product owner | Confidence that what ships is exactly what was reviewed, and nothing else |
| Contributor | Runs the build before raising a change; gets a clear error when a skill uses a shared file it has not declared |
| Release pipeline | Runs the same build to publish (release automation is not built yet) |

## User Flows

| Step | What happens |
|---|---|
| 1 | A contributor or CI runs the build |
| 2 | The build reads the one configuration file listing the plugin's identity and each skill's shared files |
| 3 | Any previous output is wiped so removed files cannot linger |
| 4 | Each skill is checked: if its instructions mention a shared file it did not declare, the build stops and names it |
| 5 | Each skill folder and its declared shared files are copied into the output |
| 6 | The manifests are written (see Generate host manifests) |
| 7 | A ready-to-install branch per host is emitted from the same source, each carrying only the files that host reads |

## Business Rules

| Guarantee | Why it matters |
|---|---|
| Skills only | Hosts refuse or limit plugins that carry agents, hooks, commands, a bin folder or server declarations (PLG-1, PLG-2); the build never produces them |
| One copy of shared material | Shared text is maintained once and cannot drift between skills (PLG-9) |
| Declared imports only | A skill cannot silently depend on a shared file nobody declared (PLG-10) |
| Same input, same output | Two builds of the same source are byte-identical, so a release can be reproduced and checked (CI-8) |
| One source, every branch | The per-host branches are generated from the same values and the same skills tree, so no branch can drift from the combined package; the combined output itself is left unchanged (PLG-12) |
| No leftovers | Old output is removed first; compiled Python caches are never copied |
| No install step | Runs on Python 3.9 or later with nothing to install (PLG-5) |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Running the build by hand or in CI | Replaces the whole output folder (default `dist/`, which is not committed) |
| Pull request CI | Two builds are compared; any difference fails the check |

## Error States

| State | What the contributor sees |
|---|---|
| Skill mentions an undeclared shared file | "build failed" naming the skill and the file, with a hint to declare it |
| Declared shared file does not exist | "build failed" naming the skill and the missing file |
| Skill folder or its instructions file missing | "build failed" naming the skill |
| Configuration file has unexpected layout or a missing value | "build failed" naming the line or the missing field |

## Glossary

| Term | Meaning |
|---|---|
| Shared import | A shared text or script a skill declares it needs |
| Distribution output | The assembled package that gets published |
| Host branch | A per-host copy of the distribution under `dist/hosts/<host>/`, carrying only the files that host reads |
| Deterministic | The same source always gives the same output, byte for byte |

Sources: build/build.py, build/skills.yml
