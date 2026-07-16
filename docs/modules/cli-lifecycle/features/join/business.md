# paqad-ai join — Business View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `join`

## Overview

`paqad-ai join` prepares a fresh clone of an already-onboarded project for a teammate. It restores machine-local framework artifacts without repeating project discovery or changing committed project truth.

## User Flow

1. A teammate clones a repository whose onboarding manifest and project profile are committed.
2. They run `paqad-ai join` from the project root.
3. The command recreates only Git-ignored adapter caches, compiled context, decision directories, framework markers, and Git hooks.
4. If the team enabled RAG and no valid local index exists, join builds one locally. `--no-rag` skips this step; `--interactive` asks before building; `--yes` accepts the interactive build.
5. Success reports that the machine is ready and no tracked files changed.

## Business Rules

- The project must already contain both `.paqad/onboarding-manifest.json` and `.paqad/project-profile.yaml`.
- Join never performs onboarding, stack selection, provider selection, or project-profile migration.
- A repository-working-tree artifact is written only when Git classifies its path as ignored. Existing tracked provider entry files and tracked local-artifact paths are preserved.
- Team RAG settings come from the tracked `.paqad/configs/.config.rag`; environment and machine-local overrides retain higher precedence.
- Re-running join converges safely: existing provider files are preserved, Git hooks are chained once, and a valid RAG index is not rebuilt.

## Error State

An un-onboarded or incomplete clone stops with guidance to ask the project lead to run `paqad-ai onboard`. A failed RAG build uses the same recovery behavior and provider validation as `paqad-ai rag init`.
