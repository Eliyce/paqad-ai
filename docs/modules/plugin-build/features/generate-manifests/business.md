# Generate host manifests: business

## Overview

Each host reads the plugin's name, version and description from its own manifest file, in its own place. If those files were written by hand they would drift, and one host could install a different version or show a different description from another. This feature writes all four manifest files from the same handful of values in one configuration file, every time the plugin is built.

## User Roles

| Role | Interest |
|---|---|
| Delivery lead or product owner | One version number and one description across every host and listing |
| Org or workspace admin | Points their host at the distribution repository; the host finds the manifest it expects |
| Contributor | Changes name, version or description in one place only |

## User Flows

| Step | What happens |
|---|---|
| 1 | The build reads name, version, description, licence, display name and author from the configuration |
| 2 | It writes the two marketplace files (one read by Claude org sync and ChatGPT workspace import, one read by Codex local marketplaces and ChatGPT import) |
| 3 | It writes the two plugin manifests (the Claude plugin manifest and the OpenAI primary manifest) |
| 4 | Pull request CI confirms two builds produce identical files |

## Business Rules

| Guarantee | Why it matters |
|---|---|
| One source of truth | The manifests cannot disagree on identity (PLG-11) |
| Deterministic files | Same input, byte-identical manifests, so a release can be verified (CI-8) |
| Host-specific keys kept apart | Host-only settings sit under their own extension key in the OpenAI manifest, never in shipped skill text (PLG-4) |
| No server declarations | No MCP or app files are produced, which would make a host refuse or limit the plugin (PLG-2) |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Every build | All four manifest files are rewritten |

## Error States

| State | What happens |
|---|---|
| A required value is missing from the configuration | The build fails and names the missing field; no manifests are written |
| A host misreads the two-marketplace layout | Not handled yet; the fallback is per-host distribution branches (PLG-12), not built. Host checks U-2 and U-12 are still pending |

Current values to be aware of: version is fixed at 0.0.0 and the configured homepage is a placeholder; version bumping is planned release work.

## Glossary

| Term | Meaning |
|---|---|
| Manifest | A small file that tells a host what the plugin is called, its version and where it lives |
| Marketplace file | A manifest listing plugins a host can install from a repository |
| Distribution repository | Where the built output is pushed for hosts to sync from |

Sources: build/build.py, build/skills.yml
