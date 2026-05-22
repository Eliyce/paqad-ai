# Documentation

## Purpose

Maintain canonical documentation as current system truth.

## Rules

- Documentation creation is a workflow, not a standalone framework CLI command.
- Run documentation creation only after onboarding has established framework metadata.
- Validate the current application state from `composer.json`, `package.json`, and stack manifests before writing docs.
- If the real stack differs from stored onboarding state, update the effective stack context first.
- Create docs in ordered steps and persist progress to `.paqad/doc-progress.json`.
- Update specs, flows, API docs, integration docs, and error catalogs together.
- Refresh registries after relevant file changes.
- Keep glossary terms aligned with new business language.
