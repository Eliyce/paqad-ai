# paqad-ai join — Business View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `join`

## Overview

`paqad-ai join` prepares a fresh clone of an already-onboarded project for a teammate. It sets up the machine-global framework install and restores machine-local framework artifacts, without repeating project discovery or changing committed project truth.

## User Flow

1. A teammate clones a repository whose onboarding manifest and project profile are committed.
2. They run `paqad-ai join` from the project root.
3. Join sets up the global install under the user home (`~/.paqad-ai/current` and the stage-isolation agents), so the generated hook commands resolve and the framework loads. This replaces the old need to run `paqad-ai install` or `paqad-ai onboard` on a fresh machine.
4. The command recreates only Git-ignored adapter caches, compiled context, decision directories, framework markers, and Git hooks.
5. Join regenerates the per-machine artifacts that never arrive via clone: the detection report and stack snapshot/drift that `doctor` reads, the code-knowledge index the reuse and spec checks depend on, the delivery detection, and the quality-ratchet baseline (seeded from the clean HEAD).
6. If the team enabled RAG and no valid local index exists, join builds one locally. `--no-rag` skips this step; `--interactive` asks before building; `--yes` accepts the interactive build.
7. Success reports that the machine is ready and no tracked files changed.

## Business Rules

- The project must already contain both `.paqad/onboarding-manifest.json` and `.paqad/project-profile.yaml`.
- Join never performs onboarding, stack selection, provider selection, or project-profile migration.
- The global install writes only under the user home, so join still changes no tracked file.
- A repository-working-tree artifact is written only when Git classifies its path as ignored and does not track it. Existing tracked provider entry files and tracked local-artifact paths are preserved. Join regenerates the Git-ignored host-config files paqad owns even when they already exist, so a stale hook set is refreshed.
- Team RAG settings come from the tracked `.paqad/configs/.config.rag`; environment and machine-local overrides retain higher precedence. The RAG build rebuilds only the local index; it never rewrites the tracked project profile or the dev-local `.config`.
- The per-machine artifacts join regenerates are all Git-ignored, so regenerating them keeps the no-tracked-diff contract.
- When the Git hooks directory is redirected (`core.hooksPath`) to a tracked directory, join does not modify it and instead prints the one-line snippet for the teammate to add.
- Re-running join converges safely: the global install is idempotent, existing provider files are preserved, Git hooks are chained once, and a valid RAG index is not rebuilt.

## Error State

An un-onboarded or incomplete clone stops with guidance to ask the project lead to run `paqad-ai onboard`. A failed RAG build uses the same recovery behavior and provider validation as `paqad-ai rag init`. The global install and each per-machine regeneration step are best-effort: a failure there does not abort join, and the next session or refresh retries.
